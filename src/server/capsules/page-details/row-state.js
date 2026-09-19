/*
 * Page details (5.0, mockup §4) — the PURE row-state rules. One import: the SEC-3 vocabulary
 * (status-language.js, itself zero-import), so the words here and on every surface are one set.
 *
 * Shared by the server (logic.js re-exports it for the resolver and the unit test) and the
 * browser bundle (src/ui/surfaces/page-details imports it directly — no Forge import may sit
 * here, or webpack would drag @forge/api into the iframe). One rule, one place: the modal and
 * the resolver can never disagree about which button a row gets.
 */
/**
 * The five primary states of a seal row (mockup decision 5): Seal · Request edit ·
 * Waiting for {owner} · Edit now until {time} · Release — plus the two the mockup lists in
 * prose: the owner's inline Approve/Decline when someone is waiting on them, and the dead
 * states (expired for a non-owner, in the trash) where the only way forward is under ⋯.
 *
 * @param {object} row  { kind: "attachment"|"section", sealed?: boolean, isMine, isExpired,
 *                        isTrashed?, ownerName, expiresAt, myEditStatus: "none"|"pending"|
 *                        "granted"|"denied", myEditExpiresAt?, myRetryAt?, pendingRequests?: [] }
 * @param {object} [viewer] { canEditPage?: boolean }
 * @returns {{ kind: string, label?: string, until?: string|null, owner?: string|null,
 *             request?: object|null, disabled?: boolean, hint?: string }}
 */
import { WORDS } from "../../../ui/kit/status-language.js";
export const HELD_LABEL = WORDS.held;
export function primaryActionFor(row, viewer = {}, now = Date.now()) {
  if (!row || typeof row !== "object") return { kind: "none" };
  const pending = Array.isArray(row.pendingRequests) ? row.pendingRequests : [];
  if (row.kind === "attachment" && row.sealed === false) return { kind: "seal", label: "Seal" };
  if (row.isTrashed) return { kind: "trashed", label: "In the trash" };
  // SEC-2: while the page is Approved the seal belongs to the workflow — no personal action on the
  // row (release / request / approve); the state IS the primary, for owner and stranger alike.
  if (row.workflowHeld) return { kind: "held", label: HELD_LABEL, hint: "Changes go through the workflow: move the page back for review first." };
  if (row.isMine) {
    if (pending.length > 0) return { kind: "decide", label: "Approve", request: pending[0] };
    return { kind: "release", label: "Release" };
  }
  if (row.isExpired) {
    // An expired SECTION may be released by anyone who can edit the page (server rule F6);
    // an expired attachment seal is the owner's or a space admin's to clear (⋯ → Force release).
    if (row.kind === "section" && viewer.canEditPage === true) return { kind: "release", label: "Release" };
    return { kind: "expired", label: "Expired" };
  }
  switch (row.myEditStatus) {
    case "granted":
      return { kind: "editnow", label: "Edit now", until: row.myEditExpiresAt || row.expiresAt || null };
    case "pending":
      return { kind: "waiting", label: "Waiting", owner: row.ownerName || null };
    case "denied": {
      // SEC-8: the declined state is VISIBLE — a state span ("Declined · ask again W"), never a
      // disabled button with a tooltip. The wait is the site's setting, so `retryAt` is the time
      // the server gave; once it has passed the row offers Request edit again. The surface
      // formats the clock (status-language `stateText`) — this file composes no dates.
      const retryMs = row.myRetryAt ? new Date(row.myRetryAt).getTime() : NaN;
      if (Number.isFinite(retryMs) && retryMs > now) return { kind: "declined", label: WORDS.declined, retryAt: row.myRetryAt, reason: row.myDeniedReason || null, hint: "The owner can also give you access directly." };
      return { kind: "request", label: "Request edit" };
    }
    default:
      return { kind: "request", label: "Request edit" };
  }
}

/**
 * SEC-7 (UX critique 2026-09-19): the owner never chose the space default, and the seal used to
 * stop silently. The owner's row says "expires in 2 days" in amber inside this window, so the
 * lapse is seen before it happens. PURE: { text, hours } or null.
 */
export const EXPIRY_WARNING_MS = 3 * 24 * 3600 * 1000;
export function expiryWarning(row, now = Date.now()) {
  if (!row || !row.isMine || row.isTrashed || !row.expiresAt) return null;
  const ms = new Date(row.expiresAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0 || ms > EXPIRY_WARNING_MS) return null;
  const hours = Math.ceil(ms / 3600000);
  const text = hours >= 48 ? `expires in ${Math.round(hours / 24)} days` : hours >= 24 ? "expires tomorrow" : hours > 1 ? `expires in ${hours} hours` : "expires within the hour";
  return { text, hours };
}

/**
 * Everything that is NOT the primary action, in menu order. Extend is the owner's (attachment
 * and section seals — SEC-7); Release moves here when Approve/Decline holds
 * the primary slot; Watch is for someone waiting on another person's attachment seal; Copy link
 * always; Force release only for a space admin who does not own the seal (typed reason, server-
 * side gate is unseal-artifact adminOverride / unseal-section reason).
 * @returns {string[]}  ids: "extend" | "give-access" | "release" | "watch" | "unwatch" | "copy-link" | "force-release"
 */
export function menuActionsFor(row, viewer = {}) {
  if (!row || typeof row !== "object") return [];
  const out = [];
  const primary = primaryActionFor(row, viewer);
  if (row.kind === "attachment" && row.sealed === false) return ["copy-link"];
  // SEC-2: a held seal offers no Extend / Give access / Release / Watch; a space admin keeps the
  // break-glass Force release (typed reason) — the one door out.
  if (row.workflowHeld) return viewer.isSpaceAdmin === true && !row.isTrashed ? ["copy-link", "force-release"] : ["copy-link"];
  if (row.isMine) {
    // SEC-7: sections extend too (extend-section mirrors extend-seal, grants carried forward).
    if (!row.isTrashed) out.push("extend");
    // Give edit access to a named person without waiting for their request (tester report
    // 2026-09-17). Not on an expired seal: the grant would be born dead (server rule it54).
    if (!row.isTrashed && !row.isExpired) out.push("give-access");
    if (primary.kind !== "release" && !row.isTrashed) out.push("release");
  } else if (row.kind === "attachment" && !row.isTrashed) {
    out.push(row.watching ? "unwatch" : "watch");
  }
  out.push("copy-link");
  if (!row.isMine && viewer.isSpaceAdmin === true && !row.isTrashed && !row.isExpired) out.push("give-access");
  if (!row.isMine && viewer.isSpaceAdmin === true && !row.isTrashed) out.push("force-release");
  return out;
}

