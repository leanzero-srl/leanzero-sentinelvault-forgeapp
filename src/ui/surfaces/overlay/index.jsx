import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { invoke, view, router } from "@forge/bridge";
import { enablePaletteSync } from "../../kit/palette-sync";
import { flashArtifactSealed, flashArtifactUnsealed } from "../../kit/flash-messages";
import ThumbnailPreview from "../../kit/ThumbnailPreview";
import { formatRemaining } from "../../kit/format-duration";
import ActivityFeed from "../../kit/ActivityFeed";
import ActionMenu from "../../kit/ActionMenu";
import { ConfirmDialog } from "../../kit/Dialog";
import GiveAccessDialog from "../../kit/GiveAccessDialog";
import { useSignedInvoke } from "../../kit/SignedInvoke";
import RovingList from "../../kit/RovingList";
import useEditStatuses from "../../kit/useEditStatuses";
import CappedGroup from "../../kit/CappedGroup";
import { SEALED_GROUPS, groupSealedFiles } from "../../kit/sealed-groups.js";
import { attachmentRow, rowActions, statusChip, copyText } from "../../kit/seal-row.js";
import { PrimarySlot, ReasonBar, RequestInbox, GrantInbox, ErrorRow, CopiedNote } from "../../kit/SealRowParts";

// ── Column definitions ──────────────────────────────────
const OVERLAY_COLUMNS = [
  { key: "name",      label: "Name",                 defaultOn: true,  alwaysOn: true },
  { key: "status",    label: "Status",               defaultOn: true, alwaysOn: true },
  { key: "heldBy",    label: "Held by",              defaultOn: true },
  { key: "lapses",    label: "Expires",               defaultOn: true },
  { key: "watch",     label: "Watch for release", defaultOn: true },
  { key: "actions",   label: "Actions",              defaultOn: true,  alwaysOn: true },
  { key: "fileSize",  label: "File Size",            defaultOn: false },
  { key: "fileType",  label: "File Type",            defaultOn: false },
  { key: "labels",    label: "Labels",               defaultOn: false },
  { key: "comment",   label: "Comment",              defaultOn: false },
  { key: "createdAt", label: "Created",              defaultOn: false },
  { key: "version",   label: "Version",              defaultOn: false },
];


const buildDefaults = (cols) =>
  cols.reduce((acc, col) => ({ ...acc, [col.key]: col.defaultOn }), {});

const loadColumnPrefs = (storageKey, cols) => {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) return { ...buildDefaults(cols), ...JSON.parse(saved) };
  } catch (e) { /* ignore */ }
  return buildDefaults(cols);
};

// ── Helpers ─────────────────────────────────────────────
const formatFileSize = (bytes) => {
  if (bytes == null) return "-";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
};

// ── Column Picker component ─────────────────────────────
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
        aria-haspopup="true"
        aria-expanded={isOpen}
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

// Operator avatar component with fallback
const AvatarFigure = ({ operatorInfo }) => {
  const [imageError, setImageError] = useState(false);

  // Standard operator icon SVG
  const OperatorIcon = () => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      style={{
        borderRadius: "50%",
        backgroundColor: "var(--sv-border-secondary)",
        padding: "2px",
      }}
    >
      <path
        d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
        fill="var(--sv-text-subtle)"
      />
    </svg>
  );

  if (!operatorInfo.profilePicture || imageError) {
    return <OperatorIcon />;
  }

  return (
    <img
      src={operatorInfo.profilePicture}
      alt={operatorInfo.displayName}
      style={{
        width: "16px",
        height: "16px",
        borderRadius: "50%",
      }}
      onError={() => setImageError(true)}
    />
  );
};

// Operator component that fetches operator data via resolver
const OperatorTag = ({ accountId }) => {
  const [operatorInfo, setOperatorInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accountId) {
      setLoading(false);
      return;
    }

    const fetchOperatorInfo = async () => {
      try {
        const data = await invoke("identify-operator", { accountId });
        setOperatorInfo(data);
      } catch (error) {
        console.error(`Failed to fetch operator info for ${accountId}:`, error);
        setOperatorInfo({ displayName: `User ${accountId.slice(-4)}`, accountId });
      } finally {
        setLoading(false);
      }
    };

    fetchOperatorInfo();
  }, [accountId]);

  if (!accountId) return <span>-</span>;
  if (loading) return <span>Resolving...</span>;
  if (!operatorInfo) return <span>Unknown user</span>;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "12px",
      }}
      title={`${operatorInfo.displayName} (${operatorInfo.accountId})`}
    >
      <AvatarFigure operatorInfo={operatorInfo} />
      {operatorInfo.displayName}
    </span>
  );
};

const SkeletonCard = () => (
  <div className="artifact-card skeleton-card">
    <div className="card-row card-row-primary">
      <span className="skeleton-bar skeleton-title" />
      <span className="skeleton-bar skeleton-badge" />
    </div>
    <div className="card-row card-row-secondary">
      <span className="skeleton-bar skeleton-meta" />
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

const SORT_FIELDS = [
  { key: "title", label: "Name" },
  { key: "lockStatus", label: "Status" },
  { key: "expiresAt", label: "Expires" },
  { key: "createdAt", label: "Created" },
];

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

  const fields = SORT_FIELDS;
  const currentLabel = fields.find(f => f.key === orderField)?.label || "Name";
  const arrow = orderDir === "asc" ? "\u2191" : "\u2193";

  return (
    <div className="sort-picker" ref={ref}>
      <button className="column-picker-trigger" onClick={() => setIsOpen(!isOpen)} title="Change sort order" aria-haspopup="listbox" aria-expanded={isOpen} aria-label="Change sort order">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 5h10M11 9h7M11 13h4M3 17l3 3 3-3M6 18V4" />
        </svg>
        {currentLabel} {arrow}
      </button>
      {isOpen && (
        <div className="column-picker-dropdown" role="listbox" aria-label="Sort files by">
          {fields.map((f) => (
            // a11y (it35): the sort options were mouse-only clickable divs (no role/tabIndex/key
            // handler) → keyboard + screen-reader users couldn't sort. Focusable option semantics.
            <div
              key={f.key}
              role="option"
              aria-selected={f.key === orderField}
              tabIndex={0}
              className={`column-picker-option ${f.key === orderField ? "selected" : ""}`}
              style={{ cursor: "pointer", fontWeight: f.key === orderField ? 600 : 400 }}
              onClick={() => { onSort(f.key); setIsOpen(false); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSort(f.key); setIsOpen(false); } }}
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

// One attachment card in the overlay. The primary action and the ⋯ items come from the SAME row
// rule as the inline panel and the page-details modal (kit/seal-row.js → row-state.js); the
// parent owns the resolver calls through `run` so a refusal lands on THIS card's error row.
const OverlayArtifactCard = ({ artifact, editInfo, visibleColumns, run, signedInvoke, busyAction, errorMessage, onClearError, isWatching, viewer, formatRemainingTime, formatFileSize, siteUrl, spaceKey, pageId, pageLocation }) => {
  const [pendingConfirm, setPendingConfirm] = useState(null); // "delete" | "purge" | null → kit ConfirmDialog
  const [expanded, setExpanded] = useState(false);
  const [cachedPreview, setCachedPreview] = useState(null);
  // Seeded by the list (useEditStatuses) when it already asked — the card then skips its own call.
  const [editStatus, setEditStatus] = useState(editInfo?.status || null); // none|pending|granted|denied (others' seals)
  const [editExpiresAt, setEditExpiresAt] = useState(editInfo?.expiresAt || null);
  const [bar, setBar] = useState(null); // "request" | "force" | null
  const [reasonText, setReasonText] = useState("");
  const [myRequests, setMyRequests] = useState(null); // owner: pending edit requests
  const [reqBusy, setReqBusy] = useState(null);
  const [editRetryAt, setEditRetryAt] = useState(editInfo?.retryAt || null);
  // Editors with access: the panel had this, the overlay did not — an owner working in the
  // overlay could neither see nor revoke a grant (one rule, every surface).
  const [myGrants, setMyGrants] = useState(null);
  const [grantBusy, setGrantBusy] = useState(null);
  const [giving, setGiving] = useState(false);
  const [copied, setCopied] = useState(false);

  const isSealedByMe = artifact.lockStatus === "HELD_BY_ACTOR";
  const isSealedByOther = artifact.lockStatus === "HELD";
  const isStale = artifact.isStale === true;
  const isRecoverable = artifact.staleReason === "trashed";
  const isImage = artifact.mediaType?.startsWith("image/");
  const downloadHref = siteUrl && pageId && artifact.title
    ? `${siteUrl}/wiki/download/attachments/${pageId}/${encodeURIComponent(artifact.title)}?api=v2`
    : null;
  const numericAttId = artifact.id ? artifact.id.replace(/^att/, "") : null;
  const viewUrl = pageLocation && pageId && numericAttId && artifact.title
    ? `${pageLocation}?preview=/${pageId}/${numericAttId}/${encodeURIComponent(artifact.title)}`
    : null;
  const propertiesUrl = siteUrl && pageId && artifact.title
    ? `${siteUrl}/wiki/pages/editattachment.action?pageId=${pageId}&fileName=${encodeURIComponent(artifact.title)}&isFromPageView=true`
    : null;

  useEffect(() => {
    let cancelled = false;
    if (isSealedByOther && !isStale && editStatus === null) {
      invoke("check-edit-request", { attachmentId: artifact.id })
        .then((r) => { if (!cancelled) { setEditStatus(r?.status || "none"); setEditExpiresAt(r?.expiresAt || null); setEditRetryAt(r?.retryAt || null); } })
        .catch(() => { if (!cancelled) setEditStatus("none"); });
    }
    return () => { cancelled = true; };
  }, [isSealedByOther, isStale, artifact.id, editStatus]);

  useEffect(() => {
    let cancelled = false;
    if (isSealedByMe && !isStale) {
      invoke("list-edit-requests", { attachmentId: artifact.id })
        .then((r) => { if (!cancelled) setMyRequests(r?.requests || []); })
        .catch(() => { if (!cancelled) setMyRequests([]); });
    }
    if (!isStale && (isSealedByMe || (isSealedByOther && viewer?.isSpaceAdmin === true))) {
      invoke("list-edit-grants", { attachmentId: artifact.id })
        .then((r) => { if (!cancelled) setMyGrants(r?.grants || []); })
        .catch(() => { if (!cancelled) setMyGrants([]); });
    }
    return () => { cancelled = true; };
  }, [isSealedByMe, isSealedByOther, viewer?.isSpaceAdmin, isStale, artifact.id]);

  const reloadGrants = () => invoke("list-edit-grants", { attachmentId: artifact.id }).then((g) => setMyGrants(g?.grants || [])).catch(() => {});
  const revokeGrant = async (editorAccountId) => {
    setGrantBusy(editorAccountId);
    const ok = await run("revoke", "revoke-edit-grant", { attachmentId: artifact.id, editorAccountId }, { refresh: false });
    if (ok) setMyGrants((p) => (p || []).filter((g) => g.editorAccountId !== editorAccountId));
    setGrantBusy(null);
  };

  const resolveEditReq = async (requesterAccountId, action) => {
    setReqBusy(`${requesterAccountId}:${action}`);
    const ok = await run(action, action === "approve" ? "approve-edit-request" : "deny-edit-request", { attachmentId: artifact.id, requesterAccountId }, { refresh: false });
    if (ok) setMyRequests((p) => (p || []).filter((x) => x.requesterAccountId !== requesterAccountId));
    if (ok && action === "approve") reloadGrants();
    setReqBusy(null);
  };

  const copyLink = async () => {
    const href = downloadHref || (siteUrl && pageId ? `${siteUrl}/wiki/pages/viewpage.action?pageId=${pageId}` : "");
    if (!href) return;
    setCopied(await copyText(href));
    setTimeout(() => setCopied(false), 1800);
  };

  const row = attachmentRow(artifact, { editStatus, editExpiresAt, editRetryAt, pendingRequests: myRequests || [], watching: isWatching });
  const { primary, menu } = rowActions(row, viewer, { allowRestore: artifact.allowRestore, allowPurge: artifact.allowPurge, allowDelete: artifact.allowDelete, viewUrl, propertiesUrl });
  const chip = statusChip(artifact);

  const onMenu = (id) => {
    switch (id) {
      case "extend": run("extend", "extend-seal", { attachmentId: artifact.id }); break;
      case "release": run("unseal", "unseal-artifact", { attachmentId: artifact.id }, { flash: "unsealed" }); break;
      case "watch": run("watch", "watch-artifact", { attachmentId: artifact.id }, { refresh: false, watch: true }); break;
      case "unwatch": run("watch", "unwatch-artifact", { attachmentId: artifact.id }, { refresh: false, watch: false }); break;
      case "copy-link": copyLink(); break;
      case "force-release": setReasonText(""); setBar("force"); break;
      case "give-access": setGiving(true); break;
      case "view": if (viewUrl) router.open(viewUrl); break;
      case "properties": if (propertiesUrl) router.open(propertiesUrl); break;
      case "delete": setPendingConfirm("delete"); break;
      case "purge": setPendingConfirm("purge"); break;
      default: break;
    }
  };
  const handlers = {
    seal: () => run("seal", "seal-artifact", { attachmentId: artifact.id }, { flash: "sealed" }),
    release: () => run("unseal", "unseal-artifact", { attachmentId: artifact.id }, { flash: "unsealed" }),
    decide: resolveEditReq,
    request: () => { setReasonText(""); setBar("request"); },
    restore: () => run("restore", "restore-sealed-artifact", { attachmentId: artifact.id }),
    purge: () => setPendingConfirm("purge"),
  };
  const submitBar = async () => {
    const ok = bar === "force"
      ? await run("unseal", "unseal-artifact", { attachmentId: artifact.id, adminOverride: true, reason: reasonText.trim() }, { flash: "unsealed" })
      : await run("editreq", "request-edit-access", { attachmentId: artifact.id, reason: reasonText.trim() }, { refresh: false });
    if (ok) { if (bar === "request") setEditStatus("pending"); setBar(null); setReasonText(""); }
  };

  // Meta items gated by visibleColumns
  const metaItems = [];
  if (visibleColumns.heldBy && artifact.lockedByAccountId) {
    metaItems.push(
      <span key="owner" className="card-meta-owner">
        <span className="card-meta-owner-label">Sealed by</span>
        <OperatorTag accountId={artifact.lockedByAccountId} />
      </span>
    );
  }
  if (visibleColumns.lapses && row.sealed) {
    metaItems.push(<span key="lapses" className="card-meta-item">{formatRemainingTime(artifact)}</span>);
  }
  if (visibleColumns.fileSize && artifact.fileSize) {
    metaItems.push(<span key="size" className="card-meta-item">{formatFileSize(artifact.fileSize)}</span>);
  }
  if (visibleColumns.fileType && artifact.mediaType) {
    metaItems.push(<span key="type" className="card-meta-item card-meta-type">{artifact.mediaType.split("/").pop()}</span>);
  }
  if (visibleColumns.comment) {
    const commentText = artifact.comment || (typeof artifact.version === "object" ? artifact.version?.message : null);
    if (commentText) {
      metaItems.push(<span key="cmt" className="card-meta-item card-meta-comment" title={commentText}>{commentText}</span>);
    }
  }
  if (visibleColumns.createdAt && artifact.createdAt) {
    const d = new Date(artifact.createdAt);
    metaItems.push(<span key="created" className="card-meta-item">{d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>);
  }
  if (visibleColumns.version) {
    const ver = artifact.versionNumber || (typeof artifact.version === "object" ? artifact.version?.number : artifact.version);
    if (ver) {
      metaItems.push(<span key="ver" className="card-meta-item">v{ver}</span>);
    }
  }
  if (visibleColumns.watch && isWatching && isSealedByOther) {
    metaItems.push(<span key="watching" className="card-meta-item card-meta-watching" role="status">Watching for release</span>);
  }

  const showLabels = visibleColumns.labels && artifact.labels?.length > 0;
  const hasSecondLine = metaItems.length > 0 || showLabels;

  return (
    <div className={`artifact-card status-${chip.cls}`} role="listitem" data-roving-card tabIndex={-1} aria-label={chip.aria} data-testid="sv-card" data-primary={primary.kind}>
      <div className="card-row card-row-primary">
        <span className="card-filename">
          <button
            className={`card-expand-toggle ${expanded ? "is-expanded" : ""}`}
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse details" : "Show details"}
            title={expanded ? "Collapse details" : "Show details"}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            </svg>
          </button>
          {/* F3 (owner feedback 2026-08-27): image-20230720-212157.png tells you nothing about
              which image it is. Show the image; clicking it opens the file. */}
          {isImage && pageId ? (
            <ThumbnailPreview
              artifactId={artifact.id}
              contentId={pageId}
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
          {/* Always visible: state must never be colour-only (UX review P1-8), and it is named. */}
          <span className={`status-lozenge ${chip.cls}`} role="status" aria-label={chip.aria} title={chip.aria}>{chip.text}</span>
          {visibleColumns.actions && <PrimarySlot primary={primary} name={artifact.title} busy={busyAction} reqBusy={reqBusy} on={handlers} />}
          {visibleColumns.actions && <ActionMenu items={menu} onPick={onMenu} label={`More actions for ${artifact.title}`} testId="sv-kebab" />}
        </span>
      </div>
      {hasSecondLine && (
        <div className="card-row card-row-secondary">
          <span className="card-secondary-left">
            {metaItems.length > 0 && (
              <span className="card-meta">
                {metaItems.reduce((acc, item, i) => {
                  if (i > 0) acc.push(<span key={`sep-${i}`} className="card-meta-sep">&middot;</span>);
                  acc.push(item);
                  return acc;
                }, [])}
              </span>
            )}
            {showLabels && (
              <span className="card-labels-inline">
                {artifact.labels.map(l => (
                  <span key={l.id || l.name} className="label-chip">
                    <span className="label-chip-name">{l.name}</span>
                  </span>
                ))}
              </span>
            )}
          </span>
        </div>
      )}

      <CopiedNote shown={copied} />
      <ErrorRow message={errorMessage} onDismiss={onClearError} />

      {pendingConfirm === "delete" && (
        <ConfirmDialog
          title={`Delete ${artifact.title}?`}
          message="It goes to the trash. The seal stays on the record until the file is restored or the record is removed."
          confirmLabel="Delete"
          busy={busyAction === "delete"}
          onCancel={() => setPendingConfirm(null)}
          onConfirm={() => { setPendingConfirm(null); run("delete", "delete-artifact", { attachmentId: artifact.id }, { afterDelete: true }); }}
        />
      )}
      {pendingConfirm === "purge" && (
        <ConfirmDialog
          title={isRecoverable ? `Delete ${artifact.title} permanently?` : `Remove the seal record for ${artifact.title}?`}
          message={isRecoverable ? "The file is purged from the trash and its seal record removed. This cannot be undone." : "The file is already gone; this removes the seal record that still points at it. This cannot be undone."}
          confirmLabel={isRecoverable ? "Delete permanently" : "Remove record"}
          busy={busyAction === "purge"}
          onCancel={() => setPendingConfirm(null)}
          onConfirm={() => { setPendingConfirm(null); run("purge", "purge-seal-record", { attachmentId: artifact.id }); }}
        />
      )}

      {bar && <ReasonBar mode={bar} value={reasonText} onChange={setReasonText} onSubmit={submitBar} onCancel={() => { setBar(null); setReasonText(""); }} busy={busyAction === "unseal" || busyAction === "editreq"} />}
      {isSealedByMe && <RequestInbox requests={myRequests} name={artifact.title} reqBusy={reqBusy} onDecide={resolveEditReq} firstDecidedAbove={primary.kind === "decide"} />}
      {giving && <GiveAccessDialog invoker={signedInvoke} target={{ attachmentId: artifact.id }} name={artifact.title} onClose={() => setGiving(false)} onGranted={reloadGrants} />}
      {(isSealedByMe || (myGrants || []).length > 0) && <GrantInbox grants={myGrants} name={artifact.title} grantBusy={grantBusy} onRevoke={revokeGrant} />}

      {/* Expand panel: thumbnail + view link */}
      {expanded && (
        <div className="card-row card-row-expand">
          {isImage && pageId && <ThumbnailPreview artifactId={artifact.id} contentId={pageId} alt={artifact.title} cachedDataUri={cachedPreview} onCached={setCachedPreview} />}
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

const ArtifactControlPanel = () => {
  const [fileList, setFileList] = useState([]);
  const { statusById: editStatusById, ready: editStatusReady } = useEditStatuses(fileList); // groups the Sealed grid
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState(null);
  const [orderByField, setOrderByField] = useState("title");
  const [orderDirection, setOrderDirection] = useState("asc");
  // Page panel settings
  const [panelHidden, setPanelHidden] = useState(false);
  const [panelConfigUpdating, setPanelConfigUpdating] = useState(false);
  const [panelConfigReady, setPanelConfigReady] = useState(false);
  // Track global auto-unlock enabled status
  const [expiryAlertsActive, setExpiryAlertsActive] = useState(true);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  // Track dispatch request state per artifact
  const [watchStatus, setWatchStatus] = useState({});
  // Track which artifact + action is currently in flight
  const [busyAction, setBusyAction] = useState(null);
  // Per-card action errors (the resolver's reason on refusal) — keyed by artifact id.
  const [cardErrors, setCardErrors] = useState({});
  // What the row rule needs to know about the caller (row-state.js `viewer`); see the panel.
  const [viewer, setViewer] = useState({ canEditPage: true, isSpaceAdmin: false });
  // Site context for download/preview URLs
  const [siteUrl, setSiteUrl] = useState(null);
  const [spaceKey, setSpaceKey] = useState(null);
  const [pageId, setPageId] = useState(null);
  const [pageLocation, setPageLocation] = useState(null);

  // Column visibility state
  const [visibleColumns, setVisibleColumns] = useState(() =>
    loadColumnPrefs("sv-overlay-columns", OVERLAY_COLUMNS),
  );
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);

  // Pagination state for artifacts tab
  const [moreFilesAvailable, setMoreFilesAvailable] = useState(false);
  const [counts, setCounts] = useState(null); // whole-page numbers from the lister's first page
  const [nextFileCursor, setNextFileCursor] = useState(null);
  const [fetchingMoreFiles, setFetchingMoreFiles] = useState(false);
  const { signedInvoke, signatureDialog } = useSignedInvoke(); // the code prompt when the site signs seal actions


  const retrieveFileData = async (append = false, cursorOverride = null, isEnrichPhase = false) => {
    try {
      if (!append && !isEnrichPhase) setLoading(true);
      setError(null);
      const cursor = cursorOverride !== null ? cursorOverride : null;
      console.log(
        `[OVERLAY] Fetching artifacts: cursor=${cursor}, append=${append}`,
      );

      const result = await invoke("enumerate-doc-artifacts", {
        cursor,
        limit: 10,
      });

      console.log(
        `[OVERLAY] Got result: hasMore=${result.hasMore}, nextCursor=${result.nextCursor}, count=${result.attachments?.length}`,
      );

      const incoming = result.attachments || [];

      // Merge: deduplicate, enrich existing items, add new ones
      setFileList((prev) => {
        if (prev.length === 0) return incoming;
        const prevMap = new Map(prev.map((a) => [a.id, a]));
        const merged = [...prev];
        const existingIds = new Set(prev.map((a) => a.id));

        for (const item of incoming) {
          if (existingIds.has(item.id)) {
            // Enrich existing item with Confluence data
            const idx = merged.findIndex((a) => a.id === item.id);
            if (idx !== -1) merged[idx] = { ...merged[idx], ...item };
          } else {
            // New item — add to list
            merged.push(item);
          }
        }

        return merged;
      });

      // Update both state and refs immediately
      const hasMore = result.hasMore || false;
      const nextCursor = result.nextCursor || null;

      setMoreFilesAvailable(hasMore);
      setNextFileCursor(nextCursor);
      if (result.counts) setCounts(result.counts);

      console.log(
        `[OVERLAY] Updated: hasMore=${hasMore}, nextCursor=${nextCursor}`,
      );
    } catch (err) {
      console.error("Failed to fetch artifacts:", err);
      setError("Unable to retrieve files. Please try again.");
      setFileList([]);
    } finally {
      setLoading(false);
      setEnriching(false);
    }
  };


  useEffect(() => {
    // Initialize theme detection and fetch artifacts
    const initializeComponent = async () => {
      await enablePaletteSync();

      // Fetch site context for download/preview URLs
      try {
        const ctx = await view.getContext();
        setSiteUrl(ctx.siteUrl || null);
        const sk = ctx.extension?.content?.space?.key || ctx.extension?.space?.key || null;
        setSpaceKey(sk);
        if (sk) invoke("check-user-role", { spaceKey: sk }).then((r) => setViewer((v) => ({ ...v, isSpaceAdmin: r?.role === "steward" }))).catch(() => {});
        setPageId(ctx.extension?.content?.id || null);
        setPageLocation(ctx.extension?.location || null);
      } catch (e) {
        console.warn("[OVERLAY] Failed to get context:", e);
      }

      // Phase 1: Show claimed files instantly from KVS
      let hasPhase1 = false;
      try {
        const seals = await invoke("enumerate-page-seals", { pageId: null });
        if (seals?.claimedArtifacts?.length > 0) {
          setFileList(seals.claimedArtifacts);
          setLoading(false);
          setEnriching(true);
          hasPhase1 = true;
        }
      } catch (e) {
        console.warn("[OVERLAY] Fast seal fetch failed:", e);
      }

      // Phase 2 (slow Confluence file enrichment), global settings, and panel status are
      // INDEPENDENT — run them concurrently. The old sequential chain made the "Checking
      // macro visibility…" strip and the gating toggle wait >5s behind the file enrichment
      // they don't need (the same stuck-behind-a-slow-await class as the it26 realm-console
      // fix; flagged as the COVERAGE-MATRIX first-paint LEAD).
      await Promise.allSettled([
        retrieveFileData(false, null, hasPhase1),
        (async () => {
          try {
            const globalSettings = await invoke("load-policy", { scope: "global" });
            setExpiryAlertsActive(globalSettings?.expiryAlertsActive !== false);
          } catch (error) {
            console.warn("Failed to get auto-unlock setting, defaulting to enabled:", error);
          } finally {
            setSettingsLoaded(true);
          }
        })(),
        (async () => {
          try {
            const panelStatus = await invoke("check-panel-status", { pageId: null });
            setPanelHidden(panelStatus?.macroDisabled === true);
          } catch (error) {
            console.warn("Failed to get panel status:", error);
          } finally {
            setPanelConfigReady(true);
          }
        })(),
      ]);
    };
    initializeComponent();
  }, []);

  // Poll for seal changes made in other surfaces (inline panel, ribbon, etc.)
  useEffect(() => {
    let lastStamp = null;

    const poll = async () => {
      try {
        const { stamp } = await invoke("check-seal-stamp");
        if (lastStamp !== null && stamp !== lastStamp) {
          retrieveFileData();
        }
        lastStamp = stamp;
      } catch (e) {
        // Polling failures are non-critical
      }
    };

    const interval = setInterval(poll, 5000);
    poll();

    return () => clearInterval(interval);
  }, []);

  // Persist column preferences
  useEffect(() => {
    localStorage.setItem("sv-overlay-columns", JSON.stringify(visibleColumns));
  }, [visibleColumns]);


  const fetchNextFilePage = useCallback(async () => {
    console.log(
      `[OVERLAY] fetchNextFilePage called: hasMore=${moreFilesAvailable}, isLoading=${fetchingMoreFiles}, nextCursor=${nextFileCursor}`,
    );

    if (!moreFilesAvailable || fetchingMoreFiles || !nextFileCursor) {
      console.log(`[OVERLAY] fetchNextFilePage skipped - conditions not met`);
      return;
    }

    console.log(
      `[OVERLAY] fetchNextFilePage proceeding with cursor=${nextFileCursor}`,
    );
    setFetchingMoreFiles(true);
    try {
      await retrieveFileData(true, nextFileCursor);
    } catch (error) {
      console.error("Error loading more artifacts:", error);
    } finally {
      setFetchingMoreFiles(false);
    }
  }, [moreFilesAvailable, fetchingMoreFiles, nextFileCursor]);


  const onDismiss = () => {
    view.close();
  };

  // ONE call path for every card action. A refusal (`success:false`) lands on THAT card's error
  // row with the resolver's reason and never flashes success — the review caught the overlay
  // flashing "Unsealed" on a refused unseal because onReleaseFile never read the result.
  const runCardAction = async (artifactId, busyKey, action, payload, { refresh = true, flash = null, watch = null, afterDelete = false } = {}) => {
    setBusyAction({ id: artifactId, action: busyKey });
    setCardErrors((p) => ({ ...p, [artifactId]: null }));
    try {
      const r = await signedInvoke(action, payload);
      if (!r || r.success === false || r.ok === false) {
        setCardErrors((p) => ({ ...p, [artifactId]: r?.reason || "That did not work. Try again." }));
        return false;
      }
      if (watch !== null) setWatchStatus((prev) => ({ ...prev, [artifactId]: watch }));
      if (afterDelete) {
        // Wait for Confluence to process the trash before re-fetching, then re-fetch the seals
        // (to show the trashed item) and the attachments.
        await new Promise((res) => setTimeout(res, 1000));
        try {
          const seals = await invoke("enumerate-page-seals", { pageId: null });
          setFileList(seals?.claimedArtifacts?.length > 0 ? seals.claimedArtifacts : []);
        } catch (_) { /* fall through */ }
        await retrieveFileData(false, null, true);
      } else if (refresh) {
        await retrieveFileData();
      }
      if (flash) {
        const name = fileList.find((att) => att.id === artifactId)?.title || "attachment";
        try { await (flash === "sealed" ? flashArtifactSealed(name) : flashArtifactUnsealed(name)); } catch (_) { /* the write succeeded; the flash is decoration */ }
      }
      return true;
    } catch (err) {
      console.error(`[OVERLAY] ${action} failed:`, err);
      setCardErrors((p) => ({ ...p, [artifactId]: "Could not reach Sentinel Vault. Try again." }));
      return false;
    } finally {
      setBusyAction(null);
    }
  };

  // Check dispatch request status for sealed artifacts
  useEffect(() => {
    const checkDispatchStatus = async () => {
      const sealedArtifacts = fileList.filter(
        (att) => att.lockStatus === "HELD",
      );
      for (const att of sealedArtifacts) {
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
    if (fileList.length > 0) {
      checkDispatchStatus();
    }
  }, [fileList]);

  // Expiry dispatch effect - show banner when operator's seals have expired
  useEffect(() => {
    const checkExpiredArtifacts = async () => {
      const expiredArtifacts = fileList.filter((artifact) => {
        if (!artifact.expiresAt || artifact.lockStatus !== "HELD_BY_ACTOR") return false;
        return new Date(artifact.expiresAt) <= new Date();
      });

      if (expiredArtifacts.length > 0) {
        try {
          const { showFlag } = await import("@forge/bridge");
          for (const artifact of expiredArtifacts) {
            showFlag({
              id: "expiry-notice-" + artifact.id,
              title: "Seal expired",
              description: `Your seal on "${artifact.title}" has expired. Release it when you are finished.`,
              type: "warning",
              appearance: "warning",
              isAutoDismiss: false,
              actions: [{ text: "Understood", onClick: () => {} }],
            });
          }
        } catch (error) {
          console.warn("Failed to show expiry dispatch:", error);
        }
      }
    };
    checkExpiredArtifacts();
  }, [fileList]);

  // Seal countdown — the shared formatter (rolls up to days; "-" when no expiry).
  const formatRemainingTime = (artifact) => formatRemaining(artifact.expiresAt);

  const onReorderColumn = (field) => {
    if (orderByField === field) {
      setOrderDirection(orderDirection === "asc" ? "desc" : "asc");
    } else {
      setOrderByField(field);
      setOrderDirection("asc");
    }
  };

  const arrangeFileList = () => {
    return [...fileList].sort((a, b) => {
      let aValue = a[orderByField];
      let bValue = b[orderByField];

      // Handle different field types
      if (orderByField === "title") {
        aValue = aValue?.toLowerCase() || "";
        bValue = bValue?.toLowerCase() || "";
      } else if (orderByField === "lockStatus") {
        // Sort by seal status priority: UNLOCKED < SEALED BY ME < SEALED
        const statusPriority = {
          OPEN: 0,
          "HELD_BY_ACTOR": 1,
          HELD: 2,
        };
        aValue = statusPriority[aValue] || 0;
        bValue = statusPriority[bValue] || 0;
      } else if (orderByField === "expiresAt") {
        // Handle date sorting, treating null/undefined as far future
        aValue = aValue ? new Date(aValue).getTime() : Number.MAX_SAFE_INTEGER;
        bValue = bValue ? new Date(bValue).getTime() : Number.MAX_SAFE_INTEGER;
      }

      if (orderDirection === "asc") {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });
  };



  const formatReservedDate = (timestamp) => {
    if (!timestamp) return "-";
    const date = new Date(timestamp);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };


  return (
    <div className="modal-container">
      {signatureDialog}
      <div className="modal-header">
        <h1 className="modal-title">Sentinel Vault</h1>
        <button onClick={onDismiss} className="modal-close" title="Close Sentinel Vault overlay" aria-label="Close Sentinel Vault overlay">
          ×
        </button>
      </div>

      {/* Toolbar */}
      <div className="overlay-toolbar">
        <ColumnPicker
          columns={OVERLAY_COLUMNS}
          visible={visibleColumns}
          onChange={(key) => setVisibleColumns((prev) => ({ ...prev, [key]: !prev[key] }))}
          isOpen={columnPickerOpen}
          onToggle={setColumnPickerOpen}
        />
        <SortPicker
          orderField={orderByField}
          orderDir={orderDirection}
          onSort={onReorderColumn}
        />
        <span className="toolbar-file-count">
          {`${fileList.length} file${fileList.length !== 1 ? "s" : ""}`}
        </span>
        <button
          className="toolbar-refresh"
          onClick={() => retrieveFileData()}
          title="Refresh file list to show latest changes"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Inline panel visibility setting */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--sv-border-primary)",
          // it57: no faded state-wash (rule-b) — neutral surface; the dot + text + button carry state.
          background: "var(--sv-bg-secondary)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "16px",
          }}
        >
          <div style={{ flex: 1 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "4px",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  // it57: token-based (dark-safe) — solid teal when the macro is visible, muted otherwise.
                  background: panelConfigReady && !panelHidden
                    ? "var(--sv-interactive-success)"
                    : "var(--sv-text-subtle)",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "var(--sv-text-primary)",
                }}
              >
                {!panelConfigReady
                  ? "Checking macro visibility…"
                  : panelHidden
                    ? "Sentinel Vault macro is hidden on this page"
                    : "Sentinel Vault macro is visible on this page"}
              </span>
            </div>
            <p
              style={{
                margin: 0,
                fontSize: "12px",
                lineHeight: "1.5",
                color: "var(--sv-text-subtle)",
                paddingLeft: "16px",
              }}
            >
              {!panelConfigReady
                ? "Checking whether the Sentinel Vault macro is enabled for this page…"
                : panelHidden
                  ? "The Sentinel Vault macro on this page is hidden. Page viewers won't see seal status inline, but you can still manage seals from this dialog."
                  : "The Sentinel Vault macro is embedded in this page, showing seal status and actions directly in the page content for all viewers."}
            </p>
          </div>
          <button
            disabled={panelConfigUpdating || !panelConfigReady}
            onClick={async () => {
              const newValue = !panelHidden;
              setPanelConfigUpdating(true);
              try {
                await invoke("store-doc-panel-prefs", {
                  pageId: null,
                  macroDisabled: newValue,
                });
                setPanelHidden(newValue);
              } catch (err) {
                console.error("Failed to save panel settings:", err);
              } finally {
                setPanelConfigUpdating(false);
              }
            }}
            style={{
              // it57: solid primary (teal) CTA to show the macro; secondary outline to hide. No green.
              background: panelConfigReady && panelHidden
                ? "var(--sv-interactive-primary)"
                : "transparent",
              color: !panelConfigReady
                ? "var(--sv-text-subtle)"
                : panelHidden
                  ? "#ffffff"
                  : "var(--sv-text-secondary)",
              border: panelConfigReady && panelHidden
                ? "1px solid var(--sv-interactive-primary)"
                : "1px solid var(--sv-border-secondary)",
              padding: "6px 14px",
              borderRadius: "3px",
              fontSize: "12px",
              cursor: panelConfigUpdating || !panelConfigReady ? "not-allowed" : "pointer",
              opacity: panelConfigUpdating || !panelConfigReady ? 0.6 : 1,
              transition: "all 0.15s",
              fontWeight: 500,
              whiteSpace: "nowrap",
              flexShrink: 0,
              marginTop: "1px",
            }}
          >
            {!panelConfigReady
              ? "Please wait…"
              : panelConfigUpdating
                ? "Saving…"
                : panelHidden
                  ? "Show macro"
                  : "Hide macro"}
          </button>
        </div>
      </div>

      <div
        className="modal-body"
        style={{ display: "flex", flexDirection: "column" }}
      >
        {error && <div className="alert-error">{error}</div>}

        {/* Page Artifacts */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
            }}
          >
            {loading && !fileList.length && (
              <div className="sv-card-list" data-cols="3" style={{ '--sv-cards-per-row': 3 }}>
                {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={`init-skel-${i}`} />)}
              </div>
            )}

            {!loading && !error && fileList.length === 0 && (
              <>
                <div className="alert-info">
                  This page has no files attached.
                </div>
                {/* A1: the page's activity is still worth reading when there are no files. */}
                <div className="sv-card-section sv-activity-section">
                  <div className="sv-card-section-header">
                    <span className="sv-card-section-title">Activity</span>
                    <span className="sv-card-section-note">Everything Sentinel Vault did or was asked to do on this page</span>
                  </div>
                  <ActivityFeed pageId={pageId} pageSize={10} />
                </div>
              </>
            )}

            {!loading && !error && fileList.length > 0 && (
              <div
                className="attachments-tab-content"
                style={{ flex: 1, overflowY: "auto", minHeight: 0 }}
              >
                {(() => {
                  const sortedFiles = arrangeFileList();
                  const isClaimedFile = (a) => a.lockStatus === "HELD" || a.lockStatus === "HELD_BY_ACTOR";
                  const prioritized = [...sortedFiles].sort((a, b) => (isClaimedFile(a) ? 0 : 1) - (isClaimedFile(b) ? 0 : 1));
                  const staleFiles = prioritized.filter((a) => a.isStale);
                  const claimedFiles = prioritized.filter((a) => isClaimedFile(a) && !a.isStale);
                  const availableFiles = prioritized.filter((a) => !isClaimedFile(a) && !a.isStale);
                  return (
                    <>
                      {claimedFiles.length > 0 && (() => {
                        // Ticket 2026-09-24: grouped by what YOU can do (kit/sealed-groups.js, shared with the panel).
                        const groups = groupSealedFiles(claimedFiles, editStatusById);
                        return (
                          <div className="sv-card-section" data-testid="sv-sealed-groups">
                            <div className="sv-card-section-header">
                              <span className="sv-card-section-title">Sealed</span>
                              <span className="sv-card-section-count" data-testid="sv-count-sealed">{counts?.sealed ?? claimedFiles.length}</span>
                            </div>
                            {SEALED_GROUPS.map((g) => {
                              const files = groups[g.id];
                              if (!files.length) return null;
                              const waiting = g.id !== "mine" && !editStatusReady;
                              if (waiting && g.id === "editNow") return null;
                              return (
                                <div key={g.id} className="sv-sealed-group" data-testid={`sv-sealed-group-${g.id}`}>
                                  <div className="sv-sealed-group-header">
                                    <span className="sv-sealed-group-title">{g.title}</span>
                                    <span className="sv-sealed-group-count">{files.length}</span>
                                    <span className="sv-sealed-group-note">{g.note}</span>
                                  </div>
                                  {waiting
                                    ? <div className="sv-sealed-group-wait" role="status">Checking your access…</div>
                                    : (
                                      <CappedGroup items={files}>{(shown) => (
                                      <RovingList className="sv-card-list" data-cols="3" label={`${g.title} attachments`}>
                                        {shown.map((artifact) => (
                                          <OverlayArtifactCard
                                signedInvoke={signedInvoke}
                                key={artifact.id}
                                editInfo={editStatusById[artifact.id]}
                                artifact={artifact}
                                visibleColumns={visibleColumns}
                                run={(busyKey, action, payload, opts) => runCardAction(artifact.id, busyKey, action, payload, opts)}
                                errorMessage={cardErrors[artifact.id] || null}
                                onClearError={() => setCardErrors((p) => ({ ...p, [artifact.id]: null }))}
                                isWatching={watchStatus[artifact.id]}
                                viewer={viewer}
                                busyAction={busyAction?.id === artifact.id ? busyAction.action : null}
                                formatRemainingTime={formatRemainingTime}
                                formatFileSize={formatFileSize}
                                siteUrl={siteUrl}
                                spaceKey={spaceKey}
                                pageId={pageId}
                                pageLocation={pageLocation}
                              />
                                        ))}
                                      </RovingList>
                                      )}</CappedGroup>
                                    )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                      {staleFiles.length > 0 && (
                        <div className="sv-card-section">
                          <div className="sv-card-section-header">
                            <span className="sv-card-section-title">Trash</span>
                            <span className="sv-card-section-count badge-stale">{staleFiles.length}</span>
                          </div>
                          <RovingList className="sv-card-list" data-cols="3" label="Trashed attachments">
                            {staleFiles.map((artifact) => (
                              <OverlayArtifactCard
                                signedInvoke={signedInvoke}
                                key={artifact.id}
                                artifact={artifact}
                                visibleColumns={visibleColumns}
                                run={(busyKey, action, payload, opts) => runCardAction(artifact.id, busyKey, action, payload, opts)}
                                errorMessage={cardErrors[artifact.id] || null}
                                onClearError={() => setCardErrors((p) => ({ ...p, [artifact.id]: null }))}
                                isWatching={watchStatus[artifact.id]}
                                viewer={viewer}
                                busyAction={busyAction?.id === artifact.id ? busyAction.action : null}
                                formatRemainingTime={formatRemainingTime}
                                formatFileSize={formatFileSize}
                                siteUrl={siteUrl}
                                spaceKey={spaceKey}
                                pageId={pageId}
                                pageLocation={pageLocation}
                              />
                            ))}
                          </RovingList>
                        </div>
                      )}
                      {availableFiles.length > 0 && (
                        <div className="sv-card-section">
                          <div className="sv-card-section-header">
                            <span className="sv-card-section-title">Available</span>
                            <span className="sv-card-section-count" data-testid="sv-count-available">{counts?.available ?? availableFiles.length}</span>
                          </div>
                          <RovingList className="sv-card-list" data-cols="3" label="Available attachments">
                            {availableFiles.map((artifact) => (
                              <OverlayArtifactCard
                                signedInvoke={signedInvoke}
                                key={artifact.id}
                                artifact={artifact}
                                visibleColumns={visibleColumns}
                                run={(busyKey, action, payload, opts) => runCardAction(artifact.id, busyKey, action, payload, opts)}
                                errorMessage={cardErrors[artifact.id] || null}
                                onClearError={() => setCardErrors((p) => ({ ...p, [artifact.id]: null }))}
                                isWatching={watchStatus[artifact.id]}
                                viewer={viewer}
                                busyAction={busyAction?.id === artifact.id ? busyAction.action : null}
                                formatRemainingTime={formatRemainingTime}
                                formatFileSize={formatFileSize}
                                siteUrl={siteUrl}
                                spaceKey={spaceKey}
                                pageId={pageId}
                                pageLocation={pageLocation}
                              />
                            ))}
                          </RovingList>
                        </div>
                      )}
                      {enriching && (
                        <div className="sv-card-section">
                          <div className="sv-card-section-header">
                            <span className="sv-card-section-title">Loading more files…</span>
                          </div>
                          <div className="sv-card-list" data-cols="3" style={{ '--sv-cards-per-row': 3 }}>
                            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={`skel-${i}`} />)}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
                {(fetchingMoreFiles || moreFilesAvailable) && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                      padding: "20px",
                    }}
                  >
                    {fetchingMoreFiles ? (
                      <div className="sv-card-list" data-cols="3" style={{ '--sv-cards-per-row': 3 }}>
                        {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={`more-skel-${i}`} />)}
                      </div>
                    ) : (
                      <button
                        onClick={fetchNextFilePage}
                        style={{
                          backgroundColor: "var(--sv-interactive-primary)",
                          color: "var(--sv-text-inverse)",
                          border: "none",
                          padding: "8px 16px",
                          borderRadius: "4px",
                          fontSize: "12px",
                          cursor: "pointer",
                          fontWeight: 500,
                          transition: "all 0.15s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.target.style.backgroundColor =
                            "var(--sv-interactive-primary-hover)";
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.backgroundColor =
                            "var(--sv-interactive-primary)";
                        }}
                      >
                        Show more files
                      </button>
                    )}
                  </div>
                )}
                {!moreFilesAvailable && fileList.length > 0 && !loading && (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "16px",
                      color: "var(--sv-text-subtle)",
                      fontStyle: "italic",
                      fontSize: "12px",
                    }}
                  >
                    End of file list
                  </div>
                )}

                {/* A1: Activity beneath the file list — the record of what happened on this page. */}
                <div className="sv-card-section sv-activity-section">
                  <div className="sv-card-section-header">
                    <span className="sv-card-section-title">Activity</span>
                    <span className="sv-card-section-note">Everything Sentinel Vault did or was asked to do on this page</span>
                  </div>
                  <ActivityFeed pageId={pageId} pageSize={10} />
                </div>
              </div>
            )}
          </div>
      </div>

      <div className="modal-footer">
        <button onClick={onDismiss} className="btn btn-primary btn-footer">
          Done
        </button>
      </div>
    </div>
  );
};

// Render the overlay
function renderApp() {
  const container = document.getElementById("root");
  if (container) {
    const root = createRoot(container);
    root.render(<ArtifactControlPanel />);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", renderApp);
} else {
  renderApp();
}
