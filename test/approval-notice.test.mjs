// WF-1 / WF-3 (UX critique 2026-09-19): the requester's comment and the stale sentences, pure.
// A stale close never says "declined"; a denial carries the approver's reason.
import { eq, ok, report } from "./_assert.mjs";
import { approvalResolvedBody } from "../src/server/infra/approval-blueprints.js";
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
  ok("denied: prints the reason", b.includes(": <em>“Needs a summary section at the top”</em>."));
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

report("approval-notice");
