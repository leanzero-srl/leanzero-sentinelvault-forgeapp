// Keep a dropdown menu inside what the person can actually SEE (tester 2026-09-30: the level menu on
// a space row opened below the screen's bottom edge). An app frame is as tall as its content and
// Confluence scrolls the page around it, so the frame's own window.innerHeight says nothing about
// the visible part — and a cross-origin frame cannot read the host's scroll. IntersectionObserver
// with the implicit root can: it clips the target by every ancestor frame and the top-level
// viewport, which is exactly "the part on screen".
//
// useVisiblePlacement(open, menuRef) → { up, maxHeight, ready }
//   pass 1: the menu is laid out below the trigger, invisible (`ready` false). Fully visible → done.
//           Cut off at the bottom → try above.
//   pass 2: above. Fully visible → done. Cut off there too → take whichever side shows more and
//           cap the menu's height to that visible room (it scrolls inside).
// No IntersectionObserver, or no answer within 300 ms → shown below, as before.
import { useEffect, useState } from "react";

const MIN_HEIGHT = 120;
const GAP = 8;
const INITIAL = Object.freeze({ up: false, maxHeight: null, ready: false, pass: 1, below: 0 });

// PURE. What one observation says about a placement: fully visible, or how much of it is on screen
// measured from the edge that touches the trigger.
export function visibleRoom(entry, up) {
  const b = entry.boundingClientRect;
  const v = entry.intersectionRect;
  if (!entry.isIntersecting || entry.intersectionRatio <= 0) return { fits: false, room: 0 };
  const fits = up ? v.top <= b.top + 1 : v.bottom >= b.bottom - 1;
  return { fits, room: up ? b.bottom - v.top : v.bottom - b.top };
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
      const { fits, room } = visibleRoom(entries[entries.length - 1], place.up);
      if (fits) { setPlace((p) => ({ ...p, ready: true })); return; }
      if (place.pass === 1) { setPlace({ up: true, maxHeight: null, ready: false, pass: 2, below: room }); return; }
      // Neither side shows the whole menu: the side with more room, scrolled inside.
      const upWins = room >= place.below;
      const best = upWins ? room : place.below;
      setPlace({ up: upWins, maxHeight: Math.max(MIN_HEIGHT, Math.floor(best - GAP)), ready: true, pass: 2, below: place.below });
    });
    io.observe(el);
    const t = setTimeout(() => { if (!done) { done = true; io.disconnect(); setPlace((p) => ({ ...p, ready: true })); } }, 300);
    return () => { done = true; io.disconnect(); clearTimeout(t); };
  }, [open, place.ready, place.pass, place.up, place.below, menuRef]);

  return { up: place.up, maxHeight: place.maxHeight, ready: place.ready };
}
