import React, { useState, useEffect, useMemo, useCallback } from "react";
import { invoke } from "@forge/bridge";

// Classification tab (Part 3.1 + 3.2) for the steward console. Shows which provider is in use
// (Confluence's native scheme or the app's own), the levels — editable only on the App scheme and
// only by a site admin — and every space with its default level, settable per row or in bulk.
//
// Owner's UI rules: no left accent rails, no washed tints (level chips are SOLID fills of the
// level's own colour), no native <select>/alert/confirm — the level picker and the edit dialog
// are the console's own primitives. Uses --sv-* tokens throughout (styles in steward-console.css).

const NONE = "__none__";

// Close a popover only when focus leaves the whole control — the menus below hold an input
// (search box, hex field), and React's onBlur fires when focus moves INTO that child too.
const closeOnLeave = (setOpen) => (e) => {
  const next = e.relatedTarget;
  if (next && e.currentTarget.contains(next)) return;
  setTimeout(() => setOpen(false), 150);
};

// Text on a solid chip: black on light hues, white on dark ones (relative luminance, WCAG-ish).
export function chipTextColor(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  if (!m) return "#FFFFFF";
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.45 ? "#0F172A" : "#FFFFFF";
}

export const LevelChip = ({ level, testId }) => (
  level
    ? <span className="cls-chip" style={{ background: level.color, color: chipTextColor(level.color) }} data-testid={testId}>{level.name}</span>
    : <span className="cls-chip cls-chip-none" data-testid={testId}>Not set</span>
);

// Custom level picker: a button showing the current chip, a listbox with a search box (the console's
// "UX pass, part 3" picker shape). `value` is a level id, NONE, or null for a mixed/unset prompt.
export const LevelPicker = ({ value, levels, onChange, placeholder = "Choose a level…", ariaLabel, testId, allowNone = true, disabled = false }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = levels.find((l) => l.id === value);
  const shown = useMemo(() => levels.filter((l) => !q.trim() || l.name.toLowerCase().includes(q.trim().toLowerCase())), [levels, q]);
  const pick = (id) => { onChange(id); setOpen(false); setQ(""); };
  return (
    <div className={`mini-select cls-picker ${disabled ? "disabled" : ""}`} tabIndex={disabled ? -1 : 0} onBlur={closeOnLeave(setOpen)} data-testid={testId}>
      <div className="mini-select-value" onClick={() => !disabled && setOpen(!open)} role="button" aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}>
        {current ? <LevelChip level={current} /> : <span className={value === NONE ? "" : "cls-picker-placeholder"}>{value === NONE ? "Not set" : placeholder}</span>}
        <span className={`mini-select-arrow ${open ? "open" : ""}`}>▼</span>
      </div>
      {open && (
        <div className="mini-select-menu cls-picker-menu" role="listbox">
          {levels.length > 5 && (
            <input className="form-input cls-picker-search" placeholder="Search levels…" value={q} onChange={(e) => setQ(e.target.value)} onClick={(e) => e.stopPropagation()} aria-label="Search levels" />
          )}
          {allowNone && (
            <div role="option" aria-selected={value === NONE} className={`mini-select-opt cls-picker-opt ${value === NONE ? "sel" : ""}`} onMouseDown={() => pick(NONE)}>
              <LevelChip level={null} /> <span className="cls-picker-opt-hint">clear the default</span>
            </div>
          )}
          {shown.map((l) => (
            <div key={l.id} role="option" aria-selected={l.id === value} className={`mini-select-opt cls-picker-opt ${l.id === value ? "sel" : ""}`} onMouseDown={() => pick(l.id)}>
              <LevelChip level={l} /> {l.description && <span className="cls-picker-opt-hint">{l.description}</span>}
            </div>
          ))}
          {shown.length === 0 && <div className="cls-picker-empty">No level matches.</div>}
        </div>
      )}
    </div>
  );
};

// Modal (no window.confirm): the bulk apply asks once, with the count and the chip, before writing.
const Dialog = ({ title, children, onCancel, onConfirm, confirmLabel = "Apply", busy = false }) => {
  // Escape dismisses too (tester report 2026-09-21); the backdrop click below already did.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) { e.preventDefault(); e.stopPropagation(); onCancel(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [busy, onCancel]);
  return (
  <div className="cls-dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
    <div className="cls-dialog" role="dialog" aria-modal="true" aria-label={title}>
      <h3 className="cls-dialog-title">{title}</h3>
      <div className="cls-dialog-body">{children}</div>
      <div className="cls-dialog-actions">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn-primary" onClick={onConfirm} disabled={busy}>{busy ? "Working…" : confirmLabel}</button>
      </div>
    </div>
  </div>
  );
};

// Solid palette for level colours (no native colour input): click the swatch, pick a hue, or type a hex.
const PALETTE = ["#DC2626", "#EA580C", "#D97706", "#CA8A04", "#059669", "#0891B2", "#2563EB", "#7C3AED", "#DB2777", "#475569", "#0F172A"];
const SwatchPicker = ({ value, onChange, label }) => {
  const [open, setOpen] = useState(false);
  const valid = /^#[0-9a-f]{6}$/i.test(value || "");
  return (
    <div className="cls-swatch-wrap" tabIndex={0} onBlur={closeOnLeave(setOpen)}>
      <button type="button" className="cls-swatch" style={{ background: valid ? value : "#94A3B8" }} onClick={() => setOpen(!open)} aria-label={label} aria-haspopup="listbox" aria-expanded={open} />
      {open && (
        <div className="mini-select-menu cls-swatch-menu" role="listbox" aria-label="Colour">
          <div className="cls-swatch-grid">
            {PALETTE.map((c) => (
              <button type="button" key={c} role="option" aria-selected={c.toLowerCase() === String(value).toLowerCase()} className={`cls-swatch-opt ${c.toLowerCase() === String(value).toLowerCase() ? "sel" : ""}`} style={{ background: c }} onMouseDown={() => { onChange(c); setOpen(false); }} aria-label={c} />
            ))}
          </div>
          <input className="form-input cls-swatch-hex" value={value} onChange={(e) => onChange(e.target.value)} placeholder="#RRGGBB" aria-label="Hex colour" onMouseDown={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
};

// A new level gets its id from its name on save (slug); an existing level KEEPS its id when renamed
// so every page and space already assigned to it stays assigned.
const emptyLevel = (rank) => ({ id: "", name: "", color: "#0891B2", rank, description: "" });

// Levels editor (App provider + site admin only). Validation mirrors the server's validateLevels
// so the user sees the refusal before the round-trip; the server is still the authority.
const LevelsEditor = ({ levels, onSaved, onError }) => {
  const [draft, setDraft] = useState(levels.map((l) => ({ ...l })));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(levels.map((l) => ({ ...l }))); }, [levels]);
  const update = (i, patch) => setDraft((d) => d.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const remove = (i) => setDraft((d) => d.filter((_, j) => j !== i));
  const add = () => setDraft((d) => [...d, emptyLevel(Math.max(0, ...d.map((l) => Number(l.rank) || 0)) + 1)]);
  const slug = (name) => name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "level";
  const save = async () => {
    setBusy(true);
    try {
      const payload = draft.map((l) => ({ ...l, id: l.id || slug(l.name), rank: Number(l.rank) }));
      const r = await invoke("classification-manage-levels", { levels: payload });
      if (r?.ok) onSaved(r.levels); else onError(r?.reason || "Could not save the levels");
    } catch (e) {
      onError(e?.message || "Could not save the levels");
    } finally { setBusy(false); }
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(levels);
  return (
    <div className="cls-levels-editor" data-testid="cls-levels-editor">
      <div className="cls-levels-head"><span>Colour</span><span>Name</span><span>Rank</span><span>Description</span><span /></div>
      {draft.map((l, i) => (
        <div className="cls-level-row" key={`${l.id}-${i}`} data-testid={`cls-level-row-${l.id}`}>
          <SwatchPicker value={l.color} onChange={(color) => update(i, { color })} label={`Colour for ${l.name || "level"}`} />
          <input className="form-input" value={l.name} placeholder="Level name" onChange={(e) => update(i, { name: e.target.value })} aria-label="Level name" />
          <input className="form-input cls-rank" type="text" inputMode="numeric" pattern="[0-9]*" value={l.rank} onChange={(e) => update(i, { rank: e.target.value.replace(/[^0-9]/g, "").slice(0, 2) })} aria-label="Rank" />
          <input className="form-input" value={l.description || ""} placeholder="What this level means" onChange={(e) => update(i, { description: e.target.value })} aria-label="Description" />
          <button type="button" className="cls-level-remove" onClick={() => remove(i)} disabled={draft.length <= 1} aria-label={`Remove ${l.name || "level"}`}>×</button>
        </div>
      ))}
      <div className="cls-levels-actions">
        <button type="button" className="btn-secondary" onClick={add} disabled={draft.length >= 8}>Add level</button>
        <button type="button" className="btn-primary" onClick={save} disabled={!dirty || busy} data-testid="cls-levels-save">{busy ? "Saving…" : "Save levels"}</button>
        <span className="settings-row-description">1 to 8 levels. Rank orders them low to high; the colour is the chip shown on pages.</span>
      </div>
    </div>
  );
};

/**
 * Levels from JSM Assets (docs/CLASSIFICATION-ASSETS-DESIGN.md). Every read runs in THIS admin's
 * session (the Assets API refuses the app's identity), so the picker only ever lives here:
 * schema → object type → attribute mapping (guessed from the attribute names, editable) →
 * preview → Import. Linked state shows what was imported, from where and when, with Re-import.
 */
// onImported(levels): the import resolver answers with the levels it wrote, and the tab takes
// them as-is — a full reload here would unmount this section (losing the receipt) and read KVS
// before the write is visible (observed live 2026-09-19: the list still showed the old levels).
function AssetsLink({ onImported }) {
  const [link, setLink] = useState(undefined); // undefined = not read yet, null = none
  const [schemas, setSchemas] = useState(null);
  const [schema, setSchema] = useState(null);
  const [types, setTypes] = useState(null);
  const [type, setType] = useState(null);
  const [attrs, setAttrs] = useState(null);
  const [mapping, setMapping] = useState({ rank: null, color: null, description: null });
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(null); // "schemas" | "types" | "attrs" | "preview" | "import"
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  useEffect(() => { invoke("classification-assets-link", {}).then((r) => setLink(r?.link || null)).catch(() => setLink(null)); }, []);

  const run = async (key, action, payload, apply) => {
    setBusy(key); setError(null);
    try { const r = await invoke(action, payload); if (r?.error) setError(r.error); else apply(r); }
    catch (e) { setError(e?.message || "Could not reach Sentinel Vault"); }
    finally { setBusy(null); }
  };
  const loadSchemas = () => { setTypes(null); setType(null); setAttrs(null); setPreview(null); setDone(null); run("schemas", "classification-assets-schemas", {}, (r) => setSchemas(r.schemas || [])); };
  const pickSchema = (sc) => { setSchema(sc); setType(null); setAttrs(null); setPreview(null); run("types", "classification-assets-object-types", { schemaId: sc.id }, (r) => setTypes(r.objectTypes || [])); };
  const pickType = (t) => { setType(t); setPreview(null); run("attrs", "classification-assets-attributes", { objectTypeId: t.id }, (r) => { setAttrs(r.attributes || []); setMapping({ rank: r.suggested?.rank || null, color: r.suggested?.color || null, description: r.suggested?.description || null }); }); };
  const doPreview = () => run("preview", "classification-assets-preview", { objectTypeId: type.id, mapping }, (r) => setPreview(r));
  const doImport = () => run("import", "classification-assets-import", { schemaId: schema.id, objectTypeId: type.id, mapping, schemaName: schema.name, objectTypeName: type.name }, (r) => { setLink(r.link); setDone(r); setSchemas(null); setTypes(null); setType(null); setAttrs(null); setPreview(null); if (onImported) onImported(r.levels); });
  const reimport = () => { if (!link) return; run("import", "classification-assets-import", { schemaId: link.schemaId, objectTypeId: link.objectTypeId, mapping: link.mapping || {}, schemaName: link.schemaName, objectTypeName: link.objectTypeName }, (r) => { setLink(r.link); setDone(r); if (onImported) onImported(r.levels); }); };
  const unlink = () => run("unlink", "classification-assets-set-link", { link: null }, () => { setLink(null); setDone(null); });

  const AttrPick = ({ field, label }) => (
    <label className="cls-assets-map">
      <span className="cls-assets-map-label">{label}</span>
      <span className="cls-assets-map-opts" role="radiogroup" aria-label={label}>
        <button type="button" className={`cls-assets-opt${!mapping[field] ? " is-active" : ""}`} onClick={() => setMapping({ ...mapping, [field]: null })} role="radio" aria-checked={!mapping[field]}>none</button>
        {attrs.map((a) => <button type="button" key={a.id} className={`cls-assets-opt${mapping[field] === a.id ? " is-active" : ""}`} onClick={() => setMapping({ ...mapping, [field]: a.id })} role="radio" aria-checked={mapping[field] === a.id} data-testid={`cls-assets-map-${field}`}>{a.name}</button>)}
      </span>
    </label>
  );

  return (
    <section className="cls-section" data-testid="cls-assets">
      <div className="cls-section-head">
        <h4 className="cls-section-title">Levels from JSM Assets</h4>
        {link && <span className="cls-provider-badge app" data-testid="cls-assets-badge">Linked</span>}
      </div>
      {link ? (
        <p className="settings-row-description" data-testid="cls-assets-linked">
          Imported from <strong>{link.objectTypeName || `object type ${link.objectTypeId}`}</strong>{link.schemaName ? <> in <strong>{link.schemaName}</strong></> : null}{link.importedAt ? ` on ${new Date(link.importedAt).toLocaleString()}` : " (mapping set, not imported yet)"}. Re-import after the objects change in Assets.
        </p>
      ) : (
        <p className="settings-row-description">Use an object type in a Jira Service Management Assets schema as the source of the classification levels. The read runs as you, from this console; nothing runs in the background and nothing is written to Assets.</p>
      )}
      <div className="cls-assets-actions">
        {link && <button type="button" className="btn-primary" onClick={reimport} disabled={!!busy} data-testid="cls-assets-reimport">{busy === "import" ? "Importing…" : "Re-import now"}</button>}
        {!schemas && <button type="button" className="btn-secondary" onClick={loadSchemas} disabled={!!busy} data-testid="cls-assets-load">{busy === "schemas" ? "Loading…" : link ? "Change the source…" : "Choose an Assets object type…"}</button>}
        {link && <button type="button" className="btn-secondary" onClick={unlink} disabled={!!busy} data-testid="cls-assets-unlink">Unlink (keep the levels)</button>}
      </div>
      {error && <div className="alert-error" role="alert" data-testid="cls-assets-error">{error}</div>}
      {done && <div className="alert-success" role="status" data-testid="cls-assets-done">Imported {done.levels?.length || 0} level{done.levels?.length === 1 ? "" : "s"}.{done.problems?.length ? ` ${done.problems.length} note${done.problems.length === 1 ? "" : "s"}: ${done.problems.join(" · ")}` : ""}</div>}
      {schemas && (
        <div className="cls-assets-step">
          <div className="cls-assets-step-title">1 · Schema</div>
          <div className="cls-assets-list" data-testid="cls-assets-schemas">
            {schemas.length === 0 && <p className="settings-row-description">No object schemas in this site's Assets workspace.</p>}
            {schemas.map((sc) => <button type="button" key={sc.id} className={`cls-assets-opt${schema?.id === sc.id ? " is-active" : ""}`} onClick={() => pickSchema(sc)} disabled={!!busy} data-testid="cls-assets-schema">{sc.name} <span className="cls-picker-opt-hint">{sc.key}</span></button>)}
          </div>
        </div>
      )}
      {types && (
        <div className="cls-assets-step">
          <div className="cls-assets-step-title">2 · Object type</div>
          <div className="cls-assets-list" data-testid="cls-assets-types">
            {types.length === 0 && <p className="settings-row-description">This schema has no object types.</p>}
            {types.map((t) => <button type="button" key={t.id} className={`cls-assets-opt${type?.id === t.id ? " is-active" : ""}`} onClick={() => pickType(t)} disabled={!!busy} data-testid="cls-assets-type">{t.name}{t.objectCount != null ? <span className="cls-picker-opt-hint"> · {t.objectCount}</span> : null}</button>)}
          </div>
        </div>
      )}
      {attrs && type && (
        <div className="cls-assets-step" data-testid="cls-assets-mapping">
          <div className="cls-assets-step-title">3 · Which attribute holds what (the object's name is the level's name)</div>
          <AttrPick field="rank" label="Rank" />
          <AttrPick field="color" label="Colour" />
          <AttrPick field="description" label="Description" />
          <button type="button" className="btn-secondary" onClick={doPreview} disabled={!!busy} data-testid="cls-assets-preview-btn">{busy === "preview" ? "Reading…" : "Preview the levels"}</button>
        </div>
      )}
      {preview && (
        <div className="cls-assets-step" data-testid="cls-assets-preview">
          <div className="cls-assets-step-title">4 · Preview{preview.objectCount != null ? ` · ${preview.objectCount} object${preview.objectCount === 1 ? "" : "s"}` : ""}{preview.truncated ? " (only the first 50 are read)" : ""}</div>
          {preview.error && <div className="alert-error" role="alert">{preview.error}</div>}
          {preview.levels?.length > 0 && (
            <div className="cls-assets-list">
              {preview.levels.map((l) => <span key={l.id} className="cls-chip" style={{ background: l.color, color: chipTextColor(l.color) }} data-testid="cls-assets-preview-level" title={l.description || ""}>{l.rank} · {l.name}</span>)}
            </div>
          )}
          {preview.problems?.length > 0 && <ul className="cls-assets-problems">{preview.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
          {preview.ok && <button type="button" className="btn-primary" onClick={doImport} disabled={!!busy} data-testid="cls-assets-import">{busy === "import" ? "Importing…" : `Import ${preview.levels.length} level${preview.levels.length === 1 ? "" : "s"} — replaces the current list`}</button>}
        </div>
      )}
    </section>
  );
}

// `onOpenSettings`: CLS-1 — the site switch lives on the Settings tab (one write path, the Apply
// bar); this tab only says whether it is off and offers the way there.
export default function ClassificationTab({ onOpenSettings } = {}) {
  const [state, setState] = useState({ loading: true, error: null, provider: null, levels: [], canManageLevels: false, spaces: [], siteAdmin: false, enabled: false });
  const [selected, setSelected] = useState(() => new Set());
  const [bulkLevel, setBulkLevel] = useState(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [busyRows, setBusyRows] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { type: "success" | "error", text }
  const [filter, setFilter] = useState("");
  // Personal spaces (~accountId keys) are noise for a site-wide default policy; hidden by default (UAT defect 9).
  const [hidePersonal, setHidePersonal] = useState(true);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [prov, list] = await Promise.all([invoke("classification-provider", {}), invoke("classification-list-spaces", {})]);
      if (prov?.error) throw new Error(prov.error);
      if (list?.error) throw new Error(list.error);
      setState({
        loading: false, error: null,
        provider: prov?.name || "app", levels: prov?.levels || [], canManageLevels: !!prov?.canManageLevels, enabled: prov?.enabled === true,
        spaces: list?.spaces || [], siteAdmin: !!list?.siteAdmin, reason: list?.reason || null,
      });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e?.message || "Could not load classification" }));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const levelById = useMemo(() => new Map(state.levels.map((l) => [l.id, l])), [state.levels]);
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const pool = hidePersonal ? state.spaces.filter((s) => !String(s.key).startsWith("~") && s.type !== "personal") : state.spaces;
    return q ? pool.filter((s) => s.name.toLowerCase().includes(q) || s.key.toLowerCase().includes(q)) : pool;
  }, [state.spaces, filter, hidePersonal]);

  const applyResults = (results, levelId) => {
    const okIds = new Set(results.filter((r) => r.ok).map((r) => String(r.spaceId)));
    setState((s) => ({ ...s, spaces: s.spaces.map((sp) => (okIds.has(String(sp.id)) ? { ...sp, defaultLevelId: levelId } : sp)) }));
    const failed = results.filter((r) => !r.ok);
    if (failed.length === 0) setNotice({ type: "success", text: `${okIds.size} space${okIds.size === 1 ? "" : "s"} updated.` });
    else setNotice({ type: "error", text: `${okIds.size} updated, ${failed.length} refused: ${failed.map((f) => f.reason).filter((v, i, a) => a.indexOf(v) === i).join("; ")}` });
  };

  const setOne = async (space, value) => {
    const levelId = value === NONE ? null : value;
    setBusyRows((b) => new Set(b).add(space.id));
    try {
      const r = await invoke("classification-set-space-default", { spaceIds: [space.id], levelId });
      applyResults(r?.results || [{ spaceId: space.id, ok: false, reason: r?.reason || "No answer" }], levelId);
    } catch (e) {
      setNotice({ type: "error", text: e?.message || "Could not set the default" });
    } finally {
      setBusyRows((b) => { const n = new Set(b); n.delete(space.id); return n; });
    }
  };

  const runBulk = async () => {
    const levelId = bulkLevel === NONE ? null : bulkLevel;
    setBulkBusy(true);
    try {
      const r = await invoke("classification-set-space-default", { spaceIds: [...selected], levelId });
      applyResults(r?.results || [], levelId);
      setSelected(new Set());
      setConfirmBulk(false);
    } catch (e) {
      setNotice({ type: "error", text: e?.message || "Could not apply the bulk change" });
    } finally { setBulkBusy(false); }
  };

  const toggleAll = (on) => setSelected(on ? new Set(visible.map((s) => s.id)) : new Set());
  const allVisibleSelected = visible.length > 0 && visible.every((s) => selected.has(s.id));

  if (state.loading) return <div className="settings-panel cls-state" data-testid="cls-loading">Loading classification…</div>;
  if (state.error) {
    return (
      <div className="settings-panel">
        <div className="alert-error" data-testid="cls-error">{state.error}</div>
        <button type="button" className="btn-secondary" onClick={load}>Try again</button>
      </div>
    );
  }

  const bulkChip = bulkLevel && bulkLevel !== NONE ? levelById.get(bulkLevel) : null;

  return (
    <div className={`settings-panel cls-tab${state.enabled ? "" : " cls-tab--off"}`} data-testid="cls-tab" data-enabled={state.enabled ? "true" : "false"}>
      {notice && (
        <div className={`cls-notice-sticky ${notice.type === "success" ? "alert-success" : "alert-error"}`} role="status" data-testid="cls-notice" onClick={() => setNotice(null)}>{notice.text}</div>
      )}

      {/* CLS-1: the switch is on the Settings tab; while it is off this tab says so first and
          everything below is dimmed but kept — the levels and defaults come back exactly as
          they were when it is turned on. */}
      {!state.enabled && (
        <div className="cls-off-banner" role="status" data-testid="cls-off-banner">
          <div className="cls-off-banner-text">
            <strong>Classification is off on this site.</strong> Pages show no level in the byline chip, the ribbon or the page details, and no level can be set. The levels and space defaults below are kept and apply again the moment it is turned on.
          </div>
          {onOpenSettings && <button type="button" className="btn-primary" onClick={onOpenSettings} data-testid="cls-off-open-settings">Turn it on in Settings</button>}
        </div>
      )}

      <section className="cls-section">
        <div className="cls-section-head">
          <h4 className="cls-section-title">Scheme in use</h4>
          <span className={`cls-provider-badge ${state.provider === "native" ? "native" : "app"}`} data-testid="cls-provider-badge">
            {state.provider === "native" ? "Native" : "App"}
          </span>
        </div>
        <p className="settings-row-description">
          {state.provider === "native"
            ? "Confluence's own data classification is enabled on this site; its levels are managed in Confluence administration and shown here read-only."
            : "This site has no native classification levels, so Sentinel Vault's own scheme is in use. Levels are stored by the app and applied as a content property on each page."}
        </p>
      </section>

      {state.provider !== "native" && state.siteAdmin && <AssetsLink onImported={(levels) => { setState((s) => ({ ...s, levels })); setNotice({ type: "success", text: "Levels imported from Assets." }); }} />}

      <section className="cls-section">
        <div className="cls-section-head"><h4 className="cls-section-title">Levels</h4></div>
        {state.levels.length === 0 && <p className="settings-row-description" data-testid="cls-levels-empty">No levels defined.</p>}
        {state.canManageLevels
          ? <LevelsEditor levels={state.levels} onSaved={(levels) => { setState((s) => ({ ...s, levels })); setNotice({ type: "success", text: "Levels saved." }); }} onError={(text) => setNotice({ type: "error", text })} />
          : (
            <div className="cls-levels-list" data-testid="cls-levels-list">
              {state.levels.map((l) => (
                <div className="cls-level-card" key={l.id}>
                  <LevelChip level={l} />
                  <span className="cls-level-rank">rank {l.rank}</span>
                  {l.description && <span className="cls-level-desc">{l.description}</span>}
                </div>
              ))}
            </div>
          )}
      </section>

      <section className="cls-section">
        <div className="cls-section-head">
          <h4 className="cls-section-title">Space defaults</h4>
          <input className="form-input cls-filter" placeholder="Filter spaces…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter spaces" />
          <label className="cls-personal-toggle"><label className="form-checkbox"><input type="checkbox" checked={!hidePersonal} onChange={(e) => setHidePersonal(!e.target.checked)} aria-label="Show personal spaces" /></label><span>Show personal spaces</span></label>
        </div>
        <p className="settings-row-description">A page with no classification of its own takes its space's default. {state.siteAdmin ? "You see every space on the site." : "You see the spaces you administer."}</p>

        {selected.size > 0 && (
          <div className="cls-bulk-bar" data-testid="cls-bulk-bar">
            <strong>{selected.size} space{selected.size === 1 ? "" : "s"} selected</strong>
            <span>Set to</span>
            <LevelPicker value={bulkLevel} levels={state.levels} onChange={setBulkLevel} ariaLabel="Level for the selected spaces" testId="cls-bulk-picker" />
            <button type="button" className="btn-primary" disabled={!bulkLevel} onClick={() => setConfirmBulk(true)} data-testid="cls-bulk-apply">Apply</button>
            <button type="button" className="btn-secondary" onClick={() => setSelected(new Set())}>Clear selection</button>
          </div>
        )}

        {state.spaces.length === 0 ? (
          <p className="settings-row-description" data-testid="cls-spaces-empty">{state.reason === "Not authorized" ? "You do not administer any space." : "No spaces found."}</p>
        ) : (
          <div className="cls-table-wrap">
            <table className="cls-table" data-testid="cls-spaces-table">
              <thead>
                <tr>
                  <th scope="col" className="cls-col-check"><label className="form-checkbox"><input type="checkbox" checked={allVisibleSelected} onChange={(e) => toggleAll(e.target.checked)} aria-label="Select all shown spaces" /></label></th>
                  <th scope="col" className="cls-col-key">Key</th>
                  <th scope="col">Space</th>
                  <th scope="col" className="cls-col-type">Type</th>
                  <th scope="col">Default level</th>
                  <th scope="col">Change</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <tr key={s.id} data-testid={`cls-space-row-${s.key}`} className={selected.has(s.id) ? "sel" : ""}>
                    <td className="cls-col-check"><label className="form-checkbox"><input type="checkbox" checked={selected.has(s.id)} onChange={(e) => setSelected((prev) => { const n = new Set(prev); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n; })} aria-label={`Select ${s.name}`} /></label></td>
                    <td className="cls-key">{s.key}</td>
                    <td>{s.name}</td>
                    <td className="cls-type cls-col-type">{String(s.type || "").replace(/_/g, " ")}</td>
                    <td><LevelChip level={levelById.get(s.defaultLevelId) || null} testId={`cls-space-level-${s.key}`} /></td>
                    <td>
                      <LevelPicker value={s.defaultLevelId || NONE} levels={state.levels} onChange={(v) => setOne(s, v)} ariaLabel={`Default level for ${s.name}`} testId={`cls-space-picker-${s.key}`} disabled={busyRows.has(s.id)} />
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && <tr><td colSpan={6} className="cls-empty-row">No space matches "{filter}".</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {confirmBulk && (
        <Dialog title="Set the default for selected spaces" onCancel={() => setConfirmBulk(false)} onConfirm={runBulk} busy={bulkBusy} confirmLabel={`Set ${selected.size} space${selected.size === 1 ? "" : "s"}`}>
          <p>
            Every page in {selected.size === 1 ? "this space" : `these ${selected.size} spaces`} without its own classification will show{" "}
            {bulkChip ? <LevelChip level={bulkChip} /> : <strong>no classification</strong>}.
          </p>
          <p className="settings-row-description">Page-level overrides are not changed.</p>
        </Dialog>
      )}
    </div>
  );
}
