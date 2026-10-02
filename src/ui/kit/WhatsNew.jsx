/*
 * "What's new" (baseline pillar 4): a quiet link beside the site console's title that opens the
 * release notes — the running release in full, older ones below. The notes ship in the bundle
 * (server/shared/release-notes.js); nothing is fetched.
 */
import React, { useState } from "react";
import Dialog from "./Dialog";
import { RELEASE_NOTES, CURRENT_RELEASE } from "../../server/shared/release-notes.js";

const Note = ({ n, open }) => (
  <section className={`wn-note${open ? " is-open" : ""}`} data-testid={`wn-note-${n.version}`}>
    <h4 className="wn-head"><span className="wn-version">{n.version}</span> <span className="wn-date">{n.date}{n.status === "testing" ? " · in testing" : ""}</span></h4>
    <p className="wn-headline">{n.headline}</p>
    {open && (
      <>
        {n.changes?.length > 0 && <ul className="wn-list">{n.changes.map((c) => <li key={c}>{c}</li>)}</ul>}
        {n.fixes?.length > 0 && <><p className="wn-sub">Fixed</p><ul className="wn-list">{n.fixes.map((c) => <li key={c}>{c}</li>)}</ul></>}
        {n.action && <p className="wn-action" data-testid="wn-action"><strong>Do this:</strong> {n.action}</p>}
      </>
    )}
  </section>
);

export default function WhatsNew() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(CURRENT_RELEASE.version);
  return (
    <>
      <button type="button" className="wn-link" onClick={() => setOpen(true)} data-testid="wn-open">What's new in {CURRENT_RELEASE.version}</button>
      {open && (
        <Dialog title="What's new in Sentinel Vault" onClose={() => setOpen(false)} testId="wn-dialog" className="wn-dialog">
          <div className="sv-dialog-body wn-body">
            {RELEASE_NOTES.map((n) => (
              <div key={n.version} onClick={() => setExpanded(n.version)} role="presentation">
                <Note n={n} open={expanded === n.version} />
              </div>
            ))}
          </div>
          <div className="sv-dialog-actions"><button type="button" className="action-btn confirm-no" onClick={() => setOpen(false)}>Close</button></div>
        </Dialog>
      )}
    </>
  );
}
