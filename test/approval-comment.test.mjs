// The comment the requester gets when an approval request completes (2026-10-18, content pilot
// two-seats-2): it was titled "Approval approved" and left out the reason the approver typed
// ("Read in full, v7"). It now says what happened in its title (Approved v<n> by <name>) and carries
// every approver's typed reason. Driven through the REAL request-transition and decide-approval
// resolvers on the in-memory Forge fake, so the test also proves the finalizer passes the reason on.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake } = await import("./_forge-fake/state.mjs");
const { createWorld } = await import("./_forge-fake/confluence-world.mjs");
const logic = await import("../src/server/capsules/workflow/logic.js");
const { kvs } = await import("@forge/kvs");
const wf = new Map((await import("../src/server/capsules/workflow/actions.js")).actions);
const { approvalResolvedBody } = await import("../src/server/infra/approval-blueprints.js");

const APP = "app-account";
const ANA = "acct-ana";
const BO = "acct-bo";
const PAT = "acct-pat";
const SPACE = "WF";
const PAGE = "601";

const realLog = { info: console.info, warn: console.warn, error: console.error, log: console.log };
const quiet = () => { console.info = () => {}; console.warn = () => {}; console.error = () => {}; };
const loud = () => Object.assign(console, realLog);

async function bed({ mode = "any", approvers = [ANA] } = {}) {
  resetFake();
  const w = createWorld({ appAccountId: APP, spaceKey: SPACE });
  w.addUser(APP, { displayName: "Sentinel Vault" }).addUser(ANA, { displayName: "Ana Approver" })
    .addUser(BO, { displayName: "Bo Reviewer" }).addUser(PAT, { displayName: "Pat Plain" })
    .addPage(PAGE, { versions: [{ authorId: PAT, text: "draft" }, { authorId: PAT, text: "ready for review" }] });
  w.readers.add("*");
  await kvs.set("app-account-id", APP);
  await kvs.set("admin-settings-global", { enableEmailDispatches: true }); // the comment channel is opt-in
  await kvs.set(`workflow-settings-${SPACE}`, {
    enabled: true, workflowId: "default", enforceMode: "revert",
    approval: { approvers: approvers.map((id) => ({ type: "user", id, name: id === ANA ? "Ana Approver" : "Bo Reviewer" })), mode, min: 1 },
  });
  await logic.assignPageWorkflow({ pageId: PAGE, spaceKey: SPACE, actorAccountId: PAT, actorName: "Pat Plain", workflowId: "default" });
  await logic.transitionPageWorkflow({ pageId: PAGE, spaceKey: SPACE, toStateId: "in_review", actorAccountId: PAT, actorName: "Pat Plain" });
  const as = (key, accountId, payload) => wf.get(key)({ payload: { pageId: PAGE, ...payload }, context: { accountId } });
  const req = await as("request-transition", PAT, { toStateId: "approved", fromStateId: "in_review" });
  if (!req?.pending) throw new Error(`request did not open: ${JSON.stringify(req)}`);
  w.comments.length = 0;
  return { w, as };
}
const text = (c) => String(c?.body ? (typeof c.body === "string" ? c.body : JSON.stringify(c.body)) : "");
const approvedComment = (w) => w.comments.map(text).find((b) => /moved|approved/i.test(b) && /request to move this page/.test(b)) || "";

quiet();
try {
  // 1. One approver, a typed reason.
  {
    const { w, as } = await bed();
    const r = await as("decide-approval", ANA, { decision: "approved", reason: "Read in full, v2" });
    eq("[1] the approval completes", [r?.success, r?.outcome, r?.transitioned], [true, "approved", true]);
    const c = approvedComment(w);
    ok("[1] the requester gets a comment", !!c);
    ok("[1] the title says what happened: Approved v2 by the approver", c.includes("Approved v2 by Ana Approver"));
    ok("[1] the title is no longer \"Approval approved\"", !c.includes("Approval approved"));
    ok("[1] the approver's typed reason is in the comment", c.includes("Read in full, v2"));
  }
  // 2. Two approvers ("all"), each with a reason: both names in the title, both reasons, each named.
  {
    const { w, as } = await bed({ mode: "all", approvers: [ANA, BO] });
    await as("decide-approval", ANA, { decision: "approved", reason: "Numbers checked" });
    ok("[2] no comment after the first of two approvals", !approvedComment(w));
    const r = await as("decide-approval", BO, { decision: "approved", reason: "Wording is fine" });
    eq("[2] the second approval completes", [r?.outcome, r?.transitioned], ["approved", true]);
    const c = approvedComment(w);
    ok("[2] the title names both approvers", c.includes("Approved v2 by Ana Approver and Bo Reviewer"));
    ok("[2] the first approver's reason, with their name", c.includes("Ana Approver") && c.includes("Numbers checked"));
    ok("[2] the second approver's reason, with their name", c.includes("Wording is fine"));
  }
  // 3. No reason typed: no empty Reason line.
  {
    const { w, as } = await bed();
    await as("decide-approval", ANA, { decision: "approved" });
    const c = approvedComment(w);
    ok("[3] approved without a reason: no Reason line", c.includes("Approved v2 by Ana Approver") && !/Reason/.test(c));
  }
} finally {
  loud();
}

// 4. The pure body: escaping, the label, and the denial title unchanged.
{
  const b = approvalResolvedBody({ requestedBy: PAT, outcome: "approved", targetName: "Approved", pinnedVersion: 7, approvals: [{ name: "Lena <Steward>", reason: "<b>ok</b> & fine" }] });
  ok("[4] the name is escaped in the title", b.includes("Approved v7 by Lena &lt;Steward&gt;"));
  ok("[4] the reason is escaped", b.includes("&lt;b&gt;ok&lt;/b&gt; &amp; fine") && !b.includes("<b>ok</b>"));
  const ai = approvalResolvedBody({ requestedBy: PAT, outcome: "approved", targetName: "Approved", pinnedVersion: 7, approvals: [] });
  ok("[4] completed with no human approver named (AI-only gate): Approved v7", ai.includes("<strong>Approved v7</strong>") && !ai.includes(" by "));
  const d = approvalResolvedBody({ requestedBy: PAT, outcome: "denied", targetName: "Approved", deciderName: "Ana Approver", reason: "Needs a summary" });
  ok("[4] a denial still reads Approval declined with its reason", d.includes("Approval declined") && d.includes("Needs a summary"));
}
report("approval-comment");
