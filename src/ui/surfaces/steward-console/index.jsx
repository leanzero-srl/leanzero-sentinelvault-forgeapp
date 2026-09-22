import React, { useState, useEffect, useMemo, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { invoke, view } from "@forge/bridge";
import { enablePaletteSync } from "../../kit/palette-sync";
import ValidationsEditor from "../../kit/ValidationsEditor";
import LicenseBanner from "../../kit/LicenseBanner";
import ClassificationTab, { LevelPicker } from "../../kit/ClassificationTab";
import Dialog, { ConfirmDialog } from "../../kit/Dialog";
import { formatDurationHours } from "../../kit/format-duration";
import logo from "../../assets/icons/icon.png";
import { BUILD_INFO } from "../../../build-info.js";
// P2 (UX review 2026-09-14 §3): the console renders FROM the schema — keys, labels, one-line
// descriptions, engine defaults and the dependency table all live in settings-schema.js, which
// reads its defaults from the same baseline.js the engine reads. No second copy here.
import {
  GROUPS, controlsFor, control, readAllEffective, formatDefault, dependencyState, controlVisible,
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
export const ControlRow = ({ desc, values, siteValues, onChange, children, siteDefaultText, levels = [] }) => {
  const dep = dependencyState(desc.key, values, siteValues);
  const depth = depthOf(desc.key);
  const val = values[desc.key];
  // CLS-1: a control about a feature the site has off does not exist on screen (`hiddenUnless`).
  if (!controlVisible(desc.key, desc.scope === "space" ? siteValues || values : values)) return null;
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
      case "level": // CLS-10: a level chip picker, never a rank number
        input = <LevelPicker value={val || "__none__"} levels={levels} onChange={(id) => set(id === "__none__" ? null : id)} allowNone ariaLabel={desc.label} testId={`sv-level-${desc.key}`} disabled={disabled} placeholder="Choose a level…" />;
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
  const [classification, setClassification] = useState(false); // CLS-1: off unless the admin says yes
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
    const payload = buildSetupPayload({ hours, profile, classification });
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
          <h2 className="sv-setup-title">Should pages carry a classification level?</h2>
          <p className="sv-setup-text">Off by default. On: every page shows a level (Public, Internal, Confidential, Restricted…) in its byline chip, the ribbon and the page details, and a space can set a default level. Off: nothing about classification is shown anywhere; it can be turned on later in Settings → Classification.</p>
          <ChoiceBlocks value={classification ? "on" : "off"} onChange={(v) => setClassification(v === "on")} ariaLabel="Classification levels" testPrefix="sv-setup-classification" minWidth={0}
            options={[
              { id: "off", name: "Off", text: "Sentinel Vault seals attachments and sections and runs the document workflow; pages carry no classification level." },
              { id: "on", name: "On", text: "Pages carry a classification level, shown on the page and used by the ribbon threshold." },
            ]} />
          {classification && (
            <>
              <div className="sv-provider" data-testid="sv-setup-provider" data-provider={provider || "detecting"}>
                <span className={`sv-provider-badge ${provider || "detecting"}`}>{provider === "native" ? "Native" : provider === "app" ? "App" : "Detecting…"}</span>
                <p className="sv-provider-text">{provider ? PROVIDER_TEXT[provider] : "Checking whether this site has Confluence classification levels…"}</p>
              </div>
              <dl className="sv-provider-legend">
                <dt>Native</dt><dd>The site has defined Confluence classification levels. They apply everywhere and Sentinel Vault follows them.</dd>
                <dt>App</dt><dd>The site has none, so the app's own four levels are used and stored on each page as a content property.</dd>
              </dl>
            </>
          )}
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

// ── API access (docs/REST-CONFIG-API.md) ──────────────────────────────────────────────────
// Site-admin tab: the endpoint URL and recipe, the tokens (mint / revoke), the last 50 job
// receipts and a config export. Every call goes through the resolver contract in the doc; an
// unknown resolver (older server) makes `invoke` throw, which every card renders as an
// "unavailable" state with Retry — never a blank pane.

const API_UNAVAILABLE = "API access is not available on this version";

/** Normalise one resolver call into { ok, data } | { ok:false, kind:"unavailable"|"refused", reason }. */
const callApi = async (name, payload = {}) => {
  let r;
  try { r = await invoke(name, payload); } catch (e) { return { ok: false, kind: "unavailable", reason: API_UNAVAILABLE }; }
  if (!r || typeof r !== "object") return { ok: false, kind: "unavailable", reason: API_UNAVAILABLE };
  if (r.success === false) return { ok: false, kind: "refused", reason: r.reason || "Refused." };
  return { ok: true, data: r };
};

const fmtWhen = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
};

/** Copies text to the clipboard; the button reads "Copied" for two seconds (announced by aria-live). */
const CopyButton = ({ text, label = "Copy", testId, className = "btn-secondary api-copy" }) => {
  const [state, setState] = useState("idle");
  useEffect(() => { if (state === "idle") return undefined; const t = setTimeout(() => setState("idle"), 2000); return () => clearTimeout(t); }, [state]);
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else throw new Error("no clipboard");
      setState("copied");
    } catch (e) { setState("failed"); }
  };
  return (
    <span className="api-copy-wrap">
      <button type="button" className={`${className}${state === "copied" ? " is-copied" : ""}`} onClick={copy} disabled={!text} data-testid={testId} data-state={state}>
        {state === "copied" ? "Copied" : state === "failed" ? "Select and copy" : label}
      </button>
      <span className="sr-only" aria-live="polite" role="status">{state === "copied" ? "Copied to the clipboard" : ""}</span>
    </span>
  );
};

const ApiCard = ({ id, title, text, children }) => (
  <section className="sv-group api-card" data-testid={`api-${id}-card`}>
    <header className="sv-group-head">
      <h3 className="sv-group-title">{title}</h3>
      <p className="sv-group-text">{text}</p>
    </header>
    <div className="sv-group-body api-card-body">{children}</div>
  </section>
);

/** The shared failure block: the reason and a Retry. */
const ApiFailure = ({ reason, onRetry, testId }) => (
  <div className="api-failure" role="alert" data-testid={testId}>
    <span className="api-failure-text">{reason}</span>
    {onRetry && <button type="button" className="btn-secondary api-retry" onClick={onRetry} data-testid={`${testId}-retry`}>Retry</button>}
  </div>
);

const ApiSkeleton = ({ rows = 3, testId }) => (
  <div className="api-skeleton" aria-busy="true" aria-label="Loading" data-testid={testId}>
    {Array.from({ length: rows }).map((_, i) => <span key={i} className="api-skeleton-bar" />)}
  </div>
);

const TOKEN_ROLES = [
  { id: "viewer", name: "Viewer", text: "Submits nothing. For a read-only integration that reads the Confluence properties; widen it later." },
  { id: "editor", name: "Editor", text: "Content operations: seal and unseal attachments and sections, classify pages, workflow steps — each gated per page as you." },
  { id: "admin", name: "Admin", text: "Everything an editor may do, plus site and space configuration." },
];
const ROLE_COLOR = { viewer: "#64748B", editor: "#2563EB", admin: "#7C3AED" };
const JOB_COLOR = { done: "#15803D", partial: "#D97706", failed: "#DC2626", refused: "#DC2626", running: "#2563EB", queued: "#64748B" };

const SolidChip = ({ text, color, testId }) => (
  <span className="cls-chip api-chip" style={{ background: color || "#64748B", color: "#FFFFFF" }} data-testid={testId}>{text}</span>
);

/** Role picker: the console's mini-select shape, keyboard-driven (arrows, Enter, Escape), never a native <select>. */
const RolePicker = ({ value, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => Math.max(0, TOKEN_ROLES.findIndex((r) => r.id === value)));
  const current = TOKEN_ROLES.find((r) => r.id === value) || TOKEN_ROLES[1];
  const pick = (id) => { onChange(id); setOpen(false); };
  const onKey = (e) => {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setCursor((c) => (c + (e.key === "ArrowDown" ? 1 : TOKEN_ROLES.length - 1)) % TOKEN_ROLES.length);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (open) pick(TOKEN_ROLES[cursor].id); else setOpen(true);
    } else if (e.key === "Escape" && open) { e.preventDefault(); setOpen(false); }
  };
  return (
    <div className="mini-select api-role-picker" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }} data-testid="api-mint-role">
      <button type="button" className="mini-select-value api-role-value" onClick={() => !disabled && setOpen(!open)} onKeyDown={onKey}
        aria-haspopup="listbox" aria-expanded={open} aria-label="Token role" disabled={disabled} data-testid="api-mint-role-value">
        <span className="api-role-current"><SolidChip text={current.name} color={ROLE_COLOR[current.id]} /><span className="api-role-hint">{current.text}</span></span>
        <span className={`mini-select-arrow${open ? " open" : ""}`}>▼</span>
      </button>
      {open && (
        <div className="mini-select-menu api-role-menu" role="listbox" aria-label="Token role">
          {TOKEN_ROLES.map((r, i) => (
            <div key={r.id} role="option" aria-selected={r.id === value} className={`mini-select-opt api-role-opt${r.id === value ? " sel" : ""}${i === cursor ? " is-cursor" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); pick(r.id); }} onMouseEnter={() => setCursor(i)} data-testid={`api-mint-role-${r.id}`}>
              <span className="api-role-opt-name">{r.name}</span>
              <span className="api-role-opt-text">{r.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const recipeFor = (url) => [
  `# submit a bundle (the job id IS your Idempotency-Key; same key twice = same job)`,
  `curl -i -X POST "${url}?op=bundle" \\`,
  `  -H "Authorization: Bearer svt_…" \\`,
  `  -H "Idempotency-Key: deploy-$(date +%Y%m%d)-1" \\`,
  `  -H "Content-Type: application/json" \\`,
  `  -d '{"version":1,"site":{"policy":{"defaultLockDuration":172800}},"spaces":{},"content":[]}'`,
  `# → 202 accepted · 400 invalid · 401 unauthorized · 403 forbidden · 409 conflict · 429 busy`,
  ``,
  `# read the receipt with YOUR Confluence credentials (space property sentinel-vault-receipt)`,
  `curl -u "$EMAIL:$ATLASSIAN_TOKEN" "$SITE/wiki/api/v2/spaces/$SPACE_ID/properties?key=sentinel-vault-receipt"`,
  `# the effective configuration is the space property sentinel-vault-config on every configured space`,
].join("\n");

const ApiEndpointCard = ({ state, onRetry }) => {
  const [recipeOpen, setRecipeOpen] = useState(false);
  const url = state.url || "";
  return (
    <ApiCard id="url" title="Endpoint" text="One POST endpoint accepts configuration bundles and content operations; everything readable comes back through Confluence's own REST.">
      {state.status === "loading" && <ApiSkeleton rows={2} testId="api-url-skeleton" />}
      {state.status === "error" && <ApiFailure reason={state.reason} onRetry={onRetry} testId="api-url-error" />}
      {state.status === "ok" && (
        <>
          <div className="api-url-row">
            <code className="api-url" data-testid="api-url" tabIndex={0}>{url || "No endpoint URL was returned."}</code>
            <CopyButton text={url} testId="api-url-copy" />
          </div>
          <p className="api-explain">Send a POST with a bearer token and an Idempotency-Key. Results are readable as Confluence properties (sentinel-vault-receipt, sentinel-vault-config).</p>
          <button type="button" className="sv-link" onClick={() => setRecipeOpen(!recipeOpen)} aria-expanded={recipeOpen} aria-controls="api-recipe" data-testid="api-recipe-toggle">
            {recipeOpen ? "Hide the recipe" : "Read the recipe"}
          </button>
          {recipeOpen && (
            <div className="api-recipe-wrap" id="api-recipe" data-testid="api-recipe">
              <pre className="api-pre" tabIndex={0}>{recipeFor(url || "<endpoint url>")}</pre>
              <CopyButton text={recipeFor(url || "<endpoint url>")} label="Copy the recipe" testId="api-recipe-copy" />
            </div>
          )}
        </>
      )}
    </ApiCard>
  );
};

const ApiTokensCard = ({ state, onRetry, onMinted, onRevoked }) => {
  const [name, setName] = useState("");
  const [role, setRole] = useState("editor");
  const [busy, setBusy] = useState(false);
  const [mintError, setMintError] = useState(null);
  const [minted, setMinted] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [revokeError, setRevokeError] = useState(null);

  const mint = async () => {
    const n = name.trim();
    if (!n) { setMintError("Give the token a name."); return; }
    setBusy(true); setMintError(null);
    const r = await callApi("create-api-token", { name: n, role });
    setBusy(false);
    if (!r.ok) { setMintError(r.reason); return; }
    setMinted({ token: r.data.token, row: r.data.row || { name: n, role } });
    setName("");
    onMinted(r.data.row);
  };
  const revoke = async () => {
    if (!confirm) return;
    setBusy(true); setRevokeError(null);
    const r = await callApi("revoke-api-token", { id: confirm.id });
    setBusy(false);
    if (!r.ok) { setRevokeError(r.reason); setConfirm(null); return; }
    onRevoked(confirm.id);
    setConfirm(null);
  };
  const cancelConfirm = useCallback(() => { if (!busy) setConfirm(null); }, [busy]);

  const tokens = state.tokens || [];
  return (
    <ApiCard id="tokens" title="Tokens" text="A token acts as the site admin who minted it; its role narrows what it may submit. Only a hash is stored.">
      {state.status === "loading" && <ApiSkeleton testId="api-tokens-skeleton" />}
      {state.status === "error" && <ApiFailure reason={state.reason} onRetry={onRetry} testId="api-tokens-error" />}
      {state.status === "refused" && <ApiFailure reason={state.reason} onRetry={onRetry} testId="api-tokens-refused" />}
      {state.status === "ok" && (
        <>
          {revokeError && <div className="api-inline-error" role="alert" data-testid="api-revoke-error">{revokeError}</div>}
          <div className="cls-table-wrap api-table-wrap">
            <table className="cls-table api-table" data-testid="api-tokens-table">
              <thead><tr><th>Name</th><th>Prefix</th><th>Role</th><th>Created</th><th>Last used</th><th>State</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {tokens.length === 0 && <tr><td colSpan={7} className="api-empty" data-testid="api-tokens-empty">No tokens yet. Mint one below.</td></tr>}
                {tokens.map((t) => {
                  const revoked = !!t.revokedAt;
                  return (
                    <tr key={t.id} className={revoked ? "is-revoked" : ""} data-testid="api-token-row" data-token-name={t.name} data-token-state={revoked ? "revoked" : "active"}>
                      <td className="api-token-name">{t.name}</td>
                      <td><code>{t.prefix}…</code></td>
                      <td><SolidChip text={t.role || "admin"} color={ROLE_COLOR[t.role || "admin"]} /></td>
                      <td>{fmtWhen(t.createdAt)}{t.createdBy && <span className="api-by">by {t.createdByName || t.createdBy}</span>}</td>
                      <td>{t.lastUsedAt ? fmtWhen(t.lastUsedAt) : "Never"}</td>
                      <td data-testid="api-token-state"><SolidChip text={revoked ? "Revoked" : "Active"} color={revoked ? "#64748B" : "#15803D"} /></td>
                      <td className="api-row-actions">
                        {!revoked && <button type="button" className="btn-secondary api-revoke" onClick={() => setConfirm(t)} disabled={busy} data-testid="api-token-revoke">Revoke</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {minted ? (
            <div className="api-minted" role="region" aria-live="assertive" aria-label="New token" data-testid="api-minted-panel">
              <p className="api-minted-title">Token “{minted.row?.name}” minted</p>
              <code className="api-minted-token" tabIndex={0} data-testid="api-minted-token">{minted.token}</code>
              <p className="api-minted-text">Copy it now — it is not stored and cannot be shown again.</p>
              <div className="api-minted-actions">
                <CopyButton text={minted.token} className="btn-primary api-copy" testId="api-minted-copy" />
                <button type="button" className="btn-secondary" onClick={() => setMinted(null)} data-testid="api-minted-dismiss">I have copied it</button>
              </div>
            </div>
          ) : (
            <div className="api-mint" data-testid="api-mint-form">
              <h4 className="api-mint-title">Mint a token</h4>
              {mintError && <div className="api-inline-error" role="alert" data-testid="api-mint-error">{mintError}</div>}
              <div className="api-mint-grid">
                <label className="api-field">
                  <span className="api-field-label">Name</span>
                  <input className="form-input api-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ci-deploy" maxLength={80} disabled={busy}
                    onKeyDown={(e) => { if (e.key === "Enter") mint(); }} data-testid="api-mint-name" />
                </label>
                <div className="api-field">
                  <span className="api-field-label">Role</span>
                  <RolePicker value={role} onChange={setRole} disabled={busy} />
                </div>
                <button type="button" className="btn-primary api-mint-btn" onClick={mint} disabled={busy} data-testid="api-mint">{busy ? "Minting…" : "Mint"}</button>
              </div>
            </div>
          )}
        </>
      )}
      {confirm && (
        <ConfirmDialog
          title={`Revoke ${confirm.name}?`}
          message={<p>Integrations using it stop immediately. This cannot be undone.</p>}
          confirmLabel="Revoke"
          busy={busy}
          onConfirm={revoke}
          onCancel={cancelConfirm}
          testId="api-revoke-dialog"
        />
      )}
    </ApiCard>
  );
};

const ApiJobsCard = ({ state, onRetry }) => {
  const [openId, setOpenId] = useState(null);
  const jobs = state.jobs || [];
  return (
    <ApiCard id="jobs" title="Recent jobs" text="The last 50 receipts site-wide, newest first. The same receipt is mirrored to the sentinel-vault-receipt property of every space a job touched.">
      {state.status === "loading" && <ApiSkeleton testId="api-jobs-skeleton" />}
      {state.status !== "loading" && state.status !== "ok" && <ApiFailure reason={state.reason} onRetry={onRetry} testId="api-jobs-error" />}
      {state.status === "ok" && jobs.length === 0 && <p className="api-empty" data-testid="api-jobs-empty">No API jobs yet.</p>}
      {state.status === "ok" && jobs.length > 0 && (
        <div className="cls-table-wrap api-table-wrap">
          <table className="cls-table api-table" data-testid="api-jobs-table">
            <thead><tr><th>Job</th><th>Status</th><th>Who</th><th>Op</th><th>Submitted</th><th>Applied</th><th>Refused</th><th>Failed</th></tr></thead>
            <tbody>
              {jobs.map((j) => {
                const open = openId === j.id;
                const s = j.summary || {};
                const results = Array.isArray(j.results) ? j.results : [];
                return (
                  <React.Fragment key={j.id}>
                    <tr data-testid="api-job-row" data-job-id={j.id} data-job-status={j.status}>
                      <td>
                        <button type="button" className="sv-link api-job-toggle" onClick={() => setOpenId(open ? null : j.id)} aria-expanded={open} data-testid="api-job-toggle">
                          {open ? "▾" : "▸"} <code>{j.id}</code>
                        </button>
                      </td>
                      <td><SolidChip text={j.status || "queued"} color={JOB_COLOR[j.status] || JOB_COLOR.queued} testId="api-job-status" /></td>
                      <td>{j.submittedByName || j.submittedBy || "—"}{j.role && <span className="api-by">as {j.role}</span>}</td>
                      <td><code>{j.op || "bundle"}</code></td>
                      <td>{fmtWhen(j.submittedAt)}{j.finishedAt && <span className="api-by">finished {fmtWhen(j.finishedAt)}</span>}</td>
                      <td className="api-count api-count-applied">{s.applied ?? 0}</td>
                      <td className="api-count api-count-refused">{s.refused ?? 0}</td>
                      <td className="api-count api-count-failed">{s.failed ?? 0}</td>
                    </tr>
                    {open && (
                      <tr className="api-job-detail" data-testid="api-job-results">
                        <td colSpan={8}>
                          {results.length === 0 ? <p className="api-empty">No per-operation results on this receipt.</p> : (
                            <table className="api-results">
                              <thead><tr><th>Path</th><th>Status</th><th>Reason</th></tr></thead>
                              <tbody>
                                {results.map((r, i) => (
                                  <tr key={i} data-testid="api-job-result">
                                    <td><code>{r.path}</code></td>
                                    <td><SolidChip text={r.status || "—"} color={r.status === "applied" ? JOB_COLOR.done : r.status === "refused" ? JOB_COLOR.partial : r.status === "failed" ? JOB_COLOR.failed : JOB_COLOR.queued} /></td>
                                    <td>{r.reason || ""}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </ApiCard>
  );
};

const ApiExportCard = () => {
  const [spaceKey, setSpaceKey] = useState("");
  const [out, setOut] = useState({ status: "idle" });
  const [last, setLast] = useState(null);
  const run = async (which, key) => {
    setLast({ which, key });
    setOut({ status: "loading" });
    const r = which === "site" ? await callApi("export-site-config", {}) : await callApi("export-space-config", { spaceKey: key });
    if (!r.ok) { setOut({ status: "error", reason: r.reason }); return; }
    setOut({ status: "ok", label: which === "site" ? "Site configuration" : `Space ${key} configuration`, json: JSON.stringify(r.data.config ?? null, null, 2) });
  };
  const exportSpace = () => {
    const k = spaceKey.trim().toUpperCase();
    if (!k) { setOut({ status: "error", reason: "Enter a space key." }); setLast(null); return; }
    run("space", k);
  };
  const busy = out.status === "loading";
  return (
    <ApiCard id="export" title="Export" text="The effective configuration as the bundle the endpoint accepts. Copy it, version it, edit it, POST it back.">
      <div className="api-export-row">
        <button type="button" className="btn-primary" onClick={() => run("site", null)} disabled={busy} data-testid="api-export-site">Download the site configuration</button>
        <div className="api-export-space">
          <input className="form-input api-input" value={spaceKey} onChange={(e) => setSpaceKey(e.target.value)} placeholder="Space key" aria-label="Space key" disabled={busy}
            onKeyDown={(e) => { if (e.key === "Enter") exportSpace(); }} data-testid="api-export-space-key" />
          <button type="button" className="btn-secondary" onClick={exportSpace} disabled={busy} data-testid="api-export-space">Download space configuration</button>
        </div>
      </div>
      <p className="api-explain">Downloads are copied, not saved: the JSON appears below with a Copy button.</p>
      {out.status === "loading" && <ApiSkeleton rows={4} testId="api-export-skeleton" />}
      {out.status === "error" && <ApiFailure reason={out.reason} onRetry={last ? () => run(last.which, last.key) : null} testId="api-export-error" />}
      {out.status === "ok" && (
        <div className="api-export-out" data-testid="api-export-output" data-export={last?.which}>
          <div className="api-export-head">
            <span className="api-export-label">{out.label}</span>
            <CopyButton text={out.json} label="Copy JSON" testId="api-export-copy" />
          </div>
          <pre className="api-pre" tabIndex={0} data-testid="api-export-json">{out.json}</pre>
        </div>
      )}
    </ApiCard>
  );
};

const ApiAccessTab = () => {
  const [tokens, setTokens] = useState({ status: "loading" });
  const [jobs, setJobs] = useState({ status: "loading" });

  const loadTokens = useCallback(async () => {
    setTokens({ status: "loading" });
    const r = await callApi("list-api-tokens", {});
    if (!r.ok) { setTokens({ status: r.kind === "refused" ? "refused" : "error", reason: r.reason }); return; }
    setTokens({ status: "ok", tokens: Array.isArray(r.data.tokens) ? r.data.tokens : [], url: r.data.url || "" });
  }, []);
  const loadJobs = useCallback(async () => {
    setJobs({ status: "loading" });
    const r = await callApi("list-api-jobs", { limit: 50 });
    if (!r.ok) { setJobs({ status: r.kind === "refused" ? "refused" : "error", reason: r.reason }); return; }
    const list = Array.isArray(r.data.jobs) ? r.data.jobs.slice() : [];
    list.sort((a, b) => Date.parse(b.submittedAt || 0) - Date.parse(a.submittedAt || 0));
    setJobs({ status: "ok", jobs: list.slice(0, 50) });
  }, []);
  useEffect(() => { loadTokens(); loadJobs(); }, [loadTokens, loadJobs]);

  // The endpoint card shares the tokens call (the URL rides on list-api-tokens). A refusal there
  // still shows the URL card's failure honestly — a non-admin gets the reason, not a blank.
  const urlState = tokens.status === "ok" ? { status: "ok", url: tokens.url } : tokens.status === "loading" ? { status: "loading" } : { status: "error", reason: tokens.reason };

  return (
    <div className="settings-panel sv-groups api-tab" data-testid="api-tab">
      <ApiEndpointCard state={urlState} onRetry={loadTokens} />
      <ApiTokensCard
        state={tokens}
        onRetry={loadTokens}
        onMinted={(row) => { if (row && row.id) setTokens((p) => ({ ...p, tokens: [row, ...(p.tokens || []).filter((t) => t.id !== row.id)] })); else loadTokens(); }}
        onRevoked={(id) => setTokens((p) => ({ ...p, tokens: (p.tokens || []).map((t) => (t.id === id ? { ...t, revokedAt: t.revokedAt || new Date().toISOString() } : t)) }))}
      />
      <ApiJobsCard state={jobs} onRetry={loadJobs} />
      <ApiExportCard />
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

  // Tester report 2026-09-22 (item 4): the last applied snapshot of the schema's keys; the bar names
  // unsaved changes, offers Discard, and leaving the Settings tab while dirty asks first.
  const [saved, setSaved] = useState(null);
  const [leaveTo, setLeaveTo] = useState(null);
  const snapshotOf = (vals) => { const d = {}; for (const c of controlsFor("global")) d[c.key] = vals[c.key]; return JSON.stringify(d); };
  const applyRecord = (rec) => {
    const vals = readAllEffective("global", rec);
    setValues(vals);
    setSaved(snapshotOf(vals));
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
        setSaved(snapshotOf(values));
        return true;
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
    return false;
  };
  const dirty = saved !== null && snapshotOf(values) !== saved;
  const discard = () => { try { setValues((prev) => ({ ...prev, ...JSON.parse(saved) })); } catch (_) { /* keep */ } setMessage(null); setMessageType(null); };
  const switchTab = (tab) => { if (dirty && activeTab === "settings" && tab !== "settings") setLeaveTo(() => () => setActiveTab(tab)); else setActiveTab(tab); };

  const groupRows = useMemo(() => Object.fromEntries(GROUPS.map((g) => [g.id, controlsFor("global", g.id)])), []);
  // CLS-10: the level list for the "Show the banner from" picker (the scheme in use).
  const [levelList, setLevelList] = useState([]);
  useEffect(() => { invoke("classification-provider", {}).then((r) => setLevelList(Array.isArray(r?.levels) ? r.levels : [])).catch(() => {}); }, []);

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
            <button className={`tab-button ${activeTab === "settings" ? "active" : ""}`} onClick={() => switchTab("settings")} data-testid="tab-settings">
              Settings
            </button>
            <button className={`tab-button ${activeTab === "validations" ? "active" : ""}`} onClick={() => switchTab("validations")} data-testid="tab-validations">
              Validations
            </button>
            <button className={`tab-button ${activeTab === "classification" ? "active" : ""}`} onClick={() => switchTab("classification")} data-testid="tab-classification">
              Classification
            </button>
            <button className={`tab-button ${activeTab === "api" ? "active" : ""}`} onClick={() => switchTab("api")} data-testid="tab-api-access">
              API access
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
                            <p className="settings-row-description">Answer the three setup questions again: seal duration, alert profile, classification on or off. Nothing changes until you press Finish.</p>
                          </div>
                          <div className="settings-row-control">
                            <button type="button" className="sv-link" onClick={() => setRerunSetup(true)} data-testid="sv-rerun-setup">Run setup again</button>
                          </div>
                        </div>
                      </>
                    )}
                  >
                    {groupRows[g.id].map((desc) => (
                      <ControlRow key={desc.key} desc={desc} values={values} onChange={onChange} levels={levelList} />
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
            {activeTab === "classification" && <ClassificationTab onOpenSettings={() => setActiveTab("settings")} />}
            {activeTab === "api" && <ApiAccessTab />}
          </div>

          {/* The Validations and Classification tabs save their own state; the policy Apply bar is
              for the Settings tab only. */}
          {activeTab === "settings" && (
            <div className={`action-bar ${dirty ? "is-dirty" : ""}`} data-dirty={dirty ? "1" : "0"} data-testid="sv-global-action-bar">
              {dirty
                ? <span className="action-bar-pill" role="status" data-testid="sv-unsaved-note">Unsaved changes — nothing takes effect until you apply</span>
                : <span className="action-bar-note" role="status">All changes applied</span>}
              {dirty && <button type="button" className="btn-secondary" onClick={discard} disabled={loading} data-testid="sv-discard-global-prefs">Discard</button>}
              <button className="btn-primary" onClick={onSavePreferences} disabled={loading || !dirty} data-testid="sv-save-global-prefs">
                {loading ? "Updating..." : "Apply Configuration"}
              </button>
            </div>
          )}
          {leaveTo && (
            <Dialog title="Apply your changes first?" onClose={() => setLeaveTo(null)} busy={loading} testId="sv-unsaved-dialog">
              <div className="sv-dialog-body">You changed settings and have not applied them. Leaving the tab now throws them away.</div>
              <div className="sv-dialog-actions">
                <button type="button" className="action-btn confirm-yes" style={{ background: "var(--sv-interactive-primary)" }} disabled={loading} data-testid="sv-unsaved-apply"
                  onClick={async () => { const go = leaveTo; if (await onSavePreferences()) { setLeaveTo(null); go(); } }}>Apply and continue</button>
                <button type="button" className="action-btn confirm-no" disabled={loading} data-testid="sv-unsaved-discard"
                  onClick={() => { const go = leaveTo; discard(); setLeaveTo(null); go(); }}>Discard and continue</button>
                <button type="button" className="action-btn confirm-no" disabled={loading} data-testid="sv-unsaved-stay" onClick={() => setLeaveTo(null)}>Stay here</button>
              </div>
            </Dialog>
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
