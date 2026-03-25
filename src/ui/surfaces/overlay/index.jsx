import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { invoke, view } from "@forge/bridge";
import { enablePaletteSync } from "../../kit/palette-sync";
import { flashArtifactSealed, flashArtifactUnsealed } from "../../kit/flash-messages";

// ── Column definitions ──────────────────────────────────
const OVERLAY_COLUMNS = [
  { key: "name",      label: "Name",                 defaultOn: true,  alwaysOn: true },
  { key: "status",    label: "Status",               defaultOn: true },
  { key: "heldBy",    label: "Held by",              defaultOn: true },
  { key: "lapses",    label: "Lapses",               defaultOn: true },
  { key: "watch",     label: "Watch for Relinquish", defaultOn: true },
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
  if (!operatorInfo) return <span>Unknown operator</span>;

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
  const color = isImage ? "#36B37E" : isPdf ? "#FF5630" : "var(--sv-text-subtle)";
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
  { key: "expiresAt", label: "Lapses" },
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

const OverlayArtifactCard = ({ artifact, visibleColumns, onSecure, onRelease, onWatch, isWatching, busyAction, formatRemainingTime, formatFileSize }) => {
  const isSealed = artifact.lockStatus === "HELD" || artifact.lockStatus === "HELD_BY_ACTOR";
  const isSealedByMe = artifact.lockStatus === "HELD_BY_ACTOR";
  const isSealedByOther = artifact.lockStatus === "HELD";

  let statusClass = "unlocked";
  let statusText = "Available";
  if (artifact.isExpired && isSealed) {
    statusClass = "expired";
    statusText = "Overdue";
  } else if (isSealedByMe) {
    statusClass = "locked-by-me";
    statusText = "Yours";
  } else if (isSealed) {
    statusClass = "locked";
    statusText = "Sealed";
  }

  // Primary action
  let primaryAction = null;
  if (visibleColumns.actions) {
    if (!isSealed) {
      primaryAction = (
        <button className={`action-btn lock ${busyAction === "seal" ? "is-busy" : ""}`} onClick={() => onSecure(artifact.id)} disabled={busyAction && busyAction !== "seal"} title="Reserve this file so only you can modify it">
          {busyAction === "seal" ? <>Sealing<span className="btn-busy-bar" /></> : "Seal"}
        </button>
      );
    } else if (isSealedByMe) {
      primaryAction = (
        <button className={`action-btn unlock ${busyAction === "unseal" ? "is-busy" : ""}`} onClick={() => onRelease(artifact.id)} disabled={busyAction && busyAction !== "unseal"} title="Release your seal and allow others to modify this file">
          {busyAction === "unseal" ? <>Releasing<span className="btn-busy-bar" /></> : "Relinquish"}
        </button>
      );
    }
  }

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
  if (visibleColumns.lapses && isSealed) {
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

  // Labels
  const showLabels = visibleColumns.labels && artifact.labels?.length > 0;

  // Secondary actions
  const secondaryActions = [];
  if (visibleColumns.watch && isSealedByOther) {
    secondaryActions.push(
      <button
        key="watch"
        className={`action-btn watch ${isWatching ? "watching" : ""} ${busyAction === "watch" ? "is-busy" : ""}`}
        onClick={() => onWatch(artifact.id)}
        disabled={busyAction && busyAction !== "watch"}
        title={isWatching ? "Stop watching" : "Get notified when relinquished"}
      >
        {busyAction === "watch" ? <>Updating<span className="btn-busy-bar" /></> : (isWatching ? "Watching" : "Watch")}
      </button>
    );
  }

  const hasSecondLine = metaItems.length > 0 || showLabels || secondaryActions.length > 0;

  return (
    <div className={`artifact-card status-${statusClass}`}>
      <div className="card-row card-row-primary">
        <span className="card-filename">
          <ArtifactTypeIcon mediaType={artifact.mediaType} />
          <span className="card-filename-text">{artifact.title}</span>
        </span>
        <span className="card-row-right">
          {visibleColumns.status && (
            <span className={`status-lozenge ${statusClass}`}>{statusText}</span>
          )}
          {primaryAction}
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
          {secondaryActions.length > 0 && (
            <span className="card-secondary-right">{secondaryActions}</span>
          )}
        </div>
      )}
    </div>
  );
};

const MyFileCard = ({ artifact, visibleColumns, onRelease, busyAction, formatRemainingTime, formatReservedDate }) => {
  const isExpired = artifact.isExpired;
  const statusClass = isExpired ? "expired" : "locked-by-me";
  const statusText = isExpired ? "Overdue" : "My Reservation";

  const metaItems = [];
  if (visibleColumns.location && artifact.pageTitle) {
    metaItems.push(
      <span key="loc" className="card-meta-item">
        {artifact.pageUrl ? (
          <a href={artifact.pageUrl} target="_top" style={{ color: "var(--sv-interactive-primary)", textDecoration: "none" }}>
            {artifact.pageTitle}
          </a>
        ) : artifact.pageTitle}
      </span>
    );
  }
  if (visibleColumns.space && (artifact.spaceName || artifact.spaceKey)) {
    metaItems.push(<span key="space" className="card-meta-item">{artifact.spaceName || artifact.spaceKey}</span>);
  }
  if (visibleColumns.claimedOn && artifact.lockedOn) {
    metaItems.push(<span key="claimed" className="card-meta-item">{formatReservedDate(artifact.lockedOn)}</span>);
  }
  if (visibleColumns.lapses) {
    metaItems.push(<span key="lapses" className="card-meta-item">{formatRemainingTime(artifact)}</span>);
  }

  const hasSecondLine = metaItems.length > 0;

  return (
    <div className={`artifact-card status-${statusClass}`}>
      <div className="card-row card-row-primary">
        <span className="card-filename">
          <ArtifactTypeIcon mediaType={artifact.mediaType} />
          <span className="card-filename-text">{artifact.title}</span>
        </span>
        <span className="card-row-right">
          <span className={`status-lozenge ${statusClass}`}>{statusText}</span>
          {visibleColumns.actions && (
            <button className={`action-btn unlock ${busyAction === "unseal" ? "is-busy" : ""}`} onClick={() => onRelease(artifact.id)} disabled={busyAction && busyAction !== "unseal"} title="Release your seal and allow others to modify this file">
              {busyAction === "unseal" ? <>Releasing<span className="btn-busy-bar" /></> : "Relinquish"}
            </button>
          )}
        </span>
      </div>
      {hasSecondLine && (
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
    </div>
  );
};

const ArtifactControlPanel = () => {
  const [fileList, setFileList] = useState([]);
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

  // Column visibility state
  const [visibleColumns, setVisibleColumns] = useState(() =>
    loadColumnPrefs("sv-overlay-columns", OVERLAY_COLUMNS),
  );
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);

  // Pagination state for artifacts tab
  const [moreFilesAvailable, setMoreFilesAvailable] = useState(false);
  const [nextFileCursor, setNextFileCursor] = useState(null);
  const [fetchingMoreFiles, setFetchingMoreFiles] =
    useState(false);


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

      // Phase 2: Full list from Confluence API (merges with Phase 1)
      await retrieveFileData(false, null, hasPhase1);

      // Fetch global settings to check auto-unlock status
      try {
        const globalSettings = await invoke("load-policy", {
          scope: "global",
        });
        const enabled = globalSettings?.expiryAlertsActive !== false;
        setExpiryAlertsActive(enabled);
        setSettingsLoaded(true);
      } catch (error) {
        console.warn(
          "Failed to get auto-unlock setting, defaulting to enabled:",
          error,
        );
        setSettingsLoaded(true);
      }

      // Fetch page-level panel settings
      try {
        const panelStatus = await invoke("check-panel-status", { pageId: null });
        setPanelHidden(panelStatus?.macroDisabled === true);
      } catch (error) {
        console.warn("Failed to get panel status:", error);
      } finally {
        setPanelConfigReady(true);
      }
    };
    initializeComponent();
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

  const onSecureFile = async (artifactId) => {
    setBusyAction({ id: artifactId, action: "seal" });
    try {
      // Find artifact name for dispatch
      const artifact = fileList.find((att) => att.id === artifactId);
      const artifactName = artifact?.title || "attachment";

      const result = await invoke("seal-artifact", { attachmentId: artifactId });
      if (result && result.success === false) {
        setError(result.reason || "Could not seal file.");
        await retrieveFileData();
        return;
      }
      await retrieveFileData();

      // Show success flash (Option 1)
      try {
        await flashArtifactSealed(artifactName);
      } catch (notifyErr) {
        // Flash failed, but seal succeeded - continue
      }
    } catch (err) {
      console.error("Failed to seal artifact:", err);
      setError("Could not seal file.");
    } finally {
      setBusyAction(null);
    }
  };

  const onReleaseFile = async (artifactId) => {
    setBusyAction({ id: artifactId, action: "unseal" });
    try {
      // Find artifact name for dispatch
      const artifact = fileList.find((att) => att.id === artifactId);
      const artifactName = artifact?.title || "attachment";

      await invoke("unseal-artifact", { attachmentId: artifactId });
      await retrieveFileData();

      // Show success flash (Option 1)
      try {
        await flashArtifactUnsealed(artifactName);
      } catch (notifyErr) {
        // Flash failed, but unseal succeeded - continue
      }
    } catch (err) {
      console.error("Failed to unseal artifact:", err);
      setError("Could not relinquish file.");
    } finally {
      setBusyAction(null);
    }
  };

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
              title: "Reservation expired",
              description: `Your reservation on "${artifact.title}" has expired. Relinquish it when you are finished.`,
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

  const formatRemainingTime = (artifact) => {
    if (!artifact.expiresAt) return "-";
    const expiresDate = new Date(artifact.expiresAt);
    const now = new Date();
    const diffMs = expiresDate - now;

    if (diffMs <= 0) {
      return "Overdue";
    }

    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (diffHours > 0) {
      return `${diffHours}h ${diffMinutes}m`;
    }
    return `${diffMinutes}m`;
  };

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
      <div className="modal-header">
        <h1 className="modal-title">Sentinel Vault</h1>
        <button onClick={onDismiss} className="modal-close" title="Close Sentinel Vault overlay">
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
          background: !panelConfigReady
            ? "var(--sv-bg-secondary)"
            : panelHidden
              ? "rgba(222, 53, 11, 0.04)"
              : "rgba(0, 135, 90, 0.04)",
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
                  background: !panelConfigReady
                    ? "#97A0AF"
                    : panelHidden
                      ? "#DE350B"
                      : "#00875A",
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
              background: !panelConfigReady
                ? "transparent"
                : panelHidden
                  ? "#00875A"
                  : "transparent",
              color: !panelConfigReady
                ? "var(--sv-text-subtle)"
                : panelHidden
                  ? "#fff"
                  : "var(--sv-text-secondary)",
              border: !panelConfigReady
                ? "1px solid var(--sv-border-secondary)"
                : panelHidden
                  ? "1px solid #00875A"
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
              <div className="alert-info">
                This page has no files attached.
              </div>
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
                  const claimedFiles = prioritized.filter(isClaimedFile);
                  const availableFiles = prioritized.filter((a) => !isClaimedFile(a));
                  return (
                    <>
                      {claimedFiles.length > 0 && (
                        <div className="sv-card-section">
                          <div className="sv-card-section-header">
                            <span className="sv-card-section-title">Sealed</span>
                            <span className="sv-card-section-count">{claimedFiles.length}</span>
                          </div>
                          <div className="sv-card-list" data-cols="3">
                            {claimedFiles.map((artifact) => (
                              <OverlayArtifactCard
                                key={artifact.id}
                                artifact={artifact}
                                visibleColumns={visibleColumns}
                                onSecure={onSecureFile}
                                onRelease={onReleaseFile}
                                onWatch={onWatchToggle}
                                isWatching={watchStatus[artifact.id]}
                                busyAction={busyAction?.id === artifact.id ? busyAction.action : null}
                                formatRemainingTime={formatRemainingTime}
                                formatFileSize={formatFileSize}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                      {availableFiles.length > 0 && (
                        <div className="sv-card-section">
                          <div className="sv-card-section-header">
                            <span className="sv-card-section-title">Available</span>
                            <span className="sv-card-section-count">{availableFiles.length}</span>
                          </div>
                          <div className="sv-card-list" data-cols="3">
                            {availableFiles.map((artifact) => (
                              <OverlayArtifactCard
                                key={artifact.id}
                                artifact={artifact}
                                visibleColumns={visibleColumns}
                                onSecure={onSecureFile}
                                onRelease={onReleaseFile}
                                onWatch={onWatchToggle}
                                isWatching={watchStatus[artifact.id]}
                                busyAction={busyAction?.id === artifact.id ? busyAction.action : null}
                                formatRemainingTime={formatRemainingTime}
                                formatFileSize={formatFileSize}
                              />
                            ))}
                          </div>
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
