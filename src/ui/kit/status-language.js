/*
 * SEC-3 (UX critique 2026-09-19) — ONE status language for every surface that names a seal's
 * state: the section macro badge, the panel / overlay / page-details rows, the ribbon pill and
 * sentence, the byline chip, My work, and the refusal sentences the server sends back.
 *
 * Before this file the same page said, in one session: "Sealed by Mihai Perdum" (badge), "until
 * Sep 22, 2026, 10:57 PM" (panel), "Sealed by you · until Tue 10:57 PM" (modal), "Locked ·
 * Decisions is sealed by Gabriela Perdum until Tue 23:13" (ribbon, 24-h clock), "Overdue" (My
 * work) next to "Expired" (rows), "unlock" (My work copy) next to "release" (buttons) and "unseal"
 * (refusals), and a declined request with no visible word at all. Four date formatters
 * (`untilLabel`, `when` ×2, `renderLapseDate`, `fmtUntil`) disagreed on the clock.
 *
 * Zero imports and node-importable (test/status-language.test.mjs), like ribbon-rules.js and
 * page-details/row-state.js — the server bundle imports it too (row-state, the refusal copy), so
 * NOTHING in here may touch @forge/*, the DOM or a locale-dependent default other than the
 * viewer's own (`undefined` locale = the browser's; the lambda passes "en-GB" explicitly).
 *
 * The vocabulary (one word per state, one verb pair):
 *   Seal / Release            the verb pair everywhere — never unlock / unseal in anything a user reads
 *   Sealed by you · until W   the owner's row / badge
 *   Locked by {name} · until W   everyone else's row / badge / ribbon sentence
 *   Locked by the approval of this page   a seal the workflow holds (SEC-2) — the exact server sentence
 *   Waiting for {name}        the viewer's own pending request
 *   Waiting for you (N)       the owner's inbox / the approver's queue (ribbon pill)
 *   Edit now · until W        the viewer's active grant
 *   Declined · ask again W    the viewer's declined request, until the cooldown passes (SEC-8)
 *   Expired                   a lapsed seal — never "Overdue" (that word stays for a workflow REVIEW)
 *   Undone / Moved back       the editor's alert — "Restored" was the app's point of view, not theirs
 *   Sealed (N)                the byline's seal count
 */

const WEEK_MS = 7 * 24 * 3600 * 1000;

/**
 * PURE. THE date formatter. "Tue 23:13" inside the coming/past week, "22 Sep 22:57" beyond it,
 * "22 Sep 2027 22:57" in another year; 24-hour clock always; "" for nothing / garbage.
 */
export function when(iso, now = Date.now(), locale = undefined) {
  const ms = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
  if (Math.abs(ms - now) < WEEK_MS) return `${d.toLocaleDateString(locale, { weekday: "short" })} ${time}`;
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const day = d.toLocaleDateString(locale, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
  return `${day} ${time}`;
}

/** PURE. A calendar day with no clock — "22 Sep 2026" — for dates that are days, not instants. */
export function whenDay(iso, locale = undefined, { utc = false } = {}) {
  const ms = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", ...(utc ? { timeZone: "UTC" } : {}) });
}

export const WORDS = Object.freeze({
  seal: "Seal",
  release: "Release",
  forceRelease: "Force release",
  expired: "Expired",
  editNow: "Edit now",
  declined: "Declined",
  waitingForYou: "Waiting for you",
  undone: "Undone",
  movedBack: "Moved back",
  held: "Locked by the approval of this page",
  propose: "Propose a change",
  heldReason: "Locked by the approval of this page — changes go through the workflow",
  inTrash: "In the trash",
  missing: "Missing",
  available: "Available",
});

/** PURE. "Sealed by you" / "Locked by {name}" — who holds it, from the viewer's seat. */
export function holderLabel({ isMine, ownerName, workflowHeld } = {}) {
  if (workflowHeld) return WORDS.held;
  return isMine ? "Sealed by you" : `Locked by ${ownerName || "another user"}`;
}

/**
 * PURE. The state sentence under a row's name / on the macro badge:
 *   "Sealed by you · until Tue 23:13" · "Locked by Gabriela Perdum · until 22 Sep 22:57" ·
 *   "Sealed by you · expired Tue 23:13" · "Locked by the approval of this page · expiry paused" ·
 *   "Sealed by you · no expiry" · "Sealed by you · in the trash"
 * @param {{ isMine, ownerName, workflowHeld, isExpired, expiresAt, isTrashed }} row
 */
export function sealSentence(row = {}, now = Date.now(), locale = undefined) {
  const who = holderLabel(row);
  if (row.isTrashed) return `${who} · in the trash`;
  if (row.workflowHeld) return `${who} · expiry paused`;
  if (!row.expiresAt) return `${who} · no expiry`;
  const w = when(row.expiresAt, now, locale);
  return row.isExpired ? `${who} · expired ${w}` : `${who} · until ${w}`;
}

/**
 * PURE. The visible words for a row-state primary that is a STATE (not a button).
 * Buttons keep their own labels (Seal / Release / Request edit / Approve / Decline).
 */
export function stateText(primary, now = Date.now(), locale = undefined) {
  if (!primary) return "";
  switch (primary.kind) {
    case "waiting": return `Waiting for ${primary.owner || "the owner"}`;
    case "editnow": return primary.until ? `${WORDS.editNow} · until ${when(primary.until, now, locale)}` : WORDS.editNow;
    case "declined": return primary.retryAt ? `${WORDS.declined} · ask again ${when(primary.retryAt, now, locale)}` : WORDS.declined;
    case "expired": return WORDS.expired;
    case "held": return WORDS.held;
    case "trashed": return WORDS.inTrash;
    case "missing": return WORDS.missing;
    default: return primary.label || "";
  }
}

/** PURE. The ribbon's alert word for a dispatch type — the EDITOR's point of view. */
export function alertWord(type) {
  return type === "workflow-demoted" ? WORDS.movedBack : WORDS.undone;
}

/** PURE. "Sealed (2)" for the byline title; "" for none. */
export function sealCountLabel(n) {
  const k = Number.isFinite(Number(n)) && Number(n) > 0 ? Math.floor(Number(n)) : 0;
  return k > 0 ? `Sealed (${k})` : "";
}

/**
 * PURE. The status chip on an attachment card (panel / overlay / space console):
 * class is what the CSS knows; text is the one vocabulary; aria is the full sentence.
 * @param {{ title, lockStatus, lockedByName, expiresAt, isExpired, isStale, staleReason }} att
 */
export function attachmentChip(att = {}, now = Date.now(), locale = undefined) {
  const sealed = att.lockStatus === "HELD" || att.lockStatus === "HELD_BY_ACTOR";
  const mine = att.lockStatus === "HELD_BY_ACTOR";
  const name = att.title || "this file";
  const w = att.expiresAt ? when(att.expiresAt, now, locale) : "";
  if (att.isStale && att.staleReason === "trashed") return { cls: "trashed", text: "Trash", aria: `${name}: in the trash, still sealed` };
  if (att.isStale) return { cls: "stale", text: WORDS.missing, aria: `${name}: the file is gone; its seal record remains` };
  if (att.isExpired && sealed) return { cls: "expired", text: WORDS.expired, aria: `${name}: seal expired${w ? ` ${w}` : ""}` };
  if (mine) return { cls: "locked-by-me", text: "Sealed by you", aria: `${name}: sealed by you${w ? `, until ${w}` : ""}` };
  if (sealed) return { cls: "locked", text: "Sealed", aria: `${name}: sealed by ${att.lockedByName || "another user"}${w ? `, until ${w}` : ""}` };
  return { cls: "unlocked", text: WORDS.available, aria: `${name}: available, not sealed` };
}

/**
 * PURE. The refusal a declined requester gets from the server (edit requests, ribbon ask bar).
 * The server never formats a clock (the lambda runs in UTC — a "20:19 UTC" reached a human in the
 * critique); it sends `retryAt` and the SURFACE composes the sentence in the viewer's zone.
 */
export const DECLINED_REASON = "Your last request was declined. The owner can also give you access directly.";
export function refusalText(r, now = Date.now(), locale = undefined) {
  if (!r || typeof r !== "object") return "";
  const reason = r.reason || "";
  if (!r.retryAt) return reason;
  const w = when(r.retryAt, now, locale);
  return w ? `${reason} You can ask again ${w}.` : reason;
}
