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
  ACTIVITY, JIRA_SEAL_MAX_BYTES, buildSealRecord, forcedCommentAdf, isExpired, jiraCopyKey, jiraIntentKey, jiraLapseKey, jiraLostKey, jiraQueuedKey, normId, rowFor, sealIdOf, viewerPowers,
} from "./logic.js";
import {
  callerPermissions, copyDownloadUrl, downloadAttachment, dropSeal, getSeal, postIssueComment, putSeal, readIssue, sealsOfIssue, sealsOwnedBy, sha256Hex, storeCopy, syncIssueProperty, userName,
} from "./store.js";
import { resolveSealHoldPeriod } from "../sealing/logic.js";
import { sanitizeHoldDuration } from "../../shared/baseline.js";
import { validateReleaseReason } from "../../shared/release-reason.js";
import { resolveBulletinToggles } from "../../shared/bulletin-flags.js";
import { withSealLock } from "./trigger.js";
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
  actor: actor ? { accountId: actor, name: null } : null,
  target: { kind: "jira-attachment", id: rec.attachmentId, name: rec.attachmentName },
  details: { issueKey: rec.issueKey || null, ownerAccountId: rec.lockedBy, ...details },
  version: null,
});

const BUSY = "Sentinel Vault is putting this file back right now — try again in a moment";

/**
 * A non-owner's steward power over a seal. `powers` is the caller's power on the issue AS IT IS;
 * when the issue has since moved to another project, the caller must ALSO be an admin of the project
 * the seal was set in (review 2026-10-11, D4): otherwise moving an issue into a project you
 * administer would hand you the seals of the project it left.
 */
async function isStewardOfSeal(record, powers, stewardOfProject) {
  if (!powers.isSteward) return false;
  if (!record.projectId || typeof stewardOfProject !== "function") return true;
  const issue = await readIssue(record.issueId).catch(() => null);
  if (!issue?.project?.id || issue.project.id === record.projectId) return true;
  return (await stewardOfProject(record.projectId, record.projectKey)) === true;
}

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
    // goes (and its copy — a fresh one is taken below), recorded as ended.
    const r = await withSealLock(attId, async () => {
      const fresh = await getSeal(attId);
      if (fresh?.lockedBy && !isExpired(fresh, nowMs())) return { ok: false, extended: true };
      return fresh ? dropSeal(fresh) : { ok: true };
    });
    if (r.busy) return { success: false, reason: BUSY };
    if (r.value?.extended) return { success: false, reason: "This file is already sealed by someone else" };
    if (!r.value?.ok) return { success: false, reason: r.value?.reason || "Could not end the lapsed seal" };
    await issueActivity(existing, ACTIVITY.ENDED, accountId, { why: "replaced-after-expiry" });
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
  // FAIL_IF_EXISTS: two people sealing the same file at once must not both be told "sealed".
  if (!(await putSeal(record, { create: true }))) return { success: false, reason: "Someone sealed this file a moment ago — refresh to see who" };
  await syncIssueProperty(record.issueId, { add: record });
  await issueActivity(record, ACTIVITY.SEALED, accountId, { holdSeconds, size: record.size });
  return { success: true, seal: record };
}

export async function releaseJiraAttachment({ accountId, issueId, attachmentId, reason, powers, stewardOfProject }) {
  const attId = normId(attachmentId);
  const record = attId ? await getSeal(attId) : null;
  if (!record?.lockedBy) return { success: false, reason: "This file is not sealed" };
  if (record.issueId !== String(issueId)) return { success: false, reason: "That seal belongs to another issue" };
  const isOwner = record.lockedBy === accountId;
  let forcedReason = null;
  if (!isOwner) {
    if (!(await isStewardOfSeal(record, powers, stewardOfProject))) return { success: false, reason: "Only the person who sealed this file, or a project admin, can release it" };
    const v = validateReleaseReason(reason);
    if (!v.ok) return { success: false, reason: v.error };
    forcedReason = v.reason;
  }
  const locked = await withSealLock(attId, async () => {
    const fresh = await getSeal(attId);
    if (!fresh?.lockedBy || fresh.lockedBy !== record.lockedBy) return { ok: false, reason: "This file is not sealed" };
    return dropSeal(fresh);
  });
  if (locked.busy) return { success: false, reason: BUSY };
  const dropped = locked.value;
  if (!dropped.ok) return { success: false, reason: dropped.reason };
  await syncIssueProperty(record.issueId, { removeId: record.attachmentId });
  await issueActivity(record, isOwner ? ACTIVITY.RELEASED : ACTIVITY.FORCED, accountId, forcedReason ? { forced: true, reason: forcedReason } : {});
  // The Confluence force release tells the owner (mailStewardOverrideNotice); so does this one, on
  // the issue, when the site posts Sentinel Vault comments at all.
  if (forcedReason) {
    const flags = await resolveBulletinToggles();
    if (flags.ENABLE_NATIVE_NOTIFICATIONS) {
      await postIssueComment(record.issueId, forcedCommentAdf({ ownerId: record.lockedBy, actorId: accountId, fileName: record.attachmentName, reason: forcedReason }));
    }
  }
  return { success: true };
}

export async function extendJiraAttachment({ accountId, issueId, attachmentId, lockDuration, powers, stewardOfProject }) {
  const attId = normId(attachmentId);
  const record = attId ? await getSeal(attId) : null;
  if (!record?.lockedBy) return { success: false, reason: "This file is not sealed" };
  if (record.issueId !== String(issueId)) return { success: false, reason: "That seal belongs to another issue" };
  if (record.lockedBy !== accountId && !(await isStewardOfSeal(record, powers, stewardOfProject))) {
    return { success: false, reason: "Only the person who sealed this file, or a project admin, can extend it" };
  }
  const add = sanitizeHoldDuration(lockDuration, 0) || (await resolveSealHoldPeriod(null, null));
  const locked = await withSealLock(attId, async () => {
    const fresh = await getSeal(attId);
    if (!fresh?.lockedBy) return null;
    const base = Math.max(nowMs(), Date.parse(fresh.expiresAt || "") || 0);
    const next = {
      ...fresh,
      expiresAt: new Date(base + add * 1000).toISOString(),
      extendedAt: new Date().toISOString(),
      extendedBy: accountId,
      extensionCount: (Number(fresh.extensionCount) || 0) + 1,
    };
    await putSeal(next);
    return next;
  });
  if (locked.busy) return { success: false, reason: BUSY };
  const next = locked.value;
  if (!next) return { success: false, reason: "This file is not sealed" };
  await syncIssueProperty(next.issueId, { add: next });
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
  // A seal whose file is no longer on the issue: the delete was not undone (the copy could not be put
  // back, or a restore is running right now). It stays visible so its owner can see it and anyone who
  // may edit the issue can try again — the app still holds the copy.
  const listed = new Set(issue.attachments.map((a) => a.id));
  for (const seal of await sealsOfIssue(issue.id)) {
    if (listed.has(seal.attachmentId)) continue;
    const info = await kvs.get(jiraLostKey(seal.attachmentId)).catch(() => null);
    // No failure recorded and a put-back queued or running: "Being put back", not "Not put back".
    const restoring = !info && !!((await kvs.get(jiraQueuedKey(seal.attachmentId)).catch(() => null))
      || (await kvs.get(jiraIntentKey(sealIdOf(seal))).catch(() => null)));
    rows.push({
      id: seal.attachmentId, filename: seal.attachmentName, size: seal.size, mimeType: seal.mimeType, lost: true, restoring,
      lostInfo: info ? { reason: info.reason, error: info.error || null, nextAt: info.nextAt || null, attempts: info.attempts || 0 } : null,
      seal: { lockedBy: seal.lockedBy, lockedByName: seal.lockedByName, timestamp: seal.timestamp, expiresAt: seal.expiresAt, note: seal.note, restoreCount: seal.restoreCount || 0, lastRestoredAt: seal.lastRestoredAt || null },
      row: rowFor({ record: seal, viewerId, powers, nowMs: now, lost: true, restoring }),
      tooLarge: false,
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
    stewardOfProject: async (projectId) => viewerPowers(await callerPermissions(null, { projectId }), { allowAdminOverride: settings?.allowAdminOverride }).isSteward,
  });
};

// "Try again" on a seal whose file was deleted and could not be put back. Anyone who may edit the
// issue may ask; the bytes come from the copy taken at seal time, never from the caller.
export async function retryJiraRestore({ accountId, issueId, attachmentId, powers }) {
  const attId = normId(attachmentId);
  const record = attId ? await getSeal(attId) : null;
  if (!record?.lockedBy) return { success: false, reason: "This file is not sealed" };
  if (record.issueId !== String(issueId)) return { success: false, reason: "That seal belongs to another issue" };
  if (!powers.canEdit) return { success: false, reason: "You need permission to edit this issue" };
  const issue = await readIssue(issueId);
  if (!issue) return { success: false, reason: "This issue no longer exists" };
  if (issue.attachments.some((a) => a.id === attId)) return { success: false, reason: "The file is already on the issue" };
  const { restoreWithClaim } = await import("./trigger.js");
  const r = await restoreWithClaim(attId, accountId);
  if (r.outcome === "restored") return { success: true, attachmentId: r.attachmentId };
  if (r.outcome === "in-progress") return { success: false, reason: "Sentinel Vault is putting it back right now — refresh in a moment" };
  if (r.outcome === "already-handled") return { success: true };
  return { success: false, reason: `Still could not put it back: ${r.error || "try again later"}` };
}

// My work: the files the CALLER holds sealed on Jira (their own index prefix — a payload names nothing).
const myJiraSeals = async (req) => {
  const accountId = req?.context?.accountId;
  if (!accountId) return { success: false, reason: "Not signed in" };
  const now = nowMs();
  const seals = [];
  for (const r of (await sealsOwnedBy(accountId)).slice(0, 200)) {
    const lost = r.issueDeletedAt ? null : await kvs.get(jiraLostKey(r.attachmentId)).catch(() => null);
    seals.push({
      attachmentId: r.attachmentId, attachmentName: r.attachmentName, issueKey: r.issueKey, issueId: r.issueId,
      expiresAt: r.expiresAt, expired: isExpired(r, now), restoreCount: r.restoreCount || 0,
      issueDeletedAt: r.issueDeletedAt || null, orphanUntil: r.orphanUntil || null, lost: !!lost,
    });
  }
  return { success: true, seals };
};

// The kept copy of a sealed file whose ISSUE was deleted (an orphan): its owner may download it.
// Owner only — there is no issue left to read anyone else's permission on.
const copyDownload = async (req) => {
  const accountId = req?.context?.accountId;
  const rec = await getSeal(normId(req?.payload?.attachmentId) || "x");
  if (!rec?.lockedBy || rec.lockedBy !== accountId) return { success: false, reason: "Only the person who sealed this file can download its copy" };
  if (!rec.issueDeletedAt) return { success: false, reason: "The file is still on its issue — download it from there" };
  const url = await copyDownloadUrl(rec.copyKey).catch(() => null);
  if (!url) return { success: false, reason: "The copy could not be found" };
  return { success: true, url, fileName: rec.attachmentName };
};

const sealOnIssue = withPowers(sealJiraAttachment);
const releaseOnIssue = withPowers(releaseJiraAttachment);
const extendOnIssue = withPowers(extendJiraAttachment);
const retryOnIssue = withPowers(retryJiraRestore);

export const actions = [
  ["jira-issue-seals", issueSeals],
  ["list-my-jira-seals", myJiraSeals],
  ["jira-copy-download", copyDownload],
  ["jira-seal-attachment", sealOnIssue],
  ["jira-release-attachment", releaseOnIssue],
  ["jira-extend-attachment", extendOnIssue],
  ["jira-retry-restore", retryOnIssue],
];
