/*
 * Privacy sweep — the weekly job (queue `privacy-queue`, 900 s).
 *
 *   1. retention    delete activity history, workflow history and read confirmations older than
 *                   the site's `historyRetentionDays` (retention.js), only while "Delete old
 *                   history" is on
 *   2. inventory    every account id the app stores (accounts.js extractAccountIds), with the
 *                   time the app first held it, kept in `privacy-accounts-<n>`; the app's own
 *                   account (`app-account-id`) is never part of it
 *   3. report       Atlassian's Personal Data Reporting API (POST /app/report-accounts, called
 *                   directly so the `Cycle-Period` and `Retry-After` headers can be read) for the
 *                   ids whose last report is a full cycle old, 90 per request; the index is saved
 *                   after EVERY batch, so a timeout never forgets what was already reported
 *   4. act          `closed`: the id is marked closed for good (never reported again) and the
 *                   person is erased across KVS (their own rows deleted, every other mention
 *                   pseudonymised, removed from rosters), the KVS secret namespace (their
 *                   authenticator), the page properties the app writes (`protection-`,
 *                   `section-protection-`, API receipts). The backup is scrubbed by its OWN job
 *                   (backup worker kind `privacy-erase`: a fresh generation, then every older
 *                   generation that names them outside page content is dropped).
 *                   `updated`: the stored display names are refreshed.
 *                   Sealed page content (`section-snapshot-` baselines) is the record of what
 *                   was sealed and is NEVER rewritten: a closed person mentioned inside sealed
 *                   content stays there, as in Confluence's own page history.
 *   5. strips       stored email addresses removed from seal records and approver lists (every
 *                   sweep: a restore can bring old ones back) and the one-time migration of the
 *                   6.6.0-era `protection-` page properties.
 *
 * Scheduling: Forge allows 5 scheduled triggers and this app uses all 5, so the sweep rides the
 * DAILY recurring-nudge trigger (boot.js → privacySweepCheck), which asks sweepSchedule()
 * (accounts.js): a report falling due within a day is waited for with a delayed queue event (the
 * consumer re-queues itself until `notBefore`), so the cycle stays 7 days and never slips to 14.
 * A site admin can run it at once (Site settings → Privacy and retention, resolver
 * `privacy-run-now`) and over REST (config-api op `privacy-sweep`); either way an account is
 * reported at most once per cycle. A run that nears its time budget saves what it did and hands
 * the rest to a continuation event. Like the backup, it runs only in the Confluence installation.
 */
import { kvs, MetadataField, WhereConditions } from "@forge/kvs";
import { Queue } from "@forge/events";
import { asApp, route, __requestAtlassianAsApp } from "@forge/api";
import { readEffective } from "../policies/settings-schema.js";
import { isPastRetention, retainedFamily, effectiveRetentionDays } from "./retention.js";
import {
  extractAccountIds, rewriteAccount, removesFromLists, keyNamesAccount, holdsPageContent, stripLegacyEmail, stripRosterContact,
  planReport, batches, sweepSchedule, nextReportAt, acceptAnswers, parseCyclePeriod, erasableMentions, jobAlive, settleBackupHandOff, CYCLE_MS, DUE_WINDOW_MS, DUE_MARGIN_MS,
} from "./accounts.js";
import { scheduleBackup } from "../backup/hook.js";
import { makeQueueBackupErasure, ERASE_PENDING_KEY } from "./erase-queue.js";
import { acquireLock, releaseLock, withLock } from "../../shared/kvs-lock.js";
import { sealPropertyValue, sealPropertyNeedsScrub } from "../sealing/seal-property.js";

export const PRIVACY_QUEUE_KEY = "privacy-queue";
export const STATUS_KEY = "privacy-status";
export { ERASE_PENDING_KEY } from "./erase-queue.js";
const LOCK_KEY = "privacy-lock";
const INDEX_PREFIX = "privacy-accounts-";
const MIGRATIONS_KEY = "privacy-migrations";
const OWN_PREFIX = "privacy-"; // the sweep's own bookkeeping: never scanned for people, never erased
const INDEX_CHUNK = 1500; // ~110 bytes an entry → well under the KVS value limit
const LOCK_MS = 16 * 60000; // > the 900 s consumer timeout: a killed run frees it on its own
/** Work stops and hands off after this much of the 900 s consumer budget. */
export const SWEEP_BUDGET_MS = 600000;
const MAX_DELAY_S = 900; // Forge queue delayInSeconds limit
const nowIso = () => new Date().toISOString();
const errText = (e) => String(e?.message || e).slice(0, 300);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** PURE. Does this invocation belong to the Confluence installation? Unknown context → yes. */
export const isConfluenceInstall = (context) => {
  const ic = String(context?.installContext || "");
  return !ic || ic.includes(":confluence::");
};

// When a sweep is due: pure, in accounts.js (unit-tested there).
export { sweepDue, sweepSchedule, SWEEP_EVERY_MS } from "./accounts.js";

/** Push one sweep event, delayed until `notBefore` (at most 900 s per hop; the consumer re-queues). */
async function pushSweep(reason, notBefore = null, nowMs = Date.now()) {
  const wait = Number.isFinite(notBefore) ? Math.max(0, Math.ceil((notBefore - nowMs) / 1000)) : 0;
  const event = { body: { kind: "sweep", reason, ...(Number.isFinite(notBefore) && wait > 0 ? { notBefore } : {}) } };
  if (wait > 0) event.delayInSeconds = Math.min(MAX_DELAY_S, wait);
  await new Queue({ key: PRIVACY_QUEUE_KEY }).push(event);
}

/** Daily check (boot.js, after the recurring-nudge task). Never throws. */
export async function privacySweepCheck(context) {
  try {
    if (!isConfluenceInstall(context)) return;
    const status = (await kvs.get(STATUS_KEY)) || {};
    const { due, notBefore } = sweepSchedule(status, Date.now());
    if (!due) return;
    await kvs.set(STATUS_KEY, { ...status, queuedAt: nowIso() });
    await pushSweep("schedule", notBefore);
  } catch (e) {
    console.error("[PRIVACY] daily check failed:", e);
  }
}

/** Queue a sweep now (the admin button). */
export async function queuePrivacySweep(reason = "manual") {
  const status = (await kvs.get(STATUS_KEY)) || {};
  await kvs.set(STATUS_KEY, { ...status, queuedAt: nowIso() });
  await pushSweep(reason);
}

export async function privacyConsumer(event) {
  const body = event?.body || event?.payload || {};
  if (body.kind !== "sweep") { console.warn("[PRIVACY] consumer: unknown event", JSON.stringify(body).slice(0, 200)); return; }
  // A delayed sweep that arrives early (one hop is at most 900 s) re-queues itself until notBefore.
  const nb = Number(body.notBefore);
  if (Number.isFinite(nb) && Date.now() < nb - 1000) { await pushSweep(body.reason || "schedule", nb); return; }
  const r = await runPrivacySweep({ reason: body.reason || "schedule" });
  // Another sweep holds the lock (a manual run, a continuation): try again shortly rather than lose
  // this one — its queuedAt would otherwise hold the daily check off for a day.
  if (r?.ok === false && r.reason === "running") await pushSweep(body.reason || "schedule", Date.now() + 120000);
}

// ── KVS, with backoff on rate limits (review 2026-10-05, d) ─────────────────────────────────

/** PURE. Is this a KVS rate-limit refusal? */
export const isRateLimited = (e) => e?.responseDetails?.status === 429 || e?.status === 429 || /RATE_LIMIT|TOO_MANY_REQUESTS/i.test(String(e?.code || ""));

async function withBackoff(fn, { tries = 6 } = {}) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (!isRateLimited(e) || i >= tries - 1) throw e;
      await sleep(Math.min(16000, 500 * 2 ** i));
    }
  }
}

/** Stream every KVS row with its expiry: `onRow({ key, value, expireTime })`. */
async function scanKvs(onRow, { maxPages = 5000 } = {}) {
  let cursor = null;
  for (let i = 0; i < maxPages; i++) {
    let q = kvs.query({ metadataFields: [MetadataField.EXPIRE_TIME] }).limit(100);
    if (cursor) q = q.cursor(cursor);
    const { results, nextCursor } = await withBackoff(() => q.getMany());
    for (const r of results || []) await onRow(r);
    if (!nextCursor) return;
    cursor = nextCursor;
  }
  throw new Error(`KVS scan stopped at ${maxPages} pages`);
}

/** Rewrite a row without turning a ttl'd row permanent. A row already past its expiry is left to die. */
async function setPreserving(key, value, expireTime) {
  const ms = typeof expireTime === "number" ? expireTime : Date.parse(expireTime || "");
  if (!Number.isFinite(ms)) return withBackoff(() => kvs.set(key, value));
  const left = Math.ceil((ms - Date.now()) / 1000);
  if (left <= 0) return undefined;
  return withBackoff(() => kvs.set(key, value, { ttl: { value: left, unit: "SECONDS" } }));
}

// ── the account index ───────────────────────────────────────────────────────────────────────

async function readIndex() {
  const out = {};
  let cursor = null;
  for (let i = 0; i < 200; i++) {
    let q = kvs.query().where("key", WhereConditions.beginsWith(INDEX_PREFIX)).limit(100);
    if (cursor) q = q.cursor(cursor);
    const { results, nextCursor } = await withBackoff(() => q.getMany());
    for (const r of results || []) Object.assign(out, r.value || {});
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return out;
}

/**
 * Save the index; only chunks whose content changed since `written` (a Map chunk key → JSON) are
 * written, so saving after every report batch costs one or two KVS writes (review 2026-10-05, C2).
 */
async function writeIndex(index, written = new Map()) {
  const entries = Object.entries(index).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const chunks = batches(entries, INDEX_CHUNK);
  for (let i = 0; i < chunks.length; i++) {
    const k = `${INDEX_PREFIX}${String(i).padStart(4, "0")}`;
    const json = JSON.stringify(chunks[i]);
    if (written.get(k) === json) continue;
    await withBackoff(() => kvs.set(k, Object.fromEntries(chunks[i])));
    written.set(k, json);
  }
  // Drop chunks the index no longer fills.
  for (let i = chunks.length; i < chunks.length + 50; i++) {
    const k = `${INDEX_PREFIX}${String(i).padStart(4, "0")}`;
    if (!(await withBackoff(() => kvs.get(k)))) break;
    await withBackoff(() => kvs.delete(k));
    written.delete(k);
  }
}

// ── Atlassian's reporting API ───────────────────────────────────────────────────────────────

/**
 * POST /app/report-accounts as the app. Called directly rather than through @forge/api's
 * privacy.reportPersonalData, which returns only the body and drops the response headers — and
 * Atlassian may answer a `Cycle-Period` the app must follow instead of 7 days (review 2026-10-05, a).
 * Resolves { accounts, cycleMs } (200 → the accounts to act on, 204 → none); rejects with
 * { status, headers } on anything else, like the wrapper did.
 */
export async function reportAccounts(batch) {
  if (!batch.length) return { accounts: [], cycleMs: null };
  const res = await __requestAtlassianAsApp("/app/report-accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accounts: batch.slice(0, 90) }),
  });
  const cycleMs = parseCyclePeriod(res.headers?.get?.("Cycle-Period"));
  if (res.status === 200) return { accounts: (await res.json())?.accounts || [], cycleMs };
  if (res.status === 204) return { accounts: [], cycleMs };
  const err = new Error(`report-accounts answered ${res.status}`);
  err.status = res.status;
  err.headers = res.headers;
  throw err;
}

/** PURE. A reporter's result → { accounts, cycleMs } (a bare array is the old shape). */
export const normaliseReport = (res) => (Array.isArray(res) ? { accounts: res, cycleMs: null } : { accounts: res?.accounts || [], cycleMs: res?.cycleMs ?? null });

/** One batch (≤ 90), retrying a 429 after its Retry-After (capped). Throws on anything else. */
async function reportBatch(batch, report) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return normaliseReport(await report(batch));
    } catch (e) {
      const status = e?.status;
      if (status === 429 && attempt < 3) {
        const after = Number(e?.headers?.get?.("Retry-After"));
        await sleep(Math.min(60, Number.isFinite(after) && after > 0 ? after : 10) * 1000);
        continue;
      }
      const err = new Error(`report-accounts answered ${status || errText(e)}`);
      err.status = status || null;
      throw err;
    }
  }
  throw new Error("report-accounts kept answering 429");
}

/**
 * PURE. A report-accounts refusal that means "the app may not call it" rather than a failure.
 * Measured 2026-10-04 on wolfaenpak dev (6.x): 401 — the call needs the `report:personal-data`
 * scope. 7.0.0 declares it (a major: site admins approve it on update), so a 401/403 is no longer
 * expected; if Atlassian still refuses, the sweep records `reporting: "not-permitted"`, does
 * everything else (retention, the strips), leaves every account due and is retried the next day.
 */
export const reportNotPermitted = (status) => status === 401 || status === 403;

/**
 * The app's own account id: the `app-account-id` row other capsules cache, or — when nothing has
 * cached it yet — looked up once as the app (`/wiki/rest/api/user/current`) and cached the same way
 * (review low 6). A failed lookup returns null: the sweep then cannot exclude it, and reporting the
 * app account is harmless (Atlassian answers nothing for it), so the sweep still runs.
 */
async function ownAccountId() {
  const cached = await kvs.get("app-account-id").catch(() => null);
  if (typeof cached === "string" && cached) return cached;
  try {
    const res = await asApp().requestConfluence(route`/wiki/rest/api/user/current`);
    if (res.ok) {
      const id = (await res.json())?.accountId;
      if (typeof id === "string" && id) { await kvs.set("app-account-id", id).catch(() => {}); return id; }
    }
  } catch (_) { /* not excluded this run */ }
  return null;
}

async function displayNameOf(accountId) {
  try {
    const res = await asApp().requestConfluence(route`/wiki/rest/api/user?accountId=${accountId}`);
    if (res.ok) { const d = await res.json(); return d?.displayName || d?.publicName || null; }
  } catch (_) { /* name stays */ }
  return null;
}

// ── Confluence-side copies ──────────────────────────────────────────────────────────────────

async function readPageProperty(pageId, key) {
  const res = await asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}/properties?key=${key}`);
  if (!res.ok) return null;
  const row = (await res.json())?.results?.[0];
  return row ? { id: String(row.id), version: row.version?.number || 1, value: row.value } : null;
}
async function putPageProperty(pageId, row, key, value) {
  const res = await asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}/properties/${row.id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value, version: { number: row.version + 1 } }),
  });
  return res.ok;
}
async function readSpaceProperty(spaceId, key) {
  const res = await asApp().requestConfluence(route`/wiki/api/v2/spaces/${spaceId}/properties?key=${key}`);
  if (!res.ok) return null;
  const row = (await res.json())?.results?.[0];
  return row ? { id: String(row.id), version: row.version?.number || 1, value: row.value } : null;
}
async function putSpaceProperty(spaceId, row, key, value) {
  const res = await asApp().requestConfluence(route`/wiki/api/v2/spaces/${spaceId}/properties/${row.id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value, version: { number: row.version + 1 } }),
  });
  return res.ok;
}

/** The `protection-` page property, rewritten to the whitelist with `closed` ids pseudonymised. */
async function scrubSealProperty(pageId, closed = []) {
  const row = await readPageProperty(pageId, "protection-");
  if (!row || !row.value || typeof row.value !== "object") return "absent";
  let v = row.value;
  let changed = sealPropertyNeedsScrub(v);
  for (const id of closed) { const r = rewriteAccount(v, id, { mode: "erase" }); v = r.value; changed = changed || r.changed; }
  if (!changed) return "clean";
  return (await putPageProperty(pageId, row, "protection-", sealPropertyValue(v))) ? "scrubbed" : "failed";
}

const RECEIPT_KEY = "sentinel-vault-receipt";
async function scrubReceipts({ pageIds, spaceKeys }, closed) {
  let scrubbed = 0;
  let failed = 0;
  const erase = (value) => {
    let v = value; let changed = false;
    for (const id of closed) { const r = rewriteAccount(v, id, { mode: "erase" }); v = r.value; changed = changed || r.changed; }
    return { v, changed };
  };
  for (const pageId of pageIds) {
    try {
      const row = await readPageProperty(pageId, RECEIPT_KEY);
      if (!row) continue;
      const { v, changed } = erase(row.value);
      if (changed) { if (await putPageProperty(pageId, row, RECEIPT_KEY, v)) scrubbed += 1; else failed += 1; }
    } catch (_) { failed += 1; }
  }
  if (spaceKeys.size) {
    const { spaceIdByKey } = await import("../config-api/mirror.js");
    for (const key of spaceKeys) {
      try {
        const spaceId = await spaceIdByKey(key);
        if (!spaceId) continue;
        const row = await readSpaceProperty(spaceId, RECEIPT_KEY);
        if (!row) continue;
        const { v, changed } = erase(row.value);
        if (changed) { if (await putSpaceProperty(spaceId, row, RECEIPT_KEY, v)) scrubbed += 1; else failed += 1; }
      } catch (_) { failed += 1; }
    }
  }
  return { scrubbed, failed };
}


// ── act on Atlassian's answer ───────────────────────────────────────────────────────────────

/**
 * Erase `closed`, refresh `updated` names. Returns counts and `renamed` (the ids whose new name
 * was actually fetched: only those move their updatedAt — review 2026-10-05, c). The backup is
 * NOT touched here: the caller hands it to the backup job (`privacy-erase`).
 */
async function applyAccountUpdates({ closed, updated, places }) {
  const out = { deletedRows: 0, rewrittenRows: 0, signatures: 0, sealProperties: 0, sectionPages: 0, receipts: null, namesRefreshed: 0, renamed: [] };
  const names = {};
  for (const id of updated) { const n = await displayNameOf(id); if (n) names[id] = n; }
  const renames = updated.filter((id) => names[id]);
  out.renamed = renames;
  const sealPages = new Set();
  const sectionPages = new Set();

  await scanKvs(async ({ key, value: scanned, expireTime }) => {
    if (key.startsWith(OWN_PREFIX)) return;
    if (holdsPageContent(key)) return; // page content baselines are never rewritten (accounts.js)
    if (closed.some((id) => keyNamesAccount(key, id))) {
      await withBackoff(() => kvs.delete(key));
      out.deletedRows += 1;
      if (key.startsWith("protection-") && scanned?.contentId) sealPages.add(String(scanned.contentId));
      if (key.startsWith("section-protection-") && scanned?.pageId) sectionPages.add(String(scanned.pageId));
      return;
    }
    if (scanned === undefined) return;
    if (![...closed, ...renames].some((id) => JSON.stringify(scanned).includes(id))) return;
    // Re-read right before rewriting: a seal released or a setting saved since the scan read
    // this row must not be undone by writing the scan's copy back (review 2026-10-04, P2).
    const value = await withBackoff(() => kvs.get(key));
    if (value === undefined || value === null) return;
    const json = JSON.stringify(value);
    let v = value;
    let changed = false;
    for (const id of closed) {
      if (!json.includes(id)) continue;
      const r = rewriteAccount(v, id, { mode: "erase", removeFromLists: removesFromLists(key) });
      v = r.value; changed = changed || r.changed;
    }
    for (const id of renames) {
      if (!json.includes(id)) continue;
      const r = rewriteAccount(v, id, { mode: "rename", newName: names[id] });
      if (r.changed) out.namesRefreshed += 1;
      v = r.value; changed = changed || r.changed;
    }
    if (!changed) return;
    await setPreserving(key, v, expireTime);
    out.rewrittenRows += 1;
    if (key.startsWith("protection-") && v?.contentId) sealPages.add(String(v.contentId));
    if (key.startsWith("section-protection-") && v?.pageId) sectionPages.add(String(v.pageId));
  });

  if (closed.length) {
    const { eraseSignature } = await import("../workflow/signature.js");
    for (const id of closed) { await eraseSignature(id); out.signatures += 1; }
    for (const pageId of sealPages) if ((await scrubSealProperty(pageId, closed).catch(() => "failed")) === "scrubbed") out.sealProperties += 1;
    const { refreshSectionContentProp } = await import("../section-seals/logic.js");
    for (const pageId of sectionPages) { await refreshSectionContentProp(pageId).catch(() => {}); out.sectionPages += 1; }
    out.receipts = await scrubReceipts(places, closed);
  }
  return out;
}

/**
 * Hand the backup's part of an erasure to the backup worker as its own job (review 2026-10-05,
 * C2: the sweep used to wait up to 240 s for the backup lease inline, inside its 900 s budget).
 * The ids wait in `privacy-erase-pending` (a privacy- row: never scanned, never backed up as
 * config); the job takes a fresh generation, drops older generations that name them outside page
 * content, then clears the ids it handled. One job at a time: a queued/running one is reused.
 */
async function queueBackupErasure(ids) {
  const { readJob } = await import("../backup/engine.js");
  const { startJob } = await import("../backup/worker.js");
  return makeQueueBackupErasure({ kvs, withLock, readJob, startJob, jobAlive })(ids);
}

/**
 * One sweep. One at a time (shared/kvs-lock.js; a dead run's lock is taken over); a second caller gets
 * { ok: false, reason: "running" }. Returns the summary it also stores in `privacy-status` — counts
 * only, never an account id. `report` is injectable for tests (default: reportAccounts above),
 * `budgetMs` the time after which it saves and hands the rest to a continuation event.
 */
export async function runPrivacySweep({ reason = "manual", nowMs = Date.now(), report = reportAccounts, budgetMs = SWEEP_BUDGET_MS } = {}) {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // A lock older than LOCK_MS is a dead run's and is taken over (shared/kvs-lock.js: an expired
  // ttl row can linger for hours and still refuse FAIL_IF_EXISTS).
  if (!(await acquireLock(LOCK_KEY, LOCK_MS, token).catch(() => false))) return { ok: false, reason: "running" };
  const t0 = Date.now();
  const clock = () => nowMs + (Date.now() - t0); // the sweep's own time, shifted like nowMs
  const overBudget = () => Date.now() - t0 > budgetMs;
  const startedAt = nowIso();
  const summary = {
    ok: true, reason, startedAt, finishedAt: null, retentionDays: null, scanned: 0,
    retention: { activity: 0, workflowLog: 0, readAck: 0 },
    accounts: { stored: 0, due: 0, reported: 0, closed: 0, updated: 0 },
    erasure: null, migration: null, error: null,
  };
  const prevStatus = (await kvs.get(STATUS_KEY).catch(() => null)) || {};
  let cycleMs = Number(prevStatus.cycleMs) > 0 ? Number(prevStatus.cycleMs) : CYCLE_MS;
  let index = null;
  const written = new Map();
  let handOff = false;
  let touched = 0;
  try {
    const settings = await kvs.get("admin-settings-global").catch(() => null);
    const days = effectiveRetentionDays(
      readEffective("historyRetentionEnabled", settings?.historyRetentionEnabled),
      readEffective("historyRetentionDays", settings?.historyRetentionDays));
    summary.retentionDays = days;
    const migrations = (await kvs.get(MIGRATIONS_KEY).catch(() => null)) || {};
    // The app's own account (the bot that writes restores) is not a person to report or erase (b).
    const appAccountId = await ownAccountId();
    const exclude = typeof appAccountId === "string" ? [appAccountId] : [];
    const prior = await readIndex();
    const closedIds = Object.entries(prior).filter(([id, e]) => e?.c && !exclude.includes(id)).map(([id]) => id);
    const done = {}; // migration flags this run completed

    const seen = new Set();
    const stillErasable = new Set(); // closed ids a non-content row still names
    const sealPages = new Set();
    const places = { pageIds: new Set(), spaceKeys: new Set() };
    let emailStripped = 0;
    let rostersStripped = 0;

    // Pass 1: retention, the email strips, and the inventory.
    // The email strips run on EVERY sweep, not once (review 2026-10-04): a restore or an import of a
    // backup taken before them writes the addresses back. Both are idempotent and only re-read a
    // row they would change.
    await scanKvs(async ({ key, value, expireTime }) => {
      summary.scanned += 1;
      if (key.startsWith(OWN_PREFIX)) return;
      if (isPastRetention(key, value, nowMs, days)) {
        await withBackoff(() => kvs.delete(key));
        summary.retention[retainedFamily(key)] += 1;
        touched += 1;
        return;
      }
      let v = value;
      // Decide on the scanned copy, then re-read and strip the FRESH row, so a seal released or a
      // setting saved since the scan is never written back (review P2).
      if (stripLegacyEmail(key, v).changed) {
        const fresh = await withBackoff(() => kvs.get(key));
        const s = fresh ? stripLegacyEmail(key, fresh) : { changed: false };
        if (s.changed) { v = s.value; await setPreserving(key, v, expireTime); emailStripped += 1; touched += 1; }
      }
      if (stripRosterContact(key, v).changed) {
        const fresh = await withBackoff(() => kvs.get(key));
        const s = fresh ? stripRosterContact(key, fresh) : { changed: false };
        if (s.changed) { v = s.value; await setPreserving(key, v, expireTime); rostersStripped += 1; touched += 1; }
      }
      for (const id of extractAccountIds(key, v)) seen.add(id);
      if (closedIds.length) for (const id of erasableMentions(key, v, closedIds)) stillErasable.add(id);
      if (key.startsWith("protection-") && v?.contentId) sealPages.add(String(v.contentId));
      if (key.startsWith("admin-settings-space-")) places.spaceKeys.add(key.slice("admin-settings-space-".length));
      if (key === "admin-settings-global" && v?.apiReceiptPageId) places.pageIds.add(String(v.apiReceiptPageId));
      if (key.startsWith("api-job-")) {
        const rp = v?.bundle?.receiptPageId || v?.bundle?.site?.receiptPageId;
        if (rp) places.pageIds.add(String(rp));
      }
    });

    // One-time migration of the 6.6.0-era seal page properties.
    if (!migrations.sealPropsV1) {
      const m = { pages: sealPages.size, scrubbed: 0, failed: 0, emailStripped, rostersStripped };
      for (const pageId of sealPages) {
        const r = await scrubSealProperty(pageId).catch(() => "failed");
        if (r === "scrubbed") m.scrubbed += 1;
        if (r === "failed") m.failed += 1;
      }
      summary.migration = m;
      if (!m.failed) done.sealPropsV1 = nowIso();
    } else {
      summary.migration = { emailStripped, rostersStripped };
    }
    if (!migrations.sealEmailV1) done.sealEmailV1 = nowIso();
    if (!migrations.rosterEmailV2) done.rosterEmailV2 = nowIso();
    if (Object.keys(done).length) await kvs.set(MIGRATIONS_KEY, { ...migrations, ...done });

    // Report what is due (≤ once per cycle per account), 90 at a time, saving after each batch.
    const plan = planReport(prior, seen, nowMs, { cycleMs, exclude });
    index = plan.index;
    summary.accounts.stored = Object.values(index).filter((e) => !e.c).length;
    summary.accounts.due = plan.due.length;
    const newlyClosed = [];
    const updated = [];
    try {
      for (const batch of batches(plan.due)) {
        if (overBudget()) { handOff = true; break; }
        const res = await reportBatch(batch, report);
        const at = new Date(clock()).toISOString(); // stamped when Atlassian answered, never before
        if (res.cycleMs) cycleMs = res.cycleMs;
        const { closed, updated: upd } = acceptAnswers(batch, res.accounts);
        for (const a of batch) index[a.accountId] = { ...index[a.accountId], r: at };
        for (const id of closed) { index[id] = { ...index[id], c: at, x: null }; newlyClosed.push(id); }
        // `n`: a name refresh is owed. It survives a hand-off or a failed name lookup (c).
        for (const id of upd) index[id] = { ...index[id], n: 1 };
        updated.push(...upd);
        summary.accounts.reported += batch.length;
        await writeIndex(index, written);
      }
      summary.accounts.reporting = handOff ? "partial" : "done";
    } catch (e) {
      if (reportNotPermitted(e?.status)) {
        summary.accounts.reporting = "not-permitted";
        console.warn(`[PRIVACY] report-accounts refused (${e.status}) although the manifest declares report:personal-data; every account stays due`);
      } else {
        summary.ok = false;
        summary.error = errText(e);
        summary.accounts.reporting = "failed";
      }
    }
    summary.accounts.closed = newlyClosed.length;
    summary.accounts.updated = updated.length;

    // Erase: newly closed, closed ones whose erasure never finished (x unset), and closed ones a
    // restore or an import brought back into erasable rows. Never because of page content alone.
    const unfinished = Object.entries(index).filter(([, e]) => e?.c && !e.x).map(([id]) => id);
    const toErase = [...new Set([...newlyClosed, ...unfinished, ...stillErasable])];
    const toRename = Object.entries(index).filter(([, e]) => e?.n && !e.c).map(([id]) => id);
    if ((toErase.length || toRename.length) && !overBudget()) {
      summary.erasure = await applyAccountUpdates({ closed: toErase, updated: toRename, places });
      const changes = summary.erasure.deletedRows + summary.erasure.rewrittenRows;
      touched += changes;
      const erasedAt = new Date(clock()).toISOString();
      for (const id of toErase) if (index[id]) index[id] = { ...index[id], x: erasedAt };
      // The data was retrieved again only where the new name actually came back (c).
      for (const id of summary.erasure.renamed) if (index[id] && !index[id].c) { const { n: _n, ...e } = index[id]; index[id] = { ...e, u: erasedAt }; }
      summary.erasure.renamed = summary.erasure.renamed.length; // counts only in the status row
      // The backup: a first erasure always (older generations may name them); a repeat only when
      // rows actually changed. Page content alone never queues one.
      const forBackup = [...new Set([...newlyClosed, ...unfinished, ...(changes > 0 ? [...stillErasable] : [])])];
      if (forBackup.length) summary.erasure.backup = await queueBackupErasure(forBackup).catch((e) => ({ error: errText(e) }));
      // The backup's part could not be handed over (the pending lock busy, a failed read, a failed
      // write): these ids are NOT erased yet — x goes back to null so the next sweep re-erases and
      // re-queues them (review blocking). Their KVS rows are already clean, so that repeat is cheap.
      index = settleBackupHandOff(index, forBackup, summary.erasure.backup);
    } else if (toErase.length || toRename.length) {
      handOff = true;
    }
    // A pending backup erasure whose job died is restarted.
    if (!summary.erasure?.backup) {
      const pending = await kvs.get(ERASE_PENDING_KEY).catch(() => null);
      if (pending?.ids?.length) summary.erasureBackup = await queueBackupErasure([]).catch((e) => ({ error: errText(e) }));
    }
    await writeIndex(index, written);
  } catch (e) {
    summary.ok = false;
    summary.error = errText(e);
    console.error("[PRIVACY] sweep failed:", e);
    if (index) await writeIndex(index, written).catch(() => {});
  } finally {
    summary.finishedAt = nowIso();
    // The backup holds this data too: a sweep that changed anything schedules one (debounced).
    if (touched > 0) await scheduleBackup("privacy").catch(() => {});
    const nra = index ? nextReportAt(index, cycleMs) : prevStatus.nextReportAt || null;
    // A failed run does not advance lastRunAt, so tomorrow's daily check tries again.
    await kvs.set(STATUS_KEY, {
      ...prevStatus, lastRunAt: summary.ok ? summary.finishedAt : prevStatus.lastRunAt || null, lastAttemptAt: summary.finishedAt,
      queuedAt: null, nextReportAt: nra, cycleMs, last: summary,
    }).catch(() => {});
    await releaseLock(LOCK_KEY, token);
    // Hand-off: the rest runs in a fresh invocation. A report falling due within the window (a
    // later batch of a multi-batch site) is waited for the same way the daily check would.
    try {
      if (handOff) await queueContinuation("continue", null);
      // Only after a report that went through and only for a moment still ahead: a refused or
      // failed report leaves past due dates, which the daily check retries, never a tight loop.
      else if (summary.accounts.reporting === "done" && nra && Date.parse(nra) > Date.now() && Date.parse(nra) - Date.now() < DUE_WINDOW_MS) await queueContinuation("due", Date.parse(nra) + DUE_MARGIN_MS);
    } catch (e) { console.error("[PRIVACY] could not queue the continuation:", e); }
  }
  console.log(`[PRIVACY] sweep reason=${reason} scanned=${summary.scanned} retention=${JSON.stringify(summary.retention)} accounts=${JSON.stringify(summary.accounts)} handOff=${handOff} ok=${summary.ok}${summary.error ? ` error=${summary.error}` : ""}`);
  return summary;
}

async function queueContinuation(reason, notBefore) {
  const st = (await kvs.get(STATUS_KEY).catch(() => null)) || {};
  await kvs.set(STATUS_KEY, { ...st, queuedAt: nowIso() });
  await pushSweep(reason, notBefore);
}
