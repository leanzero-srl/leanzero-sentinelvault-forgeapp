// Elzi's tours, offline: the marks (backend, the caller's own row only), the one tour list, the engine's pure
// rules (tourSteps.js), the registry wiring, and the owner's acceptance geometry rules as pure functions.
// The real-browser geometry run is test/nux-geometry.test.mjs.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, ok, report } from "./_assert.mjs";
import { NUX_TOUR_KEYS, SITE_TABS, SPACE_TABS, nuxTabKey, clearNuxShownHere, NUX_AUTO_PREFIX } from "../src/ui/nux/nux-tours.js";
import { readNux, writeNux, clearNux, nuxKey, NUX_PREFIX } from "../src/server/shared/nux.js";
import * as T from "../src/ui/nux/tourSteps.js";
import { extractAccountIds } from "../src/server/capsules/privacy/accounts.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(here, "..", rel), "utf8");
const mem = () => {
  const m = new Map();
  return { m, get: async (k) => (m.has(k) ? structuredClone(m.get(k)) : undefined), set: async (k, v) => { m.set(k, structuredClone(v)); }, delete: async (k) => { m.delete(k); } };
};
const ME = "712020:937bc860-eec2-4294-a65d-8e0fe7c45086", YOU = "712020:2b9d007d-0000-4000-8000-000000000001";

// ── the one list ──
eq("tour keys: two page tours plus one per tab", NUX_TOUR_KEYS.length, 2 + SITE_TABS.length + SPACE_TABS.length);
eq("no duplicate key", new Set(NUX_TOUR_KEYS).size, NUX_TOUR_KEYS.length);
ok("a mini-tour key names its console", NUX_TOUR_KEYS.includes(nuxTabKey("site", "api")) && NUX_TOUR_KEYS.includes(nuxTabKey("space", "workflow")));
{
  const store = { s: new Map([[`${NUX_AUTO_PREFIX}site:v2`, "1"], ["other", "1"]]) };
  const fake = { get length() { return store.s.size; }, key: (i) => [...store.s.keys()][i], removeItem: (k) => store.s.delete(k) };
  eq("clearNuxShownHere removes only this app's notes", [clearNuxShownHere(fake), [...store.s.keys()]], [1, ["other"]]);
}

// ── the marks: one row per person, the caller's own, bounded by the list ──
{
  const st = mem();
  eq("the key names the account (the personal-data worker finds and deletes it)", nuxKey(ME), `${NUX_PREFIX}${ME}`);
  eq("the personal-data worker reads the account out of the key", [...extractAccountIds(nuxKey(ME), { v: 1, tours: {} })], [ME]);
  eq("no account, no key", nuxKey(""), "");
  eq("a fresh person has seen nothing", (await readNux(ME, st)).tours.site, { seen: false, version: 0 });
  eq("a missing account reads as not ok", await readNux("", st), { ok: false });
  const w = await writeNux(ME, { version: 2, how: "shown", tour: "site" }, st, Date.parse("2026-11-02T10:00:00Z"));
  eq("write answers the mark", [w.ok, w.tour, w.version, w.how, w.at], [true, "site", 2, "shown", "2026-11-02T10:00:00.000Z"]);
  await writeNux(ME, { version: 2, how: "done", tour: "site-settings" }, st);
  const r = await readNux(ME, st);
  eq("the first mark is kept when a second is written", [r.tours.site.seen, r.tours.site.how, r.tours["site-settings"].how], [true, "shown", "done"]);
  eq("another person's row is untouched", (await readNux(YOU, st)).tours.site.seen, false);
  eq("a key not in the list is refused and writes nothing", [(await writeNux(ME, { version: 2, how: "done", tour: "evil" }, st)).ok, Object.keys(st.m.get(nuxKey(ME)).tours).sort()], [false, ["site", "site-settings"]]);
  eq("a junk how becomes done", (await writeNux(ME, { version: 2, how: "x".repeat(50), tour: "space" }, st)).how, "done");
  eq("version is bounded", (await writeNux(ME, { version: 99999, how: "done", tour: "space" }, st)).version, 1000);
  await clearNux(ME, st);
  eq("reset deletes only the caller's row", [st.m.has(nuxKey(ME)), (await readNux(ME, st)).tours.space.seen], [false, false]);
  const bad = { get: async () => { throw new Error("kvs down"); }, set: async () => { throw new Error("x"); }, delete: async () => { throw new Error("x"); } };
  eq("a failed read is not ok (it never opens a tour)", [(await readNux(ME, bad)).ok, (await writeNux(ME, { version: 2, how: "done", tour: "site" }, bad)).ok, (await clearNux(ME, bad)).ok], [false, false, false]);
}

// ── the actions: only context.accountId, nothing in the payload names a person ──
{
  const src = read("src/server/capsules/nux/actions.js");
  ok("actions read context.accountId only", (src.match(/req\?\.context\?\.accountId/g) || []).length === 3 && !/payload\??\.(accountId|account)/.test(src));
  const reg = read("src/server/registry.js");
  ok("registry registers the nux capsule", reg.includes('["nux", nuxActions]'));
  const hook = read("src/server/capsules/backup/hook.js");
  ok("the three actions are classified (a preference, not backed-up configuration)", ["get-nux-tours", "set-nux-tour", "reset-nux-tours"].every((k) => hook.includes(`"${k}"`)));
}

// ── the engine's pure rules ──
eq("tourIsNew: unseen yes, seen no, failed read no", [T.tourIsNew({ ok: true, seen: false }), T.tourIsNew({ ok: true, seen: true, version: T.NUX_VERSION }), T.tourIsNew({ ok: false }), T.tourIsNew(null)], [true, false, false, false]);
eq("storedFor: a failed read stays failed", T.storedFor({ ok: false }, "site"), { ok: false });
eq("storedFor picks the tour's own mark", T.storedFor({ ok: true, tours: { site: { seen: true, version: T.NUX_VERSION } } }, "site"), { ok: true, seen: true, version: T.NUX_VERSION });
eq("anchorSelector: a token and an @test-id", [T.anchorSelector("tab-intro"), T.anchorSelector("@tab-settings")], ['[data-nux~="tab-intro"]', '[data-testid="tab-settings"]']);
eq("keys: Esc skips, arrows move", [T.keyAction("Escape"), T.keyAction("ArrowRight"), T.keyAction("ArrowLeft", { index: 0 }), T.keyAction("ArrowLeft", { index: 2 })], ["skip", "next", null, "back"]);
{
  const steps = [{ id: "a", anchors: ["x"] }, { id: "b", anchors: ["y"] }, { id: "hello", anchors: [] }];
  eq("resolveSteps drops a step whose anchor is not drawn, keeps the centred one", T.resolveSteps((n) => n === "x", steps).map((s) => s.id), ["a", "hello"]);
  const first = T.stepsWithIntro({ intro: "first", hello: "Hi there.", steps }, { firstEver: true });
  eq("Elzi's hello opens the first tour and says whose guide she is", [first[0].id, first[0].text.startsWith("I'm Sentinel Vault's guide.")], ["hello", true]);
  eq("a later mini-tour has no hello", T.stepsWithIntro({ intro: "first", steps }, { firstEver: false }).length, 3);
}
{
  let s = T.TOUR_INITIAL;
  s = T.tourReducer(s, { type: "start", count: 2 });
  s = T.tourReducer(s, { type: "next" }); s = T.tourReducer(s, { type: "next" });
  eq("the last Next ends the tour as done", [s.open, s.ended], [false, "done"]);
  eq("Skip ends it as skipped", T.tourReducer(T.tourReducer(T.TOUR_INITIAL, { type: "start", count: 3 }), { type: "skip" }).ended, "skipped");
}
eq("a tour opens by itself only when its mark was read and is unseen", [T.wantsAutoStart({ stored: { ok: true, seen: false, version: 0 }, key: "site" }), T.wantsAutoStart({ stored: { ok: false }, key: "site" })], [true, false]);

// ── the owner's geometry rules (2026-11-02), as pure functions the browser test also uses ──
const { judgeAcceptance } = await import("./nux-geometry-rules.mjs");
const vis = { top: 0, left: 0, width: 390, height: 844 };
const box = (left, top, width, height) => ({ left, top, width, height });
const base = { target: box(20, 100, 200, 40), bubble: box(16, 160, 358, 150), elzi: box(16, 320, 60, 70), targetHit: true, elziClipped: false, bubbleClipped: false };
eq("a clean step passes", judgeAcceptance(base, vis), []);
ok("a bubble past the right edge fails", judgeAcceptance({ ...base, bubble: box(100, 160, 358, 150) }, vis).some((f) => /bubble outside/.test(f)));
ok("a bubble closer than 16 px to the edge fails", judgeAcceptance({ ...base, bubble: box(8, 160, 358, 150) }, vis).some((f) => /margin/.test(f)));
ok("Elzi past the bottom fails", judgeAcceptance({ ...base, elzi: box(16, 800, 60, 70) }, vis).some((f) => /Elzi outside/.test(f)));
ok("a bubble on its own target fails", judgeAcceptance({ ...base, bubble: box(16, 110, 358, 150) }, vis).some((f) => /bubble over target/.test(f)));
ok("Elzi on the target fails", judgeAcceptance({ ...base, elzi: box(30, 105, 60, 70) }, vis).some((f) => /Elzi over target/.test(f)));
ok("a covered target fails", judgeAcceptance({ ...base, targetHit: false }, vis).some((f) => /target covered/.test(f)));
ok("a clipping ancestor fails", judgeAcceptance({ ...base, elziClipped: true }, vis).some((f) => /clip/.test(f)));
ok("a bubble wider than the screen minus margins fails", judgeAcceptance({ ...base, bubble: box(16, 160, 380, 150) }, vis).some((f) => /wider/.test(f)));
eq("the hello (no target) is judged on the canvas only", judgeAcceptance({ ...base, target: null, targetHit: null }, vis), []);

// ── no stray CogniRunner words in the ported engine ──
{
  const all = ["Elzi.jsx", "Tour.jsx", "TourReplay.jsx", "marks.js", "tourSteps.js", "tourStyles.js", "nux-tours.js"].map((f) => read(`src/ui/nux/${f}`)).join("\n");
  ok("no CogniRunner / Evidence words left in the port", !/CogniRunner|Evidence|eg-nux|getEvidenceTour|cw-btn/.test(all.replace(/\/\*[\s\S]*?\*\//g, "")));
  ok("every control the engine draws carries a test id the action log can name", ["nux-skip", "nux-back", "nux-next", "nux-done", "nux-replay"].every((id) => all.includes(`data-testid="${id}"`)));
}
// ── placement from final numbers (LeanZero Management finding aee08928, ported 2026-11-03) ──
{
  const t = read("src/ui/nux/Tour.jsx");
  ok("every measure run has a number and an older run stops (stale)", /runRef\.current/.test(t) && /const stale = \(\) =>/.test(t));
  ok("the bubble is always in the DOM (hidden until placed) so its real height is read before drawing", /visibility: "hidden"/.test(t) && /probe\.style\.width/.test(t));
  ok("the scroll into view runs before the first draw, instantly", /behavior: "auto" \}\); \/\/ before anything is drawn/.test(t) && !/behavior: reducedMotion\(\) \? "auto" : "smooth"/.test(t));
  ok("the target's box is read until it holds still", /for \(let i = 0; i < 8; i\+\+\)/.test(t));
  ok("the gate watches placement over time", /after its first draw/.test(read("test/nux-geometry.test.mjs")));
  eq("the canvas margin is the owner's 16 px", T.EDGE, 16);
}

// ── "Show all tours again" (the reset control) ──
{
  const { resetAllTours } = await import("../src/ui/nux/reset-tours.js");
  const mkStore = () => { const m = new Map([[`${NUX_AUTO_PREFIX}site:v2`, "1"], ["other", "1"]]); return { m, get length() { return m.size; }, key: (i) => [...m.keys()][i], removeItem: (k) => m.delete(k) }; };
  const sess = mkStore(), loc = mkStore(); let forgot = 0, asked = [];
  const r = await resetAllTours({ call: async (a) => { asked.push(a); return { success: true }; }, session: sess, local: loc, forget: () => { forgot++; } });
  eq("reset: asks the one reset action, then forgets the marks", [r, asked, forgot], [{ ok: true }, ["reset-nux-tours"], 1]);
  eq("reset: clears this app's notes in the tab and in the browser, nothing else", [[...sess.m.keys()], [...loc.m.keys()]], [["other"], ["other"]]);
  const s2 = mkStore(); forgot = 0;
  const bad = await resetAllTours({ call: async () => ({ success: false }), session: s2, local: mkStore(), forget: () => { forgot++; } });
  eq("reset: a failed stored reset clears nothing locally and says so", [bad, s2.m.size, forgot], [{ ok: false }, 2, 0]);
  const thrown = await resetAllTours({ call: async () => { throw new Error("x"); }, session: s2, local: mkStore(), forget: () => { forgot++; } });
  eq("reset: a throwing call is a failure, not a crash", thrown, { ok: false });
  const dlg = read("src/ui/nux/ResetTours.jsx");
  ok("reset: the control asks in the app's own dialog, never a native confirm", /from "..\/kit\/Dialog.jsx"/.test(dlg) && !/window\.confirm|confirm\(/.test(dlg));
  ok("reset: both consoles carry the control", /<ResetTours/.test(read("src/ui/surfaces/steward-console/index.jsx")) && /<ResetTours/.test(read("src/ui/surfaces/realm-console/index.jsx")));
}
report("nux-engine");
