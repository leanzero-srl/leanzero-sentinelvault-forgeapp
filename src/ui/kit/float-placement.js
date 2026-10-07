// Where the "Not applied yet" reminder (kit/UnsavedFloat.jsx) goes — device matrix 2026-10-06,
// SV-10. It used to sit 28 px under the POINTER, right-aligned: after "+ Add rule" that put it on
// the new rule's type and severity pickers (phones) and on the rule's × (every width). Now it is
// placed next to the ROW that was touched, on the first of four spots that overlaps no control:
// under the row on its left, under it on its right, above it on its right, above it on its left.
// If every spot overlaps something (a dense form on a tablet: the after-run on 2026-10-07 put it on
// a new rule's type and severity pickers at 754 px and on an enforcement checkbox at 664 px), the
// result says so (`hits` > 0) and the caller MAKES ROOM: it opens a gap under the touched row and
// the reminder sits in it (`roomBelow`), so it covers nothing at all. PURE: the caller passes
// `blockers`, the on-screen rectangles of the page's controls (the reminder's own excluded), and
// `view` may carry the visible band's left/right (a 620 px frame on a 390 px phone).
// (A 9-point sample was tried first and missed a 24 px × between two sample columns.)

/** Selector for the row the reminder sits beside: the touched setting's row, rule card, choice block or card. */
export const FLOAT_ANCHOR = ".settings-row, .val-rule-card, .val-rules-head, .wf-def-row, .sv-choice-block, .settings-card, [data-float-anchor]";

const GAP = 8;
const EDGE = 8;

const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

const clampers = (view, w, h) => {
  const lo = Number.isFinite(view.left) ? view.left : 0;
  const hi = Number.isFinite(view.right) ? view.right : view.width;
  return {
    w: Math.min(w, Math.max(0, hi - lo - 2 * EDGE)),
    x: (x, ww) => Math.max(lo + EDGE, Math.min(x, hi - ww - EDGE)),
    y: (y) => Math.max(EDGE, Math.min(y, Math.max(EDGE, view.height - h - EDGE))),
  };
};

/**
 * @param anchor   {top, bottom, left, right} of the touched row (viewport px)
 * @param size     {width, height} of the reminder
 * @param view     {width, height[, left, right]} of the frame's viewport (left/right: the part on screen)
 * @param blockers [{top, bottom, left, right}] of every control on screen
 * @returns {left, top, spot, hits, width}
 */
export function placeFloat({ anchor, size, view, blockers = [] }) {
  const h = size.height;
  const c = clampers(view, size.width, h);
  const w = c.w;
  const below = c.y(anchor.bottom + GAP);
  const above = c.y(anchor.top - GAP - h);
  const spots = [
    { spot: "below-left", left: c.x(anchor.left, w), top: below },
    { spot: "below-right", left: c.x(anchor.right - w, w), top: below },
    { spot: "above-right", left: c.x(anchor.right - w, w), top: above },
    { spot: "above-left", left: c.x(anchor.left, w), top: above },
  ];
  let best = null;
  for (const s of spots) {
    const rect = { left: s.left, top: s.top, right: s.left + w, bottom: s.top + h };
    const hits = blockers.filter((b) => overlaps(rect, b)).length;
    if (hits === 0) return { left: Math.round(s.left), top: Math.round(s.top), spot: s.spot, hits: 0, width: Math.round(w) };
    if (!best || hits < best.hits) best = { ...s, hits };
  }
  return { left: Math.round(best.left), top: Math.round(best.top), spot: best.spot, hits: best.hits, width: Math.round(w) };
}

/** The gap the caller opens under the touched row when no spot is free: the reminder's height + 2 gaps. */
export const roomNeeded = (size) => Math.ceil(size.height + 2 * GAP);

/**
 * PURE. Where the reminder goes once the caller has opened `roomNeeded(size)` px under the row:
 * in that gap, on the row's left (`anchor` measured AFTER the gap opened — its bottom is unchanged).
 */
export function roomBelow({ anchor, size, view }) {
  const c = clampers(view, size.width, size.height);
  return { left: Math.round(c.x(anchor.left, c.w)), top: Math.round(anchor.bottom + GAP), spot: "room-below", hits: 0, width: Math.round(c.w) };
}
