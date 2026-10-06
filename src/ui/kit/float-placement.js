// Where the "Not applied yet" reminder (kit/UnsavedFloat.jsx) goes — device matrix 2026-10-06,
// SV-10. It used to sit 28 px under the POINTER, right-aligned: after "+ Add rule" that put it on
// the new rule's type and severity pickers (phones) and on the rule's × (every width). Now it is
// placed next to the ROW that was touched, on the first of four spots that covers no control:
// under the row on its left, under it on its right, above it on its right, above it on its left.
// If every spot covers something, the one covering the fewest controls wins. PURE: the caller
// passes `blockedAt(x, y)` (is there a control under this point, the float itself excluded).

/** Selector for the row the reminder sits beside: the touched setting's row, rule card, choice block or card. */
export const FLOAT_ANCHOR = ".settings-row, .val-rule-card, .val-rules-head, .wf-def-row, .sv-choice-block, .settings-card, [data-float-anchor]";

const GAP = 8;
const EDGE = 8;

/** Sample points across a rectangle (corners, edge midpoints, centre). */
export function samplePoints({ left, top, width, height }) {
  const xs = [left + 2, left + width / 2, left + width - 2];
  const ys = [top + 2, top + height / 2, top + height - 2];
  const pts = [];
  for (const y of ys) for (const x of xs) pts.push([Math.round(x), Math.round(y)]);
  return pts;
}

/**
 * @param anchor  {top, bottom, left, right} of the touched row (viewport px)
 * @param size    {width, height} of the reminder
 * @param view    {width, height} of the frame's viewport
 * @param blockedAt (x, y) => boolean
 * @returns {left, top, spot}
 */
export function placeFloat({ anchor, size, view, blockedAt = () => false }) {
  const w = Math.min(size.width, Math.max(0, view.width - 2 * EDGE));
  const h = size.height;
  const clampX = (x) => Math.max(EDGE, Math.min(x, view.width - w - EDGE));
  const clampY = (y) => Math.max(EDGE, Math.min(y, Math.max(EDGE, view.height - h - EDGE)));
  const below = clampY(anchor.bottom + GAP);
  const above = clampY(anchor.top - GAP - h);
  const spots = [
    { spot: "below-left", left: clampX(anchor.left), top: below },
    { spot: "below-right", left: clampX(anchor.right - w), top: below },
    { spot: "above-right", left: clampX(anchor.right - w), top: above },
    { spot: "above-left", left: clampX(anchor.left), top: above },
  ];
  let best = null;
  for (const s of spots) {
    const hits = samplePoints({ left: s.left, top: s.top, width: w, height: h }).filter(([x, y]) => blockedAt(x, y)).length;
    if (hits === 0) return { left: Math.round(s.left), top: Math.round(s.top), spot: s.spot };
    if (!best || hits < best.hits) best = { ...s, hits };
  }
  return { left: Math.round(best.left), top: Math.round(best.top), spot: best.spot };
}
