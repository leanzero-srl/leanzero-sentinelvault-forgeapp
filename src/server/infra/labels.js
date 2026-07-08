import { asApp, route } from "@forge/api";

// Native page labels (names only). Shared by validations, the page trigger, and the
// #46 transition-conditions gate — authored once here, not copied per capsule.
export async function fetchPageLabels(pageId) {
  try {
    const res = await asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}/labels`);
    if (!res.ok) return [];
    const body = await res.json();
    return (body.results || []).map((l) => l.name);
  } catch (_) {
    return [];
  }
}
