import React, { useRef, useState } from "react";
import Dialog from "./Dialog";

/**
 * Declining an edit request asks the decider for an OPTIONAL reason, which reaches the requester
 * on their row ("Declined · ask again … · {owner} said: …"). The server has taken `reason` since
 * SEC-8; only the page-details modal ever asked for it — the panel, the overlay, My work and the
 * space console declined without a word (tester 2026-09-25).
 *
 * `askDeclineReason(name)` resolves { ok: true, reason } on Decline, { ok: false } on Cancel.
 * Render `declineDialog` once in the component.
 */
export const DECLINE_REASON_MAX = 300; // the server clips at the same length

export function useDeclineReason() {
  const [ask, setAsk] = useState(null); // { who, resolve }
  const askDeclineReason = (who) => new Promise((resolve) => setAsk({ who: who || "them", resolve }));
  const close = (answer) => { if (ask) ask.resolve(answer); setAsk(null); };
  const declineDialog = ask ? <DeclineDialog who={ask.who} onConfirm={(reason) => close({ ok: true, reason })} onCancel={() => close({ ok: false })} /> : null;
  return { askDeclineReason, declineDialog };
}

function DeclineDialog({ who, onConfirm, onCancel }) {
  const [text, setText] = useState("");
  const inputRef = useRef(null);
  return (
    <Dialog title={`Decline ${who}'s request?`} onClose={onCancel} testId="sv-decline" initialFocus="first">
      <div className="sv-dialog-body">
        <label className="sv-decline-label" htmlFor="sv-decline-reason">Tell {who} why (optional)</label>
        <textarea
          id="sv-decline-reason"
          ref={inputRef}
          className="sv-decline-reason"
          rows={3}
          maxLength={DECLINE_REASON_MAX}
          value={text}
          placeholder="e.g. Not during the release freeze — ask again on Monday"
          onChange={(e) => setText(e.target.value)}
          data-testid="sv-decline-reason"
        />
        <span className="sv-decline-hint">{who} sees this next to the decline.</span>
      </div>
      <div className="sv-dialog-actions">
        <button type="button" className="action-btn confirm-no" onClick={onCancel} data-testid="sv-decline-no">Cancel</button>
        <button type="button" className="action-btn confirm-yes" onClick={() => onConfirm(text.trim() || undefined)} data-testid="sv-decline-yes">Decline</button>
      </div>
    </Dialog>
  );
}
