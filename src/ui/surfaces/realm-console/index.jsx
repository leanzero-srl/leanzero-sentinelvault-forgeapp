// src/ui/surfaces/realm-console/index.jsx

import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { invoke, view, router } from "@forge/bridge";
import { enablePaletteSync } from "../../kit/palette-sync";
import ThumbnailPreview from "../../kit/ThumbnailPreview";
import ValidationsEditor from "../../kit/ValidationsEditor";
import WorkflowSettingsEditor from "../../kit/WorkflowSettingsEditor";
import WorkflowDefinitionEditor from "../../kit/WorkflowDefinitionEditor";
import WorkflowInbox from "../../kit/WorkflowInbox";
import LicenseBanner from "../../kit/LicenseBanner";
import { formatRemaining, formatDurationHours } from "../../kit/format-duration";
import { WorkflowDashboard } from "../../kit/WorkflowDashboard";
import ActivityReport from "../../kit/ActivityReport";
import logo from "../../assets/icons/icon.png";
import { BUILD_INFO } from "../../../build-info.js";
// P2 (UX review 2026-09-14 §3): the settings tabs render from the schema — one copy of the
// keys, effect text, engine defaults and the dependency table, shared with the site console.
import {
  control, readAllEffective, readEffective, formatDefault, formatValue, dependencyState,
} from "../../../server/capsules/policies/settings-schema.js";

/**
 * A settings row drawn from its descriptor: label, one-line effect, "Effective default" and —
 * for a space override — "Site default: …" (the effective GLOBAL value the space admin is
 * overriding). A row whose parent is off is indented (same-scope parent) or locked with the
 * reason (a global master the site admin holds), never silently inert.
 */
const SchemaRow = ({ desc, values, siteValues, children, testId }) => {
  const dep = dependencyState(desc.key, values, siteValues);
  const sameScopeParent = desc.parent && control(desc.parent)?.scope === desc.scope;
  const siteDefault = desc.siteKey ? formatValue(desc.siteKey, siteValues?.[desc.siteKey]) : null;
  return (
    <div
      className={`settings-row${sameScopeParent ? " is-dependent depth-1" : ""}${dep.enabled ? "" : " is-locked"}`}
      data-testid={testId || `sv-row-${desc.key}`}
      data-locked={dep.enabled ? "false" : "true"}
    >
      <div className="settings-row-info">
        <p className="settings-row-label">{desc.label}</p>
        <p className="settings-row-description">{desc.text}</p>
        <p className="settings-row-default" data-testid={`sv-default-${desc.key}`}>
          <span>Effective default:</span> {formatDefault(desc.key)}
          {siteDefault && <><span className="settings-row-default-sep">·</span><span>Site default:</span> <span data-testid={`sv-site-default-${desc.key}`} style={{ fontWeight: 400 }}>{siteDefault}</span></>}
        </p>
        {!dep.enabled && <p className="settings-row-reason" data-testid={`sv-reason-${desc.key}`}>{dep.reason}</p>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
};

const GroupCard = ({ id, title, text, children }) => (
  <section className="sv-group" data-testid={`sv-group-${id}`}>
    <header className="sv-group-head">
      <h3 className="sv-group-title">{title}</h3>
      <p className="sv-group-text">{text}</p>
    </header>
    <div className="sv-group-body">{children}</div>
  </section>
);

const SkeletonRow = ({ cols = 5 }) => (
  <tr className="skeleton-row">
    {Array.from({ length: cols }).map((_, i) => (
      <td key={i}><span className="skeleton-bar skeleton-cell" /></td>
    ))}
  </tr>
);

const SkeletonDropdownItem = () => (
  <div className="skeleton-dropdown-item">
    <span className="skeleton-bar skeleton-avatar" />
    <span className="skeleton-bar skeleton-name" />
  </div>
);

const SkeletonCard = () => (
  <div className="artifact-card" style={{ opacity: 0.5 }}>
    <div className="card-row card-row-primary">
      <span className="card-filename"><span className="skeleton-bar" style={{ width: "60%", height: 14 }} /></span>
      <span className="card-row-right"><span className="skeleton-bar" style={{ width: 60, height: 20, borderRadius: 9999 }} /></span>
    </div>
    <div className="card-row card-row-secondary" style={{ marginTop: 4 }}>
      <span className="skeleton-bar" style={{ width: "40%", height: 10 }} />
    </div>
  </div>
);

const ArtifactTypeIcon = ({ mediaType }) => {
  const isImage = mediaType?.startsWith("image/");
  const isPdf = mediaType === "application/pdf";
  // it57: off-palette green/orange → neutral tokens (the icon shape differentiates the file type).
  const color = isImage || isPdf ? "var(--sv-text-secondary)" : "var(--sv-text-subtle)";
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="file-icon">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke={color} strokeWidth="1.5" />
      <polyline points="14,2 14,8 20,8" stroke={color} strokeWidth="1.5" />
    </svg>
  );
};

const ColumnPicker = ({ columns, visible, onChange, isOpen, onToggle }) => {
  const ref = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onToggle(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [isOpen]);

  return (
    <div className="column-picker" ref={ref}>
      <button
        className="column-picker-trigger"
        onClick={() => onToggle(!isOpen)}
        title="Choose which columns to display"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        Properties
      </button>
      {isOpen && (
        <div className="column-picker-dropdown">
          {columns.map((col) => (
            <label key={col.key} className="column-picker-option">
              <input
                type="checkbox"
                checked={!!visible[col.key]}
                disabled={col.alwaysOn}
                onChange={() => onChange(col.key)}
              />
              <span>{col.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

const REALM_COLUMNS = [
  { key: "name",     label: "Name",      defaultOn: true, alwaysOn: true },
  { key: "status",   label: "Status",    defaultOn: true },
  { key: "sealedBy", label: "Sealed by", defaultOn: true },
  { key: "location", label: "Location",  defaultOn: true },
  { key: "fileSize", label: "File Size", defaultOn: false },
  { key: "sealedOn", label: "Sealed on", defaultOn: false },
  { key: "lapses",   label: "Expires",    defaultOn: true },
  { key: "actions",  label: "Actions",   defaultOn: true, alwaysOn: true },
];

const REALM_SORT_FIELDS = [
  { key: "title", label: "Name" },
  { key: "lockedBy", label: "Sealed by" },
  { key: "pageTitle", label: "Location" },
  { key: "lockedOn", label: "Sealed on" },
  { key: "expiresAt", label: "Expires" },
];

const buildDefaults = (cols) =>
  cols.reduce((acc, col) => ({ ...acc, [col.key]: col.defaultOn }), {});

const SortPicker = ({ orderField, orderDir, onSort }) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [isOpen]);

  const fields = REALM_SORT_FIELDS;
  const currentLabel = fields.find(f => f.key === orderField)?.label || "Name";
  const arrow = orderDir === "asc" ? "\u2191" : "\u2193";

  return (
    <div className="sort-picker" ref={ref}>
      <button className="column-picker-trigger" onClick={() => setIsOpen(!isOpen)} title="Change sort order">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 5h10M11 9h7M11 13h4M3 17l3 3 3-3M6 18V4" />
        </svg>
        {currentLabel} {arrow}
      </button>
      {isOpen && (
        <div className="column-picker-dropdown">
          {fields.map((f) => (
            <div
              key={f.key}
              className={`column-picker-option ${f.key === orderField ? "selected" : ""}`}
              style={{ cursor: "pointer", fontWeight: f.key === orderField ? 600 : 400 }}
              onClick={() => { onSort(f.key); setIsOpen(false); }}
            >
              <span>{f.label}</span>
              {f.key === orderField && <span style={{ marginLeft: "auto", fontSize: "11px" }}>{arrow}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const RealmClaimedCard = ({ artifact, onForceRelease, onWatch, isWatching, forceReleaseActive, visibleColumns, busyAction, siteUrl }) => {
  // Break-glass (3.5): a space admin releasing someone else's seal must type a reason; it is
  // recorded on the activity row and shown in every trail. No native prompt — an inline bar.
  const [showForce, setShowForce] = useState(false);
  const [forceReason, setForceReason] = useState("");
  const submitForce = () => { if (forceReason.trim().length >= 3) { onForceRelease(artifact.id, forceReason.trim()); setShowForce(false); setForceReason(""); } };
  const [expanded, setExpanded] = useState(false);
  const [cachedPreview, setCachedPreview] = useState(null);
  // Fix 5: stale-parity with the overlay/panel (incident 2026-07-22: a trashed attachment's
  // seal rendered here as a normal live row). Same badge vocabulary as the overlay.
  const isStale = artifact.isStale === true;
  const isRecoverable = artifact.staleReason === "trashed";
  let statusClass = artifact.isExpired ? "expired" : "locked";
  let statusText = artifact.isExpired ? "Expired" : "Sealed"; // SEC-3: one word for a lapsed seal
  if (isStale && isRecoverable) { statusClass = "trashed"; statusText = "Trash"; }
  else if (isStale) { statusClass = "stale"; statusText = "Missing"; }
  const isImage = artifact.mediaType?.startsWith("image/");
  const numericAttId = artifact.id ? artifact.id.replace(/^att/, "") : null;
  const downloadHref = siteUrl && artifact.pageId && artifact.title
    ? `${siteUrl}/wiki/download/attachments/${artifact.pageId}/${encodeURIComponent(artifact.title)}?api=v2`
    : null;
  const pageSlug = artifact.pageTitle ? artifact.pageTitle.replace(/\s+/g, "+") : null;
  const viewUrl = siteUrl && artifact.spaceKey && artifact.pageId && numericAttId && artifact.title && pageSlug
    ? `${siteUrl}/wiki/spaces/${artifact.spaceKey}/pages/${artifact.pageId}/${pageSlug}?preview=/${artifact.pageId}/${numericAttId}/${encodeURIComponent(artifact.title)}`
    : null;
  const propertiesUrl = siteUrl && artifact.pageId && artifact.title
    ? `${siteUrl}/wiki/pages/editattachment.action?pageId=${artifact.pageId}&fileName=${encodeURIComponent(artifact.title)}&isFromPageView=true`
    : null;

  const vc = visibleColumns || {};

  const metaItems = [];
  if (vc.sealedBy !== false && artifact.lockedBy) metaItems.push(
    <span key="owner" className="card-meta-owner">
      <span className="card-meta-owner-label">Sealed by</span>
      <span>{artifact.lockedBy}</span>
    </span>
  );
  if (vc.location !== false && artifact.pageTitle) metaItems.push(<span key="loc" className="card-meta-item">{artifact.pageTitle}</span>);
  if (vc.fileSize !== false && artifact.fileSize) metaItems.push(<span key="size" className="card-meta-item">{artifact.fileSize}</span>);
  if (vc.sealedOn !== false && artifact.lockedOn) {
    const d = new Date(artifact.lockedOn);
    metaItems.push(<span key="date" className="card-meta-item">{d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>);
  }
  // Lapses (rolls up to days for long seals — shared formatter)
  if (vc.lapses !== false && artifact.expiresAt) {
    const label = formatRemaining(artifact.expiresAt);
    metaItems.push(
      <span key="lapses" className="card-meta-item" style={label === "Expired" ? { color: "var(--sv-status-warning)" } : undefined}>{label}</span>,
    );
  }

  return (
    <div className={`artifact-card status-${statusClass}`}>
      <div className="card-row card-row-primary">
        <span className="card-filename">
          <button
            className={`card-expand-toggle ${expanded ? "is-expanded" : ""}`}
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
            title={expanded ? "Collapse details" : "Show details"}
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            </svg>
          </button>
          {/* F3 (owner feedback 2026-08-27): show which image this actually is. */}
          {isImage && artifact.pageId ? (
            <ThumbnailPreview
              artifactId={artifact.id}
              contentId={artifact.pageId}
              variant="thumb"
              alt={artifact.title}
              cachedDataUri={cachedPreview}
              onCached={setCachedPreview}
              onClick={viewUrl ? () => router.open(viewUrl) : undefined}
            />
          ) : (
            <ArtifactTypeIcon mediaType={artifact.mediaType} />
          )}
          {downloadHref ? (
            <a className="card-filename-text card-filename-link" href={downloadHref} onClick={(e) => { e.preventDefault(); router.open(downloadHref); }} title={`Download ${artifact.title}`}>
              {artifact.title}
            </a>
          ) : (
            <span className="card-filename-text">{artifact.title}</span>
          )}
        </span>
        <span className="card-row-right">
          {vc.status !== false && (
            <span className={`status-lozenge ${statusClass}`}>{statusText}</span>
          )}
          {vc.actions !== false && forceReleaseActive && onForceRelease && (
            <button className={`action-btn unlock ${busyAction === "unseal" ? "is-busy" : ""}`} onClick={() => setShowForce((v) => !v)} disabled={busyAction && busyAction !== "unseal"} title="Release this file as a space admin — a reason is required and recorded">
              {busyAction === "unseal" ? <>Releasing<span className="btn-busy-bar" /></> : "Force release"}
            </button>
          )}
        </span>
      </div>
      {showForce && (
        <div className="card-row card-reason-bar">
          <input
            className="card-reason-input"
            placeholder="Why are you releasing this seal? (required, 3–300 characters)"
            value={forceReason}
            maxLength={300}
            autoFocus
            onChange={(e) => setForceReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitForce(); if (e.key === "Escape") { setShowForce(false); setForceReason(""); } }}
          />
          <span className="confirm-actions">
            <button className="action-btn unlock" disabled={forceReason.trim().length < 3 || busyAction === "unseal"} onClick={submitForce}>Release</button>
            <button className="action-btn confirm-no" onClick={() => { setShowForce(false); setForceReason(""); }}>Cancel</button>
          </span>
        </div>
      )}
      {metaItems.length > 0 && (
        <div className="card-row card-row-secondary">
          <span className="card-secondary-left">
            <span className="card-meta">
              {metaItems.reduce((acc, item, i) => {
                if (i > 0) acc.push(<span key={`sep-${i}`} className="card-meta-sep">&middot;</span>);
                acc.push(item);
                return acc;
              }, [])}
            </span>
          </span>
          <span className="card-secondary-right">
            {onWatch && (
              <button className={`action-btn watch ${isWatching ? "watching" : ""} ${busyAction === "watch" ? "is-busy" : ""}`} onClick={() => onWatch(artifact.id)} disabled={busyAction && busyAction !== "watch"} title={isWatching ? "Stop watching this file" : "Get notified when this file is unsealed"}>
                {busyAction === "watch" ? <>Updating<span className="btn-busy-bar" /></> : (isWatching ? "Watching" : "Watch")}
              </button>
            )}
          </span>
        </div>
      )}

      {/* Expand panel: thumbnail + view link */}
      {expanded && (
        <div className="card-row card-row-expand">
          {isImage && artifact.pageId && <ThumbnailPreview artifactId={artifact.id} contentId={artifact.pageId} alt={artifact.title} cachedDataUri={cachedPreview} onCached={setCachedPreview} />}
          {(viewUrl || propertiesUrl) && (
            <div className="card-expand-links">
              {viewUrl && <a href={viewUrl} onClick={(e) => { e.preventDefault(); router.open(viewUrl); }} className="card-expand-link">View</a>}
              {propertiesUrl && <a href={propertiesUrl} onClick={(e) => { e.preventDefault(); router.open(propertiesUrl); }} className="card-expand-link">Properties</a>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const MyClaimedCard = ({ artifact, onRelease, onExtend, busyAction, siteUrl }) => {
  const [expanded, setExpanded] = useState(false);
  const [cachedPreview, setCachedPreview] = useState(null);
  const isExpired = artifact.isExpired || (artifact.expiresAt && new Date(artifact.expiresAt) < new Date());
  const statusClass = isExpired ? "expired" : "locked-by-me";
  const statusText = isExpired ? "Expired" : "Sealed by you"; // SEC-3
  const isImage = artifact.mediaType?.startsWith("image/");
  const numericAttId = artifact.id ? artifact.id.replace(/^att/, "") : null;
  const downloadHref = siteUrl && artifact.pageId && artifact.title
    ? `${siteUrl}/wiki/download/attachments/${artifact.pageId}/${encodeURIComponent(artifact.title)}?api=v2`
    : null;
  const pageSlug = artifact.pageTitle ? artifact.pageTitle.replace(/\s+/g, "+") : null;
  const viewUrl = siteUrl && artifact.spaceKey && artifact.pageId && numericAttId && artifact.title && pageSlug
    ? `${siteUrl}/wiki/spaces/${artifact.spaceKey}/pages/${artifact.pageId}/${pageSlug}?preview=/${artifact.pageId}/${numericAttId}/${encodeURIComponent(artifact.title)}`
    : null;
  const propertiesUrl = siteUrl && artifact.pageId && artifact.title
    ? `${siteUrl}/wiki/pages/editattachment.action?pageId=${artifact.pageId}&fileName=${encodeURIComponent(artifact.title)}&isFromPageView=true`
    : null;

  const metaItems = [];
  if (artifact.pageTitle) metaItems.push(<span key="loc" className="card-meta-item">{artifact.pageTitle}</span>);
  if (artifact.spaceName || artifact.spaceKey) metaItems.push(<span key="space" className="card-meta-item">{artifact.spaceName || artifact.spaceKey}</span>);
  if (artifact.lockedOn) {
    const d = new Date(artifact.lockedOn);
    metaItems.push(<span key="date" className="card-meta-item">{d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>);
  }
  if (artifact.expiresAt && new Date(artifact.expiresAt) > new Date()) {
    metaItems.push(<span key="lapses" className="card-meta-item">{formatRemaining(artifact.expiresAt)}</span>);
  }

  return (
    <div className={`artifact-card status-${statusClass}`}>
      <div className="card-row card-row-primary">
        <span className="card-filename">
          <button
            className={`card-expand-toggle ${expanded ? "is-expanded" : ""}`}
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
            title={expanded ? "Collapse details" : "Show details"}
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            </svg>
          </button>
          {/* F3 (owner feedback 2026-08-27): show which image this actually is. */}
          {isImage && artifact.pageId ? (
            <ThumbnailPreview
              artifactId={artifact.id}
              contentId={artifact.pageId}
              variant="thumb"
              alt={artifact.title}
              cachedDataUri={cachedPreview}
              onCached={setCachedPreview}
              onClick={viewUrl ? () => router.open(viewUrl) : undefined}
            />
          ) : (
            <ArtifactTypeIcon mediaType={artifact.mediaType} />
          )}
          {downloadHref ? (
            <a className="card-filename-text card-filename-link" href={downloadHref} onClick={(e) => { e.preventDefault(); router.open(downloadHref); }} title={`Download ${artifact.title}`}>
              {artifact.title}
            </a>
          ) : (
            <span className="card-filename-text">{artifact.title}</span>
          )}
        </span>
        <span className="card-row-right">
          <span className={`status-lozenge ${statusClass}`}>{statusText}</span>
          {/* F4: renew the retention period rather than unseal-and-seal-again. */}
          {onExtend && (
            <button className={`action-btn extend ${busyAction === "extend" ? "is-busy" : ""}`} onClick={() => onExtend(artifact.id)} disabled={busyAction && busyAction !== "extend"} title="Give this seal a fresh retention period">
              {busyAction === "extend" ? <>Extending<span className="btn-busy-bar" /></> : "Extend"}
            </button>
          )}
          {onRelease && (
            <button className={`action-btn release ${busyAction === "unseal" ? "is-busy" : ""}`} onClick={() => onRelease(artifact.id)} disabled={busyAction && busyAction !== "unseal"} title="Release your seal and allow others to modify this file">
              {busyAction === "unseal" ? <>Releasing<span className="btn-busy-bar" /></> : "Release"}
            </button>
          )}
        </span>
      </div>
      {metaItems.length > 0 && (
        <div className="card-row card-row-secondary">
          <span className="card-secondary-left">
            <span className="card-meta">
              {metaItems.reduce((acc, item, i) => {
                if (i > 0) acc.push(<span key={`sep-${i}`} className="card-meta-sep">&middot;</span>);
                acc.push(item);
                return acc;
              }, [])}
            </span>
          </span>
        </div>
      )}

      {/* Expand panel: thumbnail + view link */}
      {expanded && (
        <div className="card-row card-row-expand">
          {isImage && artifact.pageId && <ThumbnailPreview artifactId={artifact.id} contentId={artifact.pageId} alt={artifact.title} cachedDataUri={cachedPreview} onCached={setCachedPreview} />}
          {(viewUrl || propertiesUrl) && (
            <div className="card-expand-links">
              {viewUrl && <a href={viewUrl} onClick={(e) => { e.preventDefault(); router.open(viewUrl); }} className="card-expand-link">View</a>}
              {propertiesUrl && <a href={propertiesUrl} onClick={(e) => { e.preventDefault(); router.open(propertiesUrl); }} className="card-expand-link">Properties</a>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const RealmPolicyDashboard = () => {
  const [defRev, setDefRev] = useState(0); // B1: bumps when a workflow definition is saved
  const [wfView, setWfView] = useState("settings"); // WF-11: "settings" (one Save) | "states" (the definitions, their own Save each)
  const [activeTab, setActiveTab] = useState("my-claims");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [messageType, setMessageType] = useState(null); // 'success' or 'error'
  const [realmKey, setRealmKey] = useState(null);
  const [realmId, setRealmId] = useState(null);
  const [siteUrl, setSiteUrl] = useState(null);
  const [realmName, setRealmName] = useState("Current Space");

  const [realmPrefs, setRealmPrefs] = useState({
    autoUnlockTimeoutHours: null,
    adminUsers: [],
    adminGroups: [],
    // P1-4: "normal" | "quiet" — quiet posts no comments / @mentions in this space.
    notificationsMode: "normal",
    // CLS-1: "inherit" | "off" — off hides classification on this space's pages (levels kept).
    classification: "inherit",
  });

  const [reservedFiles, setReservedFiles] = useState([]);
  // New state for fetched teams
  const [teamList, setTeamList] = useState([]);
  // Operator search state
  const [operatorQuery, setOperatorQuery] = useState("");
  const [operatorResults, setOperatorResults] = useState([]);
  const [isSearchingOperators, setIsSearchingOperators] = useState(false);
  const [showOperatorDropdown, setShowOperatorDropdown] = useState(false);
  // Teams custom dropdown state
  const [showTeamDropdown, setShowTeamDropdown] = useState(false);
  const [teamSearchTerm, setTeamSearchTerm] = useState("");
  // The site's effective policy (schema-coerced) — the "Site default: …" every space override shows.
  const [siteValues, setSiteValues] = useState(() => readAllEffective("global", null));
  // Steward override state
  const [forceReleaseActive, setForceReleaseActive] = useState(true);
  // Track global auto-unlock enabled status
  const [systemExpiryAlertsActive, setSystemExpiryAlertsActive] = useState(true);
  // Track dispatch request state per artifact
  const [watchStatus, setWatchStatus] = useState({});
  // Track which artifact + action is currently in flight
  const [busyAction, setBusyAction] = useState(null);

  // Pagination state for sealed artifacts
  const [moreFilesAvailable, setMoreFilesAvailable] = useState(false);
  const [nextFileCursor, setNextFileCursor] = useState(null);
  const [fetchingMoreFiles, setFetchingMoreFiles] =
    useState(false);

  // Pagination state for operators (initial load and search)
  const [hasMoreOperators, setHasMoreOperators] = useState(false);
  const [nextOperatorsStart, setNextOperatorsStart] = useState(null);
  const [isLoadingMoreOperators, setIsLoadingMoreOperators] = useState(false);
  const [currentSearchQuery, setCurrentSearchQuery] = useState("");

  // Pagination state for teams
  const [hasMoreTeams, setHasMoreTeams] = useState(false);
  const [nextTeamsStart, setNextTeamsStart] = useState(null);
  const [isLoadingMoreTeams, setIsLoadingMoreTeams] = useState(false);

  // Page size selector for sealed artifacts
  const [artifactsPageSize, setArtifactsPageSize] = useState(10);

  // Background scan state
  const [scanStatus, setScanStatus] = useState(null); // null | "queued" | "processing" | "completed" | "failed"
  const [isScanning, setIsScanning] = useState(false);

  // Column/sort picker state
  const [realmVisibleColumns, setRealmVisibleColumns] = useState(buildDefaults(REALM_COLUMNS));
  const [realmColumnPickerOpen, setRealmColumnPickerOpen] = useState(false);
  const [realmSortField, setRealmSortField] = useState("title");
  const [realmSortDir, setRealmSortDir] = useState("asc");

  // Steward search toggle state
  const [showOperatorSearch, setShowOperatorSearch] = useState(false);
  const [showGuildSearch, setShowGuildSearch] = useState(false);

  // Role and my-claims state
  const [userRole, setUserRole] = useState("user");
  const [myClaimedFiles, setMyClaimedFiles] = useState([]);
  const [myClaimsLoading, setMyClaimsLoading] = useState(false);
  const [stewardRequestSent, setStewardRequestSent] = useState(false);
  // "none" | "pending" | "denied"
  const [stewardRequestStatus, setStewardRequestStatus] = useState("none");
  const [stewardRequestDeniedAt, setStewardRequestDeniedAt] = useState(null);

  // Pending steward requests (steward-only)
  const [pendingRequests, setPendingRequests] = useState([]);
  const [pendingRequestsLoading, setPendingRequestsLoading] = useState(false);
  const [requestActionBusy, setRequestActionBusy] = useState(null); // { id: accountId, action: "approve"|"deny" }
  // Edit Requests inbox (owner approves who can edit their sealed attachments)
  const [editRequests, setEditRequests] = useState([]);
  const [editRequestsLoading, setEditRequestsLoading] = useState(false);
  const [editReqBusy, setEditReqBusy] = useState(null); // { id: "artifactId:accountId", action }

  useEffect(() => {
    const bootstrapRealm = async () => {
      try {
        // Initialize theme detection
        await enablePaletteSync();

        setLoading(true);
        const context = await view.getContext();

        // ACTUAL structure from real context output: context.extension.space.key
        const realmKeyValue = context?.extension?.space?.key;
        const realmIdValue = context?.extension?.space?.id;

        setSiteUrl(context?.siteUrl || null);

        if (realmKeyValue && realmIdValue) {
          setRealmKey(realmKeyValue);
          setRealmId(realmIdValue);

          // Get realm name from Confluence API since it's not in context
          try {
            const realmResponse = await invoke("identify-realm", {
              spaceKey: realmKeyValue,
            });
            setRealmName(realmResponse?.name || "Current Space");
          } catch (err) {
            console.warn("Failed to get realm name, using default");
            setRealmName("Current Space");
          }

          // Check user role
          try {
            const roleResult = await invoke("check-user-role", { spaceKey: realmKeyValue });
            if (roleResult?.role === "steward") {
              setUserRole("steward");
              setActiveTab("locked-attachments");
              // Pre-fetch pending steward requests so the badge count shows immediately
              try {
                const reqResult = await invoke("list-steward-requests", { spaceKey: realmKeyValue });
                setPendingRequests(reqResult?.requests || []);
              } catch (e) { /* non-critical */ }
            } else {
              setUserRole("user");
              setActiveTab("my-claims");
              fetchMyClaimedFiles();
              fetchMyEditRequests();
              // Check if this user already has a pending or denied steward request
              try {
                const reqCheck = await invoke("check-steward-request", { spaceKey: realmKeyValue });
                if (reqCheck?.status === "pending") {
                  setStewardRequestSent(true);
                  setStewardRequestStatus("pending");
                } else if (reqCheck?.status === "denied") {
                  setStewardRequestStatus("denied");
                  setStewardRequestDeniedAt(reqCheck.deniedAt);
                }
              } catch (e) { /* non-critical */ }
            }
          } catch (err) {
            console.warn("Failed to check user role, defaulting to user");
            setUserRole("user");
            setActiveTab("my-claims");
          }

          // Fetch global settings to check auto-unlock status
          const globalSettings = await invoke("load-policy", {
            scope: "global",
          });
          setSystemExpiryAlertsActive(
            globalSettings?.autoUnlockEnabled !== false,
          );
          setSiteValues(readAllEffective("global", globalSettings));

          const settings = await invoke("load-policy", {
            scope: "space",
            key: realmKeyValue,
          });

          // `activation` is gone: no server reader ever resolved it (UX review §3.2), so the
          // console no longer offers it and store-policy drops the key.
          setRealmPrefs({
            autoUnlockTimeoutHours: settings?.autoUnlockTimeoutHours || null,
            adminUsers: settings?.adminUsers || [],
            adminGroups: settings?.adminGroups || [],
            autoInsertMacro: settings?.autoInsertMacro !== false,
            // it57: was never loaded → the saved insert position silently reset to "bottom" on every reload.
            macroInsertPosition: settings?.macroInsertPosition || "bottom",
            // P1-4: anything but "quiet" reads as "normal" (same coercion the server applies).
            notificationsMode: settings?.notificationsMode === "quiet" ? "quiet" : "normal",
            classification: settings?.classification === "off" ? "off" : "inherit",
          });
          // it26 (LIVE-BROWSER FIX): the essential data (space key, role, policy) is loaded —
          // RENDER the console NOW. The seals list + the group/user dropdown pre-fills are
          // SECONDARY; awaiting them blocked first paint, so a slow or HANGING Confluence
          // user/group search (enumerate-operators/enumerate-teams) left the whole console
          // stuck FOREVER on the "Preparing…" spinner in real Confluence — invisible to the
          // mock screenshot harness. Load them in the background; each already self-handles errors.
          setLoading(false);
          Promise.allSettled([
            fetchReservedFiles(realmKeyValue, realmIdValue),
            fetchAllTeams(),
            fetchInitialOperators(),
            checkStewardOverrideStatus(),
            fetchMyClaimedFiles(),
          ]);
        } else {
          console.error("No realm key found in context.extension.space.key");
          console.error("Extension object:", context?.extension);
          setMessage(
            "Unable to determine space identifier. Review console for specifics.",
          );
          setMessageType("error");
        }
      } catch (err) {
        console.error("Failed to initialize realm console:", err);
        setMessage(`Space settings could not be loaded: ${err.message}`);
        setMessageType("error");
      } finally {
        setLoading(false);
      }
    };

    bootstrapRealm();
  }, []);

  const fetchAllTeams = async (append = false, startOverride = null) => {
    try {
      const start = startOverride !== null ? startOverride : 0;
      const result = await invoke("enumerate-teams", {
        start,
        limit: 200,
      });

      if (append) {
        setTeamList((prev) => [...prev, ...(result.groups || [])]);
      } else {
        setTeamList(result.groups || []);
      }

      setHasMoreTeams(result.hasMore || false);
      setNextTeamsStart(result.nextStart || null);
    } catch (error) {
      setMessage(`Unable to fetch groups: ${error.message}`);
      setMessageType("error");
    }
  };

  const fetchInitialOperators = async (append = false, startOverride = null) => {
    try {
      const start = startOverride !== null ? startOverride : 0;
      const result = await invoke("enumerate-operators", {
        start,
        limit: 10,
      });

      if (append) {
        setOperatorResults((prev) => [...prev, ...(result.users || [])]);
      } else {
        setOperatorResults(result.users || []);
      }

      setHasMoreOperators(result.hasMore || false);
      setNextOperatorsStart(result.nextStart || null);
    } catch (error) {
      // Silent fail - operator can still search manually
    }
  };

  const checkStewardOverrideStatus = async () => {
    try {
      const result = await invoke("steward-override-enabled");
      setForceReleaseActive(result.enabled);
    } catch (error) {
      setForceReleaseActive(false);
    }
  };

  const fetchMyClaimedFiles = async () => {
    setMyClaimsLoading(true);
    try {
      const result = await invoke("enumerate-operator-seals", { cursor: null, limit: 50 });
      setMyClaimedFiles(result?.attachments || []);
    } catch (e) {
      console.error("Failed to fetch my claims:", e);
    } finally {
      setMyClaimsLoading(false);
    }
  };

  const [stewardRequestBusy, setStewardRequestBusy] = useState(false);

  const handleRequestSteward = async () => {
    setStewardRequestBusy(true);
    try {
      await invoke("request-steward-access", { spaceKey: realmKey });
      setStewardRequestSent(true);
    } catch (e) {
      console.error("Steward request failed:", e);
    } finally {
      setStewardRequestBusy(false);
    }
  };

  const fetchPendingRequests = async () => {
    if (!realmKey) return;
    setPendingRequestsLoading(true);
    try {
      const result = await invoke("list-steward-requests", { spaceKey: realmKey });
      setPendingRequests(result?.requests || []);
    } catch (e) {
      console.error("Failed to fetch steward requests:", e);
    } finally {
      setPendingRequestsLoading(false);
    }
  };

  const handleApproveRequest = async (requestAccountId) => {
    setRequestActionBusy({ id: requestAccountId, action: "approve" });
    try {
      const result = await invoke("approve-steward-request", { requestAccountId, spaceKey: realmKey });
      if (result?.success) {
        setPendingRequests((prev) => prev.filter((r) => r.accountId !== requestAccountId));
        // Reload realm settings so the new steward appears in the Stewards grid
        try {
          const refreshed = await invoke("load-policy", { scope: "space", key: realmKey });
          setRealmPrefs((prev) => ({ ...prev, adminUsers: refreshed?.adminUsers || prev.adminUsers }));
        } catch (e) { /* non-critical */ }
        setMessage("Space admin access granted.");
        setMessageType("success");
      } else {
        setMessage(result?.reason || "Failed to approve request.");
        setMessageType("error");
      }
    } catch (e) {
      console.error("Approve request failed:", e);
      setMessage("Failed to approve request.");
      setMessageType("error");
    } finally {
      setRequestActionBusy(null);
    }
  };

  const handleDenyRequest = async (requestAccountId) => {
    setRequestActionBusy({ id: requestAccountId, action: "deny" });
    try {
      await invoke("deny-steward-request", { requestAccountId, spaceKey: realmKey });
      setPendingRequests((prev) => prev.filter((r) => r.accountId !== requestAccountId));
      setMessage("Request denied.");
      setMessageType("success");
    } catch (e) {
      console.error("Deny request failed:", e);
    } finally {
      setRequestActionBusy(null);
    }
  };

  // --- Edit Requests inbox (owner approves who can edit their sealed files) ---
  const fetchMyEditRequests = async () => {
    setEditRequestsLoading(true);
    try {
      const result = await invoke("list-my-edit-requests", {});
      setEditRequests(result?.requests || []);
    } catch (e) {
      console.error("Fetch edit requests failed:", e);
      setEditRequests([]);
    } finally {
      setEditRequestsLoading(false);
    }
  };

  const handleApproveEdit = async (artifactId, requesterAccountId) => {
    setEditReqBusy({ id: `${artifactId}:${requesterAccountId}`, action: "approve" });
    try {
      const result = await invoke("approve-edit-request", { attachmentId: artifactId, requesterAccountId });
      if (result?.success) {
        setEditRequests((prev) => prev.filter((r) => !(r.artifactId === artifactId && r.requesterAccountId === requesterAccountId)));
        setMessage("Edit access granted.");
        setMessageType("success");
      } else {
        setMessage(result?.reason || "Could not grant edit access.");
        setMessageType("error");
      }
    } catch (e) {
      console.error("Approve edit failed:", e);
    } finally {
      setEditReqBusy(null);
    }
  };

  const handleDenyEdit = async (artifactId, requesterAccountId) => {
    setEditReqBusy({ id: `${artifactId}:${requesterAccountId}`, action: "deny" });
    try {
      const result = await invoke("deny-edit-request", { attachmentId: artifactId, requesterAccountId });
      if (result?.success) {
        setEditRequests((prev) => prev.filter((r) => !(r.artifactId === artifactId && r.requesterAccountId === requesterAccountId)));
        setMessage("Edit request declined.");
        setMessageType("success");
      } else {
        // F1 parity: approve already surfaced its refusal here; deny silently did nothing.
        setMessage(result?.reason || "Could not decline the request.");
        setMessageType("error");
      }
    } catch (e) {
      console.error("Deny edit failed:", e);
    } finally {
      setEditReqBusy(null);
    }
  };

  // Infinite scroll detection for sealed artifacts with debouncing
  useEffect(() => {
    let scrollContainer = null;
    let scrollTimeout = null;

    const handleScroll = () => {
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }

      scrollTimeout = setTimeout(() => {
        if (!scrollContainer) return;
        if (!moreFilesAvailable || fetchingMoreFiles) return;

        const { scrollTop, scrollHeight, clientHeight } = scrollContainer;

        // Load more when operator scrolls within 100px of bottom
        if (scrollHeight - scrollTop - clientHeight < 100) {
          fetchNextFilePage();
        }
      }, 150);
    };

    // Use MutationObserver to detect when the scrollable div is added to DOM
    const observer = new MutationObserver(() => {
      const container = document.querySelector(".attachments-table");
      if (container && container !== scrollContainer) {
        if (scrollContainer) {
          scrollContainer.removeEventListener("scroll", handleScroll);
        }
        scrollContainer = container;
        scrollContainer.addEventListener("scroll", handleScroll);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Initial check
    scrollContainer = document.querySelector(".attachments-table");
    if (scrollContainer) {
      scrollContainer.addEventListener("scroll", handleScroll);
    }

    return () => {
      observer.disconnect();
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }
      if (scrollContainer) {
        scrollContainer.removeEventListener("scroll", handleScroll);
      }
    };
  }, [moreFilesAvailable, fetchingMoreFiles, nextFileCursor]);

  // Infinite scroll detection for operators dropdown with debouncing
  useEffect(() => {
    let operatorDropdown = null;
    let scrollTimeout = null;

    const handleScroll = () => {
      // Debounce scroll events to prevent rapid firing
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }

      scrollTimeout = setTimeout(() => {
        if (!operatorDropdown) {
          operatorDropdown = document.querySelector(
            ".search-dropdown.user-search-dropdown",
          );
          if (!operatorDropdown) return;
        }

        const scrollTop = operatorDropdown.scrollTop;
        const scrollHeight = operatorDropdown.scrollHeight;
        const clientHeight = operatorDropdown.clientHeight;

        if (scrollHeight - scrollTop - clientHeight < 100) {
          fetchNextOperatorPage();
        }
      }, 150); // 150ms debounce
    };

    // Use MutationObserver to detect when dropdown is added to DOM
    const observer = new MutationObserver(() => {
      const dropdown = document.querySelector(
        ".search-dropdown.user-search-dropdown",
      );
      if (dropdown && dropdown !== operatorDropdown) {
        if (operatorDropdown) {
          operatorDropdown.removeEventListener("scroll", handleScroll);
        }
        operatorDropdown = dropdown;
        operatorDropdown.addEventListener("scroll", handleScroll);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Initial check
    operatorDropdown = document.querySelector(
      ".search-dropdown.user-search-dropdown",
    );
    if (operatorDropdown) {
      operatorDropdown.addEventListener("scroll", handleScroll);
    }

    return () => {
      observer.disconnect();
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }
      if (operatorDropdown) {
        operatorDropdown.removeEventListener("scroll", handleScroll);
      }
    };
  }, [hasMoreOperators, isLoadingMoreOperators, nextOperatorsStart, currentSearchQuery]);

  // Infinite scroll detection for teams dropdown with debouncing
  useEffect(() => {
    let teamDropdown = null;
    let scrollTimeout = null;

    const handleScroll = () => {
      // Debounce scroll events to prevent rapid firing
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }

      scrollTimeout = setTimeout(() => {
        if (!teamDropdown) {
          teamDropdown = document.querySelector(".search-dropdown");
          if (!teamDropdown) return;
        }

        const scrollTop = teamDropdown.scrollTop;
        const scrollHeight = teamDropdown.scrollHeight;
        const clientHeight = teamDropdown.clientHeight;

        if (scrollHeight - scrollTop - clientHeight < 100) {
          fetchNextTeamPage();
        }
      }, 150); // 150ms debounce
    };

    // Use MutationObserver to detect when dropdown is added to DOM
    const observer = new MutationObserver(() => {
      const dropdown = document.querySelector(".search-dropdown");
      // We need to make sure this is the teams dropdown, not operators dropdown
      if (dropdown && !dropdown.classList.contains("user-search-dropdown")) {
        if (dropdown !== teamDropdown) {
          if (teamDropdown) {
            teamDropdown.removeEventListener("scroll", handleScroll);
          }
          teamDropdown = dropdown;
          teamDropdown.addEventListener("scroll", handleScroll);
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Initial check
    teamDropdown = document.querySelector(".search-dropdown");
    if (
      teamDropdown &&
      !teamDropdown.classList.contains("user-search-dropdown")
    ) {
      teamDropdown.addEventListener("scroll", handleScroll);
    }

    return () => {
      observer.disconnect();
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }
      if (teamDropdown) {
        teamDropdown.removeEventListener("scroll", handleScroll);
      }
    };
  }, [hasMoreTeams, isLoadingMoreTeams, nextTeamsStart]);

  const fetchReservedFiles = async (
    key,
    id,
    append = false,
    startOverride = null,
    pageSizeOverride = null,
  ) => {
    if (!key || !id) {
      return;
    }

    try {
      const cursor = startOverride !== null ? startOverride : null;
      const limit =
        pageSizeOverride !== null ? pageSizeOverride : artifactsPageSize;
      const result = await invoke("enumerate-realm-seals", {
        spaceKey: key,
        spaceId: id,
        cursor,
        limit,
      });

      if (append) {
        setReservedFiles((prev) => [
          ...prev,
          ...(result.attachments || []),
        ]);
      } else {
        setReservedFiles(result.attachments || []);
      }

      setMoreFilesAvailable(result.hasMore || false);
      setNextFileCursor(result.nextCursor || null);
    } catch (err) {
      setMessage(`Could not load sealed files: ${err.message}`);
      setMessageType("error");
    }
  };

  const onReconstructIndex = async () => {
    if (!realmKey || !realmId || isScanning) return;

    try {
      setIsScanning(true);
      setScanStatus("queued");
      setMessage("Reconstructing sealed files index in the background...");
      setMessageType("success");

      const result = await invoke("launch-realm-audit", {
        spaceKey: realmKey,
        spaceId: realmId,
      });

      if (result.status === "already-running") {
        setMessage("A scan is already underway. Please stand by...");
        setMessageType("success");
      }

      // Start polling for completion
      monitorScanProgress();
    } catch (err) {
      setIsScanning(false);
      setScanStatus("failed");
      setMessage(`Index reconstruction unsuccessful: ${err.message}`);
      setMessageType("error");
    }
  };

  const monitorScanProgress = () => {
    const interval = setInterval(async () => {
      try {
        const status = await invoke("check-audit-status", { spaceId: realmId });
        setScanStatus(status?.status || null);

        if (status?.status === "completed") {
          clearInterval(interval);
          setIsScanning(false);
          setMessage(
            `Index reconstruction finished! Located ${status.stats?.lockedFound || 0} sealed files.`,
          );
          setMessageType("success");
          // Reload the artifacts list with fresh data
          await fetchReservedFiles(realmKey, realmId);
        } else if (status?.status === "failed") {
          clearInterval(interval);
          setIsScanning(false);
          setMessage(
            `Index reconstruction unsuccessful: ${status.error || "Unknown error"}`,
          );
          setMessageType("error");
        }
      } catch (err) {
        console.error("Error polling scan status:", err);
      }
    }, 5000); // Poll every 5 seconds

    // Safety: stop polling after 5 minutes
    setTimeout(() => {
      clearInterval(interval);
      setIsScanning(false);
    }, 300000);
  };

  const onSaveRealmPrefs = async () => {
    try {
      setLoading(true);
      setMessage(null);
      setMessageType(null);

      if (!realmKey) {
        throw new Error("Space key is missing - cannot save settings");
      }

      // it16: store-policy returns { success:false, reason } on an authz denial (audit A1)
      // rather than throwing — check it so a rejected save isn't reported as "updated".
      const saveResult = await invoke("store-policy", {
        scope: "space",
        key: realmKey,
        data: realmPrefs,
      });

      if (saveResult?.success) {
        setMessage("Space preferences updated!");
        setMessageType("success");
      } else {
        setMessage(saveResult?.reason || "Could not save space settings.");
        setMessageType("error");
      }
    } catch (err) {
      console.error("Failed to save realm settings:", err);
      setMessage(`Could not save space settings: ${err.message}`);
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  };

  const onAddTeam = (group) => {
    if (!realmPrefs.adminGroups.includes(group)) {
      setRealmPrefs((prev) => ({
        ...prev,
        adminGroups: [...prev.adminGroups, group],
      }));
    }
  };

  const onRemoveTeam = (group) => {
    setRealmPrefs((prev) => ({
      ...prev,
      adminGroups: prev.adminGroups.filter((g) => g !== group),
    }));
  };

  const findOperators = async (
    searchTerm,
    append = false,
    startOverride = null,
  ) => {
    if (!searchTerm || searchTerm.length < 2) {
      setOperatorResults([]);
      setIsSearchingOperators(false);
      setShowOperatorDropdown(false);
      setHasMoreOperators(false);
      setNextOperatorsStart(null);
      setCurrentSearchQuery("");
      return;
    }

    // Reset pagination if search query changed
    if (searchTerm !== currentSearchQuery && !append) {
      setCurrentSearchQuery(searchTerm);
      setNextOperatorsStart(null);
      setHasMoreOperators(false);
    }

    try {
      setIsSearchingOperators(true);
      const start = startOverride !== null ? startOverride : 0;
      const result = await invoke("search-operators", {
        query: searchTerm,
        start,
        limit: 10,
      });

      if (append) {
        setOperatorResults((prev) => [...prev, ...(result.users || [])]);
      } else {
        setOperatorResults(result.users || []);
      }

      setHasMoreOperators(result.hasMore || false);
      setNextOperatorsStart(result.nextStart || null);
      setShowOperatorDropdown(result.users && result.users.length > 0);
    } catch (error) {
      setOperatorResults([]);
      setShowOperatorDropdown(false);
      // it57: was `setError(...)` — an UNDEFINED setter in this component (state is message/
      // messageType), so any search-operators rejection threw ReferenceError and unmounted the whole
      // console. Route through the real error channel.
      setMessage(`User search failed: ${error.message}`);
      setMessageType("error");
      setHasMoreOperators(false);
      setNextOperatorsStart(null);
    } finally {
      setIsSearchingOperators(false);
    }
  };

  const onOperatorSearch = (e) => {
    const term = e.target.value;
    setOperatorQuery(term);
    findOperators(term);
  };

  const fetchNextFilePage = async () => {
    if (
      !moreFilesAvailable ||
      fetchingMoreFiles ||
      !realmKey ||
      !realmId
    ) {
      return;
    }

    setFetchingMoreFiles(true);
    try {
      await fetchReservedFiles(
        realmKey,
        realmId,
        true,
        nextFileCursor,
      );
    } catch (error) {
      console.error("Error loading more artifacts:", error);
    } finally {
      setFetchingMoreFiles(false);
    }
  };

  const fetchNextOperatorPage = async () => {
    if (!hasMoreOperators || isLoadingMoreOperators || !nextOperatorsStart) {
      return;
    }

    setIsLoadingMoreOperators(true);
    try {
      if (currentSearchQuery) {
        await findOperators(currentSearchQuery, true, nextOperatorsStart);
      } else {
        await fetchInitialOperators(true, nextOperatorsStart);
      }
    } catch (error) {
      console.error("Error loading more operators:", error);
    } finally {
      setIsLoadingMoreOperators(false);
    }
  };

  const fetchNextTeamPage = async () => {
    if (!hasMoreTeams || isLoadingMoreTeams || !nextTeamsStart) {
      return;
    }

    setIsLoadingMoreTeams(true);
    try {
      await fetchAllTeams(true, nextTeamsStart);
    } catch (error) {
      console.error("Error loading more teams:", error);
    } finally {
      setIsLoadingMoreTeams(false);
    }
  };

  // Handle page size change for sealed artifacts
  const onResultsPerPageChange = async (newPageSize) => {
    setArtifactsPageSize(newPageSize);
    setReservedFiles([]);
    setMoreFilesAvailable(false);
    setNextFileCursor(null);
    await fetchReservedFiles(realmKey, realmId, false, null, newPageSize);
  };

  const onRealmSort = (field) => {
    if (realmSortField === field) {
      setRealmSortDir(realmSortDir === "asc" ? "desc" : "asc");
    } else {
      setRealmSortField(field);
      setRealmSortDir("asc");
    }
  };

  const onAddOperator = (operator) => {
    // Store operator object with accountId and displayName
    const operatorToAdd = {
      accountId: operator.accountId,
      displayName: operator.displayName,
    };

    // Check if operator is already added
    const isAlreadyAdded = realmPrefs.adminUsers.some(
      (existingOperator) =>
        (typeof existingOperator === "string"
          ? existingOperator
          : existingOperator.accountId) === operator.accountId,
    );

    if (!isAlreadyAdded) {
      setRealmPrefs((prev) => ({
        ...prev,
        adminUsers: [...prev.adminUsers, operatorToAdd],
      }));
    }

    // Clear search
    setOperatorQuery("");
    setOperatorResults([]);
    setShowOperatorDropdown(false);
  };

  const onRemoveOperator = (operatorToRemove) => {
    setRealmPrefs((prev) => ({
      ...prev,
      adminUsers: prev.adminUsers.filter((operator) => {
        const operatorId = typeof operator === "string" ? operator : operator.accountId;
        const removeId =
          typeof operatorToRemove === "string"
            ? operatorToRemove
            : operatorToRemove.accountId;
        return operatorId !== removeId;
      }),
    }));
  };

  const onTeamSearch = (e) => {
    const term = e.target.value;
    setTeamSearchTerm(term);
    setShowTeamDropdown(term.length > 0 || teamList.length > 0);
  };

  const filteredTeams = () => {
    if (!teamSearchTerm) {
      return teamList.filter(
        (group) => !realmPrefs.adminGroups.includes(group),
      );
    }
    return teamList.filter(
      (group) =>
        !realmPrefs.adminGroups.includes(group) &&
        group.toLowerCase().includes(teamSearchTerm.toLowerCase()),
    );
  };

  const onPickTeam = (group) => {
    onAddTeam(group);
    setTeamSearchTerm("");
    setShowTeamDropdown(false);
  };

  // P1-4: per-space notification mode. Two solid options, no native select. The server enforces
  // it at the one comment choke point (outbound-notify.js); the console only stores the choice.
  const notificationsModeChoices = [
    {
      value: "normal",
      label: "Normal",
      description: "Comments and @mentions follow the global notification settings.",
    },
    {
      value: "quiet",
      label: "Quiet",
      description: "Posts no comments or @mentions in this space. In-app alerts (toasts, ribbon, activity) still show.",
    },
  ];
  const onNotificationsModePick = (value) => {
    setRealmPrefs((prev) => ({ ...prev, notificationsMode: value === "quiet" ? "quiet" : "normal" }));
  };

  // it57: removed the dead local formatCountdown — superseded by the shared formatRemaining (kit/format-duration).

  const onWatchToggle = async (artifactId) => {
    setBusyAction({ id: artifactId, action: "watch" });
    const isCurrentlyRequested = watchStatus[artifactId];

    try {
      if (isCurrentlyRequested) {
        const result = await invoke("unwatch-artifact", {
          attachmentId: artifactId,
        });
        if (result.success) {
          setWatchStatus((prev) => ({ ...prev, [artifactId]: false }));
        }
      } else {
        const result = await invoke("watch-artifact", { attachmentId: artifactId });
        if (result.success) {
          setWatchStatus((prev) => ({ ...prev, [artifactId]: true }));
        }
      }
    } catch (err) {
      console.error("Failed to toggle dispatch:", err);
    } finally {
      setBusyAction(null);
    }
  };

  // Check dispatch request status for sealed artifacts
  useEffect(() => {
    const checkDispatchStatus = async () => {
      for (const att of reservedFiles) {
        try {
          const result = await invoke("check-watch", {
            attachmentId: att.id,
          });
          if (result.success) {
            setWatchStatus((prev) => ({
              ...prev,
              [att.id]: result.requested,
            }));
          }
        } catch (err) {
          console.error("Failed to check dispatch status:", err);
        }
      }
    };
    if (reservedFiles.length > 0) {
      checkDispatchStatus();
    }
  }, [reservedFiles]);

  const onForceRelease = async (artifactId, reason) => {
    setBusyAction({ id: artifactId, action: "unseal" });
    try {
      setMessage(null);
      setMessageType(null);

      const result = await invoke("steward-unseal", {
        attachmentId: artifactId,
        spaceKey: realmKey,
        spaceId: realmId,
        reason: reason || undefined,
      });

      if (result.success) {
        setMessage("File seal cleared!");
        setMessageType("success");
        // Reload sealed artifacts to update the table
        if (realmKey && realmId) {
          await fetchReservedFiles(realmKey, realmId);
        }
      } else {
        setMessage(`Could not release this file: ${result.reason}`);
        setMessageType("error");
      }
    } catch (err) {
      setMessage(`Could not release this file: ${err.message}`);
      setMessageType("error");
    } finally {
      setBusyAction(null);
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <h2 className="loading-title">Preparing Space Settings</h2>
        <p className="loading-text">
          Retrieving space preferences and sealed files...
        </p>
      </div>
    );
  }

  return (
    // data-sv-build: deploy-staleness stamp (webpack inlines BUILD_INFO at build time) — lets the
    // harness assert the SERVED frontend matches the deployed backend (`what=version`), the it26 trap.
    <div className="space-admin-container" data-sv-build={BUILD_INFO.gitSha}>
      <div className="space-admin-header">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <img
            src={logo}
            alt="Sentinel Vault Logo"
            style={{ height: "32px", width: "auto" }}
          />
          <div>
            <h1 className="space-admin-title">Space Preferences</h1>
            <p className="space-admin-subtitle">
              Manage Sentinel Vault preferences and access control for this
              space.
            </p>
          </div>
        </div>
      </div>

      <LicenseBanner />

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
        {userRole === "user" && (
          <button className={`tab-button ${activeTab === "my-claims" ? "active" : ""}`}
            onClick={() => { setActiveTab("my-claims"); fetchMyClaimedFiles(); fetchMyEditRequests(); }}>
            My Sealed Files
          </button>
        )}
        {userRole === "steward" && (
          <>
            <button className={`tab-button ${activeTab === "locked-attachments" ? "active" : ""}`}
              onClick={() => setActiveTab("locked-attachments")}>
              Sealed Files
            </button>
            <button className={`tab-button ${activeTab === "permissions" ? "active" : ""}`}
              onClick={() => { setActiveTab("permissions"); fetchPendingRequests(); }}>
              Access Control{pendingRequests.length > 0 && (
                <span style={{
                  marginLeft: "6px",
                  background: "var(--sv-interactive-danger)",
                  color: "var(--sv-text-inverse)",
                  borderRadius: "9999px",
                  padding: "1px 7px",
                  fontSize: "10px",
                  fontWeight: 700,
                  minWidth: "18px",
                  textAlign: "center",
                  display: "inline-block",
                }}>{pendingRequests.length}</span>
              )}
            </button>
            <button className={`tab-button ${activeTab === "unlock-timeouts" ? "active" : ""}`}
              onClick={() => setActiveTab("unlock-timeouts")}>
              Seal Duration
            </button>
            <button className={`tab-button ${activeTab === "macro-settings" ? "active" : ""}`}
              onClick={() => setActiveTab("macro-settings")}>
              Macro
            </button>
            <button className={`tab-button ${activeTab === "validations" ? "active" : ""}`}
              onClick={() => setActiveTab("validations")}>
              Validations
            </button>
            <button className={`tab-button ${activeTab === "workflow" ? "active" : ""}`}
              onClick={() => setActiveTab("workflow")}>
              Workflow
            </button>
            <button className={`tab-button ${activeTab === "activity" ? "active" : ""}`}
              onClick={() => setActiveTab("activity")}>
              Activity
            </button>
          </>
        )}
      </div>

      {/* Approvals waiting on the current user (shows on any tab; renders nothing when empty) */}
      <WorkflowInbox />

      {/* Tab Content */}
      {activeTab === "my-claims" && (
        <div className="tab-content">
          {userRole === "user" && stewardRequestStatus === "none" && !stewardRequestSent && (
            <div className="steward-request-banner">
              <div>
                <strong>Want to manage all sealed files in this space?</strong>
                <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--sv-text-secondary)" }}>
                  As a space admin you can see every sealed file in this space and force-unseal it when needed.
                </p>
              </div>
              <button className={`action-btn lock ${stewardRequestBusy ? "is-busy" : ""}`} onClick={handleRequestSteward} disabled={stewardRequestBusy} title="Ask a space admin to grant you admin access to Sentinel Vault in this space">
                {stewardRequestBusy ? <>Requesting<span className="btn-busy-bar" /></> : "Request admin access"}
              </button>
            </div>
          )}
          {(stewardRequestSent || stewardRequestStatus === "pending") && (
            <div className="steward-request-banner" style={{ borderColor: "var(--sv-status-success)" }}>
              <span>Your request has been submitted. A space admin will review it.</span>
            </div>
          )}
          {stewardRequestStatus === "denied" && (
            <div className="steward-request-banner" style={{ borderColor: "var(--sv-status-warning)" }}>
              <div>
                <strong>Your admin access request was denied.</strong>
                <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--sv-text-secondary)" }}>
                  {stewardRequestDeniedAt ? (() => {
                    const deniedTime = new Date(stewardRequestDeniedAt).getTime();
                    const retryTime = deniedTime + (48 * 60 * 60 * 1000);
                    const remaining = retryTime - Date.now();
                    if (remaining <= 0) return "You can submit a new request now.";
                    const hours = Math.ceil(remaining / 3600000);
                    return `You can submit a new request in about ${formatDurationHours(hours)}.`;
                  })() : "You may submit a new request after 48 hours."}
                </p>
              </div>
            </div>
          )}

          {/* Edit Requests inbox — people asking to edit files you have sealed */}
          {!editRequestsLoading && editRequests.length > 0 && (
            <div className="settings-card">
              <div className="settings-card-header">
                <h3>Edit Requests</h3>
                <p className="settings-card-desc">
                  Approve to let a user edit your sealed file without giving them admin access. Access lasts until the seal expires.
                </p>
              </div>
              <div className="settings-card-body">
                <div className="steward-grid">
                  {editRequests.map((request) => {
                    const name = request.requesterName || "Unknown User";
                    const initials = name.split(/\s+/).map((p) => p[0]).join("").toUpperCase().slice(0, 2);
                    const busyKey = `${request.artifactId}:${request.requesterAccountId}`;
                    const reqDate = request.requestedAt ? new Date(request.requestedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
                    return (
                      <div key={busyKey} className="steward-card">
                        <div className="steward-avatar">{initials}</div>
                        <span className="steward-name">{name}</span>
                        <span style={{ fontSize: "10px", color: "var(--sv-text-subtle)", textAlign: "center" }} title={request.attachmentName}>
                          {request.attachmentName || "Sealed file"}
                        </span>
                        {reqDate && <span style={{ fontSize: "10px", color: "var(--sv-text-subtle)" }}>{reqDate}</span>}
                        <span style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                          {(!editReqBusy || editReqBusy.id !== busyKey || editReqBusy.action === "approve") && (
                            <button
                              className={`action-btn lock ${editReqBusy?.id === busyKey && editReqBusy.action === "approve" ? "is-busy" : ""}`}
                              onClick={() => handleApproveEdit(request.artifactId, request.requesterAccountId)}
                              disabled={!!editReqBusy}
                              title="Allow this user to edit the sealed file"
                            >
                              {editReqBusy?.id === busyKey && editReqBusy.action === "approve" ? <>Approving<span className="btn-busy-bar" /></> : "Approve"}
                            </button>
                          )}
                          {(!editReqBusy || editReqBusy.id !== busyKey || editReqBusy.action === "deny") && (
                            <button
                              className={`action-btn unlock ${editReqBusy?.id === busyKey && editReqBusy.action === "deny" ? "is-busy" : ""}`}
                              onClick={() => handleDenyEdit(request.artifactId, request.requesterAccountId)}
                              disabled={!!editReqBusy}
                              title="Decline this edit request"
                            >
                              {editReqBusy?.id === busyKey && editReqBusy.action === "deny" ? <>Denying<span className="btn-busy-bar" /></> : "Deny"}
                            </button>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {myClaimsLoading && (
            <div className="sv-card-list" data-cols="3" style={{ '--sv-cards-per-row': 3 }}>
              {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={`my-skel-${i}`} />)}
            </div>
          )}

          {!myClaimsLoading && myClaimedFiles.length === 0 && (
            <div className="empty-state">You have no sealed files in this space.</div>
          )}

          {!myClaimsLoading && myClaimedFiles.length > 0 && (
            <div className="sv-card-list" data-cols="3" style={{ '--sv-cards-per-row': 3 }}>
              {myClaimedFiles.map(artifact => (
                <MyClaimedCard
                  key={artifact.id}
                  artifact={artifact}
                  busyAction={busyAction?.id === artifact.id ? busyAction.action : null}
                  siteUrl={siteUrl}
                  onRelease={async (id) => {
                    setBusyAction({ id, action: "unseal" });
                    try {
                      const r = await invoke("unseal-artifact", { attachmentId: id });
                      if (r && r.success === false) { setMessage(r.reason || "Could not release this file."); setMessageType("error"); }
                      else fetchMyClaimedFiles();
                    } catch (e) { console.error("Release failed:", e); }
                    finally { setBusyAction(null); }
                  }}
                  onExtend={async (id) => {
                    setBusyAction({ id, action: "extend" });
                    try {
                      const r = await invoke("extend-seal", { attachmentId: id });
                      if (r?.success) {
                        setMessage("Seal extended.");
                        setMessageType("success");
                        fetchMyClaimedFiles();
                      } else {
                        setMessage(r?.reason || "Could not extend this seal.");
                        setMessageType("error");
                      }
                    } catch (e) { console.error("Extend failed:", e); }
                    finally { setBusyAction(null); }
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "locked-attachments" && userRole === "steward" && (
        <div className="tab-content">
          <div className="form-section">
            <h3 className="section-header">
              Sealed Files in {realmName}
            </h3>
            <p className="space-admin-subtitle">
              Review and track all sealed files in this space. Sealed
              files are shielded from unauthorized changes.
            </p>
          </div>

          <div className="overlay-toolbar">
            <ColumnPicker
              columns={REALM_COLUMNS}
              visible={realmVisibleColumns}
              onChange={(key) => setRealmVisibleColumns((prev) => ({ ...prev, [key]: !prev[key] }))}
              isOpen={realmColumnPickerOpen}
              onToggle={setRealmColumnPickerOpen}
            />
            <SortPicker
              orderField={realmSortField}
              orderDir={realmSortDir}
              onSort={onRealmSort}
            />
            <span className="toolbar-file-count">{reservedFiles.length} sealed files</span>
          </div>

          {reservedFiles.length === 0 && !fetchingMoreFiles ? (
            <div className="empty-state">
              <p>No sealed files discovered in the index.</p>
            </div>
          ) : (
            <>
              <div className="sv-card-list" data-cols="3" style={{ '--sv-cards-per-row': 3 }}>
                {[...reservedFiles].sort((a, b) => {
                  const aVal = a[realmSortField] || "";
                  const bVal = b[realmSortField] || "";
                  const cmp = String(aVal).localeCompare(String(bVal), undefined, { sensitivity: "base" });
                  return realmSortDir === "asc" ? cmp : -cmp;
                }).map(artifact => (
                  <RealmClaimedCard
                    key={artifact.id}
                    artifact={artifact}
                    onForceRelease={onForceRelease}
                    onWatch={(id) => onWatchToggle(id)}
                    isWatching={watchStatus[artifact.id]}
                    forceReleaseActive={forceReleaseActive}
                    visibleColumns={realmVisibleColumns}
                    busyAction={busyAction?.id === artifact.id ? busyAction.action : null}
                    siteUrl={siteUrl}
                  />
                ))}
              </div>
              {fetchingMoreFiles && moreFilesAvailable && (
                <div className="sv-card-list" data-cols="3" style={{ '--sv-cards-per-row': 3 }}>
                  {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={`skel-${i}`} />)}
                </div>
              )}
              {moreFilesAvailable && !fetchingMoreFiles && (
                <div style={{ textAlign: "center", padding: "16px" }}>
                  <button
                    className="btn-primary"
                    onClick={fetchNextFilePage}
                    style={{ fontSize: "13px", padding: "8px 20px" }}
                  >
                    Show more
                  </button>
                </div>
              )}
              {!moreFilesAvailable && reservedFiles.length > 0 && (
                <div
                  style={{
                    textAlign: "center",
                    padding: "16px",
                    color: "var(--sv-text-subtle)",
                    fontStyle: "italic",
                  }}
                >
                  All sealed files shown
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === "permissions" && userRole === "steward" && (
        <div className="tab-content">
          {/* P1-4: Notifications — per-space quiet mode */}
          <div className="settings-card" data-testid="sv-notifications-mode-card">
            <div className="settings-card-header">
              <h3>Notifications</h3>
              <p className="settings-card-desc">
                Sentinel Vault never sends email. A notification is a comment on the page that @mentions the
                people involved; Confluence itself may then email them, according to their own preferences.
                Quiet stops every such comment in this space — violations, seals created or released, edit
                requests and approvals — while the in-app toasts, ribbon and activity trail keep working.
              </p>
            </div>
            <div className="settings-card-body">
              <p className="settings-row-default" data-testid="sv-default-notificationsMode" style={{ margin: "0 0 12px" }}>
                <span>Effective default:</span> {formatDefault("notificationsMode")}
                <span className="settings-row-default-sep">·</span>
                <span>Site default:</span> <span data-testid="sv-site-default-notificationsMode" style={{ fontWeight: 400 }}>
                  {siteValues.enableEmailDispatches ? "Comments that mention people are On site-wide" : "Comments that mention people are Off site-wide — Quiet changes nothing until a site admin turns them on"}
                </span>
              </p>
              <div
                role="radiogroup"
                aria-label="Notifications"
                style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}
              >
                {notificationsModeChoices.map((option) => {
                  const selected = (realmPrefs.notificationsMode || "normal") === option.value;
                  const accent = option.value === "quiet" ? "var(--sv-interactive-danger)" : "var(--sv-interactive-primary)";
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      data-testid={`sv-notifications-mode-${option.value}`}
                      onClick={() => onNotificationsModePick(option.value)}
                      style={{
                        flex: "1 1 220px",
                        textAlign: "left",
                        cursor: "pointer",
                        padding: "12px 14px",
                        borderRadius: "8px",
                        border: `2px solid ${selected ? accent : "var(--sv-border-primary)"}`,
                        background: selected ? accent : "var(--sv-surface-raised)",
                        color: selected ? "var(--sv-text-inverse)" : "var(--sv-text-primary)",
                        fontFamily: "inherit",
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "4px" }}>
                        {option.label}
                      </div>
                      <div style={{ fontSize: "12px", lineHeight: 1.4, opacity: selected ? 0.95 : 1 }}>
                        {option.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* CLS-1: per-space classification override — two solid options, no native select. A space
              can opt OUT; it cannot turn classification on while the site has it off (the same AND
              rule as the auto-insert macro), so the card is locked with the site-admin reason then. */}
          <div className="settings-card" data-testid="sv-classification-card">
            <div className="settings-card-header">
              <h3>Classification</h3>
              <p className="settings-card-desc">
                {siteValues.classificationEnabled
                  ? "Pages in this space show a classification level in the byline chip, the ribbon and the page details, following the site. Off hides every level on this space's pages and refuses new ones; the stored levels are kept."
                  : "Off site-wide by a site admin (Classification levels). Nothing about classification is shown on this space's pages until the site turns it on; the choice below applies then."}
              </p>
            </div>
            <div className="settings-card-body">
              <p className="settings-row-default" data-testid="sv-default-classification" style={{ margin: "0 0 12px" }}>
                <span>Effective default:</span> {formatDefault("classification")}
                <span className="settings-row-default-sep">·</span>
                <span>Site:</span> <span data-testid="sv-site-default-classification" style={{ fontWeight: 400 }}>{siteValues.classificationEnabled ? "Classification levels are On site-wide" : "Classification levels are Off site-wide"}</span>
              </p>
              <div role="radiogroup" aria-label="Classification in this space" style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                {[
                  { value: "inherit", label: "As the site", description: "Pages here carry a level when the site has classification on." },
                  { value: "off", label: "Off in this space", description: "No level is shown or set on this space's pages, whatever the site says. Stored levels are kept." },
                ].map((option) => {
                  const selected = (realmPrefs.classification || "inherit") === option.value;
                  const locked = !siteValues.classificationEnabled;
                  const accent = option.value === "off" ? "var(--sv-interactive-danger)" : "var(--sv-interactive-primary)";
                  return (
                    <button key={option.value} type="button" role="radio" aria-checked={selected} disabled={locked}
                      data-testid={`sv-classification-${option.value}`}
                      onClick={() => setRealmPrefs((prev) => ({ ...prev, classification: option.value === "off" ? "off" : "inherit" }))}
                      style={{
                        flex: "1 1 220px", textAlign: "left", cursor: locked ? "not-allowed" : "pointer", padding: "12px 14px", borderRadius: "8px",
                        border: `2px solid ${selected ? accent : "var(--sv-border-primary)"}`,
                        background: selected ? accent : "var(--sv-surface-raised)",
                        color: selected ? "var(--sv-text-inverse)" : "var(--sv-text-primary)",
                        fontFamily: "inherit", opacity: locked ? 0.5 : 1,
                      }}>
                      <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "4px" }}>{option.label}</div>
                      <div style={{ fontSize: "12px", lineHeight: 1.4, opacity: selected ? 0.95 : 1 }}>{option.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Stewards */}
          <div className="settings-card">
            <div className="settings-card-header">
              <h3>Space admins</h3>
              <p className="settings-card-desc">
                Space admins can see every sealed attachment in this space and force-unseal it.
                Confluence space admins and organisation admins have this access automatically.
              </p>
            </div>
            <div className="settings-card-body">
              {/* Operators as mini-cards in a grid */}
              <div className="steward-grid">
                {realmPrefs.adminUsers.map((operator, index) => {
                  const accountId = typeof operator === "string" ? operator : operator.accountId;
                  const displayName = typeof operator === "string" ? `User ${accountId.slice(-4)}` : operator.displayName;
                  const initials = displayName.split(/\s+/).map(p => p[0]).join("").toUpperCase().slice(0, 2);
                  return (
                    <div key={accountId || index} className="steward-card">
                      <div className="steward-avatar">{initials}</div>
                      <span className="steward-name">{displayName}</span>
                      <button className="steward-remove" onClick={() => onRemoveOperator(operator)} title="Remove space admin">&times;</button>
                    </div>
                  );
                })}
                {/* Add Operator card */}
                <div className="steward-card steward-card-add" onClick={() => { setShowOperatorSearch(!showOperatorSearch); }}>
                  <div className="steward-avatar steward-avatar-add">+</div>
                  <span className="steward-name">Add space admin</span>
                </div>
              </div>

              {/* Operator search (shown when add is clicked) */}
              {showOperatorSearch && (
                <div className="search-container" style={{ marginBottom: "16px" }}>
                  <input
                    type="text"
                    className="search-input"
                    placeholder="Type to search for users..."
                    value={operatorQuery}
                    onChange={onOperatorSearch}
                    onFocus={() => {
                      setShowOperatorDropdown(true);
                      if (!operatorQuery && operatorResults.length === 0) {
                        fetchInitialOperators();
                      }
                    }}
                    onBlur={() => {
                      setTimeout(() => setShowOperatorDropdown(false), 200);
                    }}
                  />

                  {isSearchingOperators && (
                    <div className="search-dropdown">
                      {Array.from({ length: 3 }).map((_, i) => <SkeletonDropdownItem key={`op-skel-${i}`} />)}
                    </div>
                  )}

                  {showOperatorDropdown && !isSearchingOperators && operatorQuery && (
                    <div
                      className="search-dropdown user-search-dropdown"
                      style={{ maxHeight: "300px", overflowY: "auto" }}
                    >
                      {operatorResults.length > 0 ? (
                        <>
                          {operatorResults.map((operator) => {
                            const isAlreadyAdded = realmPrefs.adminUsers.some(
                              (existingOperator) =>
                                (typeof existingOperator === "string"
                                  ? existingOperator
                                  : existingOperator.accountId) === operator.accountId,
                            );
                            return (
                              <div
                                key={operator.accountId}
                                className={`search-result user-search-result ${isAlreadyAdded ? "disabled" : ""}`}
                                onClick={() => !isAlreadyAdded && onAddOperator(operator)}
                                style={{
                                  opacity: isAlreadyAdded ? 0.5 : 1,
                                  cursor: isAlreadyAdded ? "not-allowed" : "pointer",
                                }}
                              >
                                <div className="user-name">
                                  {operator.displayName}
                                  {isAlreadyAdded && (
                                    <span style={{ marginLeft: "8px", fontSize: "10px" }}>(Already added)</span>
                                  )}
                                </div>
                                {operator.email && (
                                  <div className="user-email">{operator.email}</div>
                                )}
                              </div>
                            );
                          })}
                          {isLoadingMoreOperators && hasMoreOperators && (
                            <>
                              {Array.from({ length: 3 }).map((_, i) => <SkeletonDropdownItem key={`op-more-skel-${i}`} />)}
                            </>
                          )}
                          {!isLoadingMoreOperators && !hasMoreOperators && (
                            <div className="search-result">
                              <div style={{ display: "flex", justifyContent: "center", padding: "12px", color: "var(--sv-text-subtle)", fontStyle: "italic", fontSize: "12px" }}>
                                All users loaded
                              </div>
                            </div>
                          )}
                        </>
                      ) : operatorQuery ? (
                        <div className="search-result">
                          <span style={{ color: "var(--sv-text-subtle)", fontStyle: "italic" }}>
                            No users found for &quot;{operatorQuery}&quot;
                          </span>
                        </div>
                      ) : null}
                    </div>
                  )}

                  {showOperatorDropdown && !isSearchingOperators && !operatorQuery && operatorResults.length > 0 && (
                    <div className="search-dropdown">
                      <div className="search-result" style={{ backgroundColor: "var(--sv-bg-tertiary)", cursor: "default" }}>
                        <span style={{ color: "var(--sv-text-subtle)", fontStyle: "italic", fontSize: "11px" }}>
                          Recent users (type to search for more):
                        </span>
                      </div>
                      {operatorResults.map((operator) => {
                        const isAlreadyAdded = realmPrefs.adminUsers.some(
                          (existingOperator) =>
                            (typeof existingOperator === "string"
                              ? existingOperator
                              : existingOperator.accountId) === operator.accountId,
                        );
                        return (
                          <div
                            key={operator.accountId}
                            className={`search-result user-search-result ${isAlreadyAdded ? "disabled" : ""}`}
                            onClick={() => !isAlreadyAdded && onAddOperator(operator)}
                            style={{
                              opacity: isAlreadyAdded ? 0.5 : 1,
                              cursor: isAlreadyAdded ? "not-allowed" : "pointer",
                            }}
                          >
                            <div className="user-name">
                              {operator.displayName}
                              {isAlreadyAdded && (
                                <span style={{ marginLeft: "8px", fontSize: "10px" }}>(Already added)</span>
                              )}
                            </div>
                            {operator.email && (
                              <div className="user-email">{operator.email}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Guilds section */}
              <div className="steward-guilds">
                <h4 className="steward-guilds-title">Groups</h4>
                <p className="steward-guilds-desc">Members of these Confluence groups are automatically granted admin access to this space.</p>
                <div className="guild-chips">
                  {realmPrefs.adminGroups.map((group) => (
                    <span key={group} className="guild-chip">
                      {group}
                      <button className="guild-chip-remove" onClick={() => onRemoveTeam(group)}>&times;</button>
                    </span>
                  ))}
                  <button className="guild-chip guild-chip-add" onClick={() => { setShowGuildSearch(!showGuildSearch); }}>
                    + Add Group
                  </button>
                </div>

                {/* Guild search dropdown (shown when add is clicked) */}
                {showGuildSearch && (
                  <div className="search-container" style={{ marginTop: "10px" }}>
                    {teamList.length === 0 ? (
                      <>
                        {Array.from({ length: 3 }).map((_, i) => <SkeletonDropdownItem key={`guild-skel-${i}`} />)}
                      </>
                    ) : (
                      <>
                        <input
                          type="text"
                          className="search-input"
                          placeholder="Type to search and select groups..."
                          value={teamSearchTerm}
                          onChange={onTeamSearch}
                          onFocus={() => { setShowTeamDropdown(true); }}
                          onBlur={() => { setTimeout(() => setShowTeamDropdown(false), 200); }}
                        />

                        {showTeamDropdown && (
                          <div className="search-dropdown" style={{ maxHeight: "300px", overflowY: "auto" }}>
                            {filteredTeams().length === 0 ? (
                              <div className="search-result">
                                <span style={{ color: "var(--sv-text-subtle)", fontStyle: "italic" }}>
                                  {teamSearchTerm
                                    ? `No groups found matching "${teamSearchTerm}"`
                                    : "All available groups are already selected"}
                                </span>
                              </div>
                            ) : (
                              <>
                                {filteredTeams().map((group) => (
                                  <div key={group} className="search-result" onClick={() => onPickTeam(group)} style={{ cursor: "pointer" }}>
                                    <div className="user-name">{group}</div>
                                  </div>
                                ))}
                                {isLoadingMoreTeams && hasMoreTeams && (
                                  <>
                                    {Array.from({ length: 3 }).map((_, i) => <SkeletonDropdownItem key={`guild-more-skel-${i}`} />)}
                                  </>
                                )}
                                {!isLoadingMoreTeams && !hasMoreTeams && filteredTeams().length > 0 && (
                                  <div className="search-result">
                                    <div style={{ display: "flex", justifyContent: "center", padding: "12px", color: "var(--sv-text-subtle)", fontStyle: "italic", fontSize: "12px" }}>
                                      All groups loaded
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Pending Steward Requests */}
          <div className="settings-card">
            <div className="settings-card-header">
              <h3>Pending Access Requests</h3>
              <p className="settings-card-desc">
                Users who have requested admin access to this space. Use Approve to grant access or Deny to reject the request.
              </p>
            </div>
            <div className="settings-card-body">
              {pendingRequestsLoading && (
                <div style={{ color: "var(--sv-text-subtle)", fontSize: "12px", padding: "8px 0" }}>Loading requests...</div>
              )}
              {!pendingRequestsLoading && pendingRequests.length === 0 && (
                <div style={{ color: "var(--sv-text-subtle)", fontSize: "12px", padding: "8px 0", fontStyle: "italic" }}>No pending requests.</div>
              )}
              {!pendingRequestsLoading && pendingRequests.length > 0 && (
                <div className="steward-grid">
                  {pendingRequests.map((request) => {
                    const initials = (request.displayName || "??").split(/\s+/).map(p => p[0]).join("").toUpperCase().slice(0, 2);
                    const requestDate = request.requestedAt ? new Date(request.requestedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
                    return (
                      <div key={request.accountId} className="steward-card">
                        <div className="steward-avatar">{initials}</div>
                        <span className="steward-name">{request.displayName || "Unknown User"}</span>
                        {requestDate && <span style={{ fontSize: "10px", color: "var(--sv-text-subtle)" }}>{requestDate}</span>}
                        <span style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                          {(!requestActionBusy || requestActionBusy.id !== request.accountId || requestActionBusy.action === "approve") && (
                            <button
                              className={`action-btn lock ${requestActionBusy?.id === request.accountId && requestActionBusy.action === "approve" ? "is-busy" : ""}`}
                              onClick={() => handleApproveRequest(request.accountId)}
                              disabled={!!requestActionBusy}
                              title="Grant admin access to this user"
                            >
                              {requestActionBusy?.id === request.accountId && requestActionBusy.action === "approve" ? <>Approving<span className="btn-busy-bar" /></> : "Approve"}
                            </button>
                          )}
                          {(!requestActionBusy || requestActionBusy.id !== request.accountId || requestActionBusy.action === "deny") && (
                            <button
                              className={`action-btn unlock ${requestActionBusy?.id === request.accountId && requestActionBusy.action === "deny" ? "is-busy" : ""}`}
                              onClick={() => handleDenyRequest(request.accountId)}
                              disabled={!!requestActionBusy}
                              title="Deny this admin access request"
                            >
                              {requestActionBusy?.id === request.accountId && requestActionBusy.action === "deny" ? <>Denying<span className="btn-busy-bar" /></> : "Deny"}
                            </button>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Note */}
          <div className="settings-note">
            <strong>Note:</strong> Confluence space admins and site admins always have these privileges.
          </div>
          {/* it48: removed a duplicate "Apply Configuration" action-bar here — the generic
              steward action-bar below (activeTab !== validations/workflow) already renders one
              for this tab, so two identical Save buttons were stacking at the same position. */}
        </div>
      )}

      {activeTab === "unlock-timeouts" && userRole === "steward" && (
        <div className="tab-content">
          <div className="settings-panel sv-groups">
            <GroupCard id="expiry" title="Expiry" text="How long a seal lasts in this space. Expiry notices, overdue reminders and the release itself follow the site settings.">
              <div className="settings-row" data-testid="sv-row-useSiteDuration">
                <div className="settings-row-info">
                  <p className="settings-row-label">Use System Default Seal Duration</p>
                  <p className="settings-row-description">
                    New seals in this space last as long as the site default set by a site admin.
                  </p>
                  <p className="settings-row-default" data-testid="sv-default-useSiteDuration">
                    <span>Site default:</span> <span data-testid="sv-site-default-autoUnlockTimeoutHours" style={{ fontWeight: 400 }}>{formatValue("defaultLockDuration", siteValues.defaultLockDuration)}</span>
                    {!systemExpiryAlertsActive && <><span className="settings-row-default-sep">·</span>Seals never expire on this site (a site admin turned “Seals expire” off), so the duration only sets when a seal shows as overdue.</>}
                  </p>
                </div>
                <div className="settings-row-control">
                  <label className="form-checkbox">
                    <input
                      type="checkbox"
                      aria-label="Use System Default Seal Duration"
                      checked={realmPrefs.autoUnlockTimeoutHours === null}
                      onChange={(e) => {
                        setRealmPrefs((prev) => ({
                          ...prev,
                          autoUnlockTimeoutHours: e.target.checked ? null : Math.max(1, Math.round((siteValues.defaultLockDuration || 0) / 3600)) || 48,
                        }));
                      }}
                    />
                  </label>
                </div>
              </div>

              <div className={`settings-row is-dependent depth-1${realmPrefs.autoUnlockTimeoutHours === null ? " is-locked" : ""}`} data-testid="sv-row-autoUnlockTimeoutHours" data-locked={realmPrefs.autoUnlockTimeoutHours === null ? "true" : "false"}>
                <div className="settings-row-info">
                  <p className="settings-row-label">{control("autoUnlockTimeoutHours").label}</p>
                  <p className="settings-row-description">
                    {control("autoUnlockTimeoutHours").text}
                    {realmPrefs.autoUnlockTimeoutHours !== null && (
                      <>{" "}Seals will expire after{" "}
                        <span className="dynamic-value">
                          {realmPrefs.autoUnlockTimeoutHours} hours
                          {realmPrefs.autoUnlockTimeoutHours >= 24 ? ` (${formatDurationHours(realmPrefs.autoUnlockTimeoutHours)})` : ""}
                        </span>.
                      </>
                    )}
                  </p>
                  <p className="settings-row-default" data-testid="sv-default-autoUnlockTimeoutHours">
                    <span>Effective default:</span> {formatDefault("autoUnlockTimeoutHours")}
                    <span className="settings-row-default-sep">·</span>
                    <span>Site default:</span> <span style={{ fontWeight: 400 }}>{formatValue("defaultLockDuration", siteValues.defaultLockDuration)}</span>
                  </p>
                  {realmPrefs.autoUnlockTimeoutHours === null && <p className="settings-row-reason" data-testid="sv-reason-autoUnlockTimeoutHours">Turn off Use System Default Seal Duration first</p>}
                </div>
                <div className="settings-row-control">
                  <div className="input-with-unit">
                    <input
                      className="form-input"
                      type="number"
                      aria-label="Custom Seal Duration"
                      value={realmPrefs.autoUnlockTimeoutHours ?? Math.max(1, Math.round((siteValues.defaultLockDuration || 0) / 3600))}
                      disabled={realmPrefs.autoUnlockTimeoutHours === null}
                      onChange={(e) => {
                        const value = parseInt(e.target.value);
                        if (!isNaN(value) && value > 0) {
                          setRealmPrefs((prev) => ({ ...prev, autoUnlockTimeoutHours: value }));
                        }
                      }}
                      min="1"
                    />
                    <span className="input-unit">hrs</span>
                  </div>
                </div>
              </div>
            </GroupCard>
          </div>
        </div>
      )}

      {activeTab === "macro-settings" && userRole === "steward" && (
        <div className="tab-content">
          <div className="settings-panel sv-groups">
            <GroupCard id="advanced" title="Advanced" text="The Sentinel Vault panel macro on pages in this space. The site-wide switch is held by a site admin; this space can only opt out and choose the position.">
              <SchemaRow desc={control("autoInsertMacro")} values={{ autoInsertMacro: realmPrefs.autoInsertMacro !== false, macroInsertPosition: readEffective("macroInsertPosition", realmPrefs.macroInsertPosition) }} siteValues={siteValues}>
                <label className="form-checkbox">
                  <input
                    type="checkbox"
                    aria-label="Auto-Insert Macro"
                    checked={realmPrefs.autoInsertMacro !== false}
                    disabled={!siteValues.globalAutoInsertMacro}
                    onChange={(e) => {
                      setRealmPrefs((prev) => ({ ...prev, autoInsertMacro: e.target.checked }));
                    }}
                  />
                </label>
              </SchemaRow>

              <SchemaRow desc={control("macroInsertPosition")} values={{ autoInsertMacro: siteValues.globalAutoInsertMacro && realmPrefs.autoInsertMacro !== false }} siteValues={siteValues}>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {[["top", "Top"], ["bottom", "Bottom"]].map(([pos, label]) => (
                    <label key={pos} className="checkbox-control" style={{ marginBottom: 0 }}>
                      <input
                        type="radio"
                        name="panelInsertPosition"
                        value={pos}
                        disabled={!(siteValues.globalAutoInsertMacro && realmPrefs.autoInsertMacro !== false)}
                        checked={readEffective("macroInsertPosition", realmPrefs.macroInsertPosition) === pos}
                        onChange={() => {
                          setRealmPrefs((prev) => ({ ...prev, macroInsertPosition: pos }));
                        }}
                      />
                      <span className="checkbox-label">{label}</span>
                    </label>
                  ))}
                </div>
              </SchemaRow>
              {siteValues.replaceAttachmentsMacro && (
                <p className="sv-group-note" data-testid="sv-replace-note">
                  The site replaces Confluence's Attachments macro with the panel when a page has one; the position above only applies to pages without it.
                </p>
              )}
            </GroupCard>
          </div>
        </div>
      )}

      {activeTab === "validations" && userRole === "steward" && (
        <div className="tab-content">
          <ValidationsEditor scope="space" spaceKey={realmKey} />
        </div>
      )}

      {activeTab === "workflow" && userRole === "steward" && (
        <div className="tab-content">
          {wfView === "settings" ? (
            <>
              <WorkflowDashboard spaceKey={realmKey} />
              <WorkflowSettingsEditor spaceKey={realmKey} defRev={defRev} onEditStates={() => setWfView("states")} />
            </>
          ) : (
            <WorkflowDefinitionEditor spaceKey={realmKey} standalone onBack={() => setWfView("settings")} onSaved={() => setDefRev((r) => r + 1)} />
          )}
        </div>
      )}

      {/* A1: the Activity report is read-only — nothing to apply, so it has no action bar. */}
      {activeTab === "activity" && userRole === "steward" && (
        <div className="tab-content">
          <ActivityReport spaceKey={realmKey} siteUrl={siteUrl} />
        </div>
      )}

      {userRole === "steward" && activeTab !== "validations" && activeTab !== "workflow" && activeTab !== "activity" && (
        <div className="action-bar">
          <button
            className="btn-primary"
            onClick={onSaveRealmPrefs}
            disabled={loading}
            data-testid="sv-save-realm-prefs"
          >
            {loading ? "Updating..." : "Apply Configuration"}
          </button>
        </div>
      )}
    </div>
  );
};

const App = () => {
  return <RealmPolicyDashboard />;
};

const container = document.getElementById("root");
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
