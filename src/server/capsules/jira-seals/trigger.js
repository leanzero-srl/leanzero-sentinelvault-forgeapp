/*
 * Jira attachment seals — enforcement (docs/JIRA-SEALS.md). Two product events and one hourly sweep:
 *
 *   avi:jira:deleted:attachment  a sealed file deleted by anyone but its owner is put back from the
 *                                app's copy; the owner deleting it, or a lapsed seal, ends the seal
 *   avi:jira:deleted:issue       Jira deletes an issue's files without one event each; nothing can
 *                                be put back, so every seal of the issue ends with its copy
 *   jiraSealSweep (hourly)       the lapse policy: reminders on the issue, then the release
 *
 * The delete payload carries the person who deleted (`atlassianId`) and the issue — measured on
 * wolfaenpak 2026-10-11 — so no changelog read is needed. Delivery is at-least-once: a duplicate
 * finds the seal already moved to the re-uploaded file (no record under the old id) and does nothing.
 */
import { kvs } from "@forge/kvs";

import {
  ACTIVITY, decideDeletion, isExpired, jiraLapseKey, jiraNoticeKey, lapseCommentAdf, movedRecord, noticeDue,
  normId, restoreCommentAdf, restoreNoticePlan, sealIdOf,
} from "./logic.js";
import { acquireLock, releaseLock } from "../../shared/kvs-lock.js";
import {
  allSeals, appAccountId, dropSeal, getSeal, postIssueComment, putSeal, readCopy, readIssue, sealsOfIssue, uploadToIssue,
} from "./store.js";
import { recordActivity } from "../../infra/activity-log.js";
import { resolveBulletinToggles } from "../../shared/bulletin-flags.js";
import { decideLapseAction, priorNoticeCount, resolveLapsePolicy } from "../../shared/lapse-policy.js";
import { setUntil } from "../../shared/kvs-ttl.js";

const activity = (rec, type, actorId, details = {}) => recordActivity({
  type,
  issueId: rec.issueId,
  projectKey: rec.projectKey,
  actor: actorId ? { accountId: actorId, name: null } : null,
  target: { kind: "jira-attachment", id: rec.attachmentId, name: rec.attachmentName },
  details: { issueKey: rec.issueKey || null, ownerAccountId: rec.lockedBy, ...details },
  version: null,
});

/** Put a deleted sealed file back from the copy; move the seal onto the new attachment. */
export async function restoreSealedFile(record, actorId) {
  const nowMs = Date.now();
  let created;
  try {
    const bytes = await readCopy(record.copyKey, record.sha256);
    created = await uploadToIssue(record.issueId, bytes, record.attachmentName, record.mimeType);
  } catch (e) {
    console.error(`[JIRA-SEAL] restore of ${record.attachmentId} on issue ${record.issueId} failed:`, e?.message || e);
    await activity(record, ACTIVITY.RESTORE_FAILED, actorId, { error: String(e?.message || e).slice(0, 200) });
    // The seal stays (on the dead id) so the owner still sees it; tell the owner on the issue.
    if (await claimNotice(sealIdOf(record))) {
      await postIssueComment(record.issueId, {
        type: "doc", version: 1, content: [{ type: "paragraph", content: [
          { type: "mention", attrs: { id: record.lockedBy } },
          { type: "text", text: ` your sealed file "${record.attachmentName}" was deleted and Sentinel Vault could not put it back (${String(e?.message || e).slice(0, 120)}).` },
        ] }],
      });
    }
    return { ok: false };
  }
  const next = movedRecord(record, created, { actorId, nowMs });
  await putSeal(next);
  // The old id's record and index row go; the copy stays (it is keyed by the first attachment id).
  await dropSeal(record, { keepCopy: true });
  await activity(next, ACTIVITY.RESTORED, actorId, { from: record.attachmentId, to: next.attachmentId, restoreCount: next.restoreCount });

  const flags = await resolveBulletinToggles();
  const plan = restoreNoticePlan(flags, { actorId, ownerId: record.lockedBy });
  if (plan.post && await claimNotice(sealIdOf(next))) {
    await postIssueComment(record.issueId, restoreCommentAdf({
      actorId, ownerId: record.lockedBy, ownerName: record.lockedByName, fileName: record.attachmentName,
      mentionOwner: plan.mention.includes(record.lockedBy),
    }));
  }
  return { ok: true, attachmentId: next.attachmentId };
}

/** One restore comment per seal per window. Claimed BEFORE posting; a lost race posts nothing. */
async function claimNotice(sealId) {
  const key = jiraNoticeKey(sealId);
  try {
    const last = await kvs.get(key);
    if (!noticeDue(last, Date.now())) return false;
    await kvs.set(key, { at: new Date().toISOString() });
    return true;
  } catch (_) { return true; }
}

export async function handleJiraAttachmentDeleted(event) {
  const attId = normId(event?.attachment?.id);
  if (!attId) return { outcome: "ignored" };
  const record = await getSeal(attId);
  if (!record?.lockedBy) return { outcome: "not-sealed" };
  const actorId = event?.atlassianId || null;
  const decision = decideDeletion({
    record, actorId, selfGenerated: event?.selfGenerated, appAccountId: await appAccountId(), nowMs: Date.now(),
  });
  if (decision === "ignore") return { outcome: "ignored" };
  if (decision === "release-owner" || decision === "release-expired") {
    const r = await dropSeal(record);
    if (r.ok) {
      await activity(record, decision === "release-owner" ? ACTIVITY.ENDED : ACTIVITY.AUTO_RELEASED, decision === "release-owner" ? actorId : null,
        { why: decision === "release-owner" ? "owner-deleted" : "expired-and-deleted" });
    }
    return { outcome: decision };
  }
  // Delivery is at-least-once and duplicates can arrive together: without a claim two of them would
  // each upload the copy. The claim is per deleted attachment id; the winner re-reads the seal (a
  // finished twin has already moved it off this id) before restoring.
  const lockKey = `jira-seal-restoring-${attId}`;
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (!(await acquireLock(lockKey, 120000, token))) return { outcome: "in-progress" };
  try {
    const fresh = await getSeal(attId);
    if (!fresh?.lockedBy) return { outcome: "already-handled" };
    const r = await restoreSealedFile(fresh, actorId);
    return { outcome: r.ok ? "restored" : "restore-failed", attachmentId: r.attachmentId || null };
  } finally {
    await releaseLock(lockKey, token);
  }
}

export async function handleJiraIssueDeleted(event) {
  const issueId = normId(event?.issue?.id);
  if (!issueId) return { ended: 0 };
  let ended = 0;
  for (const rec of await sealsOfIssue(issueId)) {
    const r = await dropSeal(rec);
    if (r.ok) {
      ended++;
      await activity(rec, ACTIVITY.ENDED, event?.atlassianId || null, { why: "issue-deleted" });
    }
  }
  return { ended };
}

export async function jiraAttachmentEventTrigger(event) {
  try {
    const type = event?.eventType || "";
    if (type === "avi:jira:deleted:attachment") {
      const r = await handleJiraAttachmentDeleted(event);
      if (r.outcome !== "not-sealed" && r.outcome !== "ignored") console.warn(`[JIRA-SEAL] delete of ${event?.attachment?.id}: ${r.outcome}`);
      return r;
    }
    if (type === "avi:jira:deleted:issue") return await handleJiraIssueDeleted(event);
    return { outcome: "ignored" };
  } catch (e) {
    console.error("[JIRA-SEAL] event handler failed:", e);
    return { outcome: "error" };
  }
}

/**
 * Hourly: the lapse policy for Jira seals — the same reminders-then-release rule the Confluence
 * sweep applies (shared/lapse-policy.js), with issue comments as the reminders. A seal whose issue
 * is gone is ended (nothing left to protect). Never throws.
 */
export async function jiraSealSweep() {
  const out = { checked: 0, reminded: 0, released: 0, ended: 0 };
  try {
    const settings = (await kvs.get("admin-settings-global")) || {};
    if (settings.autoUnlockEnabled === false) return out;
    const { limit, intervalMs } = resolveLapsePolicy(settings);
    const flags = await resolveBulletinToggles(settings);
    const noticeOn = flags.ENABLE_NATIVE_NOTIFICATIONS && flags.ENABLE_EXPIRY_NOTICE;
    const now = Date.now();
    const issueAlive = new Map();
    for await (const { value: rec } of allSeals()) {
      if (!rec?.lockedBy || !isExpired(rec, now)) continue;
      out.checked++;
      if (!issueAlive.has(rec.issueId)) {
        try { issueAlive.set(rec.issueId, !!(await readIssue(rec.issueId))); }
        catch (_) { issueAlive.set(rec.issueId, true); } // unsure → treat as alive, act next hour
      }
      if (!issueAlive.get(rec.issueId)) {
        if ((await dropSeal(rec)).ok) { out.ended++; await activity(rec, ACTIVITY.ENDED, null, { why: "issue-deleted" }); }
        continue;
      }
      const prior = await kvs.get(jiraLapseKey(sealIdOf(rec)));
      const priorCount = priorNoticeCount(prior);
      const decision = decideLapseAction({
        priorCount, lastSentMs: Date.parse(prior?.sentAt || "") || 0, nowMs: now, limit, intervalMs,
      });
      if (decision.action === "wait") continue;
      if (decision.action === "release") {
        if (!(await dropSeal(rec)).ok) continue;
        out.released++;
        await activity(rec, ACTIVITY.AUTO_RELEASED, null, { noticeCount: priorCount, noticeLimit: limit });
        if (noticeOn) await postIssueComment(rec.issueId, lapseCommentAdf({ ownerId: rec.lockedBy, fileName: rec.attachmentName, noticeLimit: limit, released: true }));
        continue;
      }
      let advanced = !noticeOn;
      if (noticeOn) {
        const releaseDate = decision.releaseAtMs ? new Date(decision.releaseAtMs).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : null;
        const r = await postIssueComment(rec.issueId, lapseCommentAdf({
          ownerId: rec.lockedBy, fileName: rec.attachmentName, noticeNumber: decision.noticeNumber, noticeLimit: limit, releaseDate,
        }));
        advanced = r.ok;
        if (r.ok) out.reminded++;
      }
      if (advanced) {
        await setUntil(jiraLapseKey(sealIdOf(rec)), {
          sentAt: new Date(now).toISOString(), count: decision.noticeNumber, attachmentId: rec.attachmentId,
        }, now + (Math.max(limit, 1) + 1) * intervalMs + 7 * 86400000);
      }
    }
  } catch (e) {
    console.error("[JIRA-SEAL] sweep failed:", e);
  }
  if (out.checked) console.warn(`[JIRA-SEAL] sweep: ${JSON.stringify(out)}`);
  return out;
}
