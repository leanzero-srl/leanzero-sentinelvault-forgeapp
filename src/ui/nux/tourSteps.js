/*
 * ELZI'S TOURS - THE RULES, PURE (ported from the Codegeist build, 2026-10-31).
 *
 * The one tour engine's rules (Tour.jsx draws, this file decides). A tour is DATA its host
 * hands in (the admin page: static/admin-panel/src/nux/adminTours.js). No React and no DOM writes,
 * so test-harness/scripts/admin-nux.test.mjs and nux-engine.test.mjs run every rule offline:
 *   - which steps are shown: a step names its ANCHORS (data-nux attributes, first match wins).
 *     A step whose anchors are all missing is dropped, unless it has none (the hello step is
 *     centred);
 *   - the reading time per step and in total (words at READ_WPS words a second + a fixed glance);
 *   - when a tour starts on its own: once per person and per tour, never after it was shown,
 *     finished or skipped, never when the stored answer could not be read (a failed read must
 *     not nag on every visit);
 *   - Next / Back / Esc as plain state moves.
 * Words are plain, in the app's voice; no em or en dash (ui-copy-dashes gate).
 */

// 2 (owner 2026-10-30): every tour was rewritten and Elzi now says hello, so a mark from version 1
// counts as not seen and each person gets the new tours once (kept at 2 here so a mark is read the same in both builds).
import { NUX_AUTO_PREFIX } from "./nux-tours.js";

export const NUX_VERSION = 2;
// What a reader gets through per second of short UI copy (about 200 words a minute), and a fixed
// second per step to find the highlighted thing. The hello step's promise says 25 seconds.
export const READ_WPS = 3.3;
export const STEP_GLANCE_S = 1;
/* TOUR-COPY (owner 2026-10-31: the bubbles were "a bit too concise ... Not books, but a bit more to actually
   explain"): a bubble now says what the thing is and why it matters, so a tour may read for 45 s and one bubble
   for STEP_MAX_S (about 40 words). Was 30 s and 8 s. Same numbers as the Codegeist build. */
export const TOUR_BUDGET_S = 45;
export const STEP_MAX_S = 14;
export const ANCHOR_ATTR = "data-nux";

/*
 * ELZI SAYS WHO SHE IS (owner 2026-10-30: "I did not see her present herself in a quick bubble").
 * The gate, steward and admin tours start with it every time (intro "always"); a module's mini-tour
 * only when it is the very first tour this person sees (intro "first"). Centred, no target.
 */
export const INTRO_TITLE = "Hi! I'm Elzi.";
// cold read 3 (2026-11-01): "nothing says who Elzi is". One line, in every hello, before the tour's own.
export const INTRO_WHO = "I'm Sentinel Vault's guide.";
export const introStep = (text) => Object.freeze({ id: "hello", intro: true, anchors: [], pose: "wave", face: "wave", title: INTRO_TITLE, text: `${INTRO_WHO} ${text}` });
/** The steps a tour opens with: its own, after Elzi's hello when the tour def says so. */
export const stepsWithIntro = (tour, { firstEver = false } = {}) => {
  const steps = (tour && tour.steps) || [];
  const want = tour && (tour.intro === "always" || (tour.intro === "first" && firstEver));
  return want ? [introStep(tour.hello || "I'll show you around quickly."), ...steps] : [...steps];
};

/*
 * A TOUR IS DATA (owner 2026-10-30: "build the engine so a module tour is a data entry"):
 *   { key, steps, ready, intro, hello }
 *   key    its mark (src/shared/nux-tours.js)      ready  the anchor its auto start waits for
 *   intro  "always" | "first" | "never"            hello  Elzi's hello line for this tour
 *   replay true: the engine draws the module's small "Tour" button (TourReplay.jsx) over its view, for a view
 *          that has no tour button of its own (the activity list); gate and steward views carry their own
 * A step may carry `tab` (and `sub`): the host switches to that tab before the step is measured,
 * and its anchors are looked for for up to TAB_WAIT_MS (the tab draws after the switch).
 */
export const TAB_WAIT_MS = 4000;
/* LISTED BUILD: the issue glance has no tour (no Evidence Gate, no Field Steward), so the engine ships no glance
   tour data; every tour comes from its host as a `tour` prop (the admin page: admin-panel/src/nux/adminTours.js). */
/*
 * Which element a step's anchor names. A plain word is a data-nux token (data-nux="a b" carries two);
 * "@x" is the element with data-testid="x" (the test id most controls already carry).
 */
export const anchorSelector = (name) => (String(name).startsWith("@") ? `[data-testid="${String(name).slice(1)}"]` : `[${ANCHOR_ATTR}~="${name}"]`);


const words = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;

/** Seconds a person needs for one step: its words at READ_WPS plus one glance. */
export const stepSeconds = (step) => Math.round(((words(step.title) + words(step.text)) / READ_WPS + STEP_GLANCE_S) * 10) / 10;
export const tourSeconds = (steps) => Math.round(steps.reduce((t, s) => t + stepSeconds(s), 0) * 10) / 10;

/**
 * The steps shown, each with the anchor that won. `has(name)` says whether an element with
 * data-nux="name" is on screen (the component passes a DOM query; tests pass a Set).
 */
export const resolveSteps = (has, steps = []) => {
  const out = [];
  for (const s of steps) {
    if (!s.anchors.length) { out.push({ ...s, anchor: null }); continue; }
    // a step on another tab: kept, its anchor is looked for once the host has switched (TAB_WAIT_MS)
    if (s.tab) { out.push({ ...s, anchor: s.anchors.find((a) => has(a)) || null, late: true }); continue; }
    const anchor = s.anchors.find((a) => has(a)) || null;
    if (anchor) out.push({ ...s, anchor });
  }
  return out;
};

/*
 * WORDS THAT FOLLOW WHAT IS ON SCREEN (2026-10-30: the demo step said "Set up the demo" to a judge whose demo
 * was already Ready). A step may carry `say`: { <state>: {title?, text} }. The state is read off the element
 * that won: the step's own `sayOf(el)` when it has one (pure DOM reads, so nothing is added to a glance entry),
 * else the nearest data-nux-say="<state>" on the element or around it. No state, or one the step does not
 * name, keeps the step's own words. `textBy` (by the anchor that won) still applies under a state that has none.
 */
export const SAY_ATTR = "data-nux-say";
export const sayFor = (step, el) => {
  if (!step || !el) return null;
  try {
    if (typeof step.sayOf === "function") return step.sayOf(el) || null;
    const h = el.closest ? el.closest(`[${SAY_ATTR}]`) : null;
    return h ? h.getAttribute(SAY_ATTR) || null : null;
  } catch (e) { return null; }
};
export const stepWords = (step, { anchor = null, say = null } = {}) => {
  const alt = (say && step && step.say && step.say[say]) || null;
  return {
    title: (alt && alt.title) || step.title,
    text: (alt && alt.text) || (anchor && step.textBy && step.textBy[anchor]) || step.text,
  };
};
/** Every way a step can read (its own words, each textBy, each say): budgets and word checks run on all. */
export const stepVariants = (step) => [
  step,
  ...Object.values(step.textBy || {}).map((text) => ({ ...step, text })),
  ...Object.values(step.say || {}).map((v) => ({ ...step, ...v })),
];
/** The longest a tour can take: each step at its slowest variant. */
export const tourSecondsWorst = (steps) => Math.round(steps.reduce((t, s) => t + Math.max(...stepVariants(s).map(stepSeconds)), 0) * 10) / 10;

/** The anchors the tour knows that nothing on screen carries yet (the report names them). */
export const waitingAnchors = (has, steps = []) =>
  [...new Set(steps.flatMap((s) => s.anchors))].filter((a) => !has(a));

/*
 * Is the tour NEW to this person? `stored` is the resolver's answer:
 *   {ok:true, seen:false} -> yes;  {ok:true, seen:true} -> no (finished or skipped before);
 *   anything else (read failed, no answer yet) -> no.
 * A stored version older than NUX_VERSION counts as not seen (a rewritten tour is new once more).
 */
export const tourIsNew = (stored) => !!(stored && stored.ok === true && (!stored.seen || Number(stored.version || 0) < NUX_VERSION));
/*
 * THE TOUR OPENS BY ITSELF ONCE (owner 2026-10-30: "yes ofc it should open the first time please").
 * D10 (walkthrough B, 2026-10-29) had turned the auto start off because the tour covered the panel an
 * admin came to read; the owner overrules that for the FIRST visit only: the Field Steward tour on a
 * person's first desk request, the Evidence Gate tour on their first other issue with the glance.
 * Skip is on every step; the mark is written the moment it opens ("shown"), so it never opens by
 * itself again for that person; a read that failed never opens it. The trail's / request view's
 * button ("Take the tour", "Replay tour" once seen) still opens it any time.
 */
export const NUX_AUTO_OPEN = true;
export const shouldAutoStart = (stored) => NUX_AUTO_OPEN && tourIsNew(stored);
/** A tour def's `after`: has this person seen one of those tours (at this version)? No `after` = yes. */
export const afterSeen = (tour, marks) => !(tour && Array.isArray(tour.after) && tour.after.length) ||
  tour.after.some((k) => { const m = storedFor(marks, k); return !!(m && m.ok === true && !tourIsNew(m)); });
/*
 * One tour's mark out of the resolver's answer. `tours` (one mark per tour) when the answer has it;
 * an answer without it (an older backend, the mock bridge) counts for both tours. A failed read stays
 * a failed read ({ok:false}), so it never opens anything.
 */
export const storedFor = (stored, key) => {
  if (!stored) return null;
  if (stored.ok !== true) return { ok: false };
  if (stored.tours && typeof stored.tours === "object") {
    const t = stored.tours[key];
    return t ? { ok: true, seen: !!t.seen, version: Number(t.version) || 0 } : { ok: true, seen: false, version: 0 };
  }
  return stored;
};
/*
 * Belt to the stored mark: a tab that auto-opened a tour never auto-opens it again, even when the
 * mark could not be saved (KVS write failed). sessionStorage: this tab only, gone with it, so it
 * never decides for another person. Blocked storage reads as "not shown here" (the mark decides).
 */
const SHOWN_KEY = (key) => `${NUX_AUTO_PREFIX}${key}:v${NUX_VERSION}`;
const sess = (store) => { if (store) return store; try { return window.sessionStorage; } catch (e) { return null; } };
export const autoShownHere = (key, store) => { try { const s = sess(store); return !!(s && s.getItem(SHOWN_KEY(key)) === "1"); } catch (e) { return false; } };
/** JUDGE SCORE #2 (the tour after Reset): Reset promises "the tours show again", so a finished Reset clears every
    "shown here" belt of this tab (only NUX_AUTO_PREFIX keys, this tab's sessionStorage); blocked storage does nothing. */
const dropPrefixed = (s) => {
  try {
    if (!s) return;
    const keys = [];
    for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k && k.startsWith(NUX_AUTO_PREFIX)) keys.push(k); }
    for (const k of keys) s.removeItem(k);
  } catch (e) { /* blocked */ }
};
/* cold tests #4: Reset forgets this browser's once-per-browser belt as well (below). */
export const forgetAutoShown = (store, localStore) => { dropPrefixed(sess(store)); dropPrefixed(loc(localStore)); };
/*
 * COLD TESTS #4 (2026-10-31, guest path A): on the shared judge account the account's mark cannot tell one judge from
 * the next. The score #2 walk's Reset cleared it, the page was opened a minute later and the tour marked shown, and
 * the cold judge, 23 minutes later, was inside the one-hour gap that starts a new session (src/steward/demo.js
 * beginDemoSession): no tour. A new judge is a new browser, so on the judge seat the page tour also opens once per
 * BROWSER (localStorage). Blocked storage: the account mark decides, as before.
 */
const BROWSER_KEY = (key) => `${NUX_AUTO_PREFIX}b:${key}:v${NUX_VERSION}`;
const loc = (store) => { if (store !== undefined) return store; try { return window.localStorage; } catch (e) { return null; } };
export const browserShown = (key, localStore) => { try { const s = loc(localStore); return !s || s.getItem(BROWSER_KEY(key)) === "1"; } catch (e) { return true; } };
export const markBrowserShown = (key, localStore) => { try { const s = loc(localStore); if (s) s.setItem(BROWSER_KEY(key), "1"); } catch (e) { /* blocked */ } };
/** May this tour open by itself? The account's mark, or (judge seat) a browser that never opened it, once the mark
    was READ (a failed or pending read never opens it). Pure given storage. */
export const wantsAutoStart = ({ stored, key, oncePerBrowser = false, local } = {}) =>
  shouldAutoStart(stored) || (!!oncePerBrowser && NUX_AUTO_OPEN && !!stored && stored.ok === true && !browserShown(key, local));
export const markAutoShownHere = (key, store) => { try { const s = sess(store); if (s) s.setItem(SHOWN_KEY(key), "1"); } catch (e) { /* blocked */ } };
/** The trail's tour button, in words that fit whether the person has seen the tour. */
export const tourButtonLabel = (stored) => (stored && stored.ok === true && !tourIsNew(stored) ? "Replay tour" : "Take the tour");

/** Tour state moves. state = {open, index, count}; returns the next state (pure). */
export const tourReducer = (state, action) => {
  const count = Math.max(0, Number(action.count ?? state.count) || 0);
  switch (action.type) {
    case "start": return count ? { open: true, index: 0, count, ended: null } : { ...state, open: false, count };
    case "next":
      if (!state.open) return state;
      if (state.index + 1 >= state.count) return { ...state, open: false, ended: "done" };
      return { ...state, index: state.index + 1 };
    case "back":
      if (!state.open || state.index === 0) return state;
      return { ...state, index: state.index - 1 };
    case "skip": return state.open ? { ...state, open: false, ended: "skipped" } : state;
    case "recount": {
      // the anchors changed under an open tour (a row loaded, a step's element left): stay in range
      if (!state.open) return { ...state, count };
      if (!count) return { ...state, open: false, count, ended: "skipped" };
      return { ...state, count, index: Math.min(state.index, count - 1) };
    }
    default: return state;
  }
};
export const TOUR_INITIAL = Object.freeze({ open: false, index: 0, count: 0, ended: null });

/** Key handling inside the tour: which action a key means (null = not ours). */
export const keyAction = (key, { index = 0 } = {}) => {
  if (key === "Escape" || key === "Esc") return "skip";
  if (key === "ArrowRight") return "next";
  if (key === "ArrowLeft") return index > 0 ? "back" : null;
  return null;
};

/** Elzi's arm pose for a step (full-body variant): the point direction follows where the anchor is from her. */
export const poseFor = (step, rel) => {
  if (step.pose !== "point") return step.pose;
  if (!rel) return "wave";
  const v = rel.above ? "up" : "down";
  const h = rel.left ? "left" : "right";
  return `point-${v}-${h}`;
};

/** Step counter words, e.g. "Step 2 of 4". */
export const stepLabel = (index, count) => `Step ${index + 1} of ${count}`;

/*
 * PLACEMENT (owner 2026-10-29: never clipped, never over the target; design review 2026-10-29: the
 * bubble must be tied to the highlight). Everything in the frame's DOCUMENT coordinates. `visible` =
 * the part of the frame a person can see right now (an IntersectionObserver against Jira's window,
 * so Jira's own scroll and clipping count).
 *   - The RING is drawn RING_GAP px outside the target (the cut-out stays the target's exact rect),
 *     so nothing of the target touches the ring's inner edge.
 *   - The BUBBLE sits against the ring, wholly below it (first) or wholly above it, its edge TAIL px
 *     from the ring's outer edge; its TAIL leaves that edge at the target's centre (clamped into the
 *     bubble) and its tip touches the ring. So the bubble points at the thing, not at Elzi.
 *   - ELZI sits beside the bubble's FAR end (the end away from the ring): beside it when the bubble
 *     still gets BUBBLE_MIN_SIDE px next to her, else under it (below) / over it (above), at the
 *     corner away from the target's centre. She never covers the target, the ring or the bubble.
 *   - A side is usable when ring + bubble + Elzi fit in the visible height together (the frame is
 *     then scrolled to show them). No side fits -> {fits:false}: the caller tries a narrower anchor.
 * No target (the hello): bubble and Elzi centred near the top, the tail pointing at Elzi.
 */
export const EDGE = 8;
export const RING_GAP = 7;
export const RING_W = 3;
export const RING_OUT = RING_GAP + RING_W;
export const TAIL = 12;
export const ELZI_GAP = 8;
export const BUBBLE_MAX = 380;
export const BUBBLE_MIN_SIDE = 220;
const TAIL_INSET = 18; // the tail never leaves the bubble closer than this to a corner

export const ringRect = (target, frameW) => {
  if (!target) return null;
  const left = Math.max(0, target.left - RING_OUT), top = Math.max(0, target.top - RING_OUT);
  const right = Math.min(frameW, target.left + target.width + RING_OUT);
  return { top, left, width: right - left, height: target.top + target.height + RING_OUT - top };
};

/*
 * Jira floats its own round Rovo button over the bottom-right of the window, OVER our frame, and
 * nothing measured from inside the frame can see it (live 2026-10-29, nux2: it covered the
 * refusal step's Next button). So the bottom BOTTOM_RESERVE px of what is visible are not counted
 * as room, and the frame is scrolled with that much clear space under the bubble.
 */
export const BOTTOM_RESERVE = 72;
export const placeTour = ({ target, visible, frameW, bubbleH, elziW, elziH, reserveBottom = BOTTOM_RESERVE }) => {
  const room = frameW - 2 * EDGE;
  const besideW = Math.min(BUBBLE_MAX, room - elziW - ELZI_GAP);
  const beside = besideW >= BUBBLE_MIN_SIDE;
  const bubbleW = beside ? besideW : Math.min(BUBBLE_MAX, room);
  const blockW = beside ? elziW + ELZI_GAP + bubbleW : bubbleW;
  const cx = target ? target.left + target.width / 2 : frameW / 2;
  // Elzi on the side away from the target's centre (a target on the left gets her on the right)
  const elziRight = !!target && cx < frameW / 2 - 24;
  const blockLeft = Math.round(Math.max(EDGE, Math.min(frameW - EDGE - blockW, cx - blockW / 2)));
  const bubbleLeft = beside && !elziRight ? blockLeft + elziW + ELZI_GAP : blockLeft;
  const elziLeft = beside ? (elziRight ? bubbleLeft + bubbleW + ELZI_GAP : blockLeft)
    : (elziRight ? bubbleLeft + bubbleW - elziW : bubbleLeft);
  const tailAt = (x) => Math.round(Math.max(TAIL_INSET, Math.min(bubbleW - TAIL_INSET, x - bubbleLeft)));
  const look = (e, toX, toY) => {
    const dx = toX - (e.left + e.width / 2), dy = toY - (e.top + e.height / 2), d = Math.hypot(dx, dy) || 1;
    return [Math.round((dx / d) * 100) / 100, Math.round((dy / d) * 100) / 100];
  };
  const pack = (side, bubbleTop, elziTop, union, fits) => {
    const bubble = { top: Math.round(bubbleTop), left: bubbleLeft, width: bubbleW, height: bubbleH };
    const elzi = { top: Math.round(elziTop), left: elziLeft, width: elziW, height: elziH };
    let tail;
    if (side === "below") tail = { dir: "up", at: tailAt(cx) };
    else if (side === "above") tail = { dir: "down", at: tailAt(cx) };
    else if (beside) tail = { dir: "left", at: Math.round(Math.max(TAIL_INSET, Math.min(bubbleH - TAIL_INSET, elzi.top + elziH / 2 - bubble.top))) };
    else tail = { dir: "down", at: tailAt(elziLeft + elziW / 2) };
    const lookAt = target ? look(elzi, cx, target.top + target.height / 2) : look(elzi, bubble.left + bubble.width / 2, bubble.top + bubble.height / 2);
    return { fits, side, mode: beside ? "beside" : "stacked", bubble, elzi, tail, look: lookAt, union,
      ring: ringRect(target, frameW), top: bubble.top, left: bubble.left, width: bubbleW };
  };
  if (!target) {
    const top = visible.top + EDGE * 2;
    const eTop = beside ? top + Math.max(0, bubbleH - elziH) : top + bubbleH + ELZI_GAP;
    const bottom = Math.max(top + bubbleH, eTop + elziH);
    return pack("center", top, eTop, { top, bottom }, bottom - top + 4 * EDGE <= visible.height);
  }
  const ring = ringRect(target, frameW);
  const fitH = visible.height - 2 * EDGE - reserveBottom;
  // below: bubble under the ring, Elzi at its far (bottom) end
  const bTop = ring.top + ring.height + TAIL;
  const bElzi = beside ? bTop + Math.max(0, bubbleH - elziH) : bTop + bubbleH + ELZI_GAP;
  const bBottom = Math.max(bTop + bubbleH, bElzi + elziH);
  const below = { side: "below", bubbleTop: bTop, elziTop: bElzi, union: { top: ring.top, bottom: bBottom } };
  // above: bubble over the ring, Elzi at its far (top) end
  const aTop = ring.top - TAIL - bubbleH;
  const aElzi = beside ? aTop : aTop - ELZI_GAP - elziH;
  const aBlockTop = Math.min(aTop, aElzi);
  const above = { side: "above", bubbleTop: aTop, elziTop: aElzi, union: { top: aBlockTop, bottom: ring.top + ring.height } };
  for (const c of [below, above]) {
    if (c.side === "above" && aBlockTop < 0) continue;
    if (c.union.bottom - c.union.top <= fitH) return pack(c.side, c.bubbleTop, c.elziTop, c.union, true);
  }
  return pack("below", below.bubbleTop, below.elziTop, below.union, false);
};

/** Is `inner` wholly inside `outer`? (rects {top,left,width,height}, 1 px tolerance) */
export const rectInside = (inner, outer, tol = 1) => inner.top >= outer.top - tol && inner.left >= outer.left - tol
  && inner.top + inner.height <= outer.top + outer.height + tol && inner.left + inner.width <= outer.left + outer.width + tol;
/** Do two rects overlap (more than `tol` px)? */
export const rectsOverlap = (a, b, tol = 0.5) => Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left) > tol
  && Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top) > tol;
