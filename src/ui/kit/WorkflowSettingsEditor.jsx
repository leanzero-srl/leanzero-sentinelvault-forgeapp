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

// The Workflow tab groups its rows into titled sections so the page reads as four decisions,
// not one wall of toggles: the workflow itself, approval, protection of approved pages, readers.
const Section = ({ title, description, children, testId }) => (
  <section className="settings-section" data-testid={testId}>
    <div className="settings-section-head">
      <h4 className="settings-section-title">{title}</h4>
      {description && <p className="settings-section-desc">{description}</p>}
    </div>
    {children}
  </section>
);

const Toggle = ({ checked, onChange, label, disabled }) => (
  <label className={`form-checkbox${disabled ? " is-disabled" : ""}`}>
    <input type="checkbox" aria-label={label} checked={checked} onChange={onChange} disabled={disabled} />
  </label>
);

const ENFORCE_MODE_OPTS = [
  { value: "demote", label: "Move it back to an earlier state (keeps their edit)" },
  { value: "revert", label: "Revert to the approved version (discards their edit)" },
];

const MODE_OPTS = [
  { value: "any", label: "Any one approver can approve" },
  { value: "all", label: "All approvers must approve" },
  { value: "min", label: "At least a set number must approve" },
];

// Small custom select (no native <select>), mirroring ValidationsEditor's MiniSelect.
export const MiniSelect = ({ value, options, onChange, ariaLabel, testId }) => {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <div className="mini-select" tabIndex={0} onBlur={() => setTimeout(() => setOpen(false), 150)} data-testid={testId}>
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

// A5: { stateId: days } with only positive whole numbers kept — a blank row means "use the
// workflow's own value", and the server should never see a 0 or an empty string for that.
// When a definition is known, ids it does not have are dropped too: a clock saved for a state
// that was since removed from the workflow is otherwise invisible in the editor (no row renders
// it) and yet is refused by the server on the next save — a form the user cannot fix.
const cleanClocks = (byState, def = null) => {
  const known = Array.isArray(def?.states) ? new Set(def.states.map((s) => s.id)) : null;
  const out = {};
  for (const [id, v] of Object.entries(byState || {})) {
    if (known && !known.has(id)) continue;
    const n = typeof v === "number" ? v : parseInt(v, 10);
    if (Number.isFinite(n) && n > 0) out[id] = Math.round(n);
  }
  return out;
};
// Same for the demote target: a saved id the definition no longer has falls back to "initial"
// rather than being sent back and refused.
const cleanDemoteTo = (demoteTo, def = null) => {
  if (!demoteTo || demoteTo === "initial") return "initial";
  if (Array.isArray(def?.states) && !def.states.some((s) => s.id === demoteTo)) return "initial";
  return demoteTo;
};
// The enforce state is flagged in the definition; "approved" is the fallback for a def saved
// before the flag existed (the server treats it the same way).
const isEnforceState = (s) => !!s?.enforce || s?.id === "approved";

// `defRev` (B1): bumped by the definition editor after a save, so the state chips, the per-state
// review clocks and the demote-target options here follow the definition without a reload.
export default function WorkflowSettingsEditor({ spaceKey = null, defRev = 0 }) {
  const [settings, setSettings] = useState({ enabled: false, autoAssignNew: false, workflowId: "default", approval: null, enforceMode: "demote", demoteTo: "initial", reviewAfterDays: null, reviewAfterDaysByState: {}, entryConditions: {}, syncLabels: false, readConfirmation: null, requireSignature: false });
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
        if (r?.settings) setSettings({ enabled: !!r.settings.enabled, autoAssignNew: !!r.settings.autoAssignNew, workflowId: r.settings.workflowId || "default", approval: r.settings.approval || null, enforceMode: r.settings.enforceMode === "revert" ? "revert" : "demote", demoteTo: cleanDemoteTo(r.settings.demoteTo, r.def), reviewAfterDays: r.settings.reviewAfterDays ?? null, reviewAfterDaysByState: cleanClocks(r.settings.reviewAfterDaysByState, r.def), entryConditions: r.settings.entryConditions || {}, syncLabels: !!r.settings.syncLabels, readConfirmation: r.settings.readConfirmation || null, requireSignature: !!r.settings.requireSignature });
        if (r?.def) setDef(r.def);
      } catch (e) {
        console.error("Load workflow settings failed:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [spaceKey, defRev]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      // it16: check the resolver's success — set-space-workflow-settings returns
      // { success:false, reason } (e.g. a non-steward) rather than throwing, so a blind
      // "saved" would be a false success.
      const r = await invoke("set-space-workflow-settings", { spaceKey, settings: { ...settings, demoteTo: cleanDemoteTo(settings.demoteTo, def), reviewAfterDaysByState: cleanClocks(settings.reviewAfterDaysByState, def) } });
      if (r?.success) setMsg({ type: "success", text: "Workflow settings saved." });
      else setMsg({ type: "error", text: r?.reason || "Could not save workflow settings." });
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
  const initialState = states.find((s) => s.initial) || states[0] || null;
  const enforceState = states.find(isEnforceState) || null;
  // A2: where a tampered Approved page lands. "initial" = whatever the first state is (survives a
  // re-saved definition); a state id pins one. The first state is not repeated under its own name.
  const demoteOpts = [
    { value: "initial", label: `The first state (${initialState?.name || "Draft"})` },
    ...states.filter((s) => !isEnforceState(s) && s.id !== initialState?.id).map((s) => ({ value: s.id, label: s.name })),
  ];
  // A5: every state except the enforce one gets a clock row here; Approved keeps its own row.
  const clockStates = states.filter((s) => !isEnforceState(s));
  const enforceName = enforceState?.name || "Approved";

  return (
    <div className="settings-panel">
      <SettingsRow
        label="Enable document workflow"
        description="Track a review/approval state on pages in this space. When on, pages carry a workflow state shown on the Sentinel Vault ribbon, and rights-holders move it along the workflow."
      >
        <Toggle label="Enable document workflow" checked={settings.enabled} onChange={(e) => setSettings((p) => ({ ...p, enabled: e.target.checked }))} />
      </SettingsRow>

      {settings.enabled && (
        <div className="settings-sections">
        <Section title="Workflow" description="Which pages run it, and the states they move through. States and transitions are edited in Workflow definitions, further down." testId="wf-section-workflow">
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
            label="Auto-start workflow on new pages"
            description="Every new page created in this space starts the workflow automatically, at its first state (or the workflow its labels select)."
          >
            <Toggle label="Auto-start workflow on new pages" checked={settings.autoAssignNew} onChange={(e) => setSettings((p) => ({ ...p, autoAssignNew: e.target.checked }))} />
          </SettingsRow>
          <SettingsRow
            label="Apply to existing pages"
            description="Start the workflow on pages in this space that don't have one yet. Large spaces are processed in batches — run again to continue."
          >
            <button className="btn-secondary" onClick={applyToExisting} disabled={applying}>
              {applying ? "Applying…" : "Apply to existing pages"}
            </button>
          </SettingsRow>
          <SettingsRow
            label="Show the state as a page label"
            description="Adds a label like sv-state-approved to each page and keeps it in step with the workflow, so Content by Label, the Page Properties Report and CQL can filter on it. Turning it off removes the labels within the hour."
          >
            <Toggle label="Show the state as a page label" checked={!!settings.syncLabels} onChange={(e) => setSettings((p) => ({ ...p, syncLabels: e.target.checked }))} />
          </SettingsRow>
        </Section>

        <Section title="Readers" description="Ask an audience to confirm they have read each approved version." testId="wf-section-readers">
          <SettingsRow
            label="Ask readers to confirm they have read Approved pages"
            description="While a page is Approved, the people and groups below are asked to confirm they have read the approved version; the ribbon shows who has. A new approved version asks again."
          >
            <Toggle label="Ask readers to confirm they have read Approved pages" checked={!!settings.readConfirmation?.enabled} onChange={(e) => setSettings((p) => ({ ...p, readConfirmation: { enabled: e.target.checked, audience: p.readConfirmation?.audience || [] } }))} />
          </SettingsRow>
          {settings.readConfirmation?.enabled && (
            <div className="nested-control" data-testid="wf-read-audience">
              <SettingsRow label="Readers" description="People who must confirm.">
                <UserPicker
                  selected={(settings.readConfirmation.audience || []).filter((a) => (a.type || "user") === "user")}
                  onChange={(users) => setSettings((p) => ({ ...p, readConfirmation: { ...p.readConfirmation, audience: [...users, ...(p.readConfirmation.audience || []).filter((a) => a.type === "group")] } }))}
                />
              </SettingsRow>
              <SettingsRow label="Reader groups" description="Everyone in these groups must confirm.">
                <GroupPicker
                  selected={(settings.readConfirmation.audience || []).filter((a) => a.type === "group")}
                  onChange={(groups) => setSettings((p) => ({ ...p, readConfirmation: { ...p.readConfirmation, audience: [...(p.readConfirmation.audience || []).filter((a) => (a.type || "user") === "user"), ...groups] } }))}
                />
              </SettingsRow>
            </div>
          )}

        </Section>

        <Section title="Approval" description={`Who signs off before a page becomes ${enforceName}, and what must be true first.`} testId="wf-section-approval">
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
                <p className="alert-error" role="alert">No approvers are set, so every edit by someone who is not an approver or space admin to an Approved page would be reverted. Add an approver, or use “Move it back to an earlier state” below.</p>
              )}
            </div>
          )}

          {/* P2 (UX review §3): a signed decision only exists where there is a decision — this row
              depends on "Require approval" and says so instead of sitting flat beside it. */}
          <div className={`settings-row is-dependent depth-1${settings.approval ? "" : " is-locked"}`} data-testid="wf-row-requireSignature" data-locked={settings.approval ? "false" : "true"}>
            <div className="settings-row-info">
              <p className="settings-row-label">Require a signed decision</p>
              <p className="settings-row-description">Every Approve or Deny must carry the current code from the approver's authenticator app (set up once on their My work page). The approval record marks each decision as signed.</p>
              <p className="settings-row-default"><span>Effective default:</span> Off</p>
              {!settings.approval && <p className="settings-row-reason" data-testid="wf-reason-requireSignature">Turn on Require approval to reach Approved first</p>}
            </div>
            <div className="settings-row-control">
              <Toggle label="Require a signed decision" checked={!!settings.requireSignature} disabled={!settings.approval} onChange={(e) => setSettings((p) => ({ ...p, requireSignature: e.target.checked }))} />
            </div>
          </div>
          <SettingsRow
            label="Require content rules before Approved"
            description="Before a page can reach Approved, the required headings, tables, labels and length limits set in Validations must all pass. The person moving it sees exactly what's missing and can't proceed until it's fixed."
          >
            <Toggle
              label="Require content rules before Approved"
              checked={!!settings.entryConditions?.approved?.requireRules}
              onChange={(e) => setSettings((p) => ({ ...p, entryConditions: { ...p.entryConditions, approved: { requireAi: false, aiThreshold: "medium", onBudgetExhausted: "block", ...(p.entryConditions?.approved || {}), requireRules: e.target.checked } } }))}
            />
          </SettingsRow>
          <SettingsRow
            label="Require an AI content review before Approved"
            description="An automated review of the page runs before it can be Approved and becomes one more sign-off alongside your reviewers. Uses the AI set up in Validations."
          >
            <Toggle
              label="Require an AI content review before Approved"
              checked={!!settings.entryConditions?.approved?.requireAi}
              onChange={(e) => setSettings((p) => ({ ...p, entryConditions: { ...p.entryConditions, approved: { requireRules: false, aiThreshold: "medium", onBudgetExhausted: "block", ...(p.entryConditions?.approved || {}), requireAi: e.target.checked } } }))}
            />
          </SettingsRow>
          {settings.entryConditions?.approved?.requireAi && (
            <div className="nested-control">
              <SettingsRow label="AI review strictness" description="How strong an issue has to be to block approval.">
                <MiniSelect
                  ariaLabel="AI review strictness"
                  value={settings.entryConditions?.approved?.aiThreshold || "medium"}
                  options={[{ value: "low", label: "Strict (flag any issue)" }, { value: "medium", label: "Balanced" }, { value: "high", label: "Lenient (serious issues only)" }]}
                  onChange={(v) => setSettings((p) => ({ ...p, entryConditions: { ...p.entryConditions, approved: { ...(p.entryConditions?.approved || {}), aiThreshold: v } } }))}
                />
              </SettingsRow>
            </div>
          )}
        </Section>

        <Section title={`Protecting ${enforceName} pages`} description={`${enforceName} pages are protected: an edit by someone who is not an approver or a space admin is undone or sends the page back, and every ${enforceName} page carries a review date.`} testId="wf-section-protection">
          <SettingsRow
            label={`If an ${enforceName} page is edited by a non-approver`}
            description="Choose what happens when someone who isn’t an approver (and isn’t a space admin) edits the page. “Move it back” keeps their edit — you choose where it lands below; “Revert” restores the approved version and is stricter."
          >
            <MiniSelect
              ariaLabel="Enforcement when an approved page is edited"
              value={settings.enforceMode || "demote"}
              options={ENFORCE_MODE_OPTS}
              onChange={(mode) => setSettings((p) => ({ ...p, enforceMode: mode }))}
            />
          </SettingsRow>

          {(settings.enforceMode || "demote") === "demote" && (
            <div className="nested-control">
              <SettingsRow
                label={`When an ${enforceName} page is edited without approval, move it to`}
                description="Send it back for review rather than to the start."
              >
                <MiniSelect
                  ariaLabel={`Where an ${enforceName} page goes when edited without approval`}
                  testId="wf-demote-to"
                  value={demoteOpts.some((o) => o.value === settings.demoteTo) ? settings.demoteTo : "initial"}
                  options={demoteOpts}
                  onChange={(demoteTo) => setSettings((p) => ({ ...p, demoteTo }))}
                />
              </SettingsRow>
            </div>
          )}

          <SettingsRow
            label={`${enforceName} pages: re-review after (days)`}
            description={`${enforceName} pages show a review-due date on their ribbon and are moved to Expired once it passes, so approvals don’t silently go stale. Leave blank to use the workflow default (${enforceState?.reviewAfterDays || 150} days).`}
          >
            <div className="days-input">
              <input
                className="form-input"
                type="number"
                min="1"
                placeholder={String(enforceState?.reviewAfterDays || 150)}
                aria-label={`Re-review ${enforceName} pages after this many days`}
                data-testid={`wf-review-clock-${enforceState?.id || "approved"}`}
                value={settings.reviewAfterDays ?? ""}
                onChange={(e) => setSettings((p) => ({ ...p, reviewAfterDays: e.target.value === "" ? null : (parseInt(e.target.value, 10) || null) }))}
              />
              <span className="days-suffix">days</span>
            </div>
          </SettingsRow>

          {clockStates.length > 0 && (
            <SettingsRow
              label="Review clocks"
              description={`How long a page may sit in each state before it is due for review. Its ribbon shows the date, and a space admin can move it from there. Leave a state blank to use the workflow's own value, or none. ${enforceName} pages use the setting above.`}
            >
              <div className="wf-clock-list">
                {clockStates.map((s) => (
                  <div key={s.id} className="wf-clock-row">
                    <span className={`wf-state-chip wf-state-${s.color || "neutral"}`}>{s.name}</span>
                    <div className="days-input">
                      <input
                        className="form-input wf-clock-input"
                        type="number"
                        min="1"
                        placeholder={s.reviewAfterDays ? String(s.reviewAfterDays) : "none"}
                        aria-label={`Review ${s.name} pages after this many days`}
                        data-testid={`wf-review-clock-${s.id}`}
                        value={settings.reviewAfterDaysByState?.[s.id] ?? ""}
                        onChange={(e) => setSettings((p) => {
                          const next = { ...(p.reviewAfterDaysByState || {}) };
                          const v = e.target.value === "" ? null : (parseInt(e.target.value, 10) || null);
                          if (v === null) delete next[s.id]; else next[s.id] = v;
                          return { ...p, reviewAfterDaysByState: next };
                        })}
                      />
                      <span className="days-suffix">days</span>
                    </div>
                  </div>
                ))}
              </div>
            </SettingsRow>
          )}

        </Section>
        </div>
      )}

      {msg && <div role="status" aria-live="polite" className={msg.type === "success" ? "alert-success" : "alert-error"}>{msg.text}</div>}
      <div className="action-bar">
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save workflow settings"}</button>
      </div>
    </div>
  );
}
