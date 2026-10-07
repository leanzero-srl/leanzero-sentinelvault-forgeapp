// A give-up timer that only counts while the frame is ON SCREEN (device matrix 2026-10-07).
//
// The sealed-section macro waits for Atlassian's ADF renderer to report a height, and gives up after
// RENDERER_WAIT_MS × 2 with "could not display this section's text". The renderer does not report
// while its frame is off-screen, so a sealed section below the fold — every laptop and phone in the
// walk, any long page — gave up before the reader scrolled to it and stayed broken; scrolled into
// view within the window it rendered in about a second. So the countdown runs only while the frame
// is visible (IntersectionObserver with the implicit root clips by every ancestor frame and the
// top-level viewport, as kit/visible-placement.js uses it) and restarts each time it comes back.
//
// visibleTimeout({ ms, onExpire, target, IO, setT, clearT }) → stop()
//   IO / setT / clearT are injectable for tests. No IntersectionObserver (or no target) → a plain
//   timeout, the old behaviour.
export function visibleTimeout({ ms, onExpire, target, IO = globalThis.IntersectionObserver, setT = setTimeout, clearT = clearTimeout }) {
  let timer = null;
  let done = false;
  let io = null;
  const disarm = () => { if (timer !== null) { clearT(timer); timer = null; } };
  const arm = () => {
    if (done || timer !== null) return;
    timer = setT(() => {
      timer = null;
      if (done) return;
      done = true;
      if (io) io.disconnect();
      onExpire();
    }, ms);
  };
  if (typeof IO === "function" && target) {
    io = new IO((entries) => {
      const e = entries[entries.length - 1];
      if (e && e.isIntersecting) arm(); else disarm();
    });
    io.observe(target);
  } else {
    arm();
  }
  return () => { done = true; disarm(); if (io) io.disconnect(); };
}
