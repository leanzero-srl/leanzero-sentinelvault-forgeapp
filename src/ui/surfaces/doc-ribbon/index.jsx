/**
 * Document Ribbon — Primary UI Surface
 *
 * Always-visible ribbon on every Confluence page.
 * Shows artifact seal count and a button to open the full management overlay.
 * Also displays conflict/expiry alerts when relevant.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { invoke, view, Modal } from "@forge/bridge";
import { enablePaletteSync } from "../../kit/palette-sync";

/**
 * Workflow state chip + transition control (#42). Shows the page's current
 * workflow state as a solid colored pill; if transitions are available, the pill
 * is a menu button that moves the page along the workflow (custom dropdown — never
 * a native <select>). Steward-gated transitions (e.g. entering Approved) are
 * rejected server-side and surfaced inline.
 */
const MODE_TEXT = { any: "Any one approver can approve", all: "All approvers must approve", min: "A minimum number must approve" };
const APPR_STATUS = { approved: "Approved", denied: "Denied", pending: "Pending" };

const WorkflowControl = ({ workflow, approvals, operatorId, pageId, spaceKey, onTransitioned }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [seat, setSeat] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [decideBusy, setDecideBusy] = useState(false);
  const [decideMsg, setDecideMsg] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const itemRefs = useRef([]);
  const panelRef = useRef(null);
  const apprBtnRef = useRef(null);

  const available = workflow?.available || [];
  const canMove = available.length > 0;
  const pendingApproval = approvals?.pending ? approvals : null;

  // Close the approval panel on outside click / Escape.
  useEffect(() => {
    if (!panelOpen) return undefined;
    // a11y: move focus INTO the dialog on open so it's announced (aria-label) and keyboard
    // users land inside it — a role="dialog" that never receives focus is an SR defect.
    // Focus the container (not a control) to avoid accidental Approve/Deny activation.
    requestAnimationFrame(() => panelRef.current?.focus());
    const outside = (e) => !panelRef.current?.contains(e.target) && !apprBtnRef.current?.contains(e.target);
    const onDown = (e) => { if (outside(e)) setPanelOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") { setPanelOpen(false); apprBtnRef.current?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [panelOpen]);

  const doDecide = useCallback(async (decision) => {
    setDecideBusy(true); setDecideMsg(null);
    try {
      const r = await invoke("decide-approval", { pageId, decision, reason });
      if (r?.success) {
        setReason("");
        setPanelOpen(false);
        await onTransitioned();
      } else {
        setDecideMsg(r?.reason || "Could not record your decision.");
      }
    } catch (_) {
      setDecideMsg("Could not record your decision.");
    } finally {
      setDecideBusy(false);
    }
  }, [pageId, reason, onTransitioned]);

  // Close on outside click, or when focus leaves both the trigger and the menu.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const outside = (e) => !menuRef.current?.contains(e.target) && !btnRef.current?.contains(e.target);
    const onDown = (e) => { if (outside(e)) setMenuOpen(false); };
    const onFocusIn = (e) => { if (outside(e)) setMenuOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("focusin", onFocusIn);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("focusin", onFocusIn); };
  }, [menuOpen]);

  // ARIA menu pattern: on open, move focus to the first transition.
  useEffect(() => {
    if (menuOpen) { setActiveIndex(0); requestAnimationFrame(() => itemRefs.current[0]?.focus()); }
  }, [menuOpen]);

  const moveActive = useCallback((next) => { setActiveIndex(next); itemRefs.current[next]?.focus(); }, []);

  const onMenuKey = useCallback((e) => {
    const n = available.length;
    if (!n) return;
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); moveActive((activeIndex + 1) % n); break;
      case "ArrowUp": e.preventDefault(); moveActive((activeIndex - 1 + n) % n); break;
      case "Home": e.preventDefault(); moveActive(0); break;
      case "End": e.preventDefault(); moveActive(n - 1); break;
      case "Escape": e.preventDefault(); setMenuOpen(false); requestAnimationFrame(() => btnRef.current?.focus()); break;
      default: break;
    }
  }, [available.length, activeIndex, moveActive]);

  const doTransition = useCallback(async (toStateId) => {
    setBusy(true); setError(null); setMenuOpen(false);
    try {
      const res = await invoke("request-transition", { pageId, spaceKey, toStateId });
      // A pending result (approval and/or AI review opened) is NOT an error — reload so the
      // ribbon renders the awaiting state.
      if (res?.success || res?.pending) {
        await onTransitioned();
        setSeat(false);
        requestAnimationFrame(() => setSeat(true)); // seat the newly-rendered state
      } else {
        // #46: a blocked transition names exactly what's missing (content conditions).
        const reasons = (res?.violations || []).map((v) => v.message || v.label).filter(Boolean);
        setError(reasons.length ? `${res?.reason || "Blocked"} — ${reasons.join("; ")}` : (res?.reason || "Transition not allowed"));
      }
    } catch (_) {
      setError("Transition failed");
    } finally {
      setBusy(false);
      requestAnimationFrame(() => btnRef.current?.focus()); // return focus to the trigger
    }
  }, [pageId, spaceKey, onTransitioned]);

  if (!workflow?.assigned || !workflow.state) return null;
  const state = workflow.state;

  // APPROVAL MODE — the page is awaiting sign-off before it can move to the enforce state.
  if (pendingApproval) {
    const approverList = pendingApproval.approvers || [];
    const approvedCount = approverList.filter((a) => a.status === "approved").length;
    const rawTarget = pendingApproval.toStateId || "";
    const targetName = workflow.def?.states?.find((s) => s.id === rawTarget)?.name
      || (rawTarget ? rawTarget.charAt(0).toUpperCase() + rawTarget.slice(1).replace(/_/g, " ") : "the next state");
    const mine = approverList.find((a) => a.accountId === operatorId);
    const iCanDecide = mine && mine.status === "pending";
    const others = approverList.filter((a) => a.accountId !== operatorId);
    const wouldComplete = pendingApproval.mode === "any"
      ? true
      : pendingApproval.mode === "min"
        ? approvedCount + 1 >= (pendingApproval.min || 1)
        : others.every((a) => a.status === "approved");
    return (
      <span className="wf-control">
        <button
          ref={apprBtnRef}
          type="button"
          className="wf-chip wf-chip-caution wf-chip-awaiting"
          onClick={() => setPanelOpen((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={panelOpen}
          title={`Awaiting approval to move to ${targetName}`}
        >
          <svg className="wf-chip-icon" width="10" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 22V4a1 1 0 0 1 1-1h13l-3 4 3 4H5" />
          </svg>
          <span className="wf-chip-label">{iCanDecide ? "Awaiting your approval" : "Awaiting approval"}</span>
          <span className="wf-chip-count" aria-hidden="true">{approvedCount} of {approverList.length}</span>
          <span className="wf-chip-caret" aria-hidden="true">▾</span>
        </button>
        {panelOpen && (
          <div className="wf-appr-panel" role="dialog" aria-label={`Approval to move to ${targetName}`} ref={panelRef} tabIndex={-1}>
            <div className="wf-appr-head">Approval to move to <strong>{targetName}</strong></div>
            <div className="wf-appr-sub">
              Requested by {pendingApproval.requestedByName || "a colleague"} · {MODE_TEXT[pendingApproval.mode] || MODE_TEXT.any}
              {pendingApproval.mode === "min" ? ` (at least ${pendingApproval.min})` : ""}
            </div>
            <div className="wf-appr-progress">{approvedCount} of {approverList.length} approved</div>
            <ul className="wf-appr-list">
              {approverList.map((a) => (
                <li key={a.accountId} className="wf-appr-row">
                  <span className={`wf-appr-badge wf-appr-${a.status || "pending"}`}>{APPR_STATUS[a.status] || "Pending"}</span>
                  <span className="wf-appr-name">{a.name || "Approver"}{a.accountId === operatorId ? " (you)" : ""}</span>
                  {a.reason ? <span className="wf-appr-reason">“{a.reason}”</span> : null}
                </li>
              ))}
              {pendingApproval.aiGate && (
                <li className="wf-appr-row">
                  <span className={`wf-appr-badge wf-appr-${pendingApproval.aiGate.status === "passed" ? "approved" : pendingApproval.aiGate.status === "failed" ? "denied" : "pending"}`}>
                    {pendingApproval.aiGate.status === "passed" ? "Passed" : pendingApproval.aiGate.status === "failed" ? "Issues" : "Reviewing"}
                  </span>
                  <span className="wf-appr-name">AI content review</span>
                  {pendingApproval.aiGate.reason ? <span className="wf-appr-reason">“{pendingApproval.aiGate.reason}”</span> : null}
                </li>
              )}
            </ul>
            {iCanDecide ? (
              <div className="wf-appr-decide">
                <p className="wf-appr-outcome">
                  {wouldComplete
                    ? `You're the deciding approval — approving moves this page to ${targetName}.`
                    : "Approving records your sign-off; the page moves once the rule is met."}
                  {" "}Denying keeps it In Review.
                </p>
                <textarea
                  className="wf-appr-reason-input"
                  rows={2}
                  placeholder="Add a reason (optional)"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  aria-label="Reason for your decision"
                />
                <div className="wf-appr-actions">
                  <button type="button" className="wf-appr-approve" onClick={() => doDecide("approved")} disabled={decideBusy}>Approve</button>
                  <button type="button" className="wf-appr-deny" onClick={() => doDecide("denied")} disabled={decideBusy}>Deny</button>
                </div>
              </div>
            ) : (
              <div className="wf-appr-note">{mine ? "You have already responded." : "Waiting on the approvers above."}</div>
            )}
            {decideMsg && <div className="wf-error" role="alert">{decideMsg}</div>}
          </div>
        )}
      </span>
    );
  }

  return (
    <span className="wf-control">
      <button
        ref={btnRef}
        type="button"
        className={`wf-chip wf-chip-${state.color || "neutral"}${seat ? " wf-seat" : ""}`}
        onClick={() => canMove && setMenuOpen((o) => !o)}
        onAnimationEnd={() => setSeat(false)}
        aria-haspopup={canMove ? "menu" : undefined}
        aria-expanded={canMove ? menuOpen : undefined}
        disabled={busy || !canMove}
        title={`${workflow.def?.name || "Workflow"} — ${state.name}${canMove ? " (click to move)" : ""}`}
      >
        <svg className="wf-chip-icon" width="10" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 22V4a1 1 0 0 1 1-1h13l-3 4 3 4H5" />
        </svg>
        <span className="wf-chip-label">{state.name}</span>
        {canMove && <span className="wf-chip-caret" aria-hidden="true">▾</span>}
      </button>
      {workflow.record?.reviewDueAt && (() => {
        const dueMs = new Date(workflow.record.reviewDueAt).getTime();
        const overdue = dueMs < Date.now();
        return (
          <span
            className={`wf-review-due${overdue ? " wf-review-overdue" : ""}`}
            title={overdue ? "The review period has elapsed — this page will move to Expired." : `Approval is due for re-review on ${new Date(dueMs).toLocaleDateString()}.`}
          >
            {overdue ? "Review overdue" : `Review due ${new Date(dueMs).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
          </span>
        );
      })()}
      {menuOpen && (
        <div className="wf-menu" role="menu" aria-label={`Move ${state.name} to`} ref={menuRef} onKeyDown={onMenuKey}>
          <div className="wf-menu-head" aria-hidden="true">Move to…</div>
          {available.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="menuitem"
              tabIndex={i === activeIndex ? 0 : -1}
              ref={(el) => { itemRefs.current[i] = el; }}
              className="wf-menu-item"
              onClick={() => doTransition(s.id)}
            >
              <span className={`wf-dot wf-dot-${s.color || "neutral"}`} aria-hidden="true" />
              {s.requiresApproval ? `Request approval → ${s.name}` : s.name}
            </button>
          ))}
        </div>
      )}
      {error && <span className="wf-error" role="alert">{error}</span>}
    </span>
  );
};

const DocumentRibbon = () => {
  const [sealedCount, setSealedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [validationState, setValidationState] = useState(null); // "passed"|"failed"|"awaiting-approval"
  const [aiCount, setAiCount] = useState(null); // number of latest AI findings, or null
  const [workflow, setWorkflow] = useState(null); // { assigned, state, available, def } or null
  const [approvals, setApprovals] = useState(null); // { pending, toStateId, approvers, mode, ... } or null
  const [operatorId, setOperatorId] = useState(null);
  const [pageId, setPageId] = useState(null);
  const [spaceKey, setSpaceKey] = useState(null);

  const reloadWorkflow = useCallback(async () => {
    if (!pageId) return;
    try {
      const res = await invoke("get-page-workflow", { pageId, spaceKey });
      setWorkflow(res?.assigned ? res : null);
    } catch (_) {
      setWorkflow(null);
    }
    try {
      const appr = await invoke("get-page-approvals", { pageId, spaceKey });
      setApprovals(appr?.pending ? appr : null);
    } catch (_) {
      setApprovals(null);
    }
  }, [pageId, spaceKey]);

  const fetchArtifactStats = useCallback(async () => {
    try {
      const result = await invoke("enumerate-doc-artifacts", { cursor: null, limit: 50 });
      const artifacts = result?.attachments || [];
      setTotalCount(artifacts.length);
      setSealedCount(
        artifacts.filter(
          (f) => f.lockStatus === "HELD" || f.lockStatus === "HELD_BY_ACTOR",
        ).length,
      );
    } catch (err) {
      console.error("Failed to fetch artifact stats:", err);
    }
  }, []);

  const fetchAlerts = useCallback(async (pageId, operatorId) => {
    try {
      const result = await invoke("recent-dispatches", { pageId });
      if (result?.success && result.notifications?.length > 0) {
        const relevant = result.notifications.filter(
          (n) => n.ownerAccountId === operatorId || n.editorAccountId === operatorId,
        );
        setAlerts(relevant);
      } else {
        setAlerts([]);
      }
    } catch (err) {
      console.error("Failed to fetch alerts:", err);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        await enablePaletteSync();

        const context = await view.getContext();
        const ctxPageId = context?.extension?.content?.id || context?.contentId;
        const ctxSpaceKey = context?.extension?.content?.space?.key || context?.extension?.space?.key || null;
        const contentType = context?.extension?.content?.type;
        const location = context?.extension?.location || "";
        const operatorId = context?.accountId;

        // Only show ribbon on actual content pages (not space apps, settings, or admin pages)
        const isSpaceAppPage = location.includes("/apps/") || location.includes("/settings/");
        const isContentPage = contentType === "page" || contentType === "blogpost";
        if (!ctxPageId || isSpaceAppPage || (contentType && !isContentPage)) {
          setLoading(false);
          return;
        }
        setPageId(ctxPageId);
        setSpaceKey(ctxSpaceKey);
        setOperatorId(operatorId || null);

        await fetchArtifactStats();

        // Page workflow state + any pending approval (best-effort; independent of seals).
        try {
          const wf = await invoke("get-page-workflow", { pageId: ctxPageId, spaceKey: ctxSpaceKey });
          if (wf?.assigned) setWorkflow(wf);
        } catch (_) { /* none */ }
        try {
          const appr = await invoke("get-page-approvals", { pageId: ctxPageId, spaceKey: ctxSpaceKey });
          if (appr?.pending) setApprovals(appr);
        } catch (_) { /* none */ }

        if (operatorId) {
          await fetchAlerts(ctxPageId, operatorId);
        }

        // Page-level validation + AI status (best-effort; independent of seals).
        try {
          const vs = await invoke("get-validation-state", { pageId: ctxPageId });
          if (vs?.state?.state) setValidationState(vs.state.state);
        } catch (_) { /* none */ }
        try {
          const ai = await invoke("get-ai-findings", { pageId: ctxPageId });
          if (ai?.findings?.findings) setAiCount(ai.findings.findings.length);
        } catch (_) { /* none */ }
      } catch (err) {
        console.error("Ribbon init error:", err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [fetchArtifactStats, fetchAlerts]);

  // Poll for seal changes made in other surfaces (inline panel, overlay)
  useEffect(() => {
    if (loading || totalCount === 0) return;
    let lastStamp = null;
    const poll = async () => {
      try {
        const { stamp } = await invoke("check-seal-stamp");
        if (lastStamp !== null && stamp !== lastStamp) {
          fetchArtifactStats();
        }
        lastStamp = stamp;
      } catch (e) {
        // Polling failures are non-critical
      }
    };
    const interval = setInterval(poll, 5000);
    poll();
    return () => clearInterval(interval);
  }, [loading, totalCount, fetchArtifactStats]);

  const openManageOverlay = useCallback(() => {
    const overlay = new Modal({
      resource: "overlay",
      size: "max",
      onClose: () => {
        fetchArtifactStats();
      },
    });
    overlay.open();
  }, [fetchArtifactStats]);

  const dismissAlert = useCallback(
    async (alertId) => {
      try {
        await invoke("acknowledge-dispatch", { dispatchId: alertId });
        setAlerts((prev) => prev.filter((a) => a.id !== alertId));
      } catch (err) {
        console.error("Failed to dismiss alert:", err);
      }
    },
    [],
  );

  // Hide ribbon entirely when the page has nothing to report (only after loading)
  if (!loading && totalCount === 0 && alerts.length === 0 && !validationState && aiCount === null && !workflow) {
    return null;
  }

  const primaryAlert = alerts.length > 0 ? alerts[0] : null;

  return (
    <div>
      {/* Main ribbon bar */}
      <div className="ribbon-bar">
        <div className="ribbon-icon">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>

        <span className="ribbon-title">Sentinel Vault</span>

        <span className="ribbon-status">
          {loading ? (
            <span className="ribbon-loading-bar" />
          ) : sealedCount > 0
            ? `${sealedCount} attachment${sealedCount !== 1 ? "s" : ""} sealed on this page`
            : totalCount > 0
              ? `${totalCount} attachment${totalCount !== 1 ? "s" : ""} on this page — none sealed`
              : "No attachments on this page"}
        </span>

        {!loading && workflow && (
          <WorkflowControl
            workflow={workflow}
            approvals={approvals}
            operatorId={operatorId}
            pageId={pageId}
            spaceKey={spaceKey}
            onTransitioned={reloadWorkflow}
          />
        )}

        {!loading && validationState && (
          <span className={`ribbon-chip ribbon-chip-${validationState}`} title="Page content validation status">
            {validationState === "passed" ? "Validation: passed" : validationState === "failed" ? "Validation: issues" : "Validation: awaiting approval"}
          </span>
        )}
        {!loading && aiCount !== null && aiCount > 0 && (
          <span className="ribbon-chip ribbon-chip-ai" title="AI content review findings">
            AI check: {aiCount} finding{aiCount !== 1 ? "s" : ""}
          </span>
        )}

        <button className="ribbon-action" onClick={openManageOverlay}>
          Manage Attachments
        </button>
      </div>

      {/* Alert section */}
      {primaryAlert && (
        <div className="ribbon-alert">
          <div className="ribbon-alert-item">
            <span className="ribbon-alert-icon">⚠</span>
            <div className="ribbon-alert-text">
              {primaryAlert.type === "SEAL_CONFLICT" && (
                <>
                  <strong>{primaryAlert.editorDisplayName}</strong> tried to
                  modify <strong>{primaryAlert.artifactName}</strong> which
                  is held by{" "}
                  <strong>{primaryAlert.ownerDisplayName}</strong>. The
                  modification was automatically rolled back.
                </>
              )}
              {primaryAlert.type === "SEAL_EXPIRED" && (
                <>
                  Your seal on{" "}
                  <strong>{primaryAlert.artifactName}</strong> is overdue.
                  Use the unseal button when you are done.
                </>
              )}
              {alerts.length > 1 && (
                <span className="sv-text-subtle" style={{ fontSize: "11px", marginLeft: "8px" }}>
                  + {alerts.length - 1} more
                </span>
              )}
            </div>

            <button
              className="ribbon-alert-dismiss"
              onClick={() => dismissAlert(primaryAlert.id)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Mount
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<DocumentRibbon />);
}
