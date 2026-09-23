import { asApp, route } from "@forge/api";

// Native page labels (names only). Shared by validations, the page trigger, and the
// #46 transition-conditions gate — authored once here, not copied per capsule.
// Paginated: v2 defaults to 25 labels a page; a state label past the 25th would never be seen
// (B4 review) and a scoping label past it would silently pick the default workflow (B1).
/**
 * Labels plus whether the read was COMPLETE. A refused or failed read used to come back as an
 * empty list — indistinguishable from a page with no labels, so a "Require labels" rule reported
 * the label missing (tester, 2026-09-23). Callers that judge a page on its labels use this and
 * decline to judge when `complete` is false.
 * @returns {Promise<{ labels: string[], complete: boolean, status?: number }>}
 */
export async function fetchPageLabelsChecked(pageId) {
  const labels = [];
  try {
    let cursor = null;
    for (let i = 0; i < 8; i++) {
      const res = cursor
        ? await asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}/labels?limit=250&cursor=${cursor}`)
        : await asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}/labels?limit=250`);
      if (!res.ok) {
        console.warn(`[LABELS] page ${pageId}: label read refused (HTTP ${res.status})`);
        return { labels, complete: false, status: res.status };
      }
      const body = await res.json();
      for (const l of body.results || []) if (l?.name) labels.push(l.name);
      const next = body?._links?.next;
      cursor = next ? new URLSearchParams(String(next).split("?")[1] || "").get("cursor") : null;
      if (!cursor) return { labels, complete: true };
    }
    // Eight pages of 250 and still more: judged on what was read, and said so.
    console.warn(`[LABELS] page ${pageId}: more than 2000 labels — read the first 2000`);
    return { labels, complete: false };
  } catch (e) {
    console.warn(`[LABELS] page ${pageId}: label read failed:`, e?.message || e);
    return { labels, complete: false };
  }
}

/** Labels, best effort: what was read so far (a failure is logged by the checked variant). */
export async function fetchPageLabels(pageId) {
  return (await fetchPageLabelsChecked(pageId)).labels;
}
