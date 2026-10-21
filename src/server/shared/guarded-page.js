import { kvs, WhereConditions } from "@forge/kvs";
import { randomUUID } from "node:crypto";
import { errText } from "./action-log.js";

/**
 * Which pages carry a seal — the app's own record, in KVS (2026-10-21).
 *
 * The page-content pipeline decides from this whether a page event needs the seal passes at all
 * (triggers.js collectMediaSealsForPage / collectSectionSealsForPage). A Confluence page property
 * is never part of that decision: anyone who may edit a page may also change or delete its
 * properties, so they mirror state for CQL and the UI only. KVS is the authority.
 *
 *   guarded-page-{pageId}         written by markGuardedPage BEFORE a seal record is put on a page
 *                                 (a failed write refuses the seal), by a backup restore for every seal
 *                                 it brings back, by the backfill and by the five-minute sweep's
 *                                 self-heal. Never deleted for correctness: a stale marker costs one KVS
 *                                 scan that finds nothing.
 *   guard-marker-backfill-v1      set when every page with a seal record has its marker. Until it is
 *                                 set, the pipeline scans the seal records for every page.
 *   guard-marker-backfill-gen     the current backfill generation; a restore or a failed marker write
 *                                 starts a new one (reopenGuardBackfill), and a sweep that began in an
 *                                 older generation never sets the flag.
 *   guard-marker-backfill-state   { gen, cursors, done, failures } — where each family's scan resumes next sweep.
 */
export const GUARD_MARKER_PREFIX = "guarded-page-";
export const GUARD_BACKFILL_FLAG = "guard-marker-backfill-v1";
export const GUARD_BACKFILL_GEN = "guard-marker-backfill-gen";
export const GUARD_BACKFILL_STATE = "guard-marker-backfill-state";
export const guardMarkerKey = (pageId) => `${GUARD_MARKER_PREFIX}${pageId}`;

/**
 * Record that `pageId` carries a seal. Returns true when the marker is stored. On false a NEW seal is
 * refused (nothing written, nothing to rebuild); a caller updating an EXISTING seal record re-opens
 * the backfill itself (reopenGuardBackfill), so a retry storm on new seals never wipes the site's flag.
 */
export async function markGuardedPage(pageId) {
  if (pageId == null || pageId === "") return false;
  try {
    await kvs.set(guardMarkerKey(String(pageId)), { at: new Date().toISOString() });
    return true;
  } catch (e) {
    console.error("[GUARD-MARKER] marker write failed:", errText(e));
    return false;
  }
}

/** Start a new backfill generation (a restore, a failed marker write): the next sweeps rebuild the markers. */
export async function reopenGuardBackfill() {
  await kvs.set(GUARD_BACKFILL_GEN, { gen: randomUUID(), at: new Date().toISOString() }).catch(() => {});
  await kvs.delete(GUARD_BACKFILL_STATE).catch(() => {});
  await kvs.delete(GUARD_BACKFILL_FLAG).catch(() => {});
}

/**
 * Should the seal passes look for this page's seals? Yes when the page has a marker, or while the
 * markers are not complete yet, or when either cannot be read (fail closed: a KVS scan costs reads,
 * a skipped page costs its protection).
 */
export async function pageMayCarrySeals(pageId) {
  try {
    if (await kvs.get(guardMarkerKey(String(pageId)))) return true;
    return !(await kvs.get(GUARD_BACKFILL_FLAG));
  } catch (_) { return true; }
}

/** PURE. The page a seal record puts a marker on (null when the row is not a live seal). */
export function sealPageOf(key, value) {
  if (typeof key !== "string") return null;
  if (key.startsWith("protection-")) return value?.lockedBy && !value?.trashedOnly && value?.contentId ? String(value.contentId) : null;
  if (key.startsWith("section-protection-")) return value?.lockedBy && value?.sectionId && value?.pageId ? String(value.pageId) : null;
  return null;
}

/** Write the markers that are missing for these pages (one get each; existing markers are left alone). */
export async function ensureGuardMarkers(pageIds) {
  let written = 0;
  let failed = 0;
  for (const id of new Set([...pageIds].filter((p) => p != null && p !== "").map(String))) {
    try {
      if (await kvs.get(guardMarkerKey(id))) continue;
      await kvs.set(guardMarkerKey(id), { at: new Date().toISOString(), healed: true });
      written += 1;
    } catch (_) { failed += 1; }
  }
  return { written, failed };
}

/**
 * The five-minute sweep's self-heal: every page a seal record names has its marker. Existing markers
 * are listed with one prefix query (not read one by one); only the missing ones are written. Covers a
 * marker lost any other way, and seals made by an older version while the done flag stayed set (a
 * rollback and forward again).
 */
export async function healGuardMarkers(pageIds, { maxMarkerPages = 50 } = {}) {
  const want = new Set([...pageIds].filter((p) => p != null && p !== "").map(String));
  if (!want.size) return { written: 0, failed: 0 };
  const have = new Set();
  let q = kvs.query().where("key", WhereConditions.beginsWith(GUARD_MARKER_PREFIX)).limit(100);
  for (let i = 0; i < maxMarkerPages; i++) {
    const { results, nextCursor } = await q.getMany();
    for (const { key } of results || []) have.add(key.slice(GUARD_MARKER_PREFIX.length));
    if (!nextCursor) break;
    q = kvs.query().where("key", WhereConditions.beginsWith(GUARD_MARKER_PREFIX)).limit(100).cursor(nextCursor);
  }
  return ensureGuardMarkers([...want].filter((id) => !have.has(id)));
}

const SEAL_FAMILIES = ["protection-", "section-protection-"];
export const BACKFILL_PAGES_PER_SWEEP = 20; // KVS pages of 100 rows, per family and sweep
const CURSOR_FAILURES_BEFORE_RESTART = 3; // failed scans at one cursor before its family starts again

/**
 * One step of the backfill: each family's scan resumes where the last sweep stopped, writes the
 * markers that are missing for the pages it reads, and records its cursor. The flag is set when both
 * families reached their end within the same generation, and only if no restore or failed marker
 * write started a new one meanwhile.
 * @returns {Promise<{ done: boolean, written: number, skipped?: boolean }>}
 */
export async function backfillGuardMarkers({ pagesPerSweep = BACKFILL_PAGES_PER_SWEEP } = {}) {
  if (await kvs.get(GUARD_BACKFILL_FLAG).catch(() => null)) return { done: true, written: 0, skipped: true };
  let gen = (await kvs.get(GUARD_BACKFILL_GEN))?.gen;
  if (!gen) { gen = randomUUID(); await kvs.set(GUARD_BACKFILL_GEN, { gen, at: new Date().toISOString() }); }
  const saved = await kvs.get(GUARD_BACKFILL_STATE);
  const state = saved?.gen === gen ? saved : { gen, cursors: {}, done: {} };
  let written = 0;
  let failed = false;
  for (const prefix of SEAL_FAMILIES) {
    if (state.done[prefix]) continue;
    let cursor = state.cursors[prefix] || null;
    for (let i = 0; i < pagesPerSweep; i++) {
      let q = kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100);
      if (cursor) q = q.cursor(cursor);
      let page;
      try { page = await q.getMany(); }
      catch (e) {
        // One failure (a busy KVS) keeps the cursor for the next sweep; repeated failures at the SAME
        // cursor mean KVS no longer accepts it, and the family starts again so the backfill cannot wedge.
        const prev = state.failures?.[prefix];
        const count = prev && prev.cursor === cursor ? prev.count + 1 : 1;
        state.failures = { ...(state.failures || {}), [prefix]: { cursor, count } };
        const restart = count >= CURSOR_FAILURES_BEFORE_RESTART;
        console.warn(`[GUARD-MARKER] ${prefix} scan failed (${count} at this cursor)${restart ? ", restarting it" : ""}:`, errText(e));
        if (restart) { cursor = null; delete state.failures[prefix]; }
        failed = true; break;
      }
      if (state.failures?.[prefix]) delete state.failures[prefix];
      const { results, nextCursor } = page;
      const pages = (results || []).map(({ key, value }) => sealPageOf(key, value)).filter(Boolean);
      const r = await ensureGuardMarkers(pages);
      written += r.written;
      if (r.failed) { failed = true; break; }
      cursor = nextCursor || null;
      if (!nextCursor) { state.done[prefix] = true; break; }
    }
    state.cursors[prefix] = state.done[prefix] ? null : cursor;
    if (failed) break;
  }
  const complete = !failed && SEAL_FAMILIES.every((p) => state.done[p]);
  // A restore or a failed marker write during this step started a new generation: keep nothing.
  if ((await kvs.get(GUARD_BACKFILL_GEN))?.gen !== gen) return { done: false, written };
  if (complete) {
    await kvs.set(GUARD_BACKFILL_FLAG, { at: new Date().toISOString(), gen });
    // A restore can start a new generation between the check above and this write: take the flag back.
    if ((await kvs.get(GUARD_BACKFILL_GEN))?.gen !== gen) { await kvs.delete(GUARD_BACKFILL_FLAG).catch(() => {}); return { done: false, written }; }
    await kvs.delete(GUARD_BACKFILL_STATE).catch(() => {});
  } else {
    await kvs.set(GUARD_BACKFILL_STATE, state);
  }
  return { done: complete, written };
}
