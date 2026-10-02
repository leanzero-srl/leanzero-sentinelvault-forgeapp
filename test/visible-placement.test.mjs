import { visibleRoom, placeInBand } from "../src/ui/kit/visible-placement.js";
import { eq, report } from "./_assert.mjs";

// A menu 300px tall laid out at y=100..400 in the frame; `v` is the part on screen.
const entry = (vTop, vBottom, ratio = (vBottom - vTop) / 300) => ({
  boundingClientRect: { top: 100, bottom: 400 }, intersectionRect: { top: vTop, bottom: vBottom },
  isIntersecting: ratio > 0, intersectionRatio: ratio,
});
eq("below, all on screen → fits", visibleRoom(entry(100, 400, 1), false), { fits: true, room: 300 });
eq("below, screen ends at 250 → does not fit, 150 visible", visibleRoom(entry(100, 250), false), { fits: false, room: 150 });
eq("below, entirely off screen → room 0", visibleRoom(entry(0, 0, 0), false), { fits: false, room: 0 });
eq("above, all on screen → fits", visibleRoom(entry(100, 400, 1), true), { fits: true, room: 300 });
eq("above, screen starts at 180 → 220 visible from the trigger edge", visibleRoom(entry(180, 400), true), { fits: false, room: 220 });
// Dialogs (pillar 12 live finding): a 3,466 px frame, the window shows frame y 0..719.
const band = { top: 0, bottom: 719 };
eq("a 600px dialog anchored at 280 would end at 880: pulled up to end 16px inside the band", placeInBand({ desiredTop: 280, h: 600, band }), { top: 103, maxHeight: null });
eq("already inside: unchanged", placeInBand({ desiredTop: 50, h: 300, band }), { top: 50, maxHeight: null });
eq("above the band (scrolled page): pushed down into it", placeInBand({ desiredTop: 10, h: 300, band: { top: 900, bottom: 1700 } }), { top: 916, maxHeight: null });
eq("taller than the band: starts at its top and is capped", placeInBand({ desiredTop: 400, h: 900, band }), { top: 16, maxHeight: 687 });
eq("no band (no IntersectionObserver): as anchored before", placeInBand({ desiredTop: 280, h: 600, band: null }), { top: 280, maxHeight: null });
report("visible-placement");
