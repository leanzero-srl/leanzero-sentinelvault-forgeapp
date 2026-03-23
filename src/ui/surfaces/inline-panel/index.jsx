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
        title="Remove tag"
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
          title="Add tag"
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

// ── Artifact row component ─────────────────────────

const ArtifactRow = ({ att, onRefresh, columns }) => {
  const [actionBusy, setActionBusy] = useState(false);

  const isSealed = att.lockStatus === "HELD" || att.lockStatus === "HELD_BY_ACTOR";
  const isSealedByMe = att.lockStatus === "HELD_BY_ACTOR";
  const isSealedByOther = att.lockStatus === "HELD";
  const canUnseal = isSealedByMe; // steward override handled elsewhere

  const handleSeal = async () => {
    setActionBusy(true);
    try {
      await invoke("seal-artifact", { attachmentId: att.id });
      onRefresh();
    } catch (e) {
      console.error("Seal failed:", e);
    } finally {
      setActionBusy(false);
    }
  };

  const handleUnseal = async () => {
    setActionBusy(true);
    try {
      await invoke("unseal-artifact", { attachmentId: att.id });
      onRefresh();
    } catch (e) {
      console.error("Unseal failed:", e);
    } finally {
      setActionBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Remove "${att.title}"? It will be sent to the trash.`)) return;
    setActionBusy(true);
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
      setActionBusy(false);
    }
  };

  const handleDispatch = async () => {
    setActionBusy(true);
    try {
      if (att.notifyRequested) {
        const result = await invoke("unwatch-artifact", { attachmentId: att.id });
        if (result.success) {
          onRefresh();
        }
      } else {
        const result = await invoke("watch-artifact", { attachmentId: att.id });
        if (result.success) {
          onRefresh();
        }
      }
    } catch (e) {
      console.error("Dispatch toggle failed:", e);
    } finally {
      setActionBusy(false);
    }
  };

  // Status lozenge class
  let statusClass = "unlocked";
  let statusText = "Available";
  if (att.isExpired && isSealed) {
    statusClass = "expired";
    statusText = "Overdue";
  } else if (isSealedByMe) {
    statusClass = "locked-by-me";
    statusText = "My Reservation";
  } else if (isSealed) {
    statusClass = "locked";
    statusText = "Claimed";
  }

  const dash = <span style={{ color: "var(--sv-text-subtle)" }}>—</span>;

  return (
    <tr>
      {/* Name */}
      {columns.name && (
        <td className="col-name">
          <span className="artifact-name">
            <ArtifactTypeIcon mediaType={att.mediaType} />
            {att.title}
          </span>
        </td>
      )}

      {/* Status */}
      {columns.status && (
        <td className="col-status">
          <span className={`status-lozenge ${statusClass}`}>{statusText}</span>
        </td>
      )}

      {/* Seal Owner */}
      {columns.lockOwner && (
        <td className="col-owner">
          {att.lockedByAccountId ? (
            <OperatorChip accountId={att.lockedByAccountId} />
          ) : dash}
        </td>
      )}

      {/* Labels */}
      {columns.labels && (
        <td className="col-labels">
          <LabelCluster labels={att.labels || []} artifactId={att.id} onRefresh={onRefresh} />
        </td>
      )}

      {/* Comment */}
      {columns.comment && (
        <td className="col-comment">
          {att.comment ? (
            <span className="comment-text" title={att.comment}>{att.comment}</span>
          ) : dash}
        </td>
      )}

      {/* File Size */}
      {columns.fileSize && (
        <td className="col-file-size">
          <span className="file-size-text">{renderByteSize(att.fileSize)}</span>
        </td>
      )}

      {/* File Type */}
      {columns.fileType && (
        <td className="col-file-type">
          <span className="file-type-text" title={att.mediaType || ""}>
            {att.mediaType ? att.mediaType.split("/").pop() : "—"}
          </span>
        </td>
      )}

      {/* Expires At */}
      {columns.expiresAt && (
        <td className="col-expires">
          <span className="expires-text">{renderLapseDate(att.expiresAt)}</span>
        </td>
      )}

      {/* Actions */}
      {columns.actions && (
        <td className="col-actions">
          <div className="actions-cell">
            {/* Seal / Unseal */}
            {!isSealed ? (
              <button className="action-btn lock" onClick={handleSeal} disabled={actionBusy}>
                Claim
              </button>
            ) : canUnseal ? (
              <button className="action-btn unlock" onClick={handleUnseal} disabled={actionBusy}>
                Relinquish
              </button>
            ) : null}

            {/* Watch — only for artifacts sealed by someone else */}
            {isSealedByOther && (
              <button
                onClick={handleDispatch}
                disabled={actionBusy}
                style={{
                  backgroundColor: att.notifyRequested
                    ? "var(--sv-interactive-success)"
                    : "var(--sv-bg-tertiary)",
                  color: att.notifyRequested
                    ? "var(--sv-text-inverse)"
                    : "var(--sv-text-primary)",
                  border: att.notifyRequested
                    ? "1px solid var(--sv-interactive-success)"
                    : "1px solid var(--sv-border-secondary)",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  fontSize: "11px",
                  cursor: "pointer",
                  fontWeight: 500,
                  transition: "all 0.2s ease",
                }}
                title={
                  att.notifyRequested
                    ? "Stop watching"
                    : "Alerted when relinquished"
                }
              >
                {att.notifyRequested ? "Watching" : "Watch"}
              </button>
            )}

            {/* Delete — conditional on steward setting, disabled when sealed */}
            {att.allowDelete && (
              <span
                className={`tooltip-wrapper ${isSealed ? "has-tooltip" : ""}`}
                data-tooltip={isSealed ? "Relinquish reservation first to remove" : ""}
              >
                <button
                  className="action-btn delete"
                  onClick={handleDelete}
                  disabled={actionBusy || isSealed}
                  title={!isSealed ? "Remove file (sent to trash)" : undefined}
                >
                  Remove
                </button>
              </span>
            )}
          </div>
        </td>
      )}
    </tr>
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

// ── Main panel component ─────────────────────────────

const ArtifactGridView = () => {
  const [artifacts, setArtifacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pageId, setPageId] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [panelConfig, setPanelConfig] = useState(INITIAL_CONFIG);

  // Fetch artifacts from backend
  const retrieveFileData = useCallback(async (pid, append = false, cursor = null) => {
    try {
      if (!append) setLoading(true);
      const result = await invoke("enumerate-panel-artifacts", {
        pageId: pid,
        cursor,
        limit: panelConfig.rowsPerPage,
      });

      if (append) {
        setArtifacts((prev) => [...prev, ...(result.attachments || [])]);
      } else {
        setArtifacts(result.attachments || []);
      }
      setHasMore(result.hasMore || false);
      setNextCursor(result.nextCursor || null);
    } catch (e) {
      console.error("[PANEL-UI] Error fetching artifacts:", e);
      setError("Unable to retrieve files.");
    } finally {
      setLoading(false);
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
        retrieveFileData(pid);
      } else {
        setLoading(false);
        setError("No page context available.");
      }
    };

    init();
  }, [retrieveFileData]);

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
  const sealedCount = artifacts.filter(
    (a) => a.lockStatus === "HELD" || a.lockStatus === "HELD_BY_ACTOR",
  ).length;

  return (
    <div className="sv-panel-container">
      {/* Header */}
      <div className="sv-panel-header">
        <span className="sv-panel-header-title">
          <SealGlyph /> Sentinel Vault
        </span>
        {sealedCount > 0 && (
          <span className="sv-panel-header-badge">
            {sealedCount} claimed
          </span>
        )}
      </div>

      {/* Loading */}
      {loading && <div className="sv-panel-loading">Retrieving files...</div>}

      {/* Error */}
      {error && <div className="sv-panel-error">{error}</div>}

      {/* Empty state */}
      {!loading && !error && artifacts.length === 0 && (
        <div className="sv-panel-empty">No files attached to this page.</div>
      )}

      {/* Table */}
      {!loading && !error && artifacts.length > 0 && (
        <div className="sv-panel-table-wrap">
          <table className="sv-panel-table">
            <thead>
              <tr>
                {cols.name && <th className="col-name">Name</th>}
                {cols.status && <th className="col-status">Status</th>}
                {cols.lockOwner && <th className="col-owner">Claimed by</th>}
                {cols.labels && <th className="col-labels">Labels</th>}
                {cols.comment && <th className="col-comment">Comment</th>}
                {cols.fileSize && <th className="col-file-size">Size</th>}
                {cols.fileType && <th className="col-file-type">Type</th>}
                {cols.expiresAt && <th className="col-expires">Overdue</th>}
                {cols.actions && <th className="col-actions">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {artifacts.map((att) => (
                <ArtifactRow
                  key={att.id}
                  att={att}
                  columns={cols}
                  onRefresh={onRefresh}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Load more */}
      {hasMore && (
        <div className="sv-panel-footer">
          <button
            className="load-more-btn"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Fetching..." : "Show more files"}
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
