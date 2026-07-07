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

const ENFORCE_MODE_OPTS = [
  { value: "demote", label: "Move it back to Draft (keeps their edit)" },
  { value: "revert", label: "Revert to the approved version (discards their edit)" },
];

const MODE_OPTS = [
  { value: "any", label: "Any one approver can approve" },
  { value: "all", label: "All approvers must approve" },
  { value: "min", label: "At least a set number must approve" },
];

// Small custom select (no native <select>), mirroring ValidationsEditor's MiniSelect.
const MiniSelect = ({ value, options, onChange, ariaLabel }) => {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <div className="mini-select" tabIndex={0} onBlur={() => setTimeout(() => setOpen(false), 150)}>
      <div className="mini-select-value" onClick={() => setOpen(!open)} role="button" aria-haspopup="listbox" aria-label={ariaLabel}>
        <span>{current ? current.label : "Select…"}</span>
        <span className={`mini-select-arrow ${open ? "open" : ""}`}>▼</span>
      </div>
      {open && (
        <div className="mini-select-menu" role="listbox">
          {options.map((o) => (
            <div key={o.value} role="option" aria-selected={o.value === value} className={`mini-select-opt ${o.value === value ? "sel" : ""}`} onClick={() => { onChange(o.value); setOpen(false); }}>
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Search-and-add people picker (no native control). Selected = [{ type, id, name }].
const UserPicker = ({ selected, onChange }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); setOpen(false); return undefined; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await invoke("search-workflow-users", { query });
        if (!cancelled) { setResults(r?.users || []); setOpen(true); }
      } catch (_) { /* ignore */ }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);
  const add = (u) => {
    if (!selected.find((s) => s.id === u.accountId)) onChange([...selected, { type: "user", id: u.accountId, name: u.name }]);
    setQuery(""); setResults([]); setOpen(false);
  };
  const remove = (id) => onChange(selected.filter((s) => s.id !== id));
  return (
    <div className="wf-userpicker">
      {selected.length > 0 && (
        <div className="wf-userpicker-chips">
          {selected.map((s) => (
            <span key={s.id} className="wf-userchip">
              {s.name || s.id}
              <button type="button" className="wf-userchip-x" onClick={() => remove(s.id)} aria-label={`Remove ${s.name || s.id}`}>×</button>
            </span>
          ))}
        </div>
      )}
      <input className="form-input" placeholder="Search people to add…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search people to add as approvers" />
      {open && results.length > 0 && (
        <div className="wf-userpicker-menu" role="listbox">
          {results.map((u) => (
            <button type="button" key={u.accountId} role="option" className="wf-userpicker-opt" onClick={() => add(u)}>{u.name}</button>
          ))}
        </div>
      )}
      {selected.length === 0 && <p className="settings-row-description" style={{ marginTop: "6px" }}>No people added.</p>}
    </div>
  );
};

// Search-and-add group picker. Selected = [{ type: "group", id, name }].
const GroupPicker = ({ selected, onChange }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (query.trim().length < 1) { setResults([]); setOpen(false); return undefined; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await invoke("search-workflow-groups", { query });
        if (!cancelled) { setResults(r?.groups || []); setOpen(true); }
      } catch (_) { /* ignore */ }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);
  const add = (g) => {
    if (!selected.find((s) => s.id === g.id)) onChange([...selected, { type: "group", id: g.id, name: g.name }]);
    setQuery(""); setResults([]); setOpen(false);
  };
  const remove = (id) => onChange(selected.filter((s) => s.id !== id));
  return (
    <div className="wf-userpicker">
      {selected.length > 0 && (
        <div className="wf-userpicker-chips">
          {selected.map((s) => (
            <span key={s.id} className="wf-userchip wf-groupchip">
              {s.name || s.id}
              <button type="button" className="wf-userchip-x" onClick={() => remove(s.id)} aria-label={`Remove ${s.name || s.id}`}>×</button>
            </span>
          ))}
        </div>
      )}
      <input className="form-input" placeholder="Search groups to add…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search groups to add as approvers" />
      {open && results.length > 0 && (
        <div className="wf-userpicker-menu" role="listbox">
          {results.map((g) => (
            <button type="button" key={g.id} role="option" className="wf-userpicker-opt" onClick={() => add(g)}>{g.name}</button>
          ))}
        </div>
      )}
    </div>
  );
};

export default function WorkflowSettingsEditor({ spaceKey = null }) {
  const [settings, setSettings] = useState({ enabled: false, autoAssignNew: false, workflowId: "default", approval: null, enforceMode: "demote", reviewAfterDays: null });
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
        if (r?.settings) setSettings({ enabled: !!r.settings.enabled, autoAssignNew: !!r.settings.autoAssignNew, workflowId: r.settings.workflowId || "default", approval: r.settings.approval || null, enforceMode: r.settings.enforceMode === "revert" ? "revert" : "demote", reviewAfterDays: r.settings.reviewAfterDays ?? null });
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
            label="Require approval to reach Approved"
            description="Instead of moving straight to Approved, require the people below to sign off first. Until they do, the page stays In Review and shows “Awaiting approval” on its ribbon."
          >
            <Toggle
              label="Require approval to reach Approved"
              checked={!!settings.approval}
              onChange={(e) => setSettings((p) => ({ ...p, approval: e.target.checked ? (p.approval || { approvers: [], mode: "any", min: 1 }) : null }))}
            />
          </SettingsRow>

          {settings.approval && (
            <div className="nested-control">
              <SettingsRow label="Approvers" description="People who can approve moving a page to Approved.">
                <UserPicker
                  selected={(settings.approval.approvers || []).filter((a) => (a.type || "user") === "user")}
                  onChange={(users) => setSettings((p) => ({ ...p, approval: { ...p.approval, approvers: [...users, ...(p.approval.approvers || []).filter((a) => a.type === "group")] } }))}
                />
              </SettingsRow>
              <SettingsRow label="Approver groups" description="Everyone in these groups is added as an approver (the decision rule then applies to all of them).">
                <GroupPicker
                  selected={(settings.approval.approvers || []).filter((a) => a.type === "group")}
                  onChange={(groups) => setSettings((p) => ({ ...p, approval: { ...p.approval, approvers: [...(p.approval.approvers || []).filter((a) => (a.type || "user") === "user"), ...groups] } }))}
                />
              </SettingsRow>
              <SettingsRow label="Decision rule" description="How many of the approvers must approve before the page moves.">
                <MiniSelect
                  ariaLabel="Approval decision rule"
                  value={settings.approval.mode || "any"}
                  options={MODE_OPTS}
                  onChange={(mode) => setSettings((p) => ({ ...p, approval: { ...p.approval, mode } }))}
                />
              </SettingsRow>
              {settings.approval.mode === "min" && (
                <SettingsRow label="Minimum approvals" description="At least this many of the approvers must approve.">
                  <input
                    className="form-input"
                    type="number"
                    min="1"
                    value={settings.approval.min || 1}
                    onChange={(e) => setSettings((p) => ({ ...p, approval: { ...p.approval, min: parseInt(e.target.value, 10) || 1 } }))}
                  />
                </SettingsRow>
              )}
              {(settings.approval.approvers || []).length === 0 && settings.enforceMode === "revert" && (
                <p className="alert-error" role="alert">No approvers are set, so every non-steward edit to an Approved page would be reverted. Add an approver, or use “Move it back to Draft” below.</p>
              )}
            </div>
          )}

          <SettingsRow
            label="If an Approved page is edited by a non-approver"
            description="Approved is an enforced state. Choose what happens when someone who isn’t an approver (and isn’t a steward) edits an Approved page. “Move to Draft” keeps their edit; “Revert” restores the approved version and is stricter."
          >
            <MiniSelect
              ariaLabel="Enforcement when an approved page is edited"
              value={settings.enforceMode || "demote"}
              options={ENFORCE_MODE_OPTS}
              onChange={(mode) => setSettings((p) => ({ ...p, enforceMode: mode }))}
            />
          </SettingsRow>

          <SettingsRow
            label="Re-review Approved pages after"
            description="Approved pages show a review-due date on their ribbon and are moved to Expired once it passes, so approvals don’t silently go stale. Leave blank to use the workflow default (150 days)."
          >
            <div className="days-input">
              <input
                className="form-input"
                type="number"
                min="1"
                placeholder="150"
                aria-label="Re-review Approved pages after this many days"
                value={settings.reviewAfterDays ?? ""}
                onChange={(e) => setSettings((p) => ({ ...p, reviewAfterDays: e.target.value === "" ? null : (parseInt(e.target.value, 10) || null) }))}
              />
              <span className="days-suffix">days</span>
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
