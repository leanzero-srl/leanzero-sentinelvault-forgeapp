// Where a page IS, for many pages at once — the by-state workflow index and the seal index are
// KVS rows that outlive the page they describe. Confluence keeps a trashed page (v2 GET returns
// it with status "trashed"; the dashboard listed thirteen of them as live work on 2026-09-05)
// and forgets a purged one (404). No page-trashed event is subscribed, so the readers ask.
//
// `GET /wiki/api/v2/pages?id=a,b,c&status=…` answers for up to 250 ids per call (probed live:
// a comma list, 251 → 400; `status` accepts ARCHIVED, CURRENT, DELETED, TRASHED). Two calls per
// batch — the live set and the trashed set — and an id in neither is gone.
//
// FAIL CLOSED toward "present": a page is reported `missing` only when BOTH calls succeeded and
// neither returned it. A failed call marks the whole batch `unknown` so a transient 5xx can never
// license a purge — "a negative that authorises action must be proven, not observed".
import { asApp, route } from "@forge/api";

export const PAGE_STATUS_BATCH = 250;

// PURE. Given the ids asked for and the two result lists, classify each id.
export function classifyPageStatuses(ids, liveResults, trashedResults, { liveOk = true, trashedOk = true } = {}) {
  const out = new Map();
  const live = new Map((liveResults || []).map((p) => [String(p.id), p]));
  const trashed = new Map((trashedResults || []).map((p) => [String(p.id), p]));
  for (const raw of ids) {
    const id = String(raw);
    const l = live.get(id);
    const t = trashed.get(id);
    if (l) out.set(id, { status: l.status === "archived" ? "archived" : "current", title: l.title || null, url: l._links?.webui || null });
    else if (t) out.set(id, { status: "trashed", title: t.title || null, url: t._links?.webui || null });
    else if (liveOk && trashedOk) out.set(id, { status: "missing", title: null, url: null });
    else out.set(id, { status: "unknown", title: null, url: null });
  }
  return out;
}

async function fetchBatch(ids, status) {
  const res = await asApp().requestConfluence(route`/wiki/api/v2/pages?id=${ids.join(",")}&status=${status}&limit=250`);
  if (!res.ok) return { ok: false, results: [] };
  const body = await res.json().catch(() => null);
  return { ok: Array.isArray(body?.results), results: body?.results || [] };
}

// Map of String(pageId) → { status: "current"|"archived"|"trashed"|"missing"|"unknown", title, url }.
export async function fetchPageStatuses(pageIds) {
  const ids = [...new Set((pageIds || []).map((x) => String(x)).filter((x) => /^\d+$/.test(x)))];
  const out = new Map();
  for (let i = 0; i < ids.length; i += PAGE_STATUS_BATCH) {
    const batch = ids.slice(i, i + PAGE_STATUS_BATCH);
    let live = { ok: false, results: [] }, gone = { ok: false, results: [] };
    try { [live, gone] = await Promise.all([fetchBatch(batch, "current,archived"), fetchBatch(batch, "trashed")]); } catch (_) { /* unknown */ }
    for (const [k, v] of classifyPageStatuses(batch, live.results, gone.results, { liveOk: live.ok, trashedOk: gone.ok })) out.set(k, v);
  }
  return out;
}
