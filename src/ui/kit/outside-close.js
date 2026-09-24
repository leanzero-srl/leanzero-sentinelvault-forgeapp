/*
 * listenOutside — the ONE "click away closes it" rule for every menu and picker.
 *
 * Tester report 2026-09-22 (⋯ menus): "the menu can only be dismissed by clicking the three-dots
 * icon a second time". Every menu already listened for `mousedown` on its own document — which
 * never fires when the click lands OUTSIDE THE IFRAME (on the Confluence page around the panel, or
 * the host chrome around a modal). Two additions close that gap:
 *   - `pointerdown` in the CAPTURE phase on the document: runs before any React handler, so a
 *     `stopPropagation()` on a card or a row cannot swallow it;
 *   - `blur` on the window: a click anywhere outside the iframe takes focus away from it.
 * Escape is handled here too so no caller has to remember it.
 *
 * @param {{ refs: Array<{current: Element|null}>, onClose: () => void, escape?: boolean }} o
 * @returns {() => void} unsubscribe
 */
export function listenOutside({ refs, onClose, escape = true }) {
  const inside = (target) => refs.some((r) => r?.current && target && r.current.contains(target));
  const onPointer = (e) => { if (!inside(e.target)) onClose(); };
  const onBlur = () => onClose();
  const onKey = (e) => { if (escape && e.key === "Escape") onClose(); };
  document.addEventListener("pointerdown", onPointer, true);
  window.addEventListener("blur", onBlur);
  document.addEventListener("keydown", onKey);
  return () => {
    document.removeEventListener("pointerdown", onPointer, true);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("keydown", onKey);
  };
}
