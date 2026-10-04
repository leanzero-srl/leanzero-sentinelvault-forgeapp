/*
 * Backup capsule — resolvers (Site settings → Backup and restore; docs/BACKUP-AND-RESTORE.md).
 * Every action is SITE ADMIN only, the same floor as API access: a backup holds every space's
 * rosters, rules and seals, and a restore rewrites all of it. The REST doors (config-api ops
 * `backup`, `restore`, `export`, `import`, `resume-automations`, `backup-location`,
 * `rediscover`) run the SAME engine functions under the same floor (the token's minter must be
 * a site admin and the token must hold the admin role).
 *
 *   backup-status              {}                          → status, location, paused, survival table, this install
 *   backup-discover            {}                          → every backup page the app can open + its generations
 *   backup-now                 {}                          → { jobId }
 *   backup-job                 { id }                      → { job }
 *   backup-preview             { pageId, generationId }    → what a restore brings back (verified index)
 *   backup-restore             { pageId, generationId }    → { jobId }
 *   backup-decline             {}                          → "start fresh": the restore banner stops asking
 *   backup-export              { generationId? }           → { manifest, parts[] } of this site's newest/named generation
 *   backup-export-part         { generationId, name }      → { text } one verified data file
 *   backup-import-part         { importId, index, total, text }
 *   backup-import-commit       { importId, total }         → { jobId }
 *   backup-set-location        { spaceKey }                → { jobId }
 *   backup-delete              {}                          → deletes this environment's backup page
 *   backup-resume-automations  { ids? }                    → { resumed, failed, left }
 *   backup-history             { cursor? }                 → { entries, nextCursor } (activity-site-)
 */
import { kvs } from "@forge/kvs";
import { isOperatorSiteAdmin } from "../../shared/steward-checks.js";
import { readActivity, SITE_PREFIX } from "../../infra/activity-log.js";
import { invoke as invokeResolver } from "../config-api/resolvers.js";
import {
  discoverBackups, previewGeneration, loadManifest, fetchChunks, listPaused, resumePaused, stageImportPart,
  readJob, appInfo, STATUS_KEY, SETTINGS_KEY,
} from "./engine.js";
import { survivalTable } from "./snapshot.js";
import { startJob, audit } from "./worker.js";
import * as store from "./store.js";

const DENY = { success: false, reason: "Not authorized — site admin access required." };
const siteAdmin = async (req) => { const a = req?.context?.accountId; return !!a && (await isOperatorSiteAdmin(a)); };
const fail = (e) => ({ success: false, reason: String(e?.message || e).slice(0, 300) });
const str = (v) => (v == null ? "" : String(v));

/** The backup page this install may read from (app-created, app-restricted; store.assertBackupPage). */
const readablePage = (pageId) => store.assertBackupPage(pageId);

const status = async (req) => {
  if (!(await siteAdmin(req))) return DENY;
  try {
    const [st, settings, paused, decision] = await Promise.all([kvs.get(STATUS_KEY), kvs.get(SETTINGS_KEY), listPaused(), kvs.get("backup-decision")]);
    const info = appInfo();
    return {
      success: true, status: st || {}, settings: settings || null, paused, decision: decision || null,
      install: { ...info, cloudId: req?.context?.cloudId || null, siteUrl: req?.context?.siteUrl || null },
      survival: survivalTable(),
    };
  } catch (e) { return fail(e); }
};

const discover = async (req) => {
  if (!(await siteAdmin(req))) return DENY;
  try { return { success: true, ...(await discoverBackups()) }; } catch (e) { return fail(e); }
};

const backupNow = async (req) => {
  if (!(await siteAdmin(req))) return DENY;
  try { const job = await startJob("backup", { reason: "manual" }, req.context.accountId); return { success: true, jobId: job.id }; }
  catch (e) { return fail(e); }
};

const jobStatus = async (req) => {
  if (!(await siteAdmin(req))) return DENY;
  const job = await readJob(req.payload?.id);
  return job ? { success: true, job } : { success: false, reason: "No such job" };
};

const preview = async (req) => {
  if (!(await siteAdmin(req))) return DENY;
  try { return { success: true, preview: await previewGeneration(await readablePage(req.payload?.pageId), str(req.payload?.generationId) || null) }; }
  catch (e) { return fail(e); }
};

const restore = async (req) => {
  if (!(await siteAdmin(req))) return DENY;
  try {
    const pageId = await readablePage(req.payload?.pageId);
    const generationId = str(req.payload?.generationId);
    if (!generationId) return { success: false, reason: "generationId required" };
    const job = await startJob("restore", { pageId, generationId }, req.context.accountId);
    return { success: true, jobId: job.id };
  } catch (e) { return fail(e); }
};

const decline = async (req) => {
  if (!(await siteAdmin(req))) return DENY;
  await kvs.set("backup-decision", { decision: "declined", at: new Date().toISOString(), by: req.context.accountId });
  return { success: true };
};

/** The page this install writes (the export reads its own site's backup, never another env's). */
async function ownPage() {
  const s = await kvs.get(SETTINGS_KEY);
  if (s?.pageId) return s.pageId;
  const d = await discoverBackups();
  const own = d.backups.find((b) => b.sameEnvironment && b.restricted);
  if (!own) throw new Error("There is no backup yet — take one first.");
  return own.pageId;
}

const exportStart = async (req) => {
  if (!(await siteAdmin(req))) return DENY;
  try {
    const pageId = await ownPage();
    const { manifest } = await loadManifest(pageId, str(req.payload?.generationId) || null);
    await audit("backup.exported", req.context.accountId, { generationId: manifest.generationId, keys: manifest.keys, bytes: manifest.bytes, door: "ui" });
    return { success: true, manifest, parts: manifest.chunks.map((c) => c.name) };
  } catch (e) { return fail(e); }
};

const exportPart = async (req) => {
  if (!(await siteAdmin(req))) return DENY;
  try {
    const pageId = await ownPage();
    const { manifest } = await loadManifest(pageId, str(req.payload?.generationId));
    const want = manifest.chunks.find((c) => c.name === str(req.payload?.name));
    if (!want) return { success: false, reason: "No such part in that backup" };
    const texts = await fetchChunks(pageId, { ...manifest, chunks: [want] });
    return { success: true, name: want.name, text: texts.get(want.name) };
  } catch (e) { return fail(e); }
};

const importPart = async (req) => {
  if (!(await siteAdmin(req))) return DENY;
  try {
    const p = req.payload || {};
    return { success: true, ...(await stageImportPart(str(p.importId), Number(p.index), Number(p.total), p.text)) };
  } catch (e) { return fail(e); }
};

const importCommit = async (req) => {
  if (!(await siteAdmin(req))) return DENY;
  try {
    const importId = str(req.payload?.importId);
    const total = Number(req.payload?.total);
    if (!/^[A-Za-z0-9-]{8,64}$/.test(importId) || !(total > 0)) return { success: false, reason: "importId and total required" };
    const job = await startJob("import", { importId, total, source: "file" }, req.context.accountId);
    return { success: true, jobId: job.id };
  } catch (e) { return fail(e); }
};

const setLocation = async (req) => {
  if (!(await siteAdmin(req))) return DENY;
  const spaceKey = str(req.payload?.spaceKey).trim();
  if (!/^[A-Za-z0-9~_.-]{1,255}$/.test(spaceKey)) return { success: false, reason: "Enter a space key." };
  try {
    const s = await store.spaceByKey(spaceKey);
    if (!s) return { success: false, reason: `Space ${spaceKey} was not found, or the app cannot see it.` };
    const job = await startJob("relocate", { spaceKey: s.spaceKey }, req.context.accountId);
    return { success: true, jobId: job.id };
  } catch (e) { return fail(e); }
};

const deleteBackup = async (req) => {
  if (!(await siteAdmin(req))) return DENY;
  // A JOB since 2026-10-04: emptying the page (every backup file purged before the page goes to
  // the trash) can outlast a resolver's 25 s. The worker (executeJob "delete") does the work and
  // fails loudly; the tab polls the job like Move.
  try {
    const job = await startJob("delete", {}, req.context.accountId);
    return { success: true, jobId: job.id };
  } catch (e) { return fail(e); }
};

const resume = async (req) => {
  if (!(await siteAdmin(req))) return DENY;
  try {
    const accountId = req.context.accountId;
    const r = await resumePaused(Array.isArray(req.payload?.ids) ? req.payload.ids.map(String) : null, (key, payload) => invokeResolver(key, payload, accountId));
    if (r.resumed.length) await audit("backup.automations-resumed", accountId, { resumed: r.resumed, failed: r.failed.length });
    return { success: true, ...r };
  } catch (e) { return fail(e); }
};

const history = async (req) => {
  if (!(await siteAdmin(req))) return DENY;
  try { return { success: true, ...(await readActivity(SITE_PREFIX, { cursor: str(req.payload?.cursor) || undefined, limit: 25 })) }; }
  catch (e) { return fail(e); }
};

export const actions = [
  ["backup-status", status],
  ["backup-discover", discover],
  ["backup-now", backupNow],
  ["backup-job", jobStatus],
  ["backup-preview", preview],
  ["backup-restore", restore],
  ["backup-decline", decline],
  ["backup-export", exportStart],
  ["backup-export-part", exportPart],
  ["backup-import-part", importPart],
  ["backup-import-commit", importCommit],
  ["backup-set-location", setLocation],
  ["backup-delete", deleteBackup],
  ["backup-resume-automations", resume],
  ["backup-history", history],
];
