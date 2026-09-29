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
  { id: "editNow", title: "You can edit now", note: "Your edit access runs out at the time shown on each" },
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
    // A grant is frozen while the page is Approved (the seal is the workflow's) — not "edit now".
    const live = !f.workflowHeld && s && s.status === "granted" && !(Number.isFinite(until) && until <= now);
    (live ? out.editNow : out.others).push(f);
  }
  return out;
}

/**
 * PURE. The same three groups for sealed SECTIONS (enumerate-section-seals items: `isMine`,
 * `sectionId`). `statusById` is keyed by sectionId from check-section-edit, whose "granted" is
 * already a live grant (the server only answers granted for one that has not run out).
 */
export function groupSealedSections(sections, statusById = {}) {
  const out = { mine: [], editNow: [], others: [] };
  for (const s of Array.isArray(sections) ? sections : []) {
    if (!s) continue;
    if (s.isMine) out.mine.push(s);
    else if (!s.workflowHeld && statusById[s.sectionId]?.status === "granted") out.editNow.push(s);
    else out.others.push(s);
  }
  return out;
}

/** How many items a group shows before "Show more" — 5 (owner, 2026-09-29: 15 made the macro massive). */
export const GROUP_LIMIT = 5;

/**
 * PURE. A group's window: the first `shown` items, plus what the footer offers next —
 * "Show {more} more", "Show all {total}" (only when more than one step remains) and "Show fewer".
 */
export function groupWindow(items, shown, step = GROUP_LIMIT) {
  const list = Array.isArray(items) ? items : [];
  const n = Math.max(step, Math.min(list.length, shown || step));
  const hidden = Math.max(0, list.length - n);
  return {
    visible: list.slice(0, n),
    hidden,
    more: Math.min(step, hidden),
    canAll: hidden > step,
    canFewer: n > step,
  };
}

/** PURE. The items a group shows, and how many are folded away. */
export function capItems(items, expanded, limit = GROUP_LIMIT) {
  const list = Array.isArray(items) ? items : [];
  const hidden = Math.max(0, list.length - limit);
  return { visible: expanded || hidden === 0 ? list : list.slice(0, limit), hidden };
}
