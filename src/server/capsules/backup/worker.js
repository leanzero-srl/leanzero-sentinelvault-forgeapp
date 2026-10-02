/*
 * Backup — the queue consumer (`backup-queue`, 900 s) and the hourly sweep. Everything slow runs
 * here: a backup, a restore (verify every file, then write), an import, a move to another space.
 * The UI and REST start a JOB (jobs.js) and poll it; a save just raises the dirty flag (hook.js).
 */
import { kvs } from "@forge/kvs";
import { Queue } from "@forge/events";
import { recordActivity } from "../../infra/activity-log.js";
import {
  runBackup, runRestore, importExport, assembleStagedImport, ensureBackupPage, readJob, writeJob,
  STATUS_KEY, SETTINGS_KEY, appInfo,
} from "./engine.js";
import * as store from "./store.js";
import { BACKUP_QUEUE_KEY, DIRTY_KEY } from "./hook.js";

const STALE_MS = 24 * 3600000;
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

/** Execute one job by kind. Returns the result stored on the job row. */
export async function executeJob(job) {
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
      if (r.ok && before?.pageId && before.pageId !== where.pageId) await store.deletePage(before.pageId).catch(() => {});
      await audit("backup.location-set", job.actor, { from: before?.spaceKey || null, to: where.spaceKey, pageId: where.pageId });
      return { ...r, spaceKey: where.spaceKey, pageId: where.pageId };
    }
    default:
      throw new Error(`Unknown backup job ${job.kind}`);
  }
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
  if (body.kind === "backup") { await runBackupAndAudit({ reason: body.reason || "save", actor: null }); return; }
  if (body.kind !== "job" || !body.jobId) { console.warn("[BACKUP] consumer: unknown event", JSON.stringify(body).slice(0, 200)); return; }
  const job = await readJob(body.jobId);
  if (!job || job.status !== "queued") { console.warn(`[BACKUP] job ${body.jobId} is ${job?.status || "missing"}; not running`); return; }
  await writeJob({ ...job, status: "running", startedAt: nowIso() });
  try {
    const result = await executeJob(job);
    const ok = result?.ok !== false;
    await writeJob({ ...job, status: ok ? "done" : "failed", startedAt: job.startedAt || null, finishedAt: nowIso(), result: slim(result), ...(ok ? {} : { error: result?.reason || "failed" }) });
  } catch (e) {
    console.error(`[BACKUP] job ${job.id} (${job.kind}) failed:`, e);
    await writeJob({ ...job, status: "failed", finishedAt: nowIso(), error: errText(e) });
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
export async function backupSweep() {
  try {
    const status = (await kvs.get(STATUS_KEY)) || {};
    const dirty = await kvs.get(DIRTY_KEY);
    const last = Date.parse(status.lastCheckAt || status.lastBackup?.createdAt || 0) || 0;
    if (!dirty && last && Date.now() - last < STALE_MS) return;
    await new Queue({ key: BACKUP_QUEUE_KEY }).push({ body: { kind: "backup", reason: dirty ? "save" : "schedule" } });
  } catch (e) {
    console.error("[BACKUP] sweep failed:", e);
  }
}

export { appInfo };
