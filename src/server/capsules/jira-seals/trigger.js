/*
 * Jira attachment seals — enforcement (docs/JIRA-SEALS.md). Two product events and one hourly sweep:
 *
 *   avi:jira:deleted:attachment  a sealed file deleted by anyone but its owner is put back from the
 *                                app's copy; the owner deleting it, or a lapsed seal, ends the seal
 *   avi:jira:deleted:issue       Jira deletes an issue's files without one event each; nothing can
 *                                be put back, so the seals become ORPHANS: the copy is kept 30 days
 *                                and the owner can download it from My work
 *   jiraSealSweep (hourly)       retries restores that failed, purges expired orphans, and runs the
 *                                lapse policy (reminders on the issue, then the release)
 *
 * The delete payload carries the person who deleted (`atlassianId`) and the issue — measured on
 * wolfaenpak 2026-10-11 — so no changelog read is needed. Delivery is at-least-once: a duplicate
 * finds the seal already moved to the re-uploaded file (no record under the old id) and does nothing.
 *
 * The one rule this file keeps above all (review 2026-10-11): a sweep never deletes the copy of a
 * file that is not on its issue. A failed restore is retried with backoff and stays visible; only a
 * person (the owner, or an admin with a reason) lets it go.
 */
import { kvs, WhereConditions } from "@forge/kvs";
import { Queue } from "@forge/events";

import {
  ACTIVITY, JIRA_COPY_GC_PREFIX, JIRA_INTENT_PREFIX, JIRA_LOST_PREFIX, JIRA_SWEEP_CURSOR_KEY, JIRA_ORPHAN_KEEP_MS, commentRefusalIsFinal, decideDeletion, isExpired,
  jiraIntentKey, jiraIssueIndexKey, jiraLapseKey, jiraLostKey, jiraNoticeKey, jiraSealKey, lapseCommentAdf, loopTripped,
  movedRecord, nextRetryAt, noticeDue, normId, restoreCommentAdf, restoreNoticePlan, sealIdOf,
} from "./logic.js";
import { acquireLock, releaseLock } from "../../shared/kvs-lock.js";
import {
  appAccountId, deleteCopy, dropSeal, getSeal, postIssueComment, putSeal, readCopy, readIssue, sealsOfIssue, syncIssueProperty, uploadToIssue,
  sealPage,
} from "./store.js";
import { recordActivity } from "../../infra/activity-log.js";
import { resolveBulletinToggles } from "../../shared/bulletin-flags.js";
import { decideLapseAction, priorNoticeCount, resolveLapsePolicy } from "../../shared/lapse-policy.js";
import { setUntil } from "../../shared/kvs-ttl.js";
import { scheduleBackup } from "../backup/hook.js";

const activity = (rec, type, actorId, details = {}) => recordActivity({
  type,
  issueId: rec.issueId,
  actor: actorId ? { accountId: actorId, name: null } : null,
  target: { kind: "jira-attachment", id: rec.attachmentId, name: rec.attachmentName },
  details: { issueKey: rec.issueKey || null, ownerAccountId: rec.lockedBy, ...details },
  version: null,
});

/** The lock that serialises everything that rewrites one seal's record (restore, release, extend). */
export const sealLockKey = (attachmentId) => `jira-seal-restoring-${attachmentId}`;
const token = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Run `fn` holding the seal's lock, or answer busy. Never waits: the caller says "try again". */
export async function withSealLock(attachmentId, fn) {
  const key = sealLockKey(attachmentId);
  const t = token();
  if (!(await acquireLock(key, 120000, t))) return { busy: true };
  try { return { busy: false, value: await fn() }; } finally { await releaseLock(key, t); }
}

/** One comment per seal per window. Claimed BEFORE posting; given back if the post failed. */
async function claimNotice(sealId) {
  const key = jiraNoticeKey(sealId);
  try {
    if (!noticeDue(await kvs.get(key), Date.now())) return null;
    await kvs.set(key, { at: new Date().toISOString() });
    return key;
  } catch (_) { return key; }
}
async function postOnce(sealId, issueId, adf) {
  const claim = await claimNotice(sealId);
  if (!claim) return;
  const r = await postIssueComment(issueId, adf);
  if (!r.ok) await kvs.delete(claim).catch(() => {});
}

/** Record (or update) a seal whose file is not on its issue. */
async function markLost(record, { reason, error = null, retryable }) {
  const key = jiraLostKey(record.attachmentId);
  const prev = (await kvs.get(key).catch(() => null)) || {};
  const attempts = (Number(prev.attempts) || 0) + (reason === "failed" ? 1 : 0);
  const nowMs = Date.now();
  await kvs.set(key, {
    attachmentId: record.attachmentId, sealId: sealIdOf(record), issueId: record.issueId, issueKey: record.issueKey || null,
    reason, error: error ? String(error).slice(0, 200) : null, attempts, since: prev.since || new Date(nowMs).toISOString(),
    nextAt: retryable ? nextRetryAt(Math.max(0, attempts - 1), nowMs) : null, // first retry an hour after the first failure
  });
}

/**
 * Put a deleted sealed file back from the copy; move the seal onto the new attachment. Crash-safe:
 * an intent row is written before the upload, so a retry after a crash ADOPTS the file the dead run
 * uploaded (same name and size, the app's account, after the intent) instead of uploading another.
 */
export async function restoreSealedFile(record, actorId) {
  const nowMs = Date.now();
  const sid = sealIdOf(record);
  let created = null;
  try {
    const intent = await kvs.get(jiraIntentKey(sid));
    if (intent?.fromAttachmentId === record.attachmentId) {
      const issue = await readIssue(record.issueId);
      const app = await appAccountId();
      const since = Date.parse(intent.startedAt) - 5000;
      for (const a of (issue?.attachments || []).slice().reverse()) {
        if (a.filename === record.attachmentName && a.author?.accountId === app && Date.parse(a.created) >= since && a.size === record.size && !(await getSeal(a.id))) {
          created = { id: a.id, filename: a.filename, size: a.size };
          console.warn(`[JIRA-SEAL] adopting ${a.id}, uploaded by an earlier restore of ${record.attachmentId}`);
          break;
        }
      }
    }
    if (!created) {
      const bytes = await readCopy(record.copyKey, record.sha256);
      await kvs.set(jiraIntentKey(sid), { fromAttachmentId: record.attachmentId, startedAt: new Date().toISOString() });
      created = await uploadToIssue(record.issueId, bytes, record.attachmentName, record.mimeType);
    }
  } catch (e) {
    const error = String(e?.message || e).slice(0, 200);
    console.error(`[JIRA-SEAL] restore of ${record.attachmentId} on issue ${record.issueId} failed:`, error);
    await markLost(record, { reason: "failed", error, retryable: true });
    await activity(record, ACTIVITY.RESTORE_FAILED, actorId, { error });
    const flags = await resolveBulletinToggles();
    if (flags.ENABLE_NATIVE_NOTIFICATIONS) {
      await postOnce(sid, record.issueId, { type: "doc", version: 1, content: [{ type: "paragraph", content: [
        { type: "mention", attrs: { id: record.lockedBy } },
        { type: "text", text: ` your sealed file "${record.attachmentName}" was deleted and Sentinel Vault could not put it back yet (${error.slice(0, 120)}). It keeps the copy and tries again; the Sentinel Vault panel on this issue has a Put it back button.` },
      ] }] });
    }
    return { ok: false, error };
  }
  const next = movedRecord(record, created, { actorId, nowMs });
  await putSeal(next);
  // The old id's record and index row go; the copy stays (it is keyed by the first attachment id).
  const moved = await dropSeal(record, { keepCopy: true });
  if (!moved.ok) console.error(`[JIRA-SEAL] seal moved to ${next.attachmentId} but the old record ${record.attachmentId} could not be removed`);
  await kvs.delete(jiraLostKey(record.attachmentId)).catch(() => {});
  await kvs.delete(jiraIntentKey(sid)).catch(() => {});
  await syncIssueProperty(next.issueId, { add: next, removeId: record.attachmentId });
  await activity(next, ACTIVITY.RESTORED, actorId, { from: record.attachmentId, to: next.attachmentId, restoreCount: next.restoreCount });
  await scheduleBackup("jira-restore"); // the seal now lives under a new id: the backup must learn it

  const flags = await resolveBulletinToggles();
  const plan = restoreNoticePlan(flags, { actorId, ownerId: record.lockedBy });
  if (plan.post) {
    await postOnce(sid, record.issueId, restoreCommentAdf({
      actorId, ownerId: record.lockedBy, ownerName: record.lockedByName, fileName: record.attachmentName,
      mentionOwner: plan.mention.includes(record.lockedBy),
    }));
  }
  return { ok: true, attachmentId: next.attachmentId };
}

/**
 * Put the file of the seal recorded under `attId` back, holding the seal's lock. Delivery is
 * at-least-once and duplicates can arrive together: the winner re-reads the seal (a finished twin
 * has already moved it off this id). Also the panel's "Put it back" and the sweep's retries.
 */
export async function restoreWithClaim(attId, actorId) {
  const r = await withSealLock(attId, async () => {
    const fresh = await getSeal(attId);
    if (!fresh?.lockedBy || fresh.issueDeletedAt) return { outcome: "already-handled" };
    const res = await restoreSealedFile(fresh, actorId);
    return { outcome: res.ok ? "restored" : "restore-failed", attachmentId: res.attachmentId || null, error: res.error || null };
  });
  return r.busy ? { outcome: "in-progress" } : r.value;
}

export async function handleJiraAttachmentDeleted(event) {
  const attId = normId(event?.attachment?.id);
  if (!attId) return { outcome: "ignored" };
  const record = await getSeal(attId);
  if (!record?.lockedBy || record.issueDeletedAt) return { outcome: "not-sealed" };
  const actorId = event?.atlassianId || null;
  const nowMs = Date.now();
  const decision = decideDeletion({ record, actorId, selfGenerated: event?.selfGenerated, appAccountId: await appAccountId(), nowMs });
  if (decision === "ignore") return { outcome: "ignored" };
  if (decision === "release-owner" || decision === "release-expired") {
    const r = await withSealLock(attId, async () => {
      const fresh = await getSeal(attId);
      if (!fresh?.lockedBy) return { ok: false };
      return dropSeal(fresh);
    });
    if (!r.busy && r.value?.ok) {
      await syncIssueProperty(record.issueId, { removeId: record.attachmentId });
      await activity(record, decision === "release-owner" ? ACTIVITY.ENDED : ACTIVITY.AUTO_RELEASED, decision === "release-owner" ? actorId : null,
        { why: decision === "release-owner" ? "owner-deleted" : "expired-and-deleted" });
    }
    return { outcome: decision };
  }
  // Delete-loop breaker (review 2026-10-11, D3): an Automation rule that deletes a file type would
  // otherwise meet each restore with another delete, forever — each round a full download and upload.
  if (loopTripped(record.restores, nowMs)) {
    await markLost(record, { reason: "loop", retryable: false });
    await activity(record, ACTIVITY.RESTORE_FAILED, actorId, { error: "deleted again each time it was put back, so Sentinel Vault stopped" });
    const flags = await resolveBulletinToggles();
    if (flags.ENABLE_NATIVE_NOTIFICATIONS || flags.NOTIFY_EDITOR_ON_REVERT) {
      // Its own comment window: the restore comments of the loop just used the seal's, and this is
      // the one message that explains why the file stays gone.
      await postOnce(`${sealIdOf(record)}-loop`, record.issueId, { type: "doc", version: 1, content: [{ type: "paragraph", content: [
        ...(actorId ? [{ type: "mention", attrs: { id: actorId } }, { type: "text", text: " " }] : []),
        { type: "text", text: `"${record.attachmentName}" is sealed in Sentinel Vault and was deleted again each time it was put back, so Sentinel Vault stopped putting it back. If an automation deletes it, exclude this file. ` },
        ...(flags.ENABLE_NATIVE_NOTIFICATIONS
          ? [{ type: "mention", attrs: { id: record.lockedBy } }, { type: "text", text: " can put it back from the Sentinel Vault panel on this issue." }]
          : [{ type: "text", text: "Its owner can put it back from the Sentinel Vault panel on this issue." }]),
      ] }] });
    }
    return { outcome: "loop-stopped" };
  }
  // The restore moves up to 25 MB twice: it runs in the queue consumer (300 s), not in this trigger.
  // A push that fails falls back to restoring here — a slow restore beats none.
  try {
    await new Queue({ key: RESTORE_QUEUE }).push({ body: { attachmentId: attId, actorId } });
    return { outcome: "queued" };
  } catch (e) {
    console.error("[JIRA-SEAL] restore queue push failed, restoring inline:", e?.message || e);
    return restoreWithClaim(attId, actorId);
  }
}

export const RESTORE_QUEUE = "jira-restore-queue";

/** The queue consumer: one restore per event (duplicates are absorbed by the seal's lock). */
export async function jiraRestoreConsumer(event) {
  const body = event?.body || event?.payload || {};
  const attId = normId(body.attachmentId);
  if (!attId) return;
  const r = await restoreWithClaim(attId, body.actorId || null);
  console.warn(`[JIRA-SEAL] restore of ${attId}: ${r.outcome}${r.attachmentId ? ` → ${r.attachmentId}` : ""}`);
}

/**
 * The issue is gone, and with it every file on it. Nothing can be put back; the seals become
 * orphans: the record and the copy are KEPT for 30 days (D2: deleting the issue must not quietly
 * destroy the protected file), and the owner sees it on My work and can download the copy.
 */
export async function handleJiraIssueDeleted(event) {
  const issueId = normId(event?.issue?.id);
  if (!issueId) return { orphaned: 0 };
  let orphaned = 0;
  const nowMs = Date.now();
  for (const rec of await sealsOfIssue(issueId)) {
    const r = await withSealLock(rec.attachmentId, async () => {
      const fresh = await getSeal(rec.attachmentId);
      if (!fresh?.lockedBy || fresh.issueDeletedAt) return false;
      await kvs.set(jiraSealKey(fresh.attachmentId), {
        ...fresh, issueDeletedAt: new Date(nowMs).toISOString(), issueDeletedBy: event?.atlassianId || null,
        orphanUntil: new Date(nowMs + JIRA_ORPHAN_KEEP_MS).toISOString(),
      });
      await kvs.delete(jiraIssueIndexKey(issueId, fresh.attachmentId)).catch(() => {});
      await kvs.delete(jiraLostKey(fresh.attachmentId)).catch(() => {});
      return true;
    });
    if (!r.busy && r.value) {
      orphaned++;
      await activity(rec, ACTIVITY.ENDED, event?.atlassianId || null, { why: "issue-deleted" });
    }
  }
  return { orphaned };
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

async function* scanPrefix(prefix, maxPages = 20) {
  let query = kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100);
  for (let i = 0; i < maxPages; i++) {
    const { results, nextCursor } = await query.getMany();
    for (const r of results || []) yield r;
    if (!nextCursor) return;
    query = kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100).cursor(nextCursor);
  }
}

/**
 * Hourly (rides the index cron, after the backup check). Three passes, each acting only on a
 * strong re-read of the row, inside a time budget, under one lock so a second firing cannot double
 * a reminder:
 *   1. restores that failed (jira-seal-lost-, reason "failed") are retried when due, and crashed
 *      restores (an intent row older than 5 min) are finished — adopting the upload if it landed
 *   2. orphans (their issue was deleted) whose 30 days are over are ended, copy included
 *   3. the lapse policy on live seals: reminders, then the release. A seal whose file is lost or
 *      whose issue is gone is never released by the lapse policy.
 */
export async function jiraSealSweep({ budgetMs = 100000 } = {}) {
  const out = { retried: 0, restored: 0, orphansEnded: 0, checked: 0, reminded: 0, released: 0, copiesDeleted: 0 };
  const t0 = Date.now();
  const left = () => Date.now() - t0 < budgetMs;
  const lock = token();
  if (!(await acquireLock("jira-seal-sweep-lock", 15 * 60000, lock))) return { ...out, skipped: "running" };
  try {
    const now = Date.now();
    // 1. retries
    for await (const { key } of scanPrefix(JIRA_LOST_PREFIX)) {
      if (!left()) break;
      const lost = await kvs.get(key);
      if (!lost || lost.reason !== "failed" || !lost.nextAt || lost.nextAt > now) continue;
      out.retried++;
      const r = await restoreWithClaim(lost.attachmentId, null);
      if (r.outcome === "restored") out.restored++;
      const settled = r.outcome === "already-handled"; // the seal is gone or moved: nothing left to retry
      if (settled) await kvs.delete(key).catch(() => {});
    }
    for await (const { key } of scanPrefix(JIRA_INTENT_PREFIX)) {
      if (!left()) break;
      const intent = await kvs.get(key);
      if (!intent?.fromAttachmentId || now - Date.parse(intent.startedAt) < 5 * 60000) continue;
      const rec = await getSeal(intent.fromAttachmentId);
      if (!rec?.lockedBy) { await kvs.delete(key).catch(() => {}); continue; }
      out.retried++;
      if ((await restoreWithClaim(intent.fromAttachmentId, null)).outcome === "restored") out.restored++;
    }

    // 2 + 3
    const settings = (await kvs.get("admin-settings-global")) || {};
    const lapseOn = settings.autoUnlockEnabled !== false;
    const { limit, intervalMs } = resolveLapsePolicy(settings);
    const flags = await resolveBulletinToggles(settings);
    const noticeOn = flags.ENABLE_NATIVE_NOTIFICATIONS && flags.ENABLE_EXPIRY_NOTICE;
    // The seal list is read a page at a time from where the last run stopped (a site with more
    // seals than one run's budget is covered over several runs instead of always from the top).
    // A page cut short by the budget is read again next time: every step below is idempotent.
    const visit = async (key) => {
      const rec = await kvs.get(key);
      if (!rec?.lockedBy) return;
      if (rec.issueDeletedAt) {
        if (Date.parse(rec.orphanUntil) <= now) {
          const r = await withSealLock(rec.attachmentId, () => dropSeal(rec));
          if (!r.busy && r.value?.ok) out.orphansEnded++;
        }
        return;
      }
      if (!lapseOn || !isExpired(rec, now)) return;
      if (await kvs.get(jiraLostKey(rec.attachmentId))) return; // its file is not on the issue
      out.checked++;
      const sid = sealIdOf(rec);
      const prior = await kvs.get(jiraLapseKey(sid));
      const priorCount = priorNoticeCount(prior);
      const decision = decideLapseAction({ priorCount, lastSentMs: Date.parse(prior?.sentAt || "") || 0, nowMs: now, limit, intervalMs });
      if (decision.action === "wait") return;
      if (decision.action === "release") {
        const r = await withSealLock(rec.attachmentId, async () => {
          const fresh = await getSeal(rec.attachmentId);
          if (!fresh?.lockedBy || !isExpired(fresh, Date.now())) return { ok: false }; // extended meanwhile
          return dropSeal(fresh);
        });
        if (r.busy || !r.value?.ok) return;
        await syncIssueProperty(rec.issueId, { removeId: rec.attachmentId });
        out.released++;
        await activity(rec, ACTIVITY.AUTO_RELEASED, null, { noticeCount: priorCount, noticeLimit: limit });
        if (noticeOn) await postIssueComment(rec.issueId, lapseCommentAdf({ ownerId: rec.lockedBy, fileName: rec.attachmentName, noticeLimit: limit, released: true }));
        return;
      }
      // A refusal Jira will repeat (no permission to comment, issue not editable, issue gone: 4xx)
      // counts like comments switched off — the countdown advances. Only a 5xx / 429 / network
      // error holds it (Confluence parity: a deliberate non-post advances, a transport failure holds).
      let advanced = !noticeOn;
      if (noticeOn) {
        const releaseDate = decision.releaseAtMs ? new Date(decision.releaseAtMs).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : null;
        const r = await postIssueComment(rec.issueId, lapseCommentAdf({
          ownerId: rec.lockedBy, fileName: rec.attachmentName, noticeNumber: decision.noticeNumber, noticeLimit: limit, releaseDate,
        }));
        advanced = r.ok || commentRefusalIsFinal(r.status);
        if (r.ok) out.reminded++;
      }
      if (advanced) {
        await setUntil(jiraLapseKey(sid), {
          sentAt: new Date(now).toISOString(), count: decision.noticeNumber, attachmentId: rec.attachmentId,
        }, now + (Math.max(limit, 1) + 1) * intervalMs + 7 * 86400000);
      }
    };
    let cursor = (await kvs.get(JIRA_SWEEP_CURSOR_KEY).catch(() => null))?.cursor || undefined;
    for (let pages = 0; pages < 500 && left(); pages++) {
      let page;
      try { page = await sealPage(cursor); }
      catch (e) {
        if (!cursor) throw e;
        console.warn("[JIRA-SEAL] sweep cursor refused, starting from the top:", e?.message || e);
        cursor = undefined;
        continue;
      }
      let whole = true;
      for (const { key } of page.results || []) {
        if (!left()) { whole = false; break; }
        await visit(key);
      }
      if (!whole) break; // keep `cursor` at this page's start
      cursor = page.nextCursor || undefined;
      if (!cursor) break;
    }
    if (cursor) await kvs.set(JIRA_SWEEP_CURSOR_KEY, { cursor, at: new Date().toISOString() }).catch(() => {});
    else await kvs.delete(JIRA_SWEEP_CURSOR_KEY).catch(() => {});

    // 4. copies whose delete failed: retried, never one a live seal still uses (under its lock).
    for await (const { key } of scanPrefix(JIRA_COPY_GC_PREFIX)) {
      if (!left()) break;
      const row = await kvs.get(key);
      if (!row?.copyKey) { await kvs.delete(key).catch(() => {}); continue; }
      const origId = String(row.copyKey).replace(/^jira-seal\//, "");
      const r = await withSealLock(origId, async () => {
        const live = await getSeal(origId);
        if (live?.lockedBy && live.copyKey === row.copyKey) {
          await kvs.delete(key).catch(() => {}); // the copy is a live seal's again: never delete it
          return "kept";
        }
        return (await deleteCopy(row.copyKey)) ? "deleted" : "failed";
      });
      if (!r.busy && r.value === "deleted") out.copiesDeleted++;
    }

  } catch (e) {
    console.error("[JIRA-SEAL] sweep failed:", e);
  } finally {
    await releaseLock("jira-seal-sweep-lock", lock);
  }
  if (out.retried || out.checked || out.orphansEnded || out.copiesDeleted) console.warn(`[JIRA-SEAL] sweep: ${JSON.stringify(out)}`);
  return out;
}
