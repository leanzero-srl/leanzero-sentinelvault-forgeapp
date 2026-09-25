// A1 — Document Activity: ONE formatter for every activity entry, shared by the three surfaces
// (inline panel group, overlay section, realm-console report + CSV). The `type` strings are the
// contract fixed in A1-DESIGN.md and mirrored by `ACTIVITY_TYPES` in
// src/server/infra/activity-log.js; `test/activity-format.test.mjs` pins that every one of them
// yields a sentence, so a new type cannot ship half-labelled.
//
// Entry shape (server-owned, never invented here):
//   { id, ts, type, pageId, spaceKey, actor: { accountId|null, name|null },
//     target: { kind: "attachment"|"section"|"page", id, name }, details: {...}, version }
// A null actor means Sentinel Vault itself did it (a sweep or trigger), and the sentence says so.
//
// Copy rules: Confluence-native words only (space, page, file, section, group) — never realm /
// guild / artifact / operator in anything a user reads.

/** Report filter chips, in display order. `types` is what the server-side `types` filter takes. */
export const ACTIVITY_CATEGORIES = Object.freeze([
  { id: "seals", label: "Seals", types: Object.freeze([
    "seal.created", "seal.released", "seal.forced", "seal.extended", "seal.auto-released",
    "seal.edit-reverted", "seal.trash-restored", "seal.embed-restored", "seal.presentation-restored",
    "seal.deleted", "seal.revert-failed",
  ]) },
  { id: "sections", label: "Sections", types: Object.freeze([
    "section.sealed", "section.released", "section.extended", "section.restored", "section.reverted", "section.rebaselined", "section.auto-released",
  ]) },
  { id: "editreq", label: "Edit access", types: Object.freeze([
    "editreq.requested", "editreq.approved", "editreq.denied", "editreq.revoked", "editreq.granted",
  ]) },
  { id: "workflow", label: "Workflow", types: Object.freeze([
    "workflow.transition", "workflow.approval-requested", "workflow.approval-rerequested", "workflow.approval-decided",
    "workflow.enforced", "workflow.expired", "workflow.review-due", "workflow.read-confirmed", "workflow.seals-held", "workflow.seals-released",
  ]) },
  { id: "validation", label: "Validation", types: Object.freeze([
    "validation.reverted", "validation.gate",
  ]) },
]);

/** Every known type, flat, in category order. */
export const ACTIVITY_TYPES = Object.freeze(ACTIVITY_CATEGORIES.flatMap((c) => c.types));

const CATEGORY_BY_TYPE = Object.freeze(Object.fromEntries(
  ACTIVITY_CATEGORIES.flatMap((c) => c.types.map((t) => [t, c.id])),
));

/** Category id for a type; a type nobody registered lands in the nearest prefix or "other". */
export function categoryOf(type) {
  if (CATEGORY_BY_TYPE[type]) return CATEGORY_BY_TYPE[type];
  const prefix = String(type || "").split(".")[0];
  const hit = ACTIVITY_CATEGORIES.find((c) => c.types.some((t) => t.startsWith(`${prefix}.`)));
  return hit ? hit.id : "other";
}

export const categoryLabel = (id) => ACTIVITY_CATEGORIES.find((c) => c.id === id)?.label || "Other";

// ── Small helpers ────────────────────────────────────

const APP_NAME = "Sentinel Vault";

const actorName = (entry) => {
  const a = entry?.actor;
  if (a?.name) return a.name;
  if (a?.accountId) return "Someone";
  return APP_NAME;
};

const targetName = (entry, fallback) => {
  const t = entry?.target;
  if (t?.name) return t.name;
  if (fallback) return fallback;
  if (t?.kind === "attachment") return "a file";
  if (t?.kind === "section") return "a section";
  return "this page";
};

const scopeWord = (entry) => {
  const scope = entry?.details?.scope || entry?.target?.kind;
  if (scope === "section") return "section";
  if (scope === "attachment") return "file";
  return "page";
};

// A short, human date for a sentence: "Sep 12, 2026 14:30" — local time, no seconds.
export function formatAbsolute(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Date only: "Sep 12, 2026". Review dates are UTC end-of-day instants (A5), so a calendar day is
// read in UTC — the local zone would show the next morning to anyone east of the picker.
export function formatDay(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * "just now" / "5m ago" / "3h ago" / "2d ago" / "3w ago", then the plain date once it is older than
 * ~2 months (a relative "9mo ago" hides the year, which is what a compliance reader needs). Future
 * timestamps (clock skew) read "in 2m" rather than a negative number.
 */
export function relativeTime(iso, nowMs = Date.now()) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return String(iso);
  const diff = nowMs - t;
  const abs = Math.abs(diff);
  const sec = Math.round(abs / 1000);
  const min = Math.round(abs / 60000);
  const hr = Math.round(abs / 3600000);
  const day = Math.round(abs / 86400000);
  const wk = Math.round(abs / (7 * 86400000));
  let unit;
  if (sec < 45) return "just now";
  else if (min < 60) unit = `${min}m`;
  else if (hr < 24) unit = `${hr}h`;
  else if (day < 7) unit = `${day}d`;
  else if (wk < 9) unit = `${wk}w`;
  else return formatDay(iso);
  return diff >= 0 ? `${unit} ago` : `in ${unit}`;
}

const joinLabels = (arr) => (Array.isArray(arr) ? arr.filter(Boolean).map(String) : []).join(", ");
const q = (s) => `“${s}”`; // curly quotes around a section title

// ── The formatter ────────────────────────────────────

/**
 * @returns {{ sentence: string, label: string, glyph: string, tone: string, category: string, detail: string }}
 *   sentence — one line a naive reader understands, with names filled in
 *   label    — the short event name for a table / chip ("Seal extended")
 *   glyph    — icon key rendered by ActivityFeed (lock, unlock, clock, undo, trash, image, layout,
 *              section, key, check, cross, arrow, shield, alert, hourglass)
 *   tone     — seal | positive | caution | critical | info | neutral
 *   category — one of ACTIVITY_CATEGORIES ids
 *   detail   — the type-specific extra ("until Sep 12, 2026", "Draft → Approved"), may be ""
 */
export function formatActivity(entry) {
  const type = entry?.type || "";
  const d = entry?.details || {};
  const who = actorName(entry);
  const file = () => targetName(entry, null);
  const section = () => q(targetName(entry, "untitled section"));
  const version = typeof entry?.version === "number" ? ` (v${entry.version})` : "";
  const base = { category: categoryOf(type), detail: "" };

  switch (type) {
    // ── Seals (files) ──
    case "seal.created":
      return { ...base, label: "File sealed", glyph: "lock", tone: "seal",
        sentence: `${who} sealed ${file()}`,
        detail: d.expiresAt ? `until ${formatAbsolute(d.expiresAt)}` : "" };
    case "seal.released":
      return { ...base, label: "File unsealed", glyph: "unlock", tone: "neutral",
        sentence: `${who} unsealed ${file()}` };
    case "seal.forced":
      return { ...base, label: "Seal removed by space admin", glyph: "unlock", tone: "caution",
        sentence: `${who} removed the seal on ${file()} as a space admin`,
        detail: [d.ownerName ? `sealed by ${d.ownerName}` : "", d.reason ? `reason: ${d.reason}` : ""].filter(Boolean).join(" — ") };
    case "seal.extended":
      return { ...base, label: "Seal extended", glyph: "clock", tone: "seal",
        sentence: d.expiresAt
          ? `Seal on ${file()} extended to ${formatAbsolute(d.expiresAt)} by ${who}`
          : `Seal on ${file()} extended by ${who}`,
        detail: d.expiresAt ? `until ${formatAbsolute(d.expiresAt)}` : "" };
    case "seal.auto-released":
      return { ...base, label: "Seal lapsed", glyph: "hourglass", tone: "neutral",
        sentence: `Seal on ${file()} lapsed and was released automatically`,
        detail: d.reason ? String(d.reason) : "" };
    case "seal.edit-reverted":
      return { ...base, label: "Change reverted", glyph: "undo", tone: "caution",
        sentence: d.editorName || d.editor
          ? `${d.editorName || d.editor} changed sealed file ${file()} — ${APP_NAME} put the sealed version back`
          : `Sealed file ${file()} was changed — ${APP_NAME} put the sealed version back`,
        detail: d.restoredTo != null ? `restored v${d.restoredTo}` : "" };
    case "seal.trash-restored":
      return { ...base, label: "Restored from trash", glyph: "trash", tone: "caution",
        sentence: `Sealed file ${file()} was moved to the trash — ${APP_NAME} restored it` };
    case "seal.embed-restored":
      return { ...base, label: "Embed restored", glyph: "image", tone: "caution",
        sentence: `Sealed file ${file()} was removed from the page — ${APP_NAME} put it back` };
    case "seal.presentation-restored":
      return { ...base, label: "Display restored", glyph: "layout", tone: "caution",
        sentence: `The way sealed file ${file()} is shown on the page was changed — ${APP_NAME} restored it` };
    case "seal.deleted":
      return { ...base, label: "Sealed file deleted", glyph: "trash", tone: "critical",
        sentence: `Sealed file ${file()} was permanently deleted, so its seal record was cleared` };
    case "seal.revert-failed":
      return { ...base, label: "Restore failed", glyph: "alert", tone: "critical",
        sentence: `${APP_NAME} could not put the sealed version of ${file()} back after a change — check the file`,
        detail: d.error ? String(d.error) : "" };

    // ── Sections (page content) ──
    case "section.extended":
      return { ...base, label: "Section seal extended", glyph: "clock", tone: "seal",
        sentence: d.expiresAt
          ? `Seal on section “${targetName(entry, "Sealed section")}” extended to ${formatAbsolute(d.expiresAt)} by ${who}`
          : `Seal on section “${targetName(entry, "Sealed section")}” extended by ${who}`,
        detail: d.expiresAt ? `until ${formatAbsolute(d.expiresAt)}` : "" };
    case "section.sealed":
      return { ...base, label: "Section sealed", glyph: "section", tone: "seal",
        sentence: `${who} sealed section ${section()}` };
    case "section.released":
      // Break-glass (3.5): a release by someone other than the owner always carries a typed
      // reason and reads as a forced release, never as an ordinary unseal.
      if (d.forced) {
        return { ...base, label: "Section released by space admin", glyph: "unlock", tone: "caution",
          sentence: `${who} released sealed section ${section()} without owning it`,
          detail: d.reason ? `reason: ${d.reason}` : "" };
      }
      return { ...base, label: "Section unsealed", glyph: "unlock", tone: "neutral",
        sentence: `${who} unsealed section ${section()}` };
    case "section.auto-released":
      return { ...base, label: "Section seal lapsed", glyph: "hourglass", tone: "neutral",
        sentence: `Seal on section ${section()} lapsed and was released automatically`,
        detail: d.reason ? String(d.reason) : "" };
    case "section.rebaselined": {
      const diff = d.diff || {};
      const parts = [];
      if (diff.changedBlocks) parts.push(`${diff.changedBlocks} changed`);
      if (diff.added) parts.push(`${diff.added} added`);
      if (diff.removed) parts.push(`${diff.removed} removed`);
      return { ...base, label: "Section re-sealed", glyph: "section", tone: "seal",
        sentence: `${who} edited sealed section ${section()} as ${d.by === "grantee" ? "an approved editor" : "the owner"} — the seal now protects the new content${version}`,
        detail: [parts.length ? `blocks: ${parts.join(", ")}` : "", diff.sample ? `“${diff.sample}”` : ""].filter(Boolean).join(" — ") };
    }
    case "section.restored":
      return { ...base, label: "Section restored", glyph: "undo", tone: "caution",
        sentence: `Sealed section ${section()} was edited — ${APP_NAME} put its content back${version}` };
    case "section.reverted":
      return { ...base, label: "Page reverted", glyph: "undo", tone: "caution",
        sentence: `Sealed section ${section()} was edited — ${APP_NAME} reverted the page to the sealed version${version}` };

    // ── Edit access ──
    case "editreq.requested":
      return { ...base, label: "Edit access requested", glyph: "key", tone: "info",
        sentence: `${who} asked for edit access to ${scopeWord(entry)} ${entry?.target?.kind === "section" ? section() : file()}`,
        detail: d.reason ? `Reason: “${String(d.reason)}”` : "" };
    case "editreq.approved":
      return { ...base, label: "Edit access approved", glyph: "check", tone: "positive",
        sentence: `${who} approved edit access to ${scopeWord(entry)} ${entry?.target?.kind === "section" ? section() : file()}${d.requesterName ? ` for ${d.requesterName}` : ""}` };
    case "editreq.denied":
      return { ...base, label: "Edit access denied", glyph: "cross", tone: "critical",
        sentence: `${who} denied edit access to ${scopeWord(entry)} ${entry?.target?.kind === "section" ? section() : file()}${d.requesterName ? ` for ${d.requesterName}` : ""}`,
        detail: d.reason ? `Reason: “${String(d.reason)}”` : "" };
    case "editreq.granted":
      return { ...base, label: "Edit access given", glyph: "key", tone: "positive",
        sentence: `${who} gave ${d.editorName || "someone"} edit access to ${scopeWord(entry)} ${entry?.target?.kind === "section" ? section() : file()}` };
    case "editreq.revoked":
      return { ...base, label: "Edit access revoked", glyph: "cross", tone: "caution",
        sentence: `${who} revoked edit access to ${scopeWord(entry)} ${entry?.target?.kind === "section" ? section() : file()}${d.editorName ? ` from ${d.editorName}` : ""}` };

    // ── Workflow ──
    case "workflow.transition": {
      const from = d.fromName || d.from;
      const to = d.toName || d.to || "a new state";
      return { ...base, label: "State changed", glyph: "arrow", tone: "info",
        sentence: from ? `${who} moved the page from ${from} to ${to}` : `${who} moved the page to ${to}`,
        detail: [from && to ? `${from} → ${to}` : "", d.reason ? String(d.reason) : ""].filter(Boolean).join(" · ") };
    }
    case "workflow.approval-requested": {
      const n = Array.isArray(d.approvers) ? d.approvers.length : 0;
      const mode = d.mode === "any" ? "any one" : d.mode === "min" && d.min ? `at least ${d.min}` : d.mode === "all" ? "all" : "";
      return { ...base, label: "Approval requested", glyph: "shield", tone: "info",
        sentence: `${who} asked for approval to move the page to ${d.toName || d.to || "the next state"}`,
        detail: [n ? `${n} approver${n === 1 ? "" : "s"}` : "", mode ? `${mode} must approve` : "", d.pinnedVersion != null ? `v${d.pinnedVersion}` : ""].filter(Boolean).join(" · ") };
    }
    case "workflow.approval-rerequested": {
      return { ...base, label: "Approval re-requested", glyph: "shield", tone: "info",
        sentence: `${who} re-requested approval to move the page to ${d.toName || d.to || "the next state"} for the current version`,
        detail: [d.fromVersion != null && d.pinnedVersion != null ? `v${d.fromVersion} → v${d.pinnedVersion}` : d.pinnedVersion != null ? `v${d.pinnedVersion}` : ""].filter(Boolean).join(" · ") };
    }
    case "workflow.approval-decided": {
      const approved = d.decision === "approved" || d.decision === "approve";
      const v = d.versionAtDecision != null ? ` (v${d.versionAtDecision})` : "";
      const to = d.toName || d.to;
      // "Approved" alone reads as the PAGE being approved; this row is one approver's vote, and the
      // outcome may still be pending (details.outcome says so).
      return { ...base, label: approved ? "Approval given" : "Approval denied", glyph: approved ? "check" : "cross", tone: approved ? "positive" : "critical",
        sentence: `${who} ${approved ? "approved" : "denied"} moving to ${to || "the requested state"}${v}`,
        detail: [d.outcome ? `outcome: ${d.outcome}` : "", d.reason ? String(d.reason) : ""].filter(Boolean).join(" · ") };
    }
    case "workflow.enforced": {
      const editor = d.editorName || d.editor;
      const byWho = editor ? `${editor} edited` : "Someone edited";
      return d.mode === "revert"
        ? { ...base, label: "Approved page restored", glyph: "undo", tone: "caution",
            sentence: d.reconciled === "baseline-advanced"
              ? `${byWho} the Approved page with no content change — ${APP_NAME} kept it and advanced the approved baseline${d.driftedVersion != null ? ` to v${d.driftedVersion}` : ""}`
              : `${byWho} the Approved page — ${APP_NAME} restored the approved version${d.restoredTo != null ? ` (v${d.restoredTo})` : ""}` }
        : { ...base, label: `Moved back to ${d.demotedToName || "Draft"}`, glyph: "arrow", tone: "caution",
            // A2: the target is the space's configured demote state, named on the row; "Draft" is
            // only the fallback for rows written before the setting existed.
            sentence: `${byWho} the Approved page — it was moved back to ${d.demotedToName || "Draft"} for a new review`,
            detail: [d.approvedVersion != null ? `approved v${d.approvedVersion}` : "", d.driftedVersion != null ? `edited v${d.driftedVersion}` : ""].filter(Boolean).join(" · ") };
    }
    case "workflow.seals-held":
      return { ...base, label: "Seals held by the approval", glyph: "lock", tone: "seal",
        sentence: `The page entered ${d.stateName || "Approved"} — its ${[d.sections ? `${d.sections} sealed section${d.sections === 1 ? "" : "s"}` : "", d.attachments ? `${d.attachments} sealed file${d.attachments === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ") || "seals"} now ${(Number(d.sections) || 0) + (Number(d.attachments) || 0) === 1 ? "belongs" : "belong"} to the approval (expiry paused, changes go through the workflow)`,
        detail: Array.isArray(d.names) && d.names.length ? d.names.join(" · ") : "" };
    case "workflow.seals-released":
      return { ...base, label: "Seals handed back", glyph: "unlock", tone: "neutral",
        sentence: `The page left the approved state${d.toStateName ? ` for ${d.toStateName}` : ""} — its ${[d.sections ? `${d.sections} sealed section${d.sections === 1 ? "" : "s"}` : "", d.attachments ? `${d.attachments} sealed file${d.attachments === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ") || "seals"} went back to ${(Number(d.sections) || 0) + (Number(d.attachments) || 0) === 1 ? "its owner" : "their owners"} with the time ${(Number(d.sections) || 0) + (Number(d.attachments) || 0) === 1 ? "it" : "they"} had left`,
        detail: Array.isArray(d.names) && d.names.length ? d.names.join(" · ") : "" };
    case "workflow.expired":
      // A5: a page can be overdue without moving — its state has no transition to Expired.
      return d.noTransition
        ? { ...base, label: "Review overdue", glyph: "hourglass", tone: "caution",
            sentence: `The review date on this page has passed — it is overdue for a new review${d.fromName ? ` (still ${d.fromName})` : ""}`,
            detail: d.reviewDueAt ? `due ${formatDay(d.reviewDueAt)}` : "" }
        : { ...base, label: "Approval expired", glyph: "hourglass", tone: "caution",
            sentence: "The approval on this page expired — it was moved to Expired and needs a new review" };
    case "workflow.review-due":
      return { ...base, label: d.to ? "Review date set" : "Review date cleared", glyph: "clock", tone: "info",
        sentence: d.to ? `${who} set the review date to ${formatAbsolute(d.to)}` : `${who} cleared the review date`,
        detail: [d.from ? `was ${formatAbsolute(d.from)}` : "", d.reason ? String(d.reason) : ""].filter(Boolean).join(" · ") };

    case "workflow.read-confirmed":
      return { ...base, label: "Read confirmed", glyph: "check", tone: "info",
        sentence: `${who} confirmed reading ${d.version != null ? `version ${d.version} of ` : ""}this page`,
        detail: "" };

    // ── Validation ──
    case "validation.reverted": {
      const v = joinLabels(d.violations);
      return { ...base, label: "Validation revert", glyph: "undo", tone: "critical",
        sentence: `The page failed validation${v ? ` (${v})` : ""} — ${APP_NAME} restored the last version that passed${d.restoredTo != null ? ` (v${d.restoredTo})` : ""}`,
        detail: v };
    }
    case "validation.gate": {
      const passed = d.state === "passed";
      const v = joinLabels(d.violations);
      if (d.approved) {
        return { ...base, label: "Validation approved", glyph: "check", tone: "positive",
          sentence: `${who} approved the page despite the validation rules${version}` };
      }
      const how = d.source === "recheck" ? " on a re-check" : "";
      return { ...base, label: passed ? "Validation passed" : "Validation failed", glyph: passed ? "check" : "alert", tone: passed ? "positive" : "critical",
        sentence: passed ? `The page passed validation${how}${version}` : `The page failed validation${how}${v ? `: ${v}` : ""}${version}`,
        detail: v };
    }

    default:
      return { ...base, label: type || "Activity", glyph: "dot", tone: "neutral",
        sentence: `${who} — ${type || "activity"} on ${targetName(entry, null)}` };
  }
}

/** Page title for an entry, best effort: an explicit title, else a page-targeted event's name, else the id. */
export function pageTitleOf(entry) {
  if (entry?.pageTitle) return String(entry.pageTitle);
  if (entry?.target?.kind === "page" && entry?.target?.name) return String(entry.target.name);
  return entry?.pageId ? `Page ${entry.pageId}` : "";
}

/** CSV column set the space report exports — the design's fixed list. */
export const ACTIVITY_CSV_COLUMNS = Object.freeze([
  "ts", "type", "category", "pageId", "pageTitle", "actorAccountId", "actorName",
  "targetKind", "targetId", "targetName", "version", "details",
]);

export function activityToCsv(entries) {
  // Review: a cell that starts with = + - @ (or a tab / CR) is a formula to Excel and
  // LibreOffice. Attachment names, section titles and reasons are user-typed, so a file named
  // =HYPERLINK(...) would run on the steward's machine. A leading apostrophe makes it text.
  const esc = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows = (entries || []).map((e) => [
    e.ts, e.type, categoryOf(e.type), e.pageId, e.pageTitle || (e.target?.kind === "page" ? e.target?.name : "") || "",
    e.actor?.accountId, e.actor?.name, e.target?.kind, e.target?.id, e.target?.name, e.version,
    JSON.stringify(e.details ?? {}),
  ]);
  return [ACTIVITY_CSV_COLUMNS, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}
