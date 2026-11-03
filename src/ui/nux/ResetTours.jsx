/*
 * "Show all tours again": gives this person every Elzi tour back. A small link beside the tour button in the console
 * headers; it asks first in the app's own dialog (never a native confirm), then clears the stored marks, this tab's
 * and this browser's "already shown" notes and the in-memory marks, so the page tour and every tab's mini-tour open
 * by themselves on the next visit and the header buttons read "Take the tour" again.
 */
import React, { useState } from "react";
import Dialog from "../kit/Dialog.jsx";
import { invoke } from "../kit/bridge.js";
import { resetMarks } from "./marks.js";
import { resetAllTours } from "./reset-tours.js";

export default function ResetTours({ className = "sv-link", testId = "nux-reset-btn" }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);
  const go = async () => {
    setBusy(true); setFailed(false);
    const r = await resetAllTours({ call: invoke, forget: resetMarks });
    setBusy(false);
    if (r.ok) { setOpen(false); setDone(true); } else setFailed(true);
  };
  return (
    <>
      <button type="button" className={className} data-testid={testId} data-nux="tours-reset" onClick={() => { setDone(false); setFailed(false); setOpen(true); }}>Show all tours again</button>
      <span role="status" className="sv-visually-hidden" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{done ? "Every tour will show again." : ""}</span>
      {open && (
        <Dialog title="Show all tours again?" onClose={() => { if (!busy) setOpen(false); }} busy={busy} testId="nux-reset-dialog">
          <p>Elzi will walk you through this page and each of its tabs again, the way she did the first time. Nothing about your settings changes.</p>
          {failed && <p role="alert" data-testid="nux-reset-failed">That did not work. Try again in a moment.</p>}
          <div className="sv-dialog-actions">
            <button type="button" className="action-btn confirm-no" onClick={() => setOpen(false)} disabled={busy} data-testid="nux-reset-no">Cancel</button>
            <button type="button" className="action-btn confirm-yes" onClick={go} disabled={busy} data-testid="nux-reset-yes">{busy ? "Working" : "Show them again"}</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
