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
 * PURE except mayDecideProposal, which takes the admin check as an argument.
 */

/** PURE. The approver snapshot minus the proposer. */
export function proposalAskees(snapshot, proposerAccountId) {
  return [...new Set((Array.isArray(snapshot) ? snapshot : []).filter(Boolean))].filter((id) => id !== proposerAccountId);
}

/** PURE. Who is told about a new proposal: the askees, else nobody (the admins see it on the row). */
export function proposalNotifyTargets(askees) {
  return Array.isArray(askees) ? askees : [];
}

/** Whether `accountId` may approve / decline `request` (a proposal). `isAdmin` is async () => boolean. */
export async function mayDecideProposal(request, accountId, isAdmin) {
  if (!request?.proposal || !accountId) return false;
  if (accountId === request.requesterAccountId) return false;
  if ((request.approvers || []).includes(accountId)) return true;
  try { return (await isAdmin()) === true; } catch (_) { return false; }
}
