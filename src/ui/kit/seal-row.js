/*
 * Seal rows in the browser surfaces (inline panel, overlay) — the glue between an attachment /
 * section payload and the ONE row-state rule in src/server/capsules/page-details/row-state.js
 * (`primaryActionFor` / `menuActionsFor`, mockup decision 5: Seal · Request edit · Waiting for
 * {owner} · Edit now until {time} · Release; everything else under ⋯).
 *
 * This file adds no second rule. What it adds is the two states row-state leaves to the
 * Attachments view ("restore it from the Attachments view"): a seal whose file is in the trash
 * (Restore, or the plain state when the policy hides Restore; Delete permanently under ⋯) and a
 * seal whose file is gone for good (Remove record). Both surfaces call these, so they cannot
 * disagree again — the review's "N copies of one rule" finding was exactly the panel and the
 * overlay computing Release from two different predicates.
 */
import { primaryActionFor, menuActionsFor } from "../../server/capsules/page-details/row-state.js";

export const MENU_LABEL = {
  extend: "Extend the seal",
  "give-access": "Give edit access…",
  release: "Release",
  watch: "Watch for release",
  unwatch: "Stop watching",
  "copy-link": "Copy link",
  "force-release": "Force release…",
  view: "View",
  properties: "Properties",
  delete: "Delete (send to trash)",
  purge: "Delete permanently",
};
const DANGER = new Set(["force-release", "delete", "purge", "release"]);

export const isSealedStatus = (s) => s === "HELD" || s === "HELD_BY_ACTOR";

/** Short, local "Mon 09:00"-style stamp for "until {time}". */
export function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * The row-state row for an attachment card.
 * @param {object} att  enumerate-page-seals / enumerate-doc-artifacts / enumerate-panel-artifacts item
 * @param {object} live  { editStatus, editExpiresAt, pendingRequests, watching }
 */
export function attachmentRow(att, live = {}) {
  const sealed = isSealedStatus(att.lockStatus);
  const trashed = att.isStale === true && att.staleReason === "trashed";
  return {
    kind: "attachment",
    id: att.id,
    name: att.title,
    sealed,
    isMine: att.lockStatus === "HELD_BY_ACTOR",
    isExpired: sealed && att.isExpired === true,
    isTrashed: trashed,
    isMissing: att.isStale === true && !trashed,
    ownerName: att.lockedByName || null,
    expiresAt: att.expiresAt || null,
    myEditStatus: live.editStatus || "none",
    myEditExpiresAt: live.editExpiresAt || null,
    myRetryAt: live.editRetryAt || null,
    pendingRequests: Array.isArray(live.pendingRequests) ? live.pendingRequests : [],
    watching: live.watching === true,
  };
}

/** The row-state row for a sealed section (enumerate-section-seals item). */
export function sectionRow(s, live = {}) {
  return {
    kind: "section",
    id: s.sectionId,
    name: s.sectionTitle,
    isMine: s.isMine === true,
    isExpired: s.isExpired === true,
    isTrashed: false,
    ownerName: s.lockedByName || null,
    expiresAt: s.expiresAt || null,
    myEditStatus: live.editStatus || "none",
    myEditExpiresAt: live.editExpiresAt || null,
    myRetryAt: live.editRetryAt || null,
    pendingRequests: Array.isArray(live.pendingRequests) ? live.pendingRequests : [],
  };
}

/**
 * Primary + menu for a row. `opts` carries what only the surface knows: the policy flags on the
 * payload and whether View/Properties links exist.
 * @returns {{ primary: object, menu: {id:string,label:string,danger:boolean,hint?:string}[] }}
 */
export function rowActions(row, viewer = {}, opts = {}) {
  const item = (id, extra = {}) => ({ id, label: MENU_LABEL[id] || id, danger: DANGER.has(id), ...extra });
  if (row.kind === "attachment" && row.isTrashed) {
    const primary = opts.allowRestore ? { kind: "restore", label: "Restore" } : { kind: "trashed", label: "In the trash" };
    const menu = [];
    if (opts.allowPurge) menu.push(item("purge"));
    menu.push(item("copy-link"));
    return { primary, menu };
  }
  if (row.kind === "attachment" && row.isMissing) {
    const primary = opts.allowPurge ? { kind: "purge", label: "Remove record" } : { kind: "missing", label: "Missing" };
    return { primary, menu: [] };
  }
  const primary = primaryActionFor(row, viewer);
  const ids = menuActionsFor(row, viewer);
  const menu = ids.map((id) => item(id));
  if (row.kind === "attachment") {
    if (opts.viewUrl) menu.push(item("view"));
    if (opts.propertiesUrl) menu.push(item("properties"));
    if (opts.allowDelete && (!row.sealed || row.isMine)) menu.push(item("delete"));
  }
  return { primary, menu };
}

/**
 * The state chip: class, visible text and the accessible sentence (review §7.2 — no chip may
 * be colour-only or unnamed).
 */
export function statusChip(att) {
  const sealed = isSealedStatus(att.lockStatus);
  const owner = att.lockedByName || "another user";
  const until = att.expiresAt ? `, until ${when(att.expiresAt)}` : "";
  if (att.isStale && att.staleReason === "trashed") return { cls: "trashed", text: "Trash", aria: `${att.title}: in the trash, still sealed` };
  if (att.isStale) return { cls: "stale", text: "Missing", aria: `${att.title}: the file is gone; its seal record remains` };
  if (att.isExpired && sealed) return { cls: "expired", text: "Overdue", aria: `${att.title}: seal overdue${att.expiresAt ? `, expired ${when(att.expiresAt)}` : ""}` };
  if (att.lockStatus === "HELD_BY_ACTOR") return { cls: "locked-by-me", text: "My Seal", aria: `${att.title}: sealed by you${until}` };
  if (sealed) return { cls: "locked", text: "Sealed", aria: `${att.title}: sealed by ${owner}${until}` };
  return { cls: "unlocked", text: "Available", aria: `${att.title}: available, not sealed` };
}

/** Copy a link, with the textarea fallback for iframes without clipboard permission. */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (_) {
    try {
      const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy"); document.body.removeChild(ta); return ok;
    } catch (__) { return false; }
  }
}
