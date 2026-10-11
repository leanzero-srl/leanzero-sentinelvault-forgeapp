/*
 * Jira attachment seals — the resolvers (docs/JIRA-SEALS.md). Every action is reachable by any
 * logged-in user with any payload, so each one decides from Jira's own answer about the CALLER on
 * the issue the seal belongs to (the object), never from the payload's word or the app's reach:
 *
 *   jira-issue-seals          read   the issue's attachments, their seals, the viewer's powers
 *   jira-seal-attachment      write  EDIT_ISSUES on the attachment's issue
 *   jira-release-attachment   write  the owner; a steward (project or Jira admin) with a typed reason
 *   jira-extend-attachment    write  the owner or a steward
 *
 * The issue is the one the surface is open on (req.context.extension.issue — Forge-supplied). The
 * config REST API calls the same cores with the issue named in the bundle and the permissions read
 * for the token's minter (permissionsFor below).
 */
import { kvs } from "@forge/kvs";

import {
  ACTIVITY, JIRA_SEAL_MAX_BYTES, buildSealRecord, isExpired, jiraCopyKey, jiraLapseKey, normId, rowFor, sealIdOf, viewerPowers,
} from "./logic.js";
import {
  callerPermissions, downloadAttachment, dropSeal, getSeal, putSeal, readIssue, sha256Hex, storeCopy, userName,
} from "./store.js";
import { resolveSealHoldPeriod } from "../sealing/logic.js";
import { sanitizeHoldDuration } from "../../shared/baseline.js";
import { validateReleaseReason } from "../../shared/release-reason.js";
import { recordActivity, readActivity, activityIssuePrefix } from "../../infra/activity-log.js";

const nowMs = () => Date.now();
const contextIssueId = (req) => normId(req?.context?.extension?.issue?.id);

async function siteSettings() {
  try { return (await kvs.get("admin-settings-global")) || {}; } catch (_) { return {}; }
}

/** The caller's powers on one issue — asked of Jira as the caller, inside a resolver. */
async function powersOn(issueId, settings) {
  return viewerPowers(await callerPermissions(issueId), { allowAdminOverride: settings?.allowAdminOverride });
}

const issueActivity = (rec, type, actor, details = {}) => recordActivity({
  type,
  issueId: rec.issueId,
  projectKey: rec.projectKey,
  actor: actor ? { accountId: actor, name: null } : null,
  target: { kind: "jira-attachment", id: rec.attachmentId, name: rec.attachmentName },
  details: { issueKey: rec.issueKey || null, ownerAccountId: rec.lockedBy, ...details },
  version: null,
});

// ── cores (shared by the resolvers and the config REST API) ───────────────────────────────────

export async function sealJiraAttachment({ accountId, issueId, attachmentId, lockDuration, note, powers }) {
  const attId = normId(attachmentId);
  if (!attId || !issueId) return { success: false, reason: "Name a file on this issue" };
  if (!powers.canEdit) return { success: false, reason: "You need permission to edit this issue to seal its files" };

  const issue = await readIssue(issueId);
  if (!issue) return { success: false, reason: "This issue no longer exists" };
  const att = issue.attachments.find((a) => a.id === attId);
  if (!att) return { success: false, reason: "That file is not attached to this issue" };
  if (att.size > JIRA_SEAL_MAX_BYTES) {
    return { success: false, reason: `Files above ${Math.round(JIRA_SEAL_MAX_BYTES / 1048576)} MB cannot be sealed: Sentinel Vault keeps a copy of every sealed file so it can put it back` };
  }

  const existing = await getSeal(attId);
  if (existing?.lockedBy) {
    if (existing.lockedBy === accountId) return { success: false, reason: "You already hold this file sealed" };
    if (!isExpired(existing, nowMs())) return { success: false, reason: "This file is already sealed by someone else" };
    // A lapsed seal held by someone else: the caller passed the edit gate above, so the old seal
    // goes (and its copy — a fresh one is taken below).
    await dropSeal(existing);
  }

  const holdSeconds = await resolveSealHoldPeriod(null, lockDuration);
  let bytes;
  try { bytes = await downloadAttachment(attId); }
  catch (e) { return { success: false, reason: `Could not read the file from Jira: ${e.message}` }; }
  if (bytes.length !== att.size) return { success: false, reason: "The file changed while it was being read — try again" };
  const copyKey = jiraCopyKey(attId);
  try { await storeCopy(copyKey, bytes); }
  catch (e) { return { success: false, reason: `Could not keep a copy of the file, so it was not sealed: ${e.message}` }; }

  const record = buildSealRecord({
    attachment: att, issue, project: issue.project,
    owner: { accountId, name: await userName(accountId) },
    holdSeconds, sha256: sha256Hex(bytes), copyKey, note, nowMs: nowMs(),
  });
  await putSeal(record);
  await issueActivity(record, ACTIVITY.SEALED, accountId, { holdSeconds, size: record.size });
  return { success: true, seal: record };
}

export async function releaseJiraAttachment({ accountId, issueId, attachmentId, reason, powers }) {
  const attId = normId(attachmentId);
  const record = attId ? await getSeal(attId) : null;
  if (!record?.lockedBy) return { success: false, reason: "This file is not sealed" };
  if (record.issueId !== String(issueId)) return { success: false, reason: "That seal belongs to another issue" };
  const isOwner = record.lockedBy === accountId;
  let forcedReason = null;
  if (!isOwner) {
    if (!powers.isSteward) return { success: false, reason: "Only the person who sealed this file, or a project admin, can release it" };
    const v = validateReleaseReason(reason);
    if (!v.ok) return { success: false, reason: v.error };
    forcedReason = v.reason;
  }
  const dropped = await dropSeal(record);
  if (!dropped.ok) return { success: false, reason: dropped.reason };
  await issueActivity(record, isOwner ? ACTIVITY.RELEASED : ACTIVITY.FORCED, accountId, forcedReason ? { forced: true, reason: forcedReason } : {});
  return { success: true };
}

export async function extendJiraAttachment({ accountId, issueId, attachmentId, lockDuration, powers }) {
  const attId = normId(attachmentId);
  const record = attId ? await getSeal(attId) : null;
  if (!record?.lockedBy) return { success: false, reason: "This file is not sealed" };
  if (record.issueId !== String(issueId)) return { success: false, reason: "That seal belongs to another issue" };
  if (record.lockedBy !== accountId && !powers.isSteward) {
    return { success: false, reason: "Only the person who sealed this file, or a project admin, can extend it" };
  }
  const add = sanitizeHoldDuration(lockDuration, 0) || (await resolveSealHoldPeriod(null, null));
  const base = Math.max(nowMs(), Date.parse(record.expiresAt || "") || 0);
  const next = {
    ...record,
    expiresAt: new Date(base + add * 1000).toISOString(),
    extendedAt: new Date().toISOString(),
    extendedBy: accountId,
    extensionCount: (Number(record.extensionCount) || 0) + 1,
  };
  await putSeal(next);
  await kvs.delete(jiraLapseKey(sealIdOf(record))).catch(() => {});
  await issueActivity(next, ACTIVITY.EXTENDED, accountId, { addedSeconds: add, expiresAt: next.expiresAt });
  return { success: true, seal: next };
}

// ── resolvers ─────────────────────────────────────────────────────────────────────────────────

const issueSeals = async (req) => {
  const issueId = contextIssueId(req);
  if (!issueId) return { success: false, reason: "Open this from a Jira issue" };
  const settings = await siteSettings();
  const powers = await powersOn(issueId, settings);
  if (!powers.canSee) return { success: false, reason: "You cannot see this issue" };
  const issue = await readIssue(issueId);
  if (!issue) return { success: false, reason: "This issue no longer exists" };
  const viewerId = req.context.accountId;
  const now = nowMs();
  const rows = [];
  for (const att of issue.attachments) {
    const rec = await getSeal(att.id);
    const seal = rec?.lockedBy && rec.issueId === issue.id ? rec : null;
    rows.push({
      ...att,
      seal: seal ? {
        lockedBy: seal.lockedBy, lockedByName: seal.lockedByName, timestamp: seal.timestamp, expiresAt: seal.expiresAt,
        note: seal.note, restoreCount: seal.restoreCount || 0, lastRestoredAt: seal.lastRestoredAt || null,
      } : null,
      row: rowFor({ record: seal, viewerId, powers, nowMs: now }),
      tooLarge: att.size > JIRA_SEAL_MAX_BYTES,
    });
  }
  let history = [];
  try { history = (await readActivity(activityIssuePrefix(issue.id), { limit: 8 })).entries; }
  catch (e) { console.warn("[JIRA-SEAL] history read failed:", e?.message || e); }
  return {
    success: true,
    issue: { id: issue.id, key: issue.key },
    viewer: { accountId: viewerId, ...powers },
    attachments: rows,
    defaults: { holdSeconds: await resolveSealHoldPeriod(null, null), maxBytes: JIRA_SEAL_MAX_BYTES },
    history,
  };
};

const withPowers = (core) => async (req) => {
  const issueId = contextIssueId(req);
  if (!issueId) return { success: false, reason: "Open this from a Jira issue" };
  const settings = await siteSettings();
  const powers = await powersOn(issueId, settings);
  if (!powers.canSee) return { success: false, reason: "You cannot see this issue" };
  const p = req.payload || {};
  return core({
    accountId: req.context.accountId, issueId, attachmentId: p.attachmentId,
    lockDuration: p.lockDuration, note: p.note, reason: p.reason, powers,
  });
};

const sealOnIssue = withPowers(sealJiraAttachment);
const releaseOnIssue = withPowers(releaseJiraAttachment);
const extendOnIssue = withPowers(extendJiraAttachment);

export const actions = [
  ["jira-issue-seals", issueSeals],
  ["jira-seal-attachment", sealOnIssue],
  ["jira-release-attachment", releaseOnIssue],
  ["jira-extend-attachment", extendOnIssue],
];
