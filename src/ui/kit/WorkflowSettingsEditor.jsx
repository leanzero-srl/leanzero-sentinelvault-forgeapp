import React, { useState, useEffect } from "react";
import { invoke } from "@forge/bridge";

// Per-space document-workflow settings (#42). Mirrors ValidationsEditor's shape and
// reuses the same host classes (settings-panel / settings-row / form-checkbox /
// btn-primary / action-bar / alert-*) so it matches the rest of the console. Lets a
// steward enable workflow for the space, auto-assign new pages, preview the workflow
// states, and apply the workflow to existing pages.

const SettingsRow = ({ label, description, children }) => (
  <div className="settings-row">
    <div className="settings-row-info">
      <p className="settings-row-label">{label}</p>
      <p className="settings-row-description">{description}</p>
    </div>
    <div className="settings-row-control">{children}</div>
  </div>
);

const Toggle = ({ checked, onChange, label }) => (
  <label className="form-checkbox">
    <input type="checkbox" aria-label={label} checked={checked} onChange={onChange} />
  </label>
);

export default function WorkflowSettingsEditor({ spaceKey = null }) {
  const [settings, setSettings] = useState({ enabled: false, autoAssignNew: false, workflowId: "default" });
  const [def, setDef] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [cursor, setCursor] = useState(null); // resume point for bulk apply across batches
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await invoke("get-space-workflow-settings", { spaceKey });
        if (r?.settings) setSettings({ enabled: !!r.settings.enabled, autoAssignNew: !!r.settings.autoAssignNew, workflowId: r.settings.workflowId || "default" });
        if (r?.def) setDef(r.def);
      } catch (e) {
        console.error("Load workflow settings failed:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [spaceKey]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await invoke("set-space-workflow-settings", { spaceKey, settings });
      setMsg({ type: "success", text: "Workflow settings saved." });
    } catch (e) {
      setMsg({ type: "error", text: "Could not save workflow settings." });
    } finally {
      setSaving(false);
    }
  };

  const applyToExisting = async () => {
    setApplying(true);
    setMsg(null);
    try {
      const r = await invoke("bulk-assign-workflow", { spaceKey, cursor });
      if (r?.success) {
        // Advance the cursor so a subsequent click continues past this batch (null once done).
        setCursor(r.capped ? (r.nextCursor || null) : null);
        const more = r.capped ? ` (${r.scanned} scanned — run again to continue)` : "";
        setMsg({ type: "success", text: `Applied the workflow to ${r.assigned} page${r.assigned !== 1 ? "s" : ""}${more}.` });
      } else {
        setMsg({ type: "error", text: r?.reason || "Could not apply the workflow." });
      }
    } catch (e) {
      setMsg({ type: "error", text: "Could not apply the workflow to existing pages." });
    } finally {
      setApplying(false);
    }
  };

  if (loading) return <div className="settings-panel">Loading…</div>;

  const states = def?.states || [];

  return (
    <div className="settings-panel">
      <SettingsRow
        label="Enable document workflow"
        description="Track a review/approval state on pages in this space. When on, pages carry a workflow state shown on the Sentinel Vault ribbon, and rights-holders move it along the workflow."
      >
        <Toggle label="Enable document workflow" checked={settings.enabled} onChange={(e) => setSettings((p) => ({ ...p, enabled: e.target.checked }))} />
      </SettingsRow>

      {settings.enabled && (
        <div className="nested-control">
          <SettingsRow
            label="Auto-start workflow on new pages"
            description="Every new page created in this space starts the workflow automatically, at its first state."
          >
            <Toggle label="Auto-start workflow on new pages" checked={settings.autoAssignNew} onChange={(e) => setSettings((p) => ({ ...p, autoAssignNew: e.target.checked }))} />
          </SettingsRow>

          <SettingsRow label="Workflow states" description="The states every page moves through.">
            <div className="wf-state-preview">
              {states.map((s, i) => (
                <React.Fragment key={s.id}>
                  <span className={`wf-state-chip wf-state-${s.color || "neutral"}`}>{s.name}</span>
                  {i < states.length - 1 && <span className="wf-state-arrow" aria-hidden="true">→</span>}
                </React.Fragment>
              ))}
            </div>
          </SettingsRow>

          <SettingsRow
            label="Apply to existing pages"
            description="Start the workflow on pages in this space that don't have one yet. Large spaces are processed in batches — run again to continue."
          >
            <button className="btn-secondary" onClick={applyToExisting} disabled={applying}>
              {applying ? "Applying…" : "Apply to existing pages"}
            </button>
          </SettingsRow>
        </div>
      )}

      {msg && <div role="status" aria-live="polite" className={msg.type === "success" ? "alert-success" : "alert-error"}>{msg.text}</div>}
      <div className="action-bar">
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save workflow settings"}</button>
      </div>
    </div>
  );
}
