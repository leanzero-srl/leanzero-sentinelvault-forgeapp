// B4: the workflow state mirrored as a page label, so Confluence's own tools can filter on it.
// Content-property CQL does not parse on Forge (probed 2026-09-05 — it needs a Connect index
// schema), so `label = "sv-state-approved"` is the honest substitute; Comala does the same.
// Writes go through v1 `/content/{id}/label` as the app — the same scope `label-artifact`
// already uses — and are best-effort: a label failure must never fail a transition.
// Loop safety: the app's own account writes the label, and the page trigger ignores its own
// account, so a label write never re-enters enforcement.
import { asApp, route } from "@forge/api";
import { fetchPageLabels } from "../../infra/labels.js";

export const STATE_LABEL_PREFIX = "sv-state-";

// PURE. A state id becomes a label Confluence accepts (lowercase, dash-separated).
export function stateLabel(stateId) {
  const clean = String(stateId || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return clean ? `${STATE_LABEL_PREFIX}${clean}` : null;
}

// PURE. Given the labels on the page and the wanted one, what to add and what to remove.
export function planLabelSync(currentLabels, wanted) {
  const have = new Set((currentLabels || []).map((l) => String(l)));
  const stale = [...have].filter((l) => l.startsWith(STATE_LABEL_PREFIX) && l !== wanted);
  return { add: wanted && !have.has(wanted) ? wanted : null, remove: stale };
}

async function addLabel(pageId, name) {
  const res = await asApp().requestConfluence(route`/wiki/rest/api/content/${pageId}/label`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify([{ prefix: "global", name }]),
  });
  return res.ok;
}

async function removeLabel(pageId, name) {
  const res = await asApp().requestConfluence(route`/wiki/rest/api/content/${pageId}/label?name=${name}`, { method: "DELETE" });
  return res.ok || res.status === 404;
}

// Mirror `stateId` (or, with null, remove every state label). Returns { ok, label, added, removed }.
export async function syncStateLabel(pageId, stateId) {
  const wanted = stateId ? stateLabel(stateId) : null;
  try {
    const current = await fetchPageLabels(pageId);
    const plan = planLabelSync(current, wanted);
    let ok = true;
    if (plan.add) ok = (await addLabel(pageId, plan.add)) && ok;
    for (const l of plan.remove) ok = (await removeLabel(pageId, l)) && ok;
    return { ok, label: wanted, added: plan.add, removed: plan.remove };
  } catch (e) {
    console.warn(`[LABEL-SYNC] page ${pageId}:`, e?.message || e);
    return { ok: false, label: wanted, added: null, removed: [] };
  }
}
