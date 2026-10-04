/*
 * Backup — the queue consumer (`backup-queue`, 900 s) and the hourly sweep. Everything slow runs
 * here: a backup, a restore (verify every file, then write), an import, a move to another space.
 * The UI and REST start a JOB (startJob) and poll it; a save just raises the dirty flag (hook.js); the hourly check (backupSweep) runs at the end of the hourly index cron (boot.js).
 */
import { kvs } from "@forge/kvs";
import { Queue } from "@forge/events";
import { recordActivity } from "../../infra/activity-log.js";
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
 * index and one run's cleanup deleted another's fresh files). Atomic acquire with FAIL_IF_EXISTS;
 * a run that cannot get the lease waits up to `waitMs`, then gives up with a plain reason.
 */
export async function withLease(fn, { waitMs = 120000 } = {}) {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      await kvs.set(LEASE_KEY, { token, at: nowIso() }, { ttl: { value: Math.ceil(LEASE_MS / 1000), unit: "SECONDS" }, keyPolicy: "FAIL_IF_EXISTS" });
      break;
    } catch (e) {
      if (Date.now() > until) throw new Error("Another backup or restore is running — try again in a few minutes.");
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  try { return await fn(); }
  finally { const cur = await kvs.get(LEASE_KEY).catch(() => null); if (cur?.token === token) await kvs.delete(LEASE_KEY).catch(() => {}); }
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
    default:
      throw new Error(`Unknown backup job ${job.kind}`);
  }
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
  await kvs.delete(STATUS_KEY).catch(() => {});
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
    console.error(`[BACKUP] job ${job.id} (${job.kind}) failed:`, e);
    await writeJob({ ...job, status: "failed", startedAt, finishedAt: nowIso(), error: errText(e) });
  }
}

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
    const last = Date.parse(status.lastCheckAt || status.lastBackup?.createdAt || 0) || 0;
    if (!dirty && last && Date.now() - last < STALE_MS) return;
    await new Queue({ key: BACKUP_QUEUE_KEY }).push({ body: { kind: "backup", reason: dirty ? "save" : "schedule" } });
  } catch (e) {
    console.error("[BACKUP] sweep failed:", e);
  }
}

/** PURE. Does this invocation belong to the Confluence installation? Unknown context → yes. */
export const isConfluenceInstall = (context) => {
  const ic = String(context?.installContext || "");
  return !ic || ic.includes(":confluence::");
};

export { appInfo };
