/*
 * A1 — Document Activity (ledger #49). ONE durable record per protection/workflow event.
 *
 * Every event is written by ONE helper, `recordActivity`, under TWO keys so that each reader
 * queries its own prefix (K1 index discipline — never a site-wide scan filtered client-side):
 *
 *   activity-page-{pageId}-{invTs}-{rand}       the per-page feed (panel, overlay)
 *   activity-space-{spaceKey}-{invTs}-{rand}    the per-space report (realm console, CSV)
 *
 *   invTs = String(9999999999999 - tsMs).padStart(13, "0")  → a LATER event yields a
 *           lexicographically SMALLER key, so a plain prefix query returns newest first
 *           without a sort and the cursor walks backwards through time.
 *   rand  = 6 base36 chars, so two events in the same millisecond never collide.
 *
 * No TTL: this is a compliance record, like `workflow-log-*`. Values stay small (`details` is
 * type-specific and ≤ 1 KB by convention; page bodies are never stored here).
 *
 * Best-effort everywhere: `recordActivity` NEVER throws to its caller — the activity record is
 * a witness to an event that already happened, and a failed witness must not undo or block the
 * event. T6 corollary: the call is placed right after the state write that makes the event
 * true, never between a dedup marker claim and the side effect that marker protects.
 *
 * The pure helpers (`buildActivityKeys`, `invertedTs`, `matchesActivityFilter`) carry no Forge
 * import so `test/activity-log.test.mjs` can pin them.
 */
import { kvs, WhereConditions } from "@forge/kvs";

/** Exact type strings — the UI formatter switches on them; the unit test pins uniqueness. */
export const ACTIVITY_TYPES = Object.freeze([
  "seal.created", "seal.released", "seal.forced", "seal.extended", "seal.auto-released",
  "seal.edit-reverted", "seal.trash-restored", "seal.embed-restored", "seal.presentation-restored",
  "seal.deleted", "seal.revert-failed",
  "section.sealed", "section.released", "section.restored", "section.reverted",
  "editreq.requested", "editreq.approved", "editreq.denied", "editreq.revoked",
  "workflow.transition", "workflow.approval-requested", "workflow.approval-decided",
  "workflow.enforced", "workflow.expired",
  "validation.reverted", "validation.gate",
]);

const PAGE_PREFIX = "activity-page-";
const SPACE_PREFIX = "activity-space-";
const TS_CEILING = 9999999999999; // 13 digits — every ms timestamp until the year 2286 fits under it
const MAX_DETAILS_BYTES = 1024;

/** PURE. Newest-first sort key: a later `tsMs` gives a lexicographically smaller string. */
export function invertedTs(tsMs) {
  const n = Number(tsMs);
  const safe = Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 0), TS_CEILING) : 0;
  return String(TS_CEILING - safe).padStart(13, "0");
}

/**
 * PURE. A space key as a KVS key segment. KVS keys accept `[a-zA-Z0-9:._\s-#]` only, so a
 * personal space (`~7120...`) would otherwise throw on write. Same regex every other
 * space-keyed family in this app uses (admin-settings-space-*, workflow-idx-*).
 */
export const activitySpaceSegment = (spaceKey) =>
  String(spaceKey ?? "").replace(/[^a-zA-Z0-9:._\s-#]/g, "_");

/** Prefix of one page's feed. */
export const activityPagePrefix = (pageId) => `${PAGE_PREFIX}${pageId}-`;
/** Prefix of one space's report. */
export const activitySpacePrefix = (spaceKey) => `${SPACE_PREFIX}${activitySpaceSegment(spaceKey)}-`;

const randomSuffix = () => {
  let s = "";
  while (s.length < 6) s += Math.random().toString(36).slice(2);
  return s.slice(0, 6);
};

/**
 * PURE. The two keys (and the shared id) one entry is stored under. Either key is omitted when
 * its scope is unknown — an event with no page (a seal record that never recorded a contentId)
 * still lands on the space report, and vice versa.
 */
export function buildActivityKeys({ pageId, spaceKey, tsMs, rand }) {
  const inv = invertedTs(tsMs);
  const suffix = `${inv}-${rand}`;
  return {
    id: suffix,
    pageKey: pageId != null && pageId !== "" ? `${activityPagePrefix(pageId)}${suffix}` : null,
    spaceKey: spaceKey != null && spaceKey !== "" ? `${activitySpacePrefix(spaceKey)}${suffix}` : null,
  };
}

const toMs = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Date.parse(String(v));
  return Number.isFinite(n) ? n : null;
};

/**
 * PURE. Does an entry pass the report filters? Every axis is optional; an absent or empty axis
 * matches everything. `since`/`until` accept ISO strings or ms and are inclusive.
 */
export function matchesActivityFilter(entry, { types, since, until, pageId, actorAccountId } = {}) {
  if (!entry || typeof entry !== "object") return false;
  if (Array.isArray(types) && types.length > 0 && !types.includes(entry.type)) return false;
  const entryMs = toMs(entry.ts);
  const sinceMs = toMs(since);
  const untilMs = toMs(until);
  if (sinceMs != null && (entryMs == null || entryMs < sinceMs)) return false;
  if (untilMs != null && (entryMs == null || entryMs > untilMs)) return false;
  if (pageId != null && pageId !== "" && String(entry.pageId ?? "") !== String(pageId)) return false;
  if (actorAccountId != null && actorAccountId !== ""
    && String(entry.actor?.accountId ?? "") !== String(actorAccountId)) return false;
  return true;
}

// Keep `details` under the 1 KB convention without ever throwing: a value that will not fit is
// replaced by a marker rather than trimmed mid-JSON (a truncated string is worse than an honest
// "too large" — the UI would render half a sentence as fact).
function boundDetails(details) {
  if (details == null) return {};
  if (typeof details !== "object") return { value: String(details).slice(0, 200) };
  try {
    const s = JSON.stringify(details);
    if (s.length <= MAX_DETAILS_BYTES) return details;
    console.warn(`[ACTIVITY] details of ${s.length} bytes exceeds ${MAX_DETAILS_BYTES}; dropping to a marker`);
    return { truncated: true, bytes: s.length };
  } catch (_) {
    return { unserializable: true };
  }
}

/**
 * Record one activity entry. NEVER throws — catch + console.warn on every failure path.
 *
 * @param {object} entry
 * @param {string} entry.type            one of ACTIVITY_TYPES
 * @param {string|null} entry.pageId
 * @param {string|null} entry.spaceKey
 * @param {{accountId?:string|null,name?:string|null}|null} entry.actor   null = the app (sweep/trigger)
 * @param {{kind:"attachment"|"section"|"page",id?:string,name?:string}} entry.target
 * @param {object} [entry.details]       small, type-specific; never a page body
 * @param {number|null} [entry.version]  page version the event refers to, when known
 * @returns {Promise<{id:string}|null>}   the stored id, or null when nothing was written
 */
export async function recordActivity(entry) {
  try {
    if (!entry || typeof entry !== "object") return null;
    const { type } = entry;
    if (!ACTIVITY_TYPES.includes(type)) {
      console.warn(`[ACTIVITY] unknown type "${type}" — not recorded`);
      return null;
    }
    const tsMs = Date.now();
    const pageId = entry.pageId != null && entry.pageId !== "" ? String(entry.pageId) : null;
    const spaceKey = entry.spaceKey != null && entry.spaceKey !== "" ? String(entry.spaceKey) : null;
    const { id, pageKey, spaceKey: spaceStoreKey } = buildActivityKeys({ pageId, spaceKey, tsMs, rand: randomSuffix() });
    if (!pageKey && !spaceStoreKey) {
      console.warn(`[ACTIVITY] ${type} has neither pageId nor spaceKey — nothing to index it under`);
      return null;
    }
    const actor = entry.actor && (entry.actor.accountId || entry.actor.name)
      ? { accountId: entry.actor.accountId || null, name: entry.actor.name || null }
      : { accountId: null, name: null };
    const target = {
      kind: entry.target?.kind || "page",
      id: entry.target?.id != null ? String(entry.target.id) : (pageId || null),
      name: entry.target?.name != null ? String(entry.target.name).slice(0, 255) : null,
    };
    const version = typeof entry.version === "number" && Number.isFinite(entry.version) ? entry.version : null;
    const value = {
      id,
      ts: new Date(tsMs).toISOString(),
      type,
      pageId,
      spaceKey,
      actor,
      target,
      details: boundDetails(entry.details),
      version,
    };
    // Both keys, each best-effort on its own: a failed space leg must not cost the page leg.
    if (pageKey) {
      await kvs.set(pageKey, value).catch((e) => console.warn(`[ACTIVITY] page key write failed (${type}):`, e));
    }
    if (spaceStoreKey) {
      await kvs.set(spaceStoreKey, value).catch((e) => console.warn(`[ACTIVITY] space key write failed (${type}):`, e));
    }
    return { id };
  } catch (e) {
    console.warn("[ACTIVITY] recordActivity failed (event already happened; record dropped):", e);
    return null;
  }
}

/**
 * One page of a prefix, newest first (the inverted timestamp does the ordering). Cursor
 * pagination the way editreq/actions.js listMyEditRequests does it: the FIRST query carries no
 * cursor and `.cursor()` is only added for later pages — @forge/kvs rejects an empty cursor.
 *
 * @returns {Promise<{entries:object[], nextCursor:string|null}>}
 */
export async function readActivity(prefix, { cursor, limit } = {}) {
  const lim = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.min(Math.floor(Number(limit)), 100) : 20;
  let query = kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(lim);
  if (typeof cursor === "string" && cursor) query = query.cursor(cursor);
  const { results, nextCursor } = await query.getMany();
  const entries = (results || []).map(({ value }) => value).filter((v) => v && typeof v === "object");
  return { entries, nextCursor: nextCursor || null };
}
