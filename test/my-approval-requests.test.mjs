// WF-3 (c): the requester's own approval requests — the pure classifier behind "Approvals you
// asked for" on My work. One row per (requester, page); what it means is decided from the pending
// record, the page's record and the last logged decision, never from the row alone.
import { classifyMyApprovalRequest, myRequestKey, MY_REQUEST_KEEP_MS } from "../src/server/capsules/workflow/my-requests.js";
import { eq, ok, report } from "./_assert.mjs";

const NOW = Date.parse("2026-09-20T12:00:00Z");
const ME = "acc-me";
const row = { requesterAccountId: ME, pageId: "77", spaceKey: "WFH", toStateId: "approved", toStateName: "Approved", requestedAt: "2026-09-20T10:00:00Z" };

eq("key = prefix + requester + page", myRequestKey(ME, "77"), "wfreq-mine-acc-me-77");

// pending
const pend = classifyMyApprovalRequest({ row, pending: { requestedBy: ME, approvers: ["a", "b"], mode: "all" }, decided: 1, now: NOW });
eq("an open request by me is pending, n of m decided", [pend.status, pend.decided, pend.approverCount, pend.keep], ["pending", 1, 2, true]);
eq("someone else's open request on the same page is not mine", classifyMyApprovalRequest({ row, pending: { requestedBy: "acc-x", approvers: ["a"] }, record: null, lastDecision: null, now: NOW }).status, "gone");

// approved
const rec = { approvedVersion: 4, approvalRecord: { requestedBy: ME, outcome: "approved", completedAt: "2026-09-20T11:00:00Z", completedByName: "Gabriela" } };
const appr = classifyMyApprovalRequest({ row, pending: null, record: rec, lastDecision: null, now: NOW });
eq("approved: by whom, at which version", [appr.status, appr.byName, appr.approvedVersion, appr.keep], ["approved", "Gabriela", 4, true]);
ok("an approval OLDER than my request is not my approval", classifyMyApprovalRequest({ row, pending: null, record: { approvalRecord: { ...rec.approvalRecord, completedAt: "2026-09-19T11:00:00Z" } }, lastDecision: null, now: NOW }).status === "gone");
ok("an approval decided two weeks ago is dropped", classifyMyApprovalRequest({ row: { ...row, requestedAt: "2026-09-01T10:00:00Z" }, pending: null, record: { approvalRecord: { ...rec.approvalRecord, completedAt: "2026-09-01T11:00:00Z" } }, lastDecision: null, now: NOW }).keep === false);

// denied / stale
const den = classifyMyApprovalRequest({ row, pending: null, record: { stateId: "in_review" }, lastDecision: { kind: "denied", at: Date.parse("2026-09-20T11:30:00Z"), byName: "Mihai", reason: "needs a summary" }, now: NOW });
eq("declined: the approver's word travels", [den.status, den.byName, den.reason, den.keep], ["denied", "Mihai", "needs a summary", true]);
const stale = classifyMyApprovalRequest({ row, pending: null, record: { stateId: "in_review" }, lastDecision: { kind: "stale", at: Date.parse("2026-09-20T11:30:00Z"), reviewedVersion: 2 }, now: NOW });
eq("stale: refused because the page changed", [stale.status, stale.reviewedVersion], ["stale", 2]);
ok("a decision older than my request is not about it", classifyMyApprovalRequest({ row, pending: null, record: {}, lastDecision: { kind: "denied", at: Date.parse("2026-09-19T11:30:00Z") }, now: NOW }).status === "gone");
ok("a decision older than the keep window is dropped", classifyMyApprovalRequest({ row: { ...row, requestedAt: "2026-09-01T10:00:00Z" }, pending: null, record: {}, lastDecision: { kind: "denied", at: NOW - MY_REQUEST_KEEP_MS - 1 }, now: NOW }).keep === false);
ok("nothing anywhere → gone", classifyMyApprovalRequest({ row, pending: null, record: null, lastDecision: null, now: NOW }).status === "gone");
ok("no row → gone", classifyMyApprovalRequest({ row: null }).status === "gone");
report("my-approval-requests");
