// A recorded vote is always applied (SVT-146). decideApproval records a vote and then judges the request
// again; when that second judgement could not be made (Confluence started limiting requests or answering
// with errors in between: a second admin's vote raced in and their role could not be read, the page
// version could not be read for the completion, or the function died between the two), the vote stood
// and the request stayed open although it was decided. Now every vote is written ahead as a settle
// marker (workflow-settle-{page}-{account}) before it is recorded; the decide path drops it once the
// outcome is applied, and the hourly workflowSweep applies what is left (settleRecordedVotes), exactly
// once: a completion runs under the completion claim and the state machine's no-op on a page that left
// its state, a denial is logged once per request, and a completion that moved the page but died before
// its cleanup is only cleaned up.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, onConfluence } = await import("./_forge-fake/state.mjs");
const { kvs } = await import("@forge/kvs");
const byKey = (list) => new Map(list);
const workflow = byKey((await import("../src/server/capsules/workflow/actions.js")).actions);
const approvals = await import("../src/server/capsules/workflow/approvals.js");
const triggers = await import("../src/server/triggers.js");
const { DEFAULT_WORKFLOW } = await import("../src/server/capsules/workflow/logic.js");
console.warn = () => {}; console.error = () => {}; console.info = () => {};
console.log = ((log) => (...a) => { if (String(a[0] || "").match(/passed|FAIL/)) log(...a); })(console.log);

const settleRecordedVotes = approvals.settleRecordedVotes || (async () => ({ done: false })); // absent before the fix: the red run shows the stuck request
const X = "acct-approver-x";
const Y = "acct-approver-y";
const ADMIN = "acct-space-admin";
const ADMIN2 = "acct-space-admin-2";
const REQUESTER = "acct-requester";
const PAGE = "7001";
const APPROVED = DEFAULT_WORKFLOW.states.find((s) => s.enforce)?.id || "approved";
const IN_REVIEW = DEFAULT_WORKFLOW.states.find((s) => s.id === "in_review")?.id || DEFAULT_WORKFLOW.states[1].id;
const REQ_AT = "2026-10-02T00:00:00.000Z";
const users = (...ids) => ids.map((id) => ({ id, type: "user", name: id }));

// Switches the Confluence fake reads on every call (a test flips them mid-decision).
const net = { pageVersion: 200, userLookup: 200 };

// `siteAdmins`: accounts Confluence names site admins (their role is read from Confluence, so a 429
// makes it unreadable); `admins`: the space's admins listed in Sentinel Vault (read from storage).
async function world({ approval, admins = [ADMIN, ADMIN2], siteAdmins = [] } = {}) {
  resetFake();
  net.pageVersion = 200; net.userLookup = 200;
  onConfluence((method, rawPath) => {
    const path = decodeURIComponent(rawPath);
    const [base, query = ""] = path.split("?");
    const qs = new URLSearchParams(query);
    if (base === "/wiki/rest/api/user/current") return { body: { accountId: "app-account" } };
    if (base === "/wiki/rest/api/user/memberof") return { body: { results: [] } };
    if (base === "/wiki/rest/api/user") {
      if (net.userLookup !== 200) return { status: net.userLookup, body: {} };
      const a = qs.get("accountId"); return { body: { accountId: a, displayName: a, operations: siteAdmins.includes(a) ? [{ operation: "administer", targetType: "application" }] : [] } };
    }
    if (/^\/wiki\/rest\/api\/content\/[^/]+\/permission\/check$/.test(base)) return { body: { hasPermission: true } };
    if (base === "/wiki/rest/api/group/picker") return { body: { results: [] } };
    if (base === `/wiki/api/v2/pages/${PAGE}`) {
      if (net.pageVersion !== 200) return { status: net.pageVersion, body: {} };
      return { body: { id: PAGE, status: "current", title: "Plan", spaceId: "101", version: { number: 3, authorId: REQUESTER } } };
    }
    if (base === "/wiki/api/v2/pages" && method === "GET") return { body: { results: [{ id: PAGE, status: "current", title: "Plan", spaceId: "101", _links: { webui: "/p" } }] } };
    if (base === "/wiki/api/v2/spaces/101") return { body: { id: "101", key: "AAA" } };
    if (base === "/wiki/api/v2/spaces") return { body: { results: qs.get("keys") === "AAA" ? [{ id: "101", key: "AAA" }] : [] } };
    if (base === "/wiki/api/v2/spaces/101/permissions") return { body: { results: [] } };
    if (/^\/wiki\/api\/v2\/pages\/\d+\/properties/.test(base)) return method === "GET" ? { body: { results: [] } } : { body: { id: "901", version: { number: 1 } } };
    if (method !== "GET") return { body: {} };
    if (/\/labels$/.test(base)) return { body: { results: [] } };
    return undefined;
  });
  await kvs.set("admin-settings-global", { allowAdminOverride: true });
  await kvs.set("admin-settings-space-AAA", { adminUsers: admins.map((accountId) => ({ accountId })) });
  await kvs.set("workflow-settings-AAA", { enabled: true, approval });
  await kvs.set(`workflow-state-${PAGE}`, { workflowId: "default", stateId: IN_REVIEW, spaceKey: "AAA", enteredAt: "2026-10-01T00:00:00.000Z", enforce: false, approvedVersion: null, approvers: [] });
}
async function openRequest({ snapshot = [X, Y], mode = "any", min = 1, aiGate = null } = {}) {
  await kvs.set(`workflow-pending-${PAGE}`, { pageId: PAGE, toStateId: APPROVED, toStateName: "Approved", requestedBy: REQUESTER, requestedByName: "Req", requestedAt: REQ_AT, pinnedVersion: 3, approvers: snapshot, mode, min, spaceKey: "AAA", aiGate });
  for (const a of snapshot) {
    await kvs.set(`workflow-approval-${PAGE}-${APPROVED}-approval-${a}`, { pageId: PAGE, stateId: APPROVED, approverAccountId: a, status: "pending", requestedAt: REQ_AT, pinnedVersion: 3 });
    await kvs.set(`workflow-inbox-${a}-${PAGE}`, { pageId: PAGE, stateId: APPROVED, requestedAt: REQ_AT });
  }
}
const decide = (who, decision) => workflow.get("decide-approval")({ payload: { pageId: PAGE, decision, reason: decision === "denied" ? "no" : undefined }, context: { accountId: who } });
const voteOf = async (who) => (await kvs.get(`workflow-approval-${PAGE}-${APPROVED}-approval-${who}`))?.status;
const stillOpen = async () => !!(await kvs.get(`workflow-pending-${PAGE}`));
const stateNow = async () => (await kvs.get(`workflow-state-${PAGE}`))?.stateId;
const logKinds = async () => [...(await import("./_forge-fake/state.mjs")).fake.kvs.entries()].filter(([k]) => k.startsWith(`workflow-log-${PAGE}-`)).map(([, v]) => v.kind);
const markers = async () => [...(await import("./_forge-fake/state.mjs")).fake.kvs.keys()].filter((k) => k.startsWith(`workflow-settle-${PAGE}-`));
const countOf = (list, kind) => list.filter((k) => k === kind).length;

// Run `inject` once, right after the given approver's vote is recorded (before the request is judged
// again): what a concurrent decision or a Confluence outage starting at that moment looks like.
function afterVoteOf(who, inject) {
  const realSet = kvs.set;
  let done = false;
  kvs.set = async (key, value) => {
    await realSet(key, value);
    if (!done && key === `workflow-approval-${PAGE}-${APPROVED}-approval-${who}` && value?.status && value.status !== "pending") {
      done = true; kvs.set = realSet; await inject();
    }
  };
  return () => { kvs.set = realSet; };
}

// A second space admin's approval lands while X's decision runs: recorded after X's request read and
// judged (by ADMIN2's own call) before X's vote was recorded, so that judgement saw one of two.
const admin2Raced = async () => {
  await kvs.set(`workflow-approval-${PAGE}-${APPROVED}-approval-${ADMIN2}`, { approverAccountId: ADMIN2, status: "approved", admin: true, decidedAt: new Date().toISOString(), approverName: "Admin two" });
  const p = await kvs.get(`workflow-pending-${PAGE}`);
  await kvs.set(`workflow-pending-${PAGE}`, { ...p, adminDeciders: [ADMIN2] });
};

// ══ 1. Two votes race ═══════════════════════════════════════════════════════════════════════════════
// min 2 of [X, Y]. X approves while ADMIN2 (listed as a space admin in Sentinel Vault) approves.
const min2 = { approvers: users(X, Y), mode: "min", min: 2 };
await world({ approval: min2 }); await openRequest({ mode: "min", min: 2 });
{
  const undo = afterVoteOf(X, admin2Raced);
  const r = await decide(X, "approved");
  undo();
  eq("race (the defect: X judged the request it read before ADMIN2 decided): X's vote completes it", r?.transitioned, true);
  eq("race: the page is Approved", await stateNow(), APPROVED);
  eq("race: the request is closed", await stillOpen(), false);
  eq("race: nothing is left to settle", (await markers()).length, 0);
  eq("race: ADMIN2's record is cleared with the request", await voteOf(ADMIN2), undefined);
}

// ══ 1b. Two votes race while Confluence starts limiting requests ════════════════════════════════════
// ADMIN2 is a site admin (role read from Confluence); Confluence answers 429 from the moment X's vote
// is recorded, so X's second judgement cannot tell whether ADMIN2's approval counts.
await world({ approval: min2, admins: [ADMIN], siteAdmins: [ADMIN2] }); await openRequest({ mode: "min", min: 2 });
{
  const undo = afterVoteOf(X, async () => { await admin2Raced(); net.userLookup = 429; });
  const r = await decide(X, "approved");
  undo();
  eq("race: X's vote is recorded", await voteOf(X), "approved");
  eq("race (the defect): X's decision answers pending", r?.outcome, "pending");
  eq("race: the page has not moved yet", await stateNow(), IN_REVIEW);
  eq("race: the request is still open", await stillOpen(), true);
  ok("race: X's vote is left to be applied (settle marker)", (await markers()).length === 1);

  // Still limited: the sweep keeps it for the next run and changes nothing.
  const s0 = await settleRecordedVotes(PAGE);
  eq("race, still limited: nothing is applied", s0?.done, false);
  eq("race, still limited: the page has not moved", await stateNow(), IN_REVIEW);
  ok("race, still limited: the marker stays", (await markers()).length === 1);

  // Confluence answers again: the hourly sweep applies the two approvals.
  net.userLookup = 200;
  const sweep = JSON.parse((await triggers.workflowSweep()).body);
  eq("race: the hourly sweep applies the decided request", await stateNow(), APPROVED);
  eq("race: the sweep reports one settled request", sweep.votesSettled, 1);
  eq("race: the request is closed", await stillOpen(), false);
  eq("race: no marker is left", (await markers()).length, 0);
  const ev = (await kvs.get(`workflow-state-${PAGE}`))?.approvalRecord;
  ok("race: the evidence counts X's and the admin's approvals", [X, ADMIN2].every((id) => (ev?.decisions || []).find((d) => d.accountId === id && d.decision === "approved")?.counted === true));
  eq("race: the evidence names the approver whose vote completed it", ev?.completedBy, X);
  const kinds = await logKinds();
  // Applied once: a second sweep and a late settle change nothing.
  await triggers.workflowSweep(); await settleRecordedVotes(PAGE);
  eq("race: the log did not grow on the second sweep", (await logKinds()).length, kinds.length);
}

// ══ 2. The completion could not read the page version (5xx) ════════════════════════════════════════
// (A 5xx before the vote is recorded refuses it up front: the moved-page check cannot read the page.)
await world({ approval: { approvers: users(X, Y), mode: "any" } }); await openRequest();
{
  const undo = afterVoteOf(X, async () => { net.pageVersion = 503; });
  const r = await decide(X, "approved");
  undo();
  eq("5xx: X's vote is recorded", await voteOf(X), "approved");
  eq("5xx: the page did not move", await stateNow(), IN_REVIEW);
  ok("5xx: the decision says it was not applied", r?.transitioned !== true);
  eq("5xx: the request is still open", await stillOpen(), true);
  eq("5xx: X cannot decide again (the vote stands)", (await decide(X, "approved"))?.success, false);
  net.pageVersion = 200;
  const s = await settleRecordedVotes(PAGE);
  eq("5xx: once Confluence answers, the recorded approval completes the request", await stateNow(), APPROVED);
  eq("5xx: settle reports it done", s?.done, true);
  eq("5xx: the request is closed", await stillOpen(), false);
  const before = (await logKinds()).length;
  eq("5xx: a second settle is a no-op", (await settleRecordedVotes(PAGE))?.done, false);
  eq("5xx: the log did not grow", (await logKinds()).length, before);
}

// ══ 3. A normal decision leaves nothing behind ═══════════════════════════════════════════════════════
await world({ approval: min2 }); await openRequest({ mode: "min", min: 2 });
eq("control: X approves one of two: pending", (await decide(X, "approved"))?.outcome, "pending");
eq("control: nothing is left to settle after a judged vote", (await markers()).length, 0);
eq("control: Y completes it", (await decide(Y, "approved"))?.transitioned, true);
eq("control: no marker after a completion", (await markers()).length, 0);

// ══ 4. The function died between recording the vote and judging the request ═════════════════════════
// (simulated: the vote and its marker are there, nothing else happened)
await world({ approval: { approvers: users(X, Y), mode: "all" } }); await openRequest({ mode: "all" });
await kvs.set(`workflow-approval-${PAGE}-${APPROVED}-approval-${X}`, { pageId: PAGE, stateId: APPROVED, approverAccountId: X, status: "denied", reason: "no", decidedAt: new Date().toISOString(), requestedAt: REQ_AT, pinnedVersion: 3 });
await kvs.set(`workflow-settle-${PAGE}-${X}`, { pageId: PAGE, accountId: X, decision: "denied", request: REQ_AT, at: Date.now() });
{
  const s = await settleRecordedVotes(PAGE);
  eq("died after a denial: the all-of request is closed as denied", await stillOpen(), false);
  eq("died after a denial: settle reports it done", s?.done, true);
  eq("died after a denial: the page did not move", await stateNow(), IN_REVIEW);
  eq("died after a denial: one denial in the log", countOf(await logKinds(), "approval-denied"), 1);
  await settleRecordedVotes(PAGE);
  eq("died after a denial: a second settle logs nothing more", countOf(await logKinds(), "approval-denied"), 1);
}

// A denial whose log entry was written but whose cleanup died: closed without a second entry.
await world({ approval: { approvers: users(X, Y), mode: "all" } }); await openRequest({ mode: "all" });
await kvs.set(`workflow-approval-${PAGE}-${APPROVED}-approval-${X}`, { pageId: PAGE, stateId: APPROVED, approverAccountId: X, status: "denied", reason: "no", decidedAt: new Date().toISOString(), requestedAt: REQ_AT, pinnedVersion: 3 });
await kvs.set(`workflow-settle-${PAGE}-${X}`, { pageId: PAGE, accountId: X, decision: "denied", request: REQ_AT, at: Date.now() });
await kvs.set(`workflow-log-${PAGE}-${Date.now()}`, { ts: Date.now(), kind: "approval-denied", from: IN_REVIEW, to: APPROVED, by: X });
await settleRecordedVotes(PAGE);
eq("denial logged, cleanup died: the request is closed", await stillOpen(), false);
eq("denial logged, cleanup died: still one denial in the log", countOf(await logKinds(), "approval-denied"), 1);

// ══ 5. A completion that moved the page but died before its cleanup ═════════════════════════════════
await world({ approval: { approvers: users(X, Y), mode: "any" } }); await openRequest();
await kvs.set(`workflow-approval-${PAGE}-${APPROVED}-approval-${X}`, { pageId: PAGE, stateId: APPROVED, approverAccountId: X, status: "approved", decidedAt: new Date().toISOString(), requestedAt: REQ_AT, pinnedVersion: 3 });
await kvs.set(`workflow-settle-${PAGE}-${X}`, { pageId: PAGE, accountId: X, decision: "approved", request: REQ_AT, at: Date.now() });
await kvs.set(`workflow-state-${PAGE}`, { workflowId: "default", stateId: APPROVED, spaceKey: "AAA", enteredAt: new Date().toISOString(), enforce: true, approvedVersion: 3, approvers: [X, Y], approvalRecord: { outcome: "approved", requestedAt: REQ_AT, completedBy: X } });
{
  const before = (await logKinds()).length;
  const s = await settleRecordedVotes(PAGE);
  eq("moved but not cleaned: the open request is cleared", await stillOpen(), false);
  eq("moved but not cleaned: nothing is moved again (log unchanged)", (await logKinds()).length, before);
  eq("moved but not cleaned: settle reports it done", s?.done, true);
  eq("moved but not cleaned: X's inbox row is gone", await kvs.get(`workflow-inbox-${X}-${PAGE}`), undefined);
}

// ══ 6. A marker from an older request (re-requested since) applies nothing ═══════════════════════════
await world({ approval: { approvers: users(X, Y), mode: "any" } }); await openRequest();
await kvs.set(`workflow-settle-${PAGE}-${X}`, { pageId: PAGE, accountId: X, decision: "approved", request: "2026-09-01T00:00:00.000Z", at: Date.now() });
await kvs.set(`workflow-approval-${PAGE}-${APPROVED}-approval-${X}`, { pageId: PAGE, stateId: APPROVED, approverAccountId: X, status: "approved", decidedAt: new Date().toISOString(), requestedAt: REQ_AT, pinnedVersion: 3 });
await settleRecordedVotes(PAGE);
eq("old request's marker: the page did not move", await stateNow(), IN_REVIEW);
eq("old request's marker: the request stays open", await stillOpen(), true);
eq("old request's marker: removed", (await markers()).length, 0);

// A marker whose vote was never recorded (the record write failed after it): nothing is applied.
await world({ approval: { approvers: users(X, Y), mode: "any" } }); await openRequest();
await kvs.set(`workflow-settle-${PAGE}-${X}`, { pageId: PAGE, accountId: X, decision: "approved", request: REQ_AT, at: Date.now() });
await settleRecordedVotes(PAGE);
eq("marker without a vote: the page did not move", await stateNow(), IN_REVIEW);
eq("marker without a vote: removed", (await markers()).length, 0);

// ══ 7. Settle never turns a "no" into an approval, and waits for the AI review ═══════════════════════
// min 2 of [X, Y, Z]: X and Y approved; Z is taken off the list; Z's denial is what is left to settle
// (the quorum reads approved only after the removal re-clamped the minimum: the decide path keeps a
// "no" from completing it, and so does settle).
const Z = "acct-approver-z";
await world({ approval: { approvers: users(X, Y), mode: "min", min: 3 } }); await openRequest({ snapshot: [X, Y, Z], mode: "min", min: 3 });
await kvs.set(`workflow-approval-${PAGE}-${APPROVED}-approval-${X}`, { approverAccountId: X, status: "approved" });
await kvs.set(`workflow-approval-${PAGE}-${APPROVED}-approval-${Y}`, { approverAccountId: Y, status: "approved" });
await kvs.set(`workflow-approval-${PAGE}-${APPROVED}-approval-${Z}`, { approverAccountId: Z, status: "denied" });
await kvs.set(`workflow-settle-${PAGE}-${Z}`, { pageId: PAGE, accountId: Z, decision: "denied", request: REQ_AT, at: Date.now() });
await settleRecordedVotes(PAGE);
eq("a denial left to settle never completes the request", await stateNow(), IN_REVIEW);

await world({ approval: { approvers: users(X, Y), mode: "any" } }); await openRequest({ aiGate: { required: true, status: "pending", threshold: "medium", reviewedVersion: null, reason: null, enqueuedAt: Date.now() } });
await kvs.set(`workflow-approval-${PAGE}-${APPROVED}-approval-${X}`, { approverAccountId: X, status: "approved" });
await kvs.set(`workflow-settle-${PAGE}-${X}`, { pageId: PAGE, accountId: X, decision: "approved", request: REQ_AT, at: Date.now() });
await settleRecordedVotes(PAGE);
eq("AI review pending: settle does not complete it", await stateNow(), IN_REVIEW);
eq("AI review pending: the request stays open for the AI verdict", await stillOpen(), true);
eq("AI review pending: nothing left to settle (the verdict completes it)", (await markers()).length, 0);

// ══ 7b. Approvers taken off the list AFTER the vote: the sweep does not complete on that ══════════════
// min 2 of [X, Y, Z]; X approved (judged "pending" when cast: one of two); then Y and Z are taken off the
// space's list, so the quorum re-clamps to 1. Nobody acted after the removal: not completed.
const vote = (who, status) => kvs.set(`workflow-approval-${PAGE}-${APPROVED}-approval-${who}`, { approverAccountId: who, status, approverName: who });
const marker = (who, decision, judged) => kvs.set(`workflow-settle-${PAGE}-${who}`, { pageId: PAGE, accountId: who, decision, judged, request: REQ_AT, at: Date.now() });
await world({ approval: { approvers: users(X), mode: "min", min: 2 } }); await openRequest({ snapshot: [X, Y, Z], mode: "min", min: 2 });
await vote(X, "approved"); await marker(X, "approved", "pending");
await settleRecordedVotes(PAGE);
eq("removal after the vote: the sweep does not complete the re-clamped quorum", await stateNow(), IN_REVIEW);
eq("removal after the vote: the request stays open (an explicit approval or a re-request finishes it)", await stillOpen(), true);
// The same, but the approval was judged to complete it when cast (the removal came before the vote,
// which the decide path accepts) and only the completion failed: the sweep completes it.
await world({ approval: { approvers: users(X), mode: "min", min: 2 } }); await openRequest({ snapshot: [X, Y, Z], mode: "min", min: 2 });
await vote(X, "approved"); await marker(X, "approved", "approved");
await settleRecordedVotes(PAGE);
eq("removal before the vote, completion failed: the sweep completes it", await stateNow(), APPROVED);

// The vote left to settle is by someone taken off the list since: it neither completes the request nor
// is named as who completed it. any-of [X, Y]: Y approved (counts), X approved and was removed.
await world({ approval: { approvers: users(Y), mode: "any" } }); await openRequest();
await vote(Y, "approved"); await vote(X, "approved"); await marker(X, "approved", "approved");
await settleRecordedVotes(PAGE);
eq("a removed approver's vote does not complete the request from the sweep", await stateNow(), IN_REVIEW);
eq("a removed approver's vote: its marker goes", (await markers()).length, 0);

// ══ 8. Withdraw and a completed request remove what was left ═════════════════════════════════════════
await world({ approval: { approvers: users(X, Y), mode: "any" } }); await openRequest();
await kvs.set(`workflow-settle-${PAGE}-${X}`, { pageId: PAGE, accountId: X, decision: "approved", request: REQ_AT, at: Date.now() });
await approvals.withdrawApproval({ pageId: PAGE, actorAccountId: REQUESTER, actorName: "Req" });
eq("withdraw: the marker goes with the request", (await markers()).length, 0);

report("vote-converge");
