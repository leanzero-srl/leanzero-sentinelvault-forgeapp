/**
 * SEC-2 (UX critique 2026-09-19, owner decision: "the workflow is the senior lock") — ONE rule
 * for who owns a seal on a page, zero imports (unit-tested in test/seal-authority.test.mjs).
 *
 * Outside an enforced workflow state a section or attachment seal is what it always was:
 * personal — its owner releases, extends, grants and is the only privileged editor. While the
 * page is in an ENFORCED state (Approved), every seal on it is OWNED BY THE WORKFLOW:
 *
 *   - the privileged set is the page's (approver snapshot ∩ live approvers, or a steward) — the
 *     personal owner and every grantee are outside it unless they are in that set;
 *   - release / extend / grant / approve / deny / request are refused for everyone but a steward's
 *     break-glass force-release ("Locked by the approval of this page — changes go through the
 *     workflow");
 *   - expiry is SUSPENDED: entering the state stores the remaining time on the record and clears
 *     `expiresAt`; leaving hands the seal back with exactly that time left.
 *
 * The record shape the workflow leaves on a held seal:
 *   workflowHeld: { pageId, stateId, stateName, since, remainingMs | null, prevExpiresAt | null }
 */

export const HELD_REASON = "Locked by the approval of this page — changes go through the workflow";
export const HELD_ROW_LABEL = "Locked by the approval of this page";

/** PURE. Is this seal record held by the workflow right now? */
export function isWorkflowHeld(seal) {
  return !!(seal && seal.workflowHeld && typeof seal.workflowHeld === "object");
}

/**
 * PURE. Does this workflow record (the page's workflow-state record) hold the page's seals?
 * The same "enforced" predicate the status and the trigger use: an enforce state with a baseline.
 */
export function workflowHoldsSeals(record) {
  return !!(record && record.enforce === true);
}

/**
 * PURE. The seal record as the workflow holds it. Idempotent: an already-held seal is returned
 * unchanged (a second Approved entry, a retried transition).
 */
export function holdSeal(seal, { record, stateName, now = Date.now() } = {}) {
  if (!seal || isWorkflowHeld(seal)) return seal;
  const expMs = seal.expiresAt ? new Date(seal.expiresAt).getTime() : NaN;
  const remainingMs = Number.isFinite(expMs) ? Math.max(0, expMs - now) : null;
  return {
    ...seal,
    expiresAt: null,
    workflowHeld: {
      pageId: record?.pageId || seal.pageId || seal.contentId || null,
      stateId: record?.stateId || null,
      stateName: stateName || record?.stateId || "Approved",
      since: new Date(now).toISOString(),
      remainingMs,
      prevExpiresAt: seal.expiresAt || null,
    },
  };
}

/**
 * PURE. The seal handed back to its owner with the time it had left. A seal that was already
 * lapsed when held (remainingMs 0) comes back lapsed; one with no expiry stays without.
 */
export function handBackSeal(seal, { now = Date.now() } = {}) {
  if (!seal || !isWorkflowHeld(seal)) return seal;
  const { workflowHeld, ...rest } = seal;
  const remaining = workflowHeld.remainingMs;
  const expiresAt = remaining == null ? null : new Date(now + Math.max(0, Number(remaining) || 0)).toISOString();
  return { ...rest, expiresAt, handedBackAt: new Date(now).toISOString() };
}

/**
 * PURE. May `actorId` edit INSIDE this seal without the app undoing it?
 * @param {{ seal, actorId, isOwner?: boolean, hasGrant?: boolean, workflowPrivileged?: boolean }} s
 *   workflowPrivileged  the trigger's answer for the page (approver snapshot ∩ live, or steward)
 * Held → only the workflow's privileged set (grants are frozen). Personal → owner or grantee.
 */
export function mayEditInside({ seal, actorId, isOwner, hasGrant, workflowPrivileged } = {}) {
  if (!seal) return false;
  if (isWorkflowHeld(seal)) return workflowPrivileged === true;
  const owner = isOwner != null ? isOwner : (!!actorId && seal.lockedBy === actorId);
  return owner || hasGrant === true;
}

/**
 * PURE. The refusal for a personal-seal action on a held seal, or null when the action may run.
 * `action`: "release" | "extend" | "grant" | "approve" | "deny" | "request" | "force-release".
 * A steward's force-release (break-glass, typed reason) stays possible — it is the one door out.
 */
export function heldRefusal(seal, action) {
  if (!isWorkflowHeld(seal)) return null;
  if (action === "force-release") return null;
  return HELD_REASON;
}

/** PURE. The short row / badge copy for a held seal. */
export function heldLabel(seal) {
  if (!isWorkflowHeld(seal)) return null;
  const st = seal.workflowHeld.stateName || "Approved";
  return `${HELD_ROW_LABEL} (${st})`;
}
