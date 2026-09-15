import React, { useState, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { invoke, view } from "@forge/bridge";
import { enablePaletteSync } from "../../kit/palette-sync";
import ValidationsEditor from "../../kit/ValidationsEditor";
import LicenseBanner from "../../kit/LicenseBanner";
import ClassificationTab from "../../kit/ClassificationTab";
import { formatDurationHours } from "../../kit/format-duration";
import logo from "../../assets/icons/icon.png";
import { BUILD_INFO } from "../../../build-info.js";
// P2 (UX review 2026-09-14 §3): the console renders FROM the schema — keys, labels, one-line
// descriptions, engine defaults and the dependency table all live in settings-schema.js, which
// reads its defaults from the same baseline.js the engine reads. No second copy here.
import {
  GROUPS, controlsFor, control, readAllEffective, formatDefault, dependencyState,
  SEAL_DURATION_PRESETS, ALERT_PROFILES, buildSetupPayload, needsSetup,
} from "../../../server/capsules/policies/settings-schema.js";

const Toggle = ({ checked, onChange, disabled, label }) => (
  <label className={`form-checkbox${disabled ? " is-disabled" : ""}`}>
    <input type="checkbox" aria-label={label} checked={checked} onChange={onChange} disabled={disabled} />
  </label>
);

// 5.0 ribbon mode — a two-option choice drawn by the app (never a native <select>): each option is
// a solid block when chosen, an outlined one otherwise, with its one-line description under the name.
const RIBBON_MODE_OPTIONS = [
  { id: "exceptions", name: "Exceptions only", text: "The ribbon opens only when the page is classified at or above the threshold, something is waiting on the viewer, the viewer hits a seal they do not own, or a change was reverted." },
  { id: "always", name: "Always show classification", text: "The classification block is always visible on every page; the right half stays empty until something is urgent." },
];
const ChoiceBlocks = ({ value, onChange, options, ariaLabel, testPrefix, disabled, minWidth = 320 }) => (
  <div role="radiogroup" aria-label={ariaLabel} className="sv-choice-blocks" style={{ minWidth, maxWidth: 420 }} data-testid={`${testPrefix}-choice`}>
    {options.map((o) => {
      const on = value === o.id;
      return (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={on}
          disabled={disabled}
          onClick={() => onChange(o.id)}
          data-testid={`${testPrefix}-${o.id}`}
          className={`sv-choice-block${on ? " is-on" : ""}`}
        >
          <span className="sv-choice-name">{o.name}</span>
          {o.text && <span className="sv-choice-text">{o.text}</span>}
        </button>
      );
    })}
  </div>
);

/** Depth of a control under parents of the SAME scope (a space child of a global master stays at 0). */
const depthOf = (key) => {
  let d = 0;
  let c = control(key);
  while (c && c.parent) {
    const p = control(c.parent);
    if (!p || p.scope !== c.scope) break;
    d++;
    c = p;
  }
  return d;
};

/**
 * One control, rendered from its descriptor: label, the one-line "what happens when this is on",
 * the effective default the engine applies when the key is unset, and the input. A control with
 * a parent is indented under it and DISABLED with the reason while the parent is off — visibly
 * dependent, never silently inert.
 */
export const ControlRow = ({ desc, values, siteValues, onChange, children, siteDefaultText }) => {
  const dep = dependencyState(desc.key, values, siteValues);
  const depth = depthOf(desc.key);
  const val = values[desc.key];
  const set = (v) => onChange(desc.key, v);
  const disabled = !dep.enabled;
  let input = children;
  if (!input) {
    switch (desc.kind) {
      case "toggle":
        input = <Toggle label={desc.label} checked={!!val} disabled={disabled} onChange={(e) => set(e.target.checked)} />;
        break;
      case "seconds-as-hours": {
        const hours = Math.max(1, Math.round((val || desc.default) / 3600));
        input = (
          <div className="input-with-unit">
            <input className="form-input" type="number" min="1" value={hours} disabled={disabled} aria-label={desc.label}
              onChange={(e) => { const n = parseInt(e.target.value, 10); if (!isNaN(n)) set(Math.max(1, n) * 3600); }} />
            <span className="input-unit">hrs</span>
            {hours >= 24 && <span className="input-hint">= {formatDurationHours(hours)}</span>}
          </div>
        );
        break;
      }
      case "hours":
      case "days":
      case "count": {
        const unit = desc.kind === "hours" ? "hrs" : desc.kind === "days" ? "days" : desc.key === "ribbonThresholdRank" ? "rank" : "";
        input = (
          <div className="input-with-unit">
            <input className="form-input" type="number" min={desc.min ?? 0} max={desc.max} value={val ?? ""} disabled={disabled} aria-label={desc.label}
              data-testid={desc.key === "ribbonThresholdRank" ? "ribbon-threshold-rank" : undefined}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (isNaN(n)) return;
                let v = n;
                if (desc.min !== undefined) v = Math.max(desc.min, v);
                if (desc.max !== undefined) v = Math.min(desc.max, v);
                set(v);
              }} />
            {unit && <span className="input-unit">{unit}</span>}
          </div>
        );
        break;
      }
      case "choice":
        if (desc.key === "ribbonMode") input = <ChoiceBlocks value={val} onChange={set} options={RIBBON_MODE_OPTIONS} ariaLabel="Ribbon mode" testPrefix="ribbon-mode" disabled={disabled} />;
        break;
      default:
        input = null;
    }
  }
  return (
    <div
      className={`settings-row${depth > 0 ? ` is-dependent depth-${depth}` : ""}${disabled ? " is-locked" : ""}`}
      data-testid={`sv-row-${desc.key}`}
      data-locked={disabled ? "true" : "false"}
    >
      <div className="settings-row-info">
        <p className="settings-row-label">{desc.label}</p>
        <p className="settings-row-description">{desc.text}</p>
        <p className="settings-row-default" data-testid={`sv-default-${desc.key}`}>
          <span>Effective default:</span> {formatDefault(desc.key)}
          {siteDefaultText && <><span className="settings-row-default-sep">·</span><span>Site default:</span> {siteDefaultText}</>}
        </p>
        {disabled && <p className="settings-row-reason" data-testid={`sv-reason-${desc.key}`}>{dep.reason}</p>}
      </div>
      <div className="settings-row-control">{input}</div>
    </div>
  );
};

/** A group card: solid header (name + one line), then its rows. */
export const GroupCard = ({ group, children, extra }) => (
  <section className="sv-group" data-testid={`sv-group-${group.id}`}>
    <header className="sv-group-head">
      <h3 className="sv-group-title">{group.name}</h3>
      <p className="sv-group-text">{group.text}</p>
    </header>
    <div className="sv-group-body">{children}{extra}</div>
  </section>
);

// ── First-run setup ────────────────────────────────────────────────────────────────────────

const PROVIDER_TEXT = {
  native: "Using your site's Confluence classification levels. Levels are managed in Confluence's own classification settings; Sentinel Vault reads them.",
  app: "Using Sentinel Vault's built-in levels (Public, Internal, Confidential, Restricted). You can rename, recolour, add or remove them later in the Classification tab.",
};

const SetupWizard = ({ onFinished, onSkipped, initialHours }) => {
  const [step, setStep] = useState(1);
  const [preset, setPreset] = useState("1w");
  const [customHours, setCustomHours] = useState(initialHours || 48);
  const [profile, setProfile] = useState("standard");
  const [provider, setProvider] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    invoke("classification-provider", {})
      .then((r) => setProvider(r?.name === "native" ? "native" : "app"))
      .catch(() => setProvider("app"));
  }, []);

  const hours = preset === "custom" ? Number(customHours) : SEAL_DURATION_PRESETS.find((p) => p.id === preset)?.hours;

  const write = async (data) => {
    setBusy(true); setError(null);
    try {
      const r = await invoke("store-policy", { scope: "global", data });
      if (!r?.success) { setError(r?.reason || "Could not save the setup."); return false; }
      return true;
    } catch (e) {
      setError("Could not save the setup. Verify your access rights.");
      return false;
    } finally { setBusy(false); }
  };

  const finish = async () => {
    const payload = buildSetupPayload({ hours, profile });
    if (!payload.ok) { setError(payload.reason); return; }
    if (await write(payload.data)) onFinished(payload.data);
  };
  const skip = async () => {
    const stamp = new Date().toISOString();
    if (await write({ setupCompletedAt: stamp })) onSkipped(stamp);
  };

  return (
    <div className="sv-setup" data-testid="sv-setup">
      <div className="sv-setup-steps" aria-label="Setup progress">
        {[1, 2, 3].map((n) => (
          <span key={n} className={`sv-setup-step${step === n ? " is-current" : step > n ? " is-done" : ""}`} data-testid={`sv-setup-step-${n}`}>
            <span className="sv-setup-step-num">{n}</span>
            {n === 1 ? "Seal duration" : n === 2 ? "Alerts" : "Classification"}
          </span>
        ))}
      </div>

      {error && <div className="alert-error sv-setup-alert" data-testid="sv-setup-error">{error}</div>}

      {step === 1 && (
        <div className="sv-setup-panel" data-testid="sv-setup-panel-1">
          <h2 className="sv-setup-title">How long should a seal last?</h2>
          <p className="sv-setup-text">A seal keeps an attachment from being replaced or removed until it runs out or its owner releases it. Spaces can set their own duration later.</p>
          <div className="sv-preset-grid" role="radiogroup" aria-label="Default seal duration">
            {SEAL_DURATION_PRESETS.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={preset === p.id}
                className={`sv-preset${preset === p.id ? " is-on" : ""}`} data-testid={`sv-setup-duration-${p.id}`}
                onClick={() => setPreset(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
          {preset === "custom" && (
            <div className="input-with-unit sv-setup-custom">
              <input className="form-input" type="number" min="1" value={customHours} aria-label="Custom seal duration in hours" data-testid="sv-setup-custom-hours"
                onChange={(e) => { const n = parseInt(e.target.value, 10); if (!isNaN(n)) setCustomHours(Math.max(1, n)); }} />
              <span className="input-unit">hrs</span>
              {Number(customHours) >= 24 && <span className="input-hint">= {formatDurationHours(Number(customHours))}</span>}
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="sv-setup-panel" data-testid="sv-setup-panel-2">
          <h2 className="sv-setup-title">How loud should Sentinel Vault be?</h2>
          <p className="sv-setup-text">The app sends no email. A notice is a comment on the page that @mentions the people involved; Confluence then notifies them. Pop-ups and the page ribbon are always on.</p>
          <ChoiceBlocks value={profile} onChange={setProfile} options={ALERT_PROFILES} ariaLabel="Alert profile" testPrefix="sv-setup-profile" minWidth={0} />
        </div>
      )}

      {step === 3 && (
        <div className="sv-setup-panel" data-testid="sv-setup-panel-3">
          <h2 className="sv-setup-title">Where do classification levels come from?</h2>
          <p className="sv-setup-text">Sentinel Vault labels pages with a classification level and can open the ribbon for the sensitive ones. It detects the source on its own.</p>
          <div className="sv-provider" data-testid="sv-setup-provider" data-provider={provider || "detecting"}>
            <span className={`sv-provider-badge ${provider || "detecting"}`}>{provider === "native" ? "Native" : provider === "app" ? "App" : "Detecting…"}</span>
            <p className="sv-provider-text">{provider ? PROVIDER_TEXT[provider] : "Checking whether this site has Confluence classification levels…"}</p>
          </div>
          <dl className="sv-provider-legend">
            <dt>Native</dt><dd>The site has defined Confluence classification levels. They apply everywhere and Sentinel Vault follows them.</dd>
            <dt>App</dt><dd>The site has none, so the app's own four levels are used and stored on each page as a content property.</dd>
          </dl>
        </div>
      )}

      <div className="sv-setup-actions">
        <button type="button" className="sv-link" onClick={skip} disabled={busy} data-testid="sv-setup-skip">Skip setup</button>
        <span className="sv-setup-spacer" />
        {step > 1 && <button type="button" className="btn-secondary" onClick={() => setStep(step - 1)} disabled={busy} data-testid="sv-setup-back">Back</button>}
        {step < 3 && <button type="button" className="btn-primary" onClick={() => setStep(step + 1)} disabled={busy || (step === 1 && !(Number(hours) >= 1))} data-testid="sv-setup-next">Next</button>}
        {step === 3 && <button type="button" className="btn-primary" onClick={finish} disabled={busy} data-testid="sv-setup-finish">{busy ? "Saving…" : "Finish"}</button>}
      </div>
    </div>
  );
};

// ── The console ────────────────────────────────────────────────────────────────────────────

const GlobalPolicyEditor = () => {
  const [activeTab, setActiveTab] = useState("settings");
  const [values, setValues] = useState(() => readAllEffective("global", null));
  const [setupDone, setSetupDone] = useState(true);
  const [rerunSetup, setRerunSetup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [messageType, setMessageType] = useState(null);

  const applyRecord = (rec) => {
    setValues(readAllEffective("global", rec));
    setSetupDone(!needsSetup(rec));
  };

  useEffect(() => {
    const fetchPreferences = async () => {
      try {
        await enablePaletteSync();
        setLoading(true);
        setMessage(null);
        setMessageType(null);
        const globalSettings = await invoke("load-policy", { scope: "global" });
        await view.getContext().catch(() => null);
        applyRecord(globalSettings);
      } catch (err) {
        setMessage("Unable to load preferences. Verify your access rights.");
        setMessageType("error");
      } finally {
        setLoading(false);
      }
    };
    fetchPreferences();
  }, []);

  const onChange = (key, v) => setValues((prev) => ({ ...prev, [key]: v }));

  const onSavePreferences = async () => {
    try {
      setLoading(true);
      setMessage(null);
      setMessageType(null);
      // Every key the schema owns, under its persisted name — `values` is already keyed by them.
      const data = {};
      for (const c of controlsFor("global")) data[c.key] = values[c.key];
      const saveResult = await invoke("store-policy", { scope: "global", data });
      // it16: store-policy returns { success:false, reason } on an authz denial (audit A1)
      // rather than throwing — a blind success message would falsely claim the save persisted.
      if (saveResult?.success) {
        setMessage("Preferences updated successfully!");
        setMessageType("success");
      } else {
        setMessage(saveResult?.reason || "Unable to save preferences. Verify your access rights.");
        setMessageType("error");
      }
    } catch (err) {
      setMessage("Unable to save preferences. Verify your access rights.");
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  };

  const groupRows = useMemo(() => Object.fromEntries(GROUPS.map((g) => [g.id, controlsFor("global", g.id)])), []);

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <h2 className="loading-title">Preparing Settings</h2>
        <p className="loading-text">Retrieving system preferences...</p>
      </div>
    );
  }

  const showSetup = !setupDone || rerunSetup;

  return (
    // data-sv-build: deploy-staleness stamp (webpack inlines BUILD_INFO at build time) — lets the
    // harness assert the SERVED frontend matches the deployed backend (`what=version`), the it26 trap.
    <div className="admin-container" data-sv-build={BUILD_INFO.gitSha}>
      <div className="admin-header">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <img src={logo} alt="Sentinel Vault Logo" style={{ height: "32px", width: "auto" }} />
          <div>
            <h1 className="admin-title">Sentinel Vault — Site settings</h1>
            <p className="admin-subtitle">
              {showSetup ? "Three questions to get started. Everything can be changed later." : "Manage global preferences for Sentinel Vault across every space"}
            </p>
          </div>
        </div>
      </div>

      <LicenseBanner />

      {message && (
        <div className={messageType === "success" ? "alert-success" : "alert-error"}>{message}</div>
      )}

      {showSetup ? (
        <SetupWizard
          initialHours={Math.round((values.defaultLockDuration || 0) / 3600)}
          onFinished={(data) => {
            setValues((prev) => ({ ...prev, ...readAllEffective("global", { ...prev, ...data }) }));
            setSetupDone(true); setRerunSetup(false);
            setMessage("Setup complete. You can fine-tune everything below."); setMessageType("success");
          }}
          onSkipped={() => { setSetupDone(true); setRerunSetup(false); }}
        />
      ) : (
        <>
          {/* Tab Navigation */}
          <div className="tab-navigation">
            <button className={`tab-button ${activeTab === "settings" ? "active" : ""}`} onClick={() => setActiveTab("settings")} data-testid="tab-settings">
              Settings
            </button>
            <button className={`tab-button ${activeTab === "validations" ? "active" : ""}`} onClick={() => setActiveTab("validations")} data-testid="tab-validations">
              Validations
            </button>
            <button className={`tab-button ${activeTab === "classification" ? "active" : ""}`} onClick={() => setActiveTab("classification")} data-testid="tab-classification">
              Classification
            </button>
          </div>

          {/* Tab Content */}
          <div className="tab-content">
            {activeTab === "settings" && (
              <div className="settings-panel sv-groups">
                {GROUPS.map((g) => (
                  <GroupCard
                    key={g.id}
                    group={g}
                    extra={g.id === "advanced" && (
                      <>
                        <div className="settings-row" data-testid="sv-row-validations-link">
                          <div className="settings-row-info">
                            <p className="settings-row-label">Content rules and AI review</p>
                            <p className="settings-row-description">Required headings, tables, labels and length limits, plus the optional AI review with its model, prompts and monthly budget. Each has its own switch and saves on its own tab.</p>
                          </div>
                          <div className="settings-row-control">
                            <button type="button" className="btn-secondary" onClick={() => setActiveTab("validations")}>Open Validations</button>
                          </div>
                        </div>
                        <div className="settings-row" data-testid="sv-row-classification-link">
                          <div className="settings-row-info">
                            <p className="settings-row-label">Classification levels</p>
                            <p className="settings-row-description">Which scheme is in use (the site's native levels or the app's own), the levels themselves, and a default level per space.</p>
                          </div>
                          <div className="settings-row-control">
                            <button type="button" className="btn-secondary" onClick={() => setActiveTab("classification")}>Open Classification</button>
                          </div>
                        </div>
                        <div className="settings-row" data-testid="sv-row-rerun-setup">
                          <div className="settings-row-info">
                            <p className="settings-row-label">First-run setup</p>
                            <p className="settings-row-description">Answer the three setup questions again: seal duration, alert profile, classification source. Nothing changes until you press Finish.</p>
                          </div>
                          <div className="settings-row-control">
                            <button type="button" className="sv-link" onClick={() => setRerunSetup(true)} data-testid="sv-rerun-setup">Run setup again</button>
                          </div>
                        </div>
                      </>
                    )}
                  >
                    {groupRows[g.id].map((desc) => (
                      <ControlRow key={desc.key} desc={desc} values={values} onChange={onChange} />
                    ))}
                    {g.id === "alerts" && (
                      <p className="sv-group-note" data-testid="sv-quiet-note">
                        A space admin can put a single space in Quiet mode from its Access Control tab: that space then posts no comments and mentions nobody, whatever is set here. Pop-ups and the ribbon are never affected.
                      </p>
                    )}
                  </GroupCard>
                ))}
              </div>
            )}
            {activeTab === "validations" && <ValidationsEditor scope="global" />}
            {activeTab === "classification" && <ClassificationTab />}
          </div>

          {/* The Validations and Classification tabs save their own state; the policy Apply bar is
              for the Settings tab only. */}
          {activeTab === "settings" && (
            <div className="action-bar">
              <button className="btn-primary" onClick={onSavePreferences} disabled={loading}>
                {loading ? "Updating..." : "Apply Configuration"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const RootFrame = () => <GlobalPolicyEditor />;

const container = document.getElementById("root");
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <RootFrame />
  </React.StrictMode>,
);
