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
import { asApp, route } from "@forge/api";
import { canReadPage, mustVerify } from "../../shared/content-access.js";
import { isOperatorSteward } from "../../shared/steward-checks.js";
import {
  readActivity,
  matchesActivityFilter,
  activityPagePrefix,
  activitySpacePrefix,
  ACTIVITY_TYPES,
} from "../../infra/activity-log.js";

const clampLimit = (limit, fallback) => {
  const n = Number(limit);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), 100);
};

const cursorOf = (v) => (typeof v === "string" && v ? v : undefined);

// The report lists events across many pages, and a row that says "Page 265912321" is not a
// report a steward can read. Entries deliberately carry no title (a title changes; the record
// must not), so the READER resolves titles for the distinct page ids of the page it just
// fetched — bounded (≤100 ids), parallel, best-effort, as the app, exactly the way the
// workflow dashboard does. A page the app cannot read keeps its id.
// Same idea for WHO: an entry written from a path with no user session (the hourly sweep, the
// harness hook) carries the seal record's fallback "Current User" or no name at all. The
// reader resolves the display name for the distinct unresolved account ids, as the app,
// bounded and parallel; a lookup that fails keeps what was stored.
const UNRESOLVED_NAME = /^(?:current user|user [0-9a-f]{4})$/i;
async function decorateActorNames(entries) {
  const ids = [...new Set(entries
    .filter((e) => e?.actor?.accountId && (!e.actor.name || UNRESOLVED_NAME.test(String(e.actor.name))))
    .map((e) => e.actor.accountId))].slice(0, 100);
  if (!ids.length) return entries;
  const names = new Map();
  await Promise.all(ids.map(async (id) => {
    try {
      const res = await asApp().requestConfluence(route`/wiki/rest/api/user?accountId=${id}`);
      if (res.ok) { const u = await res.json(); if (u?.displayName) names.set(id, u.displayName); }
    } catch (_) { /* best-effort */ }
  }));
  return entries.map((e) => (e?.actor?.accountId && names.has(e.actor.accountId)
    ? { ...e, actor: { ...e.actor, name: names.get(e.actor.accountId) } }
    : e));
}

async function decoratePageTitles(entries, spaceKey) {
  const ids = [...new Set(entries.map((e) => e?.pageId).filter(Boolean))].slice(0, 100);
  if (!ids.length) return entries;
  // A page can be MOVED to another space after its events were recorded under this one; the
  // record stays (it is history), but its current title is that other space's to disclose,
  // not this steward's (A1 review F7). The v2 page read carries spaceId, so this costs nothing.
  let spaceId = null;
  try {
    const sres = await asApp().requestConfluence(route`/wiki/api/v2/spaces?keys=${String(spaceKey)}`, { headers: { Accept: "application/json" } });
    if (sres.ok) spaceId = String((await sres.json())?.results?.[0]?.id || "");
  } catch (_) { /* best-effort */ }
  const titles = new Map();
  await Promise.all(ids.map(async (id) => {
    try {
      const res = await asApp().requestConfluence(route`/wiki/api/v2/pages/${id}`);
      if (res.ok) {
        const p = await res.json();
        if (p?.title && (!spaceId || String(p.spaceId) === spaceId)) titles.set(String(id), p.title);
      }
    } catch (_) { /* best-effort */ }
  }));
  return entries.map((e) => (titles.has(String(e?.pageId)) ? { ...e, pageTitle: titles.get(String(e.pageId)) } : e));
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
    const { entries, nextCursor } = await readActivity(activityPagePrefix(pageId), {
      cursor: cursorOf(req.payload?.cursor),
      limit: clampLimit(req.payload?.limit, 10),
    });
    return { entries: await decorateActorNames(entries), nextCursor };
  } catch (e) {
    console.error("[ACTIVITY] get-page-activity failed:", e);
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
    const matched = await decorateActorNames(await decoratePageTitles(entries.filter((e) => matchesActivityFilter(e, filter)), spaceKey));
    return { entries: matched, nextCursor, scanned: entries.length };
  } catch (e) {
    console.error("[ACTIVITY] get-space-activity failed:", e);
    return { entries: [], nextCursor: null, scanned: 0, error: "Could not load activity" };
  }
};

export const actions = [
  ["get-page-activity", getPageActivity],
  ["get-space-activity", getSpaceActivity],
];
