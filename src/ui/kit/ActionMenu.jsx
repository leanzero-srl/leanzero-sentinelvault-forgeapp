/*
 * ActionMenu — the ONE keyboard-operable menu primitive (UX review 2026-09-14 §2.2 / §7.4).
 *
 * Extracted from the doc-ribbon workflow menu, which was the only complete implementation:
 * outside-click and focus-out close, roving activeIndex, ArrowUp/Down/Home/End, Escape closes
 * and returns focus to the trigger, aria-haspopup/aria-expanded on the trigger, role="menu" /
 * role="menuitem" on the list. Three layers so every surface can use the same model:
 *
 *   nextMenuIndex(key, active, n)   pure (kit/menu-keys.js) — unit-tested in test/action-menu.test.mjs
 *   useActionMenu({...})            the behaviour, for callers that own their markup (doc-ribbon)
 *   <ActionMenu items onPick/>      the ⋯ trigger + list, for every row that has a "more" menu
 *
 * The list renders through a portal onto document.body at a fixed position computed from the
 * trigger, because every card that hosts a ⋯ is `overflow: hidden` (inline-panel.css,
 * overlay.css) and an absolutely-positioned list would be clipped to the card.
 */
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { nextMenuIndex } from "./menu-keys.js";
import { listenOutside } from "./outside-close.js";

export { nextMenuIndex };

/**
 * The menu behaviour. The caller renders the trigger and the list and spreads the props.
 * @param {object} o
 * @param {boolean} o.open
 * @param {(open:boolean)=>void} o.setOpen
 * @param {number} o.count  number of items
 * @param {React.RefObject} o.triggerRef
 * @param {React.RefObject} o.menuRef
 * @returns {{ activeIndex:number, onMenuKey:(e)=>void, itemProps:(i:number)=>object, close:(restoreFocus?:boolean)=>void }}
 */
export function useActionMenu({ open, setOpen, count, triggerRef, menuRef }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const itemRefs = useRef([]);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, [setOpen, triggerRef]);

  // Outside click (inside OR outside the iframe — kit/outside-close.js), or focus leaving both
  // the trigger and the menu, closes it (no focus return — the user moved on deliberately).
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => !menuRef.current?.contains(e.target) && !triggerRef.current?.contains(e.target);
    const onFocusIn = (e) => { if (outside(e)) setOpen(false); };
    const stop = listenOutside({ refs: [menuRef, triggerRef], onClose: () => setOpen(false), escape: false });
    document.addEventListener("focusin", onFocusIn);
    return () => { stop(); document.removeEventListener("focusin", onFocusIn); };
  }, [open, setOpen, menuRef, triggerRef]);

  // ARIA menu pattern: on open, focus moves to the first item. Synchronously in a layout effect
  // (the items are committed by then) — a requestAnimationFrame was observed NOT to move focus in
  // the overlay's Forge Modal iframe (harness a11y.spec, 2026-09-15), leaving focus on the trigger.
  useLayoutEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    const el = itemRefs.current[0];
    if (el) el.focus();
    else requestAnimationFrame(() => itemRefs.current[0]?.focus());
  }, [open]);

  const moveActive = useCallback((next) => { setActiveIndex(next); itemRefs.current[next]?.focus(); }, []);

  const onMenuKey = useCallback((e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (e.key === "Tab") { setOpen(false); return; } // let focus move on; the focusin listener closes
    const next = nextMenuIndex(e.key, activeIndex, count);
    if (next !== null) { e.preventDefault(); moveActive(next); }
  }, [activeIndex, count, moveActive, close, setOpen]);

  const itemProps = useCallback((i) => ({
    role: "menuitem",
    tabIndex: i === activeIndex ? 0 : -1,
    ref: (el) => { itemRefs.current[i] = el; },
  }), [activeIndex]);

  return { activeIndex, onMenuKey, itemProps, close };
}

const MENU_GAP = 4;

/**
 * The ⋯ menu for a row.
 * @param {object} p
 * @param {{id:string,label:string,danger?:boolean,disabled?:boolean}[]} p.items
 * @param {(id:string)=>void} p.onPick
 * @param {string} p.label  accessible name of the trigger, e.g. "More actions for budget.xlsx"
 * @param {string} [p.testId]  data-testid of the trigger (items get `${testId}-${id}`)
 * @param {string} [p.className]  extra class on the trigger
 */
export default function ActionMenu({ items, onPick, label, testId = "sv-kebab", className = "" }) {
  const [open, setOpen] = useState(false);
  // The list's fixed position. Computed from the trigger BEFORE the list mounts (so it is never
  // rendered hidden — a hidden element refuses focus, and the first item must take focus on open),
  // then refined once the list has a size, and on scroll/resize.
  const [pos, setPos] = useState(null);
  const placeFrom = (menuW, menuH) => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) return null;
    const left = Math.max(8, Math.min(r.right - menuW, window.innerWidth - menuW - 8));
    const below = r.bottom + MENU_GAP;
    const top = menuH && below + menuH > window.innerHeight - 8 ? Math.max(8, r.top - MENU_GAP - menuH) : below;
    return { top, left };
  };
  const toggle = (next) => {
    if (next) setPos(placeFrom(200, 0));
    setOpen(next);
  };
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const list = Array.isArray(items) ? items : [];
  const { onMenuKey, itemProps } = useActionMenu({ open, setOpen, count: list.length, triggerRef, menuRef });

  // Place the list under the trigger's right edge; re-place on scroll/resize; close if the
  // trigger leaves the document (a card re-rendered away under an open menu).
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const p = placeFrom(menuRef.current?.offsetWidth || 200, menuRef.current?.offsetHeight || 0);
      if (!p) { setOpen(false); return; }
      setPos((prev) => (prev && prev.top === p.top && prev.left === p.left ? prev : p));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);

  if (list.length === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`sv-kebab ${className}`.trim()}
        aria-label={label || "More actions"}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label || "More actions"}
        onClick={(e) => { e.stopPropagation(); toggle(!open); }}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); toggle(true); } }}
        data-testid={testId}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="sv-menu"
          role="menu"
          aria-label={label || "More actions"}
          style={{ position: "fixed", top: pos?.top ?? 8, left: pos?.left ?? 8 }}
          onKeyDown={onMenuKey}
          data-testid={`${testId}-menu`}
        >
          {list.map((it, i) => (
            <button
              key={it.id}
              type="button"
              {...itemProps(i)}
              className={`sv-menu-item${it.danger ? " danger" : ""}`}
              disabled={it.disabled}
              title={it.hint || undefined}
              // Focus goes back to the trigger SYNCHRONOUSLY before the pick runs, so a dialog the
              // pick opens records the trigger as its opener (not the item that is about to unmount).
              onClick={(e) => { e.stopPropagation(); triggerRef.current?.focus(); setOpen(false); onPick(it.id); }}
              data-testid={`${testId}-${it.id}`}
            >
              {it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
