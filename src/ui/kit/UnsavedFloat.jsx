import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FLOAT_ANCHOR, placeFloat } from "./float-placement";

/**
 * "Not applied yet" beside the setting you just changed (owner, 2026-09-25). The consoles' Apply
 * bar is fixed to the bottom of a content-tall iframe — at the very END of a long page — so a
 * change looked applied to someone who never scrolled there. This floats beside the last row
 * touched (pointer or keyboard) and follows the next one; it goes away on Apply/Discard.
 * The bottom bar stays: this is a reminder with the same two actions, not a second workflow.
 *
 * Placement (device matrix 2026-10-06, SV-10): it used to sit 28 px under the pointer, which put it
 * on the control the click had just created (a new validation rule's pickers and its ×). It now
 * sits next to the touched ROW on the first spot that covers no control (kit/float-placement.js).
 */
const CONTROL = 'button, input, textarea, select, a[href], label, [role="button"], [role="switch"], [role="option"], [role="radio"], [role="checkbox"], [tabindex]:not([tabindex="-1"])';

export default function UnsavedFloat({ dirty, busy = false, onApply, onDiscard }) {
  const [touch, setTouch] = useState(null); // { el, rect, n } — the row last touched
  const [pos, setPos] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    const remember = (el) => {
      if (!el || el.closest?.(".sv-unsaved-float")) return;
      const row = el.closest?.(FLOAT_ANCHOR) || el;
      setTouch((t) => ({ el: row, rect: row.getBoundingClientRect(), n: (t?.n || 0) + 1 }));
    };
    const onPointer = (e) => remember(e.target);
    const onKey = () => { const el = document.activeElement; if (el && el !== document.body) remember(el); };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keyup", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keyup", onKey, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (!dirty || !touch || !ref.current) { setPos(null); return; }
    const anchor = touch.el?.isConnected ? touch.el.getBoundingClientRect() : touch.rect;
    const box = ref.current.getBoundingClientRect();
    const blockedAt = (x, y) => {
      for (const el of document.elementsFromPoint(x, y)) {
        if (ref.current && ref.current.contains(el)) continue;
        return !!el.closest?.(CONTROL);
      }
      return false;
    };
    setPos(placeFloat({ anchor, size: { width: box.width, height: box.height }, view: { width: window.innerWidth, height: window.innerHeight }, blockedAt }));
  }, [dirty, touch]);

  if (!dirty || !touch) return null;
  const style = pos
    ? { top: `${pos.top}px`, left: `${pos.left}px`, right: "auto" }
    : { top: "0px", left: "0px", right: "auto", visibility: "hidden" }; // measured first, then placed
  return (
    <div ref={ref} className="sv-unsaved-float" role="status" style={style} data-testid="sv-unsaved-float" data-spot={pos?.spot || ""}>
      <span className="sv-unsaved-float-text">Not applied yet — nothing changes until you apply</span>
      <button type="button" className="btn-secondary" onClick={onDiscard} disabled={busy} data-testid="sv-unsaved-float-discard">Discard</button>
      <button type="button" className="btn-primary" onClick={onApply} disabled={busy} data-testid="sv-unsaved-float-apply">{busy ? "Applying…" : "Apply"}</button>
    </div>
  );
}
