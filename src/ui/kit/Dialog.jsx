/*
 * Dialog — the one modal primitive (UX review 2026-09-14 §7.4). The review found a `Dialog`
 * that claimed aria-modal without enforcing it: no focus in, no Escape, no focus restore, no
 * trap. This one does all four, and names itself with aria-labelledby on its own title.
 *
 *   - on open: remembers document.activeElement and moves focus INTO the dialog (the first
 *     focusable control, else the container);
 *   - Tab / Shift+Tab cycle inside the dialog;
 *   - Escape closes (unless `busy`); a backdrop mousedown closes too;
 *   - on close (any route): focus returns to the opener.
 *
 * Renders through a portal onto document.body so an `overflow: hidden` card cannot clip it.
 * Native window.confirm/alert are never used (owner rule).
 */
import React, { useEffect, useLayoutEffect, useRef, useId, useState } from "react";
import { createPortal } from "react-dom";
import { measureVisibleBand, placeInBand } from "./visible-placement";

// ANCHORED mode (owner, 2026-09-24). The page panel's iframe is as tall as its content and the
// Confluence page scrolls AROUND it, so the iframe's "viewport centre" can be a thousand pixels
// below what the person is looking at — the Decline dialog opened off-screen at the bottom. A
// surface in that situation calls `anchorDialogsToOpener()` once; its dialogs then open level
// with the control that opened them (or the last click, for browsers that do not focus a
// clicked button — Safari). Surfaces with a real viewport (overlay, modal, consoles) centre.
// Every surface anchors (tester 2026-09-29: "check all the popups" — the overlay, the details
// modal, My work and both consoles are content-tall frames too, so a centred dialog could land
// out of view there as well). Kept as a function for the callers that already switch it on.
let anchorMode = false;
let lastPointerY = null;
let lastPointerAt = 0;
export function anchorDialogsToOpener() {
  if (anchorMode || typeof document === "undefined") return;
  anchorMode = true;
  document.addEventListener("pointerdown", (e) => { lastPointerY = e.clientY; lastPointerAt = Date.now(); }, true);
}
anchorDialogsToOpener();

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Dialog({ title, children, onClose, busy = false, danger = false, testId = "sv-dialog", className = "", initialFocus = "first" }) {
  const ref = useRef(null);
  const openerRef = useRef(null);
  const titleId = useId();
  const [top, setTop] = useState(null); // anchored mode: the dialog's top edge, px
  const [maxH, setMaxH] = useState(null); // anchored mode: cap when the visible band is shorter than the dialog
  const desiredRef = useRef(null);
  const bandRef = useRef(undefined); // undefined = not measured yet; null = cannot be told

  useLayoutEffect(() => {
    if (!anchorMode || !ref.current) return;
    // A recent click wins (tester 2026-09-29: Revoke opens the signature step only AFTER the server
    // answers — the clicked button is disabled meanwhile, focus moves elsewhere, and anchoring to
    // "whatever has focus" put the dialog far from the click). Keyboard use falls back to focus.
    const recentClick = lastPointerY != null && Date.now() - lastPointerAt < 15000;
    const opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    const y = recentClick ? lastPointerY : opener ? opener.getBoundingClientRect().top : lastPointerY;
    const h = ref.current.getBoundingClientRect().height || 240;
    const max = Math.max(16, window.innerHeight - h - 16);
    // No click and no opener: centre in the frame (the dialog is hidden until placed, so it must be placed).
    const desired = y == null ? Math.max(16, (window.innerHeight - h) / 2) : Math.min(max, Math.max(16, y - h / 2));
    desiredRef.current = desired;
    // Then keep ALL of it inside the part of the frame that is on screen (a content-tall frame can
    // be far taller than the window). Hidden until this answers (≤ 300 ms).
    let live = true;
    measureVisibleBand().then((band) => {
      if (!live || !ref.current) return;
      bandRef.current = band;
      const p = placeInBand({ desiredTop: desired, h: ref.current.getBoundingClientRect().height || h, band });
      setMaxH(p.maxHeight); setTop(p.top);
    });
    return () => { live = false; };
  }, []);

  // The content can grow after placement (a preview that loads): re-fit to the measured band.
  useEffect(() => {
    if (!anchorMode || !ref.current || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => {
      if (bandRef.current === undefined || desiredRef.current == null || !ref.current) return;
      // The FULL height: content (scrollHeight, which a cap would hide) plus the borders around it.
      const el = ref.current;
      const p = placeInBand({ desiredTop: desiredRef.current, h: el.scrollHeight + (el.offsetHeight - el.clientHeight), band: bandRef.current });
      setMaxH((m) => (m === p.maxHeight ? m : p.maxHeight));
      setTop((t) => (t === p.top ? t : p.top));
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    openerRef.current = document.activeElement;
    const focusables = () => Array.from(ref.current?.querySelectorAll(FOCUSABLE) || []);
    const focusIn = () => {
      const els = focusables();
      const target = initialFocus === "container" ? null : (initialFocus === "last" ? els[els.length - 1] : els[0]);
      // preventScroll (tester 2026-09-30): the panel's frame is as tall as the panel, so focusing
      // made the BROWSER scroll the Confluence page to the control — before the dialog had moved
      // next to the click, i.e. to the frame's middle — and the dialog then opened out of view.
      (target || ref.current)?.focus({ preventScroll: true });
    };
    focusIn(); // synchronously (see ActionMenu: rAF alone did not move focus inside the Forge Modal iframe)
    requestAnimationFrame(() => { if (!ref.current?.contains(document.activeElement)) focusIn(); });
    const onKey = (e) => {
      if (e.key === "Escape") { if (!busy) { e.preventDefault(); e.stopPropagation(); onClose(); } return; }
      if (e.key !== "Tab") return;
      const els = focusables();
      if (els.length === 0) { e.preventDefault(); ref.current?.focus({ preventScroll: true }); return; }
      const first = els[0], last = els[els.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !ref.current?.contains(active))) { e.preventDefault(); last.focus({ preventScroll: true }); }
      else if (!e.shiftKey && (active === last || !ref.current?.contains(active))) { e.preventDefault(); first.focus({ preventScroll: true }); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const opener = openerRef.current;
      if (opener && typeof opener.focus === "function" && document.contains(opener)) requestAnimationFrame(() => opener.focus({ preventScroll: true }));
    };
  }, [onClose, busy, initialFocus]);

  return createPortal(
    <div className={`sv-dialog-backdrop${top != null ? " is-anchored" : ""}`} role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }} data-testid={`${testId}-backdrop`}>
      <div ref={ref} style={top != null ? { marginTop: `${Math.round(top)}px`, ...(maxH ? { maxHeight: `${maxH}px`, overflowY: "auto" } : {}) } : (anchorMode ? { visibility: "hidden" } : undefined)} className={`sv-dialog${danger ? " danger" : ""} ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-testid={testId}>
        <h3 className="sv-dialog-title" id={titleId}>{title}</h3>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * A yes/no question. The buttons keep the `.action-btn.confirm-yes` / `.confirm-no` classes the
 * inline confirm bars used, so the harness selectors still find them.
 */
export function ConfirmDialog({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = true, busy = false, onConfirm, onCancel, testId = "sv-confirm" }) {
  return (
    <Dialog title={title} onClose={onCancel} busy={busy} danger={danger} testId={testId} initialFocus="last">
      <div className="sv-dialog-body">{message}</div>
      <div className="sv-dialog-actions">
        <button type="button" className="action-btn confirm-yes" onClick={onConfirm} disabled={busy} data-testid={`${testId}-yes`}>{busy ? "Working…" : confirmLabel}</button>
        <button type="button" className="action-btn confirm-no" onClick={onCancel} disabled={busy} data-testid={`${testId}-no`}>{cancelLabel}</button>
      </div>
    </Dialog>
  );
}
