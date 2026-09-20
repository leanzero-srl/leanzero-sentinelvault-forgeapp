/**
 * WF-3 (c) (UX critique 2026-09-19, done 2026-09-20): the REQUESTER's own approval requests —
 * "Approvals you asked for" on My work. The requester used to have nowhere to look: the inbox is
 * the approvers', the ribbon is per page. One row per (requester, page) —
 * wfreq-mine-{requester}-{pageId} — written when the request opens (the same pattern as SEC-8's
 * editreq-mine index), confirmed on read against the pending record, the page's workflow record
 * and the log, and dropped once it says nothing any more. PURE here; the I/O sits in approvals.js.
 */
export const MY_REQUEST_PREFIX = "wfreq-mine";
export const MY_REQUEST_KEEP_MS = 14 * 24 * 3600 * 1000; // a decided request stays listed two weeks
export const myRequestKey = (requesterAccountId, pageId) => `${MY_REQUEST_PREFIX}-${requesterAccountId}-${pageId}`;

const ms = (iso) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? t : NaN; };

/**
 * PURE. What the requester's row means right now.
 * @param {object} p
 * @param {object} p.row          the index row { pageId, spaceKey, toStateId, toStateName, requestedAt }
 * @param {object|null} p.pending  workflow-pending-{pageId} (the open request) or null
 * @param {object|null} p.record   workflow-state-{pageId} or null
 * @param {object|null} p.lastDecision  lastDecisionFrom(log) — { kind: "denied"|"stale", at, byName, reason } or null
 * @param {number} [p.decided]     how many approvers have decided on the open request
 * @param {number} [p.approverCount]
 * @param {number} [p.now]
 * @returns {{ status: "pending"|"approved"|"denied"|"stale"|"gone", keep: boolean, ... }}
 */
export function classifyMyApprovalRequest({ row, pending, record, lastDecision, decided = 0, approverCount = 0, now = Date.now() } = {}) {
  if (!row?.pageId) return { status: "gone", keep: false };
  const askedAt = ms(row.requestedAt);
  const base = { pageId: row.pageId, spaceKey: row.spaceKey || null, toStateId: row.toStateId || null, toStateName: row.toStateName || row.toStateId || null, requestedAt: row.requestedAt || null };
  if (pending && pending.requestedBy === row.requesterAccountId) {
    return { ...base, status: "pending", keep: true, decided, approverCount: approverCount || (Array.isArray(pending.approvers) ? pending.approvers.length : 0), mode: pending.mode || null, min: pending.min || null };
  }
  const ar = record?.approvalRecord || null;
  const arAt = ms(ar?.completedAt);
  if (ar && ar.requestedBy === row.requesterAccountId && ar.outcome === "approved" && (!Number.isFinite(askedAt) || !Number.isFinite(arAt) || arAt >= askedAt - 1000)) {
    const at = Number.isFinite(arAt) ? arAt : now;
    return { ...base, status: "approved", keep: now - at < MY_REQUEST_KEEP_MS, at: ar.completedAt || null, byName: ar.completedByName || null, approvedVersion: record?.approvedVersion ?? null };
  }
  const ld = lastDecision && (lastDecision.kind === "denied" || lastDecision.kind === "stale") ? lastDecision : null;
  const ldAt = ms(ld?.at) || (typeof ld?.at === "number" ? ld.at : NaN);
  if (ld && (!Number.isFinite(askedAt) || !Number.isFinite(ldAt) || ldAt >= askedAt - 1000)) {
    const at = Number.isFinite(ldAt) ? ldAt : now;
    return { ...base, status: ld.kind, keep: now - at < MY_REQUEST_KEEP_MS, at: new Date(at).toISOString(), byName: ld.byName || null, reason: ld.reason || null, reviewedVersion: ld.reviewedVersion ?? null };
  }
  return { ...base, status: "gone", keep: false };
}
