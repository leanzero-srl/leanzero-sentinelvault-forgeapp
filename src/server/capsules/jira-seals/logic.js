/*
 * Jira attachment seals — the PURE rules (no Forge import; test/jira-seals.test.mjs runs this in
 * plain node). docs/JIRA-SEALS.md is the design record. The Forge I/O lives in store.js, the
 * resolvers in actions.js, the event handler in trigger.js; every decision they take is made here
 * so it can be proven without a tenant.
 */

export const JIRA_SEAL_PREFIX = "jira-protection-";
/** Per-issue index row: lets an issue deletion find its seals without a site-wide scan. */
export const JIRA_ISSUE_INDEX_PREFIX = "jira-seal-issue-";
/** Per-owner index row (K1: a per-caller listing reads a per-caller prefix): My work's Jira card. */
export const JIRA_OWNER_INDEX_PREFIX = "jira-seal-owner-";
/** Comment dedup: one restore comment per seal per window (a delete loop cannot flood the issue). */
export const JIRA_NOTICE_PREFIX = "jira-seal-noticed-";
/** Lapse reminder counter (the Confluence sweep's `expiry-notified-` shape, Jira's own family). */
export const JIRA_LAPSE_PREFIX = "jira-seal-lapse-";
export const JIRA_NOTICE_WINDOW_MS = 10 * 60 * 1000;
/** The copy is taken inside one resolver call; above this it cannot finish safely. */
export const JIRA_SEAL_MAX_BYTES = 25 * 1024 * 1024;

export const jiraSealKey = (attachmentId) => `${JIRA_SEAL_PREFIX}${attachmentId}`;
export const jiraIssueIndexKey = (issueId, attachmentId) => `${JIRA_ISSUE_INDEX_PREFIX}${issueId}-${attachmentId}`;
export const jiraIssueIndexPrefix = (issueId) => `${JIRA_ISSUE_INDEX_PREFIX}${issueId}-`;
export const jiraOwnerIndexPrefix = (accountId) => `${JIRA_OWNER_INDEX_PREFIX}${accountId}-`;
export const jiraOwnerIndexKey = (accountId, sealId) => `${JIRA_OWNER_INDEX_PREFIX}${accountId}-${sealId}`;
export const jiraNoticeKey = (attachmentId) => `${JIRA_NOTICE_PREFIX}${attachmentId}`;
export const jiraLapseKey = (attachmentId) => `${JIRA_LAPSE_PREFIX}${attachmentId}`;
/** A seal's stable identity across restores (the attachment id changes each time it is put back). */
export const sealIdOf = (record) => String(record?.originalAttachmentId || record?.attachmentId || "");
/** Object Store key of a seal's copy. Keyed by the FIRST attachment id: a restore keeps the copy. */
export const jiraCopyKey = (originalAttachmentId) => `jira-seal/${originalAttachmentId}`;

/** Jira ids are digits. Anything else is refused before it reaches a route or a key. */
export const isJiraId = (v) => typeof v === "string" ? /^\d{1,18}$/.test(v) : Number.isSafeInteger(v) && v > 0;
export const normId = (v) => (isJiraId(v) ? String(v) : null);
/** An issue key or id, as Jira accepts in a path. */
export const isIssueRef = (v) => typeof v === "string" && (/^\d{1,18}$/.test(v) || /^[A-Z][A-Z0-9_]{0,19}-\d{1,9}$/.test(v));

export const isExpired = (record, nowMs) => {
  const t = Date.parse(record?.expiresAt || "");
  return Number.isFinite(t) && t <= nowMs;
};

/** PURE. The seal record written when a file is sealed. */
export function buildSealRecord({ attachment, issue, project, owner, holdSeconds, sha256, copyKey, note, nowMs }) {
  const now = new Date(nowMs);
  return {
    product: "jira",
    attachmentId: String(attachment.id),
    originalAttachmentId: String(attachment.id),
    attachmentName: String(attachment.filename || "file").slice(0, 255),
    mimeType: attachment.mimeType || "application/octet-stream",
    size: Number(attachment.size) || 0,
    sha256,
    copyKey,
    issueId: String(issue.id),
    issueKey: issue.key || null,
    projectId: project?.id != null ? String(project.id) : null,
    projectKey: project?.key || null,
    lockedBy: owner.accountId,
    lockedByName: owner.name || null,
    timestamp: now.toISOString(),
    expiresAt: new Date(nowMs + holdSeconds * 1000).toISOString(),
    lockDuration: holdSeconds,
    note: typeof note === "string" && note.trim() ? note.trim().slice(0, 300) : null,
    restoreCount: 0,
  };
}

/**
 * PURE. What a delete of a sealed attachment means.
 *   "ignore"          — the app's own action, or no live seal
 *   "release-owner"   — the owner deleted their own file: their intent, the seal ends
 *   "release-expired" — the seal had lapsed: nothing to protect, clean up
 *   "restore"         — anyone else: put the file back
 */
export function decideDeletion({ record, actorId, selfGenerated, appAccountId, nowMs }) {
  if (!record || !record.lockedBy) return "ignore";
  if (selfGenerated === true) return "ignore";
  if (actorId && appAccountId && actorId === appAccountId) return "ignore";
  if (actorId && actorId === record.lockedBy) return "release-owner";
  if (isExpired(record, nowMs)) return "release-expired";
  return "restore";
}

/** PURE. The record after a restore moved the seal to the re-uploaded attachment. */
export function movedRecord(record, created, { actorId, nowMs }) {
  return {
    ...record,
    attachmentId: String(created.id),
    attachmentName: String(created.filename || record.attachmentName),
    restoreCount: (Number(record.restoreCount) || 0) + 1,
    lastRestoredAt: new Date(nowMs).toISOString(),
    lastDeletedBy: actorId || null,
  };
}

/** PURE. Should a restore comment go out now (one per seal per window)? */
export function noticeDue(lastNotice, nowMs, windowMs = JIRA_NOTICE_WINDOW_MS) {
  const t = Date.parse(lastNotice?.at || "");
  return !Number.isFinite(t) || nowMs - t >= windowMs;
}

/**
 * PURE. Who the restore comment names. With the site's comment channel on, the owner is mentioned
 * too; otherwise only the person whose delete was undone (the editor_revert carve-out, on by
 * default) and the owner is named in plain text.
 */
export function restoreNoticePlan(flags, { actorId, ownerId }) {
  const editorOn = flags?.NOTIFY_EDITOR_ON_REVERT === true;
  const allOn = flags?.ENABLE_NATIVE_NOTIFICATIONS === true;
  if (!editorOn && !allOn) return { post: false, mention: [] };
  const mention = [];
  if (actorId) mention.push(actorId);
  if (allOn && ownerId && ownerId !== actorId) mention.push(ownerId);
  return { post: mention.length > 0, mention };
}

const text = (t) => ({ type: "text", text: String(t) });
const mention = (id) => ({ type: "mention", attrs: { id: String(id) } });

/** PURE. The ADF comment posted after a restore. */
export function restoreCommentAdf({ actorId, ownerId, ownerName, fileName, mentionOwner }) {
  const p = [];
  if (actorId) p.push(mention(actorId), text(" "));
  p.push(text(`"${fileName}" is sealed by `));
  p.push(mentionOwner && ownerId ? mention(ownerId) : text(ownerName || "its owner"));
  p.push(text(" in Sentinel Vault, so the deleted file has been put back. Ask the owner to release the seal if it should go."));
  return { type: "doc", version: 1, content: [{ type: "paragraph", content: p }] };
}

/** PURE. The ADF comment telling an owner an admin removed their seal, and why. */
export function forcedCommentAdf({ ownerId, actorId, fileName, reason }) {
  return { type: "doc", version: 1, content: [{ type: "paragraph", content: [
    mention(ownerId), text(" "), mention(actorId),
    text(` removed your seal on "${fileName}" in Sentinel Vault. Reason: ${String(reason || "").slice(0, 300)}`),
  ] }] };
}

/** PURE. The ADF comment for a lapse reminder or the auto-release. */
export function lapseCommentAdf({ ownerId, fileName, noticeNumber, noticeLimit, releaseDate, released }) {
  const p = [mention(ownerId), text(" ")];
  if (released) {
    p.push(text(`your seal on "${fileName}" expired and has been released after ${noticeLimit} reminder${noticeLimit === 1 ? "" : "s"}. The file stays on the issue but is no longer protected.`));
  } else if (noticeLimit > 0) {
    p.push(text(`your seal on "${fileName}" has expired (reminder ${noticeNumber} of ${noticeLimit}). Extend it from the Sentinel Vault panel on this issue, or it will be released on ${releaseDate}.`));
  } else {
    p.push(text(`your seal on "${fileName}" has expired. Extend it from the Sentinel Vault panel on this issue if it should stay protected.`));
  }
  return { type: "doc", version: 1, content: [{ type: "paragraph", content: p }] };
}

/** PURE. The viewer's powers from Jira's own answer (mypermissions) plus the site switch. */
export function viewerPowers(permissions, { allowAdminOverride = true } = {}) {
  const has = (k) => permissions?.[k]?.havePermission === true;
  const canSee = has("BROWSE_PROJECTS");
  const canEdit = canSee && has("EDIT_ISSUES");
  const isAdmin = canSee && (has("ADMINISTER") || has("ADMINISTER_PROJECTS"));
  return { canSee, canEdit, isSteward: isAdmin && allowAdminOverride !== false };
}

/**
 * PURE. The one row rule: what the viewer is offered on an attachment.
 *   lost     — a seal whose file was deleted and could NOT be put back (the copy is still kept):
 *              anyone who may edit the issue can try again; the owner or an admin may let it go
 *   expired  — no longer protected: an editor may seal it anew (the server replaces a lapsed seal)
 */
export function rowFor({ record, viewerId, powers, nowMs, lost = false }) {
  if (!record || !record.lockedBy) {
    return { state: "open", primary: powers.canEdit ? "seal" : null, menu: [] };
  }
  const mine = record.lockedBy === viewerId;
  if (lost) {
    const menu = [];
    if (!mine && powers.isSteward) menu.push("force-release");
    return { state: "lost", primary: powers.canEdit ? "retry" : null, menu: mine ? ["release"] : menu };
  }
  const expired = isExpired(record, nowMs);
  const menu = [];
  if (mine || powers.isSteward) menu.push("extend");
  if (!mine && powers.isSteward) menu.push("force-release");
  return {
    state: expired ? "expired" : mine ? "mine" : "held",
    primary: mine ? "release" : expired && powers.canEdit ? "seal" : null,
    menu,
  };
}

export const ACTIVITY = Object.freeze({
  SEALED: "jira.sealed",
  RELEASED: "jira.released",
  FORCED: "jira.forced",
  EXTENDED: "jira.extended",
  RESTORED: "jira.restored",
  RESTORE_FAILED: "jira.restore-failed",
  AUTO_RELEASED: "jira.auto-released",
  ENDED: "jira.ended",
});
