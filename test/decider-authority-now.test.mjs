// A decision on an approval request is a decision by someone who holds the right to make it NOW,
// on a page they can SEE.
//   1. A space admin's vote counts only while that person is still an admin of the page's space (and
//      the space still lets admins decide). A vote cast as an admin by someone who has since lost the
//      role is not counted toward the quorum, by the last human vote or by the AI pass.
//   2. Deciding (an approval request, or a proposal on a seal the approval holds) needs read access
//      to the page, asked of Confluence for that account. Someone who cannot view the page decides
//      nothing and is not shown the request in the approvals inbox.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, onConfluence } = await import("./_forge-fake/state.mjs");
const { kvs } = await import("@forge/kvs");
const byKey = (list) => new Map(list);
const workflow = byKey((await import("../src/server/capsules/workflow/actions.js")).actions);
const editreq = byKey((await import("../src/server/capsules/editreq/actions.js")).actions);
const { applyAiVerdict, completeWhenKnown, getPageApprovalStatus, unreachableByView } = await import("../src/server/capsules/workflow/approvals.js");
const validations = byKey((await import("../src/server/capsules/validations/actions.js")).actions);
const { DEFAULT_WORKFLOW } = await import("../src/server/capsules/workflow/logic.js");
const { writeProposalIndex, writeSectionProposalIndex } = await import("../src/server/capsules/editreq/logic.js");
console.warn = () => {}; console.error = () => {}; console.info = () => {};
console.log = ((log) => (...a) => { if (String(a[0] || "").match(/passed|FAIL/)) log(...a); })(console.log);

const X = "acct-approver-x";
const Y = "acct-approver-y";
const ADMIN = "acct-space-admin";
const REQUESTER = "acct-requester";
const PAGE = "7001";
const GROUP = "0f8fad5b-d9cb-469f-a165-70867728950e";
const APPROVED = DEFAULT_WORKFLOW.states.find((s) => s.enforce)?.id || "approved";
const IN_REVIEW = DEFAULT_WORKFLOW.states.find((s) => s.id === "in_review")?.id || DEFAULT_WORKFLOW.states[1].id;
const users = (...ids) => ids.map((id) => ({ id, type: "user", name: id }));

/**
 * One page in space AAA. `approval` is the space's approver setting; `admins` the space's listed
 * admins; `cannotRead` the accounts Confluence says cannot read the page; `adminLookup` a status
 * code the user lookup answers (429: Confluence is limiting requests) for accounts not listed.
 */
async function world({ approval, admins = [ADMIN], cannotRead = [], group = [], stateId = IN_REVIEW, adminLookup = null } = {}) {
  resetFake();
  onConfluence((method, rawPath, body) => {
    const path = decodeURIComponent(rawPath);
    const [base, query = ""] = path.split("?");
    const qs = new URLSearchParams(query);
    if (base === "/wiki/rest/api/user/current") return { body: { accountId: "app-account" } };
    if (base === "/wiki/rest/api/user/memberof") return { body: { results: [] } };
    if (base === "/wiki/rest/api/user") {
      if (adminLookup) return { status: adminLookup, body: {} };
      const a = qs.get("accountId"); return { body: { accountId: a, displayName: a, operations: [] } };
    }
    if (/^\/wiki\/rest\/api\/content\/[^/]+\/permission\/check$/.test(base)) {
      let who = null;
      try { who = (typeof body === "string" ? JSON.parse(body) : body)?.subject?.identifier || null; } catch (_) { who = null; }
      return { body: { hasPermission: !cannotRead.includes(who) } };
    }
    if (base === "/wiki/rest/api/group/picker") return { body: { results: [] } };
    if (base === `/wiki/rest/api/group/${GROUP}/membersByGroupId`) {
      if (typeof group === "number") return { status: group, body: {} };
      return { body: { results: group.map((accountId) => ({ accountId })), _links: {} } };
    }
    if (base === `/wiki/api/v2/pages/${PAGE}`) return { body: { id: PAGE, status: "current", title: "Restricted plan", spaceId: "101", version: { number: 3, authorId: REQUESTER } } };
    if (base === "/wiki/api/v2/pages" && method === "GET") return { body: { results: [{ id: PAGE, status: "current", title: "Restricted plan", spaceId: "101", _links: { webui: "/p" } }] } };
    if (base === "/wiki/api/v2/spaces/101") return { body: { id: "101", key: "AAA" } };
    if (base === "/wiki/api/v2/spaces") return { body: { results: qs.get("keys") === "AAA" ? [{ id: "101", key: "AAA" }] : [] } };
    if (base === "/wiki/api/v2/spaces/101/permissions") return { body: { results: [] } };
    if (/^\/wiki\/api\/v2\/pages\/\d+\/properties/.test(base)) {
      if (method === "GET" && qs.get("key") === "sentinel-vault-workflow" && stateId === APPROVED) return { body: { results: [{ id: "900", value: { enforce: true }, version: { number: 1 } }] } };
      return method === "GET" ? { body: { results: [] } } : { body: { id: "901", version: { number: 1 } } };
    }
    if (method !== "GET") return { body: {} };
    if (/\/labels$/.test(base)) return { body: { results: [] } };
    return undefined;
  });
  await kvs.set("admin-settings-global", { allowAdminOverride: true });
  await kvs.set("admin-settings-space-AAA", { adminUsers: admins.map((accountId) => ({ accountId })) });
  await kvs.set("workflow-settings-AAA", { enabled: true, approval });
  await kvs.set(`workflow-state-${PAGE}`, {
    workflowId: "default", stateId, spaceKey: "AAA", enteredAt: "2026-10-01T00:00:00.000Z",
    enforce: stateId === APPROVED, approvedVersion: stateId === APPROVED ? 3 : null, approvers: stateId === APPROVED ? [X, Y] : [],
  });
}
async function openRequest({ snapshot = [X, Y], mode = "any", min = 1, aiGate = null } = {}) {
  await kvs.set(`workflow-pending-${PAGE}`, { pageId: PAGE, toStateId: APPROVED, toStateName: "Approved", requestedBy: REQUESTER, requestedByName: "Req", requestedAt: "2026-10-02T00:00:00.000Z", pinnedVersion: 3, approvers: snapshot, mode, min, spaceKey: "AAA", aiGate });
  for (const a of snapshot) {
    await kvs.set(`workflow-approval-${PAGE}-${APPROVED}-approval-${a}`, { pageId: PAGE, stateId: APPROVED, approverAccountId: a, status: "pending", requestedAt: "2026-10-02T00:00:00.000Z", pinnedVersion: 3 });
    await kvs.set(`workflow-inbox-${a}-${PAGE}`, { pageId: PAGE, stateId: APPROVED, requestedAt: "2026-10-02T00:00:00.000Z" });
  }
}
// The caller is NOT on the page (the approvals inbox, a REST client): only a payload page id.
const remote = (fn, accountId, payload) => fn({ payload, context: { accountId } });
const decide = (who, decision) => remote(workflow.get("decide-approval"), who, { pageId: PAGE, decision, reason: decision === "denied" ? "no" : undefined });
const voteOf = async (who) => (await kvs.get(`workflow-approval-${PAGE}-${APPROVED}-approval-${who}`))?.status;
const stillOpen = async () => !!(await kvs.get(`workflow-pending-${PAGE}`));
const stateNow = async () => (await kvs.get(`workflow-state-${PAGE}`))?.stateId;
const demote = (who) => kvs.set("admin-settings-space-AAA", { adminUsers: [ADMIN].filter((a) => a !== who).map((accountId) => ({ accountId })) });

// ══ 1. A space admin's past vote counts only while they are still an admin ═══════════════════════
// min 2 of [X, Y]: the admin's approval is one of two.
const min2 = { approvers: users(X, Y), mode: "min", min: 2 };
await world({ approval: min2 }); await openRequest({ mode: "min", min: 2 });
eq("min 2: the admin approves: one of two, still open", (await decide(ADMIN, "approved"))?.outcome, "pending");
eq("min 2 (control): admin still an admin, X approves: completes", (await decide(X, "approved"))?.transitioned, true);

await world({ approval: min2 }); await openRequest({ mode: "min", min: 2 });
await decide(ADMIN, "approved");
await demote(ADMIN);
{
  const r = await decide(X, "approved");
  eq("min 2: admin lost the role after voting, X approves: still pending (the old admin vote no longer counts)", r?.outcome, "pending");
  eq("min 2: admin lost the role: the page did not move", await stateNow(), IN_REVIEW);
  eq("min 2: admin lost the role: Y's approval completes it", (await decide(Y, "approved"))?.transitioned, true);
  const ev = (await kvs.get(`workflow-state-${PAGE}`))?.approvalRecord;
  eq("min 2: the evidence marks the former admin's vote as not counted", (ev?.decisions || []).find((d) => d.accountId === ADMIN)?.counted, false);
}

// The space stops letting admins decide after the admin voted: the vote stops counting too.
await world({ approval: min2 }); await openRequest({ mode: "min", min: 2 });
await decide(ADMIN, "approved");
await kvs.set("workflow-settings-AAA", { enabled: true, approval: { ...min2, adminsCanApprove: false } });
{
  const r = await decide(X, "approved");
  eq("min 2: admins may no longer decide in this space, X approves: still pending", r?.outcome, "pending");
  eq("min 2: admins may no longer decide: the page did not move", await stateNow(), IN_REVIEW);
}

// The admin's status cannot be read (Confluence limiting requests) and the outcome depends on it:
// nothing is decided on it, nothing is recorded, the approver is asked to try again.
const lookup429 = () => onConfluence((method, rawPath) => (decodeURIComponent(rawPath).split("?")[0] === "/wiki/rest/api/user" ? { status: 429, body: {} } : undefined));
const lookupOk = () => onConfluence((method, rawPath) => { const [b, q = ""] = decodeURIComponent(rawPath).split("?"); if (b !== "/wiki/rest/api/user") return undefined; const a = new URLSearchParams(q).get("accountId"); return { body: { accountId: a, displayName: a, operations: [] } }; });
await world({ approval: min2 }); await openRequest({ mode: "min", min: 2 });
await decide(ADMIN, "approved");
await demote(ADMIN); lookup429();
{
  const r = await decide(X, "approved");
  eq("min 2: X's approval would complete it only with the unreadable admin vote: refused", r?.success, false);
  ok("min 2: role unreadable: says to try again", /try again|limiting/i.test(String(r?.reason || "")));
  eq("min 2: role unreadable: X's vote is not recorded", await voteOf(X), "pending");
  eq("min 2: role unreadable: the page did not move", await stateNow(), IN_REVIEW);
  ok("min 2: role unreadable: nothing marked (votes are never deferred)", !(await kvs.get(`workflow-pending-${PAGE}`))?.quorumUnknownAt);
  const d = await decide(X, "denied");
  eq("min 2: role unreadable, X's DENIAL whose outcome hinges on it: refused too", d?.success, false);
  lookupOk();
  eq("min 2: once readable (the admin lost the role), X's approval is recorded and waits", (await decide(X, "approved"))?.outcome, "pending");
  eq("min 2: still open, Y's approval completes it", (await decide(Y, "approved"))?.transitioned, true);
}
// Control for the above: the admin still an admin, X's approval completes it at once.
await world({ approval: min2 }); await openRequest({ mode: "min", min: 2 });
await decide(ADMIN, "approved"); await decide(X, "approved");
eq("min 2 (control): the admin current, X's approval completes it", await stateNow(), APPROVED);
// ...but an unknown admin who cannot change the outcome blocks nobody (all-of ignores admin approvals).
await world({ approval: { approvers: users(X, Y), mode: "all" } }); await openRequest({ mode: "all" });
await decide(ADMIN, "approved");
await demote(ADMIN); lookup429();
{
  const r = await decide(X, "approved");
  eq("all-of: an unreadable admin role that cannot change the outcome: X's approval is recorded", r?.outcome, "pending");
  eq("all-of: X's vote recorded", await voteOf(X), "approved");
}
// An unknown admin role never stops a listed approver's vote being recorded (any-of, AI pending).
await world({ approval: { approvers: users(X, Y), mode: "any" } }); await openRequest({ aiGate: { required: true, status: "pending" } });
await decide(ADMIN, "approved");
await demote(ADMIN); lookup429();
eq("AI pending, admin role unreadable: X's approval is recorded and waits on the AI", (await decide(X, "approved"))?.outcome, "pending-ai");
// An any-of request X already met: an unreadable admin role does not stop the AI pass completing it.
await world({ approval: { approvers: users(X, Y), mode: "any" } }); await openRequest({ aiGate: { required: true, status: "pending" } });
await decide(ADMIN, "approved"); await decide(X, "approved");
await demote(ADMIN); lookup429();
eq("AI gate, any-of met by X, admin role unreadable: the AI pass completes it", (await applyAiVerdict(PAGE, 3, "passed", "ok"))?.transitioned, true);
// min 2 met only with the admin's vote, AI passes while the role cannot be read: kept, finished later.
await world({ approval: min2 }); await openRequest({ mode: "min", min: 2, aiGate: { required: true, status: "pending" } });
await decide(ADMIN, "approved"); await decide(X, "approved");
lookup429(); await demote(ADMIN);
{
  const v = await applyAiVerdict(PAGE, 3, "passed", "ok");
  ok("AI gate, outcome depends on an unreadable admin role: not completed", v?.transitioned !== true);
  eq("AI gate, unreadable: the request is marked for the hourly sweep", typeof (await kvs.get(`workflow-pending-${PAGE}`))?.quorumUnknownAt, "number");
  eq("hourly sweep while still unreadable: waits", (await completeWhenKnown(PAGE))?.done, false);
  ok("hourly sweep while still unreadable: still open", await stillOpen());
  await kvs.set("admin-settings-space-AAA", { adminUsers: [{ accountId: ADMIN }] }); // readable again (a listed admin needs no lookup)
  eq("hourly sweep once readable, still an admin: completes it", (await completeWhenKnown(PAGE))?.done, true);
  eq("hourly sweep: the page moved", await stateNow(), APPROVED);
}
await world({ approval: min2 }); await openRequest({ mode: "min", min: 2, aiGate: { required: true, status: "pending" } });
await decide(ADMIN, "approved"); await decide(X, "approved");
lookup429(); await demote(ADMIN);
await applyAiVerdict(PAGE, 3, "passed", "ok");
lookupOk();
{
  const r = await completeWhenKnown(PAGE);
  eq("hourly sweep once readable, the admin lost the role: not completed", r?.done, false);
  ok("hourly sweep, not met: the mark is cleared", !(await kvs.get(`workflow-pending-${PAGE}`))?.quorumUnknownAt);
  eq("not met: Y's approval then completes it", (await decide(Y, "approved"))?.transitioned, true);
}
// A request holding a former admin's approval can be re-requested (it is reset), even with nothing else changed.
await world({ approval: min2 }); await openRequest({ mode: "min", min: 2 });
await decide(ADMIN, "approved"); await decide(X, "denied");
eq("re-request (control): the admin still an admin, nothing changed: a no-op", (await remote(workflow.get("rerequest-approval"), REQUESTER, { pageId: PAGE }))?.changed, false);
await demote(ADMIN);
eq("banner: a former admin's vote marks the request as changed (re-request offered)", (await getPageApprovalStatus(PAGE))?.listChanged, true);
{
  const r = await remote(workflow.get("rerequest-approval"), REQUESTER, { pageId: PAGE });
  eq("re-request with a former admin's vote: reset", r?.changed, true);
  eq("re-request: every vote is back to pending", [await voteOf(X), await voteOf(Y)], ["pending", "pending"]);
  ok("re-request: the former admin's record is gone", !(await kvs.get(`workflow-approval-${PAGE}-${APPROVED}-approval-${ADMIN}`)));
}
// Only the requester or a space admin may reset for a former admin's approval; never a plain approver.
await world({ approval: min2 }); await openRequest({ mode: "min", min: 2 });
await decide(ADMIN, "approved"); await decide(X, "denied");
await demote(ADMIN);
eq("re-request by a plain approver for a former admin's approval: not a reset", (await remote(workflow.get("rerequest-approval"), Y, { pageId: PAGE }))?.changed === true, false);
eq("plain approver's attempt: X's denial still stands", await voteOf(X), "denied");
eq("the banner names the cause", (await getPageApprovalStatus(PAGE))?.formerAdminApproval, "role");
// The space turning off admin decisions is named as that, not as a lost role.
await world({ approval: min2 }); await openRequest({ mode: "min", min: 2 });
await decide(ADMIN, "approved"); await decide(X, "denied");
await kvs.set("workflow-settings-AAA", { enabled: true, approval: { ...min2, adminsCanApprove: false } });
eq("admins no longer allowed: the banner names the setting", (await getPageApprovalStatus(PAGE))?.formerAdminApproval, "setting");
// In an all-of request an admin's approval never counted: nothing to reset, nothing offered.
await world({ approval: { approvers: users(X, Y), mode: "all" } }); await openRequest({ mode: "all" });
await decide(ADMIN, "approved"); await decide(X, "approved");
await demote(ADMIN);
eq("all-of with a former admin's approval: the banner offers no re-request", (await getPageApprovalStatus(PAGE))?.listChanged, false);
eq("all-of: the requester's re-request is a no-op (X's approval stands)", [(await remote(workflow.get("rerequest-approval"), REQUESTER, { pageId: PAGE }))?.changed, await voteOf(X)], [false, "approved"]);
// A role read with no answer (5xx) is "could not tell", never "no longer an admin".
await world({ approval: min2 }); await openRequest({ mode: "min", min: 2 });
await decide(ADMIN, "approved");
await demote(ADMIN);
onConfluence((method, rawPath) => (decodeURIComponent(rawPath).split("?")[0] === "/wiki/rest/api/user" ? { status: 500, body: {} } : undefined));
{
  const r = await decide(X, "approved");
  eq("role read 500 and it decides the outcome: X is refused (try again), not judged on a 'no'", r?.success, false);
  eq("role read 500: nothing recorded", await voteOf(X), "pending");
  const st = await getPageApprovalStatus(PAGE);
  ok("role read 500: the banner does not call the admin former", st?.approvers?.find((a) => a.accountId === ADMIN)?.current !== false && !st?.formerAdminApproval);
  eq("role read 500: the requester's re-request does not reset", (await remote(workflow.get("rerequest-approval"), REQUESTER, { pageId: PAGE }))?.changed, false);
}
// One decision asks each admin's role once: the judgement after recording reuses the one before.
await world({ approval: min2 }); await openRequest({ mode: "min", min: 2 });
await decide(ADMIN, "approved");
await demote(ADMIN);
{
  const { fake } = await import("./_forge-fake/state.mjs");
  const before = fake.calls.filter((c) => String(c.path).includes(`accountId=${encodeURIComponent(ADMIN)}`) || String(c.path).includes(`accountId=${ADMIN}`)).length;
  await decide(X, "approved");
  const asked = fake.calls.filter((c) => String(c.path).includes(`accountId=${encodeURIComponent(ADMIN)}`) || String(c.path).includes(`accountId=${ADMIN}`)).length - before;
  ok(`one decision reads the former admin's role once per read kind, not twice (${asked} reads)`, asked > 0 && asked <= 2);
}
// The banner does not count a former admin's approval toward "min".
await world({ approval: min2 }); await openRequest({ mode: "min", min: 2 });
await decide(ADMIN, "approved");
eq("banner: a current admin's approval is marked current", (await getPageApprovalStatus(PAGE))?.approvers?.find((a) => a.accountId === ADMIN)?.current, true);
await demote(ADMIN);
eq("banner: a former admin's approval is marked not current", (await getPageApprovalStatus(PAGE))?.approvers?.find((a) => a.accountId === ADMIN)?.current, false);

// any-of with an AI review: the admin's approval waits on the AI; the admin loses the role; the AI passes.
await world({ approval: { approvers: users(X, Y), mode: "any" } }); await openRequest({ aiGate: { required: true, status: "pending" } });
eq("AI gate: the admin approves: waits on the AI", (await decide(ADMIN, "approved"))?.outcome, "pending-ai");
await demote(ADMIN);
{
  const v = await applyAiVerdict(PAGE, 3, "passed", "ok");
  ok("AI gate: admin lost the role, AI passes: does not complete on the old admin vote", v?.transitioned !== true);
  eq("AI gate: the page did not move", await stateNow(), IN_REVIEW);
  eq("AI gate: a current approver's approval then completes it", (await decide(Y, "approved"))?.transitioned, true);
}
await world({ approval: { approvers: users(X, Y), mode: "any" } }); await openRequest({ aiGate: { required: true, status: "pending" } });
await decide(ADMIN, "approved");
eq("AI gate (control): admin still an admin, AI passes: completes", (await applyAiVerdict(PAGE, 3, "passed", "ok"))?.transitioned, true);

// The same while the approver list cannot be read (a group outage): only a CURRENT admin's
// approval settles an any-of request then.
const groupAny = { approvers: [{ id: GROUP, type: "group", name: "Approvers" }], mode: "any" };
await world({ approval: groupAny, group: [X] }); await openRequest({ snapshot: [X], aiGate: { required: true, status: "pending" } });
eq("AI gate, group list: the admin approves: waits on the AI", (await decide(ADMIN, "approved"))?.outcome, "pending-ai");
await demote(ADMIN);
onConfluence((method, rawPath) => (decodeURIComponent(rawPath).startsWith(`/wiki/rest/api/group/${GROUP}/membersByGroupId`) ? { status: 500, body: {} } : undefined));
{
  const v = await applyAiVerdict(PAGE, 3, "passed", "ok");
  ok("AI gate, group outage: admin lost the role, AI passes: does not complete", v?.transitioned !== true);
  eq("AI gate, group outage: the page did not move", await stateNow(), IN_REVIEW);
}
await world({ approval: groupAny, group: [X] }); await openRequest({ snapshot: [X], aiGate: { required: true, status: "pending" } });
await decide(ADMIN, "approved");
onConfluence((method, rawPath) => (decodeURIComponent(rawPath).startsWith(`/wiki/rest/api/group/${GROUP}/membersByGroupId`) ? { status: 500, body: {} } : undefined));
eq("AI gate, group outage (control): a current admin's approval completes it", (await applyAiVerdict(PAGE, 3, "passed", "ok"))?.transitioned, true);

// ══ 2. Deciding needs read access to the page ═══════════════════════════════════════════════════
await world({ approval: { approvers: users(X, Y), mode: "any" }, cannotRead: [X] }); await openRequest();
{
  const r = await decide(X, "approved");
  eq("listed approver who cannot view the page, approves: refused", r?.success, false);
  eq("cannot view, approves: no vote recorded", await voteOf(X), "pending");
  eq("cannot view, approves: the page did not move", await stateNow(), IN_REVIEW);
  ok("cannot view: the refusal names no version or person", !/v\d|Req/.test(String(r?.reason || "")));
  const d = await decide(X, "denied");
  eq("listed approver who cannot view the page, denies: refused", d?.success, false);
  ok("cannot view, denies: the request is still open", await stillOpen());
}
await world({ approval: { approvers: users(X, Y), mode: "any" }, cannotRead: [ADMIN] }); await openRequest();
{
  const r = await decide(ADMIN, "approved");
  eq("space admin who cannot view the page, approves: refused", r?.success, false);
  eq("space admin who cannot view: the page did not move", await stateNow(), IN_REVIEW);
  ok("space admin who cannot view: not added as a decider", !((await kvs.get(`workflow-pending-${PAGE}`))?.adminDeciders || []).includes(ADMIN));
}
await world({ approval: { approvers: users(X, Y), mode: "any" } }); await openRequest();
eq("listed approver who can view the page, approves: completes (control)", (await decide(X, "approved"))?.transitioned, true);

// The approvals inbox does not show (title, requester) a request on a page the caller cannot view.
await world({ approval: { approvers: users(X, Y), mode: "any" }, cannotRead: [X] }); await openRequest();
{
  const l = await remote(workflow.get("list-my-approvals"), X, {});
  eq("inbox, cannot view the page: the request is not listed", (l?.approvals || []).length, 0);
  ok("inbox, cannot view the page: the title is not returned", !JSON.stringify(l || {}).includes("Restricted plan"));
  const l2 = await remote(workflow.get("list-my-approvals"), Y, {});
  eq("inbox, can view the page: the request is listed (control)", (l2?.approvals || []).length, 1);
}

// Proposals on a seal the approval holds: the same rule.
const future = new Date(Date.now() + 86400000).toISOString();
async function proposal() {
  await kvs.set("protection-att-1", { lockedBy: REQUESTER, lockedByName: "Owner", spaceKey: "AAA", spaceId: "101", contentId: PAGE, attachmentId: "att-1", attachmentName: "a.pdf", expiresAt: future, workflowHeld: { pageId: PAGE, stateId: APPROVED } });
  await kvs.set("edit-request-att-1-acct-proposer", { artifactId: "att-1", requesterAccountId: "acct-proposer", requesterName: "Proposer", status: "pending", proposal: true, approvers: [X, Y], contentId: PAGE, pageId: PAGE, spaceKey: "AAA", requestedAt: "2026-10-02T00:00:00.000Z" });
  await kvs.set("section-protection-sec-1", { lockedBy: REQUESTER, lockedByName: "Owner", spaceKey: "AAA", pageId: PAGE, sectionId: "sec-1", sectionTitle: "Terms", expiresAt: future, workflowHeld: { pageId: PAGE, stateId: APPROVED } });
  await kvs.set("section-edit-request-sec-1-acct-proposer", { sectionId: "sec-1", requesterAccountId: "acct-proposer", requesterName: "Proposer", status: "pending", proposal: true, approvers: [X, Y], pageId: PAGE, spaceKey: "AAA", requestedAt: "2026-10-02T00:00:00.000Z" });
}
for (const [key, payload] of [
  ["approve-edit-request", { attachmentId: "att-1", requesterAccountId: "acct-proposer" }],
  ["deny-edit-request", { attachmentId: "att-1", requesterAccountId: "acct-proposer", reason: "no" }],
  ["approve-section-edit", { sectionId: "sec-1", requesterAccountId: "acct-proposer" }],
  ["deny-section-edit", { sectionId: "sec-1", requesterAccountId: "acct-proposer", reason: "no" }],
]) {
  for (const who of [X, ADMIN]) {
    await world({ approval: { approvers: users(X, Y), mode: "any" }, stateId: APPROVED, cannotRead: [who] }); await proposal();
    const r = await remote(editreq.get(key), who, payload);
    eq(`${key}, a proposal, ${who === X ? "listed approver" : "space admin"} who cannot view the page: refused`, r?.success, false);
    eq(`${key}, ${who === X ? "approver" : "admin"} who cannot view: the page is still Approved`, await stateNow(), APPROVED);
    ok(`${key}, ${who === X ? "approver" : "admin"} who cannot view: the proposal is still pending`, (await kvs.get(key.includes("section") ? "section-edit-request-sec-1-acct-proposer" : "edit-request-att-1-acct-proposer"))?.status === "pending");
  }
}
{
  await world({ approval: { approvers: users(X, Y), mode: "any" }, stateId: APPROVED, cannotRead: [X] }); await proposal();
  eq("list-edit-requests, approver who cannot view: the proposal is not listed", ((await remote(editreq.get("list-edit-requests"), X, { attachmentId: "att-1" }))?.requests || []).length, 0);
  eq("list-section-edit-requests, approver who cannot view: the proposal is not listed", ((await remote(editreq.get("list-section-edit-requests"), X, { sectionId: "sec-1" }))?.requests || []).length, 0);
  await writeProposalIndex(await kvs.get("edit-request-att-1-acct-proposer"));
  eq("list-my-edit-requests, approver who cannot view: the proposal is not listed", ((await remote(editreq.get("list-my-edit-requests"), X, {}))?.requests || []).length, 0);
  await world({ approval: { approvers: users(X, Y), mode: "any" }, stateId: APPROVED }); await proposal();
  eq("list-edit-requests, approver who can view: the proposal is listed (control)", ((await remote(editreq.get("list-edit-requests"), X, { attachmentId: "att-1" }))?.requests || []).length, 1);
  await writeProposalIndex(await kvs.get("edit-request-att-1-acct-proposer"));
  eq("list-my-edit-requests, approver who can view: the proposal is listed (control)", ((await remote(editreq.get("list-my-edit-requests"), X, {}))?.requests || []).length, 1);
}

{
  await world({ approval: { approvers: users(X, Y), mode: "any" }, stateId: APPROVED, cannotRead: [X] }); await proposal();
  await writeSectionProposalIndex(await kvs.get("section-edit-request-sec-1-acct-proposer"));
  eq("list-my-section-edit-requests, approver who cannot view: the proposal is not listed", ((await remote(editreq.get("list-my-section-edit-requests"), X, {}))?.requests || []).length, 0);
  await world({ approval: { approvers: users(X, Y), mode: "any" }, stateId: APPROVED }); await proposal();
  await writeSectionProposalIndex(await kvs.get("section-edit-request-sec-1-acct-proposer"));
  eq("list-my-section-edit-requests, approver who can view: listed (control)", ((await remote(editreq.get("list-my-section-edit-requests"), X, {}))?.requests || []).length, 1);
}

// A permission check answered 429 is "try again", never a decision.
await world({ approval: { approvers: users(X, Y), mode: "any" } }); await openRequest();
onConfluence((method, rawPath) => (/\/permission\/check$/.test(decodeURIComponent(rawPath).split("?")[0]) ? { status: 429, body: {} } : undefined));
{
  const r = await decide(X, "approved");
  eq("permission check 429: refused", r?.success, false);
  eq("permission check 429: no vote recorded", await voteOf(X), "pending");
}

// A view check Confluence could not answer (5xx) is "try again", never "you don't have access".
await world({ approval: { approvers: users(X, Y), mode: "any" } }); await openRequest();
onConfluence((method, rawPath) => (/\/permission\/check$/.test(decodeURIComponent(rawPath).split("?")[0]) ? { status: 503, body: {} } : undefined));
{
  const r = await decide(X, "approved");
  eq("view check 503: refused", r?.success, false);
  ok("view check 503: says it could not be checked, not 'no access'", /could not be checked/.test(String(r?.reason || "")) && !/don't have access/.test(String(r?.reason || "")));
  eq("view check 503: nothing recorded", await voteOf(X), "pending");
}
// The banner offers the re-request exactly to who the server lets re-request.
await world({ approval: min2 }); await openRequest({ mode: "min", min: 2 });
await decide(ADMIN, "approved"); await decide(X, "denied");
await kvs.set("workflow-settings-AAA", { enabled: true, approval: { ...min2, adminsCanApprove: false } });
{
  const onPageBanner = (who) => workflow.get("get-page-approvals")({ payload: { pageId: PAGE }, context: { accountId: who, extension: { content: { id: PAGE, space: { key: "AAA" } } } } });
  eq("banner, requester: may re-request", (await onPageBanner(REQUESTER))?.canRerequest, true);
  eq("banner, a space admin while admins may not decide: still may re-request", (await onPageBanner(ADMIN))?.canRerequest, true);
  eq("banner, a plain approver: may not", (await onPageBanner(Y))?.canRerequest, false);
}
// "Approve anyway" on a page's validation gate: the same rule.
await world({ approval: { approvers: users(X, Y), mode: "any" }, cannotRead: [ADMIN] });
await kvs.set("validation-config-AAA", { enabled: true, modes: { gate: true }, rules: [] });
{
  const r = await remote(validations.get("approve-page-gate"), ADMIN, { pageId: PAGE });
  eq("approve-page-gate, admin who cannot view the page: refused", r?.success, false);
  ok("approve-page-gate, cannot view: says so", /access to view this page/.test(String(r?.reason || "")));
}

// "Approvals you asked for" does not show a page the requester can no longer view.
await world({ approval: { approvers: users(X, Y), mode: "any" }, cannotRead: [REQUESTER] }); await openRequest();
await kvs.set(`wfreq-mine-${REQUESTER}-${PAGE}`, { requesterAccountId: REQUESTER, pageId: PAGE, spaceKey: "AAA", toStateId: APPROVED, toStateName: "Approved", requestedAt: "2026-10-02T00:00:00.000Z" });
{
  const l = await remote(workflow.get("list-my-approval-requests"), REQUESTER, {});
  ok("my requests, page no longer viewable: not listed, no title", !JSON.stringify(l || {}).includes("Restricted plan") && !(l?.requests || []).some((r) => String(r.pageId) === PAGE));
}
await world({ approval: { approvers: users(X, Y), mode: "any" } }); await openRequest();
await kvs.set(`wfreq-mine-${REQUESTER}-${PAGE}`, { requesterAccountId: REQUESTER, pageId: PAGE, spaceKey: "AAA", toStateId: APPROVED, toStateName: "Approved", requestedAt: "2026-10-02T00:00:00.000Z" });
eq("my requests, page viewable: listed (control)", ((await remote(workflow.get("list-my-approval-requests"), REQUESTER, {}))?.requests || []).filter((r) => String(r.pageId) === PAGE).length, 1);

// A request that could never be finished because approvers cannot view the page is refused up front.
{
  const base = { approvers: [X, Y], requestedBy: REQUESTER };
  eq("reachability: all-of with one approver unable to view: unreachable", unreachableByView({ ...base, mode: "all" }, [X]), true);
  eq("reachability: any-of with one viewer: fine", unreachableByView({ ...base, mode: "any", adminsMay: false }, [X]), false);
  eq("reachability: any-of with no viewer, admins may decide: fine (an admin settles it)", unreachableByView({ ...base, mode: "any" }, [X, Y]), false);
  eq("reachability: any-of with no viewer, admins may not: unreachable", unreachableByView({ ...base, mode: "any", adminsMay: false }, [X, Y]), true);
  eq("reachability: min 2 with one viewer, admins may not: unreachable", unreachableByView({ ...base, mode: "min", min: 2, adminsMay: false }, [X]), true);
  eq("reachability: the requester's own access does not count", unreachableByView({ approvers: [X, REQUESTER], requestedBy: REQUESTER, mode: "all" }, [REQUESTER]), false);
}
await world({ approval: { approvers: users(X, Y), mode: "all" }, cannotRead: [X] }); await openRequest({ mode: "all" });
await kvs.set("workflow-settings-AAA", { enabled: true, approval: { approvers: users(X, Y, "acct-z"), mode: "all" } }); // the list changed: a re-request would re-ask
{
  const r = await remote(workflow.get("rerequest-approval"), REQUESTER, { pageId: PAGE });
  eq("re-request onto an approver who cannot view (all-of): refused", r?.success, false);
  ok("re-request refused: says an approver can't view the page", /can't view this page/.test(String(r?.reason || "")));
  eq("re-request refused: the request keeps its list", (await kvs.get(`workflow-pending-${PAGE}`))?.approvers, [X, Y]);
}

// The same check on a new request (request-transition, the requester on the page).
const onPage = (fn, accountId, payload) => fn({ payload, context: { accountId, extension: { content: { id: PAGE, space: { key: "AAA" } } } } });
await world({ approval: { approvers: users(X, Y), mode: "all" }, cannotRead: [X] });
{
  const r = await onPage(workflow.get("request-transition"), REQUESTER, { pageId: PAGE, toStateId: APPROVED });
  eq("new all-of request with an approver who cannot view the page: refused", r?.success, false);
  ok("new request refused: names the approver", /can't view this page: acct-approver-x/.test(String(r?.reason || "")));
  ok("new request refused: no request opened", !(await stillOpen()));
}
await world({ approval: { approvers: users(X, Y), mode: "any" }, cannotRead: [X] });
{
  const { fake } = await import("./_forge-fake/state.mjs");
  const before = fake.calls.filter((c) => /\/permission\/check$/.test(String(c.path).split("?")[0]) && c.body?.subject?.identifier !== REQUESTER).length;
  const r = await onPage(workflow.get("request-transition"), REQUESTER, { pageId: PAGE, toStateId: APPROVED });
  ok(`new any-of request with one viewer: opened (control) (${JSON.stringify(r).slice(0, 160)})`, await stillOpen());
  eq("any-of with admins allowed: no approver's access is even checked", fake.calls.filter((c) => /\/permission\/check$/.test(String(c.path).split("?")[0]) && c.body?.subject?.identifier !== REQUESTER).length - before, 0);
}
// A permission check answered 429 on a request where it could matter: "try again"; nothing opened.
await world({ approval: { approvers: users(X, Y), mode: "all" } });
onConfluence((method, rawPath, body) => (/\/permission\/check$/.test(decodeURIComponent(rawPath).split("?")[0]) && body?.subject?.identifier === X ? { status: 429, body: {} } : undefined));
{
  const r = await onPage(workflow.get("request-transition"), REQUESTER, { pageId: PAGE, toStateId: APPROVED });
  eq("all-of, an approver's access unreadable: refused", r?.success, false);
  ok("all-of, unreadable: says to try again", /try again|limiting/i.test(String(r?.reason || "")));
  ok("all-of, unreadable: nothing opened", !(await stillOpen()));
}
// Never a wrong reason: a min-of request unreachable for another cause is not refused as a view problem.
{
  const { viewReachabilityRefusal } = await import("../src/server/capsules/workflow/approvals.js");
  await world({ approval: { approvers: users(X, REQUESTER), mode: "min", min: 2, adminsCanApprove: false } });
  eq("min 2 of [requester, X], admins may not decide: not refused as a view problem", await viewReachabilityRefusal(PAGE, { approvers: [REQUESTER, X], mode: "min", min: 2, requestedBy: REQUESTER, spaceKey: "AAA" }), null);
}

report("decider-authority-now");
