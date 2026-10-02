/*
 * Backup — the engine: take a generation, find generations, restore one, export/import one,
 * and turn paused automations back on. docs/BACKUP-AND-RESTORE.md.
 *
 * KVS bookkeeping (all `backup-*`, runtime: never part of the backup itself):
 *   backup-settings  { pageId, spaceId, spaceKey, spaceName, title }   where the backup lives
 *   backup-status    { lastBackup, lastCheckAt, lastError, lastRestore }
 *   backup-dirty     { since, reason }   the debounce flag of the save hook (hook.js)
 *   backup-paused    { restoredAt, generationId, items[] }   automations a restore turned off
 *   backup-job-<id>  one queued/running/done job (the UI polls it)
 *   backup-stage-<importId>-<n>   import parts in flight (1 h TTL)
 */
import { kvs, MetadataField, WhereConditions } from "@forge/kvs";
import { getAppContext } from "@forge/api";
import { setWithTtl } from "../../shared/kvs-ttl.js";
import { familyOf, isBackedUp } from "./families.js";
import {
  FORMAT, FORMAT_VERSION, EXPORT_FORMAT, ChunkBuilder, sealManifest, verifyManifest, verifyChunk, parseChunk,
  manifestName, isManifestName, isChunkName, newGenerationId, contentFingerprint, tallyFamily, secretsInventory,
  pauseAutomations, restoreDecision, previewGroups, indexKeyCount, sha256, stableStringify,
} from "./snapshot.js";
import * as store from "./store.js";

export const SETTINGS_KEY = "backup-settings";
export const STATUS_KEY = "backup-status";
export const DIRTY_KEY = "backup-dirty";
export const PAUSED_KEY = "backup-paused";
export const JOB_PREFIX = "backup-job-";
export const STAGE_PREFIX = "backup-stage-";
const JOB_TTL_MS = 7 * 86400000;

const nowIso = () => new Date().toISOString();
const errText = (e) => String(e?.message || e).slice(0, 300);

/** What this invocation is: version, environment, installation. Never throws. */
export function appInfo() {
  try {
    const c = getAppContext();
    const installationAri = String(c?.installationAri?.toString?.() || c?.installationAri || "");
    const environmentAri = String(c?.environmentAri?.toString?.() || c?.environmentAri || "");
    return {
      appVersion: c?.appVersion || null,
      environmentType: c?.environmentType || null,
      environmentAri: environmentAri || null,
      installationId: (installationAri.match(/installation\/([0-9a-f-]{36})/i) || [])[1] || installationAri || null,
    };
  } catch (_) {
    return { appVersion: null, environmentType: null, environmentAri: null, installationId: null };
  }
}

// ── where the backup lives ────────────────────────────────────────────────────────────────

/** PURE. Pick the page this install should write to from what discovery found. */
export function choosePage(found, environmentType) {
  const title = store.backupPageTitle(environmentType);
  return (found || []).find((p) => p.title === title) || null;
}

/**
 * The page to write to, created on first use. Order: the remembered page (still there and still
 * restricted to the app) → a page discovery finds for this environment (a reinstall) → a new page
 * in the chosen space, or the first space the app can create a page in.
 */
export async function ensureBackupPage({ preferSpaceKey = null } = {}) {
  const env = appInfo().environmentType;
  const settings = (await kvs.get(SETTINGS_KEY)) || {};
  if (settings.pageId && !preferSpaceKey) {
    const p = await store.readPage(settings.pageId);
    if (p && (await store.isRestrictedToApp(p.pageId))) return settings;
  }
  if (!preferSpaceKey) {
    const found = choosePage(await store.findBackupPages().catch(() => []), env);
    if (found && (await store.isRestrictedToApp(found.pageId))) {
      const next = { pageId: found.pageId, spaceId: found.spaceId, spaceKey: found.spaceKey, spaceName: found.spaceName, title: found.title };
      await kvs.set(SETTINGS_KEY, next);
      return next;
    }
  }
  const candidates = [];
  if (preferSpaceKey) {
    const s = await store.spaceByKey(preferSpaceKey);
    if (!s) throw new Error(`Space ${preferSpaceKey} was not found, or the app cannot see it.`);
    candidates.push(s);
  } else {
    if (settings.spaceKey) { const s = await store.spaceByKey(settings.spaceKey); if (s) candidates.push(s); }
    for (const s of await store.listGlobalSpaces(25)) if (!candidates.some((c) => c.spaceId === s.spaceId)) candidates.push(s);
  }
  let lastErr = null;
  for (const s of candidates) {
    try {
      const page = await store.createBackupPage(s.spaceId, env);
      const next = { pageId: page.pageId, spaceId: s.spaceId, spaceKey: s.spaceKey, spaceName: s.spaceName, title: page.title };
      await kvs.set(SETTINGS_KEY, next);
      return next;
    } catch (e) { lastErr = e; console.warn(`[BACKUP] page in ${s.spaceKey} failed: ${errText(e)}`); }
  }
  throw lastErr || new Error("No space found where the app can keep its backup page.");
}

// ── take a backup ─────────────────────────────────────────────────────────────────────────

/** Stream every KVS key in key order; `onRow({key, value, expireTime})`. */
export async function scanKvs(onRow, { maxPages = 5000 } = {}) {
  let q = kvs.query({ metadataFields: [MetadataField.EXPIRE_TIME] }).limit(100);
  for (let i = 0; i < maxPages; i++) {
    const { results, nextCursor } = await q.getMany();
    for (const r of results || []) await onRow(r);
    if (!nextCursor) return;
    q = kvs.query({ metadataFields: [MetadataField.EXPIRE_TIME] }).limit(100).cursor(nextCursor);
  }
  throw new Error(`KVS scan stopped at ${maxPages} pages`);
}

/**
 * Take one generation. Chunks that already exist on the page (same content) are not uploaded
 * again; a generation whose content equals the newest one is not recorded (`unchanged: true`).
 */
export async function runBackup({ reason = "manual", actor = null } = {}) {
  await kvs.delete(DIRTY_KEY).catch(() => {}); // saves during the run re-arm the hook
  const startedAt = nowIso();
  const info = appInfo();
  try {
    const where = await ensureBackupPage();
    const existing = await store.listAttachments(where.pageId);
    const have = new Map(existing.map((a) => [a.title, a]));
    const chunks = [];
    const counts = {};
    let apiTokens = null;
    const authenticatorAccounts = [];
    const pauseOnRestore = [];
    let keys = 0;
    let uploaded = 0;
    const builder = new ChunkBuilder();
    const emit = async (c) => {
      if (!c) return;
      if (!have.has(c.name)) { await store.putFile(where.pageId, c.name, c.text); uploaded += 1; have.set(c.name, { title: c.name }); }
      chunks.push({ name: c.name, sha256: c.sha256, bytes: c.bytes, keys: c.keys });
    };
    await scanKvs(async ({ key, value, expireTime }) => {
      if (key === "api-tokens") apiTokens = value;
      if (key.startsWith("sig-secret-")) authenticatorAccounts.push(key.slice("sig-secret-".length));
      if (!isBackedUp(key)) return;
      keys += 1;
      tallyFamily(counts, key);
      for (const p of pauseAutomations(key, value).paused) pauseOnRestore.push({ id: p.id, rule: p.rule, label: p.label, where: p.where });
      await emit(builder.push(key, value, expireTime || null));
    });
    await emit(builder.finish());

    const fingerprint = contentFingerprint(chunks);
    const index = (await store.readIndex(where.pageId))?.value || { generations: [], installations: [] };
    const newest = index.generations?.[0];
    const installations = mergeInstallations(index.installations, info, startedAt);
    // Found live 2026-10-02: on a freshly reinstalled site the hourly check wrote a 0-item generation
    // before the admin had restored anything. An AUTOMATIC run records no generation while a restore
    // is pending (a backup from an earlier installation, no decision yet, under 14 days), nor an
    // empty one ever — there is nothing to protect, and it would read as "last backup: 0 items".
    const automatic = reason === "save" || reason === "schedule";
    const decision = automatic ? await kvs.get("backup-decision").catch(() => null) : null;
    const skip = automatic ? skipAutomaticGeneration({ keys, index, info, decision, nowMs: Date.parse(startedAt) }) : null;
    if (skip) {
      await store.writeIndex(where.pageId, { ...index, installations, lastCheckAt: startedAt });
      const prev = (await kvs.get(STATUS_KEY)) || {};
      await kvs.set(STATUS_KEY, { ...prev, lastCheckAt: startedAt, lastError: null, waiting: skip });
      return { ok: true, unchanged: true, skipped: skip, keys };
    }
    if (newest && newest.fingerprint === fingerprint && newest.environmentType === info.environmentType) {
      await store.writeIndex(where.pageId, { ...index, installations, lastCheckAt: startedAt });
      // A fresh install (after a restore) has no status row yet: the newest generation IS its last backup.
      const prev = (await kvs.get(STATUS_KEY)) || {};
      const lastBackup = { ...newest, ...(prev.lastBackup?.generationId === newest.generationId ? prev.lastBackup : {}), pageId: where.pageId, spaceKey: where.spaceKey, spaceName: where.spaceName };
      await kvs.set(STATUS_KEY, { ...prev, lastBackup, lastCheckAt: startedAt, lastError: null });
      return { ok: true, unchanged: true, generationId: newest.generationId, keys, bytes: newest.bytes };
    }

    const generationId = newGenerationId();
    const bytes = chunks.reduce((n, c) => n + c.bytes, 0);
    const manifest = sealManifest({
      format: FORMAT, formatVersion: FORMAT_VERSION, generationId, createdAt: startedAt, reason,
      actor: actor ? { accountId: actor } : null,
      app: info,
      keys, bytes, fingerprint, counts, chunks,
      secrets: secretsInventory({ apiTokens, authenticatorAccounts }),
      pauseOnRestore,
    });
    const mName = manifestName(generationId);
    const manifestAttachmentId = await store.putFile(where.pageId, mName, JSON.stringify(manifest));

    const row = { generationId, createdAt: startedAt, reason, keys, bytes, chunks: chunks.length, fingerprint,
      manifest: mName, manifestAttachmentId, environmentType: info.environmentType, installationId: info.installationId, appVersion: info.appVersion };
    const generations = retainGenerations([row, ...(index.generations || []).filter((g) => g.generationId !== generationId)], store.KEEP_GENERATIONS);
    await store.writeIndex(where.pageId, { ...index, format: FORMAT, generations, installations, lastCheckAt: startedAt });
    await collectGarbage(where.pageId, generations, existing).catch((e) => console.warn(`[BACKUP] gc: ${errText(e)}`));

    const status = { ...((await kvs.get(STATUS_KEY)) || {}), lastBackup: { ...row, pageId: where.pageId, spaceKey: where.spaceKey, spaceName: where.spaceName, uploaded }, lastCheckAt: startedAt, lastError: null };
    await kvs.set(STATUS_KEY, status);
    console.log(`[BACKUP] generation ${generationId} reason=${reason} keys=${keys} bytes=${bytes} chunks=${chunks.length} uploaded=${uploaded}`);
    return { ok: true, unchanged: false, generationId, keys, bytes, chunks: chunks.length, uploaded };
  } catch (e) {
    console.error("[BACKUP] failed:", e);
    const status = { ...((await kvs.get(STATUS_KEY).catch(() => null)) || {}), lastError: { at: startedAt, message: errText(e), reason } };
    await kvs.set(STATUS_KEY, status).catch(() => {});
    return { ok: false, reason: errText(e) };
  }
}

/**
 * PURE. Which generations stay: the newest `keep`, PLUS the newest one each earlier installation
 * wrote (up to 5 installations). After a reinstall the new install starts writing its own
 * generations at once (every save, every hour); without the pin, ten saves would rotate the
 * pre-uninstall backup — the one the admin came back for — off the page.
 */
export function retainGenerations(all, keep) {
  const sorted = [...(all || [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const out = sorted.slice(0, keep);
  const seen = new Set(out.map((g) => g.installationId || ""));
  let pins = 0;
  for (const g of sorted.slice(keep)) {
    const inst = g.installationId || "";
    if (seen.has(inst) || pins >= 5) continue;
    seen.add(inst); pins += 1;
    out.push({ ...g, pinned: true });
  }
  return out;
}

/**
 * PURE. Why an automatic backup must not record a generation now, or null.
 *   "empty"           nothing backed-up exists in KVS
 *   "restore-pending" the newest generation on the page was written by an EARLIER installation,
 *                     this install has not decided (restore / start fresh), and it is < 14 days old
 */
export function skipAutomaticGeneration({ keys, index, info, decision, nowMs = Date.now() }) {
  if (!keys) return "empty";
  if (decision?.decision) return null;
  const gens = Array.isArray(index?.generations) ? index.generations : [];
  const newest = [...gens].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  if (!newest || !info?.installationId || newest.installationId === info.installationId) return null;
  if (!newest.keys) return null;
  const age = nowMs - Date.parse(newest.createdAt || 0);
  return age < 14 * 86400000 ? "restore-pending" : null;
}

/** PURE. Keep every installation id that ever wrote here (the re-link ticket needs the previous one). */
export function mergeInstallations(list, info, at) {
  const rows = Array.isArray(list) ? list.map((r) => ({ ...r })) : [];
  if (!info?.installationId) return rows;
  const hit = rows.find((r) => r.installationId === info.installationId);
  if (hit) { hit.lastSeen = at; hit.environmentType = info.environmentType || hit.environmentType; }
  else rows.unshift({ installationId: info.installationId, environmentType: info.environmentType || null, firstSeen: at, lastSeen: at });
  return rows.slice(0, 20);
}

/** Delete manifests no longer indexed and chunks no kept manifest references. */
async function collectGarbage(pageId, generations, attachments) {
  const keepManifests = new Set(generations.map((g) => g.manifest));
  const keepChunks = new Set();
  for (const g of generations) {
    const a = attachments.find((x) => x.title === g.manifest) || (g.manifestAttachmentId ? { id: g.manifestAttachmentId } : null);
    if (!a) continue;
    try { const m = JSON.parse(await store.getFile(pageId, a.id)); for (const c of m.chunks || []) keepChunks.add(c.name); }
    catch (_) { return; } // cannot prove what is referenced: delete nothing
  }
  for (const a of attachments) {
    if ((isManifestName(a.title) && !keepManifests.has(a.title)) || (isChunkName(a.title) && !keepChunks.has(a.title))) await store.deleteFile(a.id);
  }
}

// ── find backups (rediscovery) ────────────────────────────────────────────────────────────

/**
 * Every backup page the app can open on this site, with its generations. This is the app's
 * own footprint in Confluence; it needs nothing from KVS, so it works on a fresh install.
 */
export async function discoverBackups() {
  const info = appInfo();
  const pages = await store.findBackupPages();
  const settings = await kvs.get(SETTINGS_KEY).catch(() => null);
  if (settings?.pageId && !pages.some((p) => p.pageId === settings.pageId)) {
    const p = await store.readPage(settings.pageId);
    if (p) pages.push({ ...p, spaceKey: settings.spaceKey, spaceName: settings.spaceName });
  }
  const out = [];
  for (const p of pages) {
    const restricted = await store.isRestrictedToApp(p.pageId).catch(() => false);
    const index = (await store.readIndex(p.pageId).catch(() => null))?.value || null;
    out.push({
      pageId: p.pageId, title: p.title, spaceKey: p.spaceKey, spaceName: p.spaceName, restricted,
      sameEnvironment: p.title === store.backupPageTitle(info.environmentType),
      generations: (index?.generations || []).map((g) => ({ ...g })),
      installations: index?.installations || [],
    });
  }
  out.sort((a, b) => Number(b.sameEnvironment) - Number(a.sameEnvironment) || String(b.generations[0]?.createdAt || "").localeCompare(String(a.generations[0]?.createdAt || "")));
  return { environmentType: info.environmentType, installationId: info.installationId, backups: out };
}

/** Is this install empty of the customer's setup (a fresh install, or a wiped one)? */
export async function looksFresh() {
  if (await kvs.get("admin-settings-global")) return false;
  for (const prefix of ["protection-", "section-protection-", "workflow-state-", "validation-config-"]) {
    const { results } = await kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(1).getMany();
    if ((results || []).length) return false;
  }
  return true;
}

/** Load a generation's manifest from a backup page, verified. */
export async function loadManifest(pageId, generationId) {
  const index = (await store.readIndex(pageId))?.value;
  const row = (index?.generations || []).find((g) => g.generationId === generationId) || (!generationId ? index?.generations?.[0] : null);
  if (!row) throw new Error("That backup generation is not on the backup page any more.");
  let attachmentId = row.manifestAttachmentId;
  if (!attachmentId) attachmentId = (await store.listAttachments(pageId)).find((a) => a.title === row.manifest)?.id;
  if (!attachmentId) throw new Error("The backup's index file is missing.");
  const manifest = JSON.parse(await store.getFile(pageId, attachmentId));
  const v = verifyManifest(manifest);
  if (!v.ok) throw new Error(v.reason);
  return { manifest, row };
}

/** Fetch and verify every chunk; returns Map(name → text). Throws on the first mismatch. */
export async function fetchChunks(pageId, manifest) {
  const files = new Map((await store.listAttachments(pageId)).map((a) => [a.title, a]));
  const out = new Map();
  for (const c of manifest.chunks) {
    const a = files.get(c.name);
    if (!a) throw new Error(`Backup file ${c.name} is missing — this generation cannot be restored.`);
    const text = await store.getFile(pageId, a.id);
    if (!verifyChunk(text, c)) throw new Error(`Backup file ${c.name} failed its integrity check — nothing was restored.`);
    out.set(c.name, text);
  }
  return out;
}

/**
 * The preview an admin sees before restoring — from the VERIFIED manifest alone, so it answers
 * inside a resolver's 25 s on any size of backup. Every data file is re-hashed by the restore
 * itself before a single key is written.
 */
export async function previewGeneration(pageId, generationId) {
  const { manifest, row } = await loadManifest(pageId, generationId);
  return {
    generationId: manifest.generationId, createdAt: manifest.createdAt, reason: manifest.reason,
    importedFrom: manifest.importedFrom || null, app: manifest.app, keys: manifest.keys, bytes: manifest.bytes,
    chunks: manifest.chunks.length, integrity: "index verified", pinned: !!row?.pinned,
    groups: previewGroups(manifest), indexKeys: indexKeyCount(manifest), secrets: manifest.secrets, paused: manifest.pauseOnRestore || [],
  };
}

// ── restore ───────────────────────────────────────────────────────────────────────────────

async function writeEntries(entries) {
  let written = 0;
  const failed = [];
  for (let i = 0; i < entries.length; i += 20) {
    const batch = entries.slice(i, i + 20);
    const items = batch.map((d) => ({ key: d.key, value: d.value, ...(d.expireAt ? { options: { ttl: { value: Math.max(60, Math.min(Math.ceil((d.expireAt - Date.now()) / 1000), 364 * 86400)), unit: "SECONDS" } } } : {}) }));
    let ok = false;
    try {
      const r = await kvs.batchSet(items);
      written += (r?.successfulKeys || []).length;
      for (const f of r?.failedKeys || []) failed.push({ key: f.key, reason: f.error?.message || "failed" });
      ok = true;
    } catch (e) { console.warn(`[BACKUP] batchSet failed, falling back to single writes: ${errText(e)}`); }
    if (!ok) {
      for (const it of items) {
        try { await kvs.set(it.key, it.value, it.options); written += 1; } catch (e) { failed.push({ key: it.key, reason: errText(e) }); }
      }
    }
  }
  return { written, failed };
}

/**
 * Restore one generation. Verifies everything first; on an install that already holds data it
 * takes a "before restore" backup; writes every backed-up key back (with its remaining TTL);
 * pauses the automations (snapshot.js AUTOMATION_RULES) and records them for "Turn back on".
 */
export async function runRestore({ pageId, generationId, actor = null, source = "backup" } = {}) {
  const { manifest } = await loadManifest(pageId, generationId);
  const texts = await fetchChunks(pageId, manifest);
  let safety = null;
  if (!(await looksFresh())) {
    safety = await runBackup({ reason: "before-restore", actor });
    if (!safety.ok) throw new Error(`Could not take the safety backup before restoring: ${safety.reason}`);
  }
  const pausedAt = Date.parse(manifest.createdAt) || Date.now();
  const toWrite = [];
  const paused = [];
  let expired = 0;
  for (const c of manifest.chunks) {
    for (const e of parseChunk(texts.get(c.name))) {
      const d = restoreDecision(e);
      if (d.action === "skip") { if (d.reason === "expired") expired += 1; continue; }
      const p = pauseAutomations(d.key, d.value, { pausedAt });
      paused.push(...p.paused);
      toWrite.push({ ...d, value: p.value });
    }
  }
  const { written, failed } = await writeEntries(toWrite);
  const at = nowIso();
  if (paused.length) await kvs.set(PAUSED_KEY, { restoredAt: at, generationId: manifest.generationId, items: paused });
  const lastRestore = { at, generationId: manifest.generationId, createdAt: manifest.createdAt, source, pageId, written, failed: failed.length, expired, paused: paused.length, actor, fromInstallation: manifest.app?.installationId || null };
  await kvs.set(STATUS_KEY, { ...((await kvs.get(STATUS_KEY)) || {}), lastRestore });
  console.log(`[BACKUP] restored generation ${manifest.generationId} written=${written} failed=${failed.length} expired=${expired} paused=${paused.length}`);
  return { ok: failed.length === 0, generationId: manifest.generationId, createdAt: manifest.createdAt, written, failed: failed.slice(0, 20), expired, paused, secrets: manifest.secrets, safetyGeneration: safety?.generationId || null };
}

// ── automations paused by a restore ───────────────────────────────────────────────────────

export async function listPaused() {
  return (await kvs.get(PAUSED_KEY)) || { items: [] };
}

/**
 * Turn paused automations back on THROUGH THE SAME RESOLVERS the consoles call, as the admin —
 * e.g. "Seals expire" goes through store-policy, which extends every seal by the time it was
 * paused (autoUnlockPausedAt = the backup's time), so the gap never eats into a seal.
 * `invoke(key, payload)` is the caller's resolver door (bound to the admin's account).
 */
export async function resumePaused(ids, invoke) {
  const state = await listPaused();
  const want = new Set(Array.isArray(ids) && ids.length ? ids : state.items.map((i) => i.id));
  const done = [];
  const failed = [];
  for (const item of state.items.filter((i) => want.has(i.id))) {
    try {
      const r = await resumeOne(item, invoke);
      if (r?.success === false) failed.push({ id: item.id, reason: r.reason || "Refused" }); else done.push(item.id);
    } catch (e) { failed.push({ id: item.id, reason: errText(e) }); }
  }
  const left = state.items.filter((i) => !done.includes(i.id));
  if (left.length) await kvs.set(PAUSED_KEY, { ...state, items: left }); else await kvs.delete(PAUSED_KEY);
  return { resumed: done, failed, left: left.length };
}

async function resumeOne(item, invoke) {
  const o = item.original || {};
  switch (item.rule) {
    case "seal-expiry":
      return invoke("store-policy", { scope: "global", data: { autoUnlockEnabled: o.autoUnlockEnabled !== false } });
    case "validation-revert":
    case "validation-ai": {
      const scope = item.spaceKey ? { scope: "space", key: item.spaceKey } : { scope: "global" };
      const cur = await invoke("load-validation-config", scope);
      if (!cur || cur.success === false) return cur || { success: false, reason: "Could not read the validation rules" };
      const data = item.rule === "validation-revert"
        ? { ...cur, modes: { ...(cur.modes || {}), revert: o["modes.revert"] === true } }
        : { ...cur, ai: { ...(cur.ai || {}), enabled: o["ai.enabled"] === true } };
      return invoke("store-validation-config", { ...scope, data });
    }
    case "workflow-auto-assign":
    case "workflow-review-due": {
      const cur = await invoke("get-space-workflow-settings", { spaceKey: item.spaceKey });
      if (!cur || cur.success === false || cur.error) return { success: false, reason: cur?.reason || cur?.error || "Could not read the workflow settings" };
      const settings = { ...(cur.settings || {}) };
      if (item.rule === "workflow-auto-assign") settings.autoAssignNew = o.autoAssignNew === true;
      else settings.reviewAfterDaysByState = o.reviewAfterDaysByState || {};
      return invoke("set-space-workflow-settings", { spaceKey: item.spaceKey, settings });
    }
    default:
      return { success: false, reason: `Unknown automation ${item.rule}` };
  }
}

// ── export / import ───────────────────────────────────────────────────────────────────────

/** One-file export of a stored generation: { format, formatVersion, manifest, chunks:[{name, sha256, text}] }. */
export async function exportGeneration(pageId, generationId) {
  const { manifest } = await loadManifest(pageId, generationId);
  const texts = await fetchChunks(pageId, manifest);
  return { format: EXPORT_FORMAT, formatVersion: 1, exportedAt: nowIso(), manifest, chunks: manifest.chunks.map((c) => ({ name: c.name, sha256: c.sha256, text: texts.get(c.name) })) };
}

/** PURE. Check an export file before anything is written. */
export function verifyExport(doc) {
  if (!doc || doc.format !== EXPORT_FORMAT) return { ok: false, reason: "This file is not a Sentinel Vault export." };
  const v = verifyManifest(doc.manifest);
  if (!v.ok) return v;
  const byName = new Map((doc.chunks || []).map((c) => [c.name, c]));
  for (const c of doc.manifest.chunks) {
    const got = byName.get(c.name);
    if (!got || typeof got.text !== "string") return { ok: false, reason: `The file is missing part ${c.name}.` };
    if (!verifyChunk(got.text, c)) return { ok: false, reason: `Part ${c.name} failed its integrity check.` };
  }
  return { ok: true };
}

/**
 * Import an export file as a NEW generation on this site's backup page (portable across sites),
 * then it can be previewed and restored like any other. Returns { generationId }.
 */
export async function importExport(doc, { actor = null } = {}) {
  const v = verifyExport(doc);
  if (!v.ok) throw new Error(v.reason);
  const where = await ensureBackupPage();
  const files = new Map((await store.listAttachments(where.pageId)).map((a) => [a.title, a]));
  for (const c of doc.chunks) if (!files.has(c.name)) await store.putFile(where.pageId, c.name, c.text);
  return registerImportedManifest(where, doc.manifest, actor);
}

async function registerImportedManifest(where, srcManifest, actor) {
  const info = appInfo();
  const generationId = newGenerationId();
  const { manifestSha256: _drop, ...body } = srcManifest;
  const sealed = sealManifest({
    ...body, generationId, reason: "import", importedAt: nowIso(), importedBy: actor,
    importedFrom: { generationId: srcManifest.generationId, createdAt: srcManifest.createdAt, app: srcManifest.app || null },
  });
  const mName = manifestName(generationId);
  const manifestAttachmentId = await store.putFile(where.pageId, mName, JSON.stringify(sealed));
  const index = (await store.readIndex(where.pageId))?.value || { generations: [], installations: [] };
  const row = { generationId, createdAt: sealed.createdAt, reason: "import", importedAt: sealed.importedAt, keys: sealed.keys, bytes: sealed.bytes, chunks: sealed.chunks.length, fingerprint: `import-${sealed.fingerprint}`, manifest: mName, manifestAttachmentId, environmentType: info.environmentType, installationId: info.installationId, appVersion: srcManifest.app?.appVersion || null };
  // An import is never the "newest unchanged" baseline of a later backup: its fingerprint is tagged.
  const generations = retainGenerations([row, ...(index.generations || [])], store.KEEP_GENERATIONS);
  await store.writeIndex(where.pageId, { ...index, format: FORMAT, generations, installations: mergeInstallations(index.installations, info, nowIso()) });
  return { generationId, pageId: where.pageId, keys: sealed.keys };
}

// Import in parts (the UI): parts are staged in KVS, then assembled into chunks and a manifest.
// A part is ≤ 200 KB of the export file's text; the whole file is reassembled only chunk by chunk.
export async function stageImportPart(importId, index, total, text) {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(String(importId || ""))) throw new Error("Bad import id");
  if (!(Number.isInteger(index) && index >= 0 && Number.isInteger(total) && total > 0 && index < total && total <= 2000)) throw new Error("Bad part number");
  if (typeof text !== "string" || text.length > 220000) throw new Error("Part too large");
  await setWithTtl(`${STAGE_PREFIX}${importId}-${index}`, { t: text }, 3600000);
  return { ok: true };
}

export async function assembleStagedImport(importId, total) {
  const parts = [];
  for (let i = 0; i < total; i++) {
    const p = await kvs.get(`${STAGE_PREFIX}${importId}-${i}`);
    if (!p || typeof p.t !== "string") throw new Error(`Part ${i + 1} of ${total} did not arrive — choose the file again.`);
    parts.push(p.t);
  }
  let doc;
  try { doc = JSON.parse(parts.join("")); } catch (_) { throw new Error("The file is not valid JSON."); }
  for (let i = 0; i < total; i++) await kvs.delete(`${STAGE_PREFIX}${importId}-${i}`).catch(() => {});
  return doc;
}

// ── jobs (the UI and REST poll these) ─────────────────────────────────────────────────────

export const jobKey = (id) => `${JOB_PREFIX}${id}`;
export async function writeJob(job) { await setWithTtl(jobKey(job.id), job, JOB_TTL_MS); return job; }
export async function readJob(id) { return kvs.get(jobKey(String(id || "").replace(/[^A-Za-z0-9-]/g, ""))); }

/** PURE. A stable digest of an entry list (used by the dev hook's proof dump). */
export const digestEntries = (entries) => sha256(stableStringify(entries));
export { familyOf };
