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

  useEffect(() => {
    (async () => {
      await enablePaletteSync();
      const ctx = await view.getContext();
      const saved = ctx.extension?.config;
      if (saved) {
        setConfig({
          columns: { ...INITIAL_CONFIG.columns, ...(saved.columns || {}) },
          rowsPerPage: saved.rowsPerPage ?? INITIAL_CONFIG.rowsPerPage,
          showUploadZone: saved.showUploadZone ?? INITIAL_CONFIG.showUploadZone,
          cardsPerRow: saved.cardsPerRow ?? INITIAL_CONFIG.cardsPerRow,
        });
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!status) return;
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
    try {
      await view.submit({ config });
      setStatus({ type: "success", message: "Preferences applied" });
    } catch (e) {
      console.error("Failed to submit config:", e);
      setStatus({ type: "error", message: "Could not apply" });
    }
  };

  if (loading) {
    return <div className="mc-panel loading">Please wait…</div>;
  }

  return (
    <div className="mc-panel">
      <div className="mc-header">
        <h1 className="mc-title">Sentinel Vault</h1>
        <span className="mc-subtitle">Panel preferences</span>
      </div>

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
        <div className="mc-section-label">Artifact Upload</div>
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
        >
          {status?.type === "success" ? "Applied" : "Apply"}
        </button>
        <button className="mc-btn-subtle" onClick={() => view.close()}>
          Discard
        </button>
      </div>

      {status && status.type === "error" && (
        <div className={`mc-status ${status.type}`}>{status.message}</div>
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
