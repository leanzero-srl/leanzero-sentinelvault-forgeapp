/*
 * One-time repair (8.20.0): activity rows filed under ANOTHER SITE's space key.
 *
 * From 8.9.0 to 8.19.0 recordActivity remembered "which space is page P in" for a minute in module
 * scope, keyed by the page id alone. One Forge process serves several sites and page ids repeat
 * across sites (measured 2026-10-23: two of our own production sites share page ids such as 229377),
 * so an event on page P of this site could be filed under the space key page P had on another site.
 * The memo now lives in the invocation (activity-log.js). This walk puts back what it may have filed.
 *
 * A row is re-filed only when every check below holds; everything else is left exactly as it is:
 *   1. it names a page and was written on or after REFILE_SINCE (the memo shipped in 8.9.0);
 *   2. Confluence answers (200) that its space key is no space of this site. The v2 `keys=` lookup
 *      answers archived and personal spaces too (measured on wolfaenpak 2026-10-23), so a space that
 *      is only archived is never taken for a foreign one;
 *   3. THIS site's own records never named that key before the memo existed: no activity row filed
 *      under it before REFILE_SINCE and no Sentinel Vault settings record for it. Confluence answers the
 *      app "no such space" for a space it may not see too (an app access rule, a space permission taken
 *      from the app), so the lookup alone does not prove the key belongs to another site; a space this
 *      site used before the memo cannot be foreign. And no OTHER page, and no space-level event (a row
 *      naming no page), has a row under that key here: the memo misfiled one page id at a time, while a
 *      real space has the events of its pages and of the space itself;
 *   4. the page's current space on this site is found, and the same lookup finds THAT key (a positive
 *      control on the same endpoint in the same run, so an empty answer is not a broken lookup).
 * The row moves to the page's current space; its page-feed twin gets the same space key; then the
 * foreign-keyed row is deleted. A row that fails any check stays where it is (counted as `kept`): this
 * includes a row whose page the app cannot read now and a foreign key that is also a space here.
 * What stays possible (accepted): a space first used with Sentinel Vault after REFILE_SINCE, holding
 * events of ONE page only, then deleted or hidden from the app, with that page moved out to another
 * space; its rows would be moved to the page's current space. A lookup Confluence could not
 * answer (429, 5xx) stops the run and the next sweep tries the same rows again; after
 * REFILE_TRIES_PER_PAGE stops at the same rows, counted at least ten minutes apart, those rows are
 * passed over (counted). One step runs at a time per site (a KVS lock).
 *
 * Interlock: a backup restore or import since REFILE_SINCE (finished, failed half way, or running now:
 * the backup lease is held) brings rows from a backup, possibly of ANOTHER site (an import), whose page
 * ids mean different pages here; re-filing those by this site's pages would mix sites again. Such a
 * site is left alone (`done` with reason "restored"); while a lease is held the step waits.
 *
 * Runs from the five-minute page guard sweep under a small time budget until done. State:
 *   activity-refile-state  { cursor, checked, refiled, kept, passedOver, tries, failures, done, reason, at }
 * Never throws; prints counts only (a space key can be a personal space, i.e. a person's id).
 */
import { kvs, WhereConditions } from "@forge/kvs";
import { route } from "@forge/api";
import { appConfluence, isRateLimited } from "../shared/confluence-call.js";
import { liveContentSpace } from "../shared/content-access.js";
import { activityPagePrefix, activitySpacePrefix, SITE_PREFIX } from "./activity-log.js";
import { errText } from "../shared/action-log.js";
import { lockIsStale, acquireLock, releaseLock } from "../shared/kvs-lock.js";

export const REFILE_STATE_KEY = "activity-refile-state";
// 8.9.0 (the first release with the memo) was built on 2026-10-18 (Bucharest); half a day earlier
// as a margin. Rows before it were never filed by the memo and are not looked at.
export const REFILE_SINCE = "2026-10-17T12:00:00.000Z";
export const REFILE_BUDGET_MS = 5_000;
export const REFILE_TRIES_PER_PAGE = 3;
const SPACE_PREFIX = "activity-space-";
const PAGE_SIZE = 100;
const RESTORE_TYPES = Object.freeze(["backup.restored", "backup.imported", "backup.restore-failed"]);
const BACKUP_LEASE_KEY = "backup-lease"; // capsules/backup/worker.js: held while a backup, restore or import runs
const BACKUP_LEASE_MS = 16 * 60000;
const CURSOR_FAILURES_BEFORE_RESTART = 3;
const REFILE_LOCK_KEY = "activity-refile-lock"; // one step at a time per site (a move's take-back must never meet another run's move)
const REFILE_LOCK_MS = 60_000;
const TRY_SPACING_MS = 10 * 60000; // a stop counts as a new try only this long after the last counted one

/** Is `key` a space of this site? true / false (Confluence answered) / null (could not tell). */
async function spaceKeyExists(key) {
  try {
    const res = await appConfluence(route`/wiki/api/v2/spaces?keys=${key}&limit=1`, { headers: { Accept: "application/json" } });
    if (isRateLimited(res) || !res.ok) return null;
    const body = await res.json();
    if (!body || !Array.isArray(body.results)) return null;
    return body.results.length > 0;
  } catch (_) { return null; }
}

/** PURE. The verdict for one row, given the run's lookups (`known`: this site named the key before the memo). */
export function refileVerdict(row, key, { sinceMs, exists, known = false, otherPages = false, live, control }) {
  if (!row || typeof row !== "object" || !row.pageId || !row.spaceKey || !row.id) return { verdict: "skip" };
  const ts = Date.parse(row.ts);
  if (!Number.isFinite(ts) || ts < sinceMs) return { verdict: "skip" };
  if (key !== `${activitySpacePrefix(row.spaceKey)}${row.id}`) return { verdict: "skip" };
  if (exists === true) return { verdict: "local" };
  if (exists !== false) return { verdict: "unknown" };
  if (known === true) return { verdict: "local" };
  if (known !== false) return { verdict: "unknown" };
  if (otherPages) return { verdict: "kept" };
  if (!live || live.status === "error") return { verdict: "unknown" };
  if (live.status !== "found" || !live.spaceKey) return { verdict: "kept" };
  if (live.spaceKey === row.spaceKey) return { verdict: "local" };
  if (control === null || control === undefined) return { verdict: "unknown" };
  if (control !== true) return { verdict: "kept" };
  return { verdict: "foreign", to: live.spaceKey };
}

/**
 * Was a backup restored or imported on this site since `sinceMs`? true / false / null (could not tell).
 * Site rows are newest first (inverted timestamp keys); the walk ends at the first older row.
 */
const RESTORE_LOOK_PAGES = 30;
async function restoredSince(sinceMs) {
  try {
    let cursor = null;
    for (let i = 0; i < RESTORE_LOOK_PAGES; i++) {
      let q = kvs.query().where("key", WhereConditions.beginsWith(SITE_PREFIX)).limit(PAGE_SIZE);
      if (cursor) q = q.cursor(cursor);
      const { results, nextCursor } = await q.getMany();
      for (const { value } of results || []) {
        const ts = Date.parse(value?.ts);
        if (Number.isFinite(ts) && ts < sinceMs) return false;
        if (RESTORE_TYPES.includes(value?.type)) return true;
      }
      if (!nextCursor) return false;
      cursor = nextCursor;
    }
    return true; // more site history than we read: treated as a restore (left alone), never assumed clean
  } catch (_) { return null; }
}

/**
 * What THIS site's own records say about `key`: { known: true } when an activity row was filed under
 * it before `sinceMs` or a Sentinel Vault settings record exists for the space; else { known: false,
 * pages } with the page ids of every row filed under the key; null when that could not be read.
 */
const KNOWN_LOOK_PAGES = 50;
async function knownHere(key, sinceMs) {
  try {
    if (await kvs.get(`admin-settings-space-${String(key).replace(/[^a-zA-Z0-9:._\s-#]/g, "_")}`)) return { known: true };
    const pages = new Set();
    let cursor = null;
    for (let i = 0; i < KNOWN_LOOK_PAGES; i++) {
      let q = kvs.query().where("key", WhereConditions.beginsWith(activitySpacePrefix(key))).limit(PAGE_SIZE);
      if (cursor) q = q.cursor(cursor);
      const { results, nextCursor } = await q.getMany();
      for (const { value } of results || []) {
        if (value?.spaceKey !== key) continue; // another key with the same KVS segment
        const ts = Date.parse(value?.ts);
        if (Number.isFinite(ts) && ts < sinceMs) return { known: true };
        pages.add(String(value?.pageId ?? "")); // "" = a space-level event: this site's own space
      }
      if (!nextCursor) return { known: false, pages };
      cursor = nextCursor;
    }
    return { known: true }; // a long history under the key: a real space, never moved
  } catch (_) { return null; }
}

/** Is a backup, restore or import running on this site right now? true / false / null. */
async function backupRunning(nowMs) {
  try { const row = await kvs.get(BACKUP_LEASE_KEY); return !!row && !lockIsStale(row, nowMs, BACKUP_LEASE_MS); } catch (_) { return null; }
}

/**
 * Move one row. Reads the row afresh first (the privacy sweep may have rewritten or removed it since
 * the walk read it) and writes only from that value; if the row is gone afterwards, the new copy and
 * the twin's change are taken back, so nothing removed by retention or erasure comes back.
 * A run stopped between the steps leaves at most a duplicate, which the next step settles.
 */
async function moveRow(oldKey, row, to) {
  const fresh = await kvs.get(oldKey);
  if (!fresh || fresh.spaceKey !== row.spaceKey) return false;
  const newKey = `${activitySpacePrefix(to)}${row.id}`;
  await kvs.set(newKey, { ...fresh, spaceKey: to });
  const pageKey = `${activityPagePrefix(row.pageId)}${row.id}`;
  const twin = await kvs.get(pageKey);
  const twinMoved = !!twin && twin.spaceKey === row.spaceKey;
  if (twinMoved) await kvs.set(pageKey, { ...twin, spaceKey: to });
  const latest = await kvs.get(oldKey);
  if (!latest) {
    await kvs.delete(newKey);
    if (twinMoved && (await kvs.get(pageKey))) await kvs.set(pageKey, twin);
    return false;
  }
  if (JSON.stringify(latest) !== JSON.stringify(fresh)) await kvs.set(newKey, { ...latest, spaceKey: to });
  await kvs.delete(oldKey);
  return true;
}

/**
 * One budgeted step of the repair. Returns { skipped } once done, else the counts so far.
 * `now` and `budgetMs` are seams for tests.
 */
export async function refileForeignActivity(opts = {}) {
  // Done: one KVS read per sweep from then on, no lock (the step re-checks inside the lock).
  try { if ((await kvs.get(REFILE_STATE_KEY))?.done) return { skipped: true, done: true }; } catch (_) { /* read again inside */ }
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let held = false;
  try { held = await acquireLock(REFILE_LOCK_KEY, REFILE_LOCK_MS, token); } catch (_) { held = false; }
  if (!held) return { skipped: false, waiting: true };
  try { return await refileStep(opts); } finally { await releaseLock(REFILE_LOCK_KEY, token).catch(() => {}); }
}

async function refileStep({ budgetMs = REFILE_BUDGET_MS, now = () => Date.now(), sinceIso = REFILE_SINCE } = {}) {
  let state;
  try { state = await kvs.get(REFILE_STATE_KEY); } catch (e) { console.warn("[ACTIVITY-REFILE] state read failed:", errText(e)); return { skipped: true, error: true }; }
  if (state?.done) return { skipped: true, done: true };
  const sinceMs = Date.parse(sinceIso);
  const started = now();
  const s = { cursor: null, checked: 0, refiled: 0, kept: 0, passedOver: 0, tries: 0, failures: 0, ...(state || {}) };
  const save = async (extra = {}) => {
    Object.assign(s, extra, { at: new Date(now()).toISOString() });
    await kvs.set(REFILE_STATE_KEY, s).catch((e) => console.warn("[ACTIVITY-REFILE] state write failed:", errText(e)));
  };
  // Asked at every step until done: an import that lands while the walk is under way stops it too.
  const running = await backupRunning(now());
  if (running !== false) return { ...s, waiting: true };
  const restored = await restoredSince(sinceMs);
  if (restored === null) return { ...s, waiting: true };
  if (restored) { await save({ done: true, reason: "restored", cursor: null }); return { ...s }; }
  const exists = new Map(); // space key -> true | false, this run only
  const where = new Map();  // page id -> liveContentSpace answer (found / gone), this run only
  const known = new Map();  // space key -> knownHere answer, this run only
  const knownOf = async (key) => {
    if (known.has(key)) return known.get(key);
    const v = await knownHere(key, sinceMs);
    if (v !== null) known.set(key, v);
    return v;
  };
  const existsOf = async (key) => {
    if (exists.has(key)) return exists.get(key);
    const v = await spaceKeyExists(key);
    if (v !== null) exists.set(key, v);
    return v;
  };
  try {
    while (now() - started < budgetMs) {
      let q = kvs.query().where("key", WhereConditions.beginsWith(SPACE_PREFIX)).limit(PAGE_SIZE);
      if (s.cursor) q = q.cursor(s.cursor);
      const { results, nextCursor } = await q.getMany();
      // The last try at these rows passes the unknown ones over, and only once it is itself spaced.
      const spaced = !s.triedAt || now() - Date.parse(s.triedAt) >= TRY_SPACING_MS;
      const lenient = s.tries + 1 >= REFILE_TRIES_PER_PAGE && spaced;
      // Counts of THIS page are kept apart and added only when the page is final, so a page read twice
      // (a stop, or rows moved) is counted once.
      const pg = { checked: 0, kept: 0, passed: 0, moved: 0 };
      let stopped = false;
      let outOfTime = false;
      for (const { key, value } of results || []) {
        // A page that needed many lookups stops at the budget too; it is read again next step.
        if (now() - started > budgetMs + 3_000) { outOfTime = true; break; }
        pg.checked++;
        const row = value;
        if (refileVerdict(row, key, { sinceMs, exists: true }).verdict === "skip") continue;
        const ex = await existsOf(String(row.spaceKey));
        let live = null, control, kn, otherPages = false;
        if (ex === false) {
          const k = await knownOf(String(row.spaceKey));
          kn = k === null ? null : k.known;
          otherPages = !!k && !k.known && [...k.pages].some((p) => p !== String(row.pageId));
        }
        if (ex === false && kn === false && !otherPages) {
          const pid = String(row.pageId);
          live = where.get(pid) || await liveContentSpace(pid).catch(() => ({ status: "error" }));
          if (live.status !== "error") where.set(pid, live);
          if (live.status === "found" && live.spaceKey && live.spaceKey !== row.spaceKey) control = await existsOf(live.spaceKey);
        }
        const v = refileVerdict(row, key, { sinceMs, exists: ex, known: kn, otherPages, live, control });
        if (v.verdict === "unknown") {
          if (lenient) { pg.passed++; continue; }
          stopped = true; break;
        }
        if (v.verdict === "kept") pg.kept++;
        if (v.verdict === "foreign" && (await moveRow(key, row, v.to))) { pg.moved++; s.refiled++; }
      }
      if (stopped) {
        // Tries are counted at least TRY_SPACING_MS apart, so a short burst of 429s never passes rows over.
        const counted = !s.triedAt || now() - Date.parse(s.triedAt) >= TRY_SPACING_MS;
        await save(counted ? { tries: s.tries + 1, triedAt: new Date(now()).toISOString() } : {});
        return { ...s, stopped: true };
      }
      if (outOfTime) { await save(); return { ...s }; }
      // Rows were deleted from this page: read the same rows again (a moved row is local now), so a
      // cursor that counts positions never skips the rows that slid into the gap.
      if (pg.moved > 0) { await save({ tries: 0 }); continue; }
      s.checked += pg.checked;
      s.kept += pg.kept;
      s.passedOver += pg.passed;
      if (!nextCursor) { await save({ done: true, tries: 0, failures: 0, cursor: null }); return { ...s }; }
      await save({ cursor: nextCursor, tries: 0, failures: 0 });
    }
    return { ...s };
  } catch (e) {
    // One failure keeps the cursor; repeated failures at it mean KVS no longer accepts it: start over
    // (the walk is idempotent: rows already moved are local now).
    const failures = (s.failures || 0) + 1;
    const restart = failures >= CURSOR_FAILURES_BEFORE_RESTART;
    console.warn(`[ACTIVITY-REFILE] step failed (${failures} at this cursor)${restart ? ", starting over" : ""}:`, errText(e));
    await save(restart ? { failures: 0, cursor: null } : { failures });
    return { ...s, error: true };
  }
}
