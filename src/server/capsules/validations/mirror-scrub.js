/*
 * One-time scrub of the `sentinel-vault-validation` page property (8.15.0, 2026-10-21).
 *
 * Before 8.14.0 the page property WAS the validation status, and it carried who checked the page
 * (`checkedBy`) and who approved it anyway (`approvedBy`): account ids. Since 8.14.0 the status lives in
 * KVS `validation-state-{pageId}` and the property is a mirror without ids (validationMirrorValue), but
 * an old property was rewritten only when its page's status was next stored. This job rewrites every
 * old one Sentinel Vault can read, once:
 *
 *   - a page with a KVS status gets its mirror rewritten FROM that status (the authority);
 *   - a page with only the old property keeps its verdict for CQL readers, minus the ids
 *     (validationMirrorValue of the old value). The panel never reads the property, so what it
 *     shows does not change.
 *
 * Which pages (only pages: every writer read the property through the v2 /pages/{id}/properties
 * endpoint first and gave up when that read failed, and that read answers 404 for a blog post):
 *   phase "search"    /wiki/rest/api/search with includeArchivedSpaces=true, the property expanded
 *                     inline, 100 per request: current pages in every space, archived spaces included
 *                     (content/search leaves those out: the personal spaces of people who left);
 *   phase "archived"  /wiki/api/v2/pages?status=archived, each page's property read on its own (CQL never
 *                     returns these, and the v1 content list answers 410 Gone to an app). Confluence
 *                     refuses changes to an archived page, so an old one is counted (archivedLeft) and
 *                     rewritten when the page leaves the archive (scrubOnePageMirror, from the trigger);
 *   phase "trashed"   /wiki/api/v2/pages?status=trashed, the same way;
 *   phase "retry"     the pages whose write failed, re-read one by one, at most RETRY_ROUNDS times,
 *                     each at least an hour after the last; what still fails then is counted as
 *                     skipped and logged, and the job ends (a page the app may not write can never
 *                     hold the run open).
 *
 * The Confluence rate limit is shared by every site (confluence-call.js, the 2026-10-18 outage): a 429
 * waits until the next hour, a failed list backs off from 5 minutes to an hour, and a write that loses
 * a version race (409) is re-read once instead of restarting anything. The phase, cursor, failed ids
 * and any wait are saved after every batch in `privacy-validation-scrub` (a privacy- row: never
 * scanned for people, never erased, never backed up). Idempotent: a clean property is left alone.
 * The caller (privacy/worker.js) records `validationMirrorV1` in `privacy-migrations` when it is done,
 * and nothing runs after that.
 */
import { kvs } from "@forge/kvs";
import { route } from "@forge/api";
import { appConfluence, rateLimitInfo } from "../../shared/confluence-call.js";
import { validationMirrorValue, VALIDATION_STATE_PREFIX } from "./logic.js";
import { errText } from "../../shared/action-log.js";

export const SCRUB_STATE_KEY = "privacy-validation-scrub";
export const SCRUB_FLAG = "validationMirrorV1"; // in privacy-migrations
export const SCRUB_LOCK_KEY = "privacy-validation-scrub-lock";
/** Archived pages left as they were (Confluence refuses changes): re-tried weekly, besides the unarchive event. */
export const ARCHIVED_LEFT_KEY = "privacy-validation-scrub-archived";
export const ARCHIVED_LEFT_CAP = 2000;
export const ARCHIVED_RECHECK_PER_SWEEP = 200;
export const RETRY_ROUNDS = 3;
export const RETRY_AFTER_MS = 3600000;
export const FAILED_CAP = 500;
/** Pages a site walks per hour: the Confluence pool is shared by every site, so a big site takes hours, never the pool. */
export const HOURLY_PAGES = 3000;
/** The share in force: HOURLY_PAGES, or the environment variable SV_SCRUB_HOURLY_PAGES where one is set (the
 * development environment, so a test can walk a whole test site in minutes). Production sets none. */
export const HOURLY_PAGES_MAX = 20000; // a mistaken production setting can never undo the pacing
export const hourlyPages = () => { const v = Number(process.env.SV_SCRUB_HOURLY_PAGES); return Number.isFinite(v) && v >= 100 ? Math.min(v, HOURLY_PAGES_MAX) : HOURLY_PAGES; };
/** A list that keeps failing this many times in a row is given up (recorded as a skipped phase). */
export const LIST_FAILURES_MAX = 24;
const JITTER_MS = 15 * 60000;
const PROP = "sentinel-vault-validation";
const MIRROR_FIELDS = new Set(["state", "violations", "version", "checkedAt", "approvedAt", "rulesFp", "source", "approved"]);
const LIST_PHASES = ["search", "archived", "trashed"];
const CQL = "type = page order by id";
const EXPAND_SEARCH = `content.metadata.properties.${PROP}`;

/** PURE. Does a stored property value carry anything a mirror may not (an account id field above all)? */
export function mirrorNeedsScrub(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).some((k) => !MIRROR_FIELDS.has(k));
}

/** PURE. The `cursor` query parameter of a Confluence `next` link, or null. */
export function cursorOf(nextLink) {
  if (!nextLink || typeof nextLink !== "string") return null;
  try { return new URL(nextLink, "https://x.invalid").searchParams.get("cursor"); } catch (_) { return null; }
}

/** PURE. The start of the next hour after `nowMs` (a 429 on the shared pool waits for its reset). */
export const nextHour = (nowMs) => (Math.floor(nowMs / 3600000) + 1) * 3600000;

/** After the next hour, plus up to 15 minutes, so sites that waited do not all start again together. */
const afterReset = (nowMs, rand = Math.random) => nextHour(nowMs) + Math.floor(rand() * JITTER_MS);
const nearLimit = (res) => { try { return String(rateLimitInfo(res).nearLimit || "").toLowerCase() === "true"; } catch (_) { return false; } };

/** PURE. The next back-off after a failed list: 5 minutes, doubling, at most an hour. */
export const nextBackoffS = (prev) => Math.min(3600, Math.max(300, (Number(prev) || 0) * 2));

const asProp = (p) => (p && p.id ? { id: String(p.id), version: p.version?.number || 1, value: p.value } : null);

async function cleanValueFor(pageId, oldValue) {
  let stored = null;
  try { stored = await kvs.get(`${VALIDATION_STATE_PREFIX}${pageId}`); } catch (_) { stored = null; }
  return validationMirrorValue(stored && typeof stored === "object" && !stored.unknown ? stored : oldValue);
}

async function putProperty(pageId, prop, value) {
  const res = await appConfluence(route`/wiki/api/v2/pages/${pageId}/properties/${prop.id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: PROP, value, version: { number: (Number(prop.version) || 1) + 1 } }),
  });
  return res.status;
}

// One page's property, read on its own: a lost version race and the retry round (never a decision;
// test/guard-marker-backfill.test.mjs lists this reader). undefined = could not be read.
async function readProperty(pageId) {
  const res = await appConfluence(route`/wiki/api/v2/pages/${pageId}/properties?key=${PROP}`);
  if (res.status === 404) return null;
  if (res.status === 429) return "limited";
  if (!res.ok) return undefined;
  return asProp((await res.json())?.results?.[0]) || null;
}

/** Scrub one page's property when it needs it. → "clean" | "scrubbed" | "failed" | "limited" */
async function scrubOne(pageId, prop) {
  if (!prop || !mirrorNeedsScrub(prop.value)) return "clean";
  try {
    let status = await putProperty(pageId, prop, await cleanValueFor(pageId, prop.value));
    if (status === 409) {
      // Someone wrote the property meanwhile (most likely the 8.14 writer, which leaves it clean).
      const fresh = await readProperty(pageId);
      if (fresh === "limited") return "limited";
      if (fresh === undefined) return "failed";
      if (!fresh || !mirrorNeedsScrub(fresh.value)) return "clean";
      status = await putProperty(pageId, fresh, await cleanValueFor(pageId, fresh.value));
    }
    if (status === 429) return "limited";
    if (status >= 200 && status < 300) return "scrubbed";
    // Confluence refuses any change to an ARCHIVED page's properties (v2 404, v1 403 — measured on
    // wolfaenpak, 2026-10-22): such a page is cleaned when it leaves the archive (scrubOnePageMirror).
    return status === 404 || status === 403 ? "refused" : "failed";
  } catch (e) {
    console.warn("[VALIDATION-MIRROR] rewrite failed:", errText(e));
    return "failed";
  }
}

/** One list batch. → { items: [{ pageId, prop }], next, status } */
async function fetchBatch(phase, cursor) {
  let res;
  if (phase === "search") {
    res = cursor
      ? await appConfluence(route`/wiki/rest/api/search?cql=${CQL}&includeArchivedSpaces=${"true"}&limit=${"100"}&expand=${EXPAND_SEARCH}&cursor=${cursor}`)
      : await appConfluence(route`/wiki/rest/api/search?cql=${CQL}&includeArchivedSpaces=${"true"}&limit=${"100"}&expand=${EXPAND_SEARCH}`);
  } else {
    // v2: the v1 content list answers 410 Gone to an app for archived and trashed pages (measured on
    // wolfaenpak dev, 2026-10-21), so these are listed with v2 and each property is read on its own.
    // 50 a batch: a batch is the unit of progress, so it must fit in a drained hour and a run's budget.
    res = cursor
      ? await appConfluence(route`/wiki/api/v2/pages?status=${phase}&limit=${"50"}&cursor=${cursor}`)
      : await appConfluence(route`/wiki/api/v2/pages?status=${phase}&limit=${"50"}`);
  }
  if (!res.ok) return { status: res.status, items: [], next: null };
  const near = nearLimit(res);
  const data = await res.json();
  const rows = data?.results || [];
  if (phase === "search") {
    const items = rows.map((r) => r?.content).filter((c) => c && c.id && (c.type === "page" || !c.type))
      .map((c) => ({ pageId: String(c.id), prop: asProp(c?.metadata?.properties?.[PROP]) }));
    return { status: res.status, items, next: cursorOf(data?._links?.next), near };
  }
  const items = rows.filter((c) => c && c.id).map((c) => ({ pageId: String(c.id), prop: null, needsRead: true }));
  return { status: res.status, items, next: rows.length > 0 ? cursorOf(data?._links?.next) : null, near };
}

const fresh = (t0) => ({ phase: LIST_PHASES[0], cursor: null, pages: 0, scrubbed: 0, failedIds: [], overflow: 0, retryRound: 0, waitUntil: null, backoffS: 0, listFailures: 0, skippedPhases: [], hourStart: Math.floor(t0 / 3600000) * 3600000, hourPages: 0, startedAt: new Date(t0).toISOString() });

/**
 * Run the scrub until it is done, the budget is spent, or it has to wait.
 * @returns {Promise<{ done: boolean, waitUntil?: number|null, phase: string|null, pages: number, scrubbed: number, failed: number, skipped?: number }>}
 */
export async function runValidationMirrorScrub({ budgetMs = 600000, now = () => Date.now(), rand = Math.random } = {}) {
  const t0 = now();
  const over = () => now() - t0 > budgetMs;
  let state = (await kvs.get(SCRUB_STATE_KEY).catch(() => null)) || null;
  if (!state || ![...LIST_PHASES, "retry"].includes(state.phase)) state = fresh(t0);
  state = { listFailures: 0, skippedPhases: [], hourStart: Math.floor(t0 / 3600000) * 3600000, hourPages: 0, ...state };
  const out = (extra = {}) => ({ done: false, waitUntil: state.waitUntil || null, phase: state.phase, pages: state.pages, scrubbed: state.scrubbed, failed: state.failedIds.length + (state.overflow || 0), ...extra });
  const save = () => kvs.set(SCRUB_STATE_KEY, { ...state, at: new Date(now()).toISOString() });
  if (state.waitUntil && state.waitUntil > t0) return out();
  state.waitUntil = null;
  // The share is per CLOCK hour, like Confluence's pool (it resets at the top of each hour): a run that
  // wakes after the reset always finds a fresh share.
  const hourOf = (ms) => Math.floor(ms / 3600000) * 3600000;
  if (hourOf(t0) !== state.hourStart) { state.hourStart = hourOf(t0); state.hourPages = 0; }
  const limited = () => wait(afterReset(now(), rand));
  // The site's hourly share: once it is used, wait for the next hour (with jitter).
  const cap = hourlyPages();
  const hourUsed = () => state.hourPages >= cap;
  const noteFailed = (id) => { if (state.failedIds.includes(id)) return; if (state.failedIds.length < FAILED_CAP) state.failedIds.push(id); else state.overflow = (state.overflow || 0) + 1; };
  const wait = async (until) => { state.waitUntil = until; await save(); return out(); };

  const finish = async (skipped = 0) => {
    if (skipped) console.warn(`[VALIDATION-MIRROR] ${skipped} page(s) could not be rewritten after ${RETRY_ROUNDS} retries; skipped`);
    if (state.archivedIds?.length) await kvs.set(ARCHIVED_LEFT_KEY, { ids: state.archivedIds, at: new Date(now()).toISOString() }).catch(() => {});
    await kvs.delete(SCRUB_STATE_KEY).catch(() => {});
    return { done: true, phase: null, pages: state.pages, scrubbed: state.scrubbed, failed: skipped, skipped, skippedPhases: state.skippedPhases, archivedLeft: state.readOnly || 0 };
  };
  // After the lists or a retry round: what is left, and whether another round may still run.
  const settle = async () => {
    if (!state.failedIds.length && !state.overflow) return finish(0);
    if (state.retryRound >= RETRY_ROUNDS) return finish(state.failedIds.length + (state.overflow || 0));
    state.retryRound += 1;
    if (state.overflow) {
      // More failures than the list can hold: walk the lists again (only what is still old is touched).
      state.phase = LIST_PHASES[0]; state.cursor = null; state.failedIds = []; state.overflow = 0;
    } else {
      state.phase = "retry"; state.cursor = null;
    }
    return wait(now() + RETRY_AFTER_MS);
  };

  while (!over()) {
    if (state.phase === "retry") {
      const still = [];
      for (let i = 0; i < state.failedIds.length; i++) {
        if (over() || hourUsed()) { state.failedIds = [...still, ...state.failedIds.slice(i)]; if (hourUsed()) return limited(); await save(); return out(); }
        const id = state.failedIds[i];
        const prop = await readProperty(id).catch(() => undefined);
        const r = prop === "limited" ? "limited" : prop === undefined ? "failed" : await scrubOne(id, prop);
        if (r === "limited") { state.failedIds = [...still, ...state.failedIds.slice(i)]; return limited(); }
        state.hourPages += 1;
        if (r === "scrubbed") state.scrubbed += 1;
        if (r === "failed" || r === "refused") still.push(id);
      }
      state.failedIds = still;
      return settle();
    }

    if (hourUsed()) return limited();

    const batch = await fetchBatch(state.phase, state.cursor).catch((e) => { console.warn(`[VALIDATION-MIRROR] ${state.phase} list failed:`, errText(e)); return { status: 0, items: [], next: null }; });
    if (batch.status === 429) return limited();
    if (!(batch.status >= 200 && batch.status < 300)) {
      state.listFailures = (state.listFailures || 0) + 1;
      if (state.listFailures >= LIST_FAILURES_MAX) {
        // A list that never answers cannot hold the job (and every open erasure) open for ever.
        console.warn(`[VALIDATION-MIRROR] ${state.phase} list failed ${state.listFailures} times in a row (last ${batch.status}); phase skipped`);
        state.skippedPhases = [...(state.skippedPhases || []), state.phase];
        state.listFailures = 0; state.backoffS = 0;
        batch.next = null; batch.items = [];
      } else {
        console.warn(`[VALIDATION-MIRROR] ${state.phase} list answered ${batch.status}; waiting`);
        state.backoffS = nextBackoffS(state.backoffS);
        return wait(now() + state.backoffS * 1000);
      }
    } else {
      state.backoffS = 0; state.listFailures = 0;
    }
    let scrubbed = 0;
    const failed = [];
    let reads = 0;
    for (const it of batch.items) {
      let prop = it.prop;
      if (it.needsRead) {
        reads += 1;
        prop = await readProperty(it.pageId).catch(() => undefined);
        if (prop === "limited") { state.scrubbed += scrubbed; for (const id of failed) noteFailed(id); state.hourPages += reads; return limited(); }
        if (prop === undefined) { failed.push(it.pageId); continue; }
      }
      const r = await scrubOne(it.pageId, prop);
      // A 429 on a write: resume this batch after the reset (the cursor stays on it; nothing of
      // this batch is counted yet, and the pages already rewritten are clean on the re-read).
      if (r === "limited") { state.scrubbed += scrubbed; for (const id of failed) noteFailed(id); state.hourPages += reads; return limited(); }
      if (r === "scrubbed") scrubbed += 1;
      if (r === "refused" && state.phase === "archived") {
        state.readOnly = (state.readOnly || 0) + 1;
        if (!state.archivedIds) state.archivedIds = [];
        if (state.archivedIds.length < ARCHIVED_LEFT_CAP && !state.archivedIds.includes(it.pageId)) state.archivedIds.push(it.pageId);
      }
      else if (r === "failed" || r === "refused") failed.push(it.pageId);
    }
    state.pages += batch.items.length;
    state.hourPages += batch.items.length + reads + scrubbed;
    state.scrubbed += scrubbed;
    for (const id of failed) noteFailed(id);
    if (batch.near) { if (batch.next) state.cursor = batch.next; else { const k = LIST_PHASES.indexOf(state.phase); if (k < LIST_PHASES.length - 1) { state.phase = LIST_PHASES[k + 1]; state.cursor = null; } else return settle(); } return limited(); }
    if (batch.next) { state.cursor = batch.next; await save(); continue; }
    const i = LIST_PHASES.indexOf(state.phase);
    if (i < LIST_PHASES.length - 1) { state.phase = LIST_PHASES[i + 1]; state.cursor = null; await save(); continue; }
    return settle();
  }
  await save();
  return out();
}

/**
 * One page, when it leaves the archive (trigger `avi:confluence:unarchived:page`): Confluence refuses
 * changes to an archived page, so its old property is rewritten the moment it is a page again.
 * → "clean" | "scrubbed" | "failed" | "refused" | "limited"
 */
export async function scrubOnePageMirror(pageId) {
  if (!pageId) return "clean";
  const prop = await readProperty(String(pageId)).catch(() => undefined);
  if (prop === "limited") return "limited";
  if (prop === undefined) return "failed";
  return scrubOne(String(pageId), prop);
}

/**
 * The weekly fallback for archived pages (the unarchive event can be missed: the app disabled at the
 * time, a dropped event): re-try up to ARCHIVED_RECHECK_PER_SWEEP of them. A page that took the
 * rewrite, is clean or is gone leaves the list; one Confluence still refuses (still archived) stays.
 * @returns {Promise<{ checked: number, cleaned: number, left: number }>}
 */
export async function recheckArchivedMirrors({ limit = ARCHIVED_RECHECK_PER_SWEEP } = {}) {
  const row = await kvs.get(ARCHIVED_LEFT_KEY).catch(() => null);
  const ids = Array.isArray(row?.ids) ? row.ids : [];
  if (!ids.length) return { checked: 0, cleaned: 0, left: 0 };
  const batch = ids.slice(0, limit);
  const keep = [];
  let cleaned = 0;
  for (const id of batch) {
    const r = await scrubOnePageMirror(id).catch(() => "failed");
    if (r === "scrubbed") cleaned += 1;
    if (r === "refused" || r === "failed" || r === "limited") keep.push(id);
    if (r === "limited") { keep.push(...batch.slice(batch.indexOf(id) + 1)); break; }
  }
  // Re-checked ones go to the back, so a long list is walked in turn, week by week.
  const next = [...ids.slice(batch.length), ...keep];
  if (next.length) await kvs.set(ARCHIVED_LEFT_KEY, { ids: next, at: new Date().toISOString() });
  else await kvs.delete(ARCHIVED_LEFT_KEY);
  return { checked: batch.length, cleaned, left: next.length };
}
