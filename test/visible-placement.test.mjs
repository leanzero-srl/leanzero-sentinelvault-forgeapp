import { visibleRoom } from "../src/ui/kit/visible-placement.js";
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
report("visible-placement");
