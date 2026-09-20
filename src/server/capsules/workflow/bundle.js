/**
 * WF-11 (UX critique 2026-09-19, done 2026-09-20): ONE Save for the default workflow's states AND
 * the approval / protection settings that describe it. Two records live on the server
 * (workflow-def-space-{key}, workflow-settings-{key}) and a single Save must never leave one
 * written and the other refused. The sequence is: write the definition first (its validation is
 * the stricter one — a state with pages in it cannot be removed), then the settings; when the
 * settings are refused, put the definition back exactly as it was and say so. PURE over three
 * async steps, unit-tested with fakes in test/workflow-bundle.test.mjs.
 *
 * @param {{ storeDef: () => Promise<{success:boolean, reason?:string, def?:object, warning?:string|null}>,
 *           storeSettings: () => Promise<{success:boolean, reason?:string}>,
 *           restoreDef: () => Promise<{success:boolean}|void> }} steps
 * @returns {Promise<{ success: boolean, stage?: "definition"|"settings", reason?: string, restored?: boolean, def?: object, warning?: string|null }>}
 */
export async function runBundle({ storeDef, storeSettings, restoreDef }) {
  const d = await storeDef();
  if (!d || d.success !== true) return { success: false, stage: "definition", reason: (d && d.reason) || "Could not save the workflow states", restored: false };
  const s = await storeSettings();
  if (s && s.success === true) return { success: true, def: d.def || null, warning: d.warning || null };
  let restored = false;
  try { const r = await restoreDef(); restored = !r || r.success !== false; } catch (_) { restored = false; }
  return { success: false, stage: "settings", reason: (s && s.reason) || "Could not save the workflow settings", restored };
}

/** PURE. The sentence the editor shows for a failed bundle — nothing half-saved, or exactly what is. */
export function bundleFailureText(r) {
  if (!r || r.success) return null;
  const why = r.reason || "the save was refused";
  if (r.stage === "definition") return `Nothing was saved — ${why}`;
  return r.restored
    ? `Nothing was saved — the settings were refused (${why}); the states were put back as they were`
    : `The states were saved but the settings were refused (${why}) — and the states could not be put back. Check them, then save again`;
}
