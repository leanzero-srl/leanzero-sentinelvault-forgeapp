/*
 * Byline fan-out (classification review 2026-09-30, root cause E(2)).
 *
 * The byline chip is a content property Confluence renders without calling us, so a change that
 * alters what EVERY page of a space should say — a space default, a space opting out, the site
 * switch — reached no page until something else touched it. `ribbon-summary` now converges a page
 * on its first view (the lazy half); this is the eager half: a bounded walk of a space's pages
 * through the SAME stamp-checked `refreshByline`, so an unchanged chip costs a KVS read and no write.
 *
 * No new manifest module: the job rides the existing `realm-audit-queue` consumer (900 s), which
 * dispatches on `body.kind === "byline-refresh"` (realms/scan-worker.js). Bounds: PAGE_BUDGET pages
 * per hop, a continuation job carries the cursor, MAX_HOPS hops per space (pages, then blogposts).
 * A newer job for the same space supersedes an older one (token in `byline-fanout-{spaceId}`), so
 * five quick default changes cost one walk. Never awaited into anyone's success: queueing is best
 * effort and logged.
 */
import { asApp, route } from "@forge/api";
import { kvs, WhereConditions } from "@forge/kvs";

export const FANOUT_KIND = "byline-refresh";
const QUEUE_KEY = "realm-audit-queue";
const PAGE_BUDGET = 250;
const MAX_HOPS = 20; // 20 × 250 = 5 000 pages + blogposts per space; the lazy path covers the rest
const CONCURRENCY = 3;
const MAX_SITE_SPACES = 100;
const NUMERIC = /^\d{1,20}$/;
const tokenKey = (spaceId) => `byline-fanout-${spaceId}`;

async function push(events) {
  const { Queue } = await import("@forge/events"); // lazily: a Queue built at module load broke the hook bundle (it17)
  const q = new Queue({ key: QUEUE_KEY });
  for (let i = 0; i < events.length; i += 50) await q.push(events.slice(i, i + 50).map((body) => ({ body })));
}

/** Queue a refresh of every page in these spaces. Best effort; returns how many were queued. */
export async function queueBylineRefresh(spaceIds, why = "") {
  const ids = [...new Set((spaceIds || []).map(String).filter((id) => NUMERIC.test(id)))];
  if (!ids.length) return 0;
  try {
    const events = [];
    for (const spaceId of ids) {
      const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      await kvs.set(tokenKey(spaceId), { token, why: String(why).slice(0, 80), queuedAt: new Date().toISOString() });
      events.push({ kind: FANOUT_KIND, spaceId, token, coll: "pages", cursor: null, hop: 0 });
    }
    await push(events);
    console.info(`[BYLINE-FANOUT] queued ${events.length} space(s) (${why})`);
    return events.length;
  } catch (e) {
    console.warn(`[BYLINE-FANOUT] queue failed (${why}):`, e?.message || e);
    return 0;
  }
}

/** The same, for a space KEY (store-policy knows only the key). */
export async function queueBylineRefreshForKey(spaceKey, why = "") {
  if (!spaceKey) return 0;
  try {
    const res = await asApp().requestConfluence(route`/wiki/api/v2/spaces?keys=${spaceKey}&limit=1`, { headers: { Accept: "application/json" } });
    const id = res.ok ? (await res.json())?.results?.[0]?.id : null;
    return id != null ? queueBylineRefresh([String(id)], why) : 0;
  } catch (e) {
    console.warn(`[BYLINE-FANOUT] space ${spaceKey} lookup failed:`, e?.message || e);
    return 0;
  }
}

/**
 * The site switch changes every chip on the site. Eagerly: the spaces that carry a default (the
 * pages whose chip changes the most — a level appears or vanishes), capped; every other page
 * converges on its next view through ribbon-summary.
 */
export async function queueBylineRefreshSiteWide(why = "") {
  const ids = [];
  try {
    let q = kvs.query().where("key", WhereConditions.beginsWith("classification-space-")).limit(100);
    for (let i = 0; i < 5 && ids.length < MAX_SITE_SPACES; i++) {
      const { results, nextCursor } = await q.getMany();
      for (const { key } of results || []) ids.push(String(key).slice("classification-space-".length));
      if (!nextCursor) break;
      q = kvs.query().where("key", WhereConditions.beginsWith("classification-space-")).limit(100).cursor(nextCursor);
    }
  } catch (e) { console.warn("[BYLINE-FANOUT] space-default scan failed:", e?.message || e); }
  return queueBylineRefresh(ids.slice(0, MAX_SITE_SPACES), why);
}

async function mapLimited(items, limit, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx]); }
  }));
}

/** The consumer half — one hop of one space. */
export async function runBylineRefreshJob(body) {
  const { spaceId, token, coll = "pages", cursor = null, hop = 0 } = body || {};
  if (!NUMERIC.test(String(spaceId || "")) || !["pages", "blogposts"].includes(coll)) return { ok: false, reason: "bad job" };
  const current = await kvs.get(tokenKey(spaceId)).catch(() => null);
  if (current?.token && current.token !== token) { console.info(`[BYLINE-FANOUT] ${spaceId}: superseded by a newer job`); return { ok: true, superseded: true }; }
  const { refreshByline } = await import("./byline.js");
  let next = cursor;
  let done = 0;
  let wrote = 0;
  while (done < PAGE_BUDGET) {
    const url = coll === "blogposts"
      ? (next ? route`/wiki/api/v2/spaces/${spaceId}/blogposts?limit=50&cursor=${next}` : route`/wiki/api/v2/spaces/${spaceId}/blogposts?limit=50`)
      : (next ? route`/wiki/api/v2/spaces/${spaceId}/pages?limit=50&cursor=${next}` : route`/wiki/api/v2/spaces/${spaceId}/pages?limit=50`);
    const res = await asApp().requestConfluence(url, { headers: { Accept: "application/json" } });
    if (!res.ok) { console.warn(`[BYLINE-FANOUT] ${spaceId} ${coll} list → ${res.status}`); next = null; break; }
    const data = await res.json();
    const ids = (data?.results || []).map((p) => String(p?.id || "")).filter((id) => NUMERIC.test(id));
    await mapLimited(ids, CONCURRENCY, async (id) => {
      const r = await refreshByline(id).catch((e) => { console.warn(`[BYLINE-FANOUT] ${id}:`, e?.message || e); return null; });
      if (r?.wrote) wrote++;
    });
    done += ids.length;
    const link = data?._links?.next;
    try { next = link ? new URL(link, "https://example.com").searchParams.get("cursor") : null; } catch (_) { next = null; }
    if (!next) break;
  }
  console.info(`[BYLINE-FANOUT] ${spaceId} ${coll} hop ${hop}: ${done} checked, ${wrote} rewritten`);
  // Continue: the same collection from the cursor, else blogposts after pages; never past MAX_HOPS.
  const follow = next ? { coll, cursor: next } : coll === "pages" ? { coll: "blogposts", cursor: null } : null;
  if (follow && hop + 1 < MAX_HOPS) await push([{ kind: FANOUT_KIND, spaceId: String(spaceId), token, hop: hop + 1, ...follow }]).catch((e) => console.warn("[BYLINE-FANOUT] continuation failed:", e?.message || e));
  return { ok: true, done, wrote };
}
