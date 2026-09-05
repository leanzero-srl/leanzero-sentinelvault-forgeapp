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
  validateDemoteTarget,
  resolveDemoteTarget,
  resolveReviewAfterDays,
  sanitizeReviewAfterDaysByState,
  validateReviewDueAt,
  computeReviewDueAt,
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
eq("from approved -> [draft, expired, in_review] (A2: back to review)", listTransitions(DEFAULT_WORKFLOW, "approved").sort(), ["draft", "expired", "in_review"]);
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
    { accountId: "712020:a", name: "Alice", decision: "approved", decidedAt: "2026-09-05T11:00:00.000Z", reason: "LGTM", versionAtDecision: 7 , signed: false});
  eq("a denial row keeps its reason", [rec.decisions[1].decision, rec.decisions[1].reason], ["denied", "Section 3 is wrong"]);
  eq("an approver who never answered is listed as pending with nulls, not dropped", rec.decisions[2],
    { accountId: "712020:c", name: null, decision: "pending", decidedAt: null, reason: null, versionAtDecision: null , signed: false});
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

// --- A2: resolveDemoteTarget / validateDemoteTarget — where a tampered Approved page goes ---
{
  const D = DEFAULT_WORKFLOW;
  eq("no settings -> initial (Draft)", resolveDemoteTarget(D, null).id, "draft");
  eq("demoteTo 'initial' -> initial", resolveDemoteTarget(D, { demoteTo: "initial" }).id, "draft");
  eq("demoteTo '' -> initial", resolveDemoteTarget(D, { demoteTo: "" }).id, "draft");
  eq("demoteTo a non-string -> initial", resolveDemoteTarget(D, { demoteTo: 42 }).id, "draft");
  // A2: the built-in workflow has approved -> in_review (back to review), so it IS a valid target.
  eq("in_review is accepted for the default workflow (approved -> in_review edge)", validateDemoteTarget(D, "in_review").ok, true);
  eq("…and resolves to it", resolveDemoteTarget(D, { demoteTo: "in_review" }).id, "in_review");
  // An UNREACHABLE target is refused, resolves to initial, and the reason names the missing edge.
  const NOEDGE = { ...D, transitions: D.transitions.filter((t) => !(t.from === "approved" && t.to === "in_review")) };
  ok("a target with no edge from the enforce state is refused", !validateDemoteTarget(NOEDGE, "in_review").ok);
  eq("…and resolves to initial, never to the unreachable state", resolveDemoteTarget(NOEDGE, { demoteTo: "in_review" }).id, "draft");
  ok("the refusal reason names the missing edge", /Approved/.test(validateDemoteTarget(NOEDGE, "in_review").reason) && /In Review/.test(validateDemoteTarget(NOEDGE, "in_review").reason));
  eq("expired IS reachable from approved -> valid target", validateDemoteTarget(D, "expired").ok, true);
  eq("…and resolves to it", resolveDemoteTarget(D, { demoteTo: "expired" }).id, "expired");
  ok("the enforce state itself is refused", !validateDemoteTarget(D, "approved").ok && /approved state/i.test(validateDemoteTarget(D, "approved").reason));
  eq("enforce-state demoteTo -> initial", resolveDemoteTarget(D, { demoteTo: "approved" }).id, "draft");
  ok("an unknown state is refused", !validateDemoteTarget(D, "ghost").ok);
  eq("vanished state (re-saved definition dropped it) -> initial", resolveDemoteTarget(D, { demoteTo: "ghost" }).id, "draft");
  ok("a definition with no enforce state accepts no stateId", !validateDemoteTarget({ states: [{ id: "a", initial: true }, { id: "b" }], transitions: [{ from: "a", to: "b" }] }, "b").ok);
  eq("malformed def -> refused, not thrown", validateDemoteTarget(null, "draft").ok, false);
  eq("malformed def -> resolves to null initial without throwing", resolveDemoteTarget(null, { demoteTo: "draft" }), null);

  // Comala-shaped workflow: approved -> in_review exists, so in_review is a valid target.
  const comala = {
    id: "c", states: [
      { id: "draft", name: "Draft", initial: true },
      { id: "in_review", name: "Review" },
      { id: "approved", name: "Approved", enforce: true },
    ],
    transitions: [{ from: "draft", to: "in_review" }, { from: "in_review", to: "approved" }, { from: "approved", to: "in_review" }, { from: "approved", to: "draft" }],
  };
  ok("valid target: reachable non-enforce state", validateDemoteTarget(comala, "in_review").ok);
  eq("…resolves to that state object", resolveDemoteTarget(comala, { demoteTo: "in_review" }).name, "Review");
  eq("fromStateId tightens to the page's actual state: reachable", resolveDemoteTarget(comala, { demoteTo: "in_review" }, "approved").id, "in_review");
  eq("fromStateId: reachable from a non-enforce state too (draft -> in_review edge)", resolveDemoteTarget(comala, { demoteTo: "in_review" }, "draft").id, "in_review");
  eq("fromStateId: the page is already IN the target (no self edge) -> initial", resolveDemoteTarget(comala, { demoteTo: "in_review" }, "in_review").id, "draft");
  eq("fromStateId: a state with no edge to the target -> initial", resolveDemoteTarget({ ...comala, transitions: [...comala.transitions, { from: "draft", to: "approved" }].filter((t) => !(t.from === "draft" && t.to === "in_review")) }, { demoteTo: "in_review" }, "draft").id, "draft");

  // Two enforce states: the target must be reachable from BOTH (the demote may run from either).
  const two = {
    id: "t", states: [
      { id: "draft", name: "Draft", initial: true },
      { id: "review", name: "Review" },
      { id: "approved", name: "Approved", enforce: true },
      { id: "published", name: "Published", enforce: true },
    ],
    transitions: [{ from: "draft", to: "review" }, { from: "review", to: "approved" }, { from: "approved", to: "published" }, { from: "approved", to: "review" }, { from: "published", to: "draft" }, { from: "approved", to: "draft" }],
  };
  ok("reachable from only one of two enforce states -> refused", !validateDemoteTarget(two, "review").ok);
  ok("…the reason names the state that cannot reach it", /Published/.test(validateDemoteTarget(two, "review").reason));
  ok("reachable from both -> ok", validateDemoteTarget(two, "draft").ok);
}

// --- A5: review clocks — precedence, per-state validation, the steward-set date ---
{
  const approved = findState(DEFAULT_WORKFLOW, "approved");
  const draft = findState(DEFAULT_WORKFLOW, "draft");
  eq("no settings: the definition's own clock", resolveReviewAfterDays(approved, null), 150);
  eq("no settings, no clock on the state -> null", resolveReviewAfterDays(draft, null), null);
  eq("legacy reviewAfterDays overrides the ENFORCE state", resolveReviewAfterDays(approved, { reviewAfterDays: 30 }), 30);
  eq("legacy reviewAfterDays does NOT touch a non-enforce state", resolveReviewAfterDays(draft, { reviewAfterDays: 30 }), null);
  eq("per-state override puts a clock on a state with none", resolveReviewAfterDays(draft, { reviewAfterDaysByState: { draft: 7 } }), 7);
  eq("per-state override beats the legacy enforce override", resolveReviewAfterDays(approved, { reviewAfterDays: 30, reviewAfterDaysByState: { approved: 10 } }), 10);
  eq("a per-state entry for another state is not applied", resolveReviewAfterDays(approved, { reviewAfterDaysByState: { draft: 7 } }), 150);
  eq("garbage per-state value falls through", resolveReviewAfterDays(approved, { reviewAfterDaysByState: { approved: -1 } }), 150);
  eq("null state -> null", resolveReviewAfterDays(null, { reviewAfterDaysByState: { draft: 7 } }), null);
  ok("computeReviewDueAt with a resolved override lands ~N days out", (() => {
    const iso = computeReviewDueAt(draft, resolveReviewAfterDays(draft, { reviewAfterDaysByState: { draft: 7 } }));
    const ms = Date.parse(iso) - Date.now();
    return ms > 6.9 * 86400000 && ms < 7.1 * 86400000;
  })());
  eq("computeReviewDueAt with no clock -> null", computeReviewDueAt(draft, resolveReviewAfterDays(draft, {})), null);

  const D = DEFAULT_WORKFLOW;
  eq("sanitize: null -> {}", sanitizeReviewAfterDaysByState(null, D), { ok: true, value: {} });
  eq("sanitize: known states + positive ints kept", sanitizeReviewAfterDaysByState({ draft: 7, in_review: "14" }, D), { ok: true, value: { draft: 7, in_review: 14 } });
  eq("sanitize: empty entries are dropped (cleared row)", sanitizeReviewAfterDaysByState({ draft: "", in_review: null }, D), { ok: true, value: {} });
  ok("sanitize: unknown state id REFUSED", !sanitizeReviewAfterDaysByState({ ghost: 7 }, D).ok);
  ok("sanitize: zero REFUSED", !sanitizeReviewAfterDaysByState({ draft: 0 }, D).ok);
  ok("sanitize: negative REFUSED", !sanitizeReviewAfterDaysByState({ draft: -3 }, D).ok);
  ok("sanitize: fractional REFUSED", !sanitizeReviewAfterDaysByState({ draft: 1.5 }, D).ok);
  ok("sanitize: non-numeric REFUSED", !sanitizeReviewAfterDaysByState({ draft: "soon" }, D).ok);
  ok("sanitize: an array is not a map", !sanitizeReviewAfterDaysByState([7], D).ok);
  ok("sanitize: the enforce state may carry a per-state entry", sanitizeReviewAfterDaysByState({ approved: 30 }, D).ok);

  const NOW = Date.parse("2026-09-05T12:00:00Z");
  eq("due date: null clears", validateReviewDueAt(null, NOW), { ok: true, value: null });
  eq("due date: '' clears", validateReviewDueAt("", NOW), { ok: true, value: null });
  eq("due date: future ISO accepted and normalised", validateReviewDueAt("2026-09-06T00:00:00+02:00", NOW), { ok: true, value: "2026-09-05T22:00:00.000Z" });
  ok("due date: past REFUSED", !validateReviewDueAt("2026-09-05T11:59:59Z", NOW).ok);
  ok("due date: exactly now REFUSED", !validateReviewDueAt(NOW, NOW).ok);
  ok("due date: garbage REFUSED", !validateReviewDueAt("tomorrow-ish", NOW).ok);
  ok("due date: the past refusal says why", /future/.test(validateReviewDueAt("2020-01-01", NOW).reason));
  // Review finding 5: a huge number is finite but not a Date — toISOString throws RangeError.
  let threw = false; let huge;
  try { huge = validateReviewDueAt(1e18, NOW); } catch (_) { threw = true; }
  ok("due date: an absurd number is REFUSED, not thrown", !threw && huge && huge.ok === false);
  ok("due date: a century out is REFUSED", !validateReviewDueAt(NOW + 101 * 365 * 24 * 3600 * 1000, NOW).ok);
  ok("due date: a decade out is fine", validateReviewDueAt(NOW + 10 * 365 * 24 * 3600 * 1000, NOW).ok);

  // Review finding 9: a demote skips the entry gate, so a gated state cannot be the target.
  const gated = { in_review: { requireRules: true, requireAi: false, aiThreshold: "medium", onBudgetExhausted: "block" } };
  ok("demote target: a state with an entry condition is REFUSED", !validateDemoteTarget(D, "in_review", gated).ok);
  ok("demote target: …and the reason names the condition", /entry condition/.test(validateDemoteTarget(D, "in_review", gated).reason));
  ok("demote target: a condition on ANOTHER state does not matter", validateDemoteTarget(D, "in_review", { draft: gated.in_review }).ok);
  eq("resolveDemoteTarget: a gated saved target falls back to the initial state", resolveDemoteTarget(D, { demoteTo: "in_review", entryConditions: gated })?.id, "draft");
}

  ok("B3: a decision with a signature is marked signed", buildApprovalRecord({ pending: { toStateId: "approved", mode: "any", min: 1 }, records: [{ approverAccountId: "712020:s", approverName: "Sam", status: "approved", decidedAt: "2026-09-05T11:00:00.000Z", signature: { method: "totp", verifiedAt: "2026-09-05T11:00:00.000Z" } }], outcome: "approved", completedBy: "712020:s", completedByName: "Sam", nowIso: "2026-09-05T11:00:01.000Z" }).decisions[0].signed === true);

report("workflow-engine");
