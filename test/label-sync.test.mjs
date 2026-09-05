// B4 label sync — the pure halves: the label a state becomes, and the add/remove plan.
import { stateLabel, planLabelSync, STATE_LABEL_PREFIX } from "../src/server/capsules/workflow/label-sync.js";
import { eq, ok, report } from "./_assert.mjs";

eq("prefix", STATE_LABEL_PREFIX, "sv-state-");
eq("state id → label", stateLabel("approved"), "sv-state-approved");
eq("underscores and case are normalised", stateLabel("In_Review"), "sv-state-in-review");
eq("odd characters collapse to one dash", stateLabel("QA  /  done!"), "sv-state-qa-done");
eq("empty → null", stateLabel(""), null);
eq("null → null", stateLabel(null), null);

eq("nothing on the page → add only", planLabelSync([], "sv-state-draft"), { add: "sv-state-draft", remove: [] });
eq("already there → nothing", planLabelSync(["sv-state-draft", "team-a"], "sv-state-draft"), { add: null, remove: [] });
eq("moved state → add new, remove old, leave foreign labels alone", planLabelSync(["sv-state-draft", "team-a"], "sv-state-approved"), { add: "sv-state-approved", remove: ["sv-state-draft"] });
eq("two stale state labels → both removed", planLabelSync(["sv-state-draft", "sv-state-expired"], "sv-state-approved"), { add: "sv-state-approved", remove: ["sv-state-draft", "sv-state-expired"] });
eq("wanted null (sync off) → remove every state label", planLabelSync(["sv-state-draft", "x"], null), { add: null, remove: ["sv-state-draft"] });
ok("a label that merely starts like ours but IS ours is treated as state", planLabelSync(["sv-state-"], "sv-state-a").remove.includes("sv-state-"));
report("label-sync");
