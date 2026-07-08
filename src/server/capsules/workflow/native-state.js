/*
 * #47 — Native content-state mirroring. Projects the app's workflow state onto
 * Confluence's OWN native content-status pill (the coloured badge in the page header),
 * so the state is visible in native Confluence UI, not only the app's ribbon.
 *
 * Endpoint (v1, Forge-supported): PUT /wiki/rest/api/content/{id}/state?status=current
 * — auto-publishes a new version (body unchanged). Rides write:confluence-content, which
 * the app already holds (no new scope, no re-consent). KVS (workflow-state-{pageId}) stays
 * the source of truth; this pill is a best-effort projection, never a dependency.
 *
 * The write is IDEMPOTENT (GET-then-skip) so it only fires on a genuine state change —
 * critical, because every PUT bumps the page version. The app's own version bumps are
 * absorbed by the trigger's app-account guard, and the integrity sweep treats the app as
 * an authorised author, so mirroring never trips #44's tamper enforcement.
 */
import { asApp, route } from "@forge/api";

// Solid/saturated per house style — no pastels. Confluence resolves an existing custom
// state by name+colour, else creates one (where the space allows custom states).
export const NATIVE_STATE_MAP = {
  draft: { name: "Draft", color: "#42526E" },
  in_review: { name: "In Review", color: "#0052CC" },
  approved: { name: "Approved", color: "#00875A" },
  expired: { name: "Expired", color: "#DE350B" },
};

// Read the current native content-state (shape-tolerant across API variants).
export async function readNativeState(pageId) {
  try {
    const res = await asApp().requestConfluence(
      route`/wiki/rest/api/content/${pageId}/state?status=current`,
    );
    if (res.ok) {
      const body = await res.json();
      // Observed shapes: {contentState:{name,color}} or {name,color} or {id,name,color}.
      const s = body?.contentState || body;
      return s && (s.name || s.id != null) ? { name: s.name ?? null, color: s.color ?? null, id: s.id ?? null } : null;
    }
  } catch (_) { /* best-effort */ }
  return null;
}

// Mirror the workflow state onto the native pill. Skips the PUT when it already matches
// (idempotent — avoids churning page versions). Best-effort; swallows failures.
export async function mirrorNativeState(pageId, stateId) {
  const target = NATIVE_STATE_MAP[stateId];
  if (!pageId || !target) return;
  try {
    const current = await readNativeState(pageId);
    if (current && current.name === target.name) return; // already correct — no version bump
    await asApp().requestConfluence(
      route`/wiki/rest/api/content/${pageId}/state?status=current`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name: target.name, color: target.color }),
      },
    );
  } catch (e) {
    console.error("[WORKFLOW-NATIVE] mirror failed:", e);
  }
}

// Clear the native pill (when the workflow is removed from a page).
export async function clearNativeState(pageId) {
  if (!pageId) return;
  try {
    await asApp().requestConfluence(
      route`/wiki/rest/api/content/${pageId}/state`,
      { method: "DELETE" },
    );
  } catch (e) {
    console.error("[WORKFLOW-NATIVE] clear failed:", e);
  }
}
