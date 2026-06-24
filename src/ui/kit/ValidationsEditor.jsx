import React, { useState, useEffect } from "react";
import { invoke } from "@forge/bridge";

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

const Toggle = ({ checked, onChange }) => (
  <label className="form-checkbox">
    <input type="checkbox" checked={checked} onChange={onChange} />
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

const RULE_TYPES = [
  { value: "required-heading", label: "Require a heading" },
  { value: "required-table", label: "Require a table" },
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
  const [aiModels, setAiModels] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const r = await invoke("load-validation-config", { scope, key: spaceKey });
        if (r) {
          setCfg({
            enabled: !!r.enabled,
            modes: r.modes || { advisory: true, gate: false, revert: false },
            rules: r.rules || [],
            ai: { ...DEFAULT_AI, ...(r.ai || {}) },
          });
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
  const updateRule = (i, patch) => setCfg((p) => ({ ...p, rules: p.rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  const updateRuleConfig = (i, patch) => setCfg((p) => ({ ...p, rules: p.rules.map((r, idx) => (idx === i ? { ...r, config: { ...r.config, ...patch } } : r)) }));
  const removeRule = (i) => setCfg((p) => ({ ...p, rules: p.rules.filter((_, idx) => idx !== i) }));

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await invoke("store-validation-config", { scope, key: spaceKey, data: cfg });
      setMsg({ type: "success", text: "Validation rules saved." });
    } catch (e) {
      setMsg({ type: "error", text: "Could not save validation rules." });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="settings-panel">Loading…</div>;

  const scopeNote = scope === "space"
    ? "These rules apply to this space. If set, they override the global rules; leave empty to inherit global."
    : "Master switch. When on, pages are validated on create and edit against the rules below.";

  return (
    <div className="settings-panel">
      <SettingsRow label="Enable content validation" description={scopeNote}>
        <Toggle checked={cfg.enabled} onChange={(e) => setCfg((p) => ({ ...p, enabled: e.target.checked }))} />
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

      <div className="val-rules">
        <div className="val-rules-head">
          <span className="val-rules-title">Rules</span>
          <button className="btn-secondary" onClick={addRule}>+ Add rule</button>
        </div>
        {cfg.rules.length === 0 && (
          <p className="settings-row-description">No rules yet. Add one to start validating pages.</p>
        )}
        {cfg.rules.map((r, i) => (
          <div key={r.id} className="val-rule-card">
            <div className="val-rule-row">
              <MiniSelect value={r.type} options={RULE_TYPES} onChange={(v) => updateRule(i, { type: v, config: {} })} />
              <MiniSelect value={r.severity} options={SEVERITY_OPTIONS} onChange={(v) => updateRule(i, { severity: v })} />
              <button className="val-rule-remove" onClick={() => removeRule(i)} title="Remove rule">×</button>
            </div>
            <input className="form-input" placeholder="Label (shown in the report)" value={r.label || ""} onChange={(e) => updateRule(i, { label: e.target.value })} />
            {r.type === "required-heading" && (
              <div className="val-rule-cfg">
                <input className="form-input" placeholder="Heading text contains (optional)" value={r.config.text || ""} onChange={(e) => updateRuleConfig(i, { text: e.target.value })} />
                <input className="form-input" type="number" placeholder="Level 1-6 (optional)" value={r.config.level || ""} onChange={(e) => updateRuleConfig(i, { level: e.target.value ? parseInt(e.target.value) : undefined })} />
              </div>
            )}
            {r.type === "required-table" && (
              <input className="form-input" type="number" placeholder="Minimum tables" value={r.config.minCount || 1} onChange={(e) => updateRuleConfig(i, { minCount: parseInt(e.target.value) || 1 })} />
            )}
            {r.type === "required-label" && (
              <input className="form-input" placeholder="Required labels (comma-separated)" value={(r.config.labels || []).join(", ")} onChange={(e) => updateRuleConfig(i, { labels: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            )}
            {r.type === "max-length" && (
              <input className="form-input" type="number" placeholder="Max characters" value={r.config.maxChars || ""} onChange={(e) => updateRuleConfig(i, { maxChars: parseInt(e.target.value) || 0 })} />
            )}
            {r.type === "min-length" && (
              <input className="form-input" type="number" placeholder="Min characters" value={r.config.minChars || ""} onChange={(e) => updateRuleConfig(i, { minChars: parseInt(e.target.value) || 0 })} />
            )}
          </div>
        ))}
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
          <Toggle checked={cfg.ai.enabled} onChange={(e) => updateAi({ enabled: e.target.checked })} />
        </SettingsRow>

        {cfg.ai.enabled && (
          <div className="nested-control">
            <SettingsRow label="Model" description="Only Claude Haiku is offered to control token cost.">
              <MiniSelect
                value={cfg.ai.model}
                options={(aiModels.length ? aiModels : [cfg.ai.model]).map((m) => ({ value: m, label: m }))}
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
              <Toggle checked={cfg.ai.notifyAuthor} onChange={(e) => updateAi({ notifyAuthor: e.target.checked })} />
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

      {msg && <div className={msg.type === "success" ? "alert-success" : "alert-error"}>{msg.text}</div>}
      <div className="action-bar">
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save validation rules"}</button>
      </div>
    </div>
  );
}
