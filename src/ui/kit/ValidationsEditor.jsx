import React, { useState, useEffect } from "react";
import { invoke } from "@forge/bridge";
import UnsavedFloat from "./UnsavedFloat";
import { ruleConfigProblem, ruleListRefusal } from "../../server/shared/rule-config.js"; // one completeness rule, shared with the save resolver

// Shared Conditions & Validations editor — used by the steward console (global
// scope) and the realm console (per-space scope). Self-contained: its own
// SettingsRow / Toggle / MiniSelect so it doesn't depend on the host surface.

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

const MiniSelect = ({ value, options, onChange }) => {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <div className="mini-select" tabIndex={0} onBlur={() => setTimeout(() => setOpen(false), 150)}>
      <div className="mini-select-value" onClick={() => setOpen(!open)}>
        <span>{current ? current.label : "Select…"}</span>
        <span className={`mini-select-arrow ${open ? "open" : ""}`}>▼</span>
      </div>
      {open && (
        <div className="mini-select-menu">
          {options.map((o) => (
            <div key={o.value} className={`mini-select-opt ${o.value === value ? "sel" : ""}`} onClick={() => { onChange(o.value); setOpen(false); }}>
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// A visible caption above every rule input (2026-09-23): the rule's report name and its value
// used to be two identical placeholder-only boxes, and a tester filled the name thinking it was
// the heading text — the rule then checked nothing.
const Field = ({ label, hint, children, wide }) => (
  <label className={`val-field${wide ? " val-field-wide" : ""}`}>
    <span className="val-field-label">{label}</span>
    {children}
    {hint && <span className="val-field-hint">{hint}</span>}
  </label>
);

// Keeps what the person TYPES (commas included) and hands the parsed list up. Parsing on every
// keystroke dropped the comma as soon as it was typed, so a second label could never be entered.
const LabelsInput = ({ labels, onChange }) => {
  const [text, setText] = useState((labels || []).join(", "));
  return (
    <input
      className="form-input"
      placeholder="e.g. reviewed, security"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.split(",").map((x) => x.trim()).filter(Boolean));
      }}
    />
  );
};

const RULE_TYPES = [
  { value: "required-heading", label: "Require a heading" },
  { value: "required-table", label: "Require a table" },
  { value: "required-macro", label: "Require a macro" },
  { value: "required-label", label: "Require labels" },
  { value: "heading-hierarchy", label: "No skipped heading levels" },
  { value: "max-length", label: "Maximum length" },
  { value: "min-length", label: "Minimum length" },
];

const SEVERITY_OPTIONS = [
  { value: "warn", label: "Recommended" },
  { value: "block", label: "Required" },
];

const DEFAULT_AI = {
  enabled: false,
  model: "claude-haiku-4-5-20251001",
  styleGuide: "",
  tone: "",
  compliance: "",
  rules: "",
  severityThreshold: "low",
  notifyAuthor: false,
  monthlyTokenBudget: 0,
  maxChars: 40000,
};

const SEVERITY_THRESHOLDS = [
  { value: "low", label: "Low and above (all)" },
  { value: "medium", label: "Medium and above" },
  { value: "high", label: "High only" },
];

export default function ValidationsEditor({ scope = "global", spaceKey = null }) {
  const [cfg, setCfg] = useState({ enabled: false, modes: { advisory: true, gate: false, revert: false }, rules: [], ai: { ...DEFAULT_AI } });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  // Tester report 2026-09-21: the Save button appears only while something changed, right under the
  // AI section, and disappears again once saved. `saved` is the last stored shape.
  const [saved, setSaved] = useState(null);
  const [aiModels, setAiModels] = useState([]);
  const [globalRules, setGlobalRules] = useState(null); // audit C6: for the informed-override note

  useEffect(() => {
    (async () => {
      try {
        const r = await invoke("load-validation-config", { scope, key: spaceKey });
        if (r) {
          const loaded = {
            enabled: !!r.enabled,
            modes: r.modes || { advisory: true, gate: false, revert: false },
            rules: r.rules || [],
            ai: { ...DEFAULT_AI, ...(r.ai || {}) },
          };
          setCfg(loaded);
          setSaved(JSON.stringify(loaded));
        } else {
          setSaved(JSON.stringify({ enabled: false, modes: { advisory: true, gate: false, revert: false }, rules: [], ai: { ...DEFAULT_AI } }));
        }
        // C6: a space that SETS rules overrides global entirely (documented) — so surface
        // exactly what would be dropped, especially required (block-severity) global rules.
        if (scope === "space") {
          const g = await invoke("load-validation-config", { scope: "global" });
          setGlobalRules(Array.isArray(g?.rules) ? g.rules : []);
        }
      } catch (e) {
        console.error("Load validation config failed:", e);
      } finally {
        setLoading(false);
      }
      try {
        const m = await invoke("list-ai-models", {});
        setAiModels(m?.models || []);
      } catch (_) { /* dropdown falls back to the saved value */ }
    })();
  }, [scope, spaceKey]);

  const updateAi = (patch) => setCfg((p) => ({ ...p, ai: { ...p.ai, ...patch } }));
  const addRule = () => setCfg((p) => ({ ...p, rules: [...p.rules, { id: `r${Date.now()}`, type: "required-heading", label: "", severity: "warn", config: {} }] }));
  // Choosing the SAME type again must not wipe what was typed (2026-09-23: re-picking "Require a
  // heading" silently cleared its heading text). A different type starts from an empty config.
  const changeRuleType = (i, type) => setCfg((p) => ({ ...p, rules: p.rules.map((r, idx) => (idx === i && r.type !== type ? { ...r, type, config: {} } : r)) }));
  const updateRule = (i, patch) => setCfg((p) => ({ ...p, rules: p.rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  const updateRuleConfig = (i, patch) => setCfg((p) => ({ ...p, rules: p.rules.map((r, idx) => (idx === i ? { ...r, config: { ...r.config, ...patch } } : r)) }));
  const removeRule = (i) => setCfg((p) => ({ ...p, rules: p.rules.filter((_, idx) => idx !== i) }));

  const refusal = ruleListRefusal(cfg.rules);
  const save = async () => {
    if (refusal) { setMsg({ type: "error", text: refusal }); return; }
    setSaving(true);
    setMsg(null);
    try {
      // it16: surface a resolver rejection (returns { success:false, reason }) instead of a
      // blind "saved".
      const r = await invoke("store-validation-config", { scope, key: spaceKey, data: cfg });
      if (r?.success) { setSaved(JSON.stringify(cfg)); setMsg({ type: "success", text: "Validation rules saved." }); }
      else setMsg({ type: "error", text: r?.reason || "Could not save validation rules." });
    } catch (e) {
      setMsg({ type: "error", text: "Could not save validation rules." });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="settings-panel">Loading…</div>;
  const dirty = saved !== null && JSON.stringify(cfg) !== saved;
  const discard = () => { try { setCfg(JSON.parse(saved)); } catch (_) { /* keep */ } setMsg(null); };

  const scopeNote = scope === "space"
    ? "These rules apply to this space, on top of the organisation's required (blocking) global rules — which always apply. Your rules replace the advisory global rules; leave empty to inherit all global rules."
    : "Master switch. When on, pages are validated on create and edit against the rules below.";

  return (
    <div className="settings-panel">
      <SettingsRow label="Enable content validation" description={scopeNote}>
        <Toggle label="Enable content validation" checked={cfg.enabled} onChange={(e) => setCfg((p) => ({ ...p, enabled: e.target.checked }))} />
      </SettingsRow>

      <SettingsRow label="Enforcement" description="How non-compliant pages are handled. Forge runs after a page is saved, so enforcement is applied post-save.">
        <div className="val-modes">
          <label className="form-checkbox-inline">
            <input type="checkbox" checked={cfg.modes.advisory} onChange={(e) => setCfg((p) => ({ ...p, modes: { ...p.modes, advisory: e.target.checked } }))} />
            Flag with a comment (advisory)
          </label>
          <label className="form-checkbox-inline">
            <input type="checkbox" checked={cfg.modes.gate} onChange={(e) => setCfg((p) => ({ ...p, modes: { ...p.modes, gate: e.target.checked } }))} />
            Mark pass/fail status (gate)
          </label>
          <label className="form-checkbox-inline">
            <input type="checkbox" checked={cfg.modes.revert} onChange={(e) => setCfg((p) => ({ ...p, modes: { ...p.modes, revert: e.target.checked } }))} />
            Revert non-compliant edits (strict — can discard work)
          </label>
        </div>
      </SettingsRow>

      {scope === "space" && Array.isArray(globalRules) && globalRules.length > 0 && (() => {
        const blockCount = globalRules.filter((r) => r.severity === "block").length;
        const warnCount = globalRules.length - blockCount;
        if (cfg.rules.length === 0) {
          return <p className="settings-row-description" role="status">This space inherits all {globalRules.length} global rule(s). Add a rule to customise — your rules are added on top of the {blockCount} required global rule(s), which always apply.</p>;
        }
        return (
          <p className="settings-row-description" role="status">
            {blockCount > 0
              ? <>The <strong>{blockCount} required (blocking) global rule(s) always apply here</strong> — your rules below are added on top.{warnCount > 0 ? ` The ${warnCount} advisory global rule(s) are replaced by your rules.` : ""}</>
              : <>Your space rules replace the {warnCount} advisory global rule(s). Leave empty to inherit them.</>}
          </p>
        );
      })()}

      <div className="val-rules">
        <div className="val-rules-head">
          <span className="val-rules-title">Rules</span>
          <button className="btn-secondary" onClick={addRule}>+ Add rule</button>
        </div>
        {cfg.rules.length === 0 && (
          <p className="settings-row-description">No rules yet. Add one to start validating pages.</p>
        )}
        {cfg.rules.map((r, i) => {
          const problem = ruleConfigProblem(r);
          const num = (v) => (v === "" ? undefined : parseInt(v, 10));
          return (
          <div key={r.id} className={`val-rule-card${problem ? " val-rule-card-invalid" : ""}`} data-testid="val-rule-card">
            <div className="val-rule-row">
              <MiniSelect value={r.type} options={RULE_TYPES} onChange={(v) => changeRuleType(i, v)} />
              <MiniSelect value={r.severity} options={SEVERITY_OPTIONS} onChange={(v) => updateRule(i, { severity: v })} />
              <button className="val-rule-remove" onClick={() => removeRule(i)} title="Remove rule" aria-label="Remove rule">×</button>
            </div>
            <Field label="Name in reports" hint="Shown in the comment and the panel. It is not what the rule checks." wide>
              <input className="form-input" placeholder="e.g. Security section" value={r.label || ""} onChange={(e) => updateRule(i, { label: e.target.value })} />
            </Field>
            {r.type === "required-heading" && (
              <div className="val-rule-cfg">
                <Field label="Heading text must contain" hint="Any heading containing this text counts; case is ignored.">
                  <input className="form-input" placeholder="e.g. Security" value={r.config.text || ""} onChange={(e) => updateRuleConfig(i, { text: e.target.value })} />
                </Field>
                <Field label="Heading level (optional)" hint="1–6. Empty means any level.">
                  <input className="form-input" type="number" min="1" max="6" placeholder="Any" value={r.config.level ?? ""} onChange={(e) => updateRuleConfig(i, { level: num(e.target.value) })} />
                </Field>
              </div>
            )}
            {r.type === "required-table" && (
              <Field label="Minimum number of tables">
                <input className="form-input" type="number" min="1" value={r.config.minCount ?? 1} onChange={(e) => updateRuleConfig(i, { minCount: num(e.target.value) })} />
              </Field>
            )}
            {r.type === "required-macro" && (
              <div className="val-rule-cfg">
                <Field label="Macro key" hint="The macro's key, e.g. toc, info or jira.">
                  <input className="form-input" placeholder="e.g. toc" value={r.config.extensionKey || ""} onChange={(e) => updateRuleConfig(i, { extensionKey: e.target.value.trim() })} />
                </Field>
                <Field label="Minimum number">
                  <input className="form-input" type="number" min="1" value={r.config.minCount ?? 1} onChange={(e) => updateRuleConfig(i, { minCount: num(e.target.value) })} />
                </Field>
              </div>
            )}
            {r.type === "required-label" && (
              <Field label="Required labels" hint="Separate labels with commas. Every one must be on the page." wide>
                <LabelsInput labels={r.config.labels} onChange={(labels) => updateRuleConfig(i, { labels })} />
              </Field>
            )}
            {r.type === "max-length" && (
              <Field label="Maximum characters">
                <input className="form-input" type="number" min="1" value={r.config.maxChars ?? ""} onChange={(e) => updateRuleConfig(i, { maxChars: num(e.target.value) })} />
              </Field>
            )}
            {r.type === "min-length" && (
              <Field label="Minimum characters">
                <input className="form-input" type="number" min="1" value={r.config.minChars ?? ""} onChange={(e) => updateRuleConfig(i, { minChars: num(e.target.value) })} />
              </Field>
            )}
            {problem && <p className="val-rule-problem" role="alert" data-testid="val-rule-problem">{problem}</p>}
          </div>
          );
        })}
      </div>

      {/* Semantic AI Validations (Forge LLM — Runs on Atlassian) */}
      <div className="val-ai">
        <div className="val-rules-head">
          <span className="val-rules-title">Semantic AI Validations</span>
          <span className="val-ai-badge">Runs on Atlassian</span>
        </div>
        <p className="settings-row-description">
          AI review uses Atlassian-hosted Claude via Forge — no external API keys and no data egress.
          Token usage is billed to this app's Forge account, so AI is off by default and limited to Claude Haiku.
        </p>

        <SettingsRow label="Enable AI review" description="Allow on-demand AI content review from the Sentinel Vault panel ('Run AI review').">
          <Toggle label="Enable AI review" checked={cfg.ai.enabled} onChange={(e) => updateAi({ enabled: e.target.checked })} />
        </SettingsRow>

        {cfg.ai.enabled && (
          <div className="nested-control">
            <SettingsRow label="Model" description="Only Claude Haiku is offered to control token cost.">
              <MiniSelect
                value={cfg.ai.model}
                options={(aiModels.length ? aiModels : [cfg.ai.model]).map((m) => ({
                  value: m,
                  // it57: friendly label instead of the raw model id (e.g. "claude-haiku-4-5-20251001")
                  label: /haiku/i.test(m) ? "Claude Haiku (low cost)" : /sonnet/i.test(m) ? "Claude Sonnet" : /opus/i.test(m) ? "Claude Opus" : m,
                }))}
                onChange={(v) => updateAi({ model: v })}
              />
            </SettingsRow>
            <SettingsRow label="Custom rules" description="Plain-language rules the AI should check (one per line).">
              <textarea className="form-input val-textarea" rows={3} value={cfg.ai.rules} onChange={(e) => updateAi({ rules: e.target.value })} />
            </SettingsRow>
            <SettingsRow label="Style guide" description="Writing style the content should follow.">
              <textarea className="form-input val-textarea" rows={3} value={cfg.ai.styleGuide} onChange={(e) => updateAi({ styleGuide: e.target.value })} />
            </SettingsRow>
            <SettingsRow label="Tone / voice" description="Required tone or voice (e.g. formal, customer-friendly).">
              <textarea className="form-input val-textarea" rows={2} value={cfg.ai.tone} onChange={(e) => updateAi({ tone: e.target.value })} />
            </SettingsRow>
            <SettingsRow label="Compliance standards" description="Compliance or regulatory requirements to enforce.">
              <textarea className="form-input val-textarea" rows={2} value={cfg.ai.compliance} onChange={(e) => updateAi({ compliance: e.target.value })} />
            </SettingsRow>
            <SettingsRow label="Notify page author" description="Post a comment mentioning the author when findings meet the severity threshold.">
              <Toggle label="Notify page author" checked={cfg.ai.notifyAuthor} onChange={(e) => updateAi({ notifyAuthor: e.target.checked })} />
            </SettingsRow>
            <SettingsRow label="Severity threshold" description="Only notify for findings at or above this severity.">
              <MiniSelect value={cfg.ai.severityThreshold} options={SEVERITY_THRESHOLDS} onChange={(v) => updateAi({ severityThreshold: v })} />
            </SettingsRow>
            <SettingsRow label="Monthly token budget" description="Stop AI runs for the month once this many tokens are used. 0 = unlimited.">
              <input className="form-input" type="number" min="0" value={cfg.ai.monthlyTokenBudget} onChange={(e) => updateAi({ monthlyTokenBudget: parseInt(e.target.value) || 0 })} />
            </SettingsRow>
          </div>
        )}
      </div>

      {msg && <div role="status" aria-live="polite" className={msg.type === "success" ? "alert-success" : "alert-error"}>{msg.text}</div>}
      <UnsavedFloat dirty={dirty} busy={saving} onApply={save} onDiscard={discard} />
      {dirty && (
        <div className="val-save-bar" data-testid="val-save-bar">
          <span className="val-save-note">You have unsaved changes.</span>
          <button className="btn-secondary" onClick={discard} disabled={saving} data-testid="val-discard">Discard</button>
          <button className="btn-primary" onClick={save} disabled={saving} data-testid="val-save" title={refusal || undefined}>{saving ? "Saving…" : "Save validation rules"}</button>
        </div>
      )}
    </div>
  );
}
