import React, { useEffect, useState } from "react";

/**
 * "Not applied yet" beside the setting you just changed (owner, 2026-09-25). The consoles' Apply
 * bar is fixed to the bottom of a content-tall iframe — at the very END of a long page — so a
 * change looked applied to someone who never scrolled there. This floats level with the last
 * control touched (pointer or keyboard) and follows the next one; it goes away on Apply/Discard.
 * The bottom bar stays: this is a reminder with the same two actions, not a second workflow.
 */
export default function UnsavedFloat({ dirty, busy = false, onApply, onDiscard }) {
  const [y, setY] = useState(null);

  useEffect(() => {
    const onPointer = (e) => { if (!e.target.closest?.(".sv-unsaved-float")) setY(e.clientY); };
    const onKey = () => {
      const el = document.activeElement;
      if (el && el !== document.body && !el.closest?.(".sv-unsaved-float")) setY(el.getBoundingClientRect().top);
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keyup", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keyup", onKey, true);
    };
  }, []);

  if (!dirty || y == null) return null;
  const top = Math.max(12, Math.min(y + 28, window.innerHeight - 72));
  return (
    <div className="sv-unsaved-float" role="status" style={{ top: `${Math.round(top)}px` }} data-testid="sv-unsaved-float">
      <span className="sv-unsaved-float-text">Not applied yet — nothing changes until you apply</span>
      <button type="button" className="btn-secondary" onClick={onDiscard} disabled={busy} data-testid="sv-unsaved-float-discard">Discard</button>
      <button type="button" className="btn-primary" onClick={onApply} disabled={busy} data-testid="sv-unsaved-float-apply">{busy ? "Applying…" : "Apply"}</button>
    </div>
  );
}
