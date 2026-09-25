// WF-1 / WF-3 (UX critique 2026-09-19): the requester's comment and the stale sentences, pure.
// A stale close never says "declined"; a denial carries the approver's reason.
import { eq, ok, report } from "./_assert.mjs";
import { approvalResolvedBody, enforceCommentBody, buildWorkflowEnforcementDispatch } from "../src/server/infra/approval-blueprints.js";
import { describeStaleRequest, describeStaleClosed } from "../src/server/capsules/workflow/approvals.js";

const REQ = "712020:abc";

// stale close
{
  const b = approvalResolvedBody({ requestedBy: REQ, outcome: "stale", targetName: "Approved", deciderName: "Mihai Perdum", pinnedVersion: 1, liveVersion: 2 });
  ok("stale: titled 'request closed'", b.includes("<strong>Approval request closed</strong>"));
  ok("stale: names both versions", b.includes("(v1 → v2)"));
  ok("stale: says nobody declined", b.includes("Nobody declined it"));
  ok("stale: never says 'declined by'", !/declined by/i.test(b));
  ok("stale: never names the decider", !b.includes("Mihai Perdum"));
  ok("stale: mentions the requester", b.includes(`ri:account-id="${REQ}"`));
  ok("stale: asks to re-request", /Re-request approval/.test(b));
}
// stale close with no versions known
ok("stale without versions still reads", approvalResolvedBody({ requestedBy: REQ, outcome: "stale", targetName: "Approved" }).includes("so the request was closed"));

// denied, with and without a reason (WF-3)
{
  const b = approvalResolvedBody({ requestedBy: REQ, outcome: "denied", targetName: "Approved", deciderName: "Mihai Perdum", reason: "Needs a summary section at the top" });
  ok("denied: says declined by the decider", b.includes("was <strong>declined</strong> by Mihai Perdum"));
  ok("denied: prints the reason on its own labelled line", b.includes("<p><strong>Reason:</strong> <em>“Needs a summary section at the top”</em></p>"));
  ok("denied: the sentence ends before the reason", b.includes("was <strong>declined</strong> by Mihai Perdum. The page stays in its current state.</p>"));
  ok("denied: stays in state", b.includes("The page stays in its current state."));
  const noReason = approvalResolvedBody({ requestedBy: REQ, outcome: "denied", targetName: "Approved", deciderName: "Mihai Perdum" });
  ok("denied without reason: no empty quotes", !noReason.includes("“”") && noReason.includes("by Mihai Perdum."));
  const esc = approvalResolvedBody({ requestedBy: REQ, outcome: "denied", targetName: "Approved", reason: "<b>x</b> & y" });
  ok("denied: reason is escaped", esc.includes("&lt;b&gt;x&lt;/b&gt; &amp; y"));
}
// approved
{
  const b = approvalResolvedBody({ requestedBy: REQ, outcome: "approved", targetName: "Approved", deciderName: "Mihai Perdum", reason: "Looks good" });
  ok("approved: says approved by", b.includes("was <strong>approved</strong> by Mihai Perdum"));
  ok("approved: carries the reason too", b.includes("“Looks good”"));
  ok("approved: the page has moved", b.includes("The page has moved."));
}

// the two stale sentences
eq("refusal names versions and the requester", describeStaleRequest(1, 3, "Gabriela Perdum"),
  "This page changed after the request (reviewed v1, now v3). Approving would not move it — re-request approval for v3, or ask Gabriela Perdum to.");
eq("refusal without a requester name", describeStaleRequest(1, 3, null),
  "This page changed after the request (reviewed v1, now v3). Approving would not move it — re-request approval for v3.");
eq("closed sentence", describeStaleClosed(1, 2),
  "The page changed after the request (v1 → v2), so the request was closed — nobody declined it. Re-request approval when the page is ready.");
ok("closed sentence never says declined by", !/declined by/.test(describeStaleClosed(1, 2)));

// WF-2: the enforcement notices, in the editor's words
{
  const ED = "712020:ed";
  const rev = enforceCommentBody("123", ED, "revert", { approvedVersion: 1, revertedVersion: 2 });
  ok("revert: mentions the editor", rev.includes(`ri:account-id="${ED}"`));
  ok("revert: names the approved version", rev.includes("(v1)"));
  ok("revert: links the editor's own version", rev.includes("pageId=123&amp;pageVersion=2") && rev.includes("open your version (v2)"));
  ok("revert: no engineering words", !/structural compare|transition/i.test(rev));
  ok("revert: says what to do next", /ask an approver or space admin/.test(rev) && /request approval for your version/.test(rev));
  const revNoV = enforceCommentBody("123", ED, "revert", {});
  ok("revert without versions falls back to history", revNoV.includes("viewpreviousversions.action?pageId=123"));
  const dem = enforceCommentBody("123", ED, "demote", { demotedToName: "Draft" });
  ok("demote: titled Moved back to Draft", dem.includes("<strong>Moved back to Draft</strong>"));
  ok("demote: nothing was lost", dem.includes("Nothing was lost"));
  ok("demote: no engineering words", !/structural compare|transition/i.test(dem));
  ok("expired keeps its copy", enforceCommentBody("1", null, "expired", {}).includes("Approval expired"));
  ok("overdue keeps its copy", enforceCommentBody("1", null, "expired", { noTransition: true, stateName: "Approved" }).includes("still Approved"));
  ok("revert-failed says it could not restore yet and will retry (WF-10: no \"Enforcement pending\")", enforceCommentBody("1", null, "revert-failed", {}).includes("could not restore the approved version of this page yet") && !enforceCommentBody("1", null, "revert-failed", {}).includes("Enforcement pending"));

  const d1 = buildWorkflowEnforcementDispatch({ pageId: "9", mode: "revert", editorAccountId: ED, approverAccountId: "712020:ap", approvedVersion: 3, revertedVersion: 4, via: "event" });
  eq("dispatch revert type", d1.type, "workflow-reverted");
  eq("dispatch parties", [d1.editorAccountId, d1.ownerAccountId], [ED, "712020:ap"]);
  eq("dispatch versions", [d1.approvedVersion, d1.revertedVersion, d1.demotedToName], [3, 4, null]);
  const d2 = buildWorkflowEnforcementDispatch({ pageId: "9", mode: "demote", editorAccountId: ED, approverAccountId: null, approvedVersion: 3, demotedToName: "Draft", via: "sweep" });
  eq("dispatch demote type", d2.type, "workflow-demoted");
  eq("dispatch demote carries the target, no reverted version", [d2.demotedToName, d2.revertedVersion, d2.ownerAccountId, d2.via], ["Draft", null, null, "sweep"]);
}

report("approval-notice");
