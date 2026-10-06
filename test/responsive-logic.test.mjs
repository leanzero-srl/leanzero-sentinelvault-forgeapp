// The pure decisions behind the 2026-10-07 responsive pass (device matrix 2026-10-06): where the
// "Not applied yet" reminder goes, which edge a menu anchors to, where a dialog sits on a phone,
// which modal size the banner opens, how an actor is named, and the API lists' display names.
import { placeFloat, samplePoints } from "../src/ui/kit/float-placement.js";
import { horizontalCut, placeInBandX } from "../src/ui/kit/visible-placement.js";
import { detailsModalSize } from "../src/ui/kit/modal-size.js";
import { actorName, looksLikeAccountId } from "../src/ui/kit/activity-format.js";
import { withDisplayNames } from "../src/server/capsules/config-api/display-names.js";
import { eq, ok, report } from "./_assert.mjs";

// ── SV-10: the reminder never lands on a control when a free spot exists ───────────────────────
const view = { width: 1000, height: 2000 };
const size = { width: 400, height: 40 };
const row = { top: 300, bottom: 360, left: 40, right: 960 };
eq("nothing in the way → under the row, on its left", placeFloat({ anchor: row, size, view }).spot, "below-left");
eq("…8 px under the row", placeFloat({ anchor: row, size, view }).top, 368);
// The next row's controls sit at the right (a toggle) — the left spot is free.
const toggleRight = (x, y) => x > 900 && y > 360 && y < 420;
eq("a toggle at the right under the row → stays left", placeFloat({ anchor: row, size, view, blockedAt: toggleRight }).spot, "below-left");
// A new validation rule: pickers on the left AND the × on the right, right under the head row.
const ruleBelow = (x, y) => y > 360 && y < 430 && (x < 500 || x > 900);
const p = placeFloat({ anchor: row, size, view, blockedAt: ruleBelow });
eq("a rule card's controls on both sides under the row → above the row instead", p.spot, "above-right");
eq("…ending 8 px above the row", p.top, 300 - 8 - 40);
eq("everything blocked → the spot covering the fewest controls", placeFloat({ anchor: row, size, view, blockedAt: (x, y) => y > 360 || x < 300 }).spot, "above-right");
eq("a phone-width frame clamps the reminder inside it", placeFloat({ anchor: { top: 100, bottom: 140, left: 16, right: 604 }, size: { width: 700, height: 40 }, view: { width: 620, height: 900 } }).left, 8);
eq("nine sample points per spot", samplePoints({ left: 0, top: 0, width: 100, height: 40 }).length, 9);

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

report("responsive-logic");
