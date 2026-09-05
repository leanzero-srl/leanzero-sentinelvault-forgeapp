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
  findDeadEndStates,
} from "../src/server/capsules/workflow/logic.js";
import { evaluateApproval, resolveApprovers, inboxKey, isOrphanApproval, ORPHAN_APPROVAL_MIN_AGE_MS, buildApprovalRecord } from "../src/server/capsules/workflow/approvals.js";
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

// B14 (#7): findDeadEndStates — a state a page can enter but never leave (silent stuck).
eq("DEFAULT_WORKFLOW has NO dead-end states", findDeadEndStates(DEFAULT_WORKFLOW).length, 0);
{
  // approved is a transition target but has no outgoing edge → stuck
  const stuckDef = {
    id: "stuck", name: "Stuck", states: [
      { id: "draft", name: "Draft", initial: true },
      { id: "approved", name: "Approved" },
    ],
    transitions: [{ from: "draft", to: "approved" }],
  };
  const dead = findDeadEndStates(stuckDef);
  eq("a target state with no outgoing edge is flagged", dead.length, 1);
  ok("the flagged dead-end is 'approved'", dead.includes("approved"));
}
{
  // an unreachable island state (never a target) is NOT a dead-end — a page can't get there
  const islandDef = {
    id: "island", name: "Island", states: [
      { id: "draft", name: "Draft", initial: true },
      { id: "review", name: "Review" },
      { id: "orphan", name: "Orphan" },
    ],
    transitions: [{ from: "draft", to: "review" }, { from: "review", to: "draft" }],
  };
  eq("an unreachable island is not counted as a dead-end", findDeadEndStates(islandDef).length, 0);
}
eq("findDeadEndStates tolerates a malformed def", findDeadEndStates(null).length, 0);
eq("findDeadEndStates tolerates missing transitions", findDeadEndStates({ states: [{ id: "a" }] }).length, 0);

// --- inbox index (2026-09-05): the per-approver key, and the orphan predicate the hourly sweep uses ---
eq("inboxKey is per approver then page", inboxKey("712020:abc", "123"), "workflow-inbox-712020:abc-123");
{
  const NOW = Date.parse("2026-09-05T12:00:00Z");
  const fresh = { requestedAt: new Date(NOW - 5 * 60 * 1000).toISOString() };
  const old = { requestedAt: new Date(NOW - 2 * ORPHAN_APPROVAL_MIN_AGE_MS).toISOString() };
  const edge = { requestedAt: new Date(NOW - ORPHAN_APPROVAL_MIN_AGE_MS).toISOString() };
  ok("a record whose page still has a pending transition is never an orphan, however old", !isOrphanApproval(old, true, NOW));
  ok("a FRESH record with no pending yet is the request-being-opened window — not an orphan", !isOrphanApproval(fresh, false, NOW));
  ok("an old record with no pending transition is an orphan", isOrphanApproval(old, false, NOW));
  ok("exactly at the age threshold counts as old", isOrphanApproval(edge, false, NOW));
  ok("a record with no requestedAt and no pending is an orphan (nothing can be waiting on it)", isOrphanApproval({}, false, NOW));
  ok("a record with a garbage requestedAt and no pending is an orphan", isOrphanApproval({ requestedAt: "yesterday" }, false, NOW));
}

// --- A4: buildApprovalRecord — the evidence snapshot taken before the per-approver records are deleted ---
{
  const NOW = "2026-09-05T12:00:00.000Z";
  const pending = {
    toStateId: "approved", mode: "min", min: 2, requestedBy: "712020:req", requestedByName: "Requester",
    requestedAt: "2026-09-05T10:00:00.000Z", pinnedVersion: 7, approvers: ["712020:a", "712020:b", "712020:c"],
    aiGate: { required: true, status: "passed", threshold: "medium", reviewedVersion: 7, reason: "No issues found." },
  };
  const records = [
    { approverAccountId: "712020:a", approverName: "Alice", status: "approved", decidedAt: "2026-09-05T11:00:00.000Z", reason: "LGTM", pinnedVersion: 7 },
    { approverAccountId: "712020:b", approverName: "Bob", status: "denied", decidedAt: "2026-09-05T11:30:00.000Z", reason: "Section 3 is wrong", pinnedVersion: 7 },
    { approverAccountId: "712020:c", status: "pending" }, // the readApprovalRecords fallback for a never-written key
  ];
  const rec = buildApprovalRecord({ pending, records, outcome: "approved", completedBy: "712020:a", completedByName: "Alice", nowIso: NOW });
  eq("outcome is carried", rec.outcome, "approved");
  eq("mode and min are carried from the pending record", [rec.mode, rec.min], ["min", 2]);
  eq("requester provenance is carried", [rec.requestedBy, rec.requestedByName, rec.requestedAt], ["712020:req", "Requester", "2026-09-05T10:00:00.000Z"]);
  eq("pinnedVersion is the version the approval was opened on", rec.pinnedVersion, 7);
  eq("completion is who/when/name", [rec.completedBy, rec.completedByName, rec.completedAt], ["712020:a", "Alice", NOW]);
  eq("aiGate is copied as status + reason only", rec.aiGate, { status: "passed", reason: "No issues found." });
  eq("one decision row per approver record, in order", rec.decisions.length, 3);
  eq("decision row maps name/decision/decidedAt/reason/versionAtDecision from the record", rec.decisions[0],
    { accountId: "712020:a", name: "Alice", decision: "approved", decidedAt: "2026-09-05T11:00:00.000Z", reason: "LGTM", versionAtDecision: 7 });
  eq("a denial row keeps its reason", [rec.decisions[1].decision, rec.decisions[1].reason], ["denied", "Section 3 is wrong"]);
  eq("an approver who never answered is listed as pending with nulls, not dropped", rec.decisions[2],
    { accountId: "712020:c", name: null, decision: "pending", decidedAt: null, reason: null, versionAtDecision: null });
  eq("the exact stored key set (the UI and harness assert on it)", Object.keys(rec).sort(),
    ["aiGate", "approverCount", "completedAt", "completedBy", "completedByName", "decisions", "min", "mode", "omitted", "outcome", "pinnedVersion", "requestedAt", "requestedBy", "requestedByName"]);

  const denied = buildApprovalRecord({ pending: { ...pending, aiGate: null }, records, outcome: "denied", completedBy: "712020:b", completedByName: "Bob", nowIso: NOW });
  eq("denied outcome is carried", denied.outcome, "denied");
  eq("no AI gate -> aiGate null (not an empty object)", denied.aiGate, null);
  eq("an aiGate that was never required is also null", buildApprovalRecord({ pending: { aiGate: { required: false, status: "x" } }, records: [], outcome: "approved", nowIso: NOW }).aiGate, null);

  // Direct steward approval (request-transition, enforce target, no approvers, no AI): no pending
  // record exists — the page still gets an evidence block, with the same key set.
  const direct = buildApprovalRecord({ pending: { pinnedVersion: 4 }, records: [], outcome: "approved", completedBy: "712020:s", completedByName: "Steward", nowIso: NOW });
  eq("direct steward approval: no mode/min, no decisions, pinned to the approved version", [direct.mode, direct.min, direct.decisions, direct.pinnedVersion], [null, null, [], 4]);
  eq("direct steward approval: requester fields are null, not undefined", [direct.requestedBy, direct.requestedByName, direct.requestedAt], [null, null, null]);
  eq("direct steward approval: same key set as a quorum approval", Object.keys(direct).sort(), Object.keys(rec).sort());

  // Defensive: garbage in never throws and never yields undefined fields.
  const bare = buildApprovalRecord({ pending: null, records: null, outcome: "bogus" });
  eq("unknown outcome falls back to approved (only two outcomes exist)", bare.outcome, "approved");
  eq("null inputs -> empty decisions", bare.decisions, []);
  ok("completedAt defaults to now when nowIso is omitted", typeof bare.completedAt === "string" && !Number.isNaN(Date.parse(bare.completedAt)));
  ok("no field is ever undefined (KVS/JSON would silently drop it)", Object.values(bare).every((v) => v !== undefined));
  eq("a non-numeric pinnedVersion is stored as null", buildApprovalRecord({ pending: { pinnedVersion: "7" }, records: [{ pinnedVersion: "7" }], outcome: "approved", nowIso: NOW }).pinnedVersion, null);
}

// A4 review F7/F4/F2: bounded rows (decided first), decidedVersion wins, a third outcome
{
  const many = Array.from({ length: 60 }, (_, i) => ({ approverAccountId: `a${i}`, status: i < 5 ? "approved" : "pending", pinnedVersion: 3, decidedVersion: i < 5 ? 4 : undefined }));
  const r = buildApprovalRecord({ pending: { mode: "min", min: 5, pinnedVersion: 3 }, records: many, outcome: "approved" });
  eq("decision rows are capped at 50", r.decisions.length, 50);
  eq("…and the cut is counted", r.omitted, 10);
  eq("…with the roster size kept", r.approverCount, 60);
  ok("decided rows come first", r.decisions.slice(0, 5).every((d) => d.decision === "approved"));
  eq("decidedVersion wins over the request pin", r.decisions[0].versionAtDecision, 4);
  eq("an undecided row keeps the request pin", r.decisions[5].versionAtDecision, 3);
  eq("a stale outcome is its own value", buildApprovalRecord({ pending: {}, records: [], outcome: "stale" }).outcome, "stale");
  const longName = buildApprovalRecord({ pending: {}, records: [{ approverAccountId: "x", status: "approved", approverName: "n".repeat(500), reason: "r".repeat(900) }], outcome: "approved" }).decisions[0];
  eq("names are bounded", longName.name.length, 120);
  eq("reasons are bounded", longName.reason.length, 300);
}

report("workflow-engine");
