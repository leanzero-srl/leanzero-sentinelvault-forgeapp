import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { invoke, view } from "@forge/bridge";
import { enablePaletteSync } from "../../kit/palette-sync";
import logo from "../../assets/icons/icon.png";

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

// Custom dropdown (the app never uses native <select>).
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
            <div
              key={o.value}
              className={`mini-select-opt ${o.value === value ? "sel" : ""}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
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

// Conditions & Validations authoring tab (global scope). Self-contained: loads
// and saves validation config independently of the general/alerts settings.
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

const ValidationsTab = () => {
  const [cfg, setCfg] = useState({ enabled: false, modes: { advisory: true, gate: false, revert: false }, rules: [], ai: { ...DEFAULT_AI } });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [aiModels, setAiModels] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const r = await invoke("load-validation-config", { scope: "global" });
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
  }, []);

  const updateAi = (patch) => setCfg((p) => ({ ...p, ai: { ...p.ai, ...patch } }));

  const addRule = () => setCfg((p) => ({ ...p, rules: [...p.rules, { id: `r${Date.now()}`, type: "required-heading", label: "", severity: "warn", config: {} }] }));
  const updateRule = (i, patch) => setCfg((p) => ({ ...p, rules: p.rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  const updateRuleConfig = (i, patch) => setCfg((p) => ({ ...p, rules: p.rules.map((r, idx) => (idx === i ? { ...r, config: { ...r.config, ...patch } } : r)) }));
  const removeRule = (i) => setCfg((p) => ({ ...p, rules: p.rules.filter((_, idx) => idx !== i) }));

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await invoke("store-validation-config", { scope: "global", data: cfg });
      setMsg({ type: "success", text: "Validation rules saved." });
    } catch (e) {
      setMsg({ type: "error", text: "Could not save validation rules." });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="settings-panel">Loading…</div>;

  return (
    <div className="settings-panel">
      <SettingsRow label="Enable content validation" description="Master switch. When on, pages are validated on create and edit against the rules below.">
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
};

const GlobalPolicyEditor = () => {
  const [activeTab, setActiveTab] = useState("general");
  const [settings, setSettings] = useState({
    defaultSealDurationHours: 24,
    allowStewardOverride: false,
    autoUnsealEnabled: true,
    allowArtifactDelete: false,
    allowSealRestore: false,
    allowSealPurge: false,
    enableContentProtection: true,
    reminderIntervalDays: 7,
    enableFlashMessages: true,
    enableDocRibbons: true,
    enableConfluenceDispatches: true,
    enableEmailDispatches: true,
    enableSealExpiryReminderEmail: true,
    enableAutoUnsealDispatchEmail: true,
    enablePeriodicReminderEmail: true,
    globalAutoInsertMacro: false,
    replaceAttachmentsMacro: false,
  });

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [messageType, setMessageType] = useState(null);
  const [currentRealmKey, setCurrentRealmKey] = useState(null);
  const [currentRealmName, setCurrentRealmName] = useState("Current Realm");

  useEffect(() => {
    const fetchPreferences = async () => {
      try {
        await enablePaletteSync();

        setLoading(true);
        setMessage(null);
        setMessageType(null);

        const globalSettings = await invoke("load-policy", {
          scope: "global",
        });

        const context = await view.getContext();
        const realmKey = context.extension?.content?.space?.key;

        if (realmKey) {
          setCurrentRealmKey(realmKey);
          setCurrentRealmName(
            context.extension.content.space?.name || "Current Realm",
          );
        }

        setSettings({
          defaultSealDurationHours: Math.round(
            (globalSettings?.defaultSealDuration || 86400) / 3600,
          ),
          allowStewardOverride: globalSettings?.allowStewardOverride || false,
          autoUnsealEnabled: globalSettings?.autoUnsealEnabled !== false,
          allowArtifactDelete: globalSettings?.allowArtifactDelete === true,
          allowSealRestore: globalSettings?.allowSealRestore === true,
          allowSealPurge: globalSettings?.allowSealPurge === true,
          enableContentProtection: globalSettings?.enableContentProtection !== false,
          reminderIntervalDays: globalSettings?.reminderIntervalDays || 7,
          enableFlashMessages:
            globalSettings?.enableFlashMessages !== false,
          enableDocRibbons: globalSettings?.enableDocRibbons !== false,
          enableConfluenceDispatches:
            globalSettings?.enableConfluenceDispatches !== false,
          enableEmailDispatches:
            globalSettings?.enableEmailDispatches !== false,
          enableSealExpiryReminderEmail:
            globalSettings?.enableSealExpiryReminderEmail !== false,
          enableAutoUnsealDispatchEmail:
            globalSettings?.enableAutoUnsealDispatchEmail !== false,
          enablePeriodicReminderEmail:
            globalSettings?.enablePeriodicReminderEmail !== false,
          globalAutoInsertMacro:
            globalSettings?.globalAutoInsertMacro === true,
          replaceAttachmentsMacro:
            globalSettings?.replaceAttachmentsMacro === true,
        });
      } catch (err) {
        setMessage(
          "Unable to load preferences. Verify your access rights.",
        );
        setMessageType("error");
      } finally {
        setLoading(false);
      }
    };

    fetchPreferences();
  }, []);

  const onSavePreferences = async () => {
    try {
      setLoading(true);
      setMessage(null);
      setMessageType(null);

      await invoke("store-policy", {
        scope: "global",
        data: {
          defaultSealDuration: settings.defaultSealDurationHours * 3600,
          allowStewardOverride: settings.allowStewardOverride,
          autoUnsealEnabled: settings.autoUnsealEnabled,
          allowArtifactDelete: settings.allowArtifactDelete,
          allowSealRestore: settings.allowSealRestore,
          allowSealPurge: settings.allowSealPurge,
          enableContentProtection: settings.enableContentProtection,
          reminderIntervalDays: settings.reminderIntervalDays,
          enableFlashMessages: settings.enableFlashMessages,
          enableDocRibbons: settings.enableDocRibbons,
          enableConfluenceDispatches: settings.enableConfluenceDispatches,
          enableEmailDispatches: settings.enableEmailDispatches,
          enableSealExpiryReminderEmail: settings.enableSealExpiryReminderEmail,
          enableAutoUnsealDispatchEmail:
            settings.enableAutoUnsealDispatchEmail,
          enablePeriodicReminderEmail: settings.enablePeriodicReminderEmail,
          globalAutoInsertMacro: settings.globalAutoInsertMacro,
          replaceAttachmentsMacro: settings.replaceAttachmentsMacro,
        },
      });

      setMessage("Preferences updated successfully!");
      setMessageType("success");
    } catch (err) {
      setMessage(
        "Unable to save preferences. Verify your access rights.",
      );
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <h2 className="loading-title">Preparing Settings</h2>
        <p className="loading-text">
          Retrieving system preferences...
        </p>
      </div>
    );
  }

  return (
    <div className="admin-container">
      <div className="admin-header">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <img
            src={logo}
            alt="Sentinel Vault Logo"
            style={{ height: "32px", width: "auto" }}
          />
          <div>
            <h1 className="admin-title">System-Wide Preferences</h1>
            <p className="admin-subtitle">
              Manage global preferences for Sentinel Vault across every
              realm
            </p>
          </div>
        </div>
      </div>

      {message && (
        <div
          className={
            messageType === "success" ? "alert-success" : "alert-error"
          }
        >
          {message}
        </div>
      )}

      {/* Tab Navigation */}
      <div className="tab-navigation">
        <button
          className={`tab-button ${activeTab === "general" ? "active" : ""}`}
          onClick={() => setActiveTab("general")}
        >
          General
        </button>
        <button
          className={`tab-button ${activeTab === "alerts" ? "active" : ""}`}
          onClick={() => setActiveTab("alerts")}
        >
          Alerts
        </button>
        <button
          className={`tab-button ${activeTab === "validations" ? "active" : ""}`}
          onClick={() => setActiveTab("validations")}
        >
          Validations
        </button>
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {activeTab === "general" && (
          <div className="settings-panel">
            <SettingsRow
              label="Default Seal Duration"
              description="How long attachments stay sealed by default (minimum 1 hour). Individual realms can override this with their own duration."
            >
              <div className="input-with-unit">
                <input
                  className="form-input"
                  type="number"
                  value={settings.defaultSealDurationHours}
                  onChange={(e) => {
                    const value = parseInt(e.target.value);
                    if (!isNaN(value)) {
                      setSettings((prev) => ({
                        ...prev,
                        defaultSealDurationHours: Math.max(1, value),
                      }));
                    }
                  }}
                  min="1"
                />
                <span className="input-unit">hrs</span>
              </div>
            </SettingsRow>

            <SettingsRow
              label="Allow Steward Force-Unseal"
              description="Allow stewards to unseal attachments that were sealed by other users."
            >
              <Toggle
                checked={settings.allowStewardOverride}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    allowStewardOverride: e.target.checked,
                  }))
                }
              />
            </SettingsRow>

            <SettingsRow
              label="Enable Seal Expiry Notifications"
              description={
                settings.autoUnsealEnabled
                  ? "Users will receive notifications when their seals expire, reminding them to unseal attachments. Attachments are not unsealed automatically."
                  : "Attachments stay sealed until manually unsealed. Seal timers will show 'Overdue' once the seal duration has passed."
              }
            >
              <Toggle
                checked={settings.autoUnsealEnabled}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    autoUnsealEnabled: e.target.checked,
                  }))
                }
              />
            </SettingsRow>

            <SettingsRow
              label="Allow Attachment Removal from Page"
              description="When enabled, users can delete unsealed attachments directly from the Sentinel Vault panel in the page banner. Deleted attachments are moved to the trash and can be recovered. Sealed attachments cannot be deleted."
            >
              <Toggle
                checked={settings.allowArtifactDelete}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    allowArtifactDelete: e.target.checked,
                  }))
                }
              />
            </SettingsRow>

            <SettingsRow
              label="Allow Attachment Restore from Page"
              description="When enabled, users and stewards can restore trashed attachments that still have seal data in Sentinel Vault. Permanently deleted attachments cannot be restored."
            >
              <Toggle
                checked={settings.allowSealRestore}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    allowSealRestore: e.target.checked,
                  }))
                }
              />
            </SettingsRow>

            <SettingsRow
              label="Allow Seal Cleanup from Page"
              description="When enabled, users and stewards can remove leftover seal entries for attachments that have been deleted from the page. This cleans up seal data that is no longer needed."
            >
              <Toggle
                checked={settings.allowSealPurge}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    allowSealPurge: e.target.checked,
                  }))
                }
              />
            </SettingsRow>

            <SettingsRow
              label="Protect Sealed Attachments in Page Body"
              description="Automatically undo page edits that remove sealed attachments embedded in the page content (such as images or files inserted into the body)."
            >
              <Toggle
                checked={settings.enableContentProtection}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    enableContentProtection: e.target.checked,
                  }))
                }
              />
            </SettingsRow>

            <SettingsRow
              label="Auto-Insert Macro on Seal"
              description="When enabled, the Sentinel Vault panel macro is automatically inserted into the page when an attachment is sealed. Individual realms can still disable this in their own settings. When disabled, no auto-insertion happens regardless of realm settings."
            >
              <Toggle
                checked={settings.globalAutoInsertMacro}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    globalAutoInsertMacro: e.target.checked,
                  }))
                }
              />
            </SettingsRow>

            {settings.globalAutoInsertMacro && (
              <div className="nested-control">
                <SettingsRow
                  label="Replace Attachments Macro"
                  description="When inserting the Sentinel Vault panel, replace the built-in Confluence Attachments macro instead of adding the panel alongside it. If no Attachments macro is found on the page, the panel is inserted at the position configured in realm settings."
                >
                  <Toggle
                    checked={settings.replaceAttachmentsMacro}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        replaceAttachmentsMacro: e.target.checked,
                      }))
                    }
                  />
                </SettingsRow>
              </div>
            )}

            {!settings.autoUnsealEnabled && (
              <SettingsRow
                label="Reminder Frequency"
                description={`Users receive a reminder email every ${settings.reminderIntervalDays} day${settings.reminderIntervalDays === 1 ? "" : "s"} about attachments they have sealed. This helps prevent forgotten seals when automatic expiry notifications are turned off.`}
              >
                <div className="input-with-unit">
                  <input
                    className="form-input"
                    type="number"
                    value={settings.reminderIntervalDays}
                    onChange={(e) => {
                      const value = parseInt(e.target.value);
                      if (!isNaN(value)) {
                        setSettings((prev) => ({
                          ...prev,
                          reminderIntervalDays: Math.max(1, value),
                        }));
                      }
                    }}
                    min="1"
                  />
                  <span className="input-unit">days</span>
                </div>
              </SettingsRow>
            )}
          </div>
        )}

        {activeTab === "alerts" && (
          <div className="settings-panel">
            <SettingsRow
              label="Enable Pop-up Notifications"
              description="Show brief pop-up notifications on the page when attachments are sealed, unsealed, or when someone attempts unauthorized access."
            >
              <Toggle
                checked={settings.enableFlashMessages}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    enableFlashMessages: e.target.checked,
                  }))
                }
              />
            </SettingsRow>

            <SettingsRow
              label="Enable Page Status Banners"
              description="Display a status banner at the top of Confluence pages when attachments are sealed. The banner shows which attachments are sealed and when each seal expires."
            >
              <Toggle
                checked={settings.enableDocRibbons}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    enableDocRibbons: e.target.checked,
                  }))
                }
              />
            </SettingsRow>

            <SettingsRow
              label="Enable Page Comments"
              description="Post a Confluence comment on the page when attachments are sealed, unsealed, or when someone attempts unauthorized access. Comments appear in the page's comment section."
            >
              <Toggle
                checked={settings.enableConfluenceDispatches}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    enableConfluenceDispatches: e.target.checked,
                  }))
                }
              />
            </SettingsRow>

            <SettingsRow
              label="Enable Native Notifications"
              description="Notify users by posting a Confluence comment that @mentions them. Confluence's own notification engine then emails the user according to their personal notification settings. This is the master switch — it must be on for any of the options below to work."
            >
              <Toggle
                checked={settings.enableEmailDispatches}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    enableEmailDispatches: e.target.checked,
                  }))
                }
              />
            </SettingsRow>

            {settings.enableEmailDispatches && (
              <div className="nested-control">
                <SettingsRow
                  label="Seal Confirmation & Halfway Reminder Notices"
                  description="Post a comment that mentions the seal owner when a seal is created and when it reaches its midpoint."
                >
                  <Toggle
                    checked={settings.enableSealExpiryReminderEmail}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        enableSealExpiryReminderEmail: e.target.checked,
                      }))
                    }
                  />
                </SettingsRow>

                <SettingsRow
                  label="Seal Expiry Notices"
                  description="Post a comment that mentions the seal owner when one of their seals has expired, prompting them to release it."
                >
                  <Toggle
                    checked={settings.enableAutoUnsealDispatchEmail}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        enableAutoUnsealDispatchEmail: e.target.checked,
                      }))
                    }
                  />
                </SettingsRow>

                <SettingsRow
                  label="Recurring Reminder Banners"
                  description="Show a recurring banner on pages with long-held seals when automatic expiry is disabled. Frequency is controlled by the Reminder Frequency setting in the General tab. (No comment is posted to avoid page clutter.)"
                >
                  <Toggle
                    checked={settings.enablePeriodicReminderEmail}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        enablePeriodicReminderEmail: e.target.checked,
                      }))
                    }
                  />
                </SettingsRow>
              </div>
            )}
          </div>
        )}

        {activeTab === "validations" && <ValidationsTab />}
      </div>

      {activeTab !== "validations" && (
        <div className="action-bar">
          <button className="btn-primary" onClick={onSavePreferences} disabled={loading}>
            {loading ? "Updating..." : "Apply Configuration"}
          </button>
        </div>
      )}
    </div>
  );
};

const RootFrame = () => {
  return <GlobalPolicyEditor />;
};

const container = document.getElementById("root");
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <RootFrame />
  </React.StrictMode>,
);
