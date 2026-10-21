/*
 * One-time scrub of the `sentinel-vault-validation` page property (8.14.1, 2026-10-21).
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
 *   phase "archived"  /wiki/rest/api/content?status=archived, same expansion (CQL never returns these);
 *   phase "trashed"   /wiki/rest/api/content?status=trashed, same expansion;
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
import { appConfluence } from "../../shared/confluence-call.js";
import { validationMirrorValue, VALIDATION_STATE_PREFIX } from "./logic.js";
import { errText } from "../../shared/action-log.js";

export const SCRUB_STATE_KEY = "privacy-validation-scrub";
export const SCRUB_FLAG = "validationMirrorV1"; // in privacy-migrations
export const SCRUB_LOCK_KEY = "privacy-validation-scrub-lock";
export const RETRY_ROUNDS = 3;
export const RETRY_AFTER_MS = 3600000;
export const FAILED_CAP = 500;
const PROP = "sentinel-vault-validation";
const MIRROR_FIELDS = new Set(["state", "violations", "version", "checkedAt", "approvedAt", "rulesFp", "source", "approved"]);
const LIST_PHASES = ["search", "archived", "trashed"];
const CQL = "type = page order by id";
const EXPAND_SEARCH = `content.metadata.properties.${PROP}`;
const EXPAND_CONTENT = `metadata.properties.${PROP}`;

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
      if (fresh === undefined) return "failed";
      if (!fresh || !mirrorNeedsScrub(fresh.value)) return "clean";
      status = await putProperty(pageId, fresh, await cleanValueFor(pageId, fresh.value));
    }
    if (status === 429) return "limited";
    return status >= 200 && status < 300 ? "scrubbed" : "failed";
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
    const start = String(Number(cursor) || 0);
    res = await appConfluence(route`/wiki/rest/api/content?type=${"page"}&status=${phase}&limit=${"100"}&start=${start}&expand=${EXPAND_CONTENT}`);
  }
  if (!res.ok) return { status: res.status, items: [], next: null };
  const data = await res.json();
  const rows = data?.results || [];
  if (phase === "search") {
    const items = rows.map((r) => r?.content).filter((c) => c && c.id && (c.type === "page" || !c.type))
      .map((c) => ({ pageId: String(c.id), prop: asProp(c?.metadata?.properties?.[PROP]) }));
    return { status: res.status, items, next: cursorOf(data?._links?.next) };
  }
  const items = rows.filter((c) => c && c.id).map((c) => ({ pageId: String(c.id), prop: asProp(c?.metadata?.properties?.[PROP]) }));
  const more = rows.length > 0 && !!data?._links?.next;
  return { status: res.status, items, next: more ? String((Number(cursor) || 0) + rows.length) : null };
}

const fresh = (t0) => ({ phase: LIST_PHASES[0], cursor: null, pages: 0, scrubbed: 0, failedIds: [], overflow: 0, retryRound: 0, waitUntil: null, backoffS: 0, startedAt: new Date(t0).toISOString() });

/**
 * Run the scrub until it is done, the budget is spent, or it has to wait.
 * @returns {Promise<{ done: boolean, waitUntil?: number|null, phase: string|null, pages: number, scrubbed: number, failed: number, skipped?: number }>}
 */
export async function runValidationMirrorScrub({ budgetMs = 600000, now = () => Date.now() } = {}) {
  const t0 = now();
  const over = () => now() - t0 > budgetMs;
  let state = (await kvs.get(SCRUB_STATE_KEY).catch(() => null)) || null;
  if (!state || ![...LIST_PHASES, "retry"].includes(state.phase)) state = fresh(t0);
  const out = (extra = {}) => ({ done: false, waitUntil: state.waitUntil || null, phase: state.phase, pages: state.pages, scrubbed: state.scrubbed, failed: state.failedIds.length + (state.overflow || 0), ...extra });
  const save = () => kvs.set(SCRUB_STATE_KEY, { ...state, at: new Date(now()).toISOString() });
  if (state.waitUntil && state.waitUntil > t0) return out();
  state.waitUntil = null;
  const noteFailed = (id) => { if (state.failedIds.includes(id)) return; if (state.failedIds.length < FAILED_CAP) state.failedIds.push(id); else state.overflow = (state.overflow || 0) + 1; };
  const wait = async (until) => { state.waitUntil = until; await save(); return out(); };

  const finish = async (skipped = 0) => {
    if (skipped) console.warn(`[VALIDATION-MIRROR] ${skipped} page(s) could not be rewritten after ${RETRY_ROUNDS} retries; skipped`);
    await kvs.delete(SCRUB_STATE_KEY).catch(() => {});
    return { done: true, phase: null, pages: state.pages, scrubbed: state.scrubbed, failed: skipped, skipped };
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
        const id = state.failedIds[i];
        const prop = await readProperty(id).catch(() => undefined);
        const r = prop === undefined ? "failed" : await scrubOne(id, prop);
        if (r === "limited") { state.failedIds = [...still, ...state.failedIds.slice(i)]; return wait(nextHour(now())); }
        if (r === "scrubbed") state.scrubbed += 1;
        if (r === "failed") still.push(id);
      }
      state.failedIds = still;
      return settle();
    }

    const batch = await fetchBatch(state.phase, state.cursor).catch((e) => { console.warn(`[VALIDATION-MIRROR] ${state.phase} list failed:`, errText(e)); return { status: 0, items: [], next: null }; });
    if (batch.status === 429) return wait(nextHour(now()));
    if (!(batch.status >= 200 && batch.status < 300)) {
      console.warn(`[VALIDATION-MIRROR] ${state.phase} list answered ${batch.status}; waiting`);
      state.backoffS = nextBackoffS(state.backoffS);
      return wait(now() + state.backoffS * 1000);
    }
    state.backoffS = 0;
    for (const it of batch.items) {
      const r = await scrubOne(it.pageId, it.prop);
      // A 429 on a write: resume this batch after the reset (the cursor stays on it; the pages
      // already rewritten are clean and cost nothing on the re-read).
      if (r === "limited") return wait(nextHour(now()));
      state.pages += 1;
      if (r === "scrubbed") state.scrubbed += 1;
      if (r === "failed") noteFailed(it.pageId);
    }
    if (batch.next) { state.cursor = batch.next; await save(); continue; }
    const i = LIST_PHASES.indexOf(state.phase);
    if (i < LIST_PHASES.length - 1) { state.phase = LIST_PHASES[i + 1]; state.cursor = null; await save(); continue; }
    return settle();
  }
  await save();
  return out();
}
