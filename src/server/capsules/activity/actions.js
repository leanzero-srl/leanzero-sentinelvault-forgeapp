/*
 * Activity capsule (A1, ledger #49) — read side of the activity log.
 *
 *   get-page-activity   { pageId, cursor?, limit≤100 }                 → { entries[], nextCursor }
 *   get-space-activity  { spaceKey, cursor?, limit≤100, types?[], since?, until?, pageId?, actorAccountId? }
 *                                                                        → { entries[], nextCursor, scanned }
 *
 * Both read their OWN prefix (activity-page-* / activity-space-*), so neither ever scans the
 * site. History before A1 shipped is not back-filled: the legacy `workflow-log-*` stays
 * readable through `get-workflow-log`.
 *
 * Authorization (CLAUDE.md — the caller must be able to do it themselves before the app does
 * it for them): the page feed names who did what to a page and its files, so it is gated on
 * READ of that page; the space report is a steward instrument, gated on stewardship of the
 * space named. Both payload ids are attacker-controlled; the gates fail closed.
 */
import { route } from "@forge/api";
import { appConfluence } from "../../shared/confluence-call.js";
import { canReadPage, mustVerify } from "../../shared/content-access.js";
import { isOperatorSteward, isOperatorSiteAdmin, isSpaceAdministrator } from "../../shared/steward-checks.js";
import {
  readActivity,
  matchesActivityFilter,
  activityPagePrefix,
  activitySpacePrefix,
  ACTIVITY_TYPES,
  resolveActorName,
} from "../../infra/activity-log.js";
import { decorateActorNames as decorateNames } from "./actor-names.js";
import { errText } from "../../shared/action-log.js";

const clampLimit = (limit, fallback) => {
  const n = Number(limit);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), 100);
};

const cursorOf = (v) => (typeof v === "string" && v ? v : undefined);

// The report lists events across many pages, and a row that says "Page 265912321" is not a
// report a steward can read. The READER shows the current title for the distinct page ids of the
// page it just fetched — bounded (≤100 ids), parallel, best-effort, as the app, exactly the way the
// workflow dashboard does. An entry also keeps the title its page had when it was written
// (activity-log.js), so a page deleted from the trash is still named, to a space or site admin only.
// Same idea for WHO: an entry written from a path with no user session (the hourly sweep, the
// harness hook) carries the seal record's fallback "Current User", no name at all — or the
// accountId itself in the name (BN-04, 2026-10-07: the report then read "Someone approved…" for an
// account API access names "Mihai Perdum"). The reader resolves the display name for the distinct
// unresolved accounts, as the app, bounded and parallel; a lookup that fails keeps what was stored.
// The decision is pure (./actor-names.js, test/activity-names.test.mjs).
const decorateActorNames = (entries) => decorateNames(entries, resolveActorName);

// A Confluence site admin, or an admin of this space by the space's own permissions: not a steward the
// app's lists name. Fails closed (both checks answer "no" when Confluence does not answer).
const isNativeAdmin = async (accountId, spaceKey) => {
  try {
    return (await isOperatorSiteAdmin(accountId)) || (await isSpaceAdministrator(accountId, String(spaceKey)));
  } catch (_) { return false; }
};

// What the app can tell about one page id NOW: `{ state: "found", spaceId, title }` (as a page or a blog
// post; a trashed page still answers), `{ state: "gone" }` (a real 404 as a page AND as a blog post), or
// `{ state: "error" }` (429, 5xx, a timeout, a throw: Confluence did not say).
async function contentNow(id) {
  try {
    let res = await appConfluence(route`/wiki/api/v2/pages/${id}`);
    if (res.status === 404) res = await appConfluence(route`/wiki/api/v2/blogposts/${id}`);
    if (res.status === 404) return { state: "gone" };
    if (!res.ok) return { state: "error" };
    const p = await res.json();
    return { state: "found", spaceId: p?.spaceId != null ? String(p.spaceId) : null, title: p?.title || null };
  } catch (_) { return { state: "error" }; }
}

// Per row, one of three outcomes:
//  - the page is in THIS space now: its current title, for every reader of the report (as before);
//  - the page is in another space now (A1 review F7: that title is the other space's to disclose), or
//    this space's id could not be read so a move cannot be ruled out: no title at all;
//  - Confluence answered a real 404 (deleted from the trash; it answers the app the same for a page
//    whose view restriction leaves the app out): the title the row recorded, only to a Confluence site
//    admin or space admin of this space, and removed from the answer for anyone else, so the CSV
//    export can never carry it. Any other failed read (429, 5xx, a timeout) removes it too.
// Rows written before titles were recorded have none, so they keep showing the page's id.
async function decoratePageTitles(entries, spaceKey, mayShowRecorded) {
  const ids = [...new Set(entries.map((e) => e?.pageId).filter(Boolean).map(String))].slice(0, 100);
  let spaceId = null;
  if (ids.length) {
    try {
      const sres = await appConfluence(route`/wiki/api/v2/spaces?keys=${String(spaceKey)}`, { headers: { Accept: "application/json" } });
      if (sres.ok) spaceId = String((await sres.json())?.results?.[0]?.id || "") || null;
    } catch (_) { /* hide titles below */ }
  }
  const now = new Map();
  await Promise.all(ids.map(async (id) => { now.set(id, await contentNow(id)); }));
  const liveTitle = (e) => {
    const n = now.get(String(e?.pageId));
    return n?.state === "found" && spaceId && n.spaceId === spaceId ? n.title : null;
  };
  const recordedShowable = (e) => !!(e?.pageTitle && spaceId && now.get(String(e.pageId))?.state === "gone");
  const showRecorded = entries.some(recordedShowable) && (await mayShowRecorded());
  return entries.map((e) => {
    const title = liveTitle(e);
    if (title) return { ...e, pageTitle: title };
    if (!e || typeof e !== "object" || !("pageTitle" in e)) return e;
    if (showRecorded && recordedShowable(e)) return e;
    const hidden = { ...e };
    delete hidden.pageTitle;
    return hidden;
  });
}

export const getPageActivity = async (req) => {
  const ctxPageId = req.context?.extension?.content?.id;
  const pageId = req.payload?.pageId || ctxPageId;
  if (!pageId) return { entries: [], nextCursor: null };
  // SV-SEC-1 (disclosure side): the entries name actors, files and sections on this page, so a
  // payload-named page id would enumerate that for any page on the site. A context id costs no
  // call — rendering the module there already required read access.
  if (mustVerify(req.payload?.pageId, ctxPageId)
    && !(await canReadPage(req.context?.accountId, pageId))) {
    return { entries: [], nextCursor: null, reason: "Not authorized" };
  }
  try {
    const { entries: stored, nextCursor } = await readActivity(activityPagePrefix(pageId), {
      cursor: cursorOf(req.payload?.cursor),
      limit: clampLimit(req.payload?.limit, 10),
    });
    // The page feed shows the page's own history on the page: a title a row recorded adds nothing
    // there, and a page renamed since must not show its old title (only the space report uses it).
    const entries = stored.map((e) => { if (!e || typeof e !== "object" || !("pageTitle" in e)) return e; const c = { ...e }; delete c.pageTitle; return c; });
    return { entries: await decorateActorNames(entries), nextCursor };
  } catch (e) {
    console.error("[ACTIVITY] get-page-activity failed:", errText(e));
    return { entries: [], nextCursor: null, error: "Could not load activity" };
  }
};

export const getSpaceActivity = async (req) => {
  const { spaceKey, cursor, limit, types, since, until, pageId, actorAccountId } = req.payload || {};
  const accountId = req.context?.accountId;
  if (!spaceKey) return { entries: [], nextCursor: null, scanned: 0 };
  // Steward instrument: the report crosses every page in the space, including ones the caller
  // may not be able to open, so the bar is administering the space — not reading one page in it.
  if (!(await isOperatorSteward(accountId, String(spaceKey)))) {
    return { entries: [], nextCursor: null, scanned: 0, reason: "Not authorized" };
  }
  // Unknown type strings are dropped rather than passed through: they can never match, and a
  // filter of only unknown strings would otherwise read as "no filter" (empty array = all).
  const typeFilter = Array.isArray(types)
    ? types.filter((t) => ACTIVITY_TYPES.includes(t))
    : [];
  const filter = { types: typeFilter, since, until, pageId, actorAccountId };
  try {
    const { entries, nextCursor } = await readActivity(activitySpacePrefix(spaceKey), {
      cursor: cursorOf(cursor),
      limit: clampLimit(limit, 50),
    });
    // Filters apply server-side to the page just fetched: a page may return fewer than `limit`
    // (even zero) while `nextCursor` keeps walking, which is what lets the CSV export sweep a
    // space in bounded fetches without ever loading the whole prefix.
    const matched = await decorateActorNames(await decoratePageTitles(entries.filter((e) => matchesActivityFilter(e, filter)), spaceKey, () => isNativeAdmin(accountId, spaceKey)));
    return { entries: matched, nextCursor, scanned: entries.length };
  } catch (e) {
    console.error("[ACTIVITY] get-space-activity failed:", errText(e));
    return { entries: [], nextCursor: null, scanned: 0, error: "Could not load activity" };
  }
};

export const actions = [
  ["get-page-activity", getPageActivity],
  ["get-space-activity", getSpaceActivity],
];
