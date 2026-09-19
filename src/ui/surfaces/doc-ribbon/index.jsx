/**
 * Document Ribbon — Primary UI Surface (5.0, mockup docs/mockups/sv-status-surfaces.html §2/§3)
 *
 * ONE row: the left block is the page's classification (solid level colour, lock glyph when the
 * page holds a seal, level name, source); the right half holds exactly ONE urgent thing for the
 * viewer — a state pill, one sentence, and the buttons (Request edit · Open · ×). Whether the row
 * opens at all is the pure rule in kit/ribbon-rules.js (decideRibbon), fed by the steward's
 * `ribbonMode` ("exceptions" | "always") and `ribbonThresholdRank`, the `ribbon-summary` answer
 * (classification, waiting-on-me, lockedFor), the viewer's alerts and the page's workflow /
 * validation state. Hidden = view.close() (Confluence drops the banner row), shown = view.open().
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { invoke, view, Modal, router } from "@forge/bridge";
import { enablePaletteSync } from "../../kit/palette-sync";
import { myWorkPath } from "../../kit/my-work-path.js";
import { useActionMenu } from "../../kit/ActionMenu";
import DatePicker, { toYmd, fromYmd } from "../../kit/DatePicker";
import { decideRibbon, untilLabel } from "../../kit/ribbon-rules";

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
    else if (decisions.length === 0) summary = `${outcomeWord} by ${ar.completedByName || "a space admin"} on ${fmtDate(ar.completedAt)}.`;
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

  // WF-3: the last denial / stale close on a page with no open request — the chip says so and the
  // popover carries the reason; the server only answers it when it applies.
  const lastDecision = !enforced && workflow.lastDecision ? workflow.lastDecision : null;

  // --- The chip ---
  const parts = [];
  if (enforced) parts.push(`Approved v${reviewedVersion}`);
  // A decision is an instant (local date, like the popover); a review DUE date is a calendar day (UTC).
  if (lastDecision) parts.push(`${lastDecision.kind === "denied" ? "Declined" : "Request closed"} ${new Date(lastDecision.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`);
  if (hasDue) parts.push(overdue ? "review overdue" : `review due ${shortDate}`);
  if (readers && readReportAllowed) parts.push(`read ${readers.ackedCount}/${readers.audienceCount}${readers.unresolved ? "+" : ""}`);
  if (!parts.length) {
    if (!isSteward) return null;
    parts.push("Set review date"); // a steward can give any state a review date
  }
  const tone = overdue ? "critical" : enforced ? "success" : lastDecision?.kind === "denied" ? "critical" : "neutral";
  const title = overdue
    ? (expiresFromHere ? "The review period has elapsed — this page will move to Expired. Open for details." : "The review period has elapsed — review this page and move it on, or set a new date.")
    : lastDecision ? "The last approval request was not completed — open for the reason."
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
                  Sanctioned baseline is now v{baselineVersion} (edited by an approver or space admin since the review).
                </p>
              )}
              {changedSince && (
                <div className="wf-evidence-stale" data-testid="wf-evidence-stale">
                  This page has changed since approval (now v{live}). Unsanctioned edits are {consequence} automatically.
                </div>
              )}
            </section>
          )}

          {lastDecision && (
            <section className="wf-details-section" data-testid="wf-last-decision">
              <div className="wf-appr-head">Last approval decision</div>
              <div className="wf-appr-sub">
                {lastDecision.kind === "denied"
                  ? `Declined by ${lastDecision.byName || "an approver"} on ${fmtDate(new Date(lastDecision.at).toISOString())}${lastDecision.reviewedVersion != null ? ` · reviewed v${lastDecision.reviewedVersion}` : ""}.`
                  : `The request was closed on ${fmtDate(new Date(lastDecision.at).toISOString())} because the page changed after it was made${lastDecision.reviewedVersion != null ? ` (reviewed v${lastDecision.reviewedVersion})` : ""}. Nobody declined it.`}
              </div>
              {lastDecision.reason
                ? <div className="wf-last-reason" data-testid="wf-last-decision-reason">“{lastDecision.reason}”</div>
                : lastDecision.kind === "denied" ? <div className="wf-appr-note">No reason was given.</div> : null}
              <div className="wf-appr-note">Re-request approval from the state chip when the page is ready.</div>
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
  const available = workflow?.available || [];
  const canMove = available.length > 0;
  const pendingApproval = approvals?.pending ? approvals : null;
  const [decideBusy, setDecideBusy] = useState(false);
  const [decideMsg, setDecideMsg] = useState(null);
  // WF-1/WF-4: a one-line notice next to the chip that OUTLIVES the popover — a decision that
  // closed the request (approved, denied, stale) unmounts the approval panel, so the outcome is
  // said here. Success notices clear themselves; a stale/blocked one stays until the next change.
  const [notice, setNotice] = useState(null); // { text, tone: "success" | "caution" }
  const noticeTimer = useRef(null);
  const say = useCallback((text, tone = "success") => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(text ? { text, tone } : null);
    if (text && tone === "success") noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  }, []);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);
  const [rerequestBusy, setRerequestBusy] = useState(false);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const panelRef = useRef(null);
  const apprBtnRef = useRef(null);


  // Close the approval panel on outside click / Escape; focus in on open, back to the chip on Escape.
  useDismissableDialog(panelOpen, setPanelOpen, panelRef, apprBtnRef);

  const doDecide = useCallback(async (decision) => {
    setDecideBusy(true); setDecideMsg(null);
    try {
      const r = await invoke("decide-approval", { pageId, decision, reason, code: sigCode || null });
      if (r?.success) {
        // WF-1: `success` means "recorded", not "done" — the outcome says what happened. A stale
        // close, an AI hold or an AI block keep the popover open with the reason; a completed
        // outcome closes it and says so next to the chip (WF-4).
        const outcome = r.outcome || decision;
        if (outcome === "approved" || outcome === "denied" || outcome === "pending") {
          setReason(""); setSigCode("");
          setPanelOpen(false);
          say(outcome === "denied" ? `Denied — ${pendingApproval?.requestedByName || "the requester"} has been told.`
            : outcome === "approved" && r.transitioned ? "Approved — the page is now Approved."
              : outcome === "approved" ? "Approved — your sign-off is recorded; the page moves once the rule is met."
                : "Your decision is recorded.");
        } else {
          say(r.reason || "The request could not be completed.", "caution");
          setDecideMsg(r.reason || "The request could not be completed.");
        }
        await onTransitioned();
      } else {
        setDecideMsg(r?.reason || "Could not record your decision.");
        if (r?.stale) await onTransitioned(); // the panel then shows the stale block
      }
    } catch (_) {
      setDecideMsg("Could not record your decision.");
    } finally {
      setDecideBusy(false);
    }
  }, [pageId, reason, sigCode, onTransitioned, say, pendingApproval?.requestedByName]); // B3: the code is read at click time, not from the first render

  // WF-1: bring the open request up to the live version (the requester stays who they were).
  const doRerequest = useCallback(async () => {
    setRerequestBusy(true); setDecideMsg(null);
    try {
      const r = await invoke("rerequest-approval", { pageId });
      if (r?.success) { say(`Re-requested for v${r.pinnedVersion} — approvers decide on the current version now.`); await onTransitioned(); }
      else setDecideMsg(r?.reason || "Could not re-request this approval.");
    } catch (_) { setDecideMsg("Could not re-request this approval."); }
    finally { setRerequestBusy(false); }
  }, [pageId, onTransitioned, say]);

  // The menu behaviour (outside click / focus-out close, roving items, Arrow/Home/End, Escape
  // back to the chip) is the kit's: this was the original and now lives in kit/ActionMenu.jsx.
  const { onMenuKey, itemProps } = useActionMenu({ open: menuOpen, setOpen: setMenuOpen, count: available.length, triggerRef: btnRef, menuRef });

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
            {pendingApproval.stale && (
              <div className="wf-appr-stale" role="alert" data-testid="wf-appr-stale">
                This page changed after the request (reviewed v{pendingApproval.pinnedVersion}, now v{pendingApproval.liveVersion ?? "?"}). Approving will not move it.
                <button type="button" className="wf-appr-rerequest" onClick={doRerequest} disabled={rerequestBusy} data-testid="wf-appr-rerequest">
                  {rerequestBusy ? "Re-requesting…" : `Re-request for v${pendingApproval.liveVersion ?? "current"}`}
                </button>
              </div>
            )}
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
                        This space requires a signed decision. <a href="#" onClick={(e) => { e.preventDefault(); router.navigate(myWorkPath(window.__svCtx)); }}>Set up your signature on My work</a> first.
                      </div>
                    )}
                  </div>
                )}
                <div className="wf-appr-actions">
                  <button type="button" className="wf-appr-approve" onClick={() => doDecide("approved")} disabled={decideBusy || pendingApproval.stale || (pendingApproval.requireSignature && (!pendingApproval.signatureEnrolled || !sigCode.trim()))} title={pendingApproval.stale ? "The page changed after the request — re-request for the current version first." : undefined}>{pendingApproval.requireSignature ? "Sign & approve" : "Approve"}</button>
                  <button type="button" className="wf-appr-deny" onClick={() => doDecide("denied")} disabled={decideBusy || (pendingApproval.requireSignature && (!pendingApproval.signatureEnrolled || !sigCode.trim()))}>{pendingApproval.requireSignature ? "Sign & deny" : "Deny"}</button>
                </div>
              </div>
            ) : (
              <div className="wf-appr-note">{mine ? "You have already responded." : "Waiting on the approvers above."}</div>
            )}
            {decideMsg && <div className="wf-error" role="alert">{decideMsg}</div>}
          </div>
        ))}
        {notice && <span className={`wf-notice wf-notice-${notice.tone}`} role="status" data-testid="wf-notice">{notice.text}</span>}
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
      {notice && <span className={`wf-notice wf-notice-${notice.tone}`} role="status" data-testid="wf-notice">{notice.text}</span>}
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
              {...itemProps(i)}
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

// Bug 2.4 — visibility is decided ONCE per evaluation from one server answer (`ribbon-summary`)
// plus the workflow/alert/validation reads, and the decision is acted on with the bridge:
// hidden = view.close() (Confluence drops the banner row), shown = view.open(). A page with
// attachments but nothing sealed stays closed (owner's rule). Every branch logs "[ribbon]" so a
// production "it never shows" is settled from the console, not re-diagnosed.
const UNSUPPORTED_TYPES = new Set(["space", "database", "whiteboard", "folder", "embed", "attachment", "comment"]);
const hashKey = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const stateKeyOf = ({ summary, workflow, alerts, validationState }) => hashKey(JSON.stringify({
  a: summary?.sealedAttachments || 0, s: summary?.sectionSeals || 0, t: summary?.trashedSeals || 0,
  w: workflow?.state?.id || workflow?.state?.name || null, al: (alerts || []).map((x) => x.id).sort(), v: validationState || null,
  // 5.0: a new request, an approval, a grant, a different locked seal or a re-classification is a
  // NEW state — a dismissed "Locked" row comes back when the state changes (mockup §2 note).
  m: summary?.ribbonMode || null, l: summary?.classification?.level?.id || null, src: summary?.classification?.source || null,
  r: summary?.waitingOnMe?.requests || 0, ap: summary?.waitingOnMe?.approvals || 0,
  g: (summary?.waitingOnMe?.grantsActive || []).map((x) => x.id).sort(),
  lf: summary?.lockedFor ? [summary.lockedFor.kind, summary.lockedFor.id, summary.lockedFor.myRequest] : null,
}));
// The decision input, built ONCE from the same four reads the evaluation made.
const ribbonInput = ({ summary, workflow, alerts, validationState }) => ({
  mode: summary?.ribbonMode,
  classification: summary?.classification || { level: null, source: "none" },
  threshold: summary?.threshold || { rank: summary?.ribbonThresholdRank },
  waitingOnMe: summary?.waitingOnMe || { requests: 0, approvals: 0, grantsActive: [] },
  lockedFor: summary?.lockedFor || null,
  alerts: alerts || [],
  workflow: workflow || null,
  validation: validationState || null,
});
const dismissKey = (pageId, stateKey) => `sv-ribbon-dismissed:${pageId}:${stateKey}`;
const memoryDismissed = new Set(); // fallback when the sandbox denies sessionStorage
const isDismissed = (key) => { try { if (window.sessionStorage.getItem(key)) return true; } catch (_) { /* sandboxed */ } return memoryDismissed.has(key); };
const rememberDismissed = (key) => { memoryDismissed.add(key); try { window.sessionStorage.setItem(key, "1"); } catch (_) { /* sandboxed */ } };
const bridgeClose = () => { try { const r = view.close(); if (r && r.catch) r.catch((e) => console.info("[ribbon] view.close rejected", e?.message || e)); } catch (e) { console.info("[ribbon] view.close unavailable", e?.message || e); } };
const bridgeOpen = () => { try { const r = view.open?.(); if (r && r.catch) r.catch((e) => console.info("[ribbon] view.open rejected", e?.message || e)); } catch (e) { console.info("[ribbon] view.open unavailable", e?.message || e); } };

// One sentence per alert kind the server actually RECORDS (recordDispatch call sites, 2026-09-15):
// SEAL_CONFLICT (artifact-fetch.js, carries display names); edit-reverted / content-reverted /
// trash-restored / presentation-restored / seal-released (triggers.js sendViolationNotifications);
// section-reverted / section-restored; revert-failed; seal-auto-released; reservation-expired;
// periodic-reminder. The old chip only knew SEAL_CONFLICT and a SEAL_EXPIRED nothing writes, and
// read `artifactName` — a field no record carries (it is `attachmentName`) — so it opened empty (P1-7).
// The reader is the seal owner OR the editor (recent-dispatches is filtered to those two), so the
// phrasing is picked from which one is looking.
const alertSentence = (a, operatorId) => {
  const name = a.attachmentName || a.artifactName || "an attachment";
  const asEditor = !!operatorId && a.editorAccountId === operatorId && a.ownerAccountId !== operatorId;
  const days = Number.isFinite(Number(a.daysSealed)) ? Number(a.daysSealed) : null;
  switch (a.type) {
    case "SEAL_CONFLICT":
      return <><strong>{a.editorDisplayName || "Someone"}</strong> tried to modify <strong>{name}</strong>, which is sealed by <strong>{a.ownerDisplayName || "its owner"}</strong>. The change was reverted automatically.</>;
    case "edit-reverted":
      return asEditor ? <>Your change to <strong>{name}</strong> was reverted — the attachment is sealed by its owner.</> : <>A change to your sealed attachment <strong>{name}</strong> was reverted automatically.</>;
    case "content-reverted":
      return asEditor ? <>Your removal of <strong>{name}</strong> from the page was reverted — the attachment is sealed.</> : <><strong>{name}</strong> was removed from the page; the sealed content was put back.</>;
    case "trash-restored":
      return asEditor ? <>You moved <strong>{name}</strong> to the trash; it was restored because it is sealed.</> : <>Your sealed attachment <strong>{name}</strong> was moved to the trash and restored.</>;
    case "presentation-restored":
      return asEditor ? <>Your layout change to <strong>{name}</strong> was reverted — the attachment is sealed.</> : <>The layout of your sealed attachment <strong>{name}</strong> was changed and restored.</>;
    case "seal-released":
      return <><strong>{name}</strong> was permanently deleted; its seal was released.</>;
    case "section-reverted":
      return asEditor ? <>Your edit to the sealed section <strong>{name}</strong> was reverted.</> : <>An edit to your sealed section <strong>{name}</strong> was reverted automatically.</>;
    case "section-restored":
      return asEditor ? <>You removed the sealed section <strong>{name}</strong>; it was put back.</> : <>Your sealed section <strong>{name}</strong> was removed and put back.</>;
    case "workflow-reverted":
      return asEditor
        ? <>Your edit was reverted to {a.approvedVersion != null ? `approved v${a.approvedVersion}` : "the approved version"}.</>
        : <>An edit to this Approved page by {a.editorDisplayName || "someone outside the approvers"} was reverted to the approved version{a.approvedVersion != null ? ` (v${a.approvedVersion})` : ""}.</>;
    case "workflow-demoted":
      return asEditor
        ? <>Your edit moved this page back to <strong>{a.demotedToName || "Draft"}</strong>. Nothing was lost.</>
        : <>An edit to this Approved page by {a.editorDisplayName || "someone outside the approvers"} moved it back to <strong>{a.demotedToName || "Draft"}</strong> for a new review.</>;
    case "revert-failed":
      return <>Sentinel Vault could not restore <strong>{name}</strong> after a change — check its version history.</>;
    case "seal-auto-released":
      return <>The seal on <strong>{name}</strong> lapsed and was released automatically.</>;
    case "reservation-expired":
      return <>Your seal on <strong>{name}</strong> is overdue. Extend it or unseal it when you are done.</>;
    case "periodic-reminder":
      return <><strong>{name}</strong> has been sealed for {days !== null ? `${days} day${days === 1 ? "" : "s"}` : "a while"}. Still needed?</>;
    default:
      return <>Sentinel Vault recorded <strong>{String(a.type || "an event").replace(/[_-]+/g, " ")}</strong> on <strong>{name}</strong>.</>;
  }
};

// Test seam (mirrors the section surface's __svSectionStatusStub): a harness can stand in for
// the `ribbon-summary` answer — an object is returned as-is, a function is awaited, and
// `{ throw: true }` throws — because the resolver's failure branches (asApp() attachment
// listing 5xx, a thrown listing) cannot be provoked from a browser against a healthy tenant.
const readSummaryStub = () => {
  try { const s = window.__svRibbonSummaryStub; return s && (typeof s === "object" || typeof s === "function") ? s : null; } catch (_) { return null; }
};

const DocumentRibbon = () => {
  const [summary, setSummary] = useState(null); // ribbon-summary answer
  const [summaryError, setSummaryError] = useState(null); // reason string when the summary could not be read
  const [booting, setBooting] = useState(true); // true until the first visibility decision (skeleton row)
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(false);
  const [validationState, setValidationState] = useState(null); // "passed"|"failed"|"awaiting-approval"
  const [aiCount, setAiCount] = useState(null); // number of latest AI findings, or null
  const [workflow, setWorkflow] = useState(null); // { assigned, state, available, def } or null
  const [approvals, setApprovals] = useState(null); // { pending, toStateId, approvers, mode, ... } or null
  const [operatorId, setOperatorId] = useState(null);
  const [pageId, setPageId] = useState(null);
  const [spaceKey, setSpaceKey] = useState(null);
  const [siteUrl, setSiteUrl] = useState(null); // A6: version links must leave the iframe to the site
  const [dialogHost, setDialogHost] = useState(null); // in-flow row every popover renders into
  const pageIdRef = useRef(null); // the content id the current evaluation belongs to
  const openStateRef = useRef(null); // true after view.open(), false after view.close(), null = untouched
  const evalSeq = useRef(0);
  const evaluateRef = useRef(null); // the current `evaluate`, for the guard's deferred re-run

  // Apply a decision to the bridge exactly when it changes.
  const applyVisibility = useCallback((show, why) => {
    setVisible(show);
    if (openStateRef.current === show) return;
    openStateRef.current = show;
    console.info("[ribbon]", show ? "OPEN" : "CLOSE", why);
    if (show) bridgeOpen(); else bridgeClose();
  }, []);

  const reloadWorkflow = useCallback(async () => {
    const id = pageIdRef.current;
    if (!id) return;
    try {
      const res = await invoke("get-page-workflow", { pageId: id, spaceKey });
      setWorkflow(res?.assigned ? res : null);
    } catch (_) {
      setWorkflow(null);
    }
    try {
      const appr = await invoke("get-page-approvals", { pageId: id, spaceKey });
      setApprovals(appr?.pending ? appr : null);
    } catch (_) {
      setApprovals(null);
    }
  }, [spaceKey]);

  // WF-4 (UX critique 2026-09-19): a decision or transition changes MORE than the workflow — the
  // `ribbon-summary` waitingOnMe.approvals count drives the "Waiting for you" pill, and the alerts
  // and validation state can move too. reloadWorkflow refreshed only workflow + approvals, so the
  // pill contradicted the chip after every decision. Re-run the whole evaluation (same seq guard,
  // same show rule); the workflow refresh first keeps the chip instant.
  const afterWorkflowChange = useCallback(async () => {
    await reloadWorkflow();
    await evaluateRef.current?.("workflow changed");
  }, [reloadWorkflow]);

  // Returns { res, error }: `error` is set when the summary THREW or answered ok:false with a
  // reason that is not the confirmed "nothing to show". Only a confirmed nothing may close the
  // banner (P1-7); everything else is an error row with Retry.
  const fetchSummary = useCallback(async (id) => {
    try {
      const stub = readSummaryStub();
      let res;
      if (stub) {
        res = typeof stub === "function" ? await stub() : stub;
        if (res && res.throw) throw new Error("stubbed ribbon-summary failure");
      } else {
        res = await invoke("ribbon-summary", { pageId: id });
      }
      console.info("[ribbon] summary", res);
      const failed = !res || typeof res !== "object" || (res.ok !== true && res.reason !== "none");
      setSummary(failed ? null : res);
      return failed ? { res: null, error: res?.reason || "no-summary" } : { res, error: null };
    } catch (err) {
      console.error("[ribbon] ribbon-summary failed:", err);
      setSummary(null);
      return { res: null, error: err?.message || "threw" };
    }
  }, []);

  const fetchAlerts = useCallback(async (id, operator) => {
    try {
      const result = await invoke("recent-dispatches", { pageId: id });
      const relevant = result?.success && result.notifications?.length > 0
        ? result.notifications.filter((n) => n.ownerAccountId === operator || n.editorAccountId === operator)
        : [];
      setAlerts(relevant);
      return relevant;
    } catch (err) {
      console.error("[ribbon] recent-dispatches failed:", err);
      setAlerts([]);
      return [];
    }
  }, []);

  // The whole evaluation, for the content the bridge context names RIGHT NOW. Re-run on SPA
  // navigation, on focus/visibility when the content id changed, and on a seal-stamp change.
  const evaluate = useCallback(async (why) => {
    const seq = ++evalSeq.current;
    const stale = () => seq !== evalSeq.current;
    try {
      const context = await view.getContext();
      window.__svCtx = context; // the My work link needs environmentId (kit/my-work-path.js)
      const ctxPageId = context?.extension?.content?.id || context?.contentId || null;
      const ctxSpaceKey = context?.extension?.content?.space?.key || context?.extension?.space?.key || null;
      const contentType = context?.extension?.content?.type || null;
      const operator = context?.accountId || null;
      console.info("[ribbon] evaluate", why, { pageId: ctxPageId, contentType, location: context?.extension?.location || null });

      // Only the content-type check remains: any page-like content the context reports is
      // supported (page, blogpost, and Live Docs whatever type string they carry). The old
      // location.includes("/apps/") heuristic hid the banner on real pages whose location
      // happened to contain it.
      if (!ctxPageId || (contentType && UNSUPPORTED_TYPES.has(String(contentType).toLowerCase()))) {
        if (stale()) return;
        pageIdRef.current = null;
        setPageId(null);
        setLoading(false);
        setSummaryError(null);
        applyVisibility(false, !ctxPageId ? "no content id in context" : `unsupported content type ${contentType}`);
        return;
      }
      if (pageIdRef.current !== ctxPageId) {
        setLoading(true);
        setWorkflow(null); setApprovals(null); setValidationState(null); setAiCount(null); setAlerts([]); setSummary(null); setSummaryError(null);
      }
      pageIdRef.current = ctxPageId;
      setPageId(ctxPageId);
      setSpaceKey(ctxSpaceKey);
      setOperatorId(operator);
      setSiteUrl(context?.siteUrl || null);

      const [sumRes, wf, appr, al, vs, ai] = await Promise.all([
        fetchSummary(ctxPageId),
        invoke("get-page-workflow", { pageId: ctxPageId, spaceKey: ctxSpaceKey }).catch(() => null),
        invoke("get-page-approvals", { pageId: ctxPageId, spaceKey: ctxSpaceKey }).catch(() => null),
        operator ? fetchAlerts(ctxPageId, operator) : Promise.resolve([]),
        invoke("get-validation-state", { pageId: ctxPageId }).catch(() => null),
        invoke("get-ai-findings", { pageId: ctxPageId }).catch(() => null),
      ]);
      if (stale()) return;
      const sum = sumRes?.res || null;
      const wfVal = wf?.assigned ? wf : null;
      const vsVal = vs?.state?.state || null;
      setWorkflow(wfVal);
      setApprovals(appr?.pending ? appr : null);
      setValidationState(vsVal);
      setAiCount(ai?.findings?.findings ? ai.findings.findings.length : null);

      // Early guard (2026-09-17): on a page that carries seals, have the server judge the live
      // version NOW instead of waiting for a page event that can be 20+ minutes late. If that run
      // restored something, evaluate again so the "Restored" row appears for the person who just
      // published. Never from the re-evaluation itself (no loop); fire-and-forget otherwise.
      // Every page, not only sealed ones: validation rules and enforced workflow states ride the
      // same pipeline and were waiting on the same late event (2026-09-19). A page with nothing
      // to judge exits in one KVS read.
      if (why !== "guard restored" && sum) {
        invoke("guard-page-now", {})
          .then((g) => { if (g?.restored && pageIdRef.current === ctxPageId) evaluateRef.current?.("guard restored"); })
          .catch((e) => console.info("[ribbon] guard-page-now failed", e?.message || e));
      }

      if (sumRes?.error) {
        // Not a confirmed "nothing to show": say so in the row instead of vanishing (P1-7).
        setSummaryError(sumRes.error);
        console.info("[ribbon] decision", `error row (summary: ${sumRes.error})`);
        applyVisibility(true, `summary failed: ${sumRes.error}`);
        return;
      }
      setSummaryError(null);

      // 5.0 (mockup §2/§3): the pure show rule decides; the row shows what the rule saw.
      const decision = decideRibbon(ribbonInput({ summary: sum, workflow: wfVal, alerts: al, validationState: vsVal }));
      const show = decision.show;
      const key = dismissKey(ctxPageId, stateKeyOf({ summary: sum, workflow: wfVal, alerts: al, validationState: vsVal }));
      // An explicit Retry (the error row's button) is a request to see the result — it overrides
      // a dismissal of that same state made earlier in the session; every other evaluation honours it.
      const dismissed = show && why !== "retry" && isDismissed(key);
      const branch = !show
        ? `nothing to show (mode=${decision.mode} level=${sum?.classification?.level?.id || "-"} sealedAttachments=${sum?.sealedAttachments || 0} sectionSeals=${sum?.sectionSeals || 0} reason=${sum?.reason || "no-summary"})`
        : dismissed ? `dismissed for this state (${key})`
          : `show: ${decision.reasons.join("+")} (mode=${decision.mode} level=${sum?.classification?.level?.id || "-"} urgent=${decision.urgent?.kind || "-"} workflow=${!!wfVal} alerts=${al.length} validation=${vsVal || "-"})`;
      console.info("[ribbon] decision", branch);
      applyVisibility(show && !dismissed, branch);
    } catch (err) {
      console.error("[ribbon] evaluate error:", err);
      if (!stale()) {
        setSummaryError(err?.message || "evaluate threw");
        applyVisibility(true, `evaluate threw: ${err?.message || err}`);
      }
    } finally {
      if (!stale()) { setLoading(false); setBooting(false); }
    }
  }, [applyVisibility, fetchSummary, fetchAlerts]);
  evaluateRef.current = evaluate;

  useEffect(() => {
    let disposed = false;
    let unlisten = null;
    (async () => {
      try { await enablePaletteSync(); } catch (_) { /* palette is cosmetic */ }
      if (disposed) return;
      await evaluate("init");
      // SPA navigation: the bridge history (where the module supports it) …
      try {
        const history = await view.createHistory();
        if (history?.listen) unlisten = history.listen(() => evaluate("history"));
      } catch (e) {
        console.info("[ribbon] createHistory unavailable:", e?.message || e);
      }
    })();
    // … plus focus/visibility: re-read the context and re-evaluate when the content id moved.
    const recheck = async (why) => {
      if (document.visibilityState === "hidden") return;
      try {
        const ctx = await view.getContext();
        const id = ctx?.extension?.content?.id || ctx?.contentId || null;
        if (id !== pageIdRef.current) evaluate(`${why}: content ${pageIdRef.current} → ${id}`);
      } catch (_) { /* no bridge */ }
    };
    const onVis = () => recheck("visibilitychange");
    const onFocus = () => recheck("focus");
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      try { unlisten?.(); } catch (_) { /* none */ }
    };
  }, [evaluate]);

  // Poll for seal changes made in other surfaces (inline panel, overlay) AND for a content id
  // change the bridge history did not report — regardless of what the page currently shows.
  useEffect(() => {
    let lastStamp = null;
    const poll = async () => {
      try {
        const { stamp } = await invoke("check-seal-stamp");
        if (lastStamp !== null && stamp !== lastStamp) evaluate("seal stamp changed");
        lastStamp = stamp;
      } catch (e) {
        // Polling failures are non-critical
      }
      try {
        const ctx = await view.getContext();
        const id = ctx?.extension?.content?.id || ctx?.contentId || null;
        if (id !== pageIdRef.current) evaluate(`poll: content ${pageIdRef.current} → ${id}`);
      } catch (_) { /* no bridge */ }
    };
    const interval = setInterval(poll, 5000);
    poll();
    return () => clearInterval(interval);
  }, [evaluate]);

  // "Open" → the page-details modal (mockup §4), the SAME resource the byline chip renders. The
  // resource picks its mode from the module that opened it (renderForModule: only a *seal-action*
  // key renders mode "seal"), so opened from the banner it renders the details hub, and it reads
  // the page id from the banner's own context (extension.content.id). The old "Manage Attachments"
  // overlay is the modal's Attachments tab now.
  const openDetails = useCallback(() => {
    const modal = new Modal({ resource: "page-details-ui", size: "large", onClose: () => { evaluate("details closed"); } });
    modal.open();
  }, [evaluate]);

  const dismissAlert = useCallback(async (alertId) => {
    try {
      await invoke("acknowledge-dispatch", { dispatchId: alertId });
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    } catch (err) {
      console.error("Failed to dismiss alert:", err);
    }
  }, []);

  const dismissRibbon = useCallback(() => {
    const key = dismissKey(pageIdRef.current, stateKeyOf({ summary, workflow, alerts, validationState }));
    rememberDismissed(key);
    applyVisibility(false, `dismissed by the viewer (${key})`);
    // The "Restored" row IS the alert (there is no alert popover any more): dismissing it
    // acknowledges the dispatch it showed, so the same reverted edit does not come back tomorrow.
    if (alerts.length > 0) dismissAlert(alerts[0].id);
  }, [summary, workflow, alerts, validationState, applyVisibility, dismissAlert]);

  // Journey 2 — "Request edit" on a seal the viewer does not own: an inline reason field in the
  // row (no popover, no native prompt), then request-edit-access / request-section-edit.
  const [asking, setAsking] = useState(false);
  const [askReason, setAskReason] = useState("");
  const [askBusy, setAskBusy] = useState(false);
  const [askError, setAskError] = useState(null);
  const askRef = useRef(null);
  useEffect(() => { if (asking) requestAnimationFrame(() => askRef.current?.focus()); else { setAskReason(""); setAskError(null); } }, [asking]);
  const sendRequest = useCallback(async () => {
    const seal = summary?.lockedFor;
    if (!seal) return;
    setAskBusy(true); setAskError(null);
    try {
      const r = seal.kind === "section"
        ? await invoke("request-section-edit", { sectionId: seal.id, reason: askReason })
        : await invoke("request-edit-access", { attachmentId: seal.id, reason: askReason });
      if (r?.success) { setAsking(false); await evaluate("edit request sent"); }
      else setAskError(r?.reason || "Could not send the request.");
    } catch (_) { setAskError("Could not send the request."); }
    finally { setAskBusy(false); }
  }, [summary, askReason, evaluate]);

  // First paint (P1-7): until the first decision, a 40px skeleton row — never text that then
  // flips or vanishes. The host shows the banner slot before view.open()/close() has been called.
  if (booting && !visible) {
    return (
      <div className="ribbon-bar ribbon-bar--skeleton" data-testid="ribbon-skeleton" aria-busy="true" aria-label="Sentinel Vault is checking this page">
        <span className="ribbon-skel ribbon-skel-icon" /><span className="ribbon-skel ribbon-skel-title" /><span className="ribbon-skel ribbon-skel-text" /><span className="ribbon-skel ribbon-skel-btn" />
      </div>
    );
  }
  if (!visible) return null;

  // Error row (P1-7): the summary threw or refused — one row, same height, with Retry.
  if (summaryError) {
    return (
      <div className="ribbon-bar ribbon-bar--error" data-testid="ribbon-bar" data-state="error">
        <div className="ribbon-icon ribbon-icon--error">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M12 8v5M12 16h.01" />
          </svg>
        </div>
        <span className="ribbon-title">Sentinel Vault</span>
        <span className="ribbon-status ribbon-status--error" role="alert" data-testid="ribbon-error" title={`ribbon-summary: ${summaryError}`}>
          Sentinel Vault could not check this page
        </span>
        <button type="button" className="ribbon-action ribbon-retry" onClick={() => { setLoading(true); evaluate("retry"); }} disabled={loading} data-testid="ribbon-retry">
          {loading ? "Checking…" : "Retry"}
        </button>
        <button type="button" className="ribbon-dismiss" onClick={dismissRibbon} aria-label="Dismiss" title="Dismiss" data-testid="ribbon-dismiss">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    );
  }

  const decision = decideRibbon(ribbonInput({ summary, workflow, alerts, validationState }));
  const level = decision.classification?.level || null;
  const source = decision.classification?.source || "none";
  // CLS-1: classification off → the left block is the app's name, never a level or "Unclassified".
  const classificationOff = decision.classification?.enabled === false;
  const hasSeal = (summary?.sealedAttachments || 0) > 0 || (summary?.sectionSeals || 0) > 0 || (summary?.trashedSeals || 0) > 0;
  const urgent = decision.urgent;
  const lockedSeal = summary?.lockedFor || null;
  const sourceText = source === "page" ? "set on this page" : source === "space" ? "space default" : null;
  const untilOf = (iso) => untilLabel(iso);

  // ONE state pill + ONE sentence, by the urgent kind (mockup §2). `pill` is null when nothing is
  // urgent: in "always" the right half is then EMPTY (mockup §3 decision); in "exceptions" the row
  // is open because the level met the threshold, and the level's own description is the sentence.
  let pill = null;
  let sentence = null;
  switch (urgent?.kind) {
    case "restored":
      // WF-2: a demote destroys nothing — "Restored" would claim it did.
      pill = { tone: "alert", text: urgent.alert?.type === "workflow-demoted" ? "Moved back" : "Restored", n: urgent.count > 1 ? urgent.count : null };
      sentence = alertSentence(urgent.alert, operatorId);
      // The editor's lost text is one click away: the page version the app reverted.
      if (urgent.alert?.revertedVersion && urgent.alert.editorAccountId === operatorId && urgent.alert.ownerAccountId !== operatorId && pageId) {
        const v = urgent.alert.revertedVersion;
        sentence = <>{sentence} <button type="button" className="ribbon-inline-link" data-testid="ribbon-my-version" onClick={() => router.navigate(`/wiki/pages/viewpage.action?pageId=${pageId}&pageVersion=${v}`)}>See my version (v{v})</button></>;
      }
      break;
    case "waiting-for-you": {
      const r = urgent.requests, a = urgent.approvals;
      pill = { tone: "wait", text: "Waiting for you", n: urgent.count };
      const parts = [];
      if (r) parts.push(`${r} edit request${r === 1 ? "" : "s"} on your sealed content on this page`);
      if (a) parts.push(`${a} approval${a === 1 ? "" : "s"} waiting for your decision`);
      sentence = <>{parts.join(" · ")}</>;
      break;
    }
    case "edit-now":
      pill = { tone: "ok", text: "Edit now" };
      sentence = <>Your request on <b>{urgent.grant.name}</b> was approved — you can edit{urgent.grant.until ? <> until <b>{untilOf(urgent.grant.until)}</b></> : null}</>;
      break;
    case "waiting-for-owner":
      pill = { tone: "wait", text: `Waiting for ${urgent.seal.owner}` };
      sentence = <>Your edit request on <b>{urgent.seal.name}</b> was sent</>;
      break;
    case "locked":
      pill = { tone: "lock", text: "Locked" };
      sentence = <><b>{urgent.seal.name}</b> is sealed by <b>{urgent.seal.owner}</b>{urgent.seal.until ? <> until <b>{untilOf(urgent.seal.until)}</b></> : <> with no expiry</>}</>;
      break;
    default:
      sentence = decision.mode === "exceptions" && decision.overThreshold && level?.description ? <>{level.description}</> : null;
  }
  const canRequest = urgent?.kind === "locked" && !!lockedSeal;
  const levelColor = level?.color || null;
  const glyph = hasSeal
    ? <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
    : <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" aria-hidden="true"><circle cx="12" cy="12" r="8" /></svg>;

  return (
    <div>
      {/* Main ribbon bar — ONE row, 44px inside the 48px cap (mockup decision 2) */}
      <div className="ribbon-bar" data-testid="ribbon-bar" data-state={urgent?.kind || "none"} data-mode={decision.mode} data-level={classificationOff ? "off" : level?.id || "none"} data-source={source}>
        {classificationOff ? (
          <div className="rb-class rb-class--brand" data-testid="ribbon-brand" title="Sentinel Vault">
            <span className="rb-glyph" data-glyph={hasSeal ? "lock" : "dot"}>{glyph}</span>
            <span className="rb-lvname">Sentinel Vault</span>
          </div>
        ) : (
          <div className={`rb-class${level ? "" : " rb-class--none"}`} style={levelColor ? { background: levelColor } : undefined} data-testid="ribbon-class" title={level ? `${level.name}${sourceText ? ` · ${sourceText}` : ""}` : "This page has no classification"}>
            <span className="rb-glyph" data-glyph={hasSeal ? "lock" : "dot"}>{glyph}</span>
            <span className="rb-lvname" data-testid="ribbon-level">{level ? level.name : "Unclassified"}</span>
            {level && sourceText && <span className="rb-lvsrc" data-testid="ribbon-source">· {sourceText}</span>}
          </div>
        )}

        <div className={`rb-body${pill || sentence || workflow || validationState ? "" : " rb-body--empty"}`} data-testid="ribbon-body">
          {loading && <span className="ribbon-loading-bar" />}
          {!loading && pill && (
            <span className={`rb-state rb-state--${pill.tone}`} data-testid="ribbon-pill">
              {pill.n != null && <span className="rb-state-n">{pill.n}</span>}{pill.text}
            </span>
          )}
          {!loading && asking && canRequest ? (
            <span className="rb-ask" data-testid="ribbon-ask">
              <input
                ref={askRef}
                className="rb-ask-input"
                value={askReason}
                maxLength={300}
                placeholder={`Why do you need to edit ${lockedSeal.name}?`}
                onChange={(e) => setAskReason(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") sendRequest(); if (e.key === "Escape") setAsking(false); }}
                aria-label="Reason for your edit request"
                data-testid="ribbon-ask-reason"
              />
              <button type="button" className="rb-btn rb-btn--primary" onClick={sendRequest} disabled={askBusy} data-testid="ribbon-ask-send">{askBusy ? "Sending…" : "Send"}</button>
              <button type="button" className="rb-btn rb-btn--quiet" onClick={() => setAsking(false)} disabled={askBusy}>Cancel</button>
              {askError && <span className="rb-msg rb-msg--error" role="alert" data-testid="ribbon-ask-error">{askError}</span>}
            </span>
          ) : (
            !loading && sentence && <span className="rb-msg" data-testid="ribbon-status">{sentence}</span>
          )}

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
              onTransitioned={afterWorkflowChange}
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
        </div>

        <div className="rb-actions">
          {canRequest && !asking && (
            <button type="button" className="rb-btn rb-btn--quiet" onClick={() => setAsking(true)} data-testid="ribbon-request-edit">Request edit</button>
          )}
          <button type="button" className="rb-btn rb-btn--primary" onClick={openDetails} data-testid="ribbon-open">Open</button>
          <button type="button" className="ribbon-dismiss" onClick={dismissRibbon} aria-label="Dismiss" title="Dismiss" data-testid="ribbon-dismiss">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </div>

      {/* In-flow host for the workflow popovers — see inHost(). Empty (and display:none) when
          nothing is open so the banner reserves no space. */}
      <div className="wf-dialog-host" ref={setDialogHost} data-testid="wf-dialog-host" />
    </div>
  );
};

// Mount
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<DocumentRibbon />);
}
