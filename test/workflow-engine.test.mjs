// Pure state-machine unit tests for the workflow engine (#42). No Forge runtime:
// only the I/O-free helpers are exercised (storage/orchestration paths are covered
// live by the test-harness workflow-e2e via the dev hook).
import {
  DEFAULT_WORKFLOW,
  findState,
  getInitialState,
  listTransitions,
  validateTransition,
  sanitize,
  shouldAutoAssign,
} from "../src/server/capsules/workflow/logic.js";
import { evaluateApproval, resolveApprovers } from "../src/server/capsules/workflow/approvals.js";
import { eq, ok, report } from "./_assert.mjs";

// --- findState / getInitialState ---
eq("findState finds approved", findState(DEFAULT_WORKFLOW, "approved").name, "Approved");
eq("findState unknown -> null", findState(DEFAULT_WORKFLOW, "nope"), null);
eq("initial state is draft", getInitialState(DEFAULT_WORKFLOW).id, "draft");
eq("initial of empty -> null", getInitialState({ states: [] }), null);
ok("approved is enforce-marked", findState(DEFAULT_WORKFLOW, "approved").enforce === true);
ok("draft is not enforce", !findState(DEFAULT_WORKFLOW, "draft").enforce);
eq("approved has review clock", findState(DEFAULT_WORKFLOW, "approved").reviewAfterDays, 150);

// --- listTransitions ---
eq("from draft -> [in_review]", listTransitions(DEFAULT_WORKFLOW, "draft"), ["in_review"]);
eq("from in_review -> [approved, draft]", listTransitions(DEFAULT_WORKFLOW, "in_review").sort(), ["approved", "draft"]);
eq("from approved -> [draft, expired]", listTransitions(DEFAULT_WORKFLOW, "approved").sort(), ["draft", "expired"]);
eq("unknown state -> no transitions", listTransitions(DEFAULT_WORKFLOW, "ghost"), []);

// --- validateTransition ---
ok("draft -> in_review allowed", validateTransition(DEFAULT_WORKFLOW, "draft", "in_review").ok);
ok("in_review -> approved allowed", validateTransition(DEFAULT_WORKFLOW, "in_review", "approved").ok);
ok("approved -> expired allowed", validateTransition(DEFAULT_WORKFLOW, "approved", "expired").ok);
ok("draft -> approved BLOCKED (must route via review)", !validateTransition(DEFAULT_WORKFLOW, "draft", "approved").ok);
ok("draft -> draft blocked (same state)", !validateTransition(DEFAULT_WORKFLOW, "draft", "draft").ok);
ok("unknown target blocked", !validateTransition(DEFAULT_WORKFLOW, "draft", "bogus").ok);
ok("unknown source blocked", !validateTransition(DEFAULT_WORKFLOW, "bogus", "draft").ok);
eq("same-state reason", validateTransition(DEFAULT_WORKFLOW, "draft", "draft").reason, "Already in that state");
ok("no-edge reason names the edge", validateTransition(DEFAULT_WORKFLOW, "draft", "approved").reason.includes("draft"));

// --- reachability: every non-initial state reachable, no dangling transition targets ---
const reachable = new Set(["draft"]);
let grew = true;
while (grew) {
  grew = false;
  for (const s of [...reachable]) for (const to of listTransitions(DEFAULT_WORKFLOW, s)) {
    if (!reachable.has(to)) { reachable.add(to); grew = true; }
  }
}
ok("all states reachable from draft", DEFAULT_WORKFLOW.states.every((s) => reachable.has(s.id)));
ok("no transition points at an undefined state", DEFAULT_WORKFLOW.transitions.every((t) => findState(DEFAULT_WORKFLOW, t.from) && findState(DEFAULT_WORKFLOW, t.to)));

// --- sanitize (index-key safety, mirrors seal/validation sanitize) ---
eq("sanitize passes safe key", sanitize("ENG"), "ENG");
eq("sanitize replaces slash", sanitize("a/b"), "a_b");
ok("sanitize keeps # and space (parity with existing capsules)", sanitize("A #1") === "A #1");

// --- shouldAutoAssign (at-scale assignment decision) ---
ok("auto-assign when enabled+auto and no workflow", shouldAutoAssign({ enabled: true, autoAssignNew: true }, false));
ok("no auto-assign when page already has workflow", !shouldAutoAssign({ enabled: true, autoAssignNew: true }, true));
ok("no auto-assign when space disabled", !shouldAutoAssign({ enabled: false, autoAssignNew: true }, false));
ok("no auto-assign when autoAssignNew off", !shouldAutoAssign({ enabled: true, autoAssignNew: false }, false));
ok("no auto-assign on null settings", !shouldAutoAssign(null, false));

// --- evaluateApproval (#43 quorum decision) ---
eq("no approvers -> approved", evaluateApproval("any", 1, []), "approved");
// any-of
eq("any: all pending -> pending", evaluateApproval("any", 1, ["pending", "pending"]), "pending");
eq("any: one approved -> approved", evaluateApproval("any", 1, ["approved", "pending"]), "approved");
eq("any: all denied -> denied", evaluateApproval("any", 1, ["denied", "denied"]), "denied");
eq("any: one denied one pending -> pending", evaluateApproval("any", 1, ["denied", "pending"]), "pending");
// all-of
eq("all: all approved -> approved", evaluateApproval("all", 1, ["approved", "approved"]), "approved");
eq("all: one pending -> pending", evaluateApproval("all", 1, ["approved", "pending"]), "pending");
eq("all: one denied -> denied", evaluateApproval("all", 1, ["approved", "denied"]), "denied");
// min-N
eq("min2: one approved -> pending", evaluateApproval("min", 2, ["approved", "pending", "pending"]), "pending");
eq("min2: two approved -> approved", evaluateApproval("min", 2, ["approved", "approved", "pending"]), "approved");
eq("min2: unreachable -> denied", evaluateApproval("min", 2, ["approved", "denied", "denied"]), "denied");
eq("min2: reached despite a denial -> approved", evaluateApproval("min", 2, ["approved", "approved", "denied"]), "approved");

// --- resolveApprovers ---
eq("resolveApprovers null -> null", resolveApprovers(null), null);
eq("resolveApprovers empty -> null", resolveApprovers({ approvers: [] }), null);
eq("resolveApprovers users", resolveApprovers({ approvers: [{ type: "user", id: "a" }, { type: "user", id: "b" }], mode: "all", min: 1 }), { approvers: ["a", "b"], mode: "all", min: 1 });
eq("resolveApprovers dedups", resolveApprovers({ approvers: [{ id: "a" }, { id: "a" }] }).approvers.length, 1);
eq("resolveApprovers drops groups in v1", resolveApprovers({ approvers: [{ type: "group", id: "g" }, { type: "user", id: "a" }] }).approvers, ["a"]);

report("workflow-engine");
