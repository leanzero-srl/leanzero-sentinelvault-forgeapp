/**
 * WF-6 (UX critique 2026-09-19) — ONE workflow status for every always-present surface.
 *
 * Zero imports (node-importable, test/workflow-status.test.mjs): the byline chip, the details
 * modal and anything else that must say where a page is compose it from here, so the state
 * name, its single qualifier and its tone can never disagree between surfaces.
 *
 * The definition (BACKLOG-WORKFLOW.md WF-6): the state name + tone colour, plus ONE qualifier —
 *   "Review overdue"              the review period elapsed (beats everything: it needs a person)
 *   "Awaiting approval 0 of 2"    an approval request is open (decided-of-required)
 *   "Approved v2"                 an enforced state with a reviewed version
 *   "Declined Sep 19"             the last request was denied and nothing moved the page since
 *   "Request closed Sep 19"       …or closed as stale
 *   "In Review"                   otherwise, the state name alone
 *
 * Tones map to the SOLID palette the byline disc and the modal pill use (no tints).
 */

export const TONE_COLORS = Object.freeze({
  success: "#15803D",
  info: "#1D4ED8",
  warning: "#B45309",
  critical: "#B91C1C",
  neutral: "#475569",
  discovery: "#6D28D9",
});

/** A state definition's `color` word → a tone the palette knows. */
export function toneOfState(state) {
  const c = String(state?.color || "neutral").toLowerCase();
  return TONE_COLORS[c] ? c : "neutral";
}

// The byline is ONE value for every viewer and is composed in the lambda, so the date is pinned
// to UTC (the ribbon's chip formats the same instant in the viewer's zone — the two can differ
// by a day around midnight; the tooltip carries the full instant for anyone who cares).
const shortDate = (iso, locale) => {
  const ms = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString(locale || "en-US", { timeZone: "UTC", month: "short", day: "numeric" });
};

/**
 * PURE.
 * @param {{ record: object|null, state: {id,name,color}|null, pending: object|null,
 *           pendingDecided?: number, lastDecision: object|null, now?: number, locale?: string }} s
 *   record          the workflow-state record (stateId, enforce, approvedVersion, approvalRecord, reviewDueAt)
 *   state           the state definition the record points at
 *   pending         the workflow-pending record (toStateName, min, mode, approvers) or null
 *   pendingDecided  how many approvers have decided on the open request (default 0)
 *   lastDecision    lastDecisionFrom(log) — { kind: "denied"|"stale", at, byName, reason } or null
 * @returns {{ kind, text, qualifier, stateId, stateName, tone, color } | null}  null = no workflow
 */
export function workflowStatus({ record, state, pending, pendingDecided = 0, lastDecision, now = Date.now(), locale } = {}) {
  if (!record || !record.stateId) return null;
  const stateName = state?.name || record.stateId;
  const stateTone = toneOfState(state);
  const base = { stateId: record.stateId, stateName };
  const done = (kind, text, tone, qualifier = null) => ({ ...base, kind, text, qualifier, tone, color: TONE_COLORS[tone] });

  const dueMs = record.reviewDueAt ? new Date(record.reviewDueAt).getTime() : NaN;
  if (Number.isFinite(dueMs) && dueMs < now) return done("overdue", "Review overdue", "critical", "review overdue");

  if (pending && pending.toStateId) {
    const n = Math.max(0, Number(pendingDecided) || 0);
    const required = pending.mode === "any" ? 1 : Number.isInteger(pending.min) && pending.min > 0 ? pending.min : (Array.isArray(pending.approvers) ? pending.approvers.length : 1);
    return done("pending", `Awaiting approval ${n} of ${required}`, "info", `awaiting approval ${n} of ${required}`);
  }

  const enforced = !!record.enforce && record.approvedVersion != null;
  if (enforced) {
    const ar = record.approvalRecord || null;
    const reviewed = (typeof ar?.pinnedVersion === "number" ? ar.pinnedVersion : null) ?? record.approvedVersion;
    return done("enforced", `${stateName} v${reviewed}`, "success", `v${reviewed}`);
  }

  if (lastDecision && (lastDecision.kind === "denied" || lastDecision.kind === "stale")) {
    const d = shortDate(lastDecision.at, locale);
    const word = lastDecision.kind === "denied" ? "Declined" : "Request closed";
    return done(lastDecision.kind, d ? `${word} ${d}` : word, lastDecision.kind === "denied" ? "critical" : "neutral", word.toLowerCase());
  }

  return done("state", stateName, stateTone);
}

/** PURE. The sentence the modal and the tooltip use for an approval record, or null. */
export function approvalSummary(record, { locale } = {}) {
  if (!record?.enforce || record.approvedVersion == null) return null;
  const ar = record.approvalRecord || null;
  const fmt = (iso) => { const ms = iso ? new Date(iso).getTime() : NaN; return Number.isFinite(ms) ? new Date(ms).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" }) : "an unknown date"; };
  if (!ar) return `Approved on ${fmt(record.approvedAt)} (details were not recorded for this approval).`;
  const word = ar.outcome === "denied" ? "Denied" : "Approved";
  const decisions = Array.isArray(ar.decisions) ? ar.decisions : [];
  if (decisions.length === 0) return `${word} by ${ar.completedByName || "a space admin"} on ${fmt(ar.completedAt)}.`;
  const mode = ar.mode === "all" ? "every approver" : ar.mode === "min" ? `at least ${ar.min} of ${ar.approverCount}` : "any one approver";
  return `${word} for version ${ar.pinnedVersion ?? record.approvedVersion} on ${fmt(ar.completedAt)} · ${mode}.`;
}
