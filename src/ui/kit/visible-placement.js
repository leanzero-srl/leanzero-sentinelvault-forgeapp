// Keep a dropdown menu inside what the person can actually SEE (tester 2026-09-30: the level menu on
// a space row opened below the screen's bottom edge). An app frame is as tall as its content and
// Confluence scrolls the page around it, so the frame's own window.innerHeight says nothing about
// the visible part — and a cross-origin frame cannot read the host's scroll. IntersectionObserver
// with the implicit root can: it clips the target by every ancestor frame and the top-level
// viewport, which is exactly "the part on screen".
//
// useVisiblePlacement(open, menuRef) → { up, maxHeight, ready, cutX }
//   pass 1: the menu is laid out below the trigger, invisible (`ready` false). Fully visible → done.
//           Cut off at the bottom → try above. The same observation says whether the menu runs
//           past ONE side (`cutX` "left" | "right" | null — device matrix 2026-10-06: the Space
//           defaults level menu ran past the frame's right edge at 1280, the details modal's
//           "Move to…" menu 62-67 px past its left edge on every phone); the caller then anchors
//           the menu to the trigger's other edge.
//   pass 2: above. Fully visible → done. Cut off there too → take whichever side shows more and
//           cap the menu's height to that visible room (it scrolls inside).
// No IntersectionObserver, or no answer within 300 ms → shown below, as before.
import { useEffect, useState } from "react";

const MIN_HEIGHT = 120;
const GAP = 8;
const INITIAL = Object.freeze({ up: false, maxHeight: null, ready: false, pass: 1, below: 0, cutX: null });

// PURE. What one observation says about a placement: fully visible, or how much of it is on screen
// measured from the edge that touches the trigger.
export function visibleRoom(entry, up) {
  const b = entry.boundingClientRect;
  const v = entry.intersectionRect;
  if (!entry.isIntersecting || entry.intersectionRatio <= 0) return { fits: false, room: 0 };
  const fits = up ? v.top <= b.top + 1 : v.bottom >= b.bottom - 1;
  return { fits, room: up ? b.bottom - v.top : v.bottom - b.top };
}

// PURE. Which side of the screen (or frame) cuts the menu: "left", "right", or null when neither
// or both do (a menu wider than what is visible is left where it is).
export function horizontalCut(entry) {
  if (!entry || !entry.isIntersecting || entry.intersectionRatio <= 0) return null;
  const b = entry.boundingClientRect;
  const v = entry.intersectionRect;
  if (b.left == null || v.left == null) return null;
  const cutLeft = v.left > b.left + 1;
  const cutRight = v.right < b.right - 1;
  if (cutRight && !cutLeft) return "right";
  if (cutLeft && !cutRight) return "left";
  return null;
}

export function useVisiblePlacement(open, menuRef) {
  const [place, setPlace] = useState(INITIAL);

  // Reset on CLOSE, so the next open starts measuring from its first frame (never a flash of the
  // previous placement).
  useEffect(() => {
    if (!open) setPlace(INITIAL);
  }, [open]);

  useEffect(() => {
    if (!open || place.ready) return undefined;
    const el = menuRef.current;
    if (!el || typeof IntersectionObserver === "undefined") { setPlace((p) => ({ ...p, ready: true })); return undefined; }
    let done = false;
    const io = new IntersectionObserver((entries) => {
      if (done) return;
      done = true;
      io.disconnect();
      const entry = entries[entries.length - 1];
      const { fits, room } = visibleRoom(entry, place.up);
      // The horizontal verdict comes from the first look (the menu's x does not depend on up/down).
      const cutX = place.pass === 1 ? horizontalCut(entry) : place.cutX;
      if (fits) { setPlace((p) => ({ ...p, ready: true, cutX })); return; }
      if (place.pass === 1) { setPlace({ up: true, maxHeight: null, ready: false, pass: 2, below: room, cutX }); return; }
      // Neither side shows the whole menu: the side with more room, scrolled inside.
      const upWins = room >= place.below;
      const best = upWins ? room : place.below;
      setPlace({ up: upWins, maxHeight: Math.max(MIN_HEIGHT, Math.floor(best - GAP)), ready: true, pass: 2, below: place.below, cutX });
    });
    io.observe(el);
    const t = setTimeout(() => { if (!done) { done = true; io.disconnect(); setPlace((p) => ({ ...p, ready: true })); } }, 300);
    return () => { done = true; io.disconnect(); clearTimeout(t); };
  }, [open, place.ready, place.pass, place.up, place.below, place.cutX, menuRef]);

  return { up: place.up, maxHeight: place.maxHeight, ready: place.ready, cutX: place.cutX };
}

// ── Dialogs: keep the WHOLE dialog inside the band of the frame that is on screen ─────────────
// Found 2026-10-02 (pillar 12 live proof): the site console's frame is 3,466 px tall inside a
// 900 px window; a dialog anchored near the click opened with its footer at y=946, below the
// window — the buttons could not be seen, and a real mouse click there never reached the frame.

/**
 * The part of this frame's document that is on screen, in the frame's own coordinates
 * ({ top, bottom }), or null when it cannot be told (no IntersectionObserver, no answer in 300 ms).
 */
export function measureVisibleBand(target = typeof document !== "undefined" ? document.documentElement : null) {
  return new Promise((resolve) => {
    if (!target || typeof IntersectionObserver === "undefined") { resolve(null); return; }
    let done = false;
    const finish = (v) => { if (!done) { done = true; io.disconnect(); clearTimeout(t); resolve(v); } };
    const io = new IntersectionObserver((entries) => {
      const e = entries[entries.length - 1];
      if (!e || !e.isIntersecting) { finish(null); return; }
      const r = e.intersectionRect;
      // left/right too (SV-18): on a phone Confluence keeps its content 700 px wide, so a 620 px
      // console frame runs past the 390 px screen and a centred dialog opened half off it.
      finish(r.bottom - r.top > 0 ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null);
    });
    io.observe(target);
    const t = setTimeout(() => finish(null), 300);
  });
}

/**
 * PURE. Where a dialog of height `h` goes so all of it is on screen: as close to `desiredTop` as the
 * visible `band` allows, 16 px from its edges. Taller than the band → it starts at the band's top
 * and gets `maxHeight` (its body scrolls). No band → `desiredTop`, unchanged.
 */
/**
 * PURE. Horizontally, when the frame is WIDER than the part on screen (a 620 px frame on a 390 px
 * phone — Confluence's 700 px minimum content width, device matrix SV-18): centre the dialog in the
 * visible band and cap its width to it. Returns null when the whole width is on screen (the CSS
 * centring is right) or nothing is known.
 */
export function placeInBandX({ w, band, frameWidth, margin = 16 }) {
  if (!band || band.left == null || band.right == null || !(frameWidth > 0)) return null;
  const bw = band.right - band.left;
  if (bw <= 0 || bw >= frameWidth - 2) return null;
  const maxWidth = Math.max(160, Math.floor(bw - 2 * margin));
  const width = Math.min(w || maxWidth, maxWidth);
  return { left: Math.round(band.left + Math.max(margin, (bw - width) / 2)), maxWidth };
}

export function placeInBand({ desiredTop, h, band, margin = 16 }) {
  if (!band) return { top: desiredTop, maxHeight: null };
  const room = band.bottom - band.top - 2 * margin;
  if (room <= 0) return { top: desiredTop, maxHeight: null };
  if (h > room) return { top: Math.round(band.top + margin), maxHeight: Math.floor(room) };
  const lo = band.top + margin;
  const hi = band.bottom - margin - h;
  return { top: Math.round(Math.min(hi, Math.max(lo, desiredTop))), maxHeight: null };
}
