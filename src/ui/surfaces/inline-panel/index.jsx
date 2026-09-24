import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { invoke, view, router } from "@forge/bridge";
// SEC-2 (e): the proposal bar opens with this reason already typed — the approvers see what it is at a glance.
const PROPOSE_PREFILL = "Proposed change to an approved page";
import { enablePaletteSync } from "../../kit/palette-sync";
import ThumbnailPreview from "../../kit/ThumbnailPreview";
import ActivityFeed from "../../kit/ActivityFeed";
import ActionMenu from "../../kit/ActionMenu";
import { ConfirmDialog } from "../../kit/Dialog";
import GiveAccessDialog from "../../kit/GiveAccessDialog";
import { useSignedInvoke } from "../../kit/SignedInvoke";
import RovingList from "../../kit/RovingList";
import useEditStatuses from "../../kit/useEditStatuses";
import { SEALED_GROUPS, groupSealedFiles, groupSealedSections } from "../../kit/sealed-groups.js";
import { describeRange } from "../../kit/section-range.js";
import { expiryWarning } from "../../../server/capsules/page-details/row-state.js"; // SEC-7: the owner's lapse warning
import { attachmentRow, sectionRow, rowActions, statusChip, copyText } from "../../kit/seal-row.js";
import { when, sealSentence, refusalText } from "../../kit/status-language.js"; // SEC-3: one vocabulary, one clock
import { PrimarySlot, ReasonBar, RequestInbox, GrantInbox, ErrorRow, CopiedNote } from "../../kit/SealRowParts";

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
  // it57: off-palette green/orange → neutral tokens (the icon shape differentiates the file type).
  const color = isImage || isPdf ? "var(--sv-text-secondary)" : "var(--sv-text-subtle)";
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
        aria-label={`Remove label ${label.name}`}
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
          aria-label="Add a label"
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

const ArtifactCard = ({ att, onRefresh, columns, siteUrl, spaceKey, pageId, pageLocation, viewer, editInfo }) => {
  const [actionBusy, setActionBusy] = useState(null);
  const [pendingConfirm, setPendingConfirm] = useState(null); // "delete" | "purge" | null → kit ConfirmDialog
  const [actionError, setActionError] = useState(null); // inline error row (no native alert)
  const [expanded, setExpanded] = useState(false);
  const [cachedPreview, setCachedPreview] = useState(null);
  // Seeded by the list (useEditStatuses) when it already asked — the card then skips its own call.
  const [editStatus, setEditStatus] = useState(editInfo?.status || att.editStatus || null); // none|pending|granted|denied
  const [editExpiresAt, setEditExpiresAt] = useState(editInfo?.expiresAt || null);
  const [editRetryAt, setEditRetryAt] = useState(editInfo?.retryAt || null); // declined: when the server lets them ask again
  const [bar, setBar] = useState(null); // "request" | "force" | null — the typed-reason bar
  const [reasonText, setReasonText] = useState("");
  const [myRequests, setMyRequests] = useState(null); // owner: pending edit requests on this file
  const [reqBusy, setReqBusy] = useState(null);
  const [myGrants, setMyGrants] = useState(null); // audit D5: owner — active granted editors
  const [grantBusy, setGrantBusy] = useState(null);
  const [giving, setGiving] = useState(false); // "Give edit access…" dialog
  const [copied, setCopied] = useState(false);
  const { signedInvoke, signatureDialog } = useSignedInvoke(); // the code prompt when the site signs seal actions

  const isSealedByMe = att.lockStatus === "HELD_BY_ACTOR";
  const isSealedByOther = att.lockStatus === "HELD";
  const isRecoverable = att.staleReason === "trashed";

  // Lazily resolve this user's edit-access status for files sealed by others.
  useEffect(() => {
    let cancelled = false;
    if (isSealedByOther && editStatus === null) {
      invoke("check-edit-request", { attachmentId: att.id })
        .then((r) => { if (!cancelled) { setEditStatus(r?.status || "none"); setEditExpiresAt(r?.expiresAt || null); setEditRetryAt(r?.retryAt || null); } })
        .catch(() => { if (!cancelled) setEditStatus("none"); });
    }
    return () => { cancelled = true; };
  }, [isSealedByOther, att.id, editStatus]);

  // Owner: pending edit requests (Approve/Decline is the row's primary while one waits) and the
  // ACTIVE granted editors so the owner can REVOKE access (audit D5).
  useEffect(() => {
    let cancelled = false;
    if (isSealedByMe || (isSealedByOther && viewer?.isSpaceAdmin === true)) {
      invoke("list-edit-requests", { attachmentId: att.id })
        .then((r) => { if (!cancelled) setMyRequests(r?.requests || []); })
        .catch(() => { if (!cancelled) setMyRequests([]); });
      invoke("list-edit-grants", { attachmentId: att.id })
        .then((r) => { if (!cancelled) setMyGrants(r?.grants || []); })
        .catch(() => { if (!cancelled) setMyGrants([]); });
    }
    return () => { cancelled = true; };
  }, [isSealedByMe, isSealedByOther, viewer?.isSpaceAdmin, att.id]);

  // ONE call path for every resolver action: a refusal (`success:false`) shows the resolver's
  // reason in the card's error row and never reads as success (review: ~20 silent click failures).
  const run = async (busyKey, action, payload, { refresh = true, onOk } = {}) => {
    setActionBusy(busyKey);
    setActionError(null);
    try {
      const r = await signedInvoke(action, payload);
      if (!r || r.success === false || r.ok === false) {
        setActionError(refusalText(r) || "That did not work. Try again.");
        return false;
      }
      if (onOk) onOk(r);
      if (refresh) onRefresh();
      return true;
    } catch (e) {
      console.error(`[PANEL] ${action} failed:`, e);
      setActionError("Could not reach Sentinel Vault. Try again.");
      return false;
    } finally {
      setActionBusy(null);
    }
  };

  const revokeGrant = async (editorAccountId) => {
    setGrantBusy(editorAccountId);
    setActionError(null);
    try {
      const r = await signedInvoke("revoke-edit-grant", { attachmentId: att.id, editorAccountId });
      if (r?.success) setMyGrants((p) => (p || []).filter((g) => g.editorAccountId !== editorAccountId));
      else setActionError(r?.reason || "Could not revoke this editor's access");
    } catch (e) {
      console.error("Revoke edit grant failed:", e);
      setActionError("Could not reach Sentinel Vault. Try again.");
    } finally {
      setGrantBusy(null);
    }
  };

  const resolveEditReq = async (requesterAccountId, action) => {
    setReqBusy(`${requesterAccountId}:${action}`);
    setActionError(null);
    try {
      const r = await signedInvoke(action === "approve" ? "approve-edit-request" : "deny-edit-request", { attachmentId: att.id, requesterAccountId });
      if (r?.success) {
        setMyRequests((p) => (p || []).filter((x) => x.requesterAccountId !== requesterAccountId));
        if (action === "approve") invoke("list-edit-grants", { attachmentId: att.id }).then((g) => setMyGrants(g?.grants || [])).catch(() => {});
      } else {
        // F1: a refusal must say so — an overdue seal refused approve, every time, silently.
        setActionError(r?.reason || (action === "approve" ? "Could not grant edit access" : "Could not decline the request"));
      }
    } catch (e) {
      console.error("Resolve edit request failed:", e);
      setActionError("Could not reach Sentinel Vault. Try again.");
    } finally {
      setReqBusy(null);
    }
  };

  const isImage = att.mediaType?.startsWith("image/");
  const downloadHref = siteUrl && pageId && att.title
    ? `${siteUrl}/wiki/download/attachments/${pageId}/${encodeURIComponent(att.title)}?api=v2`
    : null;
  const numericAttId = att.id ? att.id.replace(/^att/, "") : null;
  const viewUrl = pageLocation && pageId && numericAttId && att.title
    ? `${pageLocation}?preview=/${pageId}/${numericAttId}/${encodeURIComponent(att.title)}`
    : null;
  const propertiesUrl = siteUrl && pageId && att.title
    ? `${siteUrl}/wiki/pages/editattachment.action?pageId=${pageId}&fileName=${encodeURIComponent(att.title)}&isFromPageView=true`
    : null;

  const copyLink = async () => {
    const href = downloadHref || (siteUrl && pageId ? `${siteUrl}/wiki/pages/viewpage.action?pageId=${pageId}` : "");
    if (!href) { setActionError("No link is available for this file yet."); return; }
    setCopied(await copyText(href));
    setTimeout(() => setCopied(false), 1800);
  };

  // ── the ONE row rule (mockup decision 5) ───────────────────────────────────────────────────
  const row = attachmentRow(att, { editStatus, editExpiresAt, editRetryAt, pendingRequests: myRequests || [], watching: att.notifyRequested });
  const { primary, menu } = rowActions(row, viewer, { allowRestore: att.allowRestore, allowPurge: att.allowPurge, allowDelete: att.allowDelete, viewUrl, propertiesUrl });
  const chip = statusChip(att);

  const onMenu = (id) => {
    switch (id) {
      case "extend": run("extend", "extend-seal", { attachmentId: att.id }); break;
      case "release": run("unseal", "unseal-artifact", { attachmentId: att.id }); break;
      case "watch": run("watch", "watch-artifact", { attachmentId: att.id }); break;
      case "unwatch": run("watch", "unwatch-artifact", { attachmentId: att.id }); break;
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

  const primaryHandlers = {
    seal: () => run("seal", "seal-artifact", { attachmentId: att.id }),
    release: () => run("unseal", "unseal-artifact", { attachmentId: att.id }),
    decide: resolveEditReq,
    request: () => { setReasonText(""); setBar("request"); },
    propose: () => { setReasonText(PROPOSE_PREFILL); setBar("propose"); }, // SEC-2 (e)
    restore: () => run("restore", "restore-sealed-artifact", { attachmentId: att.id }),
    purge: () => setPendingConfirm("purge"),
  };

  const submitBar = () => {
    if (bar === "force") run("unseal", "unseal-artifact", { attachmentId: att.id, adminOverride: true, reason: reasonText.trim() }, { onOk: () => { setBar(null); setReasonText(""); } });
    else run("editreq", "request-edit-access", { attachmentId: att.id, reason: reasonText.trim() }, { refresh: false, onOk: () => { setEditStatus("pending"); setBar(null); setReasonText(""); } });
  };

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
  if (att.notifyRequested && isSealedByOther) {
    metaItems.push(<span key="watching" className="card-meta-item card-meta-watching" role="status">Watching for release</span>);
  }

  const showLabels = columns.labels;
  const hasSecondLine = metaItems.length > 0 || showLabels;

  return (
    <div className={`artifact-card status-${chip.cls}`} role="listitem" data-roving-card tabIndex={-1} aria-label={chip.aria} data-testid="sv-card" data-primary={primary.kind}>
      {/* Line 1: filename + status + ONE primary action + ⋯ */}
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
          {/* F3: a filename like image-20230720-212157.png says nothing about which image it is.
              Images get their actual thumbnail here instead of the generic document glyph, and
              clicking it opens the file. Non-images keep the glyph. */}
          {isImage && pageId ? (
            <ThumbnailPreview
              artifactId={att.id}
              contentId={pageId}
              variant="thumb"
              alt={att.title}
              cachedDataUri={cachedPreview}
              onCached={setCachedPreview}
              onClick={viewUrl ? () => router.open(viewUrl) : undefined}
            />
          ) : (
            <ArtifactTypeIcon mediaType={att.mediaType} />
          )}
          {downloadHref ? (
            <a className="card-filename-text card-filename-link" href={downloadHref} onClick={(e) => { e.preventDefault(); router.open(downloadHref); }} title={`Download ${att.title}`}>
              {att.title}
            </a>
          ) : (
            <span className="card-filename-text">{att.title}</span>
          )}
        </span>
        <span className="card-row-right">
          {columns.status && (
            <span className={`status-lozenge ${chip.cls}`} role="status" aria-label={chip.aria} title={chip.aria}>{chip.text}</span>
          )}
          {columns.actions && <PrimarySlot primary={primary} name={att.title} busy={actionBusy} reqBusy={reqBusy} on={primaryHandlers} />}
          {columns.actions && <ActionMenu items={menu} onPick={onMenu} label={`More actions for ${att.title}`} testId="sv-kebab" />}
        </span>
      </div>

      {/* Line 2: meta + labels */}
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
        </div>
      )}

      <CopiedNote shown={copied} />
      <ErrorRow message={actionError} onDismiss={() => setActionError(null)} />

      {/* Destructive confirmations: a real dialog (focus trap, Escape, focus back to the opener). */}
      {pendingConfirm === "delete" && (
        <ConfirmDialog
          title={`Delete ${att.title}?`}
          message="It goes to the trash. The seal stays on the record until the file is restored or the record is removed."
          confirmLabel="Delete"
          busy={actionBusy === "delete"}
          onCancel={() => setPendingConfirm(null)}
          onConfirm={() => { setPendingConfirm(null); run("delete", "delete-artifact", { attachmentId: att.id }); }}
        />
      )}
      {pendingConfirm === "purge" && (
        <ConfirmDialog
          title={isRecoverable ? `Delete ${att.title} permanently?` : `Remove the seal record for ${att.title}?`}
          message={isRecoverable ? "The file is purged from the trash and its seal record removed. This cannot be undone." : "The file is already gone; this removes the seal record that still points at it. This cannot be undone."}
          confirmLabel={isRecoverable ? "Delete permanently" : "Remove record"}
          busy={actionBusy === "purge"}
          onCancel={() => setPendingConfirm(null)}
          onConfirm={() => { setPendingConfirm(null); run("purge", "purge-seal-record", { attachmentId: att.id }); }}
        />
      )}

      {bar && <ReasonBar mode={bar} value={reasonText} onChange={setReasonText} onSubmit={submitBar} onCancel={() => { setBar(null); setReasonText(""); }} busy={actionBusy === "unseal" || actionBusy === "editreq"} />}

      {isSealedByMe && <RequestInbox requests={myRequests} name={att.title} reqBusy={reqBusy} onDecide={resolveEditReq} firstDecidedAbove={primary.kind === "decide"} />}
      {signatureDialog}
      {giving && (
        <GiveAccessDialog
          invoker={signedInvoke}
          target={{ attachmentId: att.id }}
          name={att.title}
          onClose={() => setGiving(false)}
          onGranted={() => invoke("list-edit-grants", { attachmentId: att.id }).then((g) => setMyGrants(g?.grants || [])).catch(() => {})}
        />
      )}
      {/* A space admin who gave access sees (and can revoke) the grants too — list-edit-grants admits them. */}
      {(isSealedByMe || (myGrants || []).length > 0) && <GrantInbox grants={myGrants} name={att.title} grantBusy={grantBusy} onRevoke={revokeGrant} />}

      {/* Expand panel: thumbnail + view link */}
      {expanded && (
        <div className="card-row card-row-expand">
          {isImage && <ThumbnailPreview artifactId={att.id} contentId={pageId} alt={att.title} cachedDataUri={cachedPreview} onCached={setCachedPreview} />}
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

// SEC-3: the ONE clock (status-language `when`) — "Tue 23:13" / "22 Sep 22:57".
const renderLapseDate = (dateStr) => (dateStr ? when(dateStr) || "—" : "—");

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

// ── AI Review group (Semantic AI Validations) ────────

const AiReviewGroup = ({ pageId }) => {
  const [latest, setLatest] = useState(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!pageId) return;
    invoke("get-ai-findings", { pageId })
      .then((r) => { if (!cancelled) { setLatest(r?.findings || null); setAiEnabled(!!r?.aiEnabled); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [pageId]);

  const setFindingState = async (fid, state) => {
    setLatest((prev) => prev ? { ...prev, findings: (prev.findings || []).map((f) => f.id === fid ? { ...f, state } : f) } : prev);
    try { await invoke("set-ai-finding-state", { pageId, findingId: fid, state }); }
    catch (e) { console.error("Set finding state failed:", e); }
  };

  const poll = async (taskId, tries = 0) => {
    if (tries > 40) { setNote("AI review timed out."); setBusy(false); return; }
    try {
      const r = await invoke("get-validation-job", { taskId });
      if (r?.status === "done") {
        setLatest(r.result || null);
        if (r.result?.parseError) setNote("The AI response was unreadable; no findings recorded.");
        setBusy(false);
        return;
      }
      if (r?.status === "error") { setNote(r.error || "AI review failed."); setBusy(false); return; }
      setTimeout(() => poll(taskId, tries + 1), 1500);
    } catch (e) {
      setNote("AI review failed.");
      setBusy(false);
    }
  };

  const run = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await invoke("enqueue-page-validation", { pageId });
      if (r?.success) {
        poll(r.taskId);
      } else {
        setNote(r?.reason || "Could not start AI review.");
        setBusy(false);
      }
    } catch (e) {
      setNote("Could not start AI review.");
      setBusy(false);
    }
  };

  if (!pageId || !loaded) return null;
  // Keep the panel clean: only show when AI is enabled or a prior review exists.
  if (!aiEnabled && !latest) return null;

  const allFindings = latest?.findings || [];
  const open = allFindings.filter((f) => f.state !== "dismissed" && f.state !== "false-positive");
  const hidden = allFindings.filter((f) => f.state === "dismissed" || f.state === "false-positive");
  const visible = showHidden ? allFindings : open;

  return (
    <div className="sv-card-section sv-ai-review">
      <div className="sv-card-section-header">
        <button className="sv-group-toggle" onClick={() => setCollapsed(!collapsed)} title={collapsed ? "Expand" : "Collapse"}>
          <span className={`sv-group-caret ${collapsed ? "collapsed" : ""}`}>▾</span>
        </button>
        <span className="sv-card-section-title">AI Review</span>
        {latest && <span className="sv-card-section-count">{open.length}</span>}
        <button className="action-btn editreq" style={{ marginLeft: "auto" }} onClick={run} disabled={busy}>
          {busy ? <>Reviewing<span className="btn-busy-bar" /></> : (latest ? "Re-run AI review" : "Run AI review")}
        </button>
      </div>
      {!collapsed && (
        <>
          {note && <div className="sv-panel-empty">{note}</div>}
          {latest && open.length === 0 && !showHidden && !note && (
            <div className="sv-val-ok">{latest.summary || "No open findings."}</div>
          )}
          {visible.length > 0 && (
            <ul className="sv-val-list">
              {visible.map((f) => (
                <li key={f.id} className={`sv-val-item sv-ai-${f.severity} ${f.state === "dismissed" || f.state === "false-positive" ? "sv-ai-muted" : ""}`}>
                  <div>
                    <strong>{(f.severity || "low").toUpperCase()}</strong>{f.ruleRef ? ` · ${f.ruleRef}` : ""}: {f.explanation}
                    {f.state === "false-positive" && <span className="sv-ai-tag">false positive</span>}
                    {f.state === "dismissed" && <span className="sv-ai-tag">dismissed</span>}
                  </div>
                  {f.suggestion && <div className="sv-ai-suggest">→ {f.suggestion}</div>}
                  <div className="sv-ai-actions">
                    {f.state === "open" || !f.state ? (
                      <>
                        <button className="sv-ai-act" onClick={() => setFindingState(f.id, "dismissed")}>Dismiss</button>
                        <button className="sv-ai-act" onClick={() => setFindingState(f.id, "false-positive")}>False positive</button>
                      </>
                    ) : (
                      <button className="sv-ai-act" onClick={() => setFindingState(f.id, "open")}>Restore</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {hidden.length > 0 && (
            <button className="sv-ai-showhidden" onClick={() => setShowHidden(!showHidden)}>
              {showHidden ? "Hide dismissed" : `Show ${hidden.length} dismissed`}
            </button>
          )}
        </>
      )}
    </div>
  );
};

// ── Validation status group (Conditions & Validations) ──

const VAL_BADGE = { passed: "Passed", failed: "Issues found" };

// 2026-09-23 (tester): the group used to (a) say "All checks passed." when the check could not
// run at all, (b) keep a stale badge after Re-check — "Passed" above a listed violation — and
// (c) never show the admin's "Approve anyway", whose resolver existed with no caller. Re-check
// now STORES its verdict when pass/fail status is on and the viewer can edit the page, so the
// badge, the ribbon chip and the workflow gate follow what was just shown.
const ValidationStatus = ({ pageId, viewer }) => {
  const [state, setState] = useState(null);
  const [result, setResult] = useState(null); // the last Re-check answer
  const [error, setError] = useState(null);   // a check that could not run — never "passed"
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [approving, setApproving] = useState(false);
  const [stale, setStale] = useState(false); // stored status was judged on rules that changed

  useEffect(() => {
    let cancelled = false;
    if (!pageId) return;
    invoke("get-validation-state", { pageId })
      .then((r) => {
        if (cancelled) return;
        setState(r?.state || null);
        setStale(!!r?.stale);
        setLoaded(true);
        // The rules changed since this status was written (a rule edited or deleted): judge the
        // page again now rather than show a verdict against rules that no longer apply.
        if (r?.stale) runNow();
      })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [pageId]); // eslint-disable-line react-hooks/exhaustive-deps

  const runNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await invoke("recheck-page-validation", { pageId });
      if (r?.failureReason || r?.ok === false) {
        setResult(null);
        setError(r?.failureReason || "Could not check this page. Try again in a moment.");
      } else {
        setResult(r || null);
        if (r?.persisted && r.state) { setState(r.state); setStale(false); }
        else if (r?.noRules) setState(null); // no rule applies any more — the group goes away
      }
    } catch (e) {
      console.error("Re-check failed:", e);
      setResult(null);
      setError("Could not check this page. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    setApproving(true);
    setError(null);
    try {
      const r = await invoke("approve-page-gate", { pageId });
      if (r?.success) { setState(r.state || { state: "passed", violations: [] }); setResult(null); setStale(false); }
      else setError(r?.reason || "Could not approve this page.");
    } catch (e) {
      console.error("Approve anyway failed:", e);
      setError("Could not approve this page.");
    } finally {
      setApproving(false);
      setConfirming(false);
    }
  };

  // Only surface when a pass/fail status exists (keeps pages without validation clean).
  if (!pageId || !loaded || !state || !VAL_BADGE[state.state]) return null;

  const violations = result ? (result.violations || []) : (stale ? [] : (state.violations || []));
  // A stale status is never shown as a verdict: "Checking…" until the re-check answers, then the
  // live result (a reader's re-check is not stored, so the stored one stays stale for them).
  const shownState = stale ? (result ? (result.passed ? "passed" : "failed") : null) : state.state;
  const shownPasses = !error && violations.length === 0 && !result?.noRules;
  const canApprove = viewer?.isSpaceAdmin === true && shownState === "failed";
  const liveDiffers = result && !result.persisted && !result.noRules
    && (stale || (result.passed ? state.state !== "passed" : state.state !== "failed"));

  return (
    <div className="sv-card-section sv-validation" data-testid="sv-validation">
      <div className="sv-card-section-header">
        <button className="sv-group-toggle" onClick={() => setCollapsed(!collapsed)} title={collapsed ? "Expand" : "Collapse"}>
          <span className={`sv-group-caret ${collapsed ? "collapsed" : ""}`}>▾</span>
        </button>
        <span className="sv-card-section-title">Validation</span>
        {shownState
          ? <span className={`sv-val-badge sv-val-${shownState}`} role="status" data-testid="sv-validation-badge">{VAL_BADGE[shownState]}</span>
          : <span className="sv-val-badge sv-val-checking" role="status" data-testid="sv-validation-badge">{error ? "Not checked" : "Checking…"}</span>}
        <span className="sv-val-actions">
          {canApprove && (
            <button className="action-btn watch" onClick={() => setConfirming(true)} disabled={busy || approving} data-testid="sv-validation-approve">
              Approve anyway
            </button>
          )}
          <button className="action-btn watch" onClick={runNow} disabled={busy || approving} data-testid="sv-validation-recheck">
            {busy ? <>Checking<span className="btn-busy-bar" /></> : "Re-check"}
          </button>
        </span>
      </div>
      {!collapsed && (
        <>
          {error && <div className="card-action-error sv-val-error" role="alert" data-testid="sv-validation-error">{error}</div>}
          {!error && result && result.noRules && <div className="sv-panel-empty">No validation rules apply to this page.</div>}
          {shownPasses && (result || (!stale && state.state === "passed")) && (
            <div className="sv-val-ok">{state.approvedBy && !result ? "Approved by a space admin." : "All checks passed."}</div>
          )}
          {!error && violations.length > 0 && (
            <ul className="sv-val-list" data-testid="sv-validation-list">
              {violations.map((v, i) => (
                <li key={i} className={`sv-val-item sv-val-item-${v.severity}`}>
                  <strong>{v.label}</strong>: {v.message}
                </li>
              ))}
            </ul>
          )}
          {!error && liveDiffers && result.note && <div className="sv-val-note" data-testid="sv-validation-note">{result.note}</div>}
        </>
      )}
      {confirming && (
        <ConfirmDialog
          title="Approve this page anyway?"
          message={`The page breaks ${violations.length || "some"} validation rule${violations.length === 1 ? "" : "s"}. Approving marks this version as passed; the next published edit is checked again.`}
          confirmLabel="Approve anyway"
          danger={false}
          busy={approving}
          onConfirm={approve}
          onCancel={() => setConfirming(false)}
          testId="sv-validation-approve-confirm"
        />
      )}
    </div>
  );
};

// ── Sealed Sections group (Content Sealing) ──────────

// One sealed section — the SAME row rule as the attachment cards (row-state.js): Release for the
// owner (or anyone who can edit the page once the seal has expired, server rule F6), Request edit
// / Waiting for {owner} / Edit now until {time} for everyone else, Approve/Decline for the owner
// while someone waits. Copy link and Force release (space admin, typed reason) sit under ⋯.
const SectionRow = ({ section: s, onUnseal, unsealing, viewer, siteUrl, pageId, onChanged, editInfo }) => {
  // Seeded by the list (it reads every status once to group the sections); the row then skips its call.
  const [editStatus, setEditStatus] = useState(editInfo?.status || null); // others' sections
  const [bar, setBar] = useState(null); // "request" | "force" | null — the typed-reason bar
  const [reasonText, setReasonText] = useState("");
  const [busy, setBusy] = useState(false);
  const [requests, setRequests] = useState(null); // owner inbox
  const [reqBusy, setReqBusy] = useState(null);
  const [grants, setGrants] = useState(null); // owner: editors currently granted access
  const [grantBusy, setGrantBusy] = useState(null);
  const [giving, setGiving] = useState(false); // "Give edit access…" dialog
  const [editRetryAt, setEditRetryAt] = useState(editInfo?.retryAt || null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const { signedInvoke, signatureDialog } = useSignedInvoke();

  useEffect(() => {
    let cancelled = false;
    if (s.isMine) {
      invoke("list-section-edit-requests", { sectionId: s.sectionId })
        .then((r) => { if (!cancelled) setRequests(r?.requests || []); })
        .catch(() => { if (!cancelled) setRequests([]); });
      invoke("list-section-edit-grants", { sectionId: s.sectionId })
        .then((r) => { if (!cancelled) setGrants(r?.grants || []); })
        .catch(() => { if (!cancelled) setGrants([]); });
    } else if (!s.isExpired) {
      if (!editInfo) {
        invoke("check-section-edit", { sectionId: s.sectionId })
          .then((r) => { if (!cancelled) { setEditStatus(r?.status || "none"); setEditRetryAt(r?.retryAt || null); } })
          .catch(() => { if (!cancelled) setEditStatus("none"); });
      }
      // A space admin can give (and so must see and revoke) access on someone else's section.
      if (viewer?.isSpaceAdmin === true) {
        invoke("list-section-edit-grants", { sectionId: s.sectionId })
          .then((r) => { if (!cancelled) setGrants(r?.grants || []); })
          .catch(() => { if (!cancelled) setGrants([]); });
      }
    }
    return () => { cancelled = true; };
  }, [s.sectionId, s.isMine, s.isExpired, viewer?.isSpaceAdmin]);

  const submitReq = async () => {
    setBusy(true); setError(null);
    try {
      const r = await invoke("request-section-edit", { sectionId: s.sectionId, reason: reasonText.trim() });
      if (r?.success) { setEditStatus("pending"); setBar(null); setReasonText(""); }
      else setError(refusalText(r) || "Could not send the request.");
    } catch (e) { console.error("Section edit request failed:", e); setError("Could not reach Sentinel Vault. Try again."); }
    finally { setBusy(false); }
  };

  const resolve = async (requesterAccountId, action) => {
    setReqBusy(`${requesterAccountId}:${action}`); setError(null);
    try {
      const r = await signedInvoke(action === "approve" ? "approve-section-edit" : "deny-section-edit", { sectionId: s.sectionId, requesterAccountId });
      if (r?.success) {
        setRequests((p) => (p || []).filter((x) => x.requesterAccountId !== requesterAccountId));
        if (action === "approve") invoke("list-section-edit-grants", { sectionId: s.sectionId }).then((g) => setGrants(g?.grants || [])).catch(() => {});
      }
      else setError(r?.reason || (action === "approve" ? "Could not grant edit access." : "Could not decline the request."));
    } catch (e) { console.error("Resolve section request failed:", e); setError("Could not reach Sentinel Vault. Try again."); }
    finally { setReqBusy(null); }
  };

  const revokeGrant = async (editorAccountId) => {
    setGrantBusy(editorAccountId); setError(null);
    try {
      const r = await signedInvoke("revoke-section-edit-grant", { sectionId: s.sectionId, editorAccountId });
      if (r?.success) setGrants((p) => (p || []).filter((g) => g.editorAccountId !== editorAccountId));
      else setError(r?.reason || "Could not revoke this editor's access.");
    } catch (e) { console.error("Revoke section grant failed:", e); setError("Could not reach Sentinel Vault. Try again."); }
    finally { setGrantBusy(null); }
  };

  // SEC-7: extend the seal by the space default (mirrors the attachment card's Extend); grants ride along.
  const extend = async () => {
    setBusy(true); setError(null);
    try {
      const r = await signedInvoke("extend-section", { sectionId: s.sectionId });
      if (r?.success) { if (onChanged) onChanged(); }
      else setError(r?.reason || "Could not extend this seal.");
    } catch (e) { console.error("Extend section failed:", e); setError("Could not reach Sentinel Vault. Try again."); }
    finally { setBusy(false); }
  };

  const copyLink = async () => {
    const href = siteUrl && pageId ? `${siteUrl}/wiki/pages/viewpage.action?pageId=${pageId}` : "";
    if (!href) { setError("No link is available yet."); return; }
    setCopied(await copyText(href));
    setTimeout(() => setCopied(false), 1800);
  };

  const row = sectionRow(s, { editStatus, editRetryAt, pendingRequests: requests || [] });
  const { primary, menu } = rowActions(row, viewer);
  const warning = expiryWarning(row); // SEC-7
  // A non-owner's Release (expired seal) goes through the typed-reason bar (server: reason required).
  const forced = primary.kind === "release" && !s.isMine;
  // SEC-3: the same sentence the details modal, the macro badge and the ribbon compose.
  const sentence = sealSentence(row);
  const aria = `Section ${s.sectionTitle}: ${sentence}`;

  const onMenu = (id) => {
    if (id === "release") onUnseal(s.sectionId);
    else if (id === "extend") extend(); // SEC-7
    else if (id === "copy-link") copyLink();
    else if (id === "force-release") { setReasonText(""); setBar("force"); }
    else if (id === "give-access") setGiving(true);
  };
  const handlers = {
    release: () => (forced ? (setReasonText(""), setBar("force")) : onUnseal(s.sectionId)),
    decide: resolve,
    request: () => { setReasonText(""); setBar("request"); },
    propose: () => { setReasonText(PROPOSE_PREFILL); setBar("propose"); }, // SEC-2 (e)
  };
  const submitBar = () => {
    if (bar === "force") { onUnseal(s.sectionId, reasonText.trim()); setBar(null); setReasonText(""); }
    else submitReq();
  };

  return (
    <div className="sv-section-block" role="listitem" data-roving-card tabIndex={-1} aria-label={aria} data-testid="sv-section-row" data-primary={primary.kind}>
      <div className="sv-section-row">
        <span className="sv-section-row-title" title={s.sectionTitle}>{s.sectionTitle}</span>
        <span className="sv-section-row-meta">{sentence}{warning ? <span className="sv-section-row-warn" data-testid="sv-section-expiry-warning"> · {warning.text}</span> : null}{s.note ? <span className="sv-section-row-note" title={s.note}> · “{s.note}”</span> : null}</span>
        {primary.kind === "none" && editStatus === null && !s.isMine && !s.isExpired
          ? <span className="sv-section-row-lockedby"><OperatorChip accountId={s.lockedByAccountId} /></span>
          : <PrimarySlot primary={{ ...primary, forced }} name={`section ${s.sectionTitle}`} kind="section" busy={unsealing ? "unseal" : (busy ? "editreq" : null)} reqBusy={reqBusy} on={handlers} />}
        <ActionMenu items={menu} onPick={onMenu} label={`More actions for section ${s.sectionTitle}`} testId="sv-section-kebab" />
      </div>
      <CopiedNote shown={copied} />
      <ErrorRow message={error} onDismiss={() => setError(null)} testId="sv-section-error" />
      {bar && <ReasonBar mode={bar} kind="section" value={reasonText} onChange={setReasonText} onSubmit={submitBar} onCancel={() => { setBar(null); setReasonText(""); }} busy={busy || unsealing} testId="sv-section-reason-bar" />}
      {s.isMine && <RequestInbox requests={requests} name={`section ${s.sectionTitle}`} reqBusy={reqBusy} onDecide={resolve} firstDecidedAbove={primary.kind === "decide"} testId="sv-section-inbox" />}
      {signatureDialog}
      {giving && (
        <GiveAccessDialog
          invoker={signedInvoke}
          target={{ sectionId: s.sectionId }}
          name={`section ${s.sectionTitle}`}
          onClose={() => setGiving(false)}
          onGranted={() => invoke("list-section-edit-grants", { sectionId: s.sectionId }).then((g) => setGrants(g?.grants || [])).catch(() => {})}
          testId="sv-section-give-access"
        />
      )}
      {(s.isMine || (grants || []).length > 0) && <GrantInbox grants={grants} name={`section ${s.sectionTitle}`} grantBusy={grantBusy} onRevoke={revokeGrant} testId="sv-section-grants-inbox" />}
    </div>
  );
};

const SealedSectionsGroup = ({ pageId, onChanged, viewer, siteUrl }) => {
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null);            // sectionId being unsealed
  const [picking, setPicking] = useState(false);     // heading picker open
  const [headings, setHeadings] = useState([]);
  const [headingsLoading, setHeadingsLoading] = useState(false);
  const [sealingIndex, setSealingIndex] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [sealError, setSealError] = useState(null);  // why the last seal/unseal was refused

  // Each section's edit status for THIS viewer, read once for the list (ticket 2026-09-24: the
  // sections are grouped like the files — by you / you can edit now / by others).
  const [sectionStatus, setSectionStatus] = useState({});
  const [sectionStatusReady, setSectionStatusReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const others = sections.filter((x) => !x.isMine && !x.isExpired);
    if (!others.length) { setSectionStatus({}); setSectionStatusReady(true); return undefined; }
    setSectionStatusReady(false);
    Promise.all(others.map((x) =>
      invoke("check-section-edit", { sectionId: x.sectionId })
        .then((r) => [x.sectionId, { status: r?.status || "none", retryAt: r?.retryAt || null }])
        .catch(() => [x.sectionId, { status: "none", retryAt: null }]),
    )).then((pairs) => { if (!cancelled) { setSectionStatus(Object.fromEntries(pairs)); setSectionStatusReady(true); } });
    return () => { cancelled = true; };
  }, [sections]);

  const load = useCallback(async () => {
    if (!pageId) return;
    setLoading(true);
    try {
      const r = await invoke("enumerate-section-seals", { pageId });
      setSections(r?.sections || []);
    } catch (e) {
      console.error("Section seals load failed:", e);
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => { load(); }, [load]);

  const openPicker = async () => {
    setPicking(true);
    setSealError(null);
    setHeadingsLoading(true);
    try {
      const r = await invoke("list-page-headings", { pageId });
      setHeadings(r?.headings || []);
      if (r && r.success === false) setSealError(r.reason || "Could not read the page headings.");
    } catch (e) {
      console.error("List headings failed:", e);
      setHeadings([]);
      setSealError("Could not reach Sentinel Vault. Try again.");
    } finally {
      setHeadingsLoading(false);
    }
  };

  // SEC-7: picking a heading no longer seals it on the spot — the row opens a "Holds for" step
  // (the space default preselected, an optional note) and the seal goes with a real choice.
  const [picked, setPicked] = useState(null);      // the heading awaiting its hold choice
  const [hold, setHold] = useState(null);          // seconds, null = the space default
  const [note, setNote] = useState("");
  const HOLDS = [{ label: "Space default", seconds: null }, { label: "1 day", seconds: 86400 }, { label: "3 days", seconds: 3 * 86400 }, { label: "1 week", seconds: 7 * 86400 }, { label: "2 weeks", seconds: 14 * 86400 }, { label: "30 days", seconds: 30 * 86400 }];
  const sealHeading = async (h) => {
    setSealingIndex(h.index);
    setSealError(null);
    try {
      const r = await invoke("seal-section", { pageId, headingIndex: h.index, headingText: h.text, ...(hold ? { lockDuration: hold } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
      if (r?.success) {
        setPicking(false); setPicked(null); setHold(null); setNote("");
        await load();
        if (onChanged) onChanged();
      } else {
        // A refusal has a reason (permission, page changed, already sealed, write failed) — the
        // user must see it. Silently warning to the console read as "it just doesn't work".
        console.warn("seal-section declined:", r?.reason);
        setSealError(r?.reason || "Could not seal this section.");
      }
    } catch (e) {
      console.error("Seal section failed:", e);
      setSealError("Could not reach Sentinel Vault. Try again.");
    } finally {
      setSealingIndex(null);
    }
  };

  const { signedInvoke: signedUnseal, signatureDialog: unsealSignatureDialog } = useSignedInvoke();
  const unseal = async (sectionId, reason) => {
    setBusy(sectionId);
    setSealError(null);
    try {
      const r = await signedUnseal("unseal-section", reason ? { sectionId, reason } : { sectionId });
      if (r?.success) {
        await load();
        if (onChanged) onChanged();
      } else {
        setSealError(r?.reason || "Could not release this section.");
      }
    } catch (e) {
      console.error("Unseal section failed:", e);
      setSealError("Could not reach Sentinel Vault. Try again.");
    } finally {
      setBusy(null);
    }
  };

  if (!pageId) return null;

  return (
    <div className="sv-card-section sv-section-seals">
      {unsealSignatureDialog}
      <div className="sv-card-section-header">
        <button className="sv-group-toggle" onClick={() => setCollapsed(!collapsed)} title={collapsed ? "Expand" : "Collapse"}>
          <span className={`sv-group-caret ${collapsed ? "collapsed" : ""}`}>▾</span>
        </button>
        <span className="sv-card-section-title">Sealed Sections</span>
        {sections.length > 0 && <span className="sv-card-section-count">{sections.length}</span>}
        <span className="sv-card-section-note">Freeze a heading and everything under it; only you and the people you approve can change it</span>
        <button
          className="action-btn lock"
          style={{ marginLeft: "auto" }}
          onClick={picking ? () => { setPicking(false); setSealError(null); } : openPicker}
        >
          {picking ? "Cancel" : "Seal a section"}
        </button>
      </div>

      {!collapsed && (
        <>
          {sealError && (
            <div className="card-row card-action-error" role="alert">
              <span className="card-action-error-text">{sealError}</span>
              <button className="card-action-error-dismiss" onClick={() => setSealError(null)} aria-label="Dismiss">×</button>
            </div>
          )}
          {picking && (
            <div className="sv-section-picker">
              {headingsLoading && <div className="sv-panel-loading">Reading page…</div>}
              {!headingsLoading && headings.length === 0 && (
                <div className="sv-panel-empty">No headings to seal. Add a heading, then try again.</div>
              )}
              {!headingsLoading && headings.map((h) => (
                <div key={h.index} className={`sv-section-pick${picked?.index === h.index ? " is-picked" : ""}`}>
                  <button
                    className="sv-section-pick-row"
                    disabled={sealingIndex !== null}
                    aria-expanded={picked?.index === h.index}
                    onClick={() => { setPicked(picked?.index === h.index ? null : h); setSealError(null); }}
                    data-testid="sv-section-pick"
                  >
                    <span className="sv-section-pick-level">H{h.level}</span>
                    <span className="sv-section-pick-main">
                      <span className="sv-section-pick-text">{h.text}</span>
                      <span className="sv-section-pick-range" data-testid="sv-section-pick-range">{describeRange(h)}</span>
                    </span>
                    <span className="sv-section-pick-cta">{picked?.index === h.index ? "Choose how long ▾" : "Seal…"}</span>
                  </button>
                  {picked?.index === h.index && (
                    <div className="sv-section-hold" data-testid="sv-section-hold">
                      <span className="sv-section-hold-label">Holds for</span>
                      <span className="sv-section-hold-opts" role="radiogroup" aria-label="How long the seal holds">
                        {HOLDS.map((o) => (
                          <button key={String(o.seconds)} type="button" role="radio" aria-checked={hold === o.seconds} className={`sv-hold-opt${hold === o.seconds ? " is-on" : ""}`} onClick={() => setHold(o.seconds)} data-testid={`sv-hold-${o.seconds == null ? "default" : o.seconds}`}>{o.label}</button>
                        ))}
                      </span>
                      <input className="sv-section-hold-note" value={note} maxLength={300} placeholder="Note (optional) — why this section is sealed" aria-label="Seal note" onChange={(e) => setNote(e.target.value)} data-testid="sv-section-note" />
                      <button type="button" className="action-btn lock" disabled={sealingIndex !== null} onClick={() => sealHeading(h)} data-testid="sv-section-seal-confirm">{sealingIndex === h.index ? "Sealing…" : "Seal this section"}</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {loading && sections.length === 0 && (
            <div className="sv-panel-loading">Loading sealed sections…</div>
          )}

          {sections.length > 0 && (() => {
            const groups = groupSealedSections(sections, sectionStatus);
            return SEALED_GROUPS.map((g) => {
              const items = groups[g.id];
              if (!items.length) return null;
              const waiting = g.id !== "mine" && !sectionStatusReady;
              if (waiting && g.id === "editNow") return null;
              return (
                <div key={g.id} className="sv-sealed-group" data-testid={`sv-section-group-${g.id}`}>
                  <div className="sv-sealed-group-header">
                    <span className="sv-sealed-group-title">{g.title}</span>
                    <span className="sv-sealed-group-count">{items.length}</span>
                    <span className="sv-sealed-group-note">{g.note}</span>
                  </div>
                  {waiting
                    ? <div className="sv-sealed-group-wait" role="status">Checking your access…</div>
                    : (
                      <RovingList label={`Sealed sections — ${g.title}`} className="sv-section-list">
                        {items.map((s) => (
                          <SectionRow key={s.sectionId} section={s} editInfo={sectionStatus[s.sectionId]} unsealing={busy === s.sectionId} onUnseal={unseal} viewer={viewer} siteUrl={siteUrl} pageId={pageId} onChanged={async () => { await load(); if (onChanged) onChanged(); }} />
                        ))}
                      </RovingList>
                    )}
                </div>
              );
            });
          })()}
        </>
      )}
    </div>
  );
};

// ── Activity group (A1 — Document Activity) ──────────
// Same header treatment as the sibling groups (caret toggle, uppercase title, note on the right).
// `reloadKey` is bumped by the panel whenever a seal changes hands so the feed shows the event
// the user just caused without a page reload.

const ActivityGroup = ({ pageId, reloadKey }) => {
  const [collapsed, setCollapsed] = useState(false);
  if (!pageId) return null;
  return (
    <div className="sv-card-section sv-activity-section">
      <div className="sv-card-section-header">
        <button className="sv-group-toggle" onClick={() => setCollapsed(!collapsed)} title={collapsed ? "Expand" : "Collapse"}>
          <span className={`sv-group-caret ${collapsed ? "collapsed" : ""}`}>▾</span>
        </button>
        <span className="sv-card-section-title">Activity</span>
        <span className="sv-card-section-note">Everything Sentinel Vault did or was asked to do on this page</span>
      </div>
      {!collapsed && <ActivityFeed pageId={pageId} pageSize={10} compact reloadKey={reloadKey} />}
    </div>
  );
};

// ── Onboarding explainer (dismissible, shown once) ───

const EXPLAINER_KEY = "sv-explainer-dismissed-v1";

const ExplainerBanner = () => {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try { setDismissed(localStorage.getItem(EXPLAINER_KEY) === "1"); }
    catch (_) { setDismissed(false); }
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(EXPLAINER_KEY, "1"); } catch (_) { /* ignore */ }
  };

  if (dismissed) return null;

  return (
    <div className="sv-explainer">
      <div className="sv-explainer-body">
        <strong>What Sentinel Vault does on this page</strong>
        <ul className="sv-explainer-list">
          <li><strong>Seal attachments</strong> — only you (and approved editors) can change a sealed file.</li>
          <li><strong>Sealed Sections</strong> — lock a heading’s content while the rest of the page stays editable.</li>
          <li><strong>Validation</strong> — flag pages that miss required content standards.</li>
          <li><strong>AI Review</strong> — check content against your rules, style, tone &amp; compliance (Runs on Atlassian).</li>
        </ul>
      </div>
      <button className="sv-explainer-dismiss" onClick={dismiss} title="Dismiss">&times;</button>
    </div>
  );
};

// ── Main panel component ─────────────────────────────

const ArtifactGridView = () => {
  const [artifacts, setArtifacts] = useState([]);
  const { statusById: editStatusById, ready: editStatusReady } = useEditStatuses(artifacts); // groups the Sealed list
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState(null);
  const [pageId, setPageId] = useState(null);
  const [siteUrl, setSiteUrl] = useState(null);
  const [spaceKey, setSpaceKey] = useState(null);
  const [pageLocation, setPageLocation] = useState(null);
  // What the row rule needs to know about the caller (row-state.js `viewer`). canEditPage is
  // assumed: the macro renders in view mode for anyone who can read the page, and every write is
  // gated server-side — a refusal now shows its reason on the row instead of a dead button.
  // isSpaceAdmin comes from check-user-role (it decides only whether "Force release…" is offered).
  const [viewer, setViewer] = useState({ canEditPage: true, isSpaceAdmin: false });
  const [isEditing, setIsEditing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [counts, setCounts] = useState(null); // whole-page numbers from the lister's first page
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [panelConfig, setPanelConfig] = useState(INITIAL_CONFIG);
  // A1: bumped whenever seals change (an action here, or the stamp poll seeing another surface's
  // change) so the Activity group refetches and shows the event that just happened.
  const [activityReload, setActivityReload] = useState(0);

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
      if (result.counts) setCounts(result.counts);
    } catch (e) {
      console.error("[PANEL-UI] Error fetching artifacts:", e);
      setError("Unable to retrieve files.");
    } finally {
      setLoading(false);
      setEnriching(false);
      setLoadingMore(false);
    }
  }, [panelConfig.rowsPerPage]);

  // Refresh all data (re-fetch seals + attachments)
  const onRefresh = useCallback(async () => {
    if (!pageId) return;
    try {
      const seals = await invoke("enumerate-page-seals", { pageId });
      if (seals?.claimedArtifacts?.length > 0) {
        setArtifacts(seals.claimedArtifacts);
      }
    } catch (_) { /* fall through */ }
    retrieveFileData(pageId, false, null, true);
    setActivityReload((n) => n + 1);
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
      setSiteUrl(ctx.siteUrl || null);
      const sk = ctx.extension?.content?.space?.key || ctx.extension?.space?.key || null;
      setSpaceKey(sk);
      setPageLocation(ctx.extension?.location || null);
      setIsEditing(editing);
      if (sk) {
        invoke("check-user-role", { spaceKey: sk })
          .then((r) => setViewer((v) => ({ ...v, isSpaceAdmin: r?.role === "steward" })))
          .catch(() => {});
      }

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
          setActivityReload((n) => n + 1);
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
          Seal controls are accessible in view mode.
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
      <ArtifactCard key={att.id} att={att} columns={cols} onRefresh={onRefresh} siteUrl={siteUrl} spaceKey={spaceKey} pageId={pageId} pageLocation={pageLocation} viewer={viewer} editInfo={editStatusById[att.id]} />
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
            <span className="sv-panel-header-badge">{counts?.sealed ?? claimedFiles.length} sealed</span>
          )}
          {staleFiles.length > 0 && (
            <span className="sv-panel-header-badge badge-stale">{staleFiles.length} missing</span>
          )}
          {availableFiles.length > 0 && (
            <span className="sv-panel-header-badge badge-available">{counts?.available ?? availableFiles.length} available</span>
          )}
        </span>
      </div>

      {/* Onboarding explainer (shown once, dismissible) */}
      {!isEditing && <ExplainerBanner />}

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
          {claimedFiles.length > 0 && (() => {
            // Ticket 2026-09-24: grouped by what YOU can do — sealed by you, edit now, others.
            // Others' files wait for their statuses (one list-level read) so nothing jumps groups.
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
                        : <RovingList {...gridProps} label={`${g.title} attachments`}>{renderCards(files)}</RovingList>}
                    </div>
                  );
                })}
              </div>
            );
          })()}
          {staleFiles.length > 0 && (
            <div className="sv-card-section">
              <div className="sv-card-section-header">
                <span className="sv-card-section-title">Missing</span>
                <span className="sv-card-section-count badge-stale">{staleFiles.length}</span>
              </div>
              <RovingList {...gridProps} label="Missing attachments">{renderCards(staleFiles)}</RovingList>
            </div>
          )}
          {availableFiles.length > 0 && (
            <div className="sv-card-section">
              <div className="sv-card-section-header">
                <span className="sv-card-section-title">Available</span>
                <span className="sv-card-section-count" data-testid="sv-count-available">{counts?.available ?? availableFiles.length}</span>
              </div>
              <RovingList {...gridProps} label="Available attachments">{renderCards(availableFiles)}</RovingList>
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

      {/* Upload zone — F6 (owner feedback 2026-08-27): "the Drop files here or click to select
          section applies to an image; at first view you may be induced in error and think that
          for sealing a section you must crop it and drag and drop". It used to render LAST, i.e.
          directly beneath the Sealed Sections header, so it read as that section's control. It
          belongs with the attachments it uploads, and it now says what it does. */}
      {!loading && panelConfig.showUploadZone && (
        <div className="sv-card-section sv-upload-section">
          <div className="sv-card-section-header">
            <span className="sv-card-section-title">Add a file</span>
            <span className="sv-card-section-note">Attaches a file to this page — seal it afterwards</span>
          </div>
          <UploadZone onUploadComplete={onRefresh} />
        </div>
      )}


      {/* AI Review (Semantic AI Validations) */}
      {!loading && !isEditing && <AiReviewGroup pageId={pageId} />}

      {/* Sealed Sections (Content Sealing) — page CONTENT, not files. Kept last and visually
          divided from everything above so the two are never read as one surface. */}
      {!loading && !isEditing && <SealedSectionsGroup pageId={pageId} onChanged={onRefresh} viewer={viewer} siteUrl={siteUrl} />}

      {/* Validation status — below Sealed Sections (owner, 2026-09-24) */}
      {!loading && !isEditing && <ValidationStatus pageId={pageId} viewer={viewer} />}

      {/* Activity (A1) — the record of what happened on this page, newest first. Last, because it
          is a log to consult rather than a control to act on. */}
      {!loading && !isEditing && <ActivityGroup pageId={pageId} reloadKey={activityReload} />}
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
