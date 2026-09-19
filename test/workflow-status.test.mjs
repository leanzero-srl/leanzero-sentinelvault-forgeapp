// WF-6 — the ONE workflow status every always-present surface composes (byline chip, details
// modal): state + one qualifier, one tone. Pure; no Forge.
import { workflowStatus, approvalSummary, toneOfState, TONE_COLORS } from "../src/server/capsules/workflow/status.js";
import { eq, ok, report } from "./_assert.mjs";

const draft = { id: "draft", name: "Draft", color: "neutral" };
const review = { id: "in_review", name: "In Review", color: "info" };
const approved = { id: "approved", name: "Approved", color: "success", enforce: true };
const NOW = Date.parse("2026-09-20T12:00:00Z");
const s = (o) => workflowStatus({ now: NOW, locale: "en-US", ...o });

eq("no record → null (no workflow)", s({ record: null, state: draft }), null);
eq("plain state → the state name in its own tone", s({ record: { stateId: "draft" }, state: draft }), { stateId: "draft", stateName: "Draft", kind: "state", text: "Draft", qualifier: null, tone: "neutral", color: TONE_COLORS.neutral });
eq("unknown state definition → the id, neutral", s({ record: { stateId: "weird" }, state: null }).text, "weird");
eq("state colour word outside the palette → neutral", toneOfState({ color: "magenta" }), "neutral");

// pending beats the state
const pend = { toStateId: "approved", toStateName: "Approved", mode: "min", min: 2, approvers: ["a", "b", "c"] };
eq("open request → Awaiting approval N of min", s({ record: { stateId: "in_review" }, state: review, pending: pend, pendingDecided: 1 }).text, "Awaiting approval 1 of 2");
eq("…tone info", s({ record: { stateId: "in_review" }, state: review, pending: pend }).tone, "info");
eq("mode any → of 1", s({ record: { stateId: "in_review" }, state: review, pending: { ...pend, mode: "any", min: 1 } }).text, "Awaiting approval 0 of 1");
eq("mode all with no min → of approvers.length", s({ record: { stateId: "in_review" }, state: review, pending: { ...pend, mode: "all", min: undefined } }).text, "Awaiting approval 0 of 3");
eq("a negative decided count reads 0", s({ record: { stateId: "in_review" }, state: review, pending: pend, pendingDecided: -3 }).text, "Awaiting approval 0 of 2");

// enforced
const enf = { stateId: "approved", enforce: true, approvedVersion: 5, approvalRecord: { pinnedVersion: 3, outcome: "approved", completedAt: "2026-09-19T10:00:00Z", mode: "any", min: 1, approverCount: 1, decisions: [{ name: "Mihai", decision: "approved" }] } };
eq("enforced → State vReviewed (the pin, not the moving baseline)", s({ record: enf, state: approved }).text, "Approved v3");
eq("…tone success", s({ record: enf, state: approved }).tone, "success");
eq("enforced without a record → the baseline version", s({ record: { stateId: "approved", enforce: true, approvedVersion: 5 }, state: approved }).text, "Approved v5");
eq("enforce flag with no version is NOT enforced", s({ record: { stateId: "approved", enforce: true }, state: approved }).text, "Approved");

// overdue beats everything
eq("review overdue beats pending", s({ record: { stateId: "in_review", reviewDueAt: "2026-09-01" }, state: review, pending: pend }).text, "Review overdue");
eq("review overdue beats enforced", s({ record: { ...enf, reviewDueAt: "2026-09-19T00:00:00Z" }, state: approved }).tone, "critical");
eq("a future review date changes nothing", s({ record: { ...enf, reviewDueAt: "2026-12-01" }, state: approved }).text, "Approved v3");

// last decision (only when not enforced and nothing pending — the caller applies the WF-3 rule)
eq("denied → Declined <date>", s({ record: { stateId: "in_review" }, state: review, lastDecision: { kind: "denied", at: "2026-09-19T15:00:00Z", byName: "Mihai" } }).text, "Declined Sep 19");
eq("…tone critical", s({ record: { stateId: "in_review" }, state: review, lastDecision: { kind: "denied", at: "2026-09-19T15:00:00Z" } }).tone, "critical");
eq("stale → Request closed <date>, neutral", s({ record: { stateId: "in_review" }, state: review, lastDecision: { kind: "stale", at: "2026-09-19T15:00:00Z" } }), { stateId: "in_review", stateName: "In Review", kind: "stale", text: "Request closed Sep 19", qualifier: "request closed", tone: "neutral", color: TONE_COLORS.neutral });
eq("a decision with no date still reads", s({ record: { stateId: "in_review" }, state: review, lastDecision: { kind: "denied" } }).text, "Declined");
eq("an enforced page ignores a stale lastDecision", s({ record: enf, state: approved, lastDecision: { kind: "denied", at: "2026-09-19T15:00:00Z" } }).text, "Approved v3");

// approvalSummary
eq("not enforced → null", approvalSummary({ stateId: "draft" }), null);
ok("enforced with decisions → 'Approved for version 3 on … · any one approver.'", /^Approved for version 3 on .+ · any one approver\.$/.test(approvalSummary(enf, { locale: "en-US" })));
ok("min mode names the quorum", /at least 2 of 3/.test(approvalSummary({ ...enf, approvalRecord: { ...enf.approvalRecord, mode: "min", min: 2, approverCount: 3 } }, { locale: "en-US" })));
ok("direct steward approval → 'Approved by X on …'", /^Approved by Mihai on /.test(approvalSummary({ stateId: "approved", enforce: true, approvedVersion: 2, approvalRecord: { outcome: "approved", completedByName: "Mihai", completedAt: "2026-09-19T10:00:00Z", decisions: [] } }, { locale: "en-US" })));
ok("no record → 'details were not recorded'", /details were not recorded/.test(approvalSummary({ stateId: "approved", enforce: true, approvedVersion: 2, approvedAt: "2026-09-19T10:00:00Z" })));

report("workflow-status");
