import { asApp, asUser, route } from "@forge/api";

/*
 * asUser() with an asApp() fallback for the ONE context where there is no user session: a
 * resolver invoked from the config-api queue consumer (docs/REST-CONFIG-API.md — a token acts as
 * the account that minted it, through the same handler the UI calls). In a resolver called from
 * the UI asUser works and the fallback never runs. The fallback is for METADATA reads only
 * (a display name, an attachment's title/version, a page title); every authorization decision
 * still goes through content-access.js / steward-checks.js, which name the subject explicitly.
 */
export async function requestUserOrApp(routeObj, init) {
  try {
    const res = await asUser().requestConfluence(routeObj, init);
    if (res.ok || (res.status !== 401 && res.status !== 403)) return res;
  } catch (_) { /* no user context → app */ }
  return asApp().requestConfluence(routeObj, init);
}

/** { displayName, email } for the acting account: /user/current as the user, else /user?accountId as the app. */
export async function currentUserProfile(accountId) {
  try {
    const res = await asUser().requestConfluence(route`/wiki/rest/api/user/current`);
    if (res.ok) { const d = await res.json(); if (d?.accountId && (!accountId || d.accountId === accountId)) return { displayName: d.displayName || null, email: d.email || null }; }
  } catch (_) { /* no user context */ }
  if (!accountId) return { displayName: null, email: null };
  try {
    const res = await asApp().requestConfluence(route`/wiki/rest/api/user?accountId=${accountId}`);
    if (res.ok) { const d = await res.json(); return { displayName: d.displayName || d.publicName || null, email: d.email || null }; }
  } catch (_) { /* best effort */ }
  return { displayName: null, email: null };
}
