import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { view } from "@forge/bridge";
import { enablePaletteSync } from "../../kit/palette-sync";

// ── Icons ────────────────────────────────────────────

const CheckGlyph = () => (
  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
    <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ChevronGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const MarkGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ── Data ─────────────────────────────────────────────

const COLUMN_OPTIONS = [
  { key: "name", label: "Name", defaultOn: true },
  { key: "status", label: "Status", defaultOn: true },
  { key: "sealOwner", label: "Sealed by", defaultOn: true },
  { key: "labels", label: "Labels", defaultOn: true },
  { key: "comment", label: "Comment", defaultOn: true },
  { key: "actions", label: "Actions", defaultOn: true },
  { key: "fileSize", label: "File Size", defaultOn: false },
  { key: "fileType", label: "File Type", defaultOn: false },
  { key: "expiresAt", label: "Overdue on", defaultOn: false },
];

const PAGE_SIZE_OPTIONS = [
  { value: 5, label: "5 items" },
  { value: 10, label: "10 items" },
  { value: 15, label: "15 items" },
  { value: 25, label: "25 items" },
];

const CARDS_PER_ROW_OPTIONS = [
  { value: 1, label: "1 (list view)" },
  { value: 2, label: "2 per row" },
  { value: 3, label: "3 per row" },
];

// The bridge can stall (P1-6: "Please wait…" forever, Apply that never returns). Every bridge
// call is raced against a deadline so the dialog always reaches a state with a button in it.
const CONTEXT_WAIT_MS = 10_000;
const SUBMIT_WAIT_MS = 15_000;
const withDeadline = (promise, ms, what) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`${what} did not answer within ${Math.round(ms / 1000)}s`)), ms);
  Promise.resolve(promise).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});
const bridgeClose = () => {
  try { const r = view.close(); if (r && r.catch) r.catch((e) => console.info("[PANEL-SETUP] view.close rejected:", e?.message || e)); } catch (e) { console.info("[PANEL-SETUP] view.close unavailable:", e?.message || e); }
};

const INITIAL_CONFIG = {
  columns: COLUMN_OPTIONS.reduce((acc, col) => ({ ...acc, [col.key]: col.defaultOn }), {}),
  rowsPerPage: 15,
  showUploadZone: true,
  cardsPerRow: 2,
};

// ── Custom Select ────────────────────────────────────

const SelectControl = ({ value, options, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div className="mc-select-wrap" ref={ref}>
      <button
        type="button"
        className={`mc-select-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen(!open)}
      >
        <span>{selected?.label || value}</span>
        <span className="mc-select-arrow"><ChevronGlyph /></span>
      </button>
      {open && (
        <div className="mc-select-dropdown">
          {options.map((opt) => (
            <div
              key={opt.value}
              className={`mc-select-option ${opt.value === value ? "selected" : ""}`}
              onClick={() => { onChange(opt.value); setOpen(false); }}
            >
              <span>{opt.label}</span>
              {opt.value === value && (
                <span className="mc-select-option-check"><MarkGlyph /></span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Main ─────────────────────────────────────────────

const GridLayoutEditor = () => {
  const [config, setConfig] = useState(INITIAL_CONFIG);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [initError, setInitError] = useState(null); // the saved config could not be read
  const [busy, setBusy] = useState(false);
  const [loadSeq, setLoadSeq] = useState(0); // bumped by "Try again" on the init path

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setInitError(null);
      try { await withDeadline(enablePaletteSync(), CONTEXT_WAIT_MS, "the theme bridge"); } catch (e) { console.info("[PANEL-SETUP] palette sync skipped:", e?.message || e); }
      try {
        const ctx = await withDeadline(view.getContext(), CONTEXT_WAIT_MS, "the editor");
        const saved = ctx?.extension?.config;
        if (!cancelled && saved) {
          setConfig({
            columns: { ...INITIAL_CONFIG.columns, ...(saved.columns || {}) },
            rowsPerPage: saved.rowsPerPage ?? INITIAL_CONFIG.rowsPerPage,
            showUploadZone: saved.showUploadZone ?? INITIAL_CONFIG.showUploadZone,
            cardsPerRow: saved.cardsPerRow ?? INITIAL_CONFIG.cardsPerRow,
          });
        }
      } catch (e) {
        console.error("[PANEL-SETUP] could not read the saved preferences:", e);
        // The form still renders (defaults) so the dialog never hangs; Apply would overwrite
        // the saved preferences with defaults, so the banner says so and offers a retry.
        if (!cancelled) setInitError(e?.message || "The editor did not answer.");
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [loadSeq]);

  // Success clears itself; an error stays until the user retries or changes something.
  useEffect(() => {
    if (!status || status.type !== "success") return undefined;
    const t = setTimeout(() => setStatus(null), 3000);
    return () => clearTimeout(t);
  }, [status]);

  const flipColumn = (key) => {
    setConfig((prev) => ({
      ...prev,
      columns: { ...prev.columns, [key]: !prev.columns[key] },
    }));
    setStatus(null);
  };

  const onApply = async () => {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      await withDeadline(view.submit({ config }), SUBMIT_WAIT_MS, "the editor");
      setStatus({ type: "success", message: "Preferences applied" });
      // The editor keeps the dialog open after a submit it accepted (P1-6); close it ourselves.
      bridgeClose();
    } catch (e) {
      console.error("[PANEL-SETUP] submit failed:", e);
      setStatus({ type: "error", message: `Could not apply the preferences — ${e?.message || "the editor refused the change"}.` });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="mc-panel loading" data-testid="mc-loading">Please wait…</div>;
  }

  return (
    <div className="mc-panel">
      <div className="mc-header">
        <h1 className="mc-title">Sentinel Vault</h1>
        <span className="mc-subtitle">Panel preferences</span>
      </div>

      {initError && (
        <div className="mc-status error" role="alert" data-testid="mc-init-error">
          <span>Could not read the saved preferences ({initError}). Defaults are shown; applying now would replace what was saved.</span>
          <button type="button" className="mc-status-retry" onClick={() => setLoadSeq((n) => n + 1)}>Try again</button>
        </div>
      )}

      {/* Columns */}
      <div className="mc-section">
        <div className="mc-section-label">Displayed columns</div>
        <div className="mc-section-content two-col">
          { COLUMN_OPTIONS.map((col) => (
            <label key={col.key} className="mc-checkbox-item">
              <input
                type="checkbox"
                checked={!!config.columns[col.key]}
                onChange={() => flipColumn(col.key)}
              />
              <span className="mc-check"><CheckGlyph /></span>
              <span className="mc-checkbox-label">{col.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="mc-divider" />

      {/* Layout */}
      <div className="mc-section">
        <div className="mc-section-label">Layout</div>
        <div className="mc-field">
          <span className="mc-field-label">Items per page</span>
          <SelectControl
            value={config.rowsPerPage}
            options={PAGE_SIZE_OPTIONS}
            onChange={(val) => {
              setConfig((prev) => ({ ...prev, rowsPerPage: val }));
              setStatus(null);
            }}
          />
        </div>
        <div className="mc-field">
          <span className="mc-field-label">Cards per row</span>
          <SelectControl
            value={config.cardsPerRow}
            options={CARDS_PER_ROW_OPTIONS}
            onChange={(val) => {
              setConfig((prev) => ({ ...prev, cardsPerRow: val }));
              setStatus(null);
            }}
          />
        </div>
      </div>

      <div className="mc-divider" />

      {/* Upload zone */}
      <div className="mc-section">
        <div className="mc-section-label">Attachment Upload</div>
        <div
          className="mc-toggle-row"
          onClick={() => {
            setConfig((prev) => ({ ...prev, showUploadZone: !prev.showUploadZone }));
            setStatus(null);
          }}
        >
          <div className="mc-toggle-info">
            <span className="mc-toggle-label">Drop zone</span>
            <span className="mc-toggle-hint">
              {config.showUploadZone ? "Drop zone is shown" : "Drop zone is hidden"}
            </span>
          </div>
          <button
            type="button"
            className={`mc-toggle ${config.showUploadZone ? "active" : ""}`}
            aria-pressed={config.showUploadZone}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>

      <div className="mc-divider" />

      {/* Actions */}
      <div className="mc-actions">
        <button
          className={`mc-btn-primary ${status?.type === "success" ? "saved" : ""}`}
          onClick={onApply}
          disabled={busy}
          data-testid="mc-apply"
        >
          {busy ? "Applying…" : status?.type === "success" ? "Applied" : "Apply"}
        </button>
        <button type="button" className="mc-btn-subtle" onClick={bridgeClose} data-testid="mc-cancel">
          Cancel
        </button>
      </div>

      {status && status.type === "error" && (
        <div className="mc-status error" role="alert" data-testid="mc-apply-error">
          <span>{status.message}</span>
          <button type="button" className="mc-status-retry" onClick={onApply} disabled={busy}>Retry</button>
        </div>
      )}
    </div>
  );
};

// ── Render ────────────────────────────────────────────

function mountInterface() {
  const root = createRoot(document.getElementById("root"));
  root.render(<GridLayoutEditor />);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountInterface);
} else {
  mountInterface();
}
