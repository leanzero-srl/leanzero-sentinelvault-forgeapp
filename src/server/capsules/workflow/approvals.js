/*
 * Workflow approvals engine (ledger #43) — multi-approver transitions.
 *
 * A transition into an approval-gated state (v1: the enforce state, In Review →
 * Approved) does not happen immediately: it opens a pending transition and one
 * approval record per approver. Approvers decide; when the decision mode's
 * threshold is met the transition completes, on denial it is cleared.
 *
 * Storage (KVS; deliberately NOT under the edit-request or edit-grant prefixes, so
 * seal-teardown sweeps never touch them and they don't pollute the edit-request inbox):
 *   workflow-approval-{pageId}-{stateId}-{approvalId}-{approverAccountId}
 *        = { status: pending|approved|denied, requestedAt, decidedAt, reason, pinnedVersion, approverName }
 *   workflow-pending-{pageId}
 *        = { toStateId, approvalId, requestedBy, requestedByName, requestedAt, pinnedVersion, approvers[], mode, min }
 */
import { asApp, route } from "@forge/api";
import { kvs, WhereConditions } from "@forge/kvs";
import { transitionPageWorkflow, readPageWorkflow, fetchLivePageVersion } from "./logic.js";
import { notifyApprovalRequested, notifyApprovalResolved } from "../../infra/approval-blueprints.js";

const APPROVAL_ID = "approval"; // v1 single default round; schema carries the segment for future named rounds

// --- Pure decision (unit-tested). decisions: array of "approved"|"denied"|"pending". ---
export function evaluateApproval(mode, min, decisions) {
  const approved = decisions.filter((d) => d === "approved").length;
  const denied = decisions.filter((d) => d === "denied").length;
  const total = decisions.length;
  const pending = total - approved - denied;
  if (total === 0) return "approved"; // no approvers required → auto-approve
  if (mode === "all") {
    if (denied > 0) return "denied";            // one denial kills an all-of
    return approved === total ? "approved" : "pending";
  }
  if (mode === "min") {
    const need = Math.max(1, min || 1);
    if (approved >= need) return "approved";
    if (approved + pending < need) return "denied"; // threshold no longer reachable
    return "pending";
  }
  // "any" (default): first approval wins; only all-denied rejects.
  if (approved >= 1) return "approved";
  if (denied === total) return "denied";
  return "pending";
}

// Normalize a settings.approval block → { approvers: [accountId], mode, min } or null if none.
export function resolveApprovers(approval) {
  if (!approval) return null;
  const approvers = (approval.approvers || [])
    .filter((a) => a && a.id && (a.type || "user") === "user") // v1: user approvers (group expansion → #43 iter 6)
    .map((a) => a.id);
  if (!approvers.length) return null;
  const uniq = [...new Set(approvers)];
  // Clamp min to the resolved approver count — otherwise min > approvers (e.g. after
  // group approvers are filtered out) makes evaluateApproval deny on the first vote.
  return { approvers: uniq, mode: approval.mode || "any", min: Math.min(uniq.length, Math.max(1, approval.min || 1)) };
}

// Split an approval config into user approvers + group approvers (groups are expanded
// to member account ids by the caller, which has REST access). Returns null if neither.
export function extractApprovalConfig(approval) {
  if (!approval || !Array.isArray(approval.approvers)) return null;
  const userIds = [...new Set(approval.approvers.filter((a) => a && a.id && (a.type || "user") === "user").map((a) => a.id))];
  const groups = approval.approvers.filter((a) => a && a.id && a.type === "group").map((a) => ({ id: a.id, name: a.name || a.id }));
  if (!userIds.length && !groups.length) return null;
  return { userIds, groups, mode: approval.mode || "any", min: Math.max(1, approval.min || 1) };
}

// Expand a group to its member account ids (best-effort — an unresolvable group adds
// no approvers; user approvers are unaffected). Lifted here (#44 §1.5) so the trigger
// can compute the live-config approver intersection too.
export async function fetchGroupMembers(group) {
  const ids = [];
  try {
    const res = await asApp().requestConfluence(route`/wiki/rest/api/group/member?name=${group.name || group.id}&limit=100`);
    if (res.ok) {
      const body = await res.json();
      for (const u of body?.results || []) if (u.accountId) ids.push(u.accountId);
      return { ids, ok: true };
    }
    return { ids, ok: false }; // non-ok — distinguish an outage from a genuinely empty group
  } catch (_) {
    return { ids, ok: false };
  }
}

// The effective approver id list (users + expanded group members) for a config.
// `unresolved: true` when a group expansion FAILED (vs a legitimately empty group) — the
// enforce path (#44) then trusts the snapshot rather than reverting a real approver's edit
// during a group-service outage.
export async function resolveApproverIds(approval) {
  const plan = extractApprovalConfig(approval);
  if (!plan) return null;
  const memberIds = [];
  let unresolved = false;
  for (const g of plan.groups) {
    const r = await fetchGroupMembers(g);
    memberIds.push(...r.ids);
    if (!r.ok) unresolved = true;
  }
  const allIds = [...new Set([...plan.userIds, ...memberIds])];
  if (!allIds.length && !unresolved) return null;
  return { approvers: allIds, mode: plan.mode, min: Math.min(allIds.length || plan.min, plan.min), unresolved };
}

const approvalKey = (pageId, stateId, accountId) => `workflow-approval-${pageId}-${stateId}-${APPROVAL_ID}-${accountId}`;
const pendingKey = (pageId) => `workflow-pending-${pageId}`;

// Open a pending transition + one approval record per approver.
export async function requestApprovalTransition({ pageId, toStateId, toStateName, spaceKey, approvers, mode, min, actorAccountId, actorName, pinnedVersion, approverNames }) {
  const requestedAt = new Date().toISOString();
  for (const acc of approvers) {
    await kvs.set(approvalKey(pageId, toStateId, acc), {
      pageId, stateId: toStateId, approverAccountId: acc, approverName: (approverNames && approverNames[acc]) || null,
      status: "pending", requestedAt, decidedAt: null, reason: null, pinnedVersion,
    });
  }
  await kvs.set(pendingKey(pageId), {
    toStateId, toStateName: toStateName || null, approvalId: APPROVAL_ID, requestedBy: actorAccountId || null, requestedByName: actorName || null,
    requestedAt, pinnedVersion, approvers, mode, min, spaceKey: spaceKey || null,
  });
  // Best-effort: @mention the approvers in a page comment so Confluence emails them.
  await notifyApprovalRequested({
    pageId, targetName: toStateName, requestedByName: actorName, mode, min,
    approvers: approvers.map((id) => ({ id, name: (approverNames && approverNames[id]) || null })),
  }).catch(() => {});
  return { pending: true, approvers, mode, min };
}

// Strongly-consistent read of the approval records over the KNOWN approver list —
// never kvs.query() (eventually consistent: could miss a just-written vote or return
// empty and mis-resolve the quorum).
async function readApprovalRecords(pageId, stateId, approvers) {
  return Promise.all((approvers || []).map(async (acc) =>
    (await kvs.get(approvalKey(pageId, stateId, acc))) || { approverAccountId: acc, status: "pending" }));
}

export async function clearPageApprovals(pageId, stateId, approvers) {
  await kvs.delete(pendingKey(pageId)).catch(() => {});
  if (Array.isArray(approvers) && approvers.length) {
    // Delete the exact keys the engine created (strongly consistent) — don't leak
    // phantom-pending records into listMyApprovals via an eventually-consistent query.
    for (const acc of approvers) await kvs.delete(approvalKey(pageId, stateId, acc)).catch(() => {});
    return;
  }
  // Fallback for a sweep with no known list (e.g. workflow unassign): best-effort query.
  const prefix = stateId ? `workflow-approval-${pageId}-${stateId}-` : `workflow-approval-${pageId}-`;
  const { results } = await kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100).getMany();
  for (const { key } of results || []) await kvs.delete(key).catch(() => {});
}

// An approver records a decision; if the threshold resolves, complete or clear the transition.
export async function decideApproval({ pageId, approverAccountId, decision, reason, actorName }) {
  const pending = await kvs.get(pendingKey(pageId));
  if (!pending) return { success: false, reason: "No approval is pending for this page" };
  // Segregation of duties: the requester cannot approve their own transition.
  if (pending.requestedBy && approverAccountId === pending.requestedBy) {
    return { success: false, reason: "You cannot approve a transition you requested" };
  }
  const stateId = pending.toStateId;
  const approvers = pending.approvers || [];
  const key = approvalKey(pageId, stateId, approverAccountId);
  const record = await kvs.get(key);
  if (!record) return { success: false, reason: "You are not an approver for this transition" };
  if (record.status && record.status !== "pending") {
    return { success: false, reason: "Your decision has already been recorded" };
  }
  if (decision !== "approved" && decision !== "denied") return { success: false, reason: "Invalid decision" };

  record.status = decision;
  record.decidedAt = new Date().toISOString();
  record.reason = reason || null;
  if (actorName && !record.approverName) record.approverName = actorName;
  await kvs.set(key, record);

  // Aggregate from strongly-consistent per-key gets over the known approver list.
  const records = await readApprovalRecords(pageId, stateId, approvers);
  const outcome = evaluateApproval(pending.mode, pending.min, records.map((r) => r.status || "pending"));

  if (outcome === "approved") {
    // #44 ANCHOR RULE (§1.5): the enforced baseline must be exactly the bytes the quorum
    // reviewed. Fail CLOSED if we can't verify the version, or if the page drifted during
    // the approval window (a tamper must not be laundered into the approved baseline).
    const live = await fetchLivePageVersion(pageId);
    if (live == null) {
      // record is set; leave the round pending so a transient GET failure can't half-enforce.
      return { success: false, reason: "Could not verify the page version — approval not applied, please retry." };
    }
    if (pending.pinnedVersion != null && live !== pending.pinnedVersion) {
      // The page changed since the approvers reviewed it — their votes are stale.
      await clearPageApprovals(pageId, stateId, approvers);
      await notifyApprovalResolved({ pageId, requestedBy: pending.requestedBy, outcome: "denied", targetName: pending.toStateName || stateId, deciderName: actorName }).catch(() => {});
      return { success: true, outcome: "stale", transitioned: false, reason: "Page changed since review — re-approval required." };
    }
    const res = await transitionPageWorkflow({
      pageId, spaceKey: pending.spaceKey, toStateId: stateId,
      actorAccountId: approverAccountId, actorName,
      reason: `approved (${records.filter((r) => r.status === "approved").length}/${records.length})`,
      approvers: pending.approvers, approvedVersion: pending.pinnedVersion,
    });
    await clearPageApprovals(pageId, stateId, approvers);
    await notifyApprovalResolved({ pageId, requestedBy: pending.requestedBy, outcome: "approved", targetName: pending.toStateName || stateId, deciderName: actorName }).catch(() => {});
    return { success: true, outcome: "approved", transitioned: !!res.success, record: res.record };
  }
  if (outcome === "denied") {
    await clearPageApprovals(pageId, stateId, approvers);
    await notifyApprovalResolved({ pageId, requestedBy: pending.requestedBy, outcome: "denied", targetName: pending.toStateName || stateId, deciderName: actorName }).catch(() => {});
    return { success: true, outcome: "denied" };
  }
  return { success: true, outcome: "pending" };
}

// Read model for the page/panel: the pending transition + per-approver statuses + staleness.
export async function getPageApprovalStatus(pageId) {
  const pending = await kvs.get(pendingKey(pageId));
  if (!pending) return { pending: false };
  const records = await readApprovalRecords(pageId, pending.toStateId, pending.approvers);
  const current = await readPageWorkflow(pageId);
  // #44: staleness — the page changed since the approvers reviewed it, so a completion
  // now would be blocked at decideApproval (§1.5). Surface it in the inbox/panel.
  const stale = pending.pinnedVersion != null && (await fetchLivePageVersion(pageId)) !== pending.pinnedVersion;
  return {
    pending: true, toStateId: pending.toStateId, mode: pending.mode, min: pending.min,
    requestedBy: pending.requestedBy, requestedByName: pending.requestedByName, requestedAt: pending.requestedAt,
    pinnedVersion: pending.pinnedVersion, stale, currentStateId: current?.stateId || null,
    approvers: records.map((r) => ({ accountId: r.approverAccountId, name: r.approverName, status: r.status, reason: r.reason, decidedAt: r.decidedAt })),
  };
}

// Inbox: all pending approval records assigned to this account (bounded cursor scan).
export async function listMyApprovals(accountId) {
  if (!accountId) return [];
  const out = [];
  let query = kvs.query().where("key", WhereConditions.beginsWith("workflow-approval-")).limit(100);
  let iterations = 0;
  do {
    const { results, nextCursor } = await query.getMany();
    for (const { value } of results || []) {
      if (value?.approverAccountId === accountId && value?.status === "pending") out.push(value);
    }
    if (!nextCursor || ++iterations >= 15) break;
    query = kvs.query().where("key", WhereConditions.beginsWith("workflow-approval-")).limit(100).cursor(nextCursor);
  } while (true);
  return out;
}
