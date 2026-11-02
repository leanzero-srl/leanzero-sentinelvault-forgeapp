/*
 * ELZI TOUR GEOMETRY (owner 2026-10-29: never clipped, never over the target; design
 * review 2026-10-29: the bubble is tied to the ring). One reader for the mock-bridge test and the
 * live wolfaenpak run. `tourRects(frame)` reads, inside the tour's frame, the CLIENT rects of the
 * highlighted element (read from the element itself, data-nux-anchor names it), the ring, Elzi,
 * the bubble (without its tail), the tail and the dim cut-out. `judge` applies the rules against a
 * VISIBLE rect in the same coordinates:
 *   bubble inside visible · Elzi inside visible · Elzi x target = 0 · bubble x target = 0 ·
 *   bubble x Elzi = 0 · cut-out == target (1 px)
 *   ring: drawn outside the target, ring-to-text gap >= 6 px (the target's box AND every text line
 *   in it, to the ring's inner edge) · bubble x ring = 0 · Elzi x ring = 0
 *   bubble adjacent to the ring: 0 <= gap <= 16 px on the facing side · the tail's tip touches the
 *   ring (within 2 px of its outer edge) inside the ring's span, pointing at it
 *   Elzi >= 56 px wide (head) · the step's face is set
 */
export const tourRects = (frame) => frame.evaluate(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: b.top, left: b.left, width: b.width, height: b.height }; };
  const n = document.querySelector("[data-nux-step]");
  const anchor = n && n.getAttribute("data-nux-anchor");
  // the anchor's first DRAWN element: a data-nux token, or "@x" = data-lz-action="x" (tourSteps.js anchorSelector)
  const sel = anchor ? (anchor.startsWith("@") ? `[data-testid="${anchor.slice(1)}"]` : `[data-nux~="${anchor}"]`) : null;
  const tEl = sel ? [...document.querySelectorAll(sel)].find((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; }) || null : null;
  const target = r(tEl);
  const ringEl = document.querySelector(".nux-ring");
  const ring = r(ringEl);
  const ringW = ringEl ? parseFloat(getComputedStyle(ringEl).borderTopWidth) || 0 : 0;
  // every text line inside the target, as client rects (the ring must clear the words, not only the box)
  let textBox = null;
  if (tEl) {
    const w = document.createTreeWalker(tEl, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) {
      if (!t.textContent.trim()) continue;
      /* screen-reader-only words (a 1 px clipped box, e.g. a stage's ", done") are not drawn: a Range still reports
         their full unclipped line, so they would read as text outside the ring (a11y pass 2026-10-30) */
      let srOnly = false;
      for (let a = t.parentElement; a && a !== tEl.parentElement; a = a.parentElement) { const cs = getComputedStyle(a); if ((cs.clip && cs.clip !== "auto") || (cs.overflow === "hidden" && a.getBoundingClientRect().width <= 1)) { srOnly = true; break; } }
      if (srOnly) continue;
      const rg = document.createRange(); rg.selectNodeContents(t);
      for (const b of rg.getClientRects()) {
        if (!b.width || !b.height) continue;
        textBox = textBox ? { top: Math.min(textBox.top, b.top), left: Math.min(textBox.left, b.left), right: Math.max(textBox.right, b.right), bottom: Math.max(textBox.bottom, b.bottom) }
          : { top: b.top, left: b.left, right: b.right, bottom: b.bottom };
      }
    }
  }
  const blocks = [...document.querySelectorAll(".nux-dim-block")].map(r);
  // the cut-out = the gap between block 0 (above) and block 1 (below), and blocks 2/3 (sides)
  const hole = blocks.length === 4 ? { top: blocks[0].top + blocks[0].height, left: blocks[2].left + blocks[2].width, width: blocks[3].left - (blocks[2].left + blocks[2].width), height: blocks[1].top - (blocks[0].top + blocks[0].height) } : null;
  const tailEl = document.querySelector(".nux-tail");
  const tailR = r(tailEl);
  const dir = tailEl ? (tailEl.className.match(/nux-tail-(up|down|left|right)/) || [])[1] : null;
  const tip = tailR ? (dir === "up" ? { x: tailR.left + tailR.width / 2, y: tailR.top } : dir === "down" ? { x: tailR.left + tailR.width / 2, y: tailR.top + tailR.height }
    : dir === "left" ? { x: tailR.left, y: tailR.top + tailR.height / 2 } : { x: tailR.left + tailR.width, y: tailR.top + tailR.height / 2 }) : null;
  const ez = document.querySelector(".nux-elzi");
  // the owner's acceptance probes (2026-11-02): is the target the thing on top at its centre, and does an ancestor clip Elzi or the bubble?
  let targetHit = null;
  if (tEl && target) {
    const cx = target.left + target.width / 2, cy = target.top + target.height / 2;
    const hit = cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight ? document.elementFromPoint(cx, cy) : null;
    targetHit = !!hit && (hit === tEl || tEl.contains(hit));
  }
  const clippedBy = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    for (let a = el.parentElement; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === "visible" && cs.overflowY === "visible" && cs.clipPath === "none") continue;
      const r = a.getBoundingClientRect();
      if (a === document.documentElement || a === document.body) continue; // the page's own scroll is not a clip
      if (b.left < r.left - 1 || b.top < r.top - 1 || b.right > r.right + 1 || b.bottom > r.bottom + 1) return `${a.tagName.toLowerCase()}.${String(a.className).slice(0, 30)}`;
    }
    return null;
  };
  const bub = document.querySelector(".nux-bubble");
  const wantW = ez ? Number(ez.getAttribute("width")) : 0, wantH = ez ? Number(ez.getAttribute("height")) : 0;
  const ezR = ez ? ez.getBoundingClientRect() : null;
  const elziSize = ezR ? { wantW, wantH, w: ezR.width, h: ezR.height } : null;
  const btns = [...document.querySelectorAll(".nux-btns button")].map(r);
  const textFit = bub ? { sw: bub.scrollWidth, cw: bub.clientWidth, sh: bub.scrollHeight, ch: bub.clientHeight } : null;
  return { step: n && n.getAttribute("data-nux-step"), anchor, fits: n && n.getAttribute("data-nux-fits"), side: n && n.getAttribute("data-nux-side"), mode: n && n.getAttribute("data-nux-mode"),
    variant: ez && ez.getAttribute("data-variant"), face: ez && ez.getAttribute("data-face"), pose: ez && ez.getAttribute("data-pose"),
    target, ring, ringW, textBox, hole, tail: dir ? { dir, tip } : null,
    elzi: r(ez), bubble: r(document.querySelector(".nux-bubble")), frameW: document.documentElement.clientWidth, inner: { w: innerWidth, h: innerHeight },
    targetHit, elziClippedBy: clippedBy(ez), bubbleClippedBy: clippedBy(bub), elziSize, btns, textFit };
});
const inside = (a, b, t = 1) => a.top >= b.top - t && a.left >= b.left - t && a.top + a.height <= b.top + b.height + t && a.left + a.width <= b.left + b.width + t;
const overlap = (a, b) => Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
export const shift = (rect, dx, dy) => (rect ? { ...rect, top: rect.top + dy, left: rect.left + dx } : null);
/** The measured numbers the rules are judged on (also printed per line). */
export const measures = (g) => {
  const m = {};
  if (g.ring && g.target) {
    const inner = { top: g.ring.top + g.ringW, left: g.ring.left + g.ringW, right: g.ring.left + g.ring.width - g.ringW, bottom: g.ring.top + g.ring.height - g.ringW };
    const box = { top: g.target.top, left: g.target.left, right: g.target.left + g.target.width, bottom: g.target.top + g.target.height };
    const gapOf = (b) => Math.min(b.top - inner.top, b.left - inner.left, inner.right - b.right, inner.bottom - b.bottom);
    m.ringGap = Math.round(gapOf(box) * 10) / 10;
    m.textGap = g.textBox ? Math.round(gapOf(g.textBox) * 10) / 10 : null;
    if (g.bubble) {
      const below = g.bubble.top >= g.ring.top + g.ring.height - 1;
      m.bubbleGap = Math.round((below ? g.bubble.top - (g.ring.top + g.ring.height) : g.ring.top - (g.bubble.top + g.bubble.height)) * 10) / 10;
      m.bubbleFacing = below ? "up" : "down";
    }
    if (g.tail && g.tail.tip) {
      const t = g.tail.tip, edgeY = g.tail.dir === "up" ? g.ring.top + g.ring.height : g.ring.top;
      m.tailToRing = Math.round(Math.abs(t.y - edgeY) * 10) / 10;
      m.tailInSpan = t.x >= g.ring.left && t.x <= g.ring.left + g.ring.width;
    }
  }
  if (g.elzi) m.elziPx = Math.round(g.elzi.width);
  return m;
};
export const judge = (g, visible) => {
  const fails = [];
  if (!g.bubble || !inside(g.bubble, visible)) fails.push("bubble outside visible");
  if (!g.elzi || !inside(g.elzi, visible)) fails.push("Elzi outside visible");
  const m = measures(g);
  if (g.target) {
    if (g.elzi && overlap(g.elzi, g.target) > 1) fails.push("Elzi over target");
    if (g.bubble && overlap(g.bubble, g.target) > 1) fails.push("bubble over target");
    if (!g.hole || Math.abs(g.hole.top - g.target.top) > 1 || Math.abs(g.hole.left - g.target.left) > 1 || Math.abs(g.hole.width - g.target.width) > 1 || Math.abs(g.hole.height - g.target.height) > 1) fails.push("cut-out != target");
    if (!g.ring) fails.push("no ring");
    else {
      if (!(m.ringGap >= 6)) fails.push(`ring-to-target gap ${m.ringGap} < 6`);
      if (m.textGap !== null && !(m.textGap >= 6)) fails.push(`ring-to-text gap ${m.textGap} < 6`);
      if (g.bubble && overlap(g.bubble, g.ring) > 1) fails.push("bubble over ring");
      if (g.elzi && overlap(g.elzi, g.ring) > 1) fails.push("Elzi over ring");
      if (!(m.bubbleGap >= 0 && m.bubbleGap <= 16)) fails.push(`bubble not adjacent to ring (gap ${m.bubbleGap})`);
      if (!g.tail || g.tail.dir !== m.bubbleFacing) fails.push(`tail not toward the ring (${g.tail && g.tail.dir})`);
      else if (!(m.tailToRing <= 2) || !m.tailInSpan) fails.push(`tail tip not on the ring (${m.tailToRing} px, in span ${m.tailInSpan})`);
    }
  }
  if (g.bubble && g.elzi && overlap(g.bubble, g.elzi) > 1) fails.push("bubble over Elzi");
  if (g.variant === "head" && !(m.elziPx >= 56)) fails.push(`Elzi head ${m.elziPx} px < 56`);
  if (!g.face) fails.push("no face");
  return fails;
};
const R = (x) => (x ? `${Math.round(x.left)},${Math.round(x.top)} ${Math.round(x.width)}x${Math.round(x.height)}` : "-");
export const geoLine = (tag, g, visible, fails) => {
  const m = measures(g);
  const nums = g.target ? ` ringGap=${m.ringGap} textGap=${m.textGap} bubbleGap=${m.bubbleGap} tail=${g.tail ? g.tail.dir : "-"}@${m.tailToRing}` : ` tail=${g.tail ? g.tail.dir : "-"}`;
  return `${tag.padEnd(26)} ${String(g.step).padEnd(9)} ${String(g.variant).padEnd(4)} ${String(g.mode).padEnd(7)} face=${String(g.face).padEnd(9)} side=${String(g.side).padEnd(6)} vis=${R(visible)} target=${R(g.target)} ring=${R(g.ring)} elzi=${R(g.elzi)} bubble=${R(g.bubble)}${nums} ${fails.length ? "FAIL " + fails.join("; ") : "PASS"}`;
};

/** The owner's acceptance rules (test/nux-geometry-rules.mjs) over one read, plus text overflow and Elzi's drawn size. */
import { judgeAcceptance, MARGIN } from "./nux-geometry-rules.mjs";
export const judgeOwner = (g, visible) => {
  const fails = judgeAcceptance({ target: g.target, bubble: g.bubble, elzi: g.elzi, targetHit: g.target ? g.targetHit : null, elziClipped: !!g.elziClippedBy, bubbleClipped: !!g.bubbleClippedBy }, visible);
  if (g.elziClippedBy) fails.push(`clipped by ${g.elziClippedBy}`);
  if (g.bubbleClippedBy) fails.push(`bubble clipped by ${g.bubbleClippedBy}`);
  if (g.elziSize && (Math.abs(g.elziSize.w - g.elziSize.wantW) > 1.5 || Math.abs(g.elziSize.h - g.elziSize.wantH) > 1.5)) fails.push(`Elzi drawn ${Math.round(g.elziSize.w)}x${Math.round(g.elziSize.h)}, meant ${g.elziSize.wantW}x${g.elziSize.wantH}`);
  if (g.textFit && (g.textFit.sw > g.textFit.cw + 1 || g.textFit.sh > g.textFit.ch + 1)) fails.push(`bubble text overflows its box (${g.textFit.sw}x${g.textFit.sh} in ${g.textFit.cw}x${g.textFit.ch})`);
  for (const b of g.btns || []) if (g.bubble && (b.left < g.bubble.left - 1 || b.left + b.width > g.bubble.left + g.bubble.width + 1 || b.top < g.bubble.top - 1 || b.top + b.height > g.bubble.top + g.bubble.height + 1)) { fails.push("a bubble button sits outside the bubble"); break; }
  if (g.btns && g.btns.length < 2) fails.push("the bubble lacks its buttons");
  void MARGIN;
  return fails;
};
