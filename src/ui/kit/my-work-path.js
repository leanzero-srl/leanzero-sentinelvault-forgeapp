/*
 * The My work global page lives at /wiki/apps/{appId}/{environmentId}/{route}. The environment
 * segment was missing (tester report 2026-09-19: "Open my work" → Confluence's "Well, this is
 * awkward" 404 on production) — it happened to resolve on the dev install. The id comes from the
 * bridge context of the surface that links.
 */
export const APP_ID = "c30bf71e-4287-4872-954d-db49cc68f0ff";
export function myWorkPath(ctx) {
  const env = ctx?.environmentId ? String(ctx.environmentId) : null;
  return env ? `/wiki/apps/${APP_ID}/${env}/my-work` : `/wiki/apps/${APP_ID}/my-work`;
}
