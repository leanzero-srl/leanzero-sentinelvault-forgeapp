import React, { useState, useEffect, useMemo, useCallback } from "react";
import { invoke } from "@forge/bridge";
import Dialog from "./Dialog";
import { isDowngrade, findLevel, REASON_MAX } from "../../server/capsules/classification/logic.js"; // P5: the one downgrade rule

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

// Lowering a space default asks for ONE thing — the reason — inline, under the row it belongs to
// (P5). Raising or setting saves on the pick (P4). The same shape serves the space console's card.
export const LowerReason = ({ fromLevel, toLevel, subject, busy, onConfirm, onCancel, testId = "cls-lower" }) => {
  const [text, setText] = useState("");
  const ready = text.trim().length > 0 && !busy;
  return (
    <div className="cls-lower" data-testid={testId}>
      <label className="cls-lower-label" htmlFor={`${testId}-input`}>
        {toLevel
          ? <>Lowering {subject} from {fromLevel?.name || "its level"} to {toLevel.name} needs a reason.</>
          : <>Removing {subject} ({fromLevel?.name || "its level"}) needs a reason — its pages will show Unclassified.</>}
        {" "}It is kept in the activity log.
      </label>
      <input id={`${testId}-input`} className="form-input cls-lower-input" autoFocus maxLength={REASON_MAX} value={text}
        placeholder="Why is this less sensitive now?" onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && ready) onConfirm(text.trim()); if (e.key === "Escape") onCancel(); }} data-testid={`${testId}-input`} />
      <button type="button" className="btn-primary" disabled={!ready} onClick={() => onConfirm(text.trim())} data-testid={`${testId}-confirm`}>
        {busy ? "Saving…" : toLevel ? `Lower to ${toLevel.name}` : "Remove the default"}
      </button>
      <button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  );
};

// `onEnabledChange(on)`: P8 — the switch at the top of this tab saves the site switch from HERE
// (store-policy, the same write the Settings toggle makes, so the config mirror refreshes too) in
// BOTH directions, and tells the console, which folds it into its Settings snapshot so the two
// controls never disagree. On needs no confirmation; off asks once and says what it does.
export default function ClassificationTab({ onEnabledChange } = {}) {
  const [state, setState] = useState({ loading: true, error: null, provider: null, levels: [], canManageLevels: false, spaces: [], siteAdmin: false, enabled: false });
  const [selected, setSelected] = useState(() => new Set());
  const [bulkLevel, setBulkLevel] = useState(null); // the level picked in the bulk bar — opens the ONE confirm
  const [bulkReason, setBulkReason] = useState("");
  const [busyRows, setBusyRows] = useState(() => new Set());
  const [savedRow, setSavedRow] = useState(null); // space id that just saved ("Saved" next to its picker)
  const [lowering, setLowering] = useState(null); // { space, levelId } waiting on a reason
  const [bulkBusy, setBulkBusy] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
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
  useEffect(() => { if (!savedRow) return undefined; const t = setTimeout(() => setSavedRow(null), 4000); return () => clearTimeout(t); }, [savedRow]);

  const levelById = useMemo(() => new Map(state.levels.map((l) => [l.id, l])), [state.levels]);
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const pool = hidePersonal ? state.spaces.filter((s) => !String(s.key).startsWith("~") && s.type !== "personal") : state.spaces;
    return q ? pool.filter((s) => s.name.toLowerCase().includes(q) || s.key.toLowerCase().includes(q)) : pool;
  }, [state.spaces, filter, hidePersonal]);

  const setSwitch = async (on) => {
    setEnabling(true);
    try {
      const r = await invoke("store-policy", { scope: "global", data: { classificationEnabled: on } });
      if (!r?.success) { setNotice({ type: "error", text: r?.reason || `Could not turn classification ${on ? "on" : "off"}.` }); return; }
      setState((s) => ({ ...s, enabled: on }));
      setConfirmOff(false);
      setNotice(null); // the status line below IS the confirmation (role=status announces it)
      onEnabledChange?.(on);
    } catch (e) {
      setNotice({ type: "error", text: e?.message || `Could not turn classification ${on ? "on" : "off"}.` });
    } finally { setEnabling(false); }
  };

  const applyResults = (results, levelId) => {
    const okIds = new Set(results.filter((r) => r.ok).map((r) => String(r.spaceId)));
    setState((s) => ({ ...s, spaces: s.spaces.map((sp) => (okIds.has(String(sp.id)) ? { ...sp, defaultLevelId: levelId } : sp)) }));
    const failed = results.filter((r) => !r.ok);
    if (failed.length) setNotice({ type: "error", text: `${okIds.size} updated, ${failed.length} refused: ${failed.map((f) => f.reason).filter((v, i, a) => a.indexOf(v) === i).join("; ")}` });
    return { ok: okIds.size, failed: failed.length };
  };

  const writeOne = async (space, levelId, reason) => {
    setBusyRows((b) => new Set(b).add(space.id));
    try {
      const r = await invoke("classification-set-space-default", { spaceIds: [space.id], levelId, reason });
      const res = r?.results || [{ spaceId: space.id, ok: false, reason: r?.reason || "No answer" }];
      if (applyResults(res, levelId).ok) { setSavedRow(space.id); setLowering(null); setNotice(null); }
    } catch (e) {
      setNotice({ type: "error", text: e?.message || "Could not set the default" });
    } finally {
      setBusyRows((b) => { const n = new Set(b); n.delete(space.id); return n; });
    }
  };
  // P4/P5: a pick saves at once — unless it lowers the default, then the row asks for the reason.
  const pickOne = (space, value) => {
    const levelId = value === NONE ? null : value;
    if (String(levelId ?? "") === String(space.defaultLevelId ?? "")) return;
    if (isDowngrade(space.defaultLevelId, levelId, state.levels)) { setLowering({ space, levelId }); return; }
    setLowering(null);
    writeOne(space, levelId);
  };

  const selectedSpaces = state.spaces.filter((s) => selected.has(s.id));
  const pickBulk = (value) => {
    if (selectedSpaces.length === 1) { pickOne(selectedSpaces[0], value); setSelected(new Set()); return; }
    setBulkReason(""); setBulkLevel(value);
  };
  const bulkLevelId = bulkLevel === NONE ? null : bulkLevel;
  const bulkLowered = bulkLevel == null ? [] : selectedSpaces.filter((s) => isDowngrade(s.defaultLevelId, bulkLevelId, state.levels));
  const runBulk = async () => {
    setBulkBusy(true);
    try {
      const r = await invoke("classification-set-space-default", { spaceIds: selectedSpaces.map((s) => s.id), levelId: bulkLevelId, reason: bulkReason.trim() || undefined });
      const { ok, failed } = applyResults(r?.results || [], bulkLevelId);
      if (!failed) setNotice({ type: "success", text: `${ok} space${ok === 1 ? "" : "s"} updated. Their pages without a level of their own now show ${findLevel(state.levels, bulkLevelId)?.name || "Unclassified"}.` });
      setSelected(new Set());
      setBulkLevel(null);
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

      {/* CLS-1 + P8: the feature's state is ALWAYS the first thing on this tab, with ONE switch
          that works both ways. Off: everything below is dimmed but kept — the levels and defaults
          come back exactly as they were the moment it is on. */}
      <div className={`cls-status ${state.enabled ? "is-on" : "is-off"}`} role="status" data-testid={state.enabled ? "cls-on-banner" : "cls-off-banner"}>
        <div className="cls-status-text">
          {state.enabled
            ? <><strong>Classification is on.</strong> Every page shows its level under its title and in the banner at the top — “Unclassified” until its space or the page itself sets one.</>
            : <><strong>Classification is off on this site.</strong> Pages show no level. Turn it on and every page shows its level under the title and in the banner at the top — the levels and space defaults below apply at once.</>}
        </div>
        {state.siteAdmin ? (
          <button type="button" role="switch" aria-checked={state.enabled} aria-label="Classification on this site" className={`cls-switch ${state.enabled ? "is-on" : ""}`}
            disabled={enabling} onClick={() => (state.enabled ? setConfirmOff(true) : setSwitch(true))} data-testid="cls-switch">
            <span className="cls-switch-track" aria-hidden="true"><span className="cls-switch-knob" /></span>
            <span className="cls-switch-label">{enabling ? (state.enabled ? "Turning off…" : "Turning on…") : state.enabled ? "On" : "Off"}</span>
          </button>
        ) : <span data-testid="cls-switch-ask">Only a site admin can change this.</span>}
      </div>
      {confirmOff && (
        <Dialog title="Turn classification off?" onClose={() => setConfirmOff(false)} busy={enabling} danger testId="cls-off-confirm">
          <div className="sv-dialog-body">
            <p>Pages stop showing a level — under the title, in the banner and in the page details — and no level can be set.</p>
            <p>Every level, space default and page level is kept, and shows again when you turn classification back on.</p>
          </div>
          <div className="sv-dialog-actions">
            <button type="button" className="btn-secondary" onClick={() => setConfirmOff(false)} disabled={enabling} data-testid="cls-off-confirm-no">Keep it on</button>
            <button type="button" className="btn-danger" onClick={() => setSwitch(false)} disabled={enabling} data-testid="cls-off-confirm-yes">{enabling ? "Turning off…" : "Turn off"}</button>
          </div>
        </Dialog>
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
            <span>Set {selected.size === 1 ? "its" : "their"} default to</span>
            <LevelPicker value={null} levels={state.levels} onChange={pickBulk} ariaLabel="Default level for the selected spaces" testId="cls-bulk-picker" />
            {selected.size > 1 && <span className="cls-bulk-hint">You confirm once before {selected.size} spaces change.</span>}
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
                  <React.Fragment key={s.id}>
                  <tr data-testid={`cls-space-row-${s.key}`} className={selected.has(s.id) ? "sel" : ""}>
                    <td className="cls-col-check"><label className="form-checkbox"><input type="checkbox" checked={selected.has(s.id)} onChange={(e) => setSelected((prev) => { const n = new Set(prev); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n; })} aria-label={`Select ${s.name}`} /></label></td>
                    <td className="cls-key">{s.key}</td>
                    <td>{s.name}</td>
                    <td className="cls-type cls-col-type">{String(s.type || "").replace(/_/g, " ")}</td>
                    <td><LevelChip level={levelById.get(s.defaultLevelId) || null} testId={`cls-space-level-${s.key}`} /></td>
                    <td>
                      <span className="cls-pick-cell">
                        <LevelPicker value={s.defaultLevelId || NONE} levels={state.levels} onChange={(v) => pickOne(s, v)} ariaLabel={`Default level for ${s.name}`} testId={`cls-space-picker-${s.key}`} disabled={busyRows.has(s.id)} />
                        {busyRows.has(s.id) && <span className="cls-saved" role="status">Saving…</span>}
                        {savedRow === s.id && !busyRows.has(s.id) && <span className="cls-saved" role="status" data-testid={`cls-space-saved-${s.key}`}>Saved</span>}
                      </span>
                    </td>
                  </tr>
                  {lowering?.space.id === s.id && (
                    <tr className="cls-lower-row">
                      <td colSpan={6}>
                        <LowerReason subject={`${s.name}'s default`} fromLevel={levelById.get(s.defaultLevelId)} toLevel={findLevel(state.levels, lowering.levelId)} busy={busyRows.has(s.id)}
                          onConfirm={(reason) => writeOne(s, lowering.levelId, reason)} onCancel={() => setLowering(null)} testId={`cls-lower-${s.key}`} />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))}
                {visible.length === 0 && <tr><td colSpan={6} className="cls-empty-row">No space matches "{filter}".</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {bulkLevel != null && (
        <Dialog title={`Set the default for ${selectedSpaces.length} spaces?`} onClose={() => setBulkLevel(null)} busy={bulkBusy} testId="cls-bulk-dialog">
          <div className="sv-dialog-body">
            <p>
              Every page in these {selectedSpaces.length} spaces without a level of its own will show{" "}
              {bulkChip ? <LevelChip level={bulkChip} /> : <strong>Unclassified</strong>}. Pages with their own level keep it.
            </p>
            {bulkLowered.length > 0 && (
              <>
                <label className="cls-lower-label" htmlFor="cls-bulk-reason">
                  This lowers the default of {bulkLowered.length === selectedSpaces.length ? "all of them" : `${bulkLowered.length} of them`} ({bulkLowered.slice(0, 3).map((s) => s.name).join(", ")}{bulkLowered.length > 3 ? "…" : ""}). Give the reason — it is kept in the activity log.
                </label>
                <textarea id="cls-bulk-reason" className="form-input cls-lower-input" rows={2} maxLength={REASON_MAX} value={bulkReason}
                  placeholder="Why are these spaces less sensitive now?" onChange={(e) => setBulkReason(e.target.value)} data-testid="cls-bulk-reason" />
              </>
            )}
          </div>
          <div className="sv-dialog-actions">
            <button type="button" className="btn-secondary" onClick={() => setBulkLevel(null)} disabled={bulkBusy}>Cancel</button>
            <button type="button" className="btn-primary" onClick={runBulk} disabled={bulkBusy || (bulkLowered.length > 0 && !bulkReason.trim())} data-testid="cls-bulk-confirm">
              {bulkBusy ? "Working…" : `Set ${selectedSpaces.length} spaces`}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
