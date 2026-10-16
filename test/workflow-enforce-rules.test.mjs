// The pure enforcement rules (capsules/workflow/enforce-rules.js) and the banner's reading of the
// guard answer (kit/guard-outcome.js). The end-to-end behaviour is in workflow-enforcement.test.mjs;
// this file pins the rules themselves and that each has ONE home in the code.
import { readFileSync } from "node:fs";
import { enforceModeOf, eventPredatesBaseline, contentProtectionEnabled, shownEnforcement } from "../src/server/capsules/workflow/enforce-rules.js";
import { guardReevaluateReason, isGuardFollowUp, GUARD_REEVALUATE_REASONS } from "../src/ui/kit/guard-outcome.js";
import { eq, ok, report } from "./_assert.mjs";

// --- enforceModeOf: the chosen mode, never downgraded by the approver count ---
eq("revert stays revert", enforceModeOf({ enforceMode: "revert" }), "revert");
eq("revert with no approval config stays revert", enforceModeOf({ enforceMode: "revert", approval: null }), "revert");
eq("revert with an empty approver list stays revert", enforceModeOf({ enforceMode: "revert", approval: { approvers: [] } }), "revert");
eq("demote", enforceModeOf({ enforceMode: "demote" }), "demote");
eq("absent → demote (the default)", enforceModeOf({}), "demote");
eq("null settings → demote", enforceModeOf(null), "demote");
eq("garbage → demote", enforceModeOf({ enforceMode: "nuke" }), "demote");

// --- eventPredatesBaseline: an event at or below the approved version is not an edit to it ---
eq("event = approvedVersion → predates", eventPredatesBaseline(5, 5), true);
eq("event < approvedVersion → predates", eventPredatesBaseline(3, 5), true);
eq("event > approvedVersion → judged", eventPredatesBaseline(6, 5), false);
eq("no event version → judged (synthetic events)", eventPredatesBaseline(undefined, 5), false);
eq("null event version → judged", eventPredatesBaseline(null, 5), false);
eq("NaN event version → judged", eventPredatesBaseline(NaN, 5), false);
eq("no baseline → judged", eventPredatesBaseline(3, null), false);
eq("zero baseline → judged", eventPredatesBaseline(0, 0), false);
eq("string version → judged (never coerced)", eventPredatesBaseline("3", 5), false);

// --- contentProtectionEnabled: default on, only an explicit false switches it off ---
eq("absent policy → on", contentProtectionEnabled(null), true);
eq("absent key → on", contentProtectionEnabled({}), true);
eq("true → on", contentProtectionEnabled({ enableContentProtection: true }), true);
eq("false → off", contentProtectionEnabled({ enableContentProtection: false }), false);

// --- shownEnforcement: what the sentences may promise ---
eq("protection on → the chosen mode (revert)", shownEnforcement({ enforceMode: "revert" }, {}), "revert");
eq("protection on → the chosen mode (demote)", shownEnforcement({}, null), "demote");
eq("protection off → off, whatever the mode", shownEnforcement({ enforceMode: "revert" }, { enableContentProtection: false }), "off");

// --- guard answer → banner re-run ---
eq("restored → re-run", guardReevaluateReason({ restored: true }), "guard restored");
eq("demoted (no write) → re-run", guardReevaluateReason({ restored: false, workflowChanged: true }), "guard workflow changed");
eq("both → restored wins (one re-run)", guardReevaluateReason({ restored: true, workflowChanged: true }), "guard restored");
eq("nothing changed → no re-run", guardReevaluateReason({ checked: true, restored: false }), null);
eq("already judged → no re-run", guardReevaluateReason({ checked: false, reason: "version already judged" }), null);
eq("no answer → no re-run", guardReevaluateReason(null), null);
ok("a guard-started evaluation never calls the guard again", GUARD_REEVALUATE_REASONS.every(isGuardFollowUp));
eq("an ordinary evaluation calls the guard", isGuardFollowUp("init"), false);

// --- one home per rule (the bugs shipped because each rule had several) ---
const triggers = readFileSync(new URL("../src/server/triggers.js", import.meta.url), "utf8");
const ribbon = readFileSync(new URL("../src/ui/surfaces/doc-ribbon/index.jsx", import.meta.url), "utf8");
eq("triggers.js reads the enforce mode only through enforceModeOf", (triggers.match(/enforceMode\b/g) || []).length, 0);
eq("no approver-count condition on the mode anywhere in triggers.js", /mode === "revert" && [^\n]*approvers/.test(triggers), false);
eq("triggers.js reads enableContentProtection only through contentProtectionEnabled", (triggers.match(/enableContentProtection/g) || []).length, 0);
eq("the banner's consequence line has no approver-count downgrade", /hasApproverSnapshot/.test(ribbon), false);
ok("the banner re-runs on the guard's answer through guardReevaluateReason", /guardReevaluateReason\(g\)/.test(ribbon));
const sweepAt = triggers.indexOf("export async function workflowSweep");
const sweepBody = triggers.slice(sweepAt, triggers.indexOf("\n}\n", sweepAt));
ok("the hourly sweep reads the content-protection switch", /contentProtectionEnabled\(/.test(sweepBody) && /if \(!protectionOn\) continue;/.test(sweepBody));

const homes = ["../src/server/capsules/workflow/actions.js", "../src/server/capsules/page-details/actions.js", "../src/server/capsules/workflow/logic.js"]
  .map((f) => readFileSync(new URL(f, import.meta.url), "utf8"));
eq("no server module re-derives the mode from settings.enforceMode by hand", homes.filter((src) => /settings\?\.enforceMode === "revert"/.test(src)).length, 0);

report("workflow-enforce-rules");
