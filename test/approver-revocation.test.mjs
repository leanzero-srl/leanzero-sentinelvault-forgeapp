// An approval request keeps the approver list it was opened with. Deciding it is an approver's act
// NOW: a person off the space's current approver list (or out of the approver group) does not decide
// it, re-pin it, or accept a proposal that hangs off it. When the approver list cannot be read (a
// group lookup failed, Confluence is limiting requests) the answer is "unknown": nothing is recorded
// and the person is asked to try again. A space admin keeps the admin's own right to decide. The
// page trigger's rule for EDITS by an approver is the same one (the snapshot AND the live list) and
// trusts the snapshot while the list cannot be read.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, onConfluence, fake } = await import("./_forge-fake/state.mjs");
const { kvs } = await import("@forge/kvs");
const byKey = (list) => new Map(list);
const workflow = byKey((await import("../src/server/capsules/workflow/actions.js")).actions);
const editreq = byKey((await import("../src/server/capsules/editreq/actions.js")).actions);
const { workflowPrivilegeForPage } = await import("../src/server/capsules/workflow/privilege.js");
const { collectWorkflowEnforcementForPage } = await import("../src/server/triggers.js");
const { listMyApprovals, applyAiVerdict, resolveApproverIds, getPageApprovalStatus, quorumOutcome } = await import("../src/server/capsules/workflow/approvals.js");
const { listPendingRequestsForOwner, writeProposalIndex } = await import("../src/server/capsules/editreq/logic.js");
const { DEFAULT_WORKFLOW } = await import("../src/server/capsules/workflow/logic.js");
const { pageDetailsSummary } = await import("../src/server/capsules/page-details/actions.js");
console.warn = () => {}; console.error = () => {}; console.info = () => {};
console.log = ((log) => (...a) => { if (String(a[0] || "").match(/passed|FAIL/)) log(...a); })(console.log);

const X = "acct-removed-approver";
const Y = "acct-current-approver";
const ADMIN = "acct-space-admin";
const ADMIN2 = "acct-second-space-admin";
const REQUESTER = "acct-requester";
const PAGE = "6001";
const GROUP = "0f8fad5b-d9cb-469f-a165-70867728950e";
const APPROVED = DEFAULT_WORKFLOW.states.find((s) => s.enforce)?.id || "approved";
const IN_REVIEW = DEFAULT_WORKFLOW.states.find((s) => s.id === "in_review")?.id || DEFAULT_WORKFLOW.states[1].id;
const users = (...ids) => ids.map((id) => ({ id, type: "user", name: id }));

/**
 * One page in space AAA. `approval` is the space's CURRENT approver setting. `group` answers the
 * approver group's member list: an array of account ids, or a status code (429 / 500).
 */
async function world({ approval, group = [], liveVersion = 3, stateId = IN_REVIEW } = {}) {
  resetFake();
  onConfluence((method, rawPath) => {
    const path = decodeURIComponent(rawPath);
    const [base, query = ""] = path.split("?");
    const qs = new URLSearchParams(query);
    let m;
    if (base === "/wiki/rest/api/user/current") return { body: { accountId: "app-account" } };
    if (base === "/wiki/rest/api/user/memberof") return { body: { results: [] } };
    if (base === "/wiki/rest/api/user") { const a = qs.get("accountId"); return { body: { accountId: a, displayName: a, operations: [] } }; }
    if (/^\/wiki\/rest\/api\/content\/[^/]+\/permission\/check$/.test(base)) return { body: { hasPermission: true } };
    if (base === "/wiki/rest/api/group/picker") return { body: { results: [] } }; // a group looked up by name that no longer exists
    if (base === `/wiki/rest/api/group/${GROUP}/membersByGroupId`) {
      if (typeof group === "number") return { status: group, body: {} };
      return { body: { results: group.map((accountId) => ({ accountId })), _links: {} } };
    }
    if (base === `/wiki/api/v2/pages/${PAGE}`) return { body: { id: PAGE, status: "current", title: "The page", spaceId: "101", version: { number: liveVersion, authorId: REQUESTER } } };
    if (base === "/wiki/api/v2/pages" && method === "GET") return { body: { results: [{ id: PAGE, status: "current", title: "The page", spaceId: "101", _links: { webui: "/p" } }] } };
    if (base === "/wiki/api/v2/spaces/101") return { body: { id: "101", key: "AAA" } };
    if (base === "/wiki/api/v2/spaces") return { body: { results: qs.get("keys") === "AAA" ? [{ id: "101", key: "AAA" }] : [] } };
    if (base === "/wiki/api/v2/spaces/101/permissions") return { body: { results: [] } };
    if ((m = base.match(/^\/wiki\/api\/v2\/pages\/\d+\/properties/))) {
      if (method === "GET" && qs.get("key") === "sentinel-vault-workflow" && stateId === APPROVED) return { body: { results: [{ id: "900", value: { enforce: true }, version: { number: 1 } }] } };
      return method === "GET" ? { body: { results: [] } } : { body: { id: "901", version: { number: 1 } } };
    }
    if (method !== "GET") return { body: {} };
    if (/\/labels$/.test(base)) return { body: { results: [] } };
    return undefined;
  });
  await kvs.set("admin-settings-global", { allowAdminOverride: true });
  await kvs.set("admin-settings-space-AAA", { adminUsers: [{ accountId: ADMIN }, { accountId: ADMIN2 }] });
  await kvs.set("workflow-settings-AAA", { enabled: true, approval });
  await kvs.set(`workflow-state-${PAGE}`, {
    workflowId: "default", stateId, spaceKey: "AAA", enteredAt: "2026-10-01T00:00:00.000Z",
    enforce: stateId === APPROVED, approvedVersion: stateId === APPROVED ? 3 : null, approvers: stateId === APPROVED ? [X, Y] : [],
  });
}

/** An open request whose approver SNAPSHOT is [X, Y] (and ADMIN when asked), pinned to v3. */
async function openRequest({ snapshot = [X, Y], pinnedVersion = 3, mode = "any", min = 1, aiGate = null } = {}) {
  await kvs.set(`workflow-pending-${PAGE}`, { pageId: PAGE, toStateId: APPROVED, toStateName: "Approved", requestedBy: REQUESTER, requestedByName: "Req", requestedAt: "2026-10-02T00:00:00.000Z", pinnedVersion, approvers: snapshot, mode, min, spaceKey: "AAA", aiGate });
  for (const a of snapshot) {
    await kvs.set(`workflow-approval-${PAGE}-${APPROVED}-approval-${a}`, { pageId: PAGE, stateId: APPROVED, approverAccountId: a, status: "pending", requestedAt: "2026-10-02T00:00:00.000Z", pinnedVersion });
    await kvs.set(`workflow-inbox-${a}-${PAGE}`, { pageId: PAGE, stateId: APPROVED, requestedAt: "2026-10-02T00:00:00.000Z" });
  }
}
const as = (fn, accountId, payload) => fn({ payload, context: { accountId, extension: { content: { id: PAGE, space: { key: "AAA" } } } } });
const decide = (who, decision) => as(workflow.get("decide-approval"), who, { pageId: PAGE, decision, reason: decision === "denied" ? "no" : undefined });
const voteOf = async (who) => (await kvs.get(`workflow-approval-${PAGE}-${APPROVED}-approval-${who}`))?.status;
const stillOpen = async () => !!(await kvs.get(`workflow-pending-${PAGE}`));
const stateNow = async () => (await kvs.get(`workflow-state-${PAGE}`))?.stateId;

// ── control: an approver still on the list decides ────────────────────────────────────────────
await world({ approval: { approvers: users(X, Y), mode: "any" } }); await openRequest();
{ const r = await decide(X, "approved"); eq("approver still listed, approves: the page moves", r?.transitioned, true); }

// ── a user approver taken off the space's list ────────────────────────────────────────────────
await world({ approval: { approvers: users(Y), mode: "any" } }); await openRequest();
{
  const r = await decide(X, "approved");
  eq("removed user approver, approves: refused", r?.success, false);
  eq("removed user approver, approves: no vote recorded", await voteOf(X), "pending");
  eq("removed user approver, approves: the page did not move", await stateNow(), IN_REVIEW);
  ok("removed user approver, approves: the request is still open", await stillOpen());
}
await world({ approval: { approvers: users(Y), mode: "any" } }); await openRequest({ snapshot: [X] });
{
  const r = await decide(X, "denied");
  eq("removed user approver, denies: refused", r?.success, false);
  ok("removed user approver, denies: the request is still open", await stillOpen());
  eq("removed user approver, denies: no vote recorded", await voteOf(X), "pending");
}
// Every approver taken off (the space has none now): the snapshot alone decides nothing.
await world({ approval: { approvers: [], mode: "any" } }); await openRequest();
eq("approver list emptied, a snapshot approver approves: refused", (await decide(X, "approved"))?.success, false);

// ── a group approver: membership is read now ──────────────────────────────────────────────────
const groupApproval = { approvers: [{ id: GROUP, type: "group", name: "Approvers" }], mode: "any" };
await world({ approval: groupApproval, group: [Y] }); await openRequest();
{
  const r = await decide(X, "approved");
  eq("taken out of the approver group, approves: refused", r?.success, false);
  eq("taken out of the approver group: the page did not move", await stateNow(), IN_REVIEW);
}
await world({ approval: groupApproval, group: [X, Y] }); await openRequest();
eq("still in the approver group, approves: the page moves (control)", (await decide(X, "approved"))?.transitioned, true);
// The group cannot be read (an outage, or Confluence limiting requests): unknown, never a yes.
for (const status of [500, 429]) {
  await world({ approval: groupApproval, group: status }); await openRequest();
  const r = await decide(X, "approved");
  eq(`group lookup answers ${status}, approves: refused`, r?.success, false);
  ok(`group lookup answers ${status}: says to try again`, /try again/i.test(String(r?.reason || "")));
  eq(`group lookup answers ${status}: no vote recorded`, await voteOf(X), "pending");
  eq(`group lookup answers ${status}: the page did not move`, await stateNow(), IN_REVIEW);
}

// ── a space admin keeps the admin's own authority ─────────────────────────────────────────────
await world({ approval: { approvers: users(Y), mode: "any" } }); await openRequest({ snapshot: [ADMIN, Y] });
eq("a space admin taken off the approver list still decides as an admin", (await decide(ADMIN, "approved"))?.transitioned, true);

// ── re-pinning the request is an approver's act too ───────────────────────────────────────────
await world({ approval: { approvers: users(Y), mode: "any" }, liveVersion: 4 }); await openRequest();
{
  const r = await as(workflow.get("rerequest-approval"), X, { pageId: PAGE });
  eq("removed approver, re-request: refused", r?.success, false);
  eq("removed approver, re-request: still pinned to the reviewed version", (await kvs.get(`workflow-pending-${PAGE}`))?.pinnedVersion, 3);
}
await world({ approval: { approvers: users(X, Y), mode: "any" }, liveVersion: 4 }); await openRequest();
eq("approver still listed, re-request: re-pinned (control)", (await as(workflow.get("rerequest-approval"), X, { pageId: PAGE }))?.changed, true);

// ── My work and the details window do not offer the decision ──────────────────────────────────
await world({ approval: { approvers: users(Y), mode: "any" } }); await openRequest();
eq("removed approver: not in My work's approvals", (await listMyApprovals(X)).length, 0);
eq("approver still listed: in My work's approvals (control)", (await listMyApprovals(Y)).length, 1);
// The ribbon's "waiting on you" count runs on every page view: it reads no group (no Confluence
// points); a group member it cannot judge stays listed, and the decision itself checks the group.
await world({ approval: groupApproval, group: [Y] }); await openRequest();
eq("My work with an approver group: still listed without reading the group", (await listMyApprovals(X)).length, 1);
ok("My work with an approver group: no group read", !fake.calls.some((c) => String(c.path).includes("membersByGroupId")));
await world({ approval: { approvers: users(Y), mode: "any" } }); await openRequest();
{
  const d = await as(pageDetailsSummary, X, { pageId: PAGE });
  eq("removed approver: the details window offers no decision", d?.workflow?.pending?.iCanDecide, false);
  const d2 = await as(pageDetailsSummary, Y, { pageId: PAGE });
  eq("approver still listed: the details window offers the decision (control)", d2?.workflow?.pending?.iCanDecide, true);
}

{
  const b = await as(workflow.get("get-page-approvals"), X, { pageId: PAGE });
  eq("removed approver: the banner is told (no Approve/Deny as an approver)", b?.myApproverRemoved, true);
  ok("removed approver who is not an admin: not offered the admin's decision", b?.adminCanDecide !== true);
  const b2 = await as(workflow.get("get-page-approvals"), Y, { pageId: PAGE });
  ok("approver still listed: the banner offers the decision (control)", b2?.myApproverRemoved !== true);
}
await world({ approval: { approvers: users(Y), mode: "any" } }); await openRequest({ snapshot: [ADMIN, Y] });
{
  const b = await as(workflow.get("get-page-approvals"), ADMIN, { pageId: PAGE });
  ok("a space admin taken off the approver list: the banner offers the admin's decision", b?.myApproverRemoved === true && b?.adminCanDecide === true);
}

// ── proposals on a seal the approval holds ────────────────────────────────────────────────────
const future = new Date(Date.now() + 86400000).toISOString();
async function proposal() {
  await kvs.set("protection-att-1", { lockedBy: REQUESTER, lockedByName: "Owner", spaceKey: "AAA", spaceId: "101", contentId: PAGE, attachmentId: "att-1", attachmentName: "a.pdf", expiresAt: future, workflowHeld: { pageId: PAGE, stateId: APPROVED } });
  await kvs.set("edit-request-att-1-acct-proposer", { artifactId: "att-1", requesterAccountId: "acct-proposer", requesterName: "Proposer", status: "pending", proposal: true, approvers: [X, Y], contentId: PAGE, spaceKey: "AAA", requestedAt: "2026-10-02T00:00:00.000Z" });
  await kvs.set("section-protection-sec-1", { lockedBy: REQUESTER, lockedByName: "Owner", spaceKey: "AAA", pageId: PAGE, sectionId: "sec-1", sectionTitle: "Terms", expiresAt: future, workflowHeld: { pageId: PAGE, stateId: APPROVED } });
  await kvs.set("section-edit-request-sec-1-acct-proposer", { sectionId: "sec-1", requesterAccountId: "acct-proposer", requesterName: "Proposer", status: "pending", proposal: true, approvers: [X, Y], pageId: PAGE, spaceKey: "AAA", requestedAt: "2026-10-02T00:00:00.000Z" });
}
const PROPOSAL_REFUSAL = "Only this page's approvers or a space admin can decide a proposed change";
const said = (r, s) => JSON.stringify(r ?? null).includes(s);
for (const [label, key, payload] of [
  ["approve-edit-request", "approve-edit-request", { attachmentId: "att-1", requesterAccountId: "acct-proposer" }],
  ["deny-edit-request", "deny-edit-request", { attachmentId: "att-1", requesterAccountId: "acct-proposer", reason: "no" }],
  ["approve-section-edit", "approve-section-edit", { sectionId: "sec-1", requesterAccountId: "acct-proposer" }],
  ["deny-section-edit", "deny-section-edit", { sectionId: "sec-1", requesterAccountId: "acct-proposer", reason: "no" }],
]) {
  await world({ approval: { approvers: users(Y), mode: "any" }, stateId: APPROVED }); await proposal();
  const r = await as(editreq.get(key), X, payload);
  eq(`${label}, a proposal, removed approver: refused`, r?.success, false);
  eq(`${label}, a proposal, removed approver: the page is still Approved`, await stateNow(), APPROVED);
  await world({ approval: { approvers: users(Y), mode: "any" }, stateId: APPROVED }); await proposal();
  ok(`${label}, a proposal, approver still listed: not refused as a non-approver (control)`, !said(await as(editreq.get(key), Y, payload), PROPOSAL_REFUSAL));
  await world({ approval: groupApproval, group: 429, stateId: APPROVED }); await proposal();
  const u = await as(editreq.get(key), X, payload);
  eq(`${label}, a proposal, approver list unreadable: refused`, u?.success, false);
  ok(`${label}, a proposal, approver list unreadable: says to try again`, /try again/i.test(String(u?.reason || "")));
}
{
  await world({ approval: { approvers: users(Y), mode: "any" }, stateId: APPROVED }); await proposal();
  const l = await as(editreq.get("list-edit-requests"), X, { attachmentId: "att-1" });
  eq("list-edit-requests, removed approver: the proposal is not listed for them", (l?.requests || []).length, 0);
  const l2 = await as(editreq.get("list-edit-requests"), Y, { attachmentId: "att-1" });
  eq("list-edit-requests, approver still listed: the proposal is listed (control)", (l2?.requests || []).length, 1);
}

// ── edits on an Approved page: the same rule, and it still trusts the snapshot on an outage ───
await world({ approval: { approvers: users(Y), mode: "any" }, stateId: APPROVED });
eq("privilege, removed approver: not privileged", (await workflowPrivilegeForPage(PAGE, X))?.privileged, false);
eq("privilege, approver still listed: privileged (control)", (await workflowPrivilegeForPage(PAGE, Y))?.privileged, true);
ok("page trigger, removed approver's edit: not a privileged edit", (await collectWorkflowEnforcementForPage(PAGE, X, 4, "app-account"))?.action !== "privileged");
await world({ approval: groupApproval, group: 500, stateId: APPROVED });
eq("privilege, group lookup failing, a snapshot approver: privileged (edits keep trusting the snapshot)", (await workflowPrivilegeForPage(PAGE, X))?.privileged, true);
eq("page trigger, group lookup failing, a snapshot approver's edit: privileged", (await collectWorkflowEnforcementForPage(PAGE, X, 4, "app-account"))?.action, "privileged");

// ══ Round 2: a request can always be finished by the people who are approvers NOW ═════════════
// Quorum counts only the request's approvers who are still on the space's list (min re-clamped);
// a vote cast by someone since taken off the list no longer counts; when nobody on the request is
// an approver any more it must be re-requested, and re-requesting takes the CURRENT list.
await world({ approval: { approvers: users(Y), mode: "all" } }); await openRequest({ mode: "all" });
eq("all-of, X removed: X is refused", (await decide(X, "approved"))?.success, false);
eq("all-of, X removed: Y's approval completes it (X no longer counted)", (await decide(Y, "approved"))?.transitioned, true);
await world({ approval: { approvers: users(Y), mode: "min", min: 2 } }); await openRequest({ mode: "min", min: 2 });
eq("min 2 of [X, Y], X removed: the minimum re-clamps and Y's approval completes it", (await decide(Y, "approved"))?.transitioned, true);
// Votes cast before the voter was removed no longer count.
await world({ approval: { approvers: users(X, Y, "acct-z"), mode: "min", min: 2 } }); await openRequest({ snapshot: [X, Y, "acct-z"], mode: "min", min: 2 });
eq("min 2: X approves while still an approver: pending", (await decide(X, "approved"))?.outcome, "pending");
await kvs.set("workflow-settings-AAA", { enabled: true, approval: { approvers: users(Y, "acct-z"), mode: "min", min: 2 } });
{
  const r = await decide(Y, "approved");
  eq("min 2: X removed after voting, Y approves: still pending (X's vote no longer counts)", r?.outcome, "pending");
  eq("min 2: the page did not move", await stateNow(), IN_REVIEW);
  eq("min 2: Z's approval completes it", (await decide("acct-z", "approved"))?.transitioned, true);
  // The stored evidence says what counted: the approvers on the list then, the minimum used, and
  // that X's vote did not count.
  const ev = (await kvs.get(`workflow-state-${PAGE}`))?.approvalRecord;
  eq("evidence: the approvers who counted", ev?.effectiveApprovers, [Y, "acct-z"]);
  eq("evidence: the minimum used", ev?.effectiveMin, 2);
  eq("evidence: X's vote is marked as not counted", (ev?.decisions || []).find((d) => d.accountId === X)?.counted, false);
  eq("evidence: Y's and Z's votes are marked as counted", (ev?.decisions || []).filter((d) => d.counted === true).map((d) => d.accountId).sort(), [Y, "acct-z"].sort());
}
// The AI finalizer counts the same way.
await world({ approval: { approvers: users(X, Y), mode: "any" } }); await openRequest({ aiGate: { required: true, status: "pending" } });
eq("AI gate: X approves while an approver: waits on the AI", (await decide(X, "approved"))?.outcome, "pending-ai");
await kvs.set("workflow-settings-AAA", { enabled: true, approval: { approvers: users(Y), mode: "any" } });
{
  const v = await applyAiVerdict(PAGE, 3, "passed", "ok");
  ok("AI gate: X removed after voting, AI passes: does not complete on X's vote", v?.transitioned !== true);
  eq("AI gate: the page did not move", await stateNow(), IN_REVIEW);
  eq("AI gate: Y's approval then completes it", (await decide(Y, "approved"))?.transitioned, true);
}
// Every approver on the request replaced, admins may not decide: re-request takes the current list.
await world({ approval: { approvers: users(Y), mode: "any", adminsCanApprove: false } }); await openRequest({ snapshot: [X] });
eq("replaced approver: X is refused", (await decide(X, "approved"))?.success, false);
{
  const r = await decide(Y, "approved");
  eq("replaced approver: the new approver Y cannot decide the old request", r?.success, false);
  ok("replaced approver: Y is told it needs re-requesting", /re-request/i.test(String(r?.reason || "")));
  eq("replaced approver: the status says it needs re-requesting", (await getPageApprovalStatus(PAGE))?.needsRerequest, true);
  const rr = await as(workflow.get("rerequest-approval"), REQUESTER, { pageId: PAGE });
  eq("replaced approver: the requester re-requests (same version): done", rr?.success, true);
  eq("replaced approver: the request now asks the current approvers", (await kvs.get(`workflow-pending-${PAGE}`))?.approvers, [Y]);
  ok("replaced approver: X's old record and inbox row are gone", !(await kvs.get(`workflow-approval-${PAGE}-${APPROVED}-approval-${X}`)) && !(await kvs.get(`workflow-inbox-${X}-${PAGE}`)));
  eq("replaced approver: Y now completes it", (await decide(Y, "approved"))?.transitioned, true);
}
// Re-request never makes a request with nobody to decide it, and never runs on an unread list.
await world({ approval: { approvers: [], mode: "any" } }); await openRequest({ snapshot: [X] });
{
  const rr = await as(workflow.get("rerequest-approval"), REQUESTER, { pageId: PAGE });
  eq("no approvers left: re-request refused", rr?.success, false);
  eq("no approvers left: the request keeps its list", (await kvs.get(`workflow-pending-${PAGE}`))?.approvers, [X]);
}
await world({ approval: groupApproval, group: 429 }); await openRequest({ snapshot: [X] });
{
  const rr = await as(workflow.get("rerequest-approval"), REQUESTER, { pageId: PAGE });
  eq("approver list unreadable: re-request refused", rr?.success, false);
  ok("approver list unreadable: says to try again", /try again/i.test(String(rr?.reason || "")));
  eq("approver list unreadable: the request keeps its list", (await kvs.get(`workflow-pending-${PAGE}`))?.approvers, [X]);
}
// Someone still listed, but another listed approver's group cannot be read: try again, nothing recorded.
await world({ approval: { approvers: [...users(Y), { id: GROUP, type: "group", name: "Approvers" }], mode: "all" }, group: 429 }); await openRequest({ mode: "all" });
{
  const r = await decide(Y, "approved");
  eq("quorum unknown (a group unreadable): refused", r?.success, false);
  ok("quorum unknown: says to try again", /try again/i.test(String(r?.reason || "")));
  eq("quorum unknown: no vote recorded", await voteOf(Y), "pending");
}

// The pure rule: nobody left never means "approved", and min never drops below 1.
{
  const req = (mode, min = 1) => ({ approvers: [X, Y], mode, min, requestedBy: REQUESTER });
  for (const mode of ["any", "all", "min"]) {
    const r = quorumOutcome(req(mode, 2), [], [], []);
    eq(`quorum, ${mode}, nobody on the request is an approver now: pending, needs re-requesting (never auto-approved)`, [r.outcome, r.needsRerequest], ["pending", true]);
  }
  eq("quorum, nobody left, an admin approves: approved", quorumOutcome(req("all"), [], [], [{ status: "approved" }]).outcome, "approved");
  eq("quorum, min 2 with one approver left: min re-clamps to 1", quorumOutcome(req("min", 2), [Y], [{ approverAccountId: Y, status: "pending" }], []).min, 1);
  eq("quorum, a removed approver's approval is not counted", quorumOutcome(req("any"), [Y], [{ approverAccountId: X, status: "approved" }, { approverAccountId: Y, status: "pending" }], []).outcome, "pending");
  eq("quorum, an AI-only request (no approvers) keeps its meaning", quorumOutcome({ approvers: [], mode: "any", min: 1 }, [], [], []).outcome, "approved");
}

// ── a deleted approver group is empty, not "try again" forever ────────────────────────────────
const deletedGroup = { approvers: [...users(Y), { id: GROUP, type: "group", name: "Approvers" }], mode: "any" };
await world({ approval: deletedGroup, group: 404 }); await openRequest();
eq("deleted group: the list resolves (not unknown)", (await resolveApproverIds(deletedGroup))?.unresolved, false);
{
  const r = await decide(X, "approved");
  eq("deleted group: its former member is refused", r?.success, false);
  ok("deleted group: refused as no longer an approver, not 'try again'", !/try again/i.test(String(r?.reason || "")));
}
eq("deleted group: a current approver completes it", (await decide(Y, "approved"))?.transitioned, true);
await world({ approval: { approvers: [{ id: "Old approvers", type: "group", name: "Old approvers" }], mode: "any" } });
eq("a group stored by name with no exact search hit: unknown (a search miss is not proof it is gone)", (await resolveApproverIds({ approvers: [{ id: "Old approvers", type: "group", name: "Old approvers" }] }))?.unresolved, true);

// ── My work's proposals follow the same rule ──────────────────────────────────────────────────
await world({ approval: { approvers: users(Y), mode: "any" }, stateId: APPROVED }); await proposal();
await writeProposalIndex(await kvs.get("edit-request-att-1-acct-proposer"));
eq("My work, removed approver: the proposal is not waiting on them", (await listPendingRequestsForOwner(X)).length, 0);
eq("My work, approver still listed: the proposal is waiting on them (control)", (await listPendingRequestsForOwner(Y)).length, 1);

// ══ Round 3: a denial never approves; a met quorum is never stuck ═════════════════════════════
// all-of: an earlier admin approval, then nobody on the request is an approver, then an admin denies.
await world({ approval: { approvers: users(X, Y, "acct-z"), mode: "all" } }); await openRequest({ snapshot: [X, Y, "acct-z"], mode: "all" });
eq("all-of: an admin approves: pending", (await decide(ADMIN, "approved"))?.outcome, "pending");
await kvs.set("workflow-settings-AAA", { enabled: true, approval: { approvers: users("acct-w"), mode: "all" } });
{
  const r = await decide(ADMIN2, "denied");
  ok("all-of, nobody left, an admin denies: never approved", r?.outcome !== "approved" && r?.transitioned !== true);
  eq("all-of, nobody left, an admin denies: the denial closes it", r?.outcome, "denied");
  eq("all-of, nobody left, an admin denies: the page did not move", await stateNow(), IN_REVIEW);
}
// min 2: X approves, the list shrinks to [X] (the minimum drops to 1), an admin denies.
await world({ approval: { approvers: users(X, Y, "acct-z"), mode: "min", min: 2 } }); await openRequest({ snapshot: [X, Y, "acct-z"], mode: "min", min: 2 });
eq("min 2: X approves: pending", (await decide(X, "approved"))?.outcome, "pending");
await kvs.set("workflow-settings-AAA", { enabled: true, approval: { approvers: users(X), mode: "min", min: 2 } });
{
  const r = await decide(ADMIN, "denied");
  ok("min 2, list shrank to [X], an admin denies: never approved", r?.outcome !== "approved" && r?.transitioned !== true);
  eq("min 2, list shrank, an admin denies: the page did not move", await stateNow(), IN_REVIEW);
  eq("min 2, list shrank: the banner offers re-requesting (the list changed)", (await getPageApprovalStatus(PAGE))?.listChanged, true);
}
// all-of with admins off: X approved, Y taken off: the requester re-requests with the current list.
await world({ approval: { approvers: users(X, Y), mode: "all", adminsCanApprove: false } }); await openRequest({ mode: "all" });
eq("all-of [X, Y], admins off: X approves: pending", (await decide(X, "approved"))?.outcome, "pending");
await kvs.set("workflow-settings-AAA", { enabled: true, approval: { approvers: users(X), mode: "all", adminsCanApprove: false } });
{
  eq("Y taken off: the status says the list changed", (await getPageApprovalStatus(PAGE))?.listChanged, true);
  const rr = await as(workflow.get("rerequest-approval"), REQUESTER, { pageId: PAGE });
  eq("Y taken off: the requester re-requests: done", rr?.success, true);
  eq("Y taken off: the request asks [X] now", (await kvs.get(`workflow-pending-${PAGE}`))?.approvers, [X]);
  eq("Y taken off: re-requesting reset X's decision", await voteOf(X), "pending");
  eq("Y taken off: X approves and it completes", (await decide(X, "approved"))?.transitioned, true);
}
// min 2 of [requester, X, Y], Y taken off, admins may not decide: the minimum re-clamps over who can decide.
await world({ approval: { approvers: users(REQUESTER, X), mode: "min", min: 2, adminsCanApprove: false } }); await openRequest({ snapshot: [REQUESTER, X, Y], mode: "min", min: 2 });
eq("min 2 of [requester, X, Y], Y taken off, admins off: X's approval completes it", (await decide(X, "approved"))?.transitioned, true);
// min 3 of [requester, X, Y], Y taken off, admins may decide: the requester's slot stays for an admin
// and the minimum drops by at most the one approver removed.
await world({ approval: { approvers: users(REQUESTER, X), mode: "min", min: 3 } }); await openRequest({ snapshot: [REQUESTER, X, Y], mode: "min", min: 3 });
eq("min 3 of [requester, X, Y], Y taken off: X alone does not complete it", (await decide(X, "approved"))?.outcome, "pending");
eq("min 3 of [requester, X, Y], Y taken off: X and an admin complete it", (await decide(ADMIN, "approved"))?.transitioned, true);
// The pure rule.
{
  const { evaluateApproval } = await import("../src/server/capsules/workflow/approvals.js");
  eq("adminOnly: an approval and a denial: the denial wins", evaluateApproval("any", 1, [], ["approved", "denied"], { adminOnly: true }), "denied");
  const req = { approvers: [REQUESTER, X, Y], mode: "min", min: 2, requestedBy: REQUESTER };
  eq("quorum: nobody removed: the minimum is unchanged", quorumOutcome(req, [REQUESTER, X, Y], [], []).min, 2);
  eq("quorum: Y removed, admins may decide: min stays (the requester's slot is an admin's)", quorumOutcome(req, [REQUESTER, X], [], []).min, 2);
  eq("quorum: Y removed, admins may not decide: min re-clamps over who can decide", quorumOutcome(req, [REQUESTER, X], [], [], { adminsMay: false }).min, 1);
  const req3 = { approvers: [REQUESTER, X, Y], mode: "min", min: 3, requestedBy: REQUESTER };
  eq("quorum: min 3, one removed: drops by at most one (admins may decide)", quorumOutcome(req3, [REQUESTER, X], [], []).min, 2);
  eq("quorum: min 3, one removed: drops by at most one (admins may not decide)", quorumOutcome(req3, [REQUESTER, X], [], [], { adminsMay: false }).min, 2);
}

// ══ Round 4: the AI pass, the minimum, unreadable groups, wording, additions ══════════════════
const aiOn = { required: true, status: "pending" };
// A1: all-of with an AI gate, an admin approves, the list is replaced: the AI pass does not complete it.
await world({ approval: { approvers: users(X, Y), mode: "all" } }); await openRequest({ mode: "all", aiGate: aiOn });
eq("A1: an admin approves an all-of: pending", (await decide(ADMIN, "approved"))?.outcome, "pending");
await kvs.set("workflow-settings-AAA", { enabled: true, approval: { approvers: users("acct-w"), mode: "all" } });
{
  eq("A1: the request needs re-requesting", (await getPageApprovalStatus(PAGE))?.needsRerequest, true);
  const v = await applyAiVerdict(PAGE, 3, "passed", "ok");
  ok("A1: the AI pass does not complete it", v?.transitioned !== true);
  eq("A1: the page did not move", await stateNow(), IN_REVIEW);
}
// A1b: min 2 with an AI gate, X approves, Y and Z removed, an admin denies: the AI pass does not approve.
await world({ approval: { approvers: users(X, Y, "acct-z"), mode: "min", min: 2 } }); await openRequest({ snapshot: [X, Y, "acct-z"], mode: "min", min: 2, aiGate: aiOn });
eq("A1b: X approves: pending", (await decide(X, "approved"))?.outcome, "pending");
await kvs.set("workflow-settings-AAA", { enabled: true, approval: { approvers: users(X), mode: "min", min: 2 } });
eq("A1b: an admin denies: not approved", (await decide(ADMIN, "denied"))?.outcome !== "approved", true);
{
  const v = await applyAiVerdict(PAGE, 3, "passed", "ok");
  ok("A1b: the AI pass after a denial does not complete it", v?.transitioned !== true);
  eq("A1b: the page did not move", await stateNow(), IN_REVIEW);
  eq("A1b: an explicit approval completes it", (await decide(ADMIN2, "approved"))?.transitioned, true);
}
// After a removal, the AI pass waits for an explicit approval made after the change.
await world({ approval: { approvers: users(X, Y), mode: "any" } }); await openRequest({ aiGate: aiOn });
eq("removal + AI: X approves: waits on the AI", (await decide(X, "approved"))?.outcome, "pending-ai");
await kvs.set("workflow-settings-AAA", { enabled: true, approval: { approvers: users(X), mode: "any" } });
// N1: the removal does not change the outcome (X's approval meets any-of even with Y counted as
// still pending): the AI pass completes it.
eq("removal that changes nothing + AI: the AI pass completes it", (await applyAiVerdict(PAGE, 3, "passed", "ok"))?.transitioned, true);
// N: requester-only + AI completes as before.
await world({ approval: { approvers: users(REQUESTER), mode: "any" } }); await openRequest({ snapshot: [REQUESTER], aiGate: aiOn });
eq("N: requester-only, an admin approves: waits on the AI", (await decide(ADMIN, "approved"))?.outcome, "pending-ai");
eq("N: requester-only, the AI pass completes it", (await applyAiVerdict(PAGE, 3, "passed", "ok"))?.transitioned, true);
// No removal + AI: unchanged.
await world({ approval: { approvers: users(X, Y), mode: "any" } }); await openRequest({ aiGate: aiOn });
eq("no removal + AI: X approves: waits on the AI", (await decide(X, "approved"))?.outcome, "pending-ai");
eq("no removal + AI: the AI pass completes it", (await applyAiVerdict(PAGE, 3, "passed", "ok"))?.transitioned, true);

// L1: a group stored by name that cannot be found: the message names it and points to the settings;
// in "any" a space admin still decides.
await world({ approval: { approvers: [{ id: "Gone group", type: "group", name: "Gone group" }], mode: "any" } }); await openRequest({ snapshot: [X] });
{
  const r = await decide(X, "approved");
  eq("L1: unreadable group, the listed approver: refused", r?.success, false);
  ok("L1: the message names the group", String(r?.reason || "").includes("Gone group"));
  ok("L1: the message points to the Workflow settings", /Workflow settings/.test(String(r?.reason || "")));
  eq("L1: unreadable group, any-of: a space admin's approval completes it", (await decide(ADMIN, "approved"))?.transitioned, true);
}
await world({ approval: { approvers: [{ id: "Gone group", type: "group", name: "Gone group" }], mode: "all" } }); await openRequest({ snapshot: [X], mode: "all" });
eq("L1: unreadable group, all-of: an admin's decision still waits (try again)", (await decide(ADMIN, "approved"))?.success, false);

// L2: the summary when only a space admin settled it.
{
  const { approvalSummary } = await import("../src/server/capsules/workflow/status.js");
  const rec = { enforce: true, approvedVersion: 3, approvalRecord: { outcome: "approved", mode: "min", min: 2, approverCount: 2, effectiveApprovers: [], effectiveMin: 1, completedAt: "2026-10-02T00:00:00.000Z", decisions: [{ decision: "approved" }] } };
  const sum = approvalSummary(rec);
  ok("L2: no 'of 0' in the summary", !/of 0/.test(sum));
  ok("L2: says a space admin decided", /space admin/.test(sum));
}

// L3: an approver who was only ADDED does not let another approver reset a valid approval.
await world({ approval: { approvers: users(X, Y), mode: "all" } }); await openRequest({ snapshot: [X], mode: "all" });
eq("L3: Y added: X re-requests: refused (only the requester or a space admin)", (await as(workflow.get("rerequest-approval"), X, { pageId: PAGE }))?.success, false);
eq("L3: Y added: the requester re-requests: done", (await as(workflow.get("rerequest-approval"), REQUESTER, { pageId: PAGE }))?.success, true);

// ══ Round 5 ═════════════════════════════════════════════════════════════════════════════════
// N1: admins off, any-of [X, Y], X approves, Y removed: the AI pass completes it.
await world({ approval: { approvers: users(X, Y), mode: "any", adminsCanApprove: false } }); await openRequest({ aiGate: aiOn });
eq("N1: X approves: waits on the AI", (await decide(X, "approved"))?.outcome, "pending-ai");
await kvs.set("workflow-settings-AAA", { enabled: true, approval: { approvers: users(X), mode: "any", adminsCanApprove: false } });
eq("N1: Y removed, the AI pass completes it", (await applyAiVerdict(PAGE, 3, "passed", "ok"))?.transitioned, true);
// N1: the requester was a listed approver and is removed: the AI pass completes it.
await world({ approval: { approvers: users(REQUESTER, X), mode: "any" } }); await openRequest({ snapshot: [REQUESTER, X], aiGate: aiOn });
eq("N1b: X approves: waits on the AI", (await decide(X, "approved"))?.outcome, "pending-ai");
await kvs.set("workflow-settings-AAA", { enabled: true, approval: { approvers: users(X), mode: "any" } });
eq("N1b: the requester taken off the list, the AI pass completes it", (await applyAiVerdict(PAGE, 3, "passed", "ok"))?.transitioned, true);
// A removal that DOES matter still holds: all-of [X, Y], X approves, Y removed, AI passes.
await world({ approval: { approvers: users(X, Y), mode: "all" } }); await openRequest({ mode: "all", aiGate: aiOn });
eq("all-of + AI: X approves: pending", (await decide(X, "approved"))?.outcome, "pending");
await kvs.set("workflow-settings-AAA", { enabled: true, approval: { approvers: users(X), mode: "all" } });
ok("all-of + AI, Y removed: the AI pass waits for an explicit approval", (await applyAiVerdict(PAGE, 3, "passed", "ok"))?.transitioned !== true);
// L-a: any-of, an admin approves, the AI pass lands while the approver group cannot be read: completes.
const groupAny = { approvers: [{ id: GROUP, type: "group", name: "Approvers" }], mode: "any" };
await world({ approval: groupAny, group: [X] }); await openRequest({ snapshot: [X], aiGate: aiOn });
eq("L-a: an admin approves any-of: waits on the AI", (await decide(ADMIN, "approved"))?.outcome, "pending-ai");
await kvs.set("workflow-settings-AAA", { enabled: true, approval: { ...groupAny } });
{
  // the group now answers 500 (an outage)
  const { onConfluence: on } = await import("./_forge-fake/state.mjs");
  on((method, rawPath) => (decodeURIComponent(rawPath).startsWith(`/wiki/rest/api/group/${GROUP}/membersByGroupId`) ? { status: 500, body: {} } : undefined));
  eq("L-a: the AI pass during the group outage completes on the admin's any-of approval", (await applyAiVerdict(PAGE, 3, "passed", "ok"))?.transitioned, true);
  const ev = (await kvs.get(`workflow-state-${PAGE}`))?.approvalRecord;
  eq("L-b (AI path): the evidence says the list could not be read", ev?.approverListUnknown, true);
  eq("L-b (AI path): the admin's decision is marked as counted", (ev?.decisions || []).find((d) => d.accountId === ADMIN)?.counted, true);
}
// L-b: an admin's any-of approval while the list cannot be read is recorded accurately.
await world({ approval: groupAny, group: 500 }); await openRequest({ snapshot: [X] });
eq("L-b: an admin approves any-of during a group outage: completes", (await decide(ADMIN, "approved"))?.transitioned, true);
{
  const ev = (await kvs.get(`workflow-state-${PAGE}`))?.approvalRecord;
  eq("L-b: the evidence says the approver list could not be read", ev?.approverListUnknown, true);
  eq("L-b: the admin's decision is marked as counted", (ev?.decisions || []).find((d) => d.accountId === ADMIN)?.counted, true);
  const { approvalSummary } = await import("../src/server/capsules/workflow/status.js");
  ok("L-b: the summary says a space admin decided while the list could not be read", /space admin/.test(approvalSummary({ enforce: true, approvedVersion: 3, approvalRecord: ev })) && !/any one approver/.test(approvalSummary({ enforce: true, approvedVersion: 3, approvalRecord: ev })));
}

report("approver-revocation");
