import { asApp, route } from "@forge/api";

// Native page labels (names only). Shared by validations, the page trigger, and the
// #46 transition-conditions gate — authored once here, not copied per capsule.
// Paginated: v2 defaults to 25 labels a page; a state label past the 25th would never be seen
// (B4 review) and a scoping label past it would silently pick the default workflow (B1).
export async function fetchPageLabels(pageId) {
  const out = [];
  try {
    let cursor = null;
    for (let i = 0; i < 8; i++) {
      const res = cursor
        ? await asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}/labels?limit=250&cursor=${cursor}`)
        : await asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}/labels?limit=250`);
      if (!res.ok) break;
      const body = await res.json();
      for (const l of body.results || []) if (l?.name) out.push(l.name);
      const next = body?._links?.next;
      cursor = next ? new URLSearchParams(String(next).split("?")[1] || "").get("cursor") : null;
      if (!cursor) break;
    }
  } catch (_) { /* best-effort: what was read so far */ }
  return out;
}
