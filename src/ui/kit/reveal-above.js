// BN-02, first tick (breaker round 2, 2026-10-07). In Seal attachments the seal form pins to the
// bottom of the scrolling body once a file is ticked — so the FIRST tick pins it over the row that
// was just ticked when that row sat in the lower part of the visible list (at 1440 the focused
// checkbox at y 581-597 went under the form at 581-659; on a phone 2 of the visible rows did). The
// body's scroll-padding only steers LATER focus scrolls, so nothing brought that row back.
//
// revealAboveDelta(target, cover, view, gap) → px to ADD to the body's scrollTop so `target` ends
// `gap` px clear above `cover` (the pinned form), never scrolling the target's top past the body's
// top. All three are viewport rects ({ top, bottom }). 0 = already clear (or nothing to do).
// A cover that is not docked (the short-frame layout puts the form back in the flow, after the
// list) never overlaps a row, so it gives 0 by the same arithmetic.
export function revealAboveDelta(target, cover, view, gap = 8) {
  if (!target || !cover || !view) return 0;
  const need = target.bottom + gap - cover.top;
  if (!(need > 0)) return 0;
  const room = target.top - view.top; // past this the target's own top would leave the body
  return Math.max(0, Math.min(Math.ceil(need), Math.floor(room)));
}
