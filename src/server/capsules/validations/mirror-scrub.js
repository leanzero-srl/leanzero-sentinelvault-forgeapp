/*
 * One-time scrub of the `sentinel-vault-validation` page property (8.14.1, 2026-10-21).
 *
 * Before 8.14.0 the page property WAS the validation status, and it carried who checked the page
 * (`checkedBy`) and who approved it anyway (`approvedBy`): account ids. Since 8.14.0 the status lives in
 * KVS `validation-state-{pageId}` and the property is a mirror without ids (validationMirrorValue), but
 * an old property was rewritten only when its page's status was next stored. This job rewrites every
 * old one now, once, so no page property the app wrote still names a person:
 *
 *   - a page with a KVS status gets its mirror rewritten FROM that status (the authority);
 *   - a page with only the old property keeps its verdict for CQL readers, minus the ids
 *     (validationMirrorValue of the old value). The panel never reads the property, so what it
 *     shows does not change.
 *
 * Which pages: every page the app can see. (Blog posts never carried it: the status was only ever
 * written through the v2 /pages/{id}/properties endpoint, which does not take a blog post.)
 *   phase "cql"      content search (current pages) with the property expanded inline,
 *                    100 per request, so a clean page costs nothing beyond its share of one request;
 *   phase "archived-page" / "trashed-page"  CQL never returns these, so they are listed with the v2 API and
 *                    each one's property is read on its own (rare: a page validated, then archived
 *                    or trashed, would otherwise bring the old ids back when restored).
 *
 * Resumable: the phase and cursor are saved after every batch in `privacy-validation-scrub` (a
 * privacy- row: never scanned for people, never erased, never backed up). Idempotent: a clean
 * property is left alone, so a re-run only touches what is still old. Budgeted: the caller passes a
 * time budget and the job stops between batches. Done: when every phase reached its end with no
 * failed write, the caller records `validationMirrorV1` in `privacy-migrations` and the job never
 * runs again (failures restart the pass from the beginning on the next run).
 */
import { kvs } from "@forge/kvs";
import { route } from "@forge/api";
import { appConfluence } from "../../shared/confluence-call.js";
import { validationMirrorValue, VALIDATION_STATE_PREFIX } from "./logic.js";
import { errText } from "../../shared/action-log.js";

export const SCRUB_STATE_KEY = "privacy-validation-scrub";
export const SCRUB_FLAG = "validationMirrorV1"; // in privacy-migrations
export const SCRUB_LOCK_KEY = "privacy-validation-scrub-lock";
const PROP = "sentinel-vault-validation";
const MIRROR_FIELDS = new Set(["state", "violations", "version", "checkedAt", "approvedAt", "rulesFp", "source", "approved"]);
const PHASES = ["cql", "archived-page", "trashed-page"];
const CQL = "type = page order by id";

/** PURE. Does a stored property value carry anything a mirror may not (an account id field above all)? */
export function mirrorNeedsScrub(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).some((k) => !MIRROR_FIELDS.has(k));
}

/** PURE. The `cursor` query parameter of a Confluence `next` link (v1 or v2), or null. */
export function cursorOf(nextLink) {
  if (!nextLink || typeof nextLink !== "string") return null;
  try { return new URL(nextLink, "https://x.invalid").searchParams.get("cursor"); } catch (_) { return null; }
}

/** The value the property is rewritten to: from the KVS status when there is one, else the old value minus the ids. */
async function cleanValueFor(pageId, oldValue) {
  let stored = null;
  try { stored = await kvs.get(`${VALIDATION_STATE_PREFIX}${pageId}`); } catch (_) { stored = null; }
  const base = stored && typeof stored === "object" && !stored.unknown ? stored : oldValue;
  return validationMirrorValue(base);
}

async function putProperty(pageId, propId, version, value) {
  const res = await appConfluence(route`/wiki/api/v2/pages/${pageId}/properties/${propId}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: PROP, value, version: { number: (Number(version) || 1) + 1 } }),
  });
  return res.ok;
}

/** Scrub one page's property when it needs it. → "clean" | "scrubbed" | "failed" */
async function scrubOne(pageId, prop) {
  if (!prop || !mirrorNeedsScrub(prop.value)) return "clean";
  try {
    const value = await cleanValueFor(pageId, prop.value);
    return (await putProperty(pageId, prop.id, prop.version, value)) ? "scrubbed" : "failed";
  } catch (e) {
    console.warn("[VALIDATION-MIRROR] rewrite failed:", errText(e));
    return "failed";
  }
}

/** One batch of a phase. → { items: [{ pageId, prop|null, needsRead }], next } */
async function fetchBatch(phase, cursor) {
  if (phase === "cql") {
    const res = cursor
      ? await appConfluence(route`/wiki/rest/api/content/search?cql=${CQL}&limit=${"100"}&expand=${`metadata.properties.${PROP}`}&cursor=${cursor}`)
      : await appConfluence(route`/wiki/rest/api/content/search?cql=${CQL}&limit=${"100"}&expand=${`metadata.properties.${PROP}`}`);
    if (!res.ok) throw new Error(`content search answered ${res.status}`);
    const data = await res.json();
    const items = (data?.results || []).map((r) => {
      const p = r?.metadata?.properties?.[PROP];
      return { pageId: String(r.id), prop: p && p.id ? { id: String(p.id), version: p.version?.number || 1, value: p.value } : null, needsRead: false };
    });
    return { items, next: cursorOf(data?._links?.next) };
  }
  const status = phase.split("-")[0];
  const res = cursor
    ? await appConfluence(route`/wiki/api/v2/pages?status=${status}&limit=${"250"}&cursor=${cursor}`)
    : await appConfluence(route`/wiki/api/v2/pages?status=${status}&limit=${"250"}`);
  if (!res.ok) throw new Error(`pages list answered ${res.status}`);
  const data = await res.json();
  return { items: (data?.results || []).map((r) => ({ pageId: String(r.id), prop: null, needsRead: true })), next: cursorOf(data?._links?.next) };
}

// Archived and trashed content is not in CQL: its property is read one page at a time (one-time
// scrub of old mirrors; never read for a decision — see test/guard-marker-backfill.test.mjs).
async function readProperty(pageId) {
  const res = await appConfluence(route`/wiki/api/v2/pages/${pageId}/properties?key=${PROP}`);
  if (!res.ok) return null;
  const row = (await res.json())?.results?.[0];
  return row ? { id: String(row.id), version: row.version?.number || 1, value: row.value } : null;
}

/**
 * Run the scrub until it is done or the budget is spent.
 * @returns {Promise<{ done: boolean, busy?: boolean, phase: string|null, pages: number, scrubbed: number, failed: number }>}
 */
export async function runValidationMirrorScrub({ budgetMs = 600000, now = () => Date.now() } = {}) {
  const t0 = now();
  const over = () => now() - t0 > budgetMs;
  let state = (await kvs.get(SCRUB_STATE_KEY).catch(() => null)) || null;
  if (!state || !PHASES.includes(state.phase)) state = { phase: PHASES[0], cursor: null, pages: 0, scrubbed: 0, failed: 0, passFailed: 0, startedAt: new Date(t0).toISOString() };
  const save = () => kvs.set(SCRUB_STATE_KEY, { ...state, at: new Date(now()).toISOString() });
  while (!over()) {
    let batch;
    try { batch = await fetchBatch(state.phase, state.cursor); } catch (e) {
      console.warn(`[VALIDATION-MIRROR] ${state.phase} list failed:`, errText(e));
      await save();
      return { done: false, phase: state.phase, pages: state.pages, scrubbed: state.scrubbed, failed: state.failed };
    }
    for (const it of batch.items) {
      const prop = it.needsRead ? await readProperty(it.pageId).catch(() => undefined) : it.prop;
      const r = prop === undefined ? "failed" : await scrubOne(it.pageId, prop);
      state.pages += 1;
      if (r === "scrubbed") state.scrubbed += 1;
      if (r === "failed") { state.failed += 1; state.passFailed += 1; }
    }
    if (batch.next) { state.cursor = batch.next; await save(); continue; }
    const i = PHASES.indexOf(state.phase);
    if (i < PHASES.length - 1) { state.phase = PHASES[i + 1]; state.cursor = null; await save(); continue; }
    // Every phase reached its end. A pass with a failed write starts again from the beginning next
    // time (idempotent: only what is still old is rewritten); a clean pass is the end of the job.
    if (state.passFailed > 0) {
      state = { ...state, phase: PHASES[0], cursor: null, passFailed: 0 };
      await save();
      return { done: false, phase: state.phase, pages: state.pages, scrubbed: state.scrubbed, failed: state.failed };
    }
    await kvs.delete(SCRUB_STATE_KEY).catch(() => {});
    return { done: true, phase: null, pages: state.pages, scrubbed: state.scrubbed, failed: state.failed };
  }
  await save();
  return { done: false, phase: state.phase, pages: state.pages, scrubbed: state.scrubbed, failed: state.failed };
}
