/*
 * Sealed attachments grouped by what the VIEWER can do with them (tester ticket 2026-09-24:
 * "29+ sealed files mixed together in one grid, regardless of who sealed them or what I may do").
 * Zero imports: both surfaces (inline panel, Manage Attachments overlay) and the unit test call
 * this, so the two lists can never group differently.
 *
 * Order, from the ticket:
 *   mine     — sealed by you (Release, your editors)
 *   editNow  — sealed by someone else, and you hold live edit access (Edit now · until …)
 *   others   — sealed by someone else, no edit access: Request edit, or the state that replaces it
 *              (Waiting for {owner}, Declined · ask again …, Expired, Locked by the approval)
 */

export const SEALED_GROUPS = Object.freeze([
  { id: "mine", title: "Sealed by you", note: "Release them, or manage who can edit" },
  { id: "editNow", title: "You can edit now", note: "Your edit access runs out at the time on each file" },
  { id: "others", title: "Sealed by others", note: "Request edit to change one of these" },
]);

/**
 * PURE.
 * @param {object[]} files     sealed, non-stale attachment items (lockStatus HELD | HELD_BY_ACTOR)
 * @param {object} statusById  { [attachmentId]: { status, expiresAt } } from check-edit-request
 * @param {number} now
 * @returns {{ mine: object[], editNow: object[], others: object[] }} input order kept in each group
 */
export function groupSealedFiles(files, statusById = {}, now = Date.now()) {
  const out = { mine: [], editNow: [], others: [] };
  for (const f of Array.isArray(files) ? files : []) {
    if (!f) continue;
    if (f.lockStatus === "HELD_BY_ACTOR") { out.mine.push(f); continue; }
    const s = statusById[f.id];
    const until = s && s.expiresAt ? new Date(s.expiresAt).getTime() : NaN;
    // A grant whose end has already passed is not "edit now" (the server stops honouring it).
    const live = s && s.status === "granted" && !(Number.isFinite(until) && until <= now);
    (live ? out.editNow : out.others).push(f);
  }
  return out;
}
