// Where the "Not applied yet" reminder (kit/UnsavedFloat.jsx) goes. PURE — the caller measures.
//
// History, because each version fixed the last one's defect and made a new one:
//   1. (2026-09-25) 28 px under the POINTER, right-aligned. After "+ Add rule" that put it on the
//      new rule's pickers and its × (device matrix 2026-10-06, SV-10).
//   2. (2026-10-07, round 1) beside the touched ROW on the first of four spots that covered no
//      CONTROL, and when all four did, a GAP opened under the row (a bottom margin) for it to sit
//      in. The breaker (2026-10-07) found both halves wrong: the first spot, under the row on its
//      left, is exactly where the NEXT setting's name and description are (BR-03, every desktop
//      settings list); and the gap was opened and closed by a pointerdown, so the control under the
//      pointer jumped by the gap's height in the middle of the press and the click was lost (BR-02,
//      mouse included — the new rule's type picker and × did nothing on the first press).
//   3. (now) the reminder NEVER changes the page's layout (no margins, nothing in the flow) and
//      never covers a control OR text: it searches the space around the control just used for a
//      rectangle that is clear of both — every edge of every nearby control and line of text is a
//      candidate edge — and takes the one nearest that control. Only when nothing within reach is
//      clear does it shrink to its compact form ("Not applied yet" + the two buttons), then look
//      further away inside the visible band; it covers text only when no clear spot exists on the
//      screen at all, and a control never.
//
// Inputs are rectangles in the frame's viewport coordinates:
//   target   the control just used ({left, top, right, bottom}); the reminder goes as near it as it can
//   size     {width, height} of the full reminder; `compact` the same for the compact form (optional)
//   view     {width, height[, left, right, top, bottom]} — the frame, and the part of it on screen
//            (a 620 px console frame on a 390 px phone shows 0-390; a content-tall frame shows a band)
//   controls every control's rectangle (never covered)
//   content  every line of text / icon rectangle (covered only when nothing else is left)

/** Selector for the row the reminder sits beside: the touched setting's row, rule card, choice block or card. */
export const FLOAT_ANCHOR = ".settings-row, .val-rule-card, .val-rules-head, .wf-def-row, .sv-choice-block, .settings-card, [data-float-anchor]";

const EDGE = 6;            // from the visible band's edges (6, not 8: on a 360 px phone the compact form beside a switch needs every pixel)
const CLEAR_CONTROL = 6;   // air kept around a control
const CLEAR_TEXT = 4;      // air kept around a line of text
const REACH = 320;         // how far (px, vertically) a spot may be from the control and still read as "beside it"

const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const inflate = (r, d) => ({ left: r.left - d, top: r.top - d, right: r.right + d, bottom: r.bottom + d });
const area = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

function bounds(view, w, h) {
  const lo = Number.isFinite(view.left) ? view.left : 0;
  const hi = Number.isFinite(view.right) ? view.right : view.width;
  const vTop = Math.max(0, Number.isFinite(view.top) ? view.top : 0);
  const vBottom = Math.min(view.height, Number.isFinite(view.bottom) ? view.bottom : view.height);
  const width = Math.min(w, Math.max(0, hi - lo - 2 * EDGE));
  const xMin = lo + EDGE, xMax = Math.max(lo + EDGE, hi - width - EDGE);
  let yMin = vTop + EDGE, yMax = vBottom - h - EDGE;
  if (yMax < yMin) { yMin = Math.max(EDGE, vTop); yMax = Math.max(yMin, view.height - h - EDGE); } // taller than the band
  return { width, xMin, xMax, yMin, yMax };
}

// Distance from a spot to the control: vertical gap counts fully, horizontal less (beside it on the
// same line is as good as just under it). Below wins a tie over above.
const distance = (s, w, h, t) => {
  const dy = Math.max(0, t.top - (s.top + h), s.top - t.bottom);
  const dx = Math.max(0, t.left - (s.left + w), s.left - t.right);
  return dy + 0.35 * dx + (s.top + h <= t.top ? 0.5 : 0);
};

/**
 * Every candidate position for a box of `size` (each edge flush against a nearby obstacle's edge,
 * the control's edges, or the band's), nearest first. `reach` limits how far up/down from the
 * control obstacles are considered (null = the whole band).
 */
function candidates({ target, anchor, size, view, obstacles, reach }) {
  const b = bounds(view, size.width, size.height);
  const w = b.width, h = size.height;
  const near = reach == null
    ? obstacles.filter((o) => o.bottom > b.yMin && o.top < b.yMax + h)
    : obstacles.filter((o) => o.bottom > target.top - reach - h && o.top < target.bottom + reach + h);
  const clampX = (x) => Math.round(Math.max(b.xMin, Math.min(x, b.xMax)));
  const clampY = (y) => Math.round(Math.max(b.yMin, Math.min(y, b.yMax)));
  const xs = new Set([b.xMin, b.xMax, target.left, target.right - w, target.right + CLEAR_CONTROL, target.left - CLEAR_CONTROL - w].map(clampX));
  const ys = new Set([target.top, target.bottom + CLEAR_CONTROL, target.top - CLEAR_CONTROL - h, (target.top + target.bottom - h) / 2].map(clampY));
  if (anchor) {
    [anchor.left, anchor.right - w].forEach((x) => xs.add(clampX(x)));
    [anchor.bottom + CLEAR_TEXT, anchor.top - CLEAR_TEXT - h].forEach((y) => ys.add(clampY(y)));
  }
  for (const o of near) { xs.add(clampX(o.right)); xs.add(clampX(o.left - w)); ys.add(clampY(o.bottom)); ys.add(clampY(o.top - h)); }
  const out = [];
  for (const left of xs) for (const top of ys) {
    if (reach != null && Math.max(0, target.top - (top + h), top - target.bottom) > reach) continue;
    out.push({ left, top, d: distance({ left, top }, w, h, target) });
  }
  out.sort((p, q) => p.d - q.d || p.top - q.top || p.left - q.left);
  return { list: out, w, h };
}

// Obstacles bucketed in 40 px stripes, so a candidate is tested against the few around it.
const STRIPE = 40;
function stripes(rects) {
  const map = new Map();
  for (const r of rects) {
    for (let k = Math.floor(r.top / STRIPE); k <= Math.floor(r.bottom / STRIPE); k++) {
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
  }
  return (r) => {
    const seen = new Set();
    for (let k = Math.floor(r.top / STRIPE); k <= Math.floor(r.bottom / STRIPE); k++) {
      for (const o of map.get(k) || []) { if (!seen.has(o)) { seen.add(o); if (overlaps(r, o)) return true; } }
    }
    return false;
  };
}

function firstClear(args, hits) {
  const { list, w, h } = candidates(args);
  for (const c of list) {
    if (!hits({ left: c.left, top: c.top, right: c.left + w, bottom: c.top + h })) return { left: c.left, top: c.top, width: Math.round(w), d: c.d };
  }
  return null;
}

// The full sentence wins over the compact form unless the compact one sits clearly nearer the control
// (a phone's stacked row: the full one fits only 90 px up the page, the compact one right beside it).
const PREFER_FULL_WITHIN = 24;

/**
 * @returns {{left, top, width, compact: boolean, spot: string, covers: {controls: number, text: number}}}
 *   spot: "clear" (near the control) · "clear-compact" (near it, compact form) · "clear-far" (compact,
 *   further away inside the visible band) · "covers-text" (no clear spot on screen; covers the least
 *   text, never a control) · "covers-control" (only when every spot holds a control — never seen)
 */
export function placeFloat({ target, anchor = null, size, compact = null, view, controls = [], content = [] }) {
  const ctl = controls.map((r) => inflate(r, CLEAR_CONTROL));
  const txt = content.map((r) => inflate(r, CLEAR_TEXT));
  const all = [...ctl, ...txt];
  const base = { target, anchor, view, obstacles: all };
  const hits = stripes(all);
  // "Far" = anywhere in the visible band; with no band known, within 900 px of the control (a
  // content-tall frame can be 10,000 px and every line of it would be a candidate edge).
  const bandKnown = Number.isFinite(view.top) && Number.isFinite(view.bottom);
  const far = bandKnown ? null : 900;
  const done = (hit, isCompact, spot) => ({ left: hit.left, top: hit.top, width: hit.width, compact: isCompact, spot, covers: { controls: 0, text: 0 } });
  const fullNear = firstClear({ ...base, size, reach: REACH }, hits);
  const compactNear = compact ? firstClear({ ...base, size: compact, reach: REACH }, hits) : null;
  if (fullNear && (!compactNear || fullNear.d <= compactNear.d + PREFER_FULL_WITHIN)) return done(fullNear, false, "clear");
  if (compactNear) return done(compactNear, true, "clear-compact");
  const farHit = firstClear({ ...base, size: compact || size, reach: far }, hits);
  if (farHit) return done(farHit, !!compact, "clear-far");
  // Nothing on screen is clear: never a control; the least text.
  const sz = compact || size;
  const { list, w, h } = candidates({ ...base, size: sz, reach: REACH });
  let best = null;
  for (const c of list) {
    const r = { left: c.left, top: c.top, right: c.left + w, bottom: c.top + h };
    const hitsCtl = ctl.filter((o) => overlaps(r, o)).length;
    const textArea = txt.reduce((s, o) => s + area(r, o), 0);
    const score = hitsCtl * 1e9 + textArea + c.d;
    if (!best || score < best.score) best = { ...c, score, hitsCtl, textHits: txt.filter((o) => overlaps(r, o)).length };
  }
  if (!best) { const b = bounds(view, sz.width, sz.height); return { left: Math.round(b.xMin), top: Math.round(b.yMin), width: Math.round(b.width), compact: !!compact, spot: "covers-text", covers: { controls: 0, text: 0 } }; }
  return { left: best.left, top: best.top, width: Math.round(w), compact: !!compact, spot: best.hitsCtl ? "covers-control" : "covers-text", covers: { controls: best.hitsCtl, text: best.textHits } };
}
