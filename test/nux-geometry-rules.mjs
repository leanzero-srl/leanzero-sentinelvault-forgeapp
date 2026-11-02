// The owner's acceptance rules for Elzi's tours (2026-11-02), pure. One reader for the offline browser run
// (test/nux-geometry.test.mjs). "visible" = the frame's window (innerWidth x innerHeight): in Forge Custom UI
// the iframe is the canvas.
//   Elzi and the bubble lie wholly inside it, the bubble keeps >= 16 px from the edges (MARGIN) and is never
//   wider than the window minus both margins; the bubble and Elzi never touch the target; the target is not
//   covered (elementFromPoint at its centre returns it or a descendant); no ancestor clips Elzi or the bubble
//   (their drawn boxes equal their intended boxes).
export const MARGIN = 16;
const inside = (a, b, t = 1) => a.top >= b.top - t && a.left >= b.left - t && a.top + a.height <= b.top + b.height + t && a.left + a.width <= b.left + b.width + t;
const overlap = (a, b) => Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
export const judgeAcceptance = (g, visible) => {
  const fails = [];
  if (!g.bubble) fails.push("no bubble");
  else {
    if (!inside(g.bubble, visible)) fails.push("bubble outside the canvas");
    else if (g.bubble.left < visible.left + MARGIN - 1 || g.bubble.left + g.bubble.width > visible.left + visible.width - MARGIN + 1) fails.push("bubble closer than 16 px to the side margin");
    if (g.bubble.width > visible.width - 2 * MARGIN + 1) fails.push("bubble wider than the window minus its margins");
  }
  if (!g.elzi) fails.push("no Elzi");
  else if (!inside(g.elzi, visible)) fails.push("Elzi outside the canvas");
  if (g.target) {
    if (g.bubble && overlap(g.bubble, g.target) > 1) fails.push("bubble over target");
    if (g.elzi && overlap(g.elzi, g.target) > 1) fails.push("Elzi over target");
    if (g.targetHit === false) fails.push("target covered (elementFromPoint at its centre is not the target)");
  }
  if (g.bubble && g.elzi && overlap(g.bubble, g.elzi) > 1) fails.push("bubble over Elzi");
  if (g.elziClipped) fails.push("an ancestor clips Elzi");
  if (g.bubbleClipped) fails.push("an ancestor clips the bubble");
  return fails;
};
