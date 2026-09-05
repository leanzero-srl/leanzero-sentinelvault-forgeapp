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
 *   workflow-inbox-{approverAccountId}-{pageId}
 *        = { pageId, stateId, requestedAt }
 *        The per-approver INDEX the inbox reads. Added 2026-09-05: listMyApprovals used to scan
 *        every workflow-approval-* record on the site (cap 1,500) and pick out the caller's —
 *        on a site with a few hundred orphaned records from deleted pages the scan never
 *        reached a freshly opened approval, so "Approvals waiting on you" rendered nothing while
 *        the page banner still showed the request. Written with the approval records, deleted
 *        with them, backfilled hourly by workflowSweep for approvals opened before this shipped.
 */
import { asApp, route } from "@forge/api";
import { kvs, WhereConditions } from "@forge/kvs";
import { setWithTtl } from "../../shared/kvs-ttl.js";
import { transitionPageWorkflow, readPageWorkflow, fetchLivePageVersion, appendWorkflowLog, getSpaceWorkflowSettings } from "./logic.js";
import { notifyApprovalRequested, notifyApprovalResolved } from "../../infra/approval-blueprints.js";
import { recordActivity } from "../../infra/activity-log.js";
import { verifySignature } from "./signature.js";

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

// --- Pure (unit-tested; no I/O). A4: the approval EVIDENCE snapshot. ---
// The per-approver records are deleted the moment an approval resolves (clearPageApprovals),
// so this is built from them BEFORE that delete and stored on the workflow state record
// (`record.approvalRecord`) and in the transition's workflow-log entry (`details.approvalRecord`).
// `records` are the strong per-key approval records over the known approver list — EVERY
// approver is listed, so an "any"-mode approval still shows who was asked and never answered
// (decision "pending"). `versionAtDecision` is the record's pinnedVersion: the version the
// approver actually reviewed. A direct steward approval (no approvers, no pending) passes
// `pending: { pinnedVersion }` and `records: []`, so the page carries the same shape once approved.
const MAX_DECISION_ROWS = 50;   // decided rows first; the rest are counted, not listed
const MAX_NAME = 120;
const bound = (v, n) => (typeof v === "string" ? v.slice(0, n) : (v ?? null));
export function buildApprovalRecord({ pending, records, outcome, completedBy, completedByName, nowIso }) {
  const p = pending || {};
  const all = (Array.isArray(records) ? records : []).map((r) => ({
    accountId: r?.approverAccountId ?? null,
    name: bound(r?.approverName, MAX_NAME),
    decision: r?.status || "pending",
    decidedAt: r?.decidedAt ?? null,
    reason: bound(r?.reason, 300),
    // The version the approver actually decided on (stamped at decide time); the request-time
    // pin only when the decision predates that stamp.
    versionAtDecision: typeof r?.decidedVersion === "number" ? r.decidedVersion : (typeof r?.pinnedVersion === "number" ? r.pinnedVersion : null),
    // B3: the decision was signed with the approver's enrolled device.
    signed: !!r?.signature,
  }));
  // A 100-approver roster with reasons would push the state record toward the KVS value cap
  // and make the page permanently un-approvable; keep the record bounded and say what was cut.
  const decided = all.filter((d) => d.decision !== "pending");
  const undecided = all.filter((d) => d.decision === "pending");
  const decisions = [...decided, ...undecided].slice(0, MAX_DECISION_ROWS);
  return {
    outcome: outcome === "denied" ? "denied" : outcome === "stale" ? "stale" : "approved",
    approverCount: all.length,
    omitted: Math.max(0, all.length - decisions.length),
    mode: p.mode ?? null,
    min: p.min ?? null,
    requestedBy: p.requestedBy ?? null,
    requestedByName: p.requestedByName ?? null,
    requestedAt: p.requestedAt ?? null,
    pinnedVersion: typeof p.pinnedVersion === "number" ? p.pinnedVersion : null,
    completedAt: nowIso || new Date().toISOString(),
    completedBy: completedBy ?? null,
    completedByName: completedByName ?? null,
    aiGate: p.aiGate?.required ? { status: p.aiGate.status ?? null, reason: bound(p.aiGate.reason, 320) } : null,
    decisions,
  };
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
export const inboxKey = (accountId, pageId) => `workflow-inbox-${accountId}-${pageId}`;

// Pure (unit-tested). An approval record is an ORPHAN when its page has no pending transition
// any more (page deleted mid-approval, or a teardown path that cleared the pending record by
// query and missed a key) — but only once it is old enough that it cannot be the record of a
// request that is being opened right now: requestApprovalTransition writes the approval
// records BEFORE the pending record, and the sweep must never eat that window.
export const ORPHAN_APPROVAL_MIN_AGE_MS = 60 * 60 * 1000;
export function isOrphanApproval(record, pendingExists, nowMs = Date.now()) {
  if (pendingExists) return false;
  const at = Date.parse(record?.requestedAt || "");
  if (!Number.isFinite(at)) return true; // no provenance at all: nothing can be waiting on it
  return nowMs - at >= ORPHAN_APPROVAL_MIN_AGE_MS;
}

// Open a pending transition + one approval record per approver.
export async function requestApprovalTransition({ pageId, toStateId, toStateName, spaceKey, approvers, mode, min, actorAccountId, actorName, pinnedVersion, approverNames, aiGate }) {
  const requestedAt = new Date().toISOString();
  for (const acc of approvers) {
    await kvs.set(approvalKey(pageId, toStateId, acc), {
      pageId, stateId: toStateId, approverAccountId: acc, approverName: (approverNames && approverNames[acc]) || null,
      status: "pending", requestedAt, decidedAt: null, reason: null, pinnedVersion,
    });
    await kvs.set(inboxKey(acc, pageId), { pageId, stateId: toStateId, requestedAt });
  }
  await kvs.set(pendingKey(pageId), {
    toStateId, toStateName: toStateName || null, approvalId: APPROVAL_ID, requestedBy: actorAccountId || null, requestedByName: actorName || null,
    requestedAt, pinnedVersion, approvers, mode, min, spaceKey: spaceKey || null,
    // #46: the AI review axis, AND-composed with the human quorum on the same pinned version.
    aiGate: aiGate?.required ? { required: true, status: "pending", threshold: aiGate.threshold || "medium", reviewedVersion: null, reason: null, enqueuedAt: Date.now() } : null,
  });
  // A1: the pending record is written — the request is open from here on.
  await recordActivity({
    type: "workflow.approval-requested",
    pageId,
    spaceKey: spaceKey || null,
    actor: actorAccountId ? { accountId: actorAccountId, name: actorName || null } : null,
    target: { kind: "page", id: pageId, name: null },
    details: {
      to: toStateId,
      toName: toStateName || toStateId,
      approverCount: approvers.length,
      approvers: approvers.slice(0, 10), // ids are ~47 bytes each; 22 would breach the 1 KB details cap (A1 review F3)
      mode,
      min,
      pinnedVersion: pinnedVersion ?? null,
      aiGate: aiGate?.required ? true : false,
    },
    version: pinnedVersion ?? null,
  });
  // Best-effort: @mention the approvers in a page comment so Confluence emails them.
  if (approvers.length) {
    await notifyApprovalRequested({
      pageId, targetName: toStateName, requestedByName: actorName, mode, min,
      approvers: approvers.map((id) => ({ id, name: (approverNames && approverNames[id]) || null })),
    }).catch(() => {});
  }
  return { pending: true, approvers, mode, min, aiGate: aiGate?.required ? true : false };
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
    for (const acc of approvers) {
      await kvs.delete(approvalKey(pageId, stateId, acc)).catch(() => {});
      await kvs.delete(inboxKey(acc, pageId)).catch(() => {});
    }
    return;
  }
  // Fallback for a sweep with no known list (e.g. workflow unassign): best-effort query.
  const prefix = stateId ? `workflow-approval-${pageId}-${stateId}-` : `workflow-approval-${pageId}-`;
  const { results } = await kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100).getMany();
  for (const { key, value } of results || []) {
    await kvs.delete(key).catch(() => {});
    if (value?.approverAccountId) await kvs.delete(inboxKey(value.approverAccountId, pageId)).catch(() => {});
  }
}

// Complete an approved transition — shared by the human path (decideApproval) and the AI
// path (applyAiVerdict) once BOTH the human quorum AND the AI gate are satisfied. Carries the
// full #44 anchor rule (fail-closed on null / stale version) so it can't be bypassed.
const completingKey = (pageId) => `workflow-completing-${pageId}`;

async function finalizeApprovedTransition(pageId, stateId, pending, actorAccountId, actorName, voteSummary) {
  const approvers = pending.approvers || [];
  // One-shot completion CLAIM (dedup concurrent finalizers: duplicate AI delivery, and the
  // AI-verdict-vs-last-human-vote race). KVS has no CAS, so this narrows the window; the
  // DURABLE backstop is gating every side-effect on the transition actually happening below.
  if (await kvs.get(completingKey(pageId))) {
    return { success: true, outcome: "approved", transitioned: false, alreadyCompleting: true };
  }
  await setWithTtl(completingKey(pageId), { stateId, at: new Date().toISOString() }, 120000);
  try {
    const live = await fetchLivePageVersion(pageId);
    if (live == null) {
      return { success: false, reason: "Could not verify the page version — approval not applied, please retry." };
    }
    if (pending.pinnedVersion != null && live !== pending.pinnedVersion) {
      // A4: the decisions are about to be deleted; a stale outcome must not erase who said what.
      try {
        const staleRecord = buildApprovalRecord({
          pending, records: await readApprovalRecords(pageId, stateId, approvers), outcome: "stale",
          completedBy: actorAccountId || null, completedByName: actorName || null,
        });
        const current = await readPageWorkflow(pageId);
        await appendWorkflowLog(pageId, {
          kind: "approval-stale", from: current?.stateId ?? null, to: stateId,
          by: actorAccountId || null, byName: actorName || null,
          reason: `page changed since review (reviewed v${pending.pinnedVersion}, now v${live})`,
          details: { approvalRecord: staleRecord },
        });
      } catch (e) { console.warn("[APPROVALS] stale trace failed:", e); }
      await clearPageApprovals(pageId, stateId, approvers);
      await notifyApprovalResolved({ pageId, requestedBy: pending.requestedBy, outcome: "denied", targetName: pending.toStateName || stateId, deciderName: actorName }).catch(() => {});
      return { success: true, outcome: "stale", transitioned: false, reason: "Page changed since review — re-approval required." };
    }
    // A4: snapshot the evidence from the strong per-key records NOW — clearPageApprovals below
    // deletes them, and the snapshot is what the page keeps (record.approvalRecord + the log).
    const approvalRecord = buildApprovalRecord({
      pending, records: await readApprovalRecords(pageId, stateId, approvers), outcome: "approved",
      completedBy: actorAccountId || null, completedByName: actorName || null,
    });
    const res = await transitionPageWorkflow({
      pageId, spaceKey: pending.spaceKey, toStateId: stateId,
      actorAccountId: actorAccountId || pending.requestedBy || null, actorName,
      reason: voteSummary || "approved",
      approvers: pending.approvers, approvedVersion: pending.pinnedVersion,
      approvalRecord,
    });
    // Gate side-effects on the transition ACTUALLY happening. A finalizer that lost the race
    // gets res.success=false (validateTransition no-ops on the already-left source state) and
    // must NOT re-clear/re-notify — that would double-email or resurrect a phantom pending.
    if (res.success) {
      await clearPageApprovals(pageId, stateId, approvers);
      await notifyApprovalResolved({ pageId, requestedBy: pending.requestedBy, outcome: "approved", targetName: pending.toStateName || stateId, deciderName: actorName }).catch(() => {});
      return { success: true, outcome: "approved", transitioned: true, record: res.record };
    }
    return { success: true, outcome: "approved", transitioned: false, alreadyCompleted: true };
  } finally {
    await kvs.delete(completingKey(pageId)).catch(() => {});
  }
}

// Whether the human approval axis is satisfied (vacuously true for an AI-only gate).
function humanQuorumMet(pending, records) {
  if (!pending.approvers || pending.approvers.length === 0) return true;
  return evaluateApproval(pending.mode, pending.min, records.map((r) => r.status || "pending")) === "approved";
}

// #46 Part B: the AI review verdict lands here (from aiValidationConsumer's gate branch, or a
// simulated verdict / the reaper). Writes the verdict onto the SAME pending record as an
// `aiGate` axis, then completes the transition iff the human quorum is also met. CAS-guarded:
// only flips aiGate from "pending", so a duplicate delivery or a reaper/worker race is a no-op.
export async function applyAiVerdict(pageId, reviewedVersion, status, reason) {
  const pending = await kvs.get(pendingKey(pageId));
  if (!pending?.aiGate?.required) return { applied: false, reason: "no AI gate pending" };
  if (pending.aiGate.status !== "pending") return { applied: false, reason: "already resolved" }; // CAS: only from pending
  // Version pin: if the AI scored a different version than the humans reviewed, it's stale → fail.
  const stale = reviewedVersion != null && pending.pinnedVersion != null && reviewedVersion !== pending.pinnedVersion;
  pending.aiGate.status = stale ? "failed" : (status === "passed" ? "passed" : "failed");
  pending.aiGate.reviewedVersion = reviewedVersion ?? null;
  pending.aiGate.reason = stale ? "Page changed during AI review — re-request." : (reason ?? null);
  // Re-read immediately before the write: don't resurrect a pending record that a concurrent
  // completion or denial (clearPageApprovals) just deleted (best-effort narrowing; no KVS CAS).
  const still = await kvs.get(pendingKey(pageId));
  if (!still || still.aiGate?.status !== "pending") return { applied: false, reason: "resolved concurrently" };
  await kvs.set(pendingKey(pageId), pending);
  if (pending.aiGate.status !== "passed") return { applied: true, status: pending.aiGate.status };
  // AI passed — complete iff the human axis is also met (else wait for the last human vote).
  const records = await readApprovalRecords(pageId, pending.toStateId, pending.approvers);
  if (!humanQuorumMet(pending, records)) return { applied: true, status: "passed", waiting: "humans" };
  // The AI was a CONDITION; the authority was the steward who requested the transition.
  const res = await finalizeApprovedTransition(pageId, pending.toStateId, pending, pending.requestedBy || null, pending.requestedByName || "Sentinel Vault", "approved (AI review + approvals)");
  return { applied: true, status: "passed", ...res };
}

// An approver records a decision; if the threshold resolves, complete or clear the transition.
export async function decideApproval({ pageId, approverAccountId, decision, reason, actorName, signatureCode }) {
  const pending = await kvs.get(pendingKey(pageId));
  if (!pending) return { success: false, reason: "No approval is pending for this page" };
  // B3: a space can require every decision to be SIGNED — a TOTP from the approver's enrolled
  // device — checked before anything is written, so a failed code leaves no trace.
  let signature = null;
  const spaceSettings = await getSpaceWorkflowSettings(pending.spaceKey);
  if (spaceSettings?.requireSignature) {
    const v = await verifySignature(approverAccountId, signatureCode);
    if (!v.ok) return { success: false, reason: v.reason, signatureRequired: true };
    signature = v.signature;
  }
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
  if (signature) record.signature = signature;
  // A4: the version this approver decided on (the request pin is the version they were ASKED
  // about; a denial after an interim save is about what they actually saw).
  try { const lv = await fetchLivePageVersion(pageId); if (typeof lv === "number") record.decidedVersion = lv; } catch (_) { /* best-effort */ }
  if (actorName && !record.approverName) record.approverName = actorName;
  await kvs.set(key, record);

  // Aggregate from strongly-consistent per-key gets over the known approver list.
  const records = await readApprovalRecords(pageId, stateId, approvers);
  const outcome = evaluateApproval(pending.mode, pending.min, records.map((r) => r.status || "pending"));

  // A1: the vote is recorded (kvs.set above) — witness it with the outcome the vote produced.
  // `outcome` here is what the quorum says; the finalizer may still turn "approved" into
  // "stale" (page changed) or a no-op, so the result's own outcome wins when it has one.
  const decided = async (result) => {
    await recordActivity({
      type: "workflow.approval-decided",
      pageId,
      spaceKey: pending.spaceKey || null,
      actor: { accountId: approverAccountId, name: actorName || record.approverName || null },
      target: { kind: "page", id: pageId, name: null },
      details: {
        decision,
        reason: reason || null,
        to: stateId,
        toName: pending.toStateName || stateId,
        versionAtDecision: await fetchLivePageVersion(pageId),
        outcome: result?.outcome || outcome,
        transitioned: result?.transitioned === true,
      },
      version: pending.pinnedVersion ?? null,
    });
    return result;
  };

  if (outcome === "approved") {
    // #46: the human quorum is met — the transition completes only when the AI axis (if
    // required) has also passed. RE-READ the pending fresh so a verdict that landed AFTER our
    // initial read isn't missed (else a lost-wakeup: AI just passed, our stale snapshot still
    // says pending, we'd hold with the quorum already met and neither path would finalize).
    const freshPending = (await kvs.get(pendingKey(pageId))) || pending;
    if (freshPending.aiGate?.required && freshPending.aiGate.status !== "passed") {
      if (freshPending.aiGate.status === "failed") {
        return decided({ success: true, outcome: "ai-blocked", transitioned: false, reason: "AI content review did not pass — revise and re-request." });
      }
      return decided({ success: true, outcome: "pending-ai", transitioned: false, reason: "Approvals complete — waiting on the AI content review." });
    }
    const voteSummary = `approved (${records.filter((r) => r.status === "approved").length}/${records.length})`;
    return decided(await finalizeApprovedTransition(pageId, stateId, freshPending, approverAccountId, actorName, voteSummary));
  }
  if (outcome === "denied") {
    // A4 §3: a denial used to leave NO durable trace once the records were deleted. Snapshot
    // the evidence (from `records`, read above — before the clear) into a workflow-log entry
    // FIRST, so the trace exists even if the clear below fails midway. Shape mirrors a
    // transition entry (from/to/by/byName/reason) plus `kind` so readers can tell it apart:
    // the page did NOT move, it stays in `from`.
    const approvalRecord = buildApprovalRecord({
      pending, records, outcome: "denied",
      completedBy: approverAccountId, completedByName: actorName || record.approverName || null,
    });
    await appendWorkflowLog(pageId, {
      kind: "approval-denied",
      from: (await readPageWorkflow(pageId))?.stateId ?? null,
      to: stateId,
      by: approverAccountId,
      byName: actorName || record.approverName || null,
      reason: "approval denied",
      details: { approvalRecord },
    });
    await clearPageApprovals(pageId, stateId, approvers);
    await notifyApprovalResolved({ pageId, requestedBy: pending.requestedBy, outcome: "denied", targetName: pending.toStateName || stateId, deciderName: actorName }).catch(() => {});
    return decided({ success: true, outcome: "denied" });
  }
  return decided({ success: true, outcome: "pending" });
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
    approvers: records.map((r) => ({ accountId: r.approverAccountId, name: r.approverName, status: r.status, reason: r.reason, decidedAt: r.decidedAt, signed: !!r.signature })),
    // #46: the AI review axis, if this transition requires one.
    aiGate: pending.aiGate?.required ? { status: pending.aiGate.status, reason: pending.aiGate.reason || null } : null,
  };
}

// Inbox: the caller's pending approval records, read through the per-approver index
// (workflow-inbox-{account}-*) and confirmed per key against the approval record itself —
// a strongly-consistent get, so a decision recorded a moment ago is never listed again.
// An index row whose approval record is gone is stale (cleared by a path that predates the
// index, or a lost delete) and is removed on the way past.
export async function listMyApprovals(accountId) {
  if (!accountId) return [];
  const out = [];
  const prefix = `workflow-inbox-${accountId}-`;
  let query = kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100);
  let iterations = 0;
  do {
    const { results, nextCursor } = await query.getMany();
    for (const { key, value: row } of results || []) {
      if (!row?.pageId || !row?.stateId) { await kvs.delete(key).catch(() => {}); continue; }
      const record = await kvs.get(approvalKey(row.pageId, row.stateId, accountId));
      if (record?.status === "pending") { out.push(record); continue; }
      if (!record) await kvs.delete(key).catch(() => {});
    }
    if (!nextCursor || ++iterations >= 15) break;
    query = kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100).cursor(nextCursor);
  } while (true);
  return out;
}

// Hourly housekeeping (called from workflowSweep):
//   (a) BACKFILL — every pending transition's approvers get an index row if they lack one, so
//       approvals opened before the index existed reach the inbox within an hour of upgrade.
//   (b) ORPHANS — a bounded page of workflow-approval-* records whose page has no pending
//       transition (and that are old enough not to be one being opened right now) is deleted
//       together with their index rows. Without this the record population only ever grows:
//       a page deleted mid-approval leaves its records behind forever.
export async function sweepApprovalIndex({ nowMs = Date.now(), maxOrphanPages = 5 } = {}) {
  const stats = { backfilled: 0, orphansRemoved: 0 };
  let pq = kvs.query().where("key", WhereConditions.beginsWith("workflow-pending-")).limit(100);
  let piter = 0;
  do {
    const { results, nextCursor } = await pq.getMany();
    for (const { key, value: pend } of results || []) {
      const pageId = String(key).replace(/^workflow-pending-/, "");
      for (const acc of pend?.approvers || []) {
        try {
          if (!(await kvs.get(inboxKey(acc, pageId)))) {
            await kvs.set(inboxKey(acc, pageId), { pageId, stateId: pend.toStateId, requestedAt: pend.requestedAt || null });
            stats.backfilled++;
          }
        } catch (e) { console.warn("[WORKFLOW-SWEEP] inbox backfill", e); }
      }
    }
    if (!nextCursor || ++piter >= 20) break;
    pq = kvs.query().where("key", WhereConditions.beginsWith("workflow-pending-")).limit(100).cursor(nextCursor);
  } while (true);

  let aq = kvs.query().where("key", WhereConditions.beginsWith("workflow-approval-")).limit(100);
  let aiter = 0;
  const pendingSeen = new Map(); // pageId -> boolean, one strong get per page per run
  do {
    const { results, nextCursor } = await aq.getMany();
    for (const { key, value: rec } of results || []) {
      try {
        const pageId = rec?.pageId || String(key).split("-")[2];
        if (!pendingSeen.has(pageId)) pendingSeen.set(pageId, !!(await kvs.get(pendingKey(pageId))));
        if (!isOrphanApproval(rec, pendingSeen.get(pageId), nowMs)) continue;
        await kvs.delete(key);
        if (rec?.approverAccountId) await kvs.delete(inboxKey(rec.approverAccountId, pageId)).catch(() => {});
        stats.orphansRemoved++;
      } catch (e) { console.warn("[WORKFLOW-SWEEP] orphan approval", e); }
    }
    if (!nextCursor || ++aiter >= maxOrphanPages) break;
    aq = kvs.query().where("key", WhereConditions.beginsWith("workflow-approval-")).limit(100).cursor(nextCursor);
  } while (true);
  return stats;
}
