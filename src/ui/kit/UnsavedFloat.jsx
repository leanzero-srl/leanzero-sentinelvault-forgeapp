import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FLOAT_ANCHOR, placeFloat, roomBelow, roomNeeded } from "./float-placement";
import { measureVisibleBand } from "./visible-placement";

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
 * When no such spot exists (a dense form on a tablet or phone) it opens a gap under the touched row
 * — a bottom margin on that row, put back when the reminder goes or moves — and sits in it, so it
 * covers nothing. On a phone it also stays inside the part of the frame that is on screen.
 */
const CONTROL = 'button, input, textarea, select, a[href], label, [role="button"], [role="switch"], [role="option"], [role="radio"], [role="checkbox"], [tabindex]:not([tabindex="-1"])';

export default function UnsavedFloat({ dirty, busy = false, onApply, onDiscard }) {
  const [touch, setTouch] = useState(null); // { el, rect, n } — the row last touched
  const [pos, setPos] = useState(null);
  const [band, setBand] = useState(null); // the part of the frame on screen ({ left, right, … }) or null
  const ref = useRef(null);
  const room = useRef(null); // { el, margin } — the gap opened under a row, to put back

  const closeRoom = () => {
    const r = room.current;
    room.current = null;
    if (r && r.el) r.el.style.marginBottom = r.margin;
  };

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
      closeRoom();
    };
  }, []);

  // Which part of the frame is on screen (a phone shows 390 px of a 620 px console frame).
  useEffect(() => {
    if (!dirty || !touch) return undefined;
    let live = true;
    measureVisibleBand().then((b) => { if (live) setBand(b && Number.isFinite(b.left) && Number.isFinite(b.right) ? { left: b.left, right: b.right } : null); });
    return () => { live = false; };
  }, [dirty, touch]);

  useLayoutEffect(() => {
    closeRoom(); // a gap opened for the previous placement goes first, so everything is measured as laid out
    if (!dirty || !touch || !ref.current) { setPos(null); return; }
    const row = touch.el?.isConnected ? touch.el : null;
    const anchor = row ? row.getBoundingClientRect() : touch.rect;
    const box = ref.current.getBoundingClientRect();
    const size = { width: box.width, height: box.height };
    const view = { width: window.innerWidth, height: window.innerHeight, ...(band || {}) };
    const blockers = [];
    for (const el of document.querySelectorAll(CONTROL)) {
      if (ref.current.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) blockers.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
    const spot = placeFloat({ anchor, size, view, blockers });
    if (spot.hits === 0 || !row) { setPos(spot); return; }
    // Every spot covers a control: open a gap under the row and sit in it.
    room.current = { el: row, margin: row.style.marginBottom };
    const base = parseFloat(getComputedStyle(row).marginBottom) || 0;
    row.style.marginBottom = `${base + roomNeeded(size)}px`;
    setPos(roomBelow({ anchor: row.getBoundingClientRect(), size, view }));
  }, [dirty, touch, band]);

  if (!dirty || !touch) return null;
  const style = pos
    ? { top: `${pos.top}px`, left: `${pos.left}px`, right: "auto", ...(band && pos.width ? { maxWidth: `${pos.width}px` } : {}) }
    : { top: "0px", left: "0px", right: "auto", visibility: "hidden" }; // measured first, then placed
  return (
    <div ref={ref} className="sv-unsaved-float" role="status" style={style} data-testid="sv-unsaved-float" data-spot={pos?.spot || ""}>
      <span className="sv-unsaved-float-text">Not applied yet — nothing changes until you apply</span>
      <button type="button" className="btn-secondary" onClick={onDiscard} disabled={busy} data-testid="sv-unsaved-float-discard">Discard</button>
      <button type="button" className="btn-primary" onClick={onApply} disabled={busy} data-testid="sv-unsaved-float-apply">{busy ? "Applying…" : "Apply"}</button>
    </div>
  );
}
