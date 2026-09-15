/*
 * Page details (5.0, mockup §4) — the PURE row-state rules, zero imports.
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
 *                        "granted"|"denied", myEditExpiresAt?, pendingRequests?: [] }
 * @param {object} [viewer] { canEditPage?: boolean }
 * @returns {{ kind: string, label?: string, until?: string|null, owner?: string|null,
 *             request?: object|null, disabled?: boolean, hint?: string }}
 */
export function primaryActionFor(row, viewer = {}) {
  if (!row || typeof row !== "object") return { kind: "none" };
  const pending = Array.isArray(row.pendingRequests) ? row.pendingRequests : [];
  if (row.kind === "attachment" && row.sealed === false) return { kind: "seal", label: "Seal" };
  if (row.isTrashed) return { kind: "trashed", label: "In the trash" };
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
    case "denied":
      return { kind: "request", label: "Request edit", disabled: true, hint: "Your last request was declined; you can ask again after 48 hours." };
    default:
      return { kind: "request", label: "Request edit" };
  }
}

/**
 * Everything that is NOT the primary action, in menu order. Extend is the owner's (attachment
 * seals only — sections have no extend resolver); Release moves here when Approve/Decline holds
 * the primary slot; Watch is for someone waiting on another person's attachment seal; Copy link
 * always; Force release only for a space admin who does not own the seal (typed reason, server-
 * side gate is unseal-artifact adminOverride / unseal-section reason).
 * @returns {string[]}  ids: "extend" | "release" | "watch" | "unwatch" | "copy-link" | "force-release"
 */
export function menuActionsFor(row, viewer = {}) {
  if (!row || typeof row !== "object") return [];
  const out = [];
  const primary = primaryActionFor(row, viewer);
  if (row.kind === "attachment" && row.sealed === false) return ["copy-link"];
  if (row.isMine) {
    if (row.kind === "attachment" && !row.isTrashed) out.push("extend");
    if (primary.kind !== "release" && !row.isTrashed) out.push("release");
  } else if (row.kind === "attachment" && !row.isTrashed) {
    out.push(row.watching ? "unwatch" : "watch");
  }
  out.push("copy-link");
  if (!row.isMine && viewer.isSpaceAdmin === true && !row.isTrashed) out.push("force-release");
  return out;
}

