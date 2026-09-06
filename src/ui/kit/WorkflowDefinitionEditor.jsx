import React, { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@forge/bridge";
import { MiniSelect } from "./WorkflowSettingsEditor";

// B1: the definition editor — states, transitions and colours for the space's default workflow
// and for any label-scoped workflows (Comala's model: a page labelled "contract" runs "Legal
// review" instead of the default; the highest priority wins when several labels match).
// Not a visual builder: a table of states and, per state, which states it can move to. Ids are
// derived from the name once and never change; a state that still holds pages cannot be removed
// (the server refuses), and the server warns about states with no way out.

const COLOR_OPTS = [
  { value: "neutral", label: "Grey" },
  { value: "info", label: "Blue" },
  { value: "success", label: "Green" },
  { value: "caution", label: "Amber" },
  { value: "critical", label: "Red" },
];

const slug = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || `state_${Date.now().toString(36)}`;
const uniqueId = (base, taken) => { let id = base, n = 2; while (taken.has(id)) id = `${base}_${n++}`.slice(0, 30); return id; };

const emptyDef = (id, name) => ({ id, name, states: [{ id: "draft", name: "Draft", color: "neutral", initial: true }], transitions: [] });

// One workflow's editor: states table + transition checkboxes + (for extras) labels + priority.
const DefinitionForm = ({ initial, isExtra, onSave, onDelete, saving, message }) => {
  const [def, setDef] = useState(initial.def);
  const [labels, setLabels] = useState((initial.labels || []).join(", "));
  const [priority, setPriority] = useState(initial.priority ?? 0);
  // Ids of states added in THIS editing session: their id follows the name until saved.
  const [fresh, setFresh] = useState(() => new Set());
  // Reset only when the server copy actually changes (the parent memoises `initial` per
  // workflow — review finding 7: a new object per render snapped the form back on Save).
  useEffect(() => { setDef(initial.def); setLabels((initial.labels || []).join(", ")); setPriority(initial.priority ?? 0); setFresh(new Set()); }, [initial]);

  const states = def.states || [];
  const transitions = def.transitions || [];
  const can = (from, to) => transitions.some((t) => t.from === from && t.to === to);
  const toggle = (from, to) => setDef((d) => ({ ...d, transitions: can(from, to) ? d.transitions.filter((t) => !(t.from === from && t.to === to)) : [...(d.transitions || []), { from, to }] }));
  const patchState = (id, patch) => setDef((d) => ({ ...d, states: d.states.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const setInitial = (id) => setDef((d) => ({ ...d, states: d.states.map((s) => ({ ...s, initial: s.id === id })) }));
  const addState = () => {
    const taken = new Set(states.map((s) => s.id));
    const id = uniqueId("new_state", taken);
    setFresh((f) => new Set([...f, id]));
    setDef((d) => ({ ...d, states: [...d.states, { id, name: "New state", color: "neutral" }] }));
  };
  const removeState = (id) => setDef((d) => ({ ...d, states: d.states.filter((s) => s.id !== id), transitions: (d.transitions || []).filter((t) => t.from !== id && t.to !== id) }));
  const move = (id, dir) => setDef((d) => {
    const i = d.states.findIndex((s) => s.id === id); const j = i + dir;
    if (i < 0 || j < 0 || j >= d.states.length) return d;
    const next = d.states.slice(); [next[i], next[j]] = [next[j], next[i]];
    return { ...d, states: next };
  });
  // A brand-new state's id follows its name (every keystroke) until the definition is saved —
  // tracked in `fresh`, not inferred from the id text (review finding 8: "Legal review" became "l").
  const renameState = (s, name) => {
    if (!fresh.has(s.id)) return patchState(s.id, { name });
    const taken = new Set(states.filter((x) => x.id !== s.id).map((x) => x.id));
    const id = uniqueId(slug(name), taken);
    if (id !== s.id) setFresh((f) => { const n = new Set(f); n.delete(s.id); n.add(id); return n; });
    setDef((d) => ({ ...d, states: d.states.map((x) => (x.id === s.id ? { ...x, id, name } : x)), transitions: (d.transitions || []).map((t) => ({ from: t.from === s.id ? id : t.from, to: t.to === s.id ? id : t.to })) }));
  };

  return (
    <div className="wf-def" data-testid={`wf-def-${isExtra ? def.id : "default"}`}>
      <div className="wf-def-head">
        <label className="wf-def-name">
          <span>Workflow name</span>
          <input className="form-input" value={def.name || ""} onChange={(e) => setDef((d) => ({ ...d, name: e.target.value }))} aria-label="Workflow name" data-testid="wf-def-name" />
        </label>
        {isExtra && (
          <>
            <label className="wf-def-labels">
              <span>Applies to pages labelled</span>
              <input className="form-input" value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="contract, legal" aria-label="Labels this workflow applies to" data-testid="wf-def-labels" />
            </label>
            <label className="wf-def-priority">
              <span>Priority</span>
              <input className="form-input" type="number" min="0" max="1000" value={priority} onChange={(e) => setPriority(parseInt(e.target.value, 10) || 0)} aria-label="Priority when several label workflows match" data-testid="wf-def-priority" />
            </label>
          </>
        )}
      </div>

      <div className="wf-def-table" role="table" aria-label="States">
        <div className="wf-def-row wf-def-row-head" role="row">
          <span>State</span><span>Colour</span><span title="The state every new page starts in">First</span><span title="Pages in this state are protected: an edit by someone who is not an approver or a steward is undone or sends the page back">Protected</span><span>Re-review after (days)</span><span>Can move to</span><span></span>
        </div>
        {states.map((s) => (
          <div key={s.id} className="wf-def-row" role="row" data-testid="wf-def-state" data-state-id={s.id}>
            <span className="wf-def-cell-name">
              <input className="form-input" value={s.name} onChange={(e) => renameState(s, e.target.value)} aria-label={`Name of state ${s.name}`} data-testid="wf-def-state-name" />
              <code className="wf-def-id">{s.id}</code>
            </span>
            <span><MiniSelect ariaLabel={`Colour of ${s.name}`} value={s.color || "neutral"} options={COLOR_OPTS} onChange={(color) => patchState(s.id, { color })} testId={`wf-def-color-${s.id}`} /></span>
            <span><input type="radio" name={`initial-${def.id}`} checked={!!s.initial} onChange={() => setInitial(s.id)} aria-label={`${s.name} is the first state`} data-testid="wf-def-initial" /></span>
            <span><input type="checkbox" checked={!!s.enforce} onChange={(e) => patchState(s.id, { enforce: e.target.checked })} aria-label={`${s.name} is a protected (approved) state`} data-testid="wf-def-enforce" /></span>
            <span><input className="form-input wf-def-days" type="number" min="1" max="3650" value={s.reviewAfterDays ?? ""} onChange={(e) => patchState(s.id, { reviewAfterDays: e.target.value === "" ? null : parseInt(e.target.value, 10) })} aria-label={`Re-review ${s.name} after days`} /></span>
            <span className="wf-def-targets">
              {states.filter((t) => t.id !== s.id).map((t) => (
                <label key={t.id} className={`wf-def-target${can(s.id, t.id) ? " on" : ""}`}>
                  <input type="checkbox" checked={can(s.id, t.id)} onChange={() => toggle(s.id, t.id)} aria-label={`${s.name} can move to ${t.name}`} data-testid={`wf-def-edge-${s.id}-${t.id}`} />
                  <span>{t.name}</span>
                </label>
              ))}
            </span>
            <span className="wf-def-tools">
              <button type="button" className="wf-def-tool" onClick={() => move(s.id, -1)} aria-label={`Move ${s.name} up`} title="Move up">↑</button>
              <button type="button" className="wf-def-tool" onClick={() => move(s.id, 1)} aria-label={`Move ${s.name} down`} title="Move down">↓</button>
              <button type="button" className="wf-def-tool wf-def-tool-x" onClick={() => removeState(s.id)} disabled={states.length <= 1} aria-label={`Remove state ${s.name}`} title="Remove state" data-testid="wf-def-remove">×</button>
            </span>
          </div>
        ))}
      </div>
      <div className="wf-def-actions">
        <button type="button" className="btn-secondary" onClick={addState} data-testid="wf-def-add-state">Add a state</button>
        <span className="wf-def-spacer" />
        {isExtra && <button type="button" className="wf-def-delete" onClick={() => onDelete(def.id)} disabled={saving} data-testid="wf-def-delete">Remove this workflow</button>}
        <button type="button" className="btn-primary" onClick={() => onSave({ workflowId: isExtra ? def.id : "default", def, labels: labels.split(",").map((l) => l.trim()).filter(Boolean), priority })} disabled={saving} data-testid="wf-def-save">{saving ? "Saving…" : "Save workflow"}</button>
      </div>
      {message && <div role="status" aria-live="polite" className={message.type === "error" ? "alert-error" : "alert-success"} data-testid="wf-def-message">{message.text}</div>}
    </div>
  );
};

export default function WorkflowDefinitionEditor({ spaceKey, onSaved = null }) {
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [messages, setMessages] = useState({});
  const [draftExtra, setDraftExtra] = useState(null); // a new label workflow being created
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try { setData(await invoke("list-space-workflows", { spaceKey })); } catch (_) { setData({ error: true }); }
  }, [spaceKey]);
  useEffect(() => { load(); }, [load]);

  const save = async (payload, key) => {
    setSaving(true); setMessages((m) => ({ ...m, [key]: null }));
    try {
      const r = await invoke("store-space-workflow", { spaceKey, ...payload });
      if (r?.success) {
        setMessages((m) => ({ ...m, [key]: { type: r.warning ? "error" : "success", text: r.warning ? `Saved, but: ${r.warning}` : "Workflow saved." } }));
        setDraftExtra(null);
        await load();
        onSaved?.();
      } else setMessages((m) => ({ ...m, [key]: { type: "error", text: r?.reason || "Could not save the workflow." } }));
    } catch (_) { setMessages((m) => ({ ...m, [key]: { type: "error", text: "Could not save the workflow." } })); }
    finally { setSaving(false); }
  };
  const remove = async (workflowId) => {
    setSaving(true);
    try {
      const r = await invoke("delete-space-workflow", { spaceKey, workflowId });
      if (!r?.success) setMessages((m) => ({ ...m, [workflowId]: { type: "error", text: r?.reason || "Could not remove the workflow." } }));
      else { await load(); onSaved?.(); }
    } finally { setSaving(false); }
  };

  // Memoised per load so a form only resets when the SERVER copy changes, never on a re-render.
  const initialDefault = useMemo(() => (data?.default ? { def: data.default, labels: [], priority: 0 } : null), [data]);
  const initialExtras = useMemo(() => (data?.extras || []).filter((x) => x.def).map((x) => ({ workflowId: x.workflowId, def: x.def, labels: x.labels, priority: x.priority })), [data]);

  if (!data) return null;
  if (data.error) return <div className="wf-dash-error" role="status">Couldn’t load the workflow definitions. Reload the page to try again.</div>;

  return (
    <div className="wf-defs" data-testid="wf-defs">
      <div className="wf-defs-head">
        <div>
          <h3 className="wf-dash-title">Workflow definitions</h3>
          <p className="wf-dash-sub">
            The states pages move through and the moves allowed between them. {data.source === "builtin" ? "This space uses the built-in workflow; saving makes a copy for this space." : data.source === "global" ? "This space uses the site-wide workflow; saving makes a copy for this space." : "This space has its own workflow."}{open ? " Each workflow saves with its own button; the bar at the bottom saves the settings above, not the workflows." : ""}
          </p>
        </div>
        <button type="button" className="wf-dash-export" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="wf-defs-toggle">{open ? "Hide editor" : "Edit workflows"}</button>
      </div>
      {open && (
        <>
          <DefinitionForm initial={initialDefault} isExtra={false} onSave={(p) => save(p, "default")} saving={saving} message={messages.default} />
          <h4 className="wf-defs-sub">Workflows for labelled pages</h4>
          <p className="wf-dash-sub">A page created with one of these labels starts this workflow instead of the default (the highest priority wins when several match). Pages already assigned keep the workflow they have.</p>
          {initialExtras.map((x) => (
            <DefinitionForm key={x.workflowId} initial={x} isExtra onSave={(p) => save(p, x.workflowId)} onDelete={remove} saving={saving} message={messages[x.workflowId]} />
          ))}
          {draftExtra ? (
            <DefinitionForm initial={draftExtra} isExtra onSave={(p) => save(p, draftExtra.def.id)} onDelete={() => setDraftExtra(null)} saving={saving} message={messages[draftExtra.def.id]} />
          ) : (
            <div className="wf-def-actions"><button type="button" className="btn-secondary" onClick={() => { const id = `wf_${Date.now().toString(36)}`; setDraftExtra({ def: emptyDef(id, "New workflow"), labels: [], priority: 10 }); }} data-testid="wf-defs-add">Add a workflow for labelled pages</button></div>
          )}
        </>
      )}
    </div>
  );
}
