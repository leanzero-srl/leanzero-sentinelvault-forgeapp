/*
 * ELZI'S TOUR ENGINE (ported from the Codegeist build, 2026-10-31) - ONE ENGINE FOR EVERY TOUR.
 *
 * Lives ONLY inside this app's own iframe: the dim layer, the ring and the bubble cover this frame
 * and nothing of Jira's page around it. The steps come from the host as data (the admin page's
 * nux/adminTours.js); every rule is in ./tourSteps.js (pure, tested offline); this file measures,
 * draws and listens.
 *
 *   - Opens by itself ONCE per person and per tour, when the host allows it: the mark
 *     (get-nux-tours / set-nux-tour, `tour: <key>`, src/shared/nux-tours.js) is written as
 *     "shown" the moment it opens, then "done" / "skipped"; a failed read never opens it. A host's
 *     "Take the tour" / "Tour" button sends `sv-nux:replay` {tour} and it opens.
 *   - Each step's element is found by its data-nux token; the rest of the frame is dimmed by four
 *     blocks AROUND it, so the element itself stays clickable.
 *   - Skip on every step, Esc closes, Arrow keys and the buttons move, Tab stays inside the
 *     bubble and the highlighted element, focus returns where it was; the step is announced
 *     through a polite live region; prefers-reduced-motion = no bob, no smooth scroll.
 * Owner UI rules: straight corners, solid colours, a hard offset shadow, the app's own buttons.
 */
import React, { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "../kit/bridge.js";
import Elzi from "./Elzi.jsx";
import TourReplay from "./TourReplay.jsx";
import { injectTourStyles } from "./tourStyles.js";
import {
  BOTTOM_RESERVE, EDGE, NUX_VERSION, RING_W, TAB_WAIT_MS, TOUR_INITIAL, anchorSelector, autoShownHere, markBrowserShown, wantsAutoStart, keyAction, markAutoShownHere, placeTour, poseFor,
  afterSeen, resolveSteps, sayFor, stepLabel, stepWords, stepsWithIntro, storedFor, tourButtonLabel, tourReducer,
} from "./tourSteps.js";
import { anyTourSeen, holdOpen, marksNow, noteMark, onMarks, openTourNow, readMarks, releaseOpen, tourOpenSince } from "./marks.js";

export const NUX_REPLAY_EVENT = "sv-nux:replay";
export const NUX_STEP_EVENT = "sv-nux:step";
// D10 - a tour button reads its words from here ("Take the tour" / "Replay tour"), per tour: the
// event carries {label, tour}; window.__svNuxLabels keeps the last label per tour for a button that
// draws after the answer (window.__svNuxLabel: the glance's main tour, gate or steward, as before).
export const NUX_LABEL_EVENT = "sv-nux:label";
const sayLabel = (stored, tour) => {
  const label = tourButtonLabel(stored);
  try {
    window.__svNuxLabels = { ...(window.__svNuxLabels || {}), [tour]: label };
    window.__svNuxLabel = label;
    window.dispatchEvent(new CustomEvent(NUX_LABEL_EVENT, { detail: { label, tour } }));
  } catch (e) { /* old browser */ }
};
const AUTO_WAIT_MS = 12000;     // how long the auto start waits for its view to draw
const AUTO_POLL_MS = 100;       // how often it looks (start <= 2 s after it draws)
// The marks are read ONCE as this chunk arrives (marks.js), so the answer is in before the view draws.
try { readMarks(); } catch (e) { /* no bridge (tests) */ }
// The buttons in the bubble use the host app's own classes (owner rule: the app's own buttons).
export const GLANCE_BTN = Object.freeze({ text: "btn-secondary", go: "btn-primary" });
// Under this measured frame width Elzi is drawn as her head only (owner 2026-10-29); under
// SMALL_W the bubble tightens too. Measured, never keyed off which module this is.
export const HEAD_ONLY_W = 480;
const SMALL_W = 360;
const BUBBLE_MAX_W = 380;
// Elzi's size. The head is 60 px wide (design review 2026-10-29: at 40 px she read as an avatar,
// not a character) in every glance, 256 px included; the full body is 80 px in her tile.
export const ELZI_HEAD_PX = 60;
const ELZI_BODY_PX = 80;
const HEAD_H = (ELZI_HEAD_PX * 336) / 292;   // ELZI_HEAD_VIEWBOX aspect
const BODY_H = (ELZI_BODY_PX * 640) / 664;   // ELZI_VIEWBOX aspect
// no tour given: no steps and no ready anchor, so it never opens and never writes a mark
const NO_TOUR = Object.freeze({ key: "none", steps: Object.freeze([]), ready: null, intro: "never" });
const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"]), input:not([disabled]), textarea:not([disabled])';

// the first element the anchor names that is drawn (a display:none copy has no box and is passed over)
const findAnchor = (name) => {
  if (!name) return null;
  try {
    for (const el of document.querySelectorAll(anchorSelector(name))) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) return el; }
  } catch (e) { /* a bad selector */ }
  return null;
};
const has = (name) => !!findAnchor(name);
const reducedMotion = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } };
const docBox = () => {
  const root = document.getElementById("root");
  const w = document.documentElement.clientWidth || window.innerWidth || 320;
  const contentH = root ? Math.ceil(root.getBoundingClientRect().bottom + window.scrollY) : document.documentElement.scrollHeight;
  return { w, contentH };
};
/*
 * The part of this frame a person can see right now, in document coordinates. A fresh
 * IntersectionObserver answers once on observe(); with the implicit root it measures against the
 * TOP-LEVEL window (Jira's), clipped by every scroll container round the iframe. No answer in
 * 300 ms (old browser): this window's own viewport.
 */
const visibleRect = () => new Promise((resolve) => {
  const doc = docBox();
  const H = Math.max(doc.contentH, document.documentElement.scrollHeight);
  const fallback = () => ({ top: window.scrollY, left: 0, width: doc.w, height: window.innerHeight });
  let s = null, io = null, done = false;
  const finish = (r) => { if (done) return; done = true; try { io && io.disconnect(); s && s.remove(); } catch (e) { /* gone */ } resolve(r); };
  try {
    s = document.createElement("div");
    s.className = "nux-sentinel";
    s.setAttribute("aria-hidden", "true");
    s.style.cssText = "position:absolute;top:0;left:0;width:1px;height:" + H + "px;pointer-events:none;opacity:0";
    document.body.appendChild(s);
    io = new IntersectionObserver((entries) => {
      const ir = entries[0] && entries[0].intersectionRect;
      if (!ir) return finish(fallback());
      finish({ top: ir.top + window.scrollY, left: 0, width: doc.w, height: ir.height });
    });
    io.observe(s);
    setTimeout(() => finish(fallback()), 300);
  } catch (e) { finish(fallback()); }
});
// Scroll so the element + the row are on screen together (crosses into Jira's page from the iframe).
// The scroll target carries BOTTOM_RESERVE px of clear space under the row (Jira's floating Rovo
// button sits over the window's bottom-right corner, tourSteps.js).
// The block scrolled to centre a step is kept for as long as the step is on screen (a timer that removed it shrank the page
// by however far its first-guess size differed from the real placement, and the browser slid the whole step by that much).
// Every step's block stays until the tour ends, so the page only ever grows during a tour (step N+1 never shrinks it).
let scrollBlocks = [];
const dropScrollBlock = () => { for (const b of scrollBlocks) { try { b.remove(); } catch (e) { /* gone */ } } scrollBlocks = []; };
const scrollUnionIntoView = (union) => {
  try {
    const t = document.createElement("div");
    t.setAttribute("aria-hidden", "true");
    t.style.cssText = "position:absolute;left:0;width:1px;pointer-events:none;opacity:0;top:" + Math.max(0, union.top - EDGE) + "px;height:" + Math.max(1, union.bottom - union.top + 2 * EDGE + BOTTOM_RESERVE) + "px";
    document.body.appendChild(t);
    scrollBlocks.push(t);
    t.scrollIntoView({ block: "center", behavior: "auto" }); // before anything is drawn: never animated
  } catch (e) { /* nothing to scroll */ }
};
const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
const settled = async () => { try { if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 400))]); } catch (e) { /* no fonts API */ } await frame(); };
const rectOf = (el) => {
  const r = el.getBoundingClientRect();
  return { top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height };
};

// THE TOUR IS DATA (owner 2026-10-30): `tour` = {key, steps, ready, intro, hello} (tourSteps.js), from the host.
//   autoStart  may it open by itself (once per person, its own mark)? The host decides the moment.
//   onStep     called with each step as it comes up (a step with `tab` asks the host to switch).
//   btn        the host app's button classes {text, go}.
export default function Tour({ steps: given = null, tour: givenTour = null, autoStart = true, oncePerBrowser = false, onStep = null, btn = GLANCE_BTN } = {}) {
  // LISTED BUILD: no glance tours ship (tourSteps.js), so a tour always comes from its host; none = nothing to show
  const tourDef = givenTour || NO_TOUR;
  const stepList = Array.isArray(given) ? given : tourDef.steps;
  const tourKey = tourDef.key;
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  const [st, dispatch] = useReducer(tourReducer, TOUR_INITIAL);
  const [steps, setSteps] = useState([]);
  const [stored, setStored] = useState(null);
  const [geo, setGeo] = useState(null);         // {hole, doc, callout:{top,left,width}, rel}
  const calloutHRef = useRef(0);
  const spacerMax = useRef(0);
  const calloutRef = useRef(null);
  const nextRef = useRef(null);
  const returnFocus = useRef(null);
  const autoDone = useRef(false);
  const mountedAt = useRef(Date.now());
  // Was the last input a key? (design review 2026-10-29: a mouse- or auto-opened tour must not land
  // on Next with its keyboard ring; keyboard users still get the focus on Next and :focus-visible.)
  const byKey = useRef(false);
  useEffect(() => {
    const onKey = (e) => { if (!["Shift", "Control", "Alt", "Meta"].includes(e.key)) byKey.current = true; };
    const onPointer = () => { byKey.current = false; };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => { document.removeEventListener("keydown", onKey, true); document.removeEventListener("pointerdown", onPointer, true); };
  }, []);
  const step = st.open ? steps[st.index] : null;
  const stepAt = useRef(0);
  useEffect(() => () => releaseOpen(tourKey), [tourKey]);
  const stepRef = useRef(null);
  stepRef.current = step;

  const start = useCallback(({ firstEver = false } = {}) => {
    const s = resolveSteps(has, Array.isArray(given) ? stepList : stepsWithIntro({ ...tourDef, steps: stepList }, { firstEver }));
    holdOpen(tourKey);
    setSteps(s);
    try { returnFocus.current = document.activeElement; } catch (e) { returnFocus.current = null; }
    dispatch({ type: "start", count: s.length });
  }, [stepList, tourKey]);

  // The stored mark, once (and the tour's sheet).
  useEffect(() => {
    injectTourStyles();
    let live = true;
    const take = (r) => { if (live) { const mine = storedFor(r, tourKey); setStored(mine); sayLabel(mine, tourKey); } };
    if (marksNow()) take(marksNow());
    readMarks().then(take);
    const off = onMarks(take);
    return () => { live = false; off(); };
  }, [tourKey]);

  // Auto start (owner 2026-10-30): once per person and tour, when its view has drawn (the view
  // sets data-nux="trail", the request view data-nux="steward-stages", only once their reads
  // answered). It is marked "shown" at once (KVS, and this tab's sessionStorage in case that write
  // fails), so a reload halfway through does not open it again. Its view not drawn within
  // AUTO_WAIT_MS (a failed read): no tour, and nothing is marked, so it waits for an issue that works.
  useEffect(() => {
    if (!autoStart || autoDone.current || !wantsAutoStart({ stored, key: tourKey, oncePerBrowser }) || autoShownHere(tourKey) || tourOpenSince(mountedAt.current)) return undefined;
    // a tour that comes after another (the activity list after the gate / steward tour) waits for its mark
    if (!afterSeen(tourDef, marksNow())) return undefined;
    const ready = tourDef.ready;
    const t0 = Date.now();
    const id = setInterval(() => {
      if (tourOpenSince(mountedAt.current)) { clearInterval(id); return; } // another tour ran first: this one waits for the next visit
      if (has(ready)) {
        clearInterval(id);
        if (autoDone.current) return;
        autoDone.current = true;
        // first tour this person ever sees? (asked BEFORE this one is marked)
        const firstEver = !anyTourSeen(marksNow());
        markAutoShownHere(tourKey);
        if (oncePerBrowser) markBrowserShown(tourKey);
        invoke("set-nux-tour", { version: NUX_VERSION, how: "shown", tour: tourKey }).catch(() => {});
        start({ firstEver });
        noteMark(tourKey, NUX_VERSION, "shown");
      } else if (Date.now() - t0 > AUTO_WAIT_MS) clearInterval(id);
    }, AUTO_POLL_MS);
    return () => clearInterval(id);
  }, [stored, start, tourKey, autoStart, oncePerBrowser, tourDef.ready]);

  // Replay from the trail's button.
  useEffect(() => {
    // the event names its tour ({detail:{tour}}); one without a name is the glance's main tour
    const onReplay = (e) => {
      const want = e && e.detail && e.detail.tour;
      if (!want || want !== tourKey) return;
      if (openTourNow() && openTourNow() !== tourKey) return;
      autoDone.current = true;
      start({ firstEver: !anyTourSeen(marksNow()) });
    };
    window.addEventListener(NUX_REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(NUX_REPLAY_EVENT, onReplay);
  }, [start]);

  // Finished or skipped: remember it, give focus back.
  useEffect(() => {
    if (st.open || !st.ended) return;
    invoke("set-nux-tour", { version: NUX_VERSION, how: st.ended, tour: tourKey }).catch(() => {});
    releaseOpen(tourKey);
    setStored({ ok: true, seen: true, version: NUX_VERSION });
    sayLabel({ ok: true, seen: true, version: NUX_VERSION }, tourKey);
    noteMark(tourKey, NUX_VERSION, st.ended);
    const back = returnFocus.current;
    setGeo(null);
    // the trail puts back the rows the tour opened or folded
    try { window.dispatchEvent(new CustomEvent(NUX_STEP_EVENT, { detail: { id: null, anchor: null, tour: tourKey } })); } catch (e) { /* old browser */ }
    try {
      if (back && back.isConnected && typeof back.focus === "function" && back !== document.body) back.focus();
      else { const b = document.querySelector(`[data-nux-replay="${tourKey}"]`) || document.querySelector('[data-testid="nux-replay"]'); if (b) b.focus(); }
    } catch (e) { /* nothing to focus */ }
  }, [st.open, st.ended, tourKey]);

  // Tell the trail which step is up (it opens the refused row for the refusal step).
  useEffect(() => {
    if (!step) return;
    try { window.dispatchEvent(new CustomEvent(NUX_STEP_EVENT, { detail: { id: step.id, anchor: step.anchor, tour: tourKey } })); } catch (e) { /* old browser */ }
    stepAt.current = Date.now();
    if (typeof onStepRef.current === "function") { try { onStepRef.current(step); } catch (e) { /* the host's switch failed: the step waits, then drops */ } }
  }, [step && step.id]);

  // ── GEOMETRY (owner 2026-10-29: never clipped, never over the target) ─────────────────────
  // 1. the step's element (or a narrower one, when the element and the bubble cannot be seen
  //    together); 2. the part of this frame a person sees NOW (visibleRect: an IntersectionObserver
  //    against Jira's window, so Jira's own scroll and clipping count); 3. placeTour puts the bubble
  //    against the ring (below or above, tail on the target) and Elzi at its far end; 4. if that union is not on screen, it is scrolled
  //    into view (scrollIntoView crosses into Jira's page) and measured again. Re-measured on a
  //    short timer while open (Jira's scroll fires no event in here), on resize and content change.
  const geoKey = useRef("");
  const scrolledFor = useRef("");
  const sidewaysFor = useRef("");
  const scrolledAt = useRef(0);
  const rejected = useRef(new Set()); // anchors of this step that did not fit on screen even after the scroll
  const runRef = useRef(0);
  /* ONE PLACEMENT, FROM FINAL NUMBERS (owner gate 2026-11-02; the LeanZero Management lane found the defect in this
     shared engine: a step drawn ~300 ms off, its tail inside the ring). Four causes, all fixed here:
       - every measure run has a number and an older run stops when a newer one starts (stale()), so a step never draws
         from the previous step's numbers;
       - the bubble's height was guessed and corrected AFTER it was drawn (the side flipped late). The bubble element is
         always in the DOM (hidden until placed), is given the width the placement chose, and its REAL height is read
         BEFORE anything is drawn (up to 3 rounds until the height stops changing);
       - the scroll that brings the step into view ran after the first draw. It now runs BEFORE: scroll, wait for fonts and
         two frames, read the visible window again, then place;
       - the target's box was read once. It is read again a frame later until it holds still (up to 8 frames). */
  const measureNow = useCallback(async () => {
    if (!step) return;
    const run = ++runRef.current;
    const stale = () => run !== runRef.current || stepRef.current !== step;
    const drop = () => { setSteps((list) => { const left = list.filter((x) => x.id !== step.id); dispatch({ type: "recount", count: left.length }); return left; }); };
    let visible = await visibleRect();
    if (stale()) return;
    let doc = docBox();
    const small = doc.w < SMALL_W;
    const headOnly = doc.w < HEAD_ONLY_W;
    const elziW = headOnly ? ELZI_HEAD_PX : ELZI_BODY_PX;
    const elziH = Math.round(headOnly ? HEAD_H : BODY_H);
    // a step on another tab finds its anchor once that tab has drawn (up to TAB_WAIT_MS, then dropped)
    let anchorName = step.anchor;
    if (step.late) {
      anchorName = step.anchors.find((a) => has(a)) || null;
      if (!anchorName) {
        if (Date.now() - stepAt.current < TAB_WAIT_MS) { setTimeout(() => { if (stepRef.current === step) measure(); }, 150); return; }
        drop();
        return;
      }
    }
    const tokens = anchorName ? [anchorName, ...(step.narrower || [])] : [null];
    const usable = tokens.filter((t, i) => i === tokens.length - 1 || !rejected.current.has(t));
    const firstEl = () => usable.map((t) => (t ? findAnchor(t) : null)).find(Boolean) || null;
    if (anchorName && !firstEl()) {
      if (step.late) { setTimeout(() => { if (stepRef.current === step) measure(); }, 150); return; }
      setSteps((list) => { const left = list.filter((x) => x.id === step.id ? false : (!x.anchors.length || x.late || x.anchors.some((a) => has(a)))); dispatch({ type: "recount", count: left.length }); return left; });
      return;
    }
    // where the bubble goes, for a given bubble height: the first anchor whose ring, bubble and Elzi fit the visible window
    const placeAt = (bubbleH) => {
      let el = null, target = null, place = null;
      for (const t of usable) {
        const e = t ? findAnchor(t) : null;
        if (t && !e) continue;
        const r = e ? rectOf(e) : null;
        const pl = placeTour({ target: r, visible, frameW: doc.w, bubbleH, elziW, elziH });
        if (!place || pl.fits) { el = e; target = r; place = pl; }
        if (pl.fits) break;
      }
      return { el, target, place };
    };
    // an element cut off at the frame's side (a tab button in the phone's swipe strip): its own scroller brings it in sideways first
    const sk = `${step.id}|${doc.w}`;
    const el0 = firstEl();
    if (el0 && sidewaysFor.current !== sk) {
      const r0 = rectOf(el0);
      if (r0.left < 0 || r0.left + r0.width > doc.w) {
        sidewaysFor.current = sk;
        try { el0.scrollIntoView({ block: "nearest", inline: "center", behavior: "auto" }); } catch (e) { /* old browser */ }
        await settled();
        if (stale()) return;
      }
    }
    // ALWAYS centred once per step, BEFORE anything is drawn (Jira draws sticky bars over the top of this frame, which
    // nothing in here can measure: centring keeps clear of them), then the visible window is read again
    if (scrolledFor.current !== sk) {
      scrolledFor.current = sk;
      const p0 = placeAt(calloutHRef.current || 170).place;
      if (p0) {
        scrollUnionIntoView(p0.union);
        await settled();
        if (stale()) return;
        visible = await visibleRect();
        if (stale()) return;
        doc = docBox();
      }
    }
    // the target's box AND the page's height, read until both hold still for three reads in a row (a scroll Jira finishes
    // late, a font that lands, content that settles after the first paint: nothing is drawn on a page that is still moving)
    {
      let prev = null, same = 0;
      for (let i = 0; i < 24; i++) {
        const e = firstEl();
        const r = JSON.stringify([e ? rectOf(e) : null, docBox().contentH]);
        if (r === prev) { same += 1; if (same >= 2) break; } else same = 0;
        prev = r;
        await frame();
        if (stale()) return;
      }
      doc = docBox();
    }
    // the bubble gets the width the placement chose, and its real height decides the placement (3 rounds)
    let bubbleH = calloutHRef.current || 170;
    let at = placeAt(bubbleH);
    for (let i = 0; i < 3 && at.place; i++) {
      const probe = calloutRef.current;
      if (!probe) break;
      probe.style.width = `${at.place.width}px`;
      const h = Math.ceil(probe.getBoundingClientRect().height);
      if (!h || Math.abs(h - bubbleH) <= 1) break;
      bubbleH = h;
      at = placeAt(bubbleH);
    }
    calloutHRef.current = bubbleH;
    const { el, target, place } = at;
    if (!place || stale()) return;
    const rel = target ? { above: place.look[1] < 0, left: place.look[0] < 0 } : null;
    const anchorTok = el ? usable.find((t) => t && findAnchor(t) === el) || null : null;
    const say = sayFor(step, el);
    const next = { hole: target, anchor: anchorTok, say, doc, small, headOnly, elziW, rel, visible, fits: place.fits, side: place.side, mode: place.mode,
      ring: place.ring, tail: place.tail, look: place.look, elzi: place.elzi, callout: { top: place.top, left: place.left, width: place.width } };
    const key = JSON.stringify([say, anchorTok, next.hole, next.callout, next.elzi, next.tail, Math.round(visible.top), Math.round(visible.height), doc.w, doc.contentH, headOnly, place.fits]);
    if (key !== geoKey.current) { geoKey.current = key; setGeo(next); }
  }, [step]);
  /* ONE MEASURE AT A TIME (2026-11-03, seen under load: the 500 ms timer, the ResizeObserver and scroll each started a new run,
     and a run that took longer than 500 ms was always made stale by the next one, so a step was never drawn). A trigger while a
     run is in flight only asks for one more run after it; a new step (force) supersedes the old run at once. */
  const inFlight = useRef(0);
  const again = useRef(false);
  const measure = useCallback((force = false) => {
    if (inFlight.current && force !== true) { again.current = true; return; }
    const p = measureNow();
    const mine = runRef.current;
    inFlight.current = mine || -1;
    Promise.resolve(p).catch(() => {}).finally(() => {
      if (inFlight.current !== (mine || -1)) return;
      inFlight.current = 0;
      if (again.current) { again.current = false; measure(); }
    });
  }, [measureNow]);

  // A new step draws nothing until it is measured (never the last step's placement for a moment).
  useLayoutEffect(() => { scrolledFor.current = ""; geoKey.current = ""; calloutHRef.current = 0; rejected.current = new Set(); setGeo(null); again.current = false; measure(true); }, [measure, st.index, st.open]);

  // the tour is over (or this component goes): the centring block goes with it
  useEffect(() => { if (!st.open) dropScrollBlock(); }, [st.open]);
  useEffect(() => dropScrollBlock, []);

  useEffect(() => {
    if (!st.open) return undefined;
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, { passive: true });
    const timer = setInterval(() => measure(), 500);
    let ro = null;
    try { ro = new ResizeObserver(() => measure()); ro.observe(document.getElementById("root") || document.body); } catch (e) { ro = null; }
    return () => { window.removeEventListener("resize", onResize); window.removeEventListener("scroll", onResize); clearInterval(timer); if (ro) ro.disconnect(); };
  }, [st.open, measure]);

  // The row's real height (placement needs it); a change re-measures.
  useLayoutEffect(() => {
    const el = calloutRef.current;
    if (!el) return;
    const h = Math.ceil(el.getBoundingClientRect().height);
    if (h && Math.abs(h - (calloutHRef.current || 0)) > 2) { calloutHRef.current = h; geoKey.current = ""; measure(); }
  });

  // Focus on every step: Next when the tour is driven by keys (Enter on Replay, arrows, Enter on
  // Next), else the bubble itself (role=dialog, tabIndex -1, no ring): an auto start or a click
  // does not paint the keyboard ring on Next, and Tab from the bubble reaches the buttons.
  useEffect(() => {
    if (!st.open || !geo) return undefined;
    const t = setTimeout(() => {
      try {
        const want = byKey.current ? nextRef.current : calloutRef.current;
        if (want && document.activeElement !== want) want.focus({ preventScroll: true });
      } catch (e) { /* no-op */ }
    }, 30);
    return () => clearTimeout(t);
  }, [st.open, st.index, !!geo]);

  // Keys: Esc / arrows anywhere in the frame; Tab trapped in bubble + highlighted element.
  useEffect(() => {
    if (!st.open) return undefined;
    const onKey = (e) => {
      if (e.key === "Tab") {
        const anchorEl = step && step.anchor ? findAnchor(step.anchor) : null;
        const inBubble = calloutRef.current ? [...calloutRef.current.querySelectorAll(FOCUSABLE)] : [];
        const inAnchor = anchorEl ? [...(anchorEl.matches(FOCUSABLE) ? [anchorEl] : []), ...anchorEl.querySelectorAll(FOCUSABLE)] : [];
        const ring = [...inAnchor, ...inBubble];
        if (!ring.length) return;
        const i = ring.indexOf(document.activeElement);
        e.preventDefault();
        const n = i < 0 ? 0 : (i + (e.shiftKey ? -1 : 1) + ring.length) % ring.length;
        ring[n].focus();
        return;
      }
      const tag = (e.target && e.target.tagName) || "";
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && /INPUT|TEXTAREA/.test(tag)) return;
      const a = keyAction(e.key, { index: st.index });
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      dispatch({ type: a });
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [st.open, st.index, step]);

  // a module with no tour button of its own in its view (tour def `replay`, the activity list) gets the
  // small shared "Tour" button here, drawn open or closed so the list under it never moves
  const replay = tourDef.replay ? <TourReplay tour={tourKey} /> : null;
  if (!st.open || !step) return replay;
  const last = st.index + 1 >= st.count;
  // before the first placement the hidden bubble is the height probe: it must wear the same size class the drawn one will
  const frameWNow = geo ? geo.doc.w : (typeof document !== "undefined" && document.documentElement.clientWidth) || 0;
  const small = geo ? geo.small : (frameWNow > 0 && frameWNow < SMALL_W);
  const headOnly = geo ? geo.headOnly : (frameWNow > 0 && frameWNow < HEAD_ONLY_W);
  const pose = poseFor(step, geo ? geo.rel : null);
  // a step may say it differently for the element that won (`textBy`, e.g. a phone's other button)
  // and other words for what the element is showing (`say`, e.g. a demo that is already Ready)
  const { title, text } = stepWords(step, { anchor: geo ? geo.anchor : null, say: geo ? geo.say : null });
  // a title that ends in its own stop ("Hi! I'm Elzi.") gets no second one
  const live = `${stepLabel(st.index, st.count)}. ${/[.!?]$/.test(title) ? title : `${title}.`} ${text}`;
  const doc = geo ? geo.doc : { w: 0, contentH: 0 };
  const bottomOf = (r) => (r ? r.top + r.height : 0);
  const calloutBottom = geo ? Math.max(geo.callout.top + (calloutHRef.current || 150), bottomOf(geo.elzi)) : 0;
  // room under the row for the scroll's clear space (BOTTOM_RESERVE, Jira's floating button)
  const hole = geo ? geo.hole : null;
  // The same room scrollUnionIntoView gives its temporary block under the row (EDGE + BOTTOM_RESERVE): when that block goes
  // away 800 ms later the page must be as tall as it was, or the browser clamps the scroll and the whole step slides 16 px.
  const padBottom = BOTTOM_RESERVE + EDGE;
  // the room under the content only grows while the tour is open: a shorter step after a taller one must not shrink the page
  if (!st.open) spacerMax.current = 0;
  else if (geo) spacerMax.current = Math.max(spacerMax.current, calloutBottom + padBottom - doc.contentH);
  const spacerH = Math.max(0, spacerMax.current);
  const fullH = Math.max(doc.contentH, calloutBottom + padBottom);
  const ring = geo ? geo.ring : null;
  const dimBlocks = hole
    ? [
      { top: 0, left: 0, width: "100%", height: hole.top },
      { top: hole.top + hole.height, left: 0, width: "100%", height: Math.max(0, fullH - hole.top - hole.height) },
      { top: hole.top, left: 0, width: hole.left, height: hole.height },
      { top: hole.top, left: hole.left + hole.width, width: Math.max(0, doc.w - hole.left - hole.width), height: hole.height },
    ]
    : [{ top: 0, left: 0, width: "100%", height: fullH }];
  const tail = geo ? geo.tail : null;
  const tailStyle = tail ? (tail.dir === "up" || tail.dir === "down" ? { left: tail.at } : { top: tail.at }) : null;

  return <>{replay}{createPortal(
    <div className={`nux${small ? " nux-small" : ""}${headOnly ? " nux-head" : ""}`} data-nux-tour={tourKey} data-nux-step={step.id} data-nux-anchor={geo && geo.anchor ? geo.anchor : undefined} data-nux-said={geo && geo.say ? geo.say : undefined}
      data-nux-fits={geo ? String(geo.fits) : undefined} data-nux-side={geo ? geo.side : undefined} data-nux-mode={geo ? geo.mode : undefined}>
      {/* the frame grows when the bubble sits below the content (the iframe is sized to it) */}
      {spacerH > 0 && <div className="nux-spacer" style={{ height: spacerH }} aria-hidden="true" />}
      <div className="nux-dim" aria-hidden="true">
        {dimBlocks.map((b, i) => <div key={i} className="nux-dim-block" style={b} />)}
      </div>
      {/* the ring: RING_GAP px OUTSIDE the cut-out (which stays the element's exact rect) */}
      {ring && <div className="nux-ring" aria-hidden="true" style={{ top: ring.top, left: ring.left, width: ring.width, height: ring.height, borderWidth: RING_W }} />}
      <div className="nux-live" aria-live="polite" role="status">{live}</div>
      {geo && (
        <div className="nux-elzi-wrap" aria-hidden="true" style={{ top: geo.elzi.top, left: geo.elzi.left }}>
          <Elzi pose={pose} face={step.face || "idle"} look={geo.look} head={headOnly} size={geo.elziW} />
        </div>
      )}
      {(
        <div
          ref={calloutRef}
          className="nux-callout nux-bubble"
          role="dialog"
          tabIndex={-1}
          aria-labelledby="nux-title"
          aria-describedby="nux-text"
          data-tail={tail ? tail.dir : undefined}
          style={geo ? { top: geo.callout.top, left: geo.callout.left, width: geo.callout.width } : { top: 0, left: 0, width: Math.min(BUBBLE_MAX_W, Math.max(0, (doc.w || document.documentElement.clientWidth || 320) - 2 * EDGE)), visibility: "hidden" }}
        >
          {tail && <span className={`nux-tail nux-tail-${tail.dir}`} style={tailStyle} aria-hidden="true" />}
          <div className="nux-count">{stepLabel(st.index, st.count)}</div>
          <div className="nux-title" id="nux-title">{title}</div>
          <p className="nux-text" id="nux-text">{text}</p>
          <div className="nux-btns">
            {/* one subtle style (Skip, Back) and one primary (Next / Done) */}
            <button type="button" className={`${btn.text} nux-skip`} data-testid="nux-skip" onClick={() => dispatch({ type: "skip" })}>
              Skip
            </button>
            <span className="nux-btns-go">
              {st.index > 0 && (
                <button type="button" className={`${btn.text} nux-back`} data-testid="nux-back" onClick={() => dispatch({ type: "back" })}>Back</button>
              )}
              {last
                ? <button ref={nextRef} type="button" className={btn.go} data-testid="nux-done" onClick={() => dispatch({ type: "next" })}>Done</button>
                : <button ref={nextRef} type="button" className={btn.go} data-testid="nux-next" onClick={() => dispatch({ type: "next" })}>Next</button>}
            </span>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )}</>;
}
