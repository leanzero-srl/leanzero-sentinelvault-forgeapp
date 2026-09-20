/*
 * The row pieces every seal card shares (inline panel, overlay): the primary-slot renderer for
 * a row-state primary, the typed-reason bar, the owner's request inbox, the error row and the
 * "Link copied" note. One markup for one rule — the review's finding was two cards that
 * disagreed about Release; the fix is that neither card draws these itself.
 */
import React from "react";
import { when } from "./seal-row.js";
import { stateText } from "./status-language.js"; // SEC-3: one vocabulary for the state spans

/** The row's inline error (replaces the native alert; every refused action lands here). */
export const ErrorRow = ({ message, onDismiss, testId = "sv-card-error" }) => (message ? (
  <div className="card-row card-action-error" role="alert" data-testid={testId}>
    <span className="card-action-error-text">{message}</span>
    <button type="button" className="card-action-error-dismiss" onClick={onDismiss} aria-label="Dismiss" title="Dismiss">×</button>
  </div>
) : null);

export const CopiedNote = ({ shown }) => (shown ? <div className="card-row card-copied" role="status">Link copied</div> : null);

const Busy = ({ busy, idle, doing }) => (busy ? <>{doing}<span className="btn-busy-bar" /></> : idle);

/**
 * Renders the primary slot for a row-state `primary` (plus the two Attachments-view states,
 * restore / purge). `on` maps a primary kind to its handler; `busy` is the busy key in flight;
 * `name` names the file or section for the accessible labels.
 */
export const PrimarySlot = ({ primary, name, busy, reqBusy, on, kind = "attachment" }) => {
  if (!primary) return null;
  const other = (key) => !!busy && busy !== key;
  const b = (key) => busy === key;
  switch (primary.kind) {
    case "seal":
      return <button type="button" className={`action-btn lock ${b("seal") ? "is-busy" : ""}`} onClick={on.seal} disabled={other("seal")} title="Seal this attachment so only you can change it" data-primary="seal"><Busy busy={b("seal")} idle="Seal" doing="Sealing" /></button>;
    case "release":
      // SEC-10: your own Release is the quiet style; only a forced release (someone else's expired
      // seal, typed reason) keeps the red.
      return <button type="button" className={`action-btn ${primary.forced ? "unlock" : "release"} ${b("unseal") ? "is-busy" : ""}`} onClick={on.release} disabled={other("unseal")} title={primary.forced ? "Release an expired seal you do not own — a reason is required" : `Release your seal so others can change this ${kind}`} data-primary="release"><Busy busy={b("unseal")} idle="Release" doing="Releasing" /></button>;
    case "decide": {
      const rq = primary.request || {};
      const who = rq.requesterName || "the requester";
      const ap = reqBusy === `${rq.requesterAccountId}:approve`, de = reqBusy === `${rq.requesterAccountId}:deny`;
      return (
        <>
          <button type="button" className={`action-btn lock ${ap ? "is-busy" : ""}`} disabled={!!reqBusy} onClick={() => on.decide(rq.requesterAccountId, "approve")} aria-label={`Approve ${who} editing ${name}`} data-primary="approve"><Busy busy={ap} idle="Approve" doing="Approving" /></button>
          <button type="button" className={`action-btn unlock ${de ? "is-busy" : ""}`} disabled={!!reqBusy} onClick={() => on.decide(rq.requesterAccountId, "deny")} aria-label={`Decline ${who} editing ${name}`} data-action="decline"><Busy busy={de} idle="Decline" doing="Declining" /></button>
        </>
      );
    }
    case "request":
      return <button type="button" className={`action-btn editreq ${b("editreq") ? "is-busy" : ""}`} onClick={on.request} disabled={other("editreq") || primary.disabled} title={primary.hint || `Ask the seal owner for permission to edit this ${kind}`} data-primary="request"><Busy busy={b("editreq")} idle="Request edit" doing="Requesting" /></button>;
    case "propose": // SEC-2 (e): the workflow-held row asks the approvers, not the owner
      return <button type="button" className={`action-btn editreq ${b("editreq") ? "is-busy" : ""}`} onClick={on.propose} disabled={other("editreq")} title={primary.hint || "Ask this page's approvers for the change"} data-primary="propose"><Busy busy={b("editreq")} idle="Propose a change" doing="Proposing" /></button>;
    case "waiting":
      return <span className="sv-state wait" role="status" data-primary="waiting" aria-label={`Waiting for ${primary.owner || "the owner"} to answer your edit request`}>{stateText(primary)}</span>;
    case "editnow":
      return <span className="sv-state ok" role="status" data-primary="editnow" aria-label={`You can edit ${name} now${primary.until ? `, until ${when(primary.until)}` : ""}`}>{stateText(primary)}</span>;
    case "declined": // SEC-8: the declined state is visible, with the time it can be asked again
      return <span className="sv-state declined" role="status" data-primary="declined" title={[primary.reason ? `Reason: “${primary.reason}”` : null, primary.hint].filter(Boolean).join(" ")} aria-label={`Your request to edit ${name} was declined${primary.retryAt ? `; you can ask again ${when(primary.retryAt)}` : ""}`}>{stateText(primary)}</span>;
    case "expired":
      return <span className="sv-state expired" role="status" data-primary="expired" aria-label={`The seal on ${name} has expired`}>{stateText(primary)}</span>;
    case "held": // SEC-2: the workflow owns the seal while the page is Approved
      return <span className="sv-state held" role="status" data-primary="held" title={primary.hint || ""} aria-label={`${name}: ${primary.label}`}>{primary.label}</span>;
    case "restore":
      return <button type="button" className={`action-btn restore ${b("restore") ? "is-busy" : ""}`} onClick={on.restore} disabled={other("restore")} title="Restore this trashed attachment back to the page" data-primary="restore"><Busy busy={b("restore")} idle="Restore" doing="Restoring" /></button>;
    case "purge":
      return <button type="button" className={`action-btn purge ${b("purge") ? "is-busy" : ""}`} onClick={on.purge} disabled={other("purge")} title="The file is gone; remove the seal record" data-primary="purge"><Busy busy={b("purge")} idle="Remove record" doing="Removing" /></button>;
    case "trashed":
      return <span className="sv-state trashed" role="status" data-primary="trashed">In the trash</span>;
    case "missing":
      return <span className="sv-state trashed" role="status" data-primary="missing">Missing</span>;
    default:
      return null;
  }
};

/**
 * The typed-reason bar. `mode` "request" (optional reason) or "force" (required, 3–300 chars —
 * the server rule in shared/release-reason.js). Enter submits, Escape cancels.
 */
export const ReasonBar = ({ mode, kind = "attachment", value, onChange, onSubmit, onCancel, busy, testId = "sv-reason-bar" }) => {
  const force = mode === "force";
  const propose = mode === "propose"; // SEC-2 (e): the reason is prefilled; the button says Propose
  const ready = !force || value.trim().length >= 3;
  return (
    <div className="card-row card-reason-bar" data-testid={testId}>
      <input
        type="text"
        className="card-reason-input"
        placeholder={force ? "Why are you releasing a seal you do not own? (required, 3–300 characters)" : propose ? "What would you change? (optional)" : `Why do you need to edit this ${kind}? (optional)`}
        aria-label={force ? "Reason for the forced release" : propose ? "The proposed change" : "Reason for the edit request"}
        value={value}
        maxLength={300}
        autoFocus
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && ready && !busy) onSubmit(); if (e.key === "Escape") onCancel(); }}
      />
      <span className="confirm-actions">
        {force
          ? <button type="button" className={`action-btn unlock ${busy ? "is-busy" : ""}`} onClick={onSubmit} disabled={busy || !ready} data-testid={`${testId}-confirm`}><Busy busy={busy} idle="Force release" doing="Releasing" /></button>
          : <button type="button" className={`action-btn editreq ${busy ? "is-busy" : ""}`} onClick={onSubmit} disabled={busy} data-testid={`${testId}-confirm`}><Busy busy={busy} idle={propose ? "Propose" : "Send request"} doing={propose ? "Proposing" : "Sending"} /></button>}
        <button type="button" className="action-btn confirm-no" onClick={onCancel} disabled={busy}>Cancel</button>
      </span>
    </div>
  );
};

/**
 * The owner's inbox. When the row's primary is Approve/Decline for the FIRST request, that row
 * only names the requester (the buttons sit in the primary slot); later requests decide here.
 */
export const RequestInbox = ({ requests, name, reqBusy, onDecide, firstDecidedAbove, testId = "sv-editreq-inbox" }) => {
  if (!requests || requests.length === 0) return null;
  return (
    <div className="card-row card-editreq-inbox" data-testid={testId}>
      <span className="card-editreq-title">Edit requests ({requests.length})</span>
      {requests.map((r, i) => {
        const who = r.requesterName || "Unknown user";
        const above = firstDecidedAbove && i === 0;
        const ap = reqBusy === `${r.requesterAccountId}:approve`, de = reqBusy === `${r.requesterAccountId}:deny`;
        return (
          <div key={r.requesterAccountId} className="card-editreq-row">
            <span className="card-editreq-who">{who}{r.reason ? <em className="card-editreq-reason"> — “{r.reason}”</em> : null}{above ? <span className="card-editreq-hint"> — answer with Approve / Decline above</span> : null}</span>
            {!above && (
              <span className="confirm-actions">
                <button type="button" className={`action-btn lock ${ap ? "is-busy" : ""}`} disabled={!!reqBusy} onClick={() => onDecide(r.requesterAccountId, "approve")} aria-label={`Approve ${who} editing ${name}`}><Busy busy={ap} idle="Approve" doing="Approving" /></button>
                <button type="button" className={`action-btn unlock ${de ? "is-busy" : ""}`} disabled={!!reqBusy} onClick={() => onDecide(r.requesterAccountId, "deny")} aria-label={`Decline ${who} editing ${name}`}><Busy busy={de} idle="Decline" doing="Declining" /></button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};

/** The owner's active grants, each revocable in place (audit D5). */
export const GrantInbox = ({ grants, name, grantBusy, onRevoke, testId = "sv-grants-inbox" }) => {
  if (!grants || grants.length === 0) return null;
  return (
    <div className="card-row card-editreq-inbox" data-testid={testId}>
      <span className="card-editreq-title">Editors with access ({grants.length})</span>
      {grants.map((g) => {
        const who = g.editorName || "Unknown user";
        return (
          <div key={g.editorAccountId} className="card-editreq-row">
            <span className="card-editreq-who">{who}{g.grantedAt ? <em className="card-editreq-reason"> — since {new Date(g.grantedAt).toLocaleDateString()}</em> : null}</span>
            <span className="confirm-actions">
              <button type="button" className={`action-btn unlock ${grantBusy === g.editorAccountId ? "is-busy" : ""}`} disabled={grantBusy === g.editorAccountId} onClick={() => onRevoke(g.editorAccountId)} aria-label={`Revoke ${who}'s access to ${name}`}><Busy busy={grantBusy === g.editorAccountId} idle="Revoke" doing="Revoking" /></button>
            </span>
          </div>
        );
      })}
    </div>
  );
};
