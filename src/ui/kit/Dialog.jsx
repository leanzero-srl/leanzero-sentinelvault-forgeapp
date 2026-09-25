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

// ANCHORED mode (owner, 2026-09-24). The page panel's iframe is as tall as its content and the
// Confluence page scrolls AROUND it, so the iframe's "viewport centre" can be a thousand pixels
// below what the person is looking at — the Decline dialog opened off-screen at the bottom. A
// surface in that situation calls `anchorDialogsToOpener()` once; its dialogs then open level
// with the control that opened them (or the last click, for browsers that do not focus a
// clicked button — Safari). Surfaces with a real viewport (overlay, modal, consoles) centre.
let anchorMode = false;
let lastPointerY = null;
export function anchorDialogsToOpener() {
  if (anchorMode) return;
  anchorMode = true;
  document.addEventListener("pointerdown", (e) => { lastPointerY = e.clientY; }, true);
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Dialog({ title, children, onClose, busy = false, danger = false, testId = "sv-dialog", className = "", initialFocus = "first" }) {
  const ref = useRef(null);
  const openerRef = useRef(null);
  const titleId = useId();
  const [top, setTop] = useState(null); // anchored mode: the dialog's top edge, px

  useLayoutEffect(() => {
    if (!anchorMode || !ref.current) return;
    const opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    const y = opener ? opener.getBoundingClientRect().top : lastPointerY;
    if (y == null) return;
    const h = ref.current.getBoundingClientRect().height || 240;
    const max = Math.max(16, window.innerHeight - h - 16);
    setTop(Math.min(max, Math.max(16, y - h / 2)));
  }, []);

  useEffect(() => {
    openerRef.current = document.activeElement;
    const focusables = () => Array.from(ref.current?.querySelectorAll(FOCUSABLE) || []);
    const focusIn = () => {
      const els = focusables();
      const target = initialFocus === "container" ? null : (initialFocus === "last" ? els[els.length - 1] : els[0]);
      (target || ref.current)?.focus();
    };
    focusIn(); // synchronously (see ActionMenu: rAF alone did not move focus inside the Forge Modal iframe)
    requestAnimationFrame(() => { if (!ref.current?.contains(document.activeElement)) focusIn(); });
    const onKey = (e) => {
      if (e.key === "Escape") { if (!busy) { e.preventDefault(); e.stopPropagation(); onClose(); } return; }
      if (e.key !== "Tab") return;
      const els = focusables();
      if (els.length === 0) { e.preventDefault(); ref.current?.focus(); return; }
      const first = els[0], last = els[els.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !ref.current?.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !ref.current?.contains(active))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const opener = openerRef.current;
      if (opener && typeof opener.focus === "function" && document.contains(opener)) requestAnimationFrame(() => opener.focus());
    };
  }, [onClose, busy, initialFocus]);

  return createPortal(
    <div className={`sv-dialog-backdrop${top != null ? " is-anchored" : ""}`} role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }} data-testid={`${testId}-backdrop`}>
      <div ref={ref} style={top != null ? { marginTop: `${Math.round(top)}px` } : undefined} className={`sv-dialog${danger ? " danger" : ""} ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-testid={testId}>
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
