/*
 * ONE TOUR ON SCREEN AT A TIME, AND NONE STRAIGHT AFTER ANOTHER IN THE SAME VIEW (dependency-free, so tests drive it).
 *
 * holdOpen / releaseOpen / openTourNow: a plain module flag, so two tour instances in one frame never draw two dims.
 * tourOpenSince(t): was a tour on screen at any moment since `t`? A tour opens by itself only into a view where no tour
 * has run since it was put on screen: the glance's activity tour does not follow straight after the gate tour, and an
 * admin tab's mini-tour waits for the next tab visit after the page tour.
 * clearViewGuard(): "Show all tours again" (2026-11-03, live on leanzero-demo: after a tour had run in the view, Reset
 * cleared the marks but nothing opened until a reload). The person asked for the tours NOW, so the reset forgets that a
 * tour already ran in this view and counts one more reset; every Tour that hears the new count may open by itself once
 * more under every other rule. A tour still on screen keeps its hold.
 */
let openKey = null;
let lastOpenAt = -1;
let lastCloseAt = -1; // a tour that opened before `t` and closed after it was on screen since `t` too
let resets = 0;

export const openTourNow = () => openKey;
export const holdOpen = (key) => { openKey = key; lastOpenAt = Date.now(); };
export const tourOpenSince = (t) => openKey !== null || lastOpenAt >= t || lastCloseAt >= t;
export const releaseOpen = (key) => { if (openKey === key) { openKey = null; lastCloseAt = Date.now(); } };
/** After "Show all tours again": no tour has run in this view any more (unless one is on screen now). Returns the reset count. */
export const clearViewGuard = () => {
  if (openKey === null) { lastOpenAt = -1; lastCloseAt = -1; }
  resets += 1;
  return resets;
};
/** How many resets this frame has seen (a Tour compares it with the count it last knew). */
export const viewResets = () => resets;
