// 5.0 ribbon (mockup docs/mockups/sv-status-surfaces.html §2 "Exceptions only" and §3 "Always show
// classification") — the PURE show rule and the one-state-pill choice, shared by the banner surface,
// the `ribbon-summary` resolver (which echoes the steward setting it read) and the policies write
// gate (which validates the setting). Zero imports, node-importable (test/ribbon-rules.test.mjs), like
// activity-format.js and page-details/row-state.js.
//
// The steward settings live on `admin-settings-global`:
//   ribbonMode           "exceptions" (default) | "always"
//   ribbonThresholdRank  whole number 1..99, default 4 (the rank of "Restricted" in the default scheme)
//
// decideRibbon(input) → { show, urgent, reasons }
//   input.mode            "exceptions" | "always"
//   input.classification  { level: { id, name, color, rank } | null, source: "page"|"space"|"none" }
//   input.threshold       { rank }   (input.thresholdRank is accepted too)
//   input.waitingOnMe     { requests, approvals, grantsActive: [{ name, until, kind }] }
//   input.lockedFor       { name, owner, until, kind, myRequest: "none"|"pending" } | null
//   input.alerts          the viewer-relevant dispatches (array)
//   input.workflow        the page workflow answer (truthy when assigned) | null
//   input.validation      "passed" | "failed" | "awaiting-approval" | null
//
// The urgent state is exactly ONE pill (decision 3 of the mockup), chosen in this order: an active
// violation alert ("Undone" / "Moved back"), work waiting on the viewer ("Waiting for you N"), an
// active grant ("Edit now"), the viewer's own pending request ("Waiting for {owner}"), the viewer's
// declined request ("Declined · ask again W", SEC-8), a seal the viewer does not own ("Locked"). Workflow and validation states are urgent too — they keep the row open as before —
// but they render their own existing controls, not a pill from this list.

import { when } from "./status-language.js";

export const RIBBON_MODES = Object.freeze(["exceptions", "always"]);
export const DEFAULT_RIBBON_MODE = "exceptions";
export const DEFAULT_RIBBON_THRESHOLD_RANK = 4;

/** PURE. The steward settings as stored → the two values every reader uses. Unknown → defaults. */
export function normalizeRibbonSettings(stored) {
  const mode = RIBBON_MODES.includes(stored?.ribbonMode) ? stored.ribbonMode : DEFAULT_RIBBON_MODE;
  const raw = Number(stored?.ribbonThresholdRank);
  const rank = Number.isInteger(raw) && raw >= 1 && raw <= 99 ? raw : DEFAULT_RIBBON_THRESHOLD_RANK;
  return { ribbonMode: mode, ribbonThresholdRank: rank };
}

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

/** PURE. Does the classification alone open the row in "exceptions" mode? */
export function meetsThreshold(classification, threshold) {
  const rank = Number(classification?.level?.rank);
  const bar = Number(threshold?.rank ?? threshold);
  if (!Number.isFinite(rank) || !Number.isFinite(bar)) return false;
  return rank >= bar;
}

/**
 * PURE. The show rule (mockup §2/§3).
 *   exceptions: show iff level ≥ threshold, OR something is urgent for the viewer (waiting-on-me,
 *               an active grant, a seal the viewer does not own, an active alert), OR the page has
 *               a workflow / validation state (those keep showing as before).
 *   always:     show whenever a classification level exists (right half empty when nothing is
 *               urgent), plus the same urgent triggers on an unclassified page; an unclassified
 *               page with nothing urgent ALSO shows, as "Unclassified" in the neutral grey block.
 */
export function decideRibbon(input = {}) {
  // CLS-1: classification OFF (`classification.enabled === false`) means the level cannot open
  // the row and "always" (= "always show the classification block") collapses to "exceptions":
  // the row is seal / workflow / validation only, and the surface draws no level block.
  const off = input.classification?.enabled === false;
  const mode = off ? "exceptions" : RIBBON_MODES.includes(input.mode) ? input.mode : DEFAULT_RIBBON_MODE;
  const threshold = input.threshold != null ? input.threshold : { rank: input.thresholdRank ?? DEFAULT_RIBBON_THRESHOLD_RANK };
  const classification = off ? { level: null, source: "none", enabled: false } : (input.classification || { level: null, source: "none" });
  const urgent = pickUrgent(input);
  const reasons = [];
  if (urgent) reasons.push(urgent.kind);
  if (input.workflow) reasons.push("workflow");
  if (input.validation) reasons.push("validation");
  const overThreshold = !off && meetsThreshold(classification, threshold);
  if (mode === "always") {
    reasons.unshift(classification.level ? "always" : "always-unclassified");
    return { show: true, mode, urgent, classification, reasons, overThreshold };
  }
  if (overThreshold) reasons.unshift("threshold");
  return { show: reasons.length > 0, mode, urgent, classification, reasons, overThreshold };
}

/** SEC-3: the ONE date formatter lives in status-language.js; this name stays for its callers. */
export const untilLabel = when;
