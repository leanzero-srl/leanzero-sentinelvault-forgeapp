/*
 * Roving-tabindex card list (UX review 2026-09-14 §7.1). The card grids are lists, not 2-D
 * grids: one tab stop per list, ArrowUp/ArrowDown (and ArrowLeft/Right on the card itself)
 * move between cards, Home/End jump, Enter on a card activates its primary action, and the
 * card's own buttons stay real buttons (Tab from a focused card walks into them).
 *
 * The list does not own the cards' markup: a card opts in with `data-roving-card` and marks its
 * primary control with `data-primary`. Everything else is DOM-driven so the panel and the
 * overlay (whose cards are two different components) share one behaviour.
 */
import React, { useCallback, useEffect, useRef } from "react";
import { nextCardIndex } from "./menu-keys.js";

export { nextCardIndex };

export default function RovingList({ as: Tag = "div", label, children, className = "", ...rest }) {
  const ref = useRef(null);

  const cards = useCallback(() => Array.from(ref.current?.querySelectorAll("[data-roving-card]") || []), []);

  // Exactly one card is in the tab order at a time; the first, until the user moves.
  const arm = useCallback((activeEl) => {
    const list = cards();
    if (list.length === 0) return;
    const active = activeEl && list.includes(activeEl) ? activeEl : (list.find((c) => c.getAttribute("tabindex") === "0") || list[0]);
    list.forEach((c) => c.setAttribute("tabindex", c === active ? "0" : "-1"));
  }, [cards]);

  useEffect(() => { arm(null); });

  const onKeyDown = useCallback((e) => {
    const list = cards();
    if (list.length === 0) return;
    const card = e.target.closest ? e.target.closest("[data-roving-card]") : null;
    if (!card || !ref.current?.contains(card)) return;
    const onCardItself = e.target === card;
    // Inside a control (an input, a menu) only the vertical keys on the card itself move rows.
    if (!onCardItself && !(e.target.tagName === "BUTTON" || e.target.tagName === "A")) return;
    const i = list.indexOf(card);
    const key = (!onCardItself && (e.key === "ArrowLeft" || e.key === "ArrowRight")) ? null : e.key;
    if (key === "Enter" && onCardItself) {
      const primary = card.querySelector("[data-primary]");
      if (primary && !primary.disabled) { e.preventDefault(); primary.click(); }
      return;
    }
    // On the card, Left/Right walk its own controls; Up/Down/Home/End change rows.
    if (onCardItself && (key === "ArrowRight" || key === "ArrowLeft")) {
      const controls = Array.from(card.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"]')).filter((c) => c !== card);
      if (controls.length) { e.preventDefault(); (key === "ArrowRight" ? controls[0] : controls[controls.length - 1]).focus(); }
      return;
    }
    const next = nextCardIndex(key, i, list.length);
    if (next === null) return;
    e.preventDefault();
    arm(list[next]);
    list[next].focus();
  }, [cards, arm]);

  return (
    <Tag ref={ref} role="list" aria-label={label} className={className} onKeyDown={onKeyDown} onFocus={(e) => { const c = e.target.closest?.("[data-roving-card]"); if (c) arm(c); }} {...rest}>
      {children}
    </Tag>
  );
}
