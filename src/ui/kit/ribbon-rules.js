// 5.0 ribbon — the PURE show rule and the one-state-pill choice, shared by the banner surface and
// the policies write gate. Zero imports beyond status-language, node-importable
// (test/ribbon-rules.test.mjs), like activity-format.js and page-details/row-state.js.
//
// 2026-09-30 (classification review, owner: "the top banner should appear all the time for the
// space and related pages"): classification is a persistent MARKING, not an alert. When it is
// active for the page's space the row shows on EVERY view — level block always drawn ("Unclassified"
// in neutral grey when nothing applies), whether or not the page has attachments, seals or a
// workflow. When it is off, only seal / workflow / validation / alert states open the row. The old
// steward settings `ribbonMode` ("exceptions" | "always") and `ribbonThreshold*` therefore have no
// job: their controls are gone, the write gate still accepts well-formed values from old records and
// API clients (validateRibbonSettings), and nothing reads them.
//
// decideRibbon(input) → { show, active, urgent, classification, reasons, dismissable }
//   input.classification  { level: { id, name, color, rank } | null, source: "page"|"space"|"none", enabled: boolean }
//   input.waitingOnMe     { requests, approvals, grantsActive: [{ name, until, kind }] }
//   input.lockedFor       { name, owner, until, kind, myRequest: "none"|"pending" } | null
//   input.alerts          the viewer-relevant dispatches (array)
//   input.workflow        the page workflow answer (truthy when assigned) | null
//   input.validation      "passed" | "failed" | null
//
// The urgent state is exactly ONE pill (decision 3 of the mockup), chosen in this order: an active
// violation alert ("Undone" / "Moved back"), work waiting on the viewer ("Waiting for you N"), an
// active grant ("Edit now"), the viewer's own pending request ("Waiting for {owner}"), the viewer's
// declined request ("Declined · ask again W", SEC-8), a seal the viewer does not own ("Locked").
// Workflow and validation states open the row too but render their own controls, not a pill.
//
// `dismissable` (root cause C): × may hide the right half (and acknowledge an alert), never the
// classification marking — it is true only when there IS something beside the level block.

import { when } from "./status-language.js";

export const RIBBON_MODES = Object.freeze(["exceptions", "always"]);
export const DEFAULT_RIBBON_MODE = "exceptions";
export const DEFAULT_RIBBON_THRESHOLD_RANK = 4;

/**
 * PURE. Validate a partial settings write. Only the keys PRESENT are checked (a save that omits a
 * key keeps what is stored — the it67 rule). Returns { ok:true } or { ok:false, reason }.
 */
export function validateRibbonSettings(data) {
  if (!data || typeof data !== "object") return { ok: true };
  if ("ribbonMode" in data && data.ribbonMode != null && !RIBBON_MODES.includes(data.ribbonMode)) {
    return { ok: false, reason: `Ribbon mode must be one of: ${RIBBON_MODES.join(", ")}.` };
  }
  if ("ribbonThresholdRank" in data && data.ribbonThresholdRank != null) {
    const n = Number(data.ribbonThresholdRank);
    if (!Number.isInteger(n) || n < 1 || n > 99) return { ok: false, reason: "Ribbon threshold must be a whole-number rank from 1 to 99." };
  }
  if ("ribbonThresholdLevel" in data && data.ribbonThresholdLevel != null) {
    if (typeof data.ribbonThresholdLevel !== "string" || !data.ribbonThresholdLevel.trim() || data.ribbonThresholdLevel.length > 64) return { ok: false, reason: "Ribbon threshold level must be a level id (up to 64 characters) or null." };
  }
  return { ok: true };
}

const count = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : 0);

/** PURE. The single urgent state for the right half, or null when nothing is urgent for the viewer. */
export function pickUrgent({ waitingOnMe, lockedFor, alerts } = {}) {
  const alertList = Array.isArray(alerts) ? alerts : [];
  if (alertList.length > 0) return { kind: "restored", count: alertList.length, alert: alertList[0] };
  const waiting = count(waitingOnMe?.requests) + count(waitingOnMe?.approvals);
  if (waiting > 0) return { kind: "waiting-for-you", count: waiting, requests: count(waitingOnMe?.requests), approvals: count(waitingOnMe?.approvals) };
  const grants = Array.isArray(waitingOnMe?.grantsActive) ? waitingOnMe.grantsActive.filter(Boolean) : [];
  if (grants.length > 0) return { kind: "edit-now", grant: grants[0], count: grants.length };
  if (lockedFor && lockedFor.myRequest === "pending") return { kind: "waiting-for-owner", seal: lockedFor };
  // SEC-8: a declined request is a visible state until its cooldown passes, not a disabled button.
  if (lockedFor && lockedFor.myRequest === "denied" && lockedFor.retryAt) return { kind: "declined", seal: lockedFor, retryAt: lockedFor.retryAt };
  if (lockedFor) return { kind: "locked", seal: lockedFor };
  return null;
}

/**
 * PURE. The show rule. Active classification (`classification.enabled === true`) always shows the
 * row; otherwise the row opens only for an urgent state, a workflow or a validation state.
 */
export function decideRibbon(input = {}) {
  const active = input.classification?.enabled === true;
  const classification = active
    ? { level: input.classification.level || null, source: input.classification.level ? input.classification.source || "page" : "none", enabled: true }
    : { level: null, source: "none", enabled: false };
  const urgent = pickUrgent(input);
  const reasons = [];
  if (urgent) reasons.push(urgent.kind);
  if (input.workflow) reasons.push("workflow");
  if (input.validation) reasons.push("validation");
  const dismissable = reasons.length > 0;
  if (active) reasons.unshift(classification.level ? "classification" : "unclassified");
  return { show: active || reasons.length > 0, active, urgent, classification, reasons, dismissable };
}

/** SEC-3: the ONE date formatter lives in status-language.js; this name stays for its callers. */
export const untilLabel = when;
