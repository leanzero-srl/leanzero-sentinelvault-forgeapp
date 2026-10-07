// The pure decisions behind the 2026-10-07 responsive pass (device matrix 2026-10-06): where the
// "Not applied yet" reminder goes, which edge a menu anchors to, where a dialog sits on a phone,
// which modal size the banner opens, how an actor is named, and the API lists' display names.
import { placeFloat } from "../src/ui/kit/float-placement.js";
import { horizontalCut, placeInBandX } from "../src/ui/kit/visible-placement.js";
import { detailsModalSize } from "../src/ui/kit/modal-size.js";
import { actorName, looksLikeAccountId } from "../src/ui/kit/activity-format.js";
import { withDisplayNames } from "../src/server/capsules/config-api/display-names.js";
import { revealAboveDelta } from "../src/ui/kit/reveal-above.js";
import { eq, ok, report } from "./_assert.mjs";

// ── SV-10 / BR-03: the reminder covers no control and no TEXT, and sits near the control used ──
const box = (left, top, right, bottom) => ({ left, top, right, bottom });
const hit = (s, sz, rects) => rects.filter((r) => s.left < r.right && s.left + (s.width ?? sz.width) > r.left && s.top < r.bottom && s.top + sz.height > r.top).length;
const FULL = { width: 480, height: 43 };
const COMPACT = { width: 270, height: 40 };

// A desktop settings list (site settings at 1440, the breaker's float-steward-laptop-1440): row A was
// toggled; row B's name and description sit right under it — round 1 put the reminder on them.
const rowZ = { label: box(65, 97, 300, 113), desc: box(65, 117, 680, 133), eff: box(65, 138, 192, 155), toggle: box(909, 97, 945, 117) };
const rowA = { label: box(65, 187, 339, 203), desc: box(65, 207, 627, 223), eff: box(65, 228, 192, 245), toggle: box(909, 187, 945, 207), row: box(41, 173, 969, 260) };
const rowB = { label: box(65, 278, 302, 294), desc: box(65, 298, 702, 314), eff: box(65, 319, 192, 336), toggle: box(909, 278, 945, 298) };
const rowC = { label: box(65, 368, 290, 384), desc: box(65, 388, 660, 404), toggle: box(909, 368, 945, 388) };
const deskControls = [rowZ.toggle, rowA.toggle, rowB.toggle, rowC.toggle];
const deskText = [rowZ.label, rowZ.desc, rowZ.eff, rowA.label, rowA.desc, rowA.eff, rowB.label, rowB.desc, rowB.eff, rowC.label, rowC.desc];
const desk = placeFloat({ target: rowA.toggle, anchor: rowA.row, size: FULL, compact: COMPACT, view: { width: 1010, height: 2000, left: 0, right: 1010, top: 0, bottom: 900 }, controls: deskControls, content: deskText });
eq("desktop list: a clear spot near the toggle (full form)", [desk.spot, desk.compact], ["clear", false]);
eq("…covering no control", hit(desk, FULL, deskControls), 0);
eq("…and no text: not the next setting's name or description (BR-03)", hit(desk, FULL, deskText), 0);
ok("…between the row above's last line and row B's name (beside the touched row)", desk.top >= rowZ.eff.bottom && desk.top + FULL.height <= rowB.label.top);

// The Validations tab after "+ Add rule" at a 834 px frame (the round-1 offline shot put it over the
// "1 required global rule always applies" sentence): the free strip left of the button.
const val = {
  text: [box(16, 380, 750, 396), box(16, 398, 92, 413), box(16, 442, 55, 458), box(29, 535, 140, 551), box(29, 565, 200, 583)],
  controls: [box(440, 292, 794, 312), box(440, 320, 794, 336), box(440, 348, 794, 364), box(732, 435, 818, 465), box(29, 490, 208, 526), box(217, 490, 396, 526), box(781, 497, 805, 521), box(29, 560, 805, 590)],
};
const add = val.controls[3];
const v = placeFloat({ target: add, anchor: box(16, 435, 818, 465), size: FULL, compact: COMPACT, view: { width: 834, height: 1700, top: 0, bottom: 900, left: 0, right: 834 }, controls: val.controls, content: val.text });
eq("validations add-rule: clear", v.spot.startsWith("clear"), true);
eq("…no control (the new rule's pickers and × stay free)", hit(v, v.compact ? COMPACT : FULL, val.controls), 0);
eq("…no text", hit(v, v.compact ? COMPACT : FULL, val.text), 0);
ok("…beside the button it was asked from (within 60 px of it)", Math.abs(v.top - add.top) <= 60);

// A stacked row on a 390 px phone (frame 636, band 0-390): label, two description lines, the default
// line, the toggle on its own line. The full reminder wraps to ~80 px and fits nowhere near; the
// compact one sits to the right of the toggle.
const phoneText = [box(24, 100, 300, 118), box(24, 120, 370, 136), box(24, 138, 360, 154), box(24, 158, 150, 174), box(24, 236, 280, 254), box(24, 256, 372, 272), box(24, 274, 330, 290)];
const phoneControls = [box(24, 184, 68, 208), box(24, 314, 68, 338)];
const ph = placeFloat({ target: phoneControls[0], anchor: box(0, 86, 636, 222), size: { width: 374, height: 80 }, compact: COMPACT, view: { width: 636, height: 3000, left: 0, right: 390, top: 0, bottom: 760 }, controls: phoneControls, content: phoneText });
eq("phone stacked row: the compact form, clear, beside the toggle", [ph.spot, ph.compact], ["clear-compact", true]);
ok("…inside the visible band (0-390)", ph.left >= 6 && ph.left + COMPACT.width <= 390 - 6);
eq("…covering nothing", hit(ph, COMPACT, [...phoneControls, ...phoneText]), 0);

// LIVE geometry, phone-360 space console > Validations (dev 7b271ec, 2026-10-07): the frame shows
// 0-320 x 0-545; the box ticked is "Flag with a comment". The one clear spot is right of the
// "Enable content validation" switch, and a 225 px compact form 8 px from the edge missed it by 3 px
// and covered "Enforcement". Edge 6 + the 219 px form fit it.
{
  const B = (a) => box(...a);
  const live = { target: [40, 466, 409, 496], band: [0, 0, 320, 545], controls: [[20, 137, 162, 177], [166, 137, 308, 177], [312, 137, 454, 177], [458, 137, 600, 177], [20, 181, 162, 221], [166, 181, 308, 221], [312, 181, 454, 221], [40, 343, 84, 369], [40, 466, 409, 496], [44, 469, 68, 493], [40, 504, 409, 534], [44, 507, 68, 531], [40, 542, 409, 572], [44, 545, 68, 569], [517, 606, 604, 646]], content: [[54, 149, 128, 165], [190, 149, 284, 165], [341, 149, 425, 165], [510, 149, 548, 165], [56, 193, 126, 209], [208, 193, 266, 209], [360, 193, 406, 209], [40, 256, 206, 273], [40, 278, 572, 293], [40, 296, 543, 311], [40, 314, 109, 329], [40, 398, 124, 415], [40, 419, 555, 434], [40, 437, 145, 452], [79, 472, 269, 488], [79, 510, 244, 526], [79, 548, 409, 564], [16, 618, 54, 635], [530, 619, 591, 634], [16, 659, 281, 674]] };
  const [l, t, r, b] = live.band;
  const got = placeFloat({ target: B(live.target), size: { width: 334, height: 84 }, compact: { width: 219, height: 44 }, view: { width: 620, height: 1148, left: l, top: t, right: r, bottom: b }, controls: live.controls.map(B), content: live.content.map(B) });
  eq("live phone-360 validations: the compact form fits right of the Enable switch, covering nothing", [got.spot, got.covers.text, got.covers.controls], ["clear-compact", 0, 0]);
  ok("…inside the visible 0-320 band", got.left >= 6 && got.left + got.width <= 314);
}

// Nothing clear within reach (a wall of text 700 px tall around the control): further away in the band.
const wall = Array.from({ length: 50 }, (_, i) => box(0, i * 18, 1000, 16 + i * 18)); // 0-900 px of text lines 2 px apart
const farText = wall.filter((r) => !(r.top < 426 && r.bottom > 394));
const far = placeFloat({ target: box(900, 400, 940, 420), size: FULL, compact: COMPACT, view: { width: 1000, height: 2000, left: 0, right: 1000, top: 0, bottom: 1400 }, controls: [box(900, 400, 940, 420)], content: farText });
eq("no clear spot within reach → clear-far (compact), still covering nothing", [far.spot, hit(far, COMPACT, farText)], ["clear-far", 0]);

// Nothing clear on screen at all: covers the least text, never a control.
const fullText = Array.from({ length: 60 }, (_, i) => box(0, i * 15, 1000, i * 15 + 14));
const ctlRow = [box(0, 300, 1000, 330)];
const worst = placeFloat({ target: box(400, 300, 440, 330), size: FULL, compact: COMPACT, view: { width: 1000, height: 900, left: 0, right: 1000, top: 0, bottom: 900 }, controls: ctlRow, content: fullText });
eq("no clear spot anywhere → covers-text, zero controls", [worst.spot, worst.covers.controls, hit(worst, COMPACT, ctlRow)], ["covers-text", 0, 0]);

// The band: the reminder never leaves the part of the frame on screen.
const banded = placeFloat({ target: box(300, 2000, 340, 2020), size: FULL, compact: COMPACT, view: { width: 636, height: 5000, left: 230, right: 620, top: 1500, bottom: 2300 }, controls: [box(300, 2000, 340, 2020)], content: [] });
ok("panned phone band 230-620 → inside it (6 px from its edges)", banded.left >= 236 && banded.left + banded.width <= 614);
ok("…and inside the vertical band", banded.top >= 1506 && banded.top + FULL.height <= 2294);
eq("a frame narrower than the reminder clamps its width", placeFloat({ target: box(20, 100, 60, 120), size: { width: 700, height: 40 }, view: { width: 620, height: 900 }, controls: [], content: [] }).width, 608);

// ── M-01 / SV-07: which side cuts a menu ───────────────────────────────────────────────────────
const io = (b, v) => ({ isIntersecting: true, intersectionRatio: 0.5, boundingClientRect: b, intersectionRect: v });
eq("cut at the right → right", horizontalCut(io({ left: 500, right: 840, top: 0, bottom: 100 }, { left: 500, right: 794, top: 0, bottom: 100 })), "right");
eq("cut at the left (the Move menu on a phone) → left", horizontalCut(io({ left: -67, right: 113, top: 0, bottom: 100 }, { left: 0, right: 113, top: 0, bottom: 100 })), "left");
eq("fully visible → null", horizontalCut(io({ left: 10, right: 200, top: 0, bottom: 10 }, { left: 10, right: 200, top: 0, bottom: 10 })), null);
eq("cut on both sides → null (left where it is)", horizontalCut(io({ left: -10, right: 900, top: 0, bottom: 10 }, { left: 0, right: 800, top: 0, bottom: 10 })), null);
eq("not intersecting → null", horizontalCut({ isIntersecting: false, intersectionRatio: 0, boundingClientRect: {}, intersectionRect: {} }), null);

// ── SV-18: a dialog in a frame wider than the screen ───────────────────────────────────────────
eq("the whole frame is on screen → CSS centring (null)", placeInBandX({ w: 480, band: { left: 0, right: 994 }, frameWidth: 994 }), null);
eq("a 620 px frame showing 0-390 → inside the band, width capped", placeInBandX({ w: 480, band: { left: 0, right: 390 }, frameWidth: 620 }), { left: 16, maxWidth: 358 });
eq("…panned to 230-620 → follows the band", placeInBandX({ w: 300, band: { left: 230, right: 620 }, frameWidth: 620 }), { left: 275, maxWidth: 358 });
eq("no horizontal band known → null", placeInBandX({ w: 480, band: { top: 0, bottom: 700 }, frameWidth: 620 }), null);

// ── SV-16 / M-04: the banner's Open size ───────────────────────────────────────────────────────
eq("portrait phone → max", detailsModalSize({ width: 390, height: 844 }), "max");
eq("landscape phone → max", detailsModalSize({ width: 844, height: 390 }), "max");
eq("iPad mini → large", detailsModalSize({ width: 744, height: 1133 }), "large");
eq("laptop → large", detailsModalSize({ width: 1280, height: 800 }), "large");
eq("unknown screen → large (the old behaviour)", detailsModalSize(null), "large");

// ── SV-08: an accountId is never shown as a name ───────────────────────────────────────────────
ok("a 712020:uuid id is recognised", looksLikeAccountId("712020:937bc860-eec2-4294-a65d-8e0fe7c45086"));
ok("a legacy 24-hex id is recognised", looksLikeAccountId("5b10ac8d82e05b22cc7d4ef5"));
ok("a real name is not", !looksLikeAccountId("Mihai Perdum"));
eq("actor named by its id → Someone", actorName({ actor: { accountId: "712020:937bc860-eec2-4294-a65d-8e0fe7c45086", name: "712020:937bc860-eec2-4294-a65d-8e0fe7c45086" } }), "Someone");
eq("actor with a name → the name", actorName({ actor: { accountId: "x", name: "Gabriela Perdum" } }), "Gabriela Perdum");
eq("no actor → Sentinel Vault", actorName({ actor: null }), "Sentinel Vault");

// ── SV-19: the API lists name the minter / submitter, never print the id ───────────────────────
const NAMES = { a: "Mihai Perdum", b: null };
const calls = [];
const resolveName = async (id) => { calls.push(id); if (id === "boom") throw new Error("x"); return NAMES[id] ?? null; };
const rows = await withDisplayNames([{ createdBy: "a" }, { createdBy: "a" }, { createdBy: "b" }, { createdBy: "boom" }, { createdBy: null }, { createdBy: "a", createdByName: "Kept" }], "createdBy", "createdByName", resolveName);
eq("resolved names land on the rows", rows.map((r) => r.createdByName ?? null), ["Mihai Perdum", "Mihai Perdum", null, null, null, "Kept"]);
eq("one lookup per distinct id", calls.sort(), ["a", "b", "boom"]);
eq("not a list → empty list", await withDisplayNames(undefined, "createdBy", "createdByName", resolveName), []);

// ── BN-02 first tick: how far the body scrolls so the row just ticked clears the pinned form ──
// Geometry from the breaker's round-2 probes (viewport y).
const R = (top, bottom) => ({ top, bottom });
eq("BN-02 1440: checkbox 581-597 under the form at 581-659 → up 24 px (8 px clear)", revealAboveDelta(R(581, 597), R(581, 659), R(70, 659)), 24);
eq("BN-02 phone-390: row 626-650 under the form at 460-659 → up 198 px", revealAboveDelta(R(626, 650), R(460, 659), R(109, 659)), 198);
eq("BN-02 iPad Pro 11 portrait: 684-708 under the form at 687-775 → up 29 px", revealAboveDelta(R(684, 708), R(687, 775), R(140, 775)), 29);
eq("BN-02 a row already 8 px clear of the form → no scroll", revealAboveDelta(R(500, 573), R(581, 659), R(70, 659)), 0);
eq("BN-02 a row well above the form → no scroll", revealAboveDelta(R(120, 160), R(581, 659), R(70, 659)), 0);
eq("BN-02 the form back in the flow after the list (short frame) → no scroll", revealAboveDelta(R(600, 640), R(660, 740), R(0, 400)), 0);
eq("BN-02 a target taller than the room above the form stops at the body's top", revealAboveDelta(R(100, 700), R(500, 600), R(80, 600)), 20);
eq("BN-02 nothing to measure → no scroll", revealAboveDelta(null, R(0, 1), R(0, 1)), 0);

report("responsive-logic");
