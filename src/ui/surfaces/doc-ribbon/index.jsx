/**
 * Document Ribbon — Primary UI Surface
 *
 * Always-visible ribbon on every Confluence page.
 * Shows artifact seal count and a button to open the full management overlay.
 * Also displays conflict/expiry alerts when relevant.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { invoke, view, Modal, router } from "@forge/bridge";
import { enablePaletteSync } from "../../kit/palette-sync";
import DatePicker, { toYmd, fromYmd } from "../../kit/DatePicker";

/**
 * Workflow state chip + transition control (#42). Shows the page's current
 * workflow state as a solid colored pill; if transitions are available, the pill
 * is a menu button that moves the page along the workflow (custom dropdown — never
 * a native <select>). Steward-gated transitions (e.g. entering Approved) are
 * rejected server-side and surfaced inline.
 */
const MODE_TEXT = { any: "Any one approver can approve", all: "All approvers must approve", min: "A minimum number must approve" };
const APPR_STATUS = { approved: "Approved", denied: "Denied", pending: "Pending" };
// A4: the approval-record summary names the rule the decisions satisfied.
const MODE_LABEL = { any: "any approver", all: "all approvers" };
const modeLabel = (mode, min) => (mode === "min" ? `at least ${min || 1} approver${(min || 1) === 1 ? "" : "s"}` : MODE_LABEL[mode] || MODE_LABEL.any);
const fmtDate = (iso) => {
  const ms = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "an unknown date";
};
// A6: a historical page version renders at viewpage.action?pageId=…&pageVersion=n (verified live
// 2026-09-05; the classic viewpageversion.action is a 404). The ribbon is a SANDBOXED iframe
// (no allow-top-navigation), so a plain target="_top" anchor is dropped by the browser — the
// navigation has to go through the Forge bridge router (the overlay and console do the same).
// The href stays for hover, copy-link and the harness; the click is what navigates.
const versionPath = (pageId, version) => (pageId && version != null
  ? `/wiki/pages/viewpage.action?pageId=${encodeURIComponent(pageId)}&pageVersion=${encodeURIComponent(version)}`
  : null);
const versionHref = (siteUrl, pageId, version) => (siteUrl && versionPath(pageId, version) ? `${siteUrl}${versionPath(pageId, version)}` : null);
const VersionLink = ({ siteUrl, pageId, version, testId, children }) => {
  const href = versionHref(siteUrl, pageId, version);
  if (!href) return null;
  const go = (e) => { e.preventDefault(); router.navigate(versionPath(pageId, version)).catch(() => { window.open(href, "_blank"); }); };
  return (
    <a className="wf-version-link" href={href} onClick={go} rel="noreferrer" data-testid={testId}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 3h7v7" /><path d="M21 3l-9 9" /><path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" />
      </svg>
      {children}
    </a>
  );
};

// One dismissable-dialog behaviour for every ribbon panel (approval dialog #43, approval
// record A4): on open, focus moves INTO the panel (a role="dialog" that never receives focus is
// an SR defect — focus the container, not a control, so nothing is activated by accident);
// Escape and an outside click close it; Escape returns focus to the trigger chip.
const useDismissableDialog = (open, setOpen, panelRef, triggerRef) => {
  useEffect(() => {
    if (!open) return undefined;
    requestAnimationFrame(() => panelRef.current?.focus());
    const outside = (e) => !panelRef.current?.contains(e.target) && !triggerRef.current?.contains(e.target);
    const onDown = (e) => { if (outside(e)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } };
    // Focus leaving the popover (Tab to another chip, then Enter) closes it too, so two popovers
    // can never be open at once — a keyboard user otherwise stacked them in the host row.
    const onFocus = (e) => { if (outside(e)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); document.removeEventListener("focusin", onFocus); };
  }, [open, setOpen, panelRef, triggerRef]);
};

// Every ribbon popover renders INTO the in-flow host row below the chip row (DocumentRibbon's
// `.wf-dialog-host`) rather than absolutely over the bar: in real Confluence the pageBanner
// iframe only grows with in-flow content, so an absolutely-positioned panel is clipped to the
// bar's height (only the first lines of the Approval record were visible live). Refs, roles and
// the dismiss hook all work across the portal (the hook tests `ref.contains`, and React events
// bubble through portals). Before the host mounts, render in place.
const inHost = (host, node) => (host ? createPortal(node, host) : node);

// A5: a picked calendar day means the END of that day — "due Sep 12" is not overdue at breakfast
// on Sep 12 — anchored in UTC and rendered in UTC everywhere (chip, dialog, dashboard), so the day
// a steward in one timezone picked is the day a reader in another one sees. A local end-of-day
// would show as the next morning to anyone east of the picker.
const endOfDayIso = (ymd) => (fromYmd(ymd) ? `${ymd}T23:59:59.999Z` : null);
const ymdOfIso = (iso) => { const ms = iso ? new Date(iso).getTime() : NaN; return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null; };
const UTC_SHORT = { month: "short", day: "numeric", timeZone: "UTC" };
const UTC_LONG = { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" };
const UTC_NUMERIC = { timeZone: "UTC" };

// ONE secondary chip beside the state chip — "Approved v3 · review due Feb 2" — in place of the
// three that used to crowd the banner (approval record, review date, read count). Its popover
// holds, in order: the approval record (A4/A6), the review date (A5; a steward edits it here with
// the app's own month grid), and the readers' confirmations (B2; names for a steward). Everything
// renders into the in-flow host row, never absolutely over the bar (the banner iframe only grows
// with in-flow content).
const WorkflowDetails = ({ workflow, siteUrl, pageId, isSteward, host, onSaved, readStatus, readReportAllowed }) => {
  const record = workflow.record || {};
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const chipRef = useRef(null);
  useDismissableDialog(open, setOpen, panelRef, chipRef);

  // --- Approval record ---
  const enforced = !!record.enforce && record.approvedVersion != null;
  const ar = record.approvalRecord || null;
  // The chip and the link name the version that was REVIEWED (the record's pin). The enforce
  // baseline (record.approvedVersion) moves forward on every sanctioned edit; when it has, the
  // panel says so on its own line rather than linking to a version nobody approved.
  const reviewedVersion = (typeof ar?.pinnedVersion === "number" ? ar.pinnedVersion : null) ?? record.approvedVersion;
  const baselineVersion = record.approvedVersion;
  const baselineMoved = typeof baselineVersion === "number" && baselineVersion !== reviewedVersion;
  const decisions = Array.isArray(ar?.decisions) ? ar.decisions : [];
  const live = typeof workflow.liveVersion === "number" ? workflow.liveVersion : null;
  const changedSince = live != null && typeof baselineVersion === "number" && live > baselineVersion;
  const enforceMode = workflow.enforceMode || null;
  // CL-5: revert is downgraded to demote when the approver snapshot is empty — say what the app
  // will actually do, not what the setting says.
  const hasApproverSnapshot = Array.isArray(record.approvers) && record.approvers.length > 0;
  const consequence = enforceMode === "revert" && hasApproverSnapshot ? "reverted" : enforceMode ? "moved back for review" : "handled";
  const outcomeWord = ar?.outcome === "denied" ? "Denied" : "Approved";
  let summary = null;
  if (enforced) {
    if (!ar) summary = `Approved on ${fmtDate(record.approvedAt)} (details were not recorded for this approval).`;
    else if (decisions.length === 0) summary = `${outcomeWord} by ${ar.completedByName || "a space steward"} on ${fmtDate(ar.completedAt)}.`;
    else summary = `${outcomeWord} for version ${ar.pinnedVersion ?? reviewedVersion} on ${fmtDate(ar.completedAt)} · ${modeLabel(ar.mode, ar.min)}`;
  }

  // --- Review date ---
  const [dueAt, setDueAt] = useState(record.reviewDueAt || null);
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { setDueAt(record.reviewDueAt || null); }, [record.reviewDueAt]);
  useEffect(() => { if (!open) { setEditing(false); setPicked(null); setError(null); } }, [open]);
  const dueMs = dueAt ? new Date(dueAt).getTime() : NaN;
  const hasDue = Number.isFinite(dueMs);
  const overdue = hasDue && dueMs < Date.now();
  const shortDate = hasDue ? new Date(dueMs).toLocaleDateString(undefined, UTC_SHORT) : null;
  const longDate = hasDue ? new Date(dueMs).toLocaleDateString(undefined, UTC_LONG) : null;
  const expiresFromHere = Array.isArray(workflow?.available) && workflow.available.some((s) => s?.id === "expired");
  const tomorrow = toYmd(new Date(Date.now() + 24 * 3600 * 1000));
  const currentYmd = ymdOfIso(dueAt);
  const selectedYmd = picked || currentYmd;
  const canSave = !!picked && picked !== currentYmd;
  const saveDue = async (next) => {
    setBusy(true); setError(null);
    try {
      const r = await invoke("set-review-due", { pageId, reviewDueAt: next });
      if (r?.success) { setDueAt(r.reviewDueAt ?? next ?? null); setEditing(false); setPicked(null); await onSaved?.(); }
      else setError(r?.reason || "Could not change the review date.");
    } catch (_) { setError("Could not change the review date."); }
    finally { setBusy(false); }
  };

  // --- Readers ---
  const rc = workflow.readConfirmation;
  const readers = rc?.required && readStatus?.required ? readStatus : null;
  const [report, setReport] = useState(null);
  useEffect(() => {
    if (!open || !readers || !readReportAllowed) { setReport(null); return undefined; }
    let alive = true;
    (async () => { try { const r = await invoke("get-read-report", { pageId }); if (alive) setReport(r); } catch (_) { if (alive) setReport({ readers: [] }); } })();
    return () => { alive = false; };
  }, [open, pageId, readers, readReportAllowed]);

  // --- The chip ---
  const parts = [];
  if (enforced) parts.push(`Approved v${reviewedVersion}`);
  if (hasDue) parts.push(overdue ? "review overdue" : `review due ${shortDate}`);
  if (readers && readReportAllowed) parts.push(`read ${readers.ackedCount}/${readers.audienceCount}${readers.unresolved ? "+" : ""}`);
  if (!parts.length) {
    if (!isSteward) return null;
    parts.push("Set review date"); // a steward can give any state a review date
  }
  const tone = overdue ? "critical" : enforced ? "success" : "neutral";
  const title = overdue
    ? (expiresFromHere ? "The review period has elapsed — this page will move to Expired. Open for details." : "The review period has elapsed — review this page and move it on, or set a new date.")
    : "Approval record, review date and readers — open for details.";

  return (
    <span className="wf-details">
      <button
        ref={chipRef}
        type="button"
        className={`wf-chip wf-chip-outline wf-chip-outline-${tone}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        data-testid="wf-details-chip"
        data-enforced={enforced ? "1" : "0"}
        data-overdue={overdue ? "1" : "0"}
      >
        <svg className="wf-chip-icon" width="10" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" />
        </svg>
        <span className="wf-chip-label">{parts.join(" · ")}</span>
        <span className="wf-chip-caret" aria-hidden="true">▾</span>
      </button>
      {open && inHost(host, (
        <div className="wf-appr-panel wf-details-panel" role="dialog" aria-label="Workflow details" ref={panelRef} tabIndex={-1} data-testid="wf-details-panel">
          {enforced && (
            <section className="wf-details-section" data-testid="wf-evidence-panel">
              <div className="wf-appr-head">Approval record</div>
              <div className="wf-appr-sub">{summary}</div>
              {ar?.requestedByName && <div className="wf-appr-sub">Requested by {ar.requestedByName} on {fmtDate(ar.requestedAt)}</div>}
              {(decisions.length > 0 || ar?.aiGate || ar?.requestSignature) && (
                <ul className="wf-appr-list">
                  {decisions.map((d, i) => (
                    <li key={d.accountId || i} className="wf-appr-row wf-evidence-row" data-testid="wf-evidence-decision">
                      <span className="wf-appr-name">{d.name || "Approver"}</span>
                      <span className={`wf-appr-badge wf-appr-${d.decision === "denied" ? "denied" : d.decision === "approved" ? "approved" : "pending"}`}>{d.decision === "denied" ? "Denied" : d.decision === "approved" ? "Approved" : "No decision before completion"}</span>
                      <span className="wf-appr-date">{fmtDate(d.decidedAt)}</span>
                      {d.signed ? <span className="wf-appr-signed" title="Signed with the approver's enrolled authenticator" data-testid="wf-evidence-signed">Signed</span> : null}
                      {d.reason ? <span className="wf-appr-reason">“{d.reason}”</span> : null}
                    </li>
                  ))}
                  {ar?.requestSignature && (
                    <li className="wf-appr-row wf-evidence-row" data-testid="wf-evidence-request-signed">
                      <span className="wf-appr-name">{ar.completedByName || "Approver"}</span>
                      <span className="wf-appr-badge wf-appr-approved">Approved</span>
                      <span className="wf-appr-date">{fmtDate(ar.requestSignature.verifiedAt)}</span>
                      <span className="wf-appr-signed" title="Signed with the approver's enrolled authenticator">Signed</span>
                    </li>
                  )}
                  {ar?.aiGate && (
                    <li className="wf-appr-row wf-evidence-row" data-testid="wf-evidence-ai">
                      <span className="wf-appr-name">AI content review</span>
                      <span className={`wf-appr-badge wf-appr-${ar.aiGate.status === "passed" ? "approved" : ar.aiGate.status === "failed" ? "denied" : "pending"}`}>
                        {ar.aiGate.status === "passed" ? "Passed" : ar.aiGate.status === "failed" ? "Failed" : "Skipped"}
                      </span>
                      {ar.aiGate.reason ? <span className="wf-appr-reason">“{ar.aiGate.reason}”</span> : null}
                    </li>
                  )}
                </ul>
              )}
              <VersionLink siteUrl={siteUrl} pageId={pageId} version={reviewedVersion} testId="wf-approved-version-link">
                View approved version (v{reviewedVersion})
              </VersionLink>
              {baselineMoved && (
                <p className="wf-evidence-baseline" data-testid="wf-evidence-baseline">
                  Sanctioned baseline is now v{baselineVersion} (edited by an approver or steward since the review).
                </p>
              )}
              {changedSince && (
                <div className="wf-evidence-stale" data-testid="wf-evidence-stale">
                  This page has changed since approval (now v{live}). Unsanctioned edits are {consequence} automatically.
                </div>
              )}
            </section>
          )}

          <section className="wf-details-section" data-testid="wf-review-due-dialog">
            <div className="wf-appr-head">Review date</div>
            <div className="wf-appr-sub" data-testid="wf-review-due-current">
              {hasDue
                ? (overdue ? `Was due ${longDate} — overdue.${expiresFromHere ? " This page will move to Expired." : ""}` : `Due for re-review on ${longDate}.`)
                : "No review date is set on this page."}
            </div>
            {isSteward && !editing && (
              <div className="wf-appr-actions wf-review-actions">
                <button type="button" className="wf-review-save" onClick={() => setEditing(true)} data-testid="wf-review-due-change">{hasDue ? "Change date" : "Set a date"}</button>
                <button type="button" className="wf-review-clear" onClick={() => saveDue(null)} disabled={busy || !hasDue} data-testid="wf-review-due-clear" title={hasDue ? "Remove the review date — the page will not be flagged for re-review." : "There is no review date to clear."}>Clear</button>
              </div>
            )}
            {isSteward && editing && (
              <>
                <DatePicker value={selectedYmd} min={tomorrow} onChange={setPicked} onClose={() => { setEditing(false); setPicked(null); }} ariaLabel="Review date" />
                {picked && picked !== currentYmd && (
                  <div className="wf-review-pick" data-testid="wf-review-due-picked">New date: <strong>{new Date(`${picked}T12:00:00Z`).toLocaleDateString(undefined, UTC_LONG)}</strong></div>
                )}
                <div className="wf-appr-actions wf-review-actions">
                  <button type="button" className="wf-review-save" onClick={() => saveDue(endOfDayIso(picked))} disabled={busy || !canSave} data-testid="wf-review-due-save">{busy ? "Saving…" : "Save"}</button>
                  <button type="button" className="wf-review-clear" onClick={() => { setEditing(false); setPicked(null); }} disabled={busy}>Cancel</button>
                </div>
              </>
            )}
            {error && <div className="wf-error wf-review-error" role="alert" data-testid="wf-review-due-error">{error}</div>}
          </section>

          {readers && (
            <section className="wf-details-section" data-testid="wf-read-dialog">
              <div className="wf-appr-head">Readers</div>
              <div className="wf-appr-sub">
                {readers.audienceCount > 0
                  ? `${readers.ackedCount} of ${readers.audienceCount}${readers.unresolved ? "+" : ""} people asked to read this page have confirmed version ${readers.version ?? "?"}.`
                  : "Nobody is in the audience yet — add people or groups on the space's Workflow tab."}
                {readers.unresolved ? " One or more groups could not be expanded right now." : ""}
                {readers.myAck ? ` You confirmed on ${new Date(readers.myAck.at).toLocaleDateString()}.` : ""}
              </div>
              {readReportAllowed && !report && readers.audienceCount > 0 && <div className="wf-read-loading">Loading…</div>}
              {readReportAllowed && report?.readers?.length > 0 && (
                <ul className="wf-read-list">
                  {report.readers.map((r) => (
                    <li key={r.accountId} className={`wf-read-row${r.confirmed ? " wf-read-row-yes" : ""}`} data-testid="wf-read-row" data-confirmed={r.confirmed ? "1" : "0"}>
                      <span className="wf-read-name">{r.name}</span>
                      <span className="wf-read-state">{r.confirmed ? `Read v${r.version ?? "?"}` : r.staleVersion != null ? `Read v${r.staleVersion}, not v${readers.version ?? "?"}` : "Not yet"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      ))}
    </span>
  );
};

// B2: the one action a reader has — a solid button until they confirm, then a quiet mark.
const ReadConfirmButton = ({ pageId, status, onConfirmed }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!status?.required) return null;
  const vLabel = status.version != null ? `v${status.version}` : "this version";
  const confirm = async () => {
    setBusy(true); setError(null);
    try {
      const r = await invoke("confirm-read", { pageId });
      if (r?.success) await onConfirmed?.(); else setError(r?.reason || "Could not record your confirmation.");
    } catch (_) { setError("Could not record your confirmation."); }
    finally { setBusy(false); }
  };
  return (
    <span className="wf-read" data-testid="wf-read">
      {status.myAck
        ? <span className="wf-read-done" title={`You confirmed reading ${vLabel} on ${new Date(status.myAck.at).toLocaleDateString()}.`} data-testid="wf-read-done">Read {vLabel} ✓</span>
        : <button type="button" className="wf-read-btn" onClick={confirm} disabled={busy} title="Record that you have read the approved version of this page." data-testid="wf-read-confirm">{busy ? "Saving…" : `Confirm I've read ${vLabel}`}</button>}
      {error && <span className="wf-read-error" role="alert">{error}</span>}
    </span>
  );
};

const WorkflowControl = ({ workflow, approvals, operatorId, pageId, spaceKey, siteUrl, isSteward, host, onTransitioned }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [seat, setSeat] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [sigCode, setSigCode] = useState(""); // B3: the approver's authenticator code, when the space requires one
  const [readStatus, setReadStatus] = useState(null); // B2: counts + my ack, fetched only when the page asks for confirmations
  const loadReadStatus = useCallback(async () => {
    try { setReadStatus(await invoke("get-read-status", { pageId })); } catch (_) { setReadStatus(null); }
  }, [pageId]);
  useEffect(() => { if (workflow?.readConfirmation?.required) loadReadStatus(); else setReadStatus(null); }, [workflow?.readConfirmation?.required, workflow?.readConfirmation?.version, loadReadStatus]);
  const [signMove, setSignMove] = useState(null); // B3: { toStateId, reason } — a move that must be signed (direct steward approval / AI-only gate)
  const [moveCode, setMoveCode] = useState("");
  const signRef = useRef(null);
  const signBtnRef = useRef(null);
  useDismissableDialog(!!signMove, (o) => { if (!o) setSignMove(null); }, signRef, signBtnRef);
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

  // Close the approval panel on outside click / Escape; focus in on open, back to the chip on Escape.
  useDismissableDialog(panelOpen, setPanelOpen, panelRef, apprBtnRef);

  const doDecide = useCallback(async (decision) => {
    setDecideBusy(true); setDecideMsg(null);
    try {
      const r = await invoke("decide-approval", { pageId, decision, reason, code: sigCode || null });
      if (r?.success) {
        setReason(""); setSigCode("");
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
  }, [pageId, reason, sigCode, onTransitioned]); // B3: the code is read at click time, not from the first render

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
      const res = await invoke("request-transition", { pageId, spaceKey, toStateId, ...(moveCode ? { code: moveCode } : {}) });
      if (res?.signatureRequired) {
        // The space requires a signed decision and this move IS the decision (no approvers,
        // or an AI-only gate): ask for the code and retry with it. A code that was SENT and
        // refused is an error inside the dialog, not a new subtitle.
        if (moveCode) { setError(res.reason || "That code did not match"); }
        else { setSignMove({ toStateId, reason: res.reason || "" }); }
        setMoveCode("");
        setMenuOpen(false);
        return;
      }
      // A pending result (approval and/or AI review opened) is NOT an error — reload so the
      // ribbon renders the awaiting state.
      if (res?.success || res?.pending) {
        setSignMove(null); setMoveCode(""); await onTransitioned();
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
      // Return focus to the trigger — unless the sign dialog is still up, where the code field
      // is the thing to retry.
      requestAnimationFrame(() => (signRef.current?.querySelector('[data-testid="wf-sign-move-code"]') || btnRef.current)?.focus());
    }
  }, [moveCode, pageId, spaceKey, onTransitioned]);

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
        {panelOpen && inHost(host, (
          <div className="wf-appr-panel" role="dialog" aria-label={`Approval to move to ${targetName}`} ref={panelRef} tabIndex={-1}>
            <div className="wf-appr-head">Approval to move to <strong>{targetName}</strong></div>
            <div className="wf-appr-sub">
              Requested by {pendingApproval.requestedByName || "a colleague"} · {MODE_TEXT[pendingApproval.mode] || MODE_TEXT.any}
              {pendingApproval.mode === "min" ? ` (at least ${pendingApproval.min})` : ""}
            </div>
            <div className="wf-appr-progress">{approvedCount} of {approverList.length} approved</div>
            {pendingApproval.pinnedVersion != null && (
              <VersionLink siteUrl={siteUrl} pageId={pageId} version={pendingApproval.pinnedVersion} testId="wf-pinned-version-link">
                View the version you are approving (v{pendingApproval.pinnedVersion})
              </VersionLink>
            )}
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
                {pendingApproval.requireSignature && (
                  <div className="wf-appr-sign" data-testid="wf-appr-sign">
                    {pendingApproval.signatureEnrolled ? (
                      <label className="wf-appr-sign-label">
                        <span>Sign with your authenticator code</span>
                        <input
                          className="wf-appr-sign-input"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={8}
                          placeholder="123 456"
                          value={sigCode}
                          onChange={(e) => setSigCode(e.target.value)}
                          aria-label="Authenticator code"
                          data-testid="wf-appr-sign-code"
                        />
                      </label>
                    ) : (
                      <div className="wf-appr-sign-missing" data-testid="wf-appr-sign-missing">
                        This space requires a signed decision. <a href="#" onClick={(e) => { e.preventDefault(); router.navigate("/wiki/apps/c30bf71e-4287-4872-954d-db49cc68f0ff/my-work"); }}>Set up your signature on My work</a> first.
                      </div>
                    )}
                  </div>
                )}
                <div className="wf-appr-actions">
                  <button type="button" className="wf-appr-approve" onClick={() => doDecide("approved")} disabled={decideBusy || (pendingApproval.requireSignature && (!pendingApproval.signatureEnrolled || !sigCode.trim()))}>{pendingApproval.requireSignature ? "Sign & approve" : "Approve"}</button>
                  <button type="button" className="wf-appr-deny" onClick={() => doDecide("denied")} disabled={decideBusy || (pendingApproval.requireSignature && (!pendingApproval.signatureEnrolled || !sigCode.trim()))}>{pendingApproval.requireSignature ? "Sign & deny" : "Deny"}</button>
                </div>
              </div>
            ) : (
              <div className="wf-appr-note">{mine ? "You have already responded." : "Waiting on the approvers above."}</div>
            )}
            {decideMsg && <div className="wf-error" role="alert">{decideMsg}</div>}
          </div>
        ))}
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
      <WorkflowDetails workflow={workflow} siteUrl={siteUrl} pageId={pageId} isSteward={isSteward} host={host} onSaved={onTransitioned} readStatus={readStatus} readReportAllowed={!!workflow.readConfirmation?.canReport} />
      <ReadConfirmButton pageId={pageId} status={readStatus} onConfirmed={loadReadStatus} />
      {signMove && inHost(host, (
        <div className="wf-appr-panel wf-sign-panel" role="dialog" aria-label="Sign this move" ref={signRef} tabIndex={-1} data-testid="wf-sign-move">
          <div className="wf-appr-head">Sign this move</div>
          <div className="wf-appr-sub">{signMove.reason || "This space requires a signed decision — enter the current code from your authenticator."}</div>
          <div className="wf-appr-sign">
            <label className="wf-appr-sign-label">
              <span>Authenticator code</span>
              <input className="wf-appr-sign-input" inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="123 456" value={moveCode} onChange={(e) => setMoveCode(e.target.value)} aria-label="Authenticator code" data-testid="wf-sign-move-code" />
            </label>
          </div>
          <div className="wf-appr-actions">
            <button type="button" className="wf-appr-approve" disabled={busy || !moveCode.trim()} onClick={() => { const to = signMove.toStateId; doTransition(to); }} data-testid="wf-sign-move-go">Sign &amp; move</button>
            <button type="button" className="wf-review-clear" onClick={() => { setSignMove(null); setMoveCode(""); setError(null); }}>Cancel</button>
          </div>
          {error && <div className="wf-error" role="alert" data-testid="wf-sign-move-error">{error}</div>}
        </div>
      ))}
      {menuOpen && inHost(host, (
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
      ))}
      {error && !signMove && <span className="wf-error" role="alert">{error}</span>}
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
  const [siteUrl, setSiteUrl] = useState(null); // A6: version links must leave the iframe to the site
  const [dialogHost, setDialogHost] = useState(null); // in-flow row every popover renders into

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
        setSiteUrl(context?.siteUrl || null);

        await fetchArtifactStats();

        // Page workflow state + any pending approval (best-effort; independent of seals).
        try {
          const wf = await invoke("get-page-workflow", { pageId: ctxPageId, spaceKey: ctxSpaceKey });
          if (wf?.assigned) setWorkflow(wf);
        } catch (_) { /* none */ }
        // A5: the review-date control shows for whoever `get-page-workflow` says may set it
        // (`canSetReviewDue`, the SAME gate `set-review-due` applies) — a separate role probe
        // answered a different question and drifted from it when admin override was off.
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
            siteUrl={siteUrl}
            isSteward={!!workflow?.canSetReviewDue}
            host={dialogHost}
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

      {/* In-flow host for every workflow popover — see inHost(). Empty (and display:none) when
          nothing is open so the banner reserves no space. */}
      <div className="wf-dialog-host" ref={setDialogHost} data-testid="wf-dialog-host" />

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
