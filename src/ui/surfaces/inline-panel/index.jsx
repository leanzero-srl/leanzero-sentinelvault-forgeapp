import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { invoke, view } from "@forge/bridge";
import { enablePaletteSync } from "../../kit/palette-sync";

// ── Icon components ──────────────────────────────────

const SealGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
    <path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
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

// ── Operator display component ───────────────────────

const extractInitials = (name) => {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name[0].toUpperCase();
};

const OperatorChip = ({ accountId }) => {
  const [operator, setOperator] = useState(null);

  useEffect(() => {
    if (!accountId) return;
    invoke("identify-operator", { accountId })
      .then(setOperator)
      .catch(() => setOperator({ displayName: `User ${accountId.slice(-4)}` }));
  }, [accountId]);

  if (!accountId) return <span style={{ color: "var(--sv-text-subtle)" }}>—</span>;
  if (!operator) return <span style={{ fontSize: "11px", color: "var(--sv-text-subtle)" }}>Resolving...</span>;

  // Use initials avatar instead of image to avoid Forge CSP restrictions
  return (
    <span className="user-display">
      <span className="user-avatar-fallback" title={operator.displayName}>
        <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--sv-text-subtle)" }}>
          {extractInitials(operator.displayName)}
        </span>
      </span>
      {operator.displayName}
    </span>
  );
};

// ── Label chip component ─────────────────────────────

const LabelPill = ({ label, onRemove }) => (
  <span className="label-chip" title={label.name}>
    <span className="label-chip-name">{label.name}</span>
    {onRemove && (
      <button
        className="label-chip-remove"
        onClick={(e) => { e.stopPropagation(); onRemove(label.name); }}
        title="Remove this label from the file"
      >
        ×
      </button>
    )}
  </span>
);

// ── Labels cell component ────────────────────────────

const LabelCluster = ({ labels, artifactId, onRefresh }) => {
  const [adding, setAdding] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [busy, setBusy] = useState(false);

  const handleAdd = async () => {
    const name = inputValue.trim();
    if (!name) { setAdding(false); return; }
    setBusy(true);
    try {
      await invoke("label-artifact", { attachmentId: artifactId, labelName: name });
      setInputValue("");
      setAdding(false);
      onRefresh();
    } catch (e) {
      console.error("Failed to add label:", e);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (labelName) => {
    setBusy(true);
    try {
      await invoke("unlabel-artifact", { attachmentId: artifactId, labelName });
      onRefresh();
    } catch (e) {
      console.error("Failed to remove label:", e);
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleAdd();
    if (e.key === "Escape") { setAdding(false); setInputValue(""); }
  };

  return (
    <div className="labels-cell">
      {labels.map((l) => (
        <LabelPill key={l.id || l.name} label={l} onRemove={busy ? null : handleRemove} />
      ))}
      {adding ? (
        <span className="label-input-wrap">
          <input
            className="label-input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => { if (!inputValue.trim()) setAdding(false); }}
            autoFocus
            disabled={busy}
            placeholder="tag"
          />
        </span>
      ) : (
        <button
          className="label-add-btn"
          onClick={() => setAdding(true)}
          title="Add a label to organize this file"
          disabled={busy}
        >
          +
        </button>
      )}
    </div>
  );
};

// ── Upload zone component ────────────────────────────

const SIZE_LIMIT = 4 * 1024 * 1024; // 4MB

const encodeFileBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // result is "data:mimetype;base64,AAAA..."
      const base64 = reader.result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Could not process file"));
    reader.readAsDataURL(file);
  });
};

const UploadZone = ({ onUploadComplete }) => {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  const processFile = async (file) => {
    setUploadError(null);

    if (file.size > SIZE_LIMIT) {
      setUploadError(`File exceeds size limit (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed is 4 MB.`);
      return;
    }

    setUploading(true);
    try {
      const fileDataBase64 = await encodeFileBase64(file);
      const result = await invoke("upload-artifact", {
        fileName: file.name,
        fileDataBase64,
      });

      if (result.success) {
        onUploadComplete();
      } else {
        setUploadError(result.reason || "Transfer unsuccessful");
      }
    } catch (e) {
      console.error("Upload error:", e);
      setUploadError("Transfer unsuccessful. File size may exceed the limit.");
    } finally {
      setUploading(false);
    }
  };

  const handleFileInput = (e) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    // Reset input so the same file can be re-selected
    e.target.value = "";
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragOver(false);
  };

  return (
    <div className="upload-zone-wrapper">
      <div
        className={`upload-zone ${dragOver ? "drag-over" : ""} ${uploading ? "uploading" : ""}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {uploading ? (
          <span className="upload-zone-text">Uploading...</span>
        ) : (
          <>
            <span className="upload-zone-text">
              <svg className="upload-zone-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {" "}Drop files here or{" "}
              <label className="upload-zone-link">
                click to select
                <input
                  type="file"
                  onChange={handleFileInput}
                  style={{ display: "none" }}
                />
              </label>
            </span>
            <span className="upload-zone-hint">Up to 4 MB</span>
          </>
        )}
      </div>
      {uploadError && (
        <div className="upload-zone-error">{uploadError}</div>
      )}
    </div>
  );
};

// ── Artifact card component ─────────────────────────

const ArtifactCard = ({ att, onRefresh, columns }) => {
  const [actionBusy, setActionBusy] = useState(null);

  const isSealed = att.lockStatus === "HELD" || att.lockStatus === "HELD_BY_ACTOR";
  const isSealedByMe = att.lockStatus === "HELD_BY_ACTOR";
  const isSealedByOther = att.lockStatus === "HELD";
  const canUnseal = isSealedByMe;
  const isStale = att.isStale === true;
  const isRecoverable = att.staleReason === "trashed";

  const handleSeal = async () => {
    setActionBusy("seal");
    try {
      const result = await invoke("seal-artifact", { attachmentId: att.id });
      if (result && result.success === false) {
        alert(result.reason || "Seal unsuccessful");
      }
      onRefresh();
    } catch (e) {
      console.error("Seal failed:", e);
    } finally {
      setActionBusy(null);
    }
  };

  const handleUnseal = async () => {
    setActionBusy("unseal");
    try {
      await invoke("unseal-artifact", { attachmentId: att.id });
      onRefresh();
    } catch (e) {
      console.error("Unseal failed:", e);
    } finally {
      setActionBusy(null);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Remove "${att.title}"? It will be sent to the trash.`)) return;
    setActionBusy("delete");
    try {
      const result = await invoke("delete-artifact", { attachmentId: att.id });
      if (result.success) {
        onRefresh();
      } else {
        alert(result.reason || "Removal unsuccessful");
      }
    } catch (e) {
      console.error("Delete failed:", e);
    } finally {
      setActionBusy(null);
    }
  };

  const handleDispatch = async () => {
    setActionBusy("watch");
    try {
      if (att.notifyRequested) {
        const result = await invoke("unwatch-artifact", { attachmentId: att.id });
        if (result.success) onRefresh();
      } else {
        const result = await invoke("watch-artifact", { attachmentId: att.id });
        if (result.success) onRefresh();
      }
    } catch (e) {
      console.error("Dispatch toggle failed:", e);
    } finally {
      setActionBusy(null);
    }
  };

  const handleRestore = async () => {
    setActionBusy("restore");
    try {
      const result = await invoke("restore-sealed-artifact", { attachmentId: att.id });
      if (result && result.success) {
        onRefresh();
      } else {
        alert(result?.reason || "Restore unsuccessful");
      }
    } catch (e) {
      console.error("Restore failed:", e);
    } finally {
      setActionBusy(null);
    }
  };

  const handlePurge = async () => {
    if (!window.confirm(`Remove the seal record for "${att.title}"? This cannot be undone.`)) return;
    setActionBusy("purge");
    try {
      const result = await invoke("purge-seal-record", { attachmentId: att.id });
      if (result && result.success) {
        onRefresh();
      } else {
        alert(result?.reason || "Cleanup unsuccessful");
      }
    } catch (e) {
      console.error("Purge failed:", e);
    } finally {
      setActionBusy(null);
    }
  };

  // Status
  let statusClass = "unlocked";
  let statusText = "Available";
  if (isStale && isRecoverable) {
    statusClass = "trashed";
    statusText = "Trashed";
  } else if (isStale) {
    statusClass = "stale";
    statusText = "Missing";
  } else if (att.isExpired && isSealed) {
    statusClass = "expired";
    statusText = "Overdue";
  } else if (isSealedByMe) {
    statusClass = "locked-by-me";
    statusText = "My Reservation";
  } else if (isSealed) {
    statusClass = "locked";
    statusText = "Sealed";
  }

  // Meta items (second line)
  const metaItems = [];
  if (columns.lockOwner && att.lockedByAccountId) {
    metaItems.push(
      <span key="owner" className="card-meta-owner">
        <span className="card-meta-owner-label">Sealed by</span>
        <OperatorChip accountId={att.lockedByAccountId} />
      </span>
    );
  }
  if (columns.fileSize && att.fileSize) {
    metaItems.push(<span key="size" className="card-meta-item">{renderByteSize(att.fileSize)}</span>);
  }
  if (columns.fileType && att.mediaType) {
    metaItems.push(<span key="type" className="card-meta-item card-meta-type">{att.mediaType.split("/").pop()}</span>);
  }
  if (columns.expiresAt && att.expiresAt) {
    metaItems.push(<span key="exp" className="card-meta-item">{renderLapseDate(att.expiresAt)}</span>);
  }
  if (columns.comment && att.comment) {
    metaItems.push(<span key="cmt" className="card-meta-item card-meta-comment" title={att.comment}>{att.comment}</span>);
  }

  // Primary action (line 1)
  let primaryActionBtn = null;
  if (columns.actions) {
    if (isStale && isRecoverable && att.allowRestore) {
      primaryActionBtn = (
        <button className={`action-btn restore ${actionBusy === "restore" ? "is-busy" : ""}`} onClick={handleRestore} disabled={actionBusy && actionBusy !== "restore"} title="Restore this trashed attachment back to the page">
          {actionBusy === "restore" ? <>Restoring<span className="btn-busy-bar" /></> : "Restore"}
        </button>
      );
    } else if (isStale) {
      // Permanently deleted — no primary action possible
      primaryActionBtn = null;
    } else if (!isSealed) {
      primaryActionBtn = (
        <button className={`action-btn lock ${actionBusy === "seal" ? "is-busy" : ""}`} onClick={handleSeal} disabled={actionBusy && actionBusy !== "seal"} title="Reserve this file so only you can modify it">
          {actionBusy === "seal" ? <>Sealing<span className="btn-busy-bar" /></> : "Seal"}
        </button>
      );
    } else if (canUnseal) {
      primaryActionBtn = (
        <button className={`action-btn unlock ${actionBusy === "unseal" ? "is-busy" : ""}`} onClick={handleUnseal} disabled={actionBusy && actionBusy !== "unseal"} title="Release your seal and allow others to modify this file">
          {actionBusy === "unseal" ? <>Releasing<span className="btn-busy-bar" /></> : "Relinquish"}
        </button>
      );
    }
  }

  // Secondary actions (line 2)
  const secondaryActions = [];
  if (columns.actions) {
    if (isStale && att.allowPurge) {
      secondaryActions.push(
        <button
          key="purge"
          className={`action-btn purge ${actionBusy === "purge" ? "is-busy" : ""}`}
          onClick={handlePurge}
          disabled={actionBusy && actionBusy !== "purge"}
          title="Remove this stale seal record"
        >
          {actionBusy === "purge" ? <>Purging<span className="btn-busy-bar" /></> : "Purge"}
        </button>
      );
    } else if (isSealedByOther) {
      secondaryActions.push(
        <button
          key="watch"
          className={`action-btn watch ${att.notifyRequested ? "watching" : ""} ${actionBusy === "watch" ? "is-busy" : ""}`}
          onClick={handleDispatch}
          disabled={actionBusy && actionBusy !== "watch"}
          title={att.notifyRequested ? "Stop watching" : "Get notified when relinquished"}
        >
          {actionBusy === "watch" ? <>Updating<span className="btn-busy-bar" /></> : (att.notifyRequested ? "Watching" : "Watch")}
        </button>
      );
    }
    if (!isStale && att.allowDelete) {
      if (!isSealed) {
        // No seal — show normal delete button
        secondaryActions.push(
          <button
            key="delete"
            className={`action-btn delete ${actionBusy === "delete" ? "is-busy" : ""}`}
            onClick={handleDelete}
            disabled={actionBusy && actionBusy !== "delete"}
            title="Remove file (sent to trash)"
          >
            {actionBusy === "delete" ? <>Removing<span className="btn-busy-bar" /></> : "Remove"}
          </button>
        );
      } else if (isSealedByMe) {
        // Sealed by current user — show disabled delete with tooltip
        secondaryActions.push(
          <span
            key="delete"
            className="tooltip-wrapper has-tooltip"
            data-tooltip="Relinquish seal first to remove"
          >
            <button className="action-btn delete" disabled>
              Remove
            </button>
          </span>
        );
      }
      // Sealed by someone else — hide the Remove button entirely
    }
    if (!isStale && isSealedByMe && att.allowPurge) {
      secondaryActions.push(
        <button
          key="purge"
          className={`action-btn purge ${actionBusy === "purge" ? "is-busy" : ""}`}
          onClick={handlePurge}
          disabled={actionBusy && actionBusy !== "purge"}
          title="Remove this seal record permanently"
        >
          {actionBusy === "purge" ? <>Purging<span className="btn-busy-bar" /></> : "Purge"}
        </button>
      );
    }
  }

  const showLabels = columns.labels;
  const hasSecondLine = metaItems.length > 0 || showLabels || secondaryActions.length > 0;

  return (
    <div className={`artifact-card status-${statusClass}`}>
      {/* Line 1: filename + status + primary action */}
      <div className="card-row card-row-primary">
        <span className="card-filename">
          <ArtifactTypeIcon mediaType={att.mediaType} />
          <span className="card-filename-text">{att.title}</span>
        </span>
        <span className="card-row-right">
          {columns.status && (
            <span className={`status-lozenge ${statusClass}`}>{statusText}</span>
          )}
          {primaryActionBtn}
        </span>
      </div>

      {/* Line 2: meta + labels + secondary actions */}
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
              <LabelCluster labels={att.labels || []} artifactId={att.id} onRefresh={onRefresh} />
            )}
          </span>
          {secondaryActions.length > 0 && (
            <span className="card-secondary-right">
              {secondaryActions}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

// ── Default config ───────────────────────────────────

const INITIAL_COLUMNS = {
  name: true,
  status: true,
  lockOwner: true,
  labels: true,
  comment: true,
  actions: true,
  fileSize: false,
  fileType: false,
  expiresAt: false,
};

const INITIAL_CONFIG = {
  columns: INITIAL_COLUMNS,
  rowsPerPage: 15,
  showUploadZone: true,
  cardsPerRow: 2,
};

// ── Helper: format file size ─────────────────────────

const renderByteSize = (bytes) => {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// ── Helper: format expiry date ───────────────────────

const renderLapseDate = (dateStr) => {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return dateStr;
  }
};

// ── Skeleton card placeholder ────────────────────────

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

// ── Main panel component ─────────────────────────────

const ArtifactGridView = () => {
  const [artifacts, setArtifacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState(null);
  const [pageId, setPageId] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [panelConfig, setPanelConfig] = useState(INITIAL_CONFIG);

  // Fetch artifacts from backend — merges with any existing KVS-sourced claimed files
  const retrieveFileData = useCallback(async (pid, append = false, cursor = null, isEnrichPhase = false) => {
    try {
      if (!append && !isEnrichPhase) setLoading(true);
      const result = await invoke("enumerate-panel-artifacts", {
        pageId: pid,
        cursor,
        limit: panelConfig.rowsPerPage,
      });

      const incoming = result.attachments || [];

      // Merge: deduplicate, enrich existing items, add new ones
      setArtifacts((prev) => {
        if (prev.length === 0) return incoming;
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
      setHasMore(result.hasMore || false);
      setNextCursor(result.nextCursor || null);
    } catch (e) {
      console.error("[PANEL-UI] Error fetching artifacts:", e);
      setError("Unable to retrieve files.");
    } finally {
      setLoading(false);
      setEnriching(false);
      setLoadingMore(false);
    }
  }, [panelConfig.rowsPerPage]);

  // Refresh all data
  const onRefresh = useCallback(() => {
    if (pageId) retrieveFileData(pageId);
  }, [pageId, retrieveFileData]);

  // Load more
  const onLoadMore = useCallback(() => {
    if (!hasMore || loadingMore || !nextCursor || !pageId) return;
    setLoadingMore(true);
    retrieveFileData(pageId, true, nextCursor);
  }, [hasMore, loadingMore, nextCursor, pageId, retrieveFileData]);

  // Initialize
  useEffect(() => {
    const init = async () => {
      await enablePaletteSync();

      const ctx = await view.getContext();
      const pid = ctx.extension?.content?.id;
      const editing = ctx.extension?.isEditing === true;
      const savedConfig = ctx.extension?.config;

      if (savedConfig) {
        setPanelConfig({
          columns: { ...INITIAL_COLUMNS, ...(savedConfig.columns || {}) },
          rowsPerPage: savedConfig.rowsPerPage ?? INITIAL_CONFIG.rowsPerPage,
          showUploadZone: savedConfig.showUploadZone ?? INITIAL_CONFIG.showUploadZone,
          cardsPerRow: savedConfig.cardsPerRow ?? INITIAL_CONFIG.cardsPerRow,
        });
      }

      setPageId(pid);
      setIsEditing(editing);

      // Discover and store extension key from page ADF (one-time discovery)
      // Custom UI context does NOT expose extensionKey, so the backend
      // reads the page ADF to find the panel node's extensionKey attribute.
      if (!editing && pid) {
        try {
          await invoke("discover-panel-key", { pageId: pid });
        } catch (e) {
          console.warn("[PANEL-UI] Failed to discover extension key:", e);
        }
      }

      if (pid) {
        // Phase 1: Show claimed files instantly from KVS
        let hasPhase1 = false;
        try {
          const seals = await invoke("enumerate-page-seals", { pageId: pid });
          if (seals?.claimedArtifacts?.length > 0) {
            setArtifacts(seals.claimedArtifacts);
            setLoading(false);
            setEnriching(true);
            hasPhase1 = true;
          }
        } catch (e) {
          console.warn("[PANEL-UI] Fast seal fetch failed, falling back:", e);
        }
        // Phase 2: Full list from Confluence API (merges with Phase 1)
        retrieveFileData(pid, false, null, hasPhase1);
      } else {
        setLoading(false);
        setError("No page context available.");
      }
    };

    init();
  }, [retrieveFileData]);

  // Poll for seal changes made in other surfaces (overlay, ribbon, etc.)
  useEffect(() => {
    if (!pageId || isEditing) return;

    let lastStamp = null;

    const poll = async () => {
      try {
        const { stamp } = await invoke("check-seal-stamp");
        if (lastStamp !== null && stamp !== lastStamp) {
          retrieveFileData(pageId);
        }
        lastStamp = stamp;
      } catch (e) {
        // Polling failures are non-critical
      }
    };

    const interval = setInterval(poll, 5000);
    // Capture the initial stamp without triggering a refresh
    poll();

    return () => clearInterval(interval);
  }, [pageId, isEditing, retrieveFileData]);

  // Editor mode: show read-only message
  if (isEditing) {
    return (
      <div className="sv-panel-container">
        <div className="sv-panel-header">
          <span className="sv-panel-header-title">
            <SealGlyph /> Sentinel Vault
          </span>
        </div>
        <div className="sv-panel-editor-msg">
          Reservation controls are accessible in view mode.
        </div>
      </div>
    );
  }

  const cols = panelConfig.columns;
  const isClaimed = (a) => a.lockStatus === "HELD" || a.lockStatus === "HELD_BY_ACTOR";
  const prioritized = [...artifacts].sort((a, b) => (isClaimed(a) ? 0 : 1) - (isClaimed(b) ? 0 : 1));
  const staleFiles = prioritized.filter((a) => a.isStale);
  const claimedFiles = prioritized.filter((a) => isClaimed(a) && !a.isStale);
  const availableFiles = prioritized.filter((a) => !isClaimed(a) && !a.isStale);

  const gridProps = {
    className: "sv-card-list",
    "data-cols": panelConfig.cardsPerRow || 1,
    style: { '--sv-cards-per-row': panelConfig.cardsPerRow || 1 },
  };

  const renderCards = (files) =>
    files.map((att) => (
      <ArtifactCard key={att.id} att={att} columns={cols} onRefresh={onRefresh} />
    ));

  return (
    <div className="sv-panel-container">
      {/* Header */}
      <div className="sv-panel-header">
        <span className="sv-panel-header-title">
          <SealGlyph /> Sentinel Vault
        </span>
        <span className="sv-panel-header-counts">
          {claimedFiles.length > 0 && (
            <span className="sv-panel-header-badge">{claimedFiles.length} sealed</span>
          )}
          {staleFiles.length > 0 && (
            <span className="sv-panel-header-badge badge-stale">{staleFiles.length} missing</span>
          )}
          {availableFiles.length > 0 && (
            <span className="sv-panel-header-badge badge-available">{availableFiles.length} available</span>
          )}
        </span>
      </div>

      {/* Loading */}
      {loading && <div className="sv-panel-loading">Retrieving files...</div>}

      {/* Error */}
      {error && <div className="sv-panel-error">{error}</div>}

      {/* Empty state */}
      {!loading && !error && artifacts.length === 0 && (
        <div className="sv-panel-empty">No files attached to this page.</div>
      )}

      {/* Grouped sections */}
      {!loading && !error && artifacts.length > 0 && (
        <>
          {claimedFiles.length > 0 && (
            <div className="sv-card-section">
              <div className="sv-card-section-header">
                <span className="sv-card-section-title">Sealed</span>
                <span className="sv-card-section-count">{claimedFiles.length}</span>
              </div>
              <div {...gridProps}>{renderCards(claimedFiles)}</div>
            </div>
          )}
          {staleFiles.length > 0 && (
            <div className="sv-card-section">
              <div className="sv-card-section-header">
                <span className="sv-card-section-title">Missing</span>
                <span className="sv-card-section-count badge-stale">{staleFiles.length}</span>
              </div>
              <div {...gridProps}>{renderCards(staleFiles)}</div>
            </div>
          )}
          {availableFiles.length > 0 && (
            <div className="sv-card-section">
              <div className="sv-card-section-header">
                <span className="sv-card-section-title">Available</span>
                <span className="sv-card-section-count">{availableFiles.length}</span>
              </div>
              <div {...gridProps}>{renderCards(availableFiles)}</div>
            </div>
          )}
          {enriching && (
            <div className="sv-card-section">
              <div className="sv-card-section-header">
                <span className="sv-card-section-title">Loading more files…</span>
              </div>
              <div {...gridProps}>
                {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={`skel-${i}`} />)}
              </div>
            </div>
          )}
        </>
      )}

      {/* Load more */}
      {hasMore && (
        <div className="sv-panel-footer">
          <button
            className={`load-more-btn ${loadingMore ? "is-busy" : ""}`}
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? <>Fetching<span className="btn-busy-bar" /></> : "Show more files"}
          </button>
        </div>
      )}

      {/* Upload zone */}
      {!loading && panelConfig.showUploadZone && <UploadZone onUploadComplete={onRefresh} />}
    </div>
  );
};

// ── Render ────────────────────────────────────────────

function renderApp() {
  const root = createRoot(document.getElementById("root"));
  root.render(<ArtifactGridView />);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", renderApp);
} else {
  renderApp();
}
