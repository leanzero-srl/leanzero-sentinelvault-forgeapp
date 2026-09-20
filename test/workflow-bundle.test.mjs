// WF-11: one Save, two records, all-or-nothing — the sequencer with fakes.
import { runBundle, bundleFailureText } from "../src/server/capsules/workflow/bundle.js";
import { eq, ok, report } from "./_assert.mjs";

const log = [];
const step = (name, result) => async () => { log.push(name); return typeof result === "function" ? result() : result; };

// both succeed
log.length = 0;
let r = await runBundle({ storeDef: step("def", { success: true, def: { id: "default" }, warning: null }), storeSettings: step("settings", { success: true }), restoreDef: step("restore", { success: true }) });
eq("both written: success, the def echoed", [r.success, r.def?.id, r.warning], [true, "default", null]);
eq("both written: def first, then settings, no restore", log, ["def", "settings"]);

// the definition is refused → nothing else runs
log.length = 0;
r = await runBundle({ storeDef: step("def", { success: false, reason: "\"Approved\" still has 3 pages in it" }), storeSettings: step("settings", { success: true }), restoreDef: step("restore", { success: true }) });
eq("def refused: failure names the stage and the reason", [r.success, r.stage, r.reason, r.restored], [false, "definition", "\"Approved\" still has 3 pages in it", false]);
eq("def refused: the settings were never attempted", log, ["def"]);
ok("def refused: the sentence says nothing was saved", /^Nothing was saved — "Approved" still has 3 pages/.test(bundleFailureText(r)));

// the settings are refused → the definition is put back
log.length = 0;
r = await runBundle({ storeDef: step("def", { success: true, def: { id: "default" } }), storeSettings: step("settings", { success: false, reason: "demoteTo names an unknown state" }), restoreDef: step("restore", { success: true }) });
eq("settings refused: failure at the settings stage, restored", [r.success, r.stage, r.reason, r.restored], [false, "settings", "demoteTo names an unknown state", true]);
eq("settings refused: def, settings, then the restore", log, ["def", "settings", "restore"]);
ok("settings refused: the sentence says the states were put back", /Nothing was saved — the settings were refused \(demoteTo names an unknown state\); the states were put back/.test(bundleFailureText(r)));

// the restore itself fails → said plainly
r = await runBundle({ storeDef: step("def", { success: true }), storeSettings: step("settings", { success: false, reason: "x" }), restoreDef: step("restore", { success: false }) });
eq("restore failed: restored false", [r.success, r.restored], [false, false]);
ok("restore failed: the sentence says the states stayed", /The states were saved but the settings were refused/.test(bundleFailureText(r)));
r = await runBundle({ storeDef: step("def", { success: true }), storeSettings: step("settings", { success: false, reason: "x" }), restoreDef: async () => { throw new Error("kvs down"); } });
eq("restore threw: restored false, no throw out", [r.success, r.restored], [false, false]);

// a void restore counts as done; a missing storeDef answer is a definition failure
r = await runBundle({ storeDef: step("def", { success: true }), storeSettings: step("settings", { success: false }), restoreDef: async () => undefined });
eq("void restore → restored", r.restored, true);
r = await runBundle({ storeDef: async () => null, storeSettings: step("settings", { success: true }), restoreDef: step("restore", { success: true }) });
eq("no answer from the store → definition stage", [r.success, r.stage], [false, "definition"]);
eq("no sentence for a success", bundleFailureText({ success: true }), null);
report("workflow-bundle");
