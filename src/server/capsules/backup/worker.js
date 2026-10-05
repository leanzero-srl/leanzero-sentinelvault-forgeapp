/*
 * Backup — the queue consumer (`backup-queue`, 900 s) and the hourly sweep. Everything slow runs
 * here: a backup, a restore (verify every file, then write), an import, a move to another space.
 * The UI and REST start a JOB (startJob) and poll it; a save just raises the dirty flag (hook.js); the hourly check (backupSweep) runs at the end of the hourly index cron (boot.js).
 */
import { kvs } from "@forge/kvs";
import { Queue } from "@forge/events";
import { recordActivity } from "../../infra/activity-log.js";
import { acquireLock, releaseLock, withLock } from "../../shared/kvs-lock.js";
import {
  runBackup, runRestore, importExport, assembleStagedImport, ensureBackupPage, readJob, writeJob, discoverBackups,
  STATUS_KEY, SETTINGS_KEY, appInfo,
} from "./engine.js";
import * as store from "./store.js";
import { BACKUP_QUEUE_KEY, DIRTY_KEY } from "./hook.js";

const STALE_MS = 24 * 3600000;
const LEASE_KEY = "backup-lease";
const LEASE_MS = 16 * 60000; // > the 900 s consumer timeout: a killed run frees it on its own

/**
 * One backup / restore / import / move at a time (review 2026-10-02: overlapping runs raced on the
 * index and one run's cleanup deleted another's fresh files). Atomic acquire (shared/kvs-lock.js, which takes over a dead run's lease);
 * a run that cannot get the lease waits up to `waitMs`, then gives up with a plain reason.
 */
export async function withLease(fn, { waitMs = 120000 } = {}) {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const until = Date.now() + waitMs;
  for (;;) {
    // acquireLock takes over a lease older than LEASE_MS: an expired ttl row can linger for hours
    // and still refuse FAIL_IF_EXISTS (measured 2026-10-05, shared/kvs-lock.js).
    if (await acquireLock(LEASE_KEY, LEASE_MS, token)) break;
    if (Date.now() > until) throw new Error("Another backup or restore is running — try again in a few minutes.");
    await new Promise((r) => setTimeout(r, 5000));
  }
  try { return await fn(); }
  finally { await releaseLock(LEASE_KEY, token); }
}
const nowIso = () => new Date().toISOString();
const errText = (e) => String(e?.message || e).slice(0, 300);

/** Site-level audit entry (activity-site- leg). `actor` null = the app (a schedule or a save). */
export async function audit(type, actor, details) {
  await recordActivity({ type, site: true, actor: actor ? { accountId: actor } : null, target: { kind: "site", id: "backup", name: "Backup and restore" }, details });
}

/** Queue one job for the consumer. Returns the job row. */
export async function startJob(kind, payload, actor) {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const job = { id, kind, status: "queued", actor: actor || null, payload: payload || {}, createdAt: nowIso() };
  await writeJob(job);
  await new Queue({ key: BACKUP_QUEUE_KEY }).push({ body: { kind: "job", jobId: id } });
  return job;
}

async function runBackupAndAudit({ reason, actor }) {
  const r = await runBackup({ reason, actor });
  if (!r.ok) await audit("backup.failed", actor, { reason, error: r.reason });
  else if (!r.unchanged || actor) await audit("backup.taken", actor, { reason, generationId: r.generationId, keys: r.keys, bytes: r.bytes, unchanged: !!r.unchanged });
  return r;
}

/** Execute one job by kind, under the lease. Returns the result stored on the job row. */
export async function executeJob(job) {
  return withLease(() => executeJobUnleased(job));
}

async function executeJobUnleased(job) {
  const p = job.payload || {};
  switch (job.kind) {
    case "backup":
      return runBackupAndAudit({ reason: p.reason || "manual", actor: job.actor });
    case "restore": {
      try {
        const r = await runRestore({ pageId: p.pageId, generationId: p.generationId, actor: job.actor, source: p.source || "backup" });
        await kvs.set("backup-decision", { decision: "restored", at: nowIso(), generationId: r.generationId });
        await audit("backup.restored", job.actor, { generationId: r.generationId, createdAt: r.createdAt, written: r.written, failed: r.failed.length, expired: r.expired, paused: r.paused.length });
        // The restored state becomes this install's first backup on the same page.
        await runBackupAndAudit({ reason: "after-restore", actor: null });
        return r;
      } catch (e) {
        await audit("backup.restore-failed", job.actor, { generationId: p.generationId || null, error: errText(e) });
        throw e;
      }
    }
    case "import": {
      const doc = p.importId ? await assembleStagedImport(p.importId, p.total) : p.doc;
      const r = await importExport(doc, { actor: job.actor });
      await audit("backup.imported", job.actor, { generationId: r.generationId, keys: r.keys, from: p.source || "file" });
      return r;
    }
    case "relocate": {
      const before = (await kvs.get(SETTINGS_KEY)) || null;
      const where = await ensureBackupPage({ preferSpaceKey: p.spaceKey });
      // Carry the history: copy every retained generation's files into the new page.
      if (before?.pageId && before.pageId !== where.pageId) await copyGenerations(before.pageId, where.pageId);
      const r = await runBackupAndAudit({ reason: "moved", actor: job.actor });
      // The move succeeded once the new page holds a backup; the old page going to the trash is the
      // tail. A refusal is reported (job result + audit), never swallowed: the old page would
      // otherwise keep a full copy of the setup that nobody knows is there.
      let oldPage = null;
      if (r.ok && before?.pageId && before.pageId !== where.pageId) {
        const d = await store.emptyAndTrashBackupPage(before.pageId).catch((e) => ({ ok: false, state: "unknown", error: errText(e) }));
        oldPage = { pageId: before.pageId, removed: !!d.ok, state: d.state || null };
        if (!d.ok) console.error(`[BACKUP] relocate: the old backup page ${before.pageId} could not be moved to the trash (${d.state || d.error})`);
      }
      await audit("backup.location-set", job.actor, { from: before?.spaceKey || null, to: where.spaceKey, pageId: where.pageId, ...(oldPage && !oldPage.removed ? { oldPageLeft: oldPage.pageId } : {}) });
      return { ...r, spaceKey: where.spaceKey, pageId: where.pageId, ...(oldPage ? { oldPage } : {}) };
    }
    case "delete":
      return deleteAllBackups(job.actor);
    case "privacy-erase":
      return privacyErase();
    default:
      throw new Error(`Unknown backup job ${job.kind}`);
  }
}

/**
 * The backup's part of a privacy erasure (capsules/privacy queues it; review 2026-10-05, C2). The
 * closed account ids wait in `privacy-erase-pending` — never in this job row, which the sweep
 * would otherwise find and "erase" again. A fresh (already scrubbed) generation first, then every
 * older generation that names them outside page content is dropped (engine purge). The ids it
 * handled are cleared only on success; a failure leaves them for the next sweep to re-queue.
 */
async function privacyErase() {
  const PENDING = "privacy-erase-pending";
  const PENDING_LOCK = "privacy-erase-pending-lock";
  const pending = (await kvs.get(PENDING).catch(() => null)) || {};
  const ids = [...new Set(pending.ids || [])];
  // Read-modify-write of the pending list under its own lock (review low 1): a sweep merging a new
  // id at the same moment must not have it dropped by this clear.
  const clear = () => withLock(PENDING_LOCK, 60000, async () => {
    const cur = (await kvs.get(PENDING)) || {};
    const left = (cur.ids || []).filter((i) => !ids.includes(i));
    if (left.length) await kvs.set(PENDING, { ...cur, ids: left, jobId: null }); else await kvs.delete(PENDING);
  });
  if (!ids.length) return { ok: true, skipped: "nothing pending" };
  const settings = await kvs.get(SETTINGS_KEY).catch(() => null);
  const status = await kvs.get(STATUS_KEY).catch(() => null);
  // No backup on this site, or the admin deleted it: nothing to scrub, and nothing is recreated.
  if (!settings?.pageId || status?.deletedAt) { await clear(); return { ok: true, skipped: status?.deletedAt ? "backup deleted" : "no backup on this site", count: ids.length }; }
  // "privacy-erase": the audit says a closed account was erased only for THIS backup (review low 4);
  // the debounced backup after an ordinary sweep keeps reason "privacy".
  const b = await runBackupAndAudit({ reason: "privacy-erase", actor: null });
  if (!b.ok) return { ok: false, reason: `backup failed: ${b.reason || "unknown"}` };
  const { purgeGenerationsMentioning } = await import("./engine.js");
  const p = await purgeGenerationsMentioning(ids);
  if (p.aborted) return { ok: false, reason: `purge aborted: ${p.aborted}` };
  await clear();
  return { ok: true, generationId: b.generationId || null, dropped: p.dropped, kept: p.kept, newestMentions: p.newestMentions, count: ids.length };
}

/**
 * "Delete the backup": every backup page of THIS environment the app can open is emptied (files
 * purged, index removed) and moved to the trash (store.emptyAndTrashBackupPage). Fails LOUDLY
 * (2026-10-04): it used to report success while every delete was refused. The location and status
 * rows are forgotten only once nothing of this environment's backup is left.
 */
export async function deleteAllBackups(actor) {
  const d = await discoverBackups();
  const mine = d.backups.filter((b) => b.sameEnvironment && b.restricted);
  const outcomes = [];
  for (const b of mine) outcomes.push({ pageId: b.pageId, ...(await store.emptyAndTrashBackupPage(b.pageId).catch((e) => ({ ok: false, state: "unknown", error: errText(e) }))) });
  const failed = outcomes.filter((o) => !o.ok);
  const done = outcomes.filter((o) => o.ok).map((o) => o.pageId);
  const purged = outcomes.reduce((n, o) => n + (o.purged || 0), 0);
  if (done.length) await audit("backup.deleted", actor, { pages: done, purged, ...(failed.length ? { failed: failed.map((o) => o.pageId) } : {}) });
  if (failed.length) {
    return { ok: false, deleted: done.length, purged, failedPages: failed.map((o) => o.pageId),
      // Honest about a partial run (review P3): files already purged are gone, so older
      // generations that used them may no longer restore. The newest backup is retaken on the
      // next change; deleting again finishes the job.
      reason: purged
        ? `Delete stopped part-way: ${purged} backup file${purged === 1 ? "" : "s"} were removed, but ${failed.map((o) => (o.failed ? `${o.failed} file(s) on page ${o.pageId}` : `page ${o.pageId} (${o.state || o.error})`)).join(", ")} could not be. Older backups may no longer restore. Try Delete again to finish.`
        : `The backup page${failed.length > 1 ? "s" : ""} ${failed.map((o) => o.pageId).join(", ")} could not be removed (${failed.map((o) => o.state || o.error).join(", ")}). Nothing was deleted; try again.` };
  }
  await kvs.delete(SETTINGS_KEY).catch(() => {});
  await kvs.delete(DIRTY_KEY).catch(() => {}); // a run queued before the delete must not retake it
  // Keep a status row that SAYS the backup was deleted on purpose (2026-10-04, review): with no
  // row at all the hourly check read "never backed up" and took a fresh backup on a NEW page
  // within the hour, undoing the delete an admin makes before uninstalling. Only a change (the
  // save hook) or Back up now brings a backup back, as the delete dialog says.
  await kvs.set(STATUS_KEY, { deletedAt: nowIso(), deletedBy: actor || null }).catch(() => {});
  return { ok: true, deleted: done.length, purged, trashed: true };
}

async function copyGenerations(fromPageId, toPageId) {
  const index = (await store.readIndex(fromPageId))?.value;
  if (!index) return;
  const have = new Set((await store.listAttachments(toPageId)).map((a) => a.title));
  for (const a of await store.listAttachments(fromPageId)) {
    if (have.has(a.title)) continue;
    await store.putFile(toPageId, a.title, await store.getFile(fromPageId, a.id));
  }
  const files = new Map((await store.listAttachments(toPageId)).map((a) => [a.title, a.id]));
  const generations = (index.generations || []).map((g) => ({ ...g, manifestAttachmentId: files.get(g.manifest) || null }));
  await store.writeIndex(toPageId, { ...index, generations });
}

export async function backupConsumer(event) {
  const body = event?.body || event?.payload || {};
  if (body.kind === "backup") {
    // After Delete the backup, a run queued BEFORE the delete finds no dirty flag (the delete clears
    // it) and must not bring the backup back; a change made after the delete re-raises the flag.
    const st = (await kvs.get(STATUS_KEY).catch(() => null)) || {};
    if (st.deletedAt && !(await kvs.get(DIRTY_KEY).catch(() => null))) { console.log(`[BACKUP] ${body.reason || "save"} run skipped: the backup was deleted ${st.deletedAt}`); return; }
    // An automatic run that finds another run going simply skips: the dirty flag / next hour retries.
    try { await withLease(() => runBackupAndAudit({ reason: body.reason || "save", actor: null }), { waitMs: 0 }); }
    catch (e) { console.log(`[BACKUP] automatic run skipped: ${errText(e)}`); }
    return;
  }
  if (body.kind !== "job" || !body.jobId) { console.warn("[BACKUP] consumer: unknown event", JSON.stringify(body).slice(0, 200)); return; }
  const job = await readJob(body.jobId);
  if (!job || job.status !== "queued") { console.warn(`[BACKUP] job ${body.jobId} is ${job?.status || "missing"}; not running`); return; }
  const startedAt = nowIso();
  await writeJob({ ...job, status: "running", startedAt });
  try {
    const result = await executeJob(job);
    const ok = result?.ok !== false;
    await writeJob({ ...job, status: ok ? "done" : "failed", startedAt, finishedAt: nowIso(), result: slim(result), ...(ok ? {} : { error: result?.reason || "failed" }) });
  } catch (e) {
    // A privacy erasure that only met another run's lease (a restore can hold it longer than the
    // 120 s wait) is queued again in 5 minutes rather than waiting for next week's sweep (review low 3).
    if (job.kind === "privacy-erase" && LEASE_BUSY.test(errText(e)) && (job.attempts || 0) < PRIVACY_ERASE_RETRIES) {
      // queuedAt: if the push below fails, the "queued" row goes stale (privacy jobAlive) and the
      // next sweep starts a new job instead of waiting on this one forever (review L1).
      await writeJob({ ...job, status: "queued", queuedAt: nowIso(), attempts: (job.attempts || 0) + 1, lastError: errText(e), startedAt: null });
      await new Queue({ key: BACKUP_QUEUE_KEY }).push({ body: { kind: "job", jobId: job.id }, delayInSeconds: 300 });
      console.warn(`[BACKUP] privacy-erase job ${job.id} re-queued in 5 min (attempt ${(job.attempts || 0) + 1}): ${errText(e)}`);
      return;
    }
    console.error(`[BACKUP] job ${job.id} (${job.kind}) failed:`, e);
    await writeJob({ ...job, status: "failed", startedAt, finishedAt: nowIso(), error: errText(e) });
  }
}

const LEASE_BUSY = /Another backup or restore is running/;
const PRIVACY_ERASE_RETRIES = 12;

/** PURE. Keep a job's stored result small (lists capped). */
export function slim(r) {
  if (!r || typeof r !== "object") return r ?? null;
  const out = { ...r };
  if (Array.isArray(out.paused)) out.paused = out.paused.slice(0, 50).map(({ id, rule, label, where }) => ({ id, rule, label, where }));
  if (Array.isArray(out.failed)) out.failed = out.failed.slice(0, 20);
  return out;
}

/**
 * Hourly: back up when something changed (the flag a save raised and its queued run lost) or
 * when the last check is older than a day. A backup with nothing new records no generation. The
 * sweep only QUEUES the run — the backup itself always runs in the 900 s consumer.
 */
export async function backupSweep(context) {
  try {
    // Found live 2026-10-02: the app is ALSO installed in Jira (JSM Assets scopes), and the hourly
    // cron runs in that installation too — it took empty backups of the Jira install's own (empty)
    // store and registered the Jira installation on the Confluence backup page. Confluence only.
    if (!isConfluenceInstall(context)) { console.log(`[BACKUP] sweep skipped in ${context?.installContext}`); return; }
    const status = (await kvs.get(STATUS_KEY)) || {};
    const dirty = await kvs.get(DIRTY_KEY);
    const reason = sweepReason(status, !!dirty, Date.now());
    if (!reason) return;
    await new Queue({ key: BACKUP_QUEUE_KEY }).push({ body: { kind: "backup", reason } });
  } catch (e) {
    console.error("[BACKUP] sweep failed:", e);
  }
}

/**
 * PURE. Should the hourly check queue a backup, and why: "save" (a change is waiting),
 * "schedule" (none in the last 24 h) or null. A backup DELETED on purpose (`deletedAt`) is not
 * retaken on schedule — only a change or Back up now brings it back.
 */
export function sweepReason(status, dirty, nowMs) {
  if (dirty) return "save";
  if (status?.deletedAt) return null;
  const last = Date.parse(status?.lastCheckAt || status?.lastBackup?.createdAt || "");
  if (Number.isFinite(last) && nowMs - last < STALE_MS) return null;
  return "schedule";
}

/** PURE. Does this invocation belong to the Confluence installation? Unknown context → yes. */
export const isConfluenceInstall = (context) => {
  const ic = String(context?.installContext || "");
  return !ic || ic.includes(":confluence::");
};

export { appInfo };
