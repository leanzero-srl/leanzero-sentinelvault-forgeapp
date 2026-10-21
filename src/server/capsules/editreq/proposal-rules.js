/*
 * SEC-2 (e) "Propose a change" — who is asked and who may decide (tester 2026-09-30).
 *
 * A proposal on a workflow-held seal asks the page's approvers to move the Approved page back so
 * the change can be made. Approving it is a WORKFLOW decision, so:
 *  - the proposer is never one of the people asked, and never decides their own proposal;
 *  - the seal's owner decides only if they are an approver or a space admin (holding the seal
 *    gives no say over the page's approval — before this, the owner could approve a proposal and
 *    so move an Approved page back);
 *  - a space admin may decide any proposal (as they may any approval), which also covers a
 *    proposal nobody is listed for.
 *  - being listed on the proposal (the approver snapshot it was made with) counts only while the
 *    person is still one of the space's approvers (8.14, workflow/approvals.js approverStatusNow):
 *    someone taken off the list or out of the group since decides only as a space admin, and a
 *    list that cannot be read right now is "unknown" (refused, try again), never a yes.
 * PURE except proposalDecision / mayDecideProposal, which take the checks as arguments.
 */

/** PURE. The approver snapshot minus the proposer. */
export function proposalAskees(snapshot, proposerAccountId) {
  return [...new Set((Array.isArray(snapshot) ? snapshot : []).filter(Boolean))].filter((id) => id !== proposerAccountId);
}

/** PURE. Who is told about a new proposal: the askees, else nobody (the admins see it on the row). */
export function proposalNotifyTargets(askees) {
  return Array.isArray(askees) ? askees : [];
}

/**
 * Whether `accountId` may approve / decline `request` (a proposal): `{ may, unknown }`. `isAdmin` is
 * async () => boolean; `approverNow` is async () => "yes" | "no" | "unknown" (is the caller still one
 * of the space's approvers — approvals.js approverStatusNow over the proposal's snapshot). Without
 * an `approverNow` the snapshot grants nothing (fail closed): only the admin arm can answer.
 * `unknown` is true when the approver arm could not be judged and the admin arm said no.
 */
export async function proposalDecision(request, accountId, isAdmin, approverNow = null) {
  if (!request?.proposal || !accountId) return { may: false, unknown: false };
  if (accountId === request.requesterAccountId) return { may: false, unknown: false };
  let listed = "no";
  if ((request.approvers || []).includes(accountId)) {
    try { listed = typeof approverNow === "function" ? await approverNow() : "unknown"; } catch (_) { listed = "unknown"; }
    if (listed === "yes") return { may: true, unknown: false };
  }
  let admin = false;
  try { admin = (await isAdmin()) === true; } catch (_) { admin = false; }
  return { may: admin, unknown: !admin && listed === "unknown" };
}

/** Boolean form of proposalDecision (lists: "unknown" is simply not offered). */
export async function mayDecideProposal(request, accountId, isAdmin, approverNow = null) {
  return (await proposalDecision(request, accountId, isAdmin, approverNow)).may;
}
