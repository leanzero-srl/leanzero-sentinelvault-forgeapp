/*
 * Privacy sweep — the weekly job (queue `privacy-queue`, 900 s).
 *
 *   1. retention    delete activity history, workflow history and read confirmations older than
 *                   the site's `historyRetentionDays` (retention.js)
 *   2. inventory    every account id the app stores (accounts.js extractAccountIds), with the
 *                   time the app first held it, kept in `privacy-accounts-<n>`
 *   3. report       Atlassian's Personal Data Reporting API (privacy.reportPersonalData) for the
 *                   ids not reported in the last 7 days, 90 per request, honouring a 429
 *   4. act          `closed`: erase the person across KVS (their own rows deleted, every other
 *                   mention pseudonymised, removed from rosters), the KVS secret namespace (their
 *                   authenticator), the page properties the app writes (`protection-`,
 *                   `section-protection-`, API receipts) and the backup page (a fresh scrubbed
 *                   generation, then every older generation that still names them is dropped).
 *                   `updated`: the stored display names are refreshed.
 *   5. migration    once: the 6.6.0-era `protection-` page properties (email, name, note) are
 *                   rewritten to the whitelist (sealing/seal-property.js) and `lockedByEmail` is
 *                   dropped from the seal records.
 *
 * Scheduling: Forge allows 5 scheduled triggers and this app uses all 5, so the weekly run rides
 * the DAILY recurring-nudge trigger (boot.js → privacySweepCheck): once a day it queues a sweep
 * when the last one is older than six and a half days. A site admin can run it at once (Site
 * settings → Privacy and retention, resolver `privacy-run-now`) and over REST (config-api op
 * `privacy-sweep`); either way an account is reported at most once per 7-day cycle, as Atlassian
 * asks. Like the backup, it runs only in the Confluence installation: the app is also installed
 * in Jira for the JSM Assets scopes, and that store holds nothing of this.
 */
import { kvs, MetadataField, WhereConditions } from "@forge/kvs";
import { Queue } from "@forge/events";
import { asApp, route, privacy } from "@forge/api";
import { readEffective } from "../policies/settings-schema.js";
import { isPastRetention, retainedFamily } from "./retention.js";
import {
  extractAccountIds, rewriteAccount, removesFromLists, keyNamesAccount, stripLegacyEmail, stripRosterContact, planReport, batches,
} from "./accounts.js";
import { scheduleBackup } from "../backup/hook.js";
import { sealPropertyValue, sealPropertyNeedsScrub } from "../sealing/seal-property.js";

export const PRIVACY_QUEUE_KEY = "privacy-queue";
export const STATUS_KEY = "privacy-status";
const LOCK_KEY = "privacy-lock";
const INDEX_PREFIX = "privacy-accounts-";
const MIGRATIONS_KEY = "privacy-migrations";
const INDEX_CHUNK = 1500; // ~110 bytes an entry → well under the KVS value limit
const LOCK_MS = 16 * 60000; // > the 900 s consumer timeout: a killed run frees it on its own
export const SWEEP_EVERY_MS = 6.5 * 86400000;
const nowIso = () => new Date().toISOString();
const errText = (e) => String(e?.message || e).slice(0, 300);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** PURE. Does this invocation belong to the Confluence installation? Unknown context → yes. */
export const isConfluenceInstall = (context) => {
  const ic = String(context?.installContext || "");
  return !ic || ic.includes(":confluence::");
};

/** PURE. Is a scheduled sweep due, given the status row? */
export function sweepDue(status, nowMs = Date.now()) {
  const last = Date.parse(status?.lastRunAt || status?.queuedAt || "");
  return !Number.isFinite(last) || nowMs - last >= SWEEP_EVERY_MS;
}

/** Daily check (boot.js, after the recurring-nudge task). Never throws. */
export async function privacySweepCheck(context) {
  try {
    if (!isConfluenceInstall(context)) return;
    const status = (await kvs.get(STATUS_KEY)) || {};
    if (!sweepDue(status)) return;
    await kvs.set(STATUS_KEY, { ...status, queuedAt: nowIso() });
    await new Queue({ key: PRIVACY_QUEUE_KEY }).push({ body: { kind: "sweep", reason: "schedule" } });
  } catch (e) {
    console.error("[PRIVACY] daily check failed:", e);
  }
}

/** Queue a sweep now (the admin button). */
export async function queuePrivacySweep(reason = "manual") {
  const status = (await kvs.get(STATUS_KEY)) || {};
  await kvs.set(STATUS_KEY, { ...status, queuedAt: nowIso() });
  await new Queue({ key: PRIVACY_QUEUE_KEY }).push({ body: { kind: "sweep", reason } });
}

export async function privacyConsumer(event) {
  const body = event?.body || event?.payload || {};
  if (body.kind !== "sweep") { console.warn("[PRIVACY] consumer: unknown event", JSON.stringify(body).slice(0, 200)); return; }
  await runPrivacySweep({ reason: body.reason || "schedule" });
}

/** Stream every KVS row with its expiry: `onRow({ key, value, expireTime })`. */
async function scanKvs(onRow, { maxPages = 5000 } = {}) {
  let q = kvs.query({ metadataFields: [MetadataField.EXPIRE_TIME] }).limit(100);
  for (let i = 0; i < maxPages; i++) {
    const { results, nextCursor } = await q.getMany();
    for (const r of results || []) await onRow(r);
    if (!nextCursor) return;
    q = kvs.query({ metadataFields: [MetadataField.EXPIRE_TIME] }).limit(100).cursor(nextCursor);
  }
  throw new Error(`KVS scan stopped at ${maxPages} pages`);
}

/** Rewrite a row without turning a ttl'd row permanent. A row already past its expiry is left to die. */
async function setPreserving(key, value, expireTime) {
  const ms = typeof expireTime === "number" ? expireTime : Date.parse(expireTime || "");
  if (!Number.isFinite(ms)) return kvs.set(key, value);
  const left = Math.ceil((ms - Date.now()) / 1000);
  if (left <= 0) return undefined;
  return kvs.set(key, value, { ttl: { value: left, unit: "SECONDS" } });
}

// ── the account index ───────────────────────────────────────────────────────────────────────

async function readIndex() {
  const out = {};
  let q = kvs.query().where("key", WhereConditions.beginsWith(INDEX_PREFIX)).limit(100);
  for (let i = 0; i < 200; i++) {
    const { results, nextCursor } = await q.getMany();
    for (const r of results || []) Object.assign(out, r.value || {});
    if (!nextCursor) break;
    q = kvs.query().where("key", WhereConditions.beginsWith(INDEX_PREFIX)).limit(100).cursor(nextCursor);
  }
  return out;
}

async function writeIndex(index) {
  const entries = Object.entries(index);
  const chunks = batches(entries, INDEX_CHUNK);
  for (let i = 0; i < chunks.length; i++) await kvs.set(`${INDEX_PREFIX}${String(i).padStart(4, "0")}`, Object.fromEntries(chunks[i]));
  // Drop chunks the index no longer fills.
  for (let i = chunks.length; i < chunks.length + 50; i++) {
    const k = `${INDEX_PREFIX}${String(i).padStart(4, "0")}`;
    if (!(await kvs.get(k))) break;
    await kvs.delete(k);
  }
}

// ── Atlassian's reporting API ───────────────────────────────────────────────────────────────

/** One batch (≤ 90), retrying a 429 after its Retry-After (capped). Throws on anything else. */
async function reportBatch(batch, report) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await report(batch);
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
 * PURE. A report-accounts refusal that means "this app version may not call it" rather than a
 * failure. Measured 2026-10-04 on wolfaenpak dev: 401 — the call needs the `report:personal-data`
 * scope, which the manifest does not hold (adding a scope is a major version and an admin
 * re-consent). Until then the sweep records `reporting: "not-permitted"`, keeps its weekly
 * cadence, and does everything else (retention, the migration, erasure of what it is told).
 */
export const reportNotPermitted = (status) => status === 401 || status === 403;

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

async function applyAccountUpdates({ closed, updated, places }) {
  const out = { deletedRows: 0, rewrittenRows: 0, signatures: 0, sealProperties: 0, sectionPages: 0, receipts: null, backup: null, namesRefreshed: 0 };
  const names = {};
  for (const id of updated) { const n = await displayNameOf(id); if (n) names[id] = n; }
  const renames = updated.filter((id) => names[id]);
  const sealPages = new Set();
  const sectionPages = new Set();

  await scanKvs(async ({ key, value, expireTime }) => {
    if (key.startsWith(INDEX_PREFIX) || key === STATUS_KEY || key === LOCK_KEY) return;
    if (closed.some((id) => keyNamesAccount(key, id))) {
      await kvs.delete(key);
      out.deletedRows += 1;
      if (key.startsWith("protection-") && value?.contentId) sealPages.add(String(value.contentId));
      if (key.startsWith("section-protection-") && value?.pageId) sectionPages.add(String(value.pageId));
      return;
    }
    if (value === undefined) return;
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
    out.backup = await eraseFromBackup(closed);
  }
  return out;
}

/** A fresh (scrubbed) generation, then every older one that still names a closed account goes. */
async function eraseFromBackup(closed) {
  const { SETTINGS_KEY, runBackup, purgeGenerationsMentioning } = await import("../backup/engine.js");
  const settings = await kvs.get(SETTINGS_KEY).catch(() => null);
  if (!settings?.pageId) return { skipped: "no backup on this site" };
  const { withLease } = await import("../backup/worker.js");
  try {
    return await withLease(async () => {
      const b = await runBackup({ reason: "privacy", actor: null });
      if (!b.ok) return { error: `backup failed: ${b.reason || "unknown"}` };
      const p = await purgeGenerationsMentioning(closed);
      return { generationId: b.generationId || null, dropped: p.dropped, kept: p.kept, newestMentions: p.newestMentions };
    }, { waitMs: 240000 });
  } catch (e) {
    return { error: errText(e) };
  }
}

/**
 * One sweep. One at a time (an atomic FAIL_IF_EXISTS lock); a second caller gets
 * { ok: false, reason: "running" }. Returns the summary it also stores in `privacy-status` — counts
 * only, never an account id. `report` is injectable for tests (default: @forge/api privacy).
 */
export async function runPrivacySweep({ reason = "manual", nowMs = Date.now(), report = (b) => privacy.reportPersonalData(b) } = {}) {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await kvs.set(LOCK_KEY, { token, at: nowIso() }, { ttl: { value: Math.ceil(LOCK_MS / 1000), unit: "SECONDS" }, keyPolicy: "FAIL_IF_EXISTS" });
  } catch (_) {
    return { ok: false, reason: "running" };
  }
  const startedAt = nowIso();
  const summary = {
    ok: true, reason, startedAt, finishedAt: null, retentionDays: null, scanned: 0,
    retention: { activity: 0, workflowLog: 0, readAck: 0 },
    accounts: { stored: 0, due: 0, reported: 0, closed: 0, updated: 0 },
    erasure: null, migration: null, error: null,
  };
  let touched = 0;
  try {
    const settings = await kvs.get("admin-settings-global").catch(() => null);
    const days = readEffective("historyRetentionDays", settings?.historyRetentionDays);
    summary.retentionDays = days;
    const migrations = (await kvs.get(MIGRATIONS_KEY).catch(() => null)) || {};
    const stripEmail = !migrations.sealEmailV1;
    const stripRoster = !migrations.rosterEmailV1;
    const done = {}; // migration flags this run completed

    const seen = new Set();
    const sealPages = new Set();
    const places = { pageIds: new Set(), spaceKeys: new Set() };
    let emailStripped = 0;
    let rostersStripped = 0;

    // Pass 1: retention, the one-time email strip, and the inventory.
    await scanKvs(async ({ key, value, expireTime }) => {
      summary.scanned += 1;
      if (key.startsWith(INDEX_PREFIX) || key === STATUS_KEY || key === LOCK_KEY) return;
      if (isPastRetention(key, value, nowMs, days)) {
        await kvs.delete(key);
        summary.retention[retainedFamily(key)] += 1;
        touched += 1;
        return;
      }
      let v = value;
      if (stripEmail) {
        const s = stripLegacyEmail(key, v);
        if (s.changed) { v = s.value; await setPreserving(key, v, expireTime); emailStripped += 1; touched += 1; }
      }
      if (stripRoster) {
        const s = stripRosterContact(key, v);
        if (s.changed) { v = s.value; await setPreserving(key, v, expireTime); rostersStripped += 1; touched += 1; }
      }
      for (const id of extractAccountIds(key, v)) seen.add(id);
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
    } else if (stripEmail || stripRoster) {
      summary.migration = { emailStripped, rostersStripped };
    }
    if (stripEmail) done.sealEmailV1 = nowIso();
    if (stripRoster) done.rosterEmailV1 = nowIso();
    if (Object.keys(done).length) await kvs.set(MIGRATIONS_KEY, { ...migrations, ...done });

    // Report what is due (≤ once per 7 days per account), 90 at a time.
    const plan = planReport(await readIndex(), seen, nowMs);
    summary.accounts.stored = Object.keys(plan.index).length;
    summary.accounts.due = plan.due.length;
    const answers = [];
    const reportedAt = new Date(nowMs).toISOString();
    try {
      for (const batch of batches(plan.due)) {
        const res = await reportBatch(batch, report);
        for (const a of batch) plan.index[a.accountId].r = reportedAt;
        summary.accounts.reported += batch.length;
        answers.push(...(Array.isArray(res) ? res : []));
      }
      summary.accounts.reporting = "done";
    } catch (e) {
      if (reportNotPermitted(e?.status)) {
        summary.accounts.reporting = "not-permitted";
        console.warn(`[PRIVACY] report-accounts refused (${e.status}): the report:personal-data scope is not in this version's manifest`);
      } else {
        summary.ok = false;
        summary.error = errText(e);
        summary.accounts.reporting = "failed";
      }
    }
    const closed = [...new Set(answers.filter((a) => a?.status === "closed" && a.accountId).map((a) => a.accountId))];
    const updated = [...new Set(answers.filter((a) => a?.status === "updated" && a.accountId).map((a) => a.accountId))].filter((id) => !closed.includes(id));
    summary.accounts.closed = closed.length;
    summary.accounts.updated = updated.length;
    if (closed.length || updated.length) {
      summary.erasure = await applyAccountUpdates({ closed, updated, places });
      touched += summary.erasure.deletedRows + summary.erasure.rewrittenRows;
    }
    for (const id of closed) delete plan.index[id];
    for (const id of updated) if (plan.index[id]) plan.index[id].u = reportedAt; // the data was retrieved again
    await writeIndex(plan.index);
  } catch (e) {
    summary.ok = false;
    summary.error = errText(e);
    console.error("[PRIVACY] sweep failed:", e);
  } finally {
    summary.finishedAt = nowIso();
    // The backup holds this data too: a sweep that changed anything schedules one (debounced).
    if (touched > 0) await scheduleBackup("privacy").catch(() => {});
    const prev = (await kvs.get(STATUS_KEY).catch(() => null)) || {};
    // A failed run does not advance lastRunAt, so tomorrow's daily check tries again.
    await kvs.set(STATUS_KEY, { ...prev, lastRunAt: summary.ok ? summary.finishedAt : prev.lastRunAt || null, lastAttemptAt: summary.finishedAt, queuedAt: null, last: summary }).catch(() => {});
    const cur = await kvs.get(LOCK_KEY).catch(() => null);
    if (cur?.token === token) await kvs.delete(LOCK_KEY).catch(() => {});
  }
  console.log(`[PRIVACY] sweep reason=${reason} scanned=${summary.scanned} retention=${JSON.stringify(summary.retention)} accounts=${JSON.stringify(summary.accounts)} ok=${summary.ok}${summary.error ? ` error=${summary.error}` : ""}`);
  return summary;
}
