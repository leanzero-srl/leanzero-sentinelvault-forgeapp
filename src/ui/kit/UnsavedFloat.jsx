import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FLOAT_ANCHOR, placeFloat } from "./float-placement";
import { measureVisibleBand } from "./visible-placement";

/**
 * "Not applied yet" beside the setting you just changed (owner, 2026-09-25). The consoles' Apply
 * bar is fixed to the bottom of a content-tall iframe — at the very END of a long page — so a
 * change looked applied to someone who never scrolled there. This floats beside the last control
 * used (pointer or keyboard) and follows the next one; it goes away on Apply/Discard.
 * The bottom bar stays: this is a reminder with the same two actions, not a second workflow.
 *
 * Two rules it must never break (device matrix 2026-10-06/07, SV-10, then the breaker's BR-02/BR-03):
 *  1. NOTHING MOVES UNDER A PRESS. It reacts to the CLICK (and to keys), never to pointerdown, and it
 *     never changes the page's layout — it is position:fixed and touches no other element's style.
 *     Round 1 opened a gap (a bottom margin) under the touched row on pointerdown and closed the old
 *     one in the same frame, so the control below jumped mid-press and the click was lost.
 *  2. IT COVERS NO CONTROL AND NO TEXT. kit/float-placement.js finds the nearest spot clear of every
 *     control and every line of text (measured here, as line boxes), shrinking to its compact form
 *     ("Not applied yet" + the two buttons) when the full one does not fit near the control.
 * On a phone it also stays inside the part of the frame that is on screen (measureVisibleBand).
 */
const CONTROL = 'button, input, textarea, select, a[href], label, [role="button"], [role="switch"], [role="option"], [role="radio"], [role="checkbox"], [role="listbox"], [role="menu"], [tabindex]:not([tabindex="-1"])';
const ICONS = 'svg, img, canvas, video, [role="img"]';

const rectOf = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });

/** On-screen rectangles of every control outside the reminder. */
function controlRects(self) {
  const out = [];
  for (const el of document.querySelectorAll(CONTROL)) {
    if (self.contains(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) out.push(rectOf(r));
  }
  return out;
}

/** Every line of text (its line boxes, not the whole block) and every icon outside the reminder. */
function contentRects(self) {
  const out = [];
  if (typeof document.createTreeWalker !== "function" || typeof document.createRange !== "function") return out;
  const walker = document.createTreeWalker(document.body, 4 /* NodeFilter.SHOW_TEXT */);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue || !n.nodeValue.trim() || self.contains(n.parentNode)) continue;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) out.push(rectOf(r));
  }
  for (const el of document.querySelectorAll(ICONS)) {
    if (self.contains(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) out.push(rectOf(r));
  }
  return out;
}

export default function UnsavedFloat({ dirty, busy = false, onApply, onDiscard }) {
  const [touch, setTouch] = useState(null); // { row, control, rowRect, controlRect, n } — the control last used
  const [band, setBand] = useState(null);   // { n, value } — the on-screen part, last measured for touch n
  const [pos, setPos] = useState(null);
  const [resized, setResized] = useState(0);
  const [relayout, setRelayout] = useState(0);
  const ref = useRef(null);
  const placedSize = useRef(null); // the size the last placement was computed for

  useEffect(() => {
    const remember = (el) => {
      if (!el || !el.closest || el.closest(".sv-unsaved-float")) return;
      const control = el.closest(CONTROL) || el;
      const row = el.closest(FLOAT_ANCHOR) || control;
      setTouch((t) => ({ row, control, rowRect: rectOf(row.getBoundingClientRect()), controlRect: rectOf(control.getBoundingClientRect()), n: (t?.n || 0) + 1 }));
    };
    // CLICK, never pointerdown (BR-02): by the time a click is dispatched the press is over, so
    // whatever moves next cannot take the press with it. Space/Enter on a checkbox or button also
    // dispatch a click; keyup covers typing into a field.
    const onClick = (e) => remember(e.target);
    const onKey = (e) => {
      if (e.key === "Tab" || e.key === "Shift") return; // moving focus is not a change
      const el = document.activeElement;
      if (el && el !== document.body) remember(el);
    };
    const onResize = () => setResized((k) => k + 1);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keyup", onKey, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keyup", onKey, true);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // Which part of the frame is on screen (a phone shows 390 px of a 620 px console frame; a
  // content-tall frame shows a band of it). Measured again for each touch; until the first answer
  // the reminder stays hidden, after that the last answer is used and the spot is refined when the
  // new one arrives (usually the same band, so it does not move).
  useEffect(() => {
    if (!dirty || !touch) return undefined;
    let live = true;
    const n = touch.n;
    // …and its own font: the bold face loads on first use, and a box measured before it arrives is
    // ~16 px narrower than the one that is shown (capped wait — a font that never loads must not hide it).
    const fonts = typeof document !== "undefined" && document.fonts?.ready ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 400))]) : null;
    Promise.all([measureVisibleBand(), fonts]).then(([b]) => {
      if (!live) return;
      const ok = b && [b.left, b.right, b.top, b.bottom].every(Number.isFinite);
      setBand({ n, value: ok ? { left: b.left, right: b.right, top: b.top, bottom: b.bottom } : null });
    });
    return () => { live = false; };
  }, [dirty, touch, resized]);

  // Placed once is not placed for good: the reminder's own text can re-flow after it is measured (its
  // bold web font arrives a moment later and the box grew 466 -> 482 px over the "+ Add rule" button
  // in the offline gate), and the page can change under it (a rule's problem line, a list that loads).
  // Either one re-places it — position only, never the page's layout.
  useEffect(() => {
    const el = ref.current;
    if (!dirty || !touch || !el || typeof ResizeObserver !== "function") return undefined;
    let raf = 0;
    const again = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setRelayout((k) => k + 1)); };
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        if (e.target === el) {
          const r = el.getBoundingClientRect(); const last = placedSize.current;
          if (last && Math.abs(last.width - r.width) < 1 && Math.abs(last.height - r.height) < 1) continue;
        }
        again();
        return;
      }
    });
    ro.observe(el);
    ro.observe(document.body);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, [dirty, touch]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!dirty || !touch || !el || !band) { setPos(null); return; }
    const b = band.value;
    // Measured at the width it will be shown at: on a phone the visible band is ~300 px and the
    // reminder wraps to two or three lines.
    // Measured at x 0: a fixed box with only `left` set shrinks to the room right of it, so measuring
    // it where it last sat (say 821 px into a 994 px frame) would read a three-line height.
    const cap = Math.max(160, Math.round((b ? b.right - b.left : window.innerWidth) - 16));
    const was = { left: el.style.left, top: el.style.top };
    el.style.left = "0px"; el.style.top = "0px";
    el.style.maxWidth = `${cap}px`;
    // Both forms are measured with their own CSS (the compact one is tighter, so it fits beside a
    // switch on a 360 px phone); the class React rendered is put back before it renders the new one.
    const wasCompact = el.classList.contains("is-compact");
    el.classList.remove("is-compact");
    const full = el.getBoundingClientRect();
    el.classList.add("is-compact");
    const small = el.getBoundingClientRect();
    if (!wasCompact) el.classList.remove("is-compact");
    el.style.left = was.left; el.style.top = was.top; // React's own values; it re-renders the new ones
    const target = touch.control?.isConnected ? rectOf(touch.control.getBoundingClientRect()) : touch.controlRect;
    const anchor = touch.row?.isConnected ? rectOf(touch.row.getBoundingClientRect()) : touch.rowRect;
    const spot = placeFloat({
      target,
      anchor,
      size: { width: full.width, height: full.height },
      compact: { width: small.width, height: small.height },
      view: { width: window.innerWidth, height: window.innerHeight, ...(b || {}) },
      controls: controlRects(el),
      content: contentRects(el),
    });
    placedSize.current = spot.compact ? { width: small.width, height: small.height } : { width: full.width, height: full.height };
    setPos({ ...spot, cap });
  }, [dirty, touch, band, relayout]);

  if (!dirty || !touch) return null;
  const style = pos
    ? { top: `${pos.top}px`, left: `${pos.left}px`, right: "auto", maxWidth: `${pos.cap}px` }
    : { top: "0px", left: "0px", right: "auto", visibility: "hidden" }; // measured first, then placed
  return (
    <div ref={ref} className={`sv-unsaved-float${pos?.compact ? " is-compact" : ""}`} role="status" style={style} data-testid="sv-unsaved-float" data-spot={pos?.spot || ""}>
      <span className="sv-unsaved-float-text">Not applied yet<span className="sv-unsaved-float-more"> — nothing changes until you apply</span></span>
      <button type="button" className="btn-secondary" onClick={onDiscard} disabled={busy} data-testid="sv-unsaved-float-discard">Discard</button>
      <button type="button" className="btn-primary" onClick={onApply} disabled={busy} data-testid="sv-unsaved-float-apply">{busy ? "Applying…" : "Apply"}</button>
    </div>
  );
}
