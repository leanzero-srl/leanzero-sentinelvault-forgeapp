/**
 * Confluence storage-format body builders for Sentinel Vault notifications.
 *
 * Each function returns `{ summary, storageBody }`.
 *  - `summary`: short plain-text label (used by banners / flags)
 *  - `storageBody`: Confluence storage XML posted as a footer comment.
 *    `<ac:link><ri:user ri:account-id="..."/></ac:link>` mentions trigger
 *    Confluence's notification engine to email the recipient.
 */

const HEADER = "🔒 <strong>Sentinel Vault</strong>";

function escapeXml(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function mention(accountId) {
  return `<ac:link><ri:user ri:account-id="${escapeXml(accountId)}" /></ac:link>`;
}

function ctaLink(url, text) {
  if (!url) return "";
  return `<p><a href="${escapeXml(url)}">${escapeXml(text)}</a></p>`;
}

/**
 * Seal violation: someone modified or deleted a sealed file.
 */
// Human phrasing per action verb — the raw verb identifiers ("content-removal",
// "revert-failed") used to be interpolated verbatim ("attempted to content-removal").
const VERB_PHRASES = {
  edit: "edit",
  delete: "delete",
  "content-removal": "remove",
  "permanently-deleted": "permanently delete",
  "revert-failed": "modify",
  "layout-changed": "change the presentation of",
};

// Truthful outcome per verb. "delete" previously claimed "restored" even on the
// PERMANENT-delete path (incident 2026-07-22 review) — that path now has its own verb.
const VERB_OUTCOMES = {
  delete: "The attachment has been restored from the trash.",
  "content-removal": "The page content has been reverted.",
  "permanently-deleted": "It cannot be restored — the file is permanently gone and the seal has been released.",
  "revert-failed": "Sentinel Vault could NOT automatically restore it. Please review the page and recover the file from the trash or version history if needed.",
  "layout-changed": "The sealed presentation has been restored.",
};

// F2 (owner feedback 2026-08-27): "without a specific notification for me or for the owner;
// it is the same for both parties". The notice used to be a single owner-addressed sentence
// that merely MENTIONED the other person, so the editor was notified by a message written
// about them rather than to them, and neither party was told what it meant for THEM. Each
// side now gets its own addressed paragraph — one comment, two audiences.
const VERB_EDITOR_LINES = {
  edit: "your change was undone because this file is sealed.",
  delete: "your deletion was undone — the file is sealed, and Sentinel Vault pulled it back out of the trash.",
  "content-removal": "your removal was undone because this file is sealed.",
  "permanently-deleted": "the file you deleted was sealed. It could not be recovered.",
  "revert-failed": "this file is sealed and your change should not have applied.",
  "layout-changed": "your presentation change was undone — this file's on-page layout is sealed.",
};

export function composeViolationLayout({
  ownerAccountId,
  editorAccountId,
  artifactName,
  pageUrl,
  historyUrl,
  actionVerb = "edit",
}) {
  const verbPhrase = VERB_PHRASES[actionVerb] || VERB_PHRASES.edit;
  const outcome = VERB_OUTCOMES[actionVerb] || "The change has been reverted.";

  // Vet F4: with NO editor (a purge discovered by probe, not witnessed as an event), state the
  // fact without accusing whoever happened to touch the page. Same phrasing when the editor IS
  // the owner — "@me — @me attempted to edit your sealed file" names one person twice and reads
  // as a bug rather than as a notice.
  const namesSomeoneElse = Boolean(editorAccountId) && editorAccountId !== ownerAccountId;
  const ownerLine = namesSomeoneElse
    ? `${mention(ownerAccountId)} — ${mention(editorAccountId)} attempted to ${escapeXml(verbPhrase)} your sealed file <strong>"${escapeXml(artifactName)}"</strong>. ${escapeXml(outcome)}`
    : `${mention(ownerAccountId)} — your sealed file <strong>"${escapeXml(artifactName)}"</strong> ${actionVerb === "permanently-deleted" ? "was permanently deleted" : "was modified"}. ${escapeXml(outcome)}`;

  // The editor's own paragraph: what happened to THEIR change, and where their work went.
  // Skipped when the editor IS the owner or is unknown — a comment addressed to one person
  // twice reads worse than one addressed once.
  let editorPara = "";
  if (namesSomeoneElse) {
    const editorLine = VERB_EDITOR_LINES[actionVerb] || VERB_EDITOR_LINES.edit;
    const recovery = historyUrl
      ? ` If that change was intentional, your version is preserved in the page history — <a href="${escapeXml(historyUrl)}">view previous versions</a> to recover it.`
      : "";
    editorPara = `<p>${mention(editorAccountId)} — ${escapeXml(editorLine)}${recovery} To change this file, ask ${mention(ownerAccountId)} for edit access from the Sentinel Vault panel.</p>`;
  }

  const storageBody = `
<p>${HEADER} — <strong>Seal Violation</strong></p>
<p>${ownerLine}</p>
${editorPara}
${ctaLink(pageUrl, "Open the page")}
`.trim();

  return {
    summary: `Seal violation on "${artifactName}"`,
    storageBody,
  };
}

/**
 * The EDITOR's own notice (tester report 2026-09-17): posted when the violation comment above
 * is switched off (it is opt-in), so the person whose published work was undone still hears
 * about it — addressed to them, saying where their text is and how to get edit access.
 * `versionUrl` opens the exact page version that carries their change.
 */
export function composeEditorRevertLayout({
  editorAccountId,
  sealOwnerAccountId,
  artifactName,
  pageUrl,
  historyUrl,
  versionUrl,
  targetKind = "attachment",
  actionVerb = "edit",
}) {
  const what = targetKind === "section"
    ? `the sealed section <strong>"${escapeXml(artifactName)}"</strong>`
    : `the sealed file <strong>"${escapeXml(artifactName)}"</strong>`;
  const did = actionVerb === "content-removal" ? "removing" : actionVerb === "delete" ? "deleting" : actionVerb === "layout-changed" ? "changing the layout of" : "changing";
  const where = versionUrl
    ? ` Nothing is lost: <a href="${escapeXml(versionUrl)}">the version with your change</a> is kept in the page history, so you can copy your text from there.`
    : historyUrl ? ` Nothing is lost: your version is kept in the <a href="${escapeXml(historyUrl)}">page history</a>.` : "";
  const owner = sealOwnerAccountId ? mention(sealOwnerAccountId) : "the seal owner";
  const storageBody = `
<p>${HEADER} — <strong>Your change was undone</strong></p>
<p>${mention(editorAccountId)} — your edit ${escapeXml(did)} ${what} was reverted, because it is sealed by ${owner}.${where}</p>
<p>To edit it, open the Sentinel Vault panel on this page and use <strong>Request edit</strong>, or ask ${owner} to give you edit access directly.</p>
${ctaLink(pageUrl, "Open the page")}
`.trim();
  return { summary: `Your change to "${artifactName}" was undone`, storageBody };
}

/**
 * Seal created: confirmation that a seal is now active.
 */
export function composeSealConfirmLayout({
  ownerAccountId,
  artifactName,
  pageTitle,
  pageUrl,
  expiryDate,
}) {
  const storageBody = `
<p>${HEADER} — <strong>Seal Active</strong></p>
<p>${mention(ownerAccountId)} — you have sealed <strong>"${escapeXml(artifactName)}"</strong> on <em>${escapeXml(pageTitle)}</em>.</p>
${expiryDate ? `<p>Valid until <strong>${escapeXml(expiryDate)}</strong>. No one else can modify the file while your seal is active.</p>` : ""}
${ctaLink(pageUrl, "Open the page")}
`.trim();

  return {
    summary: `Seal active on "${artifactName}"`,
    storageBody,
  };
}

/**
 * 50% reminder: half of the seal duration has elapsed.
 */
export function composeHalfwayLayout({
  ownerAccountId,
  artifactName,
  pageTitle,
  pageUrl,
  expiryDate,
}) {
  const storageBody = `
<p>${HEADER} — <strong>Seal Half-way Through</strong></p>
<p>${mention(ownerAccountId)} — your seal on <strong>"${escapeXml(artifactName)}"</strong> (<em>${escapeXml(pageTitle)}</em>) has reached its midpoint.</p>
${expiryDate ? `<p>Lapses on <strong>${escapeXml(expiryDate)}</strong>. Consider wrapping up or renewing your seal before then.</p>` : ""}
${ctaLink(pageUrl, "Manage the seal")}
`.trim();

  return {
    summary: `Seal halfway: "${artifactName}"`,
    storageBody,
  };
}

/**
 * Seal expired / auto-released.
 */
export function composeExpiryLayout({
  ownerAccountId,
  artifactName,
  pageTitle,
  pageUrl,
  expiryDate,
}) {
  const storageBody = `
<p>${HEADER} — <strong>Seal Expired</strong></p>
<p>${mention(ownerAccountId)} — your seal on <strong>"${escapeXml(artifactName)}"</strong> (<em>${escapeXml(pageTitle)}</em>) has expired${expiryDate ? ` on <strong>${escapeXml(expiryDate)}</strong>` : ""}.</p>
<p>Please release the seal when you are finished, or re-seal if you still need exclusive access.</p>
${ctaLink(pageUrl, "Open the page")}
`.trim();

  return {
    summary: `Seal expired on "${artifactName}"`,
    storageBody,
  };
}

/**
 * Lapse notice N of N (F5 — owner feedback 2026-08-27).
 *
 * The old expiry notice fired ONCE and said "please release the seal when you are finished",
 * which is unanswerable when the owner has left the company — the file then stayed listed as
 * sealed forever. Every notice now states the deadline and what happens at it, so the outcome
 * is never a surprise.
 */
export function composeLapseNoticeLayout({
  ownerAccountId,
  artifactName,
  pageTitle,
  pageUrl,
  expiryDate,
  noticeNumber = 1,
  noticeLimit = 3,
  releaseDate,
}) {
  const remaining = Math.max(0, noticeLimit - noticeNumber);
  const deadline = releaseDate
    ? `on <strong>${escapeXml(releaseDate)}</strong>`
    : `after ${remaining} more reminder${remaining === 1 ? "" : "s"}`;

  const storageBody = `
<p>${HEADER} — <strong>Seal Overdue</strong> (reminder ${noticeNumber} of ${noticeLimit})</p>
<p>${mention(ownerAccountId)} — your seal on <strong>"${escapeXml(artifactName)}"</strong> (<em>${escapeXml(pageTitle)}</em>) lapsed${expiryDate ? ` on <strong>${escapeXml(expiryDate)}</strong>` : ""} and is no longer protecting the file.</p>
<p>Extend it from the Sentinel Vault panel to keep it, or release it if you are finished. If nothing changes, Sentinel Vault will release it automatically ${deadline} and the file becomes available to everyone.</p>
${ctaLink(pageUrl, "Open the page")}
`.trim();

  return {
    summary: `Seal overdue on "${artifactName}" (${noticeNumber}/${noticeLimit})`,
    storageBody,
  };
}

/**
 * The seal was released automatically after the reminders ran out (F5).
 */
export function composeAutoReleaseLayout({
  ownerAccountId,
  artifactName,
  pageTitle,
  pageUrl,
  noticeLimit = 3,
}) {
  const storageBody = `
<p>${HEADER} — <strong>Seal Released</strong></p>
<p>${mention(ownerAccountId)} — the lapsed seal on <strong>"${escapeXml(artifactName)}"</strong> (<em>${escapeXml(pageTitle)}</em>) has been released automatically after ${noticeLimit} reminder${noticeLimit === 1 ? "" : "s"} with no extension.</p>
<p>The file is available to everyone again. Seal it again from the Sentinel Vault panel if you still need exclusive access.</p>
${ctaLink(pageUrl, "Open the page")}
`.trim();

  return {
    summary: `Seal released on "${artifactName}"`,
    storageBody,
  };
}

/**
 * Periodic reminder: artifact has been sealed for many days.
 * Not currently used as a comment (banner-only) — kept for completeness.
 */
export function composePeriodicLayout({
  ownerAccountId,
  artifactName,
  pageTitle,
  pageUrl,
  daysSealed,
}) {
  const storageBody = `
<p>${HEADER} — <strong>Reminder</strong></p>
<p>${mention(ownerAccountId)} — <strong>"${escapeXml(artifactName)}"</strong> on <em>${escapeXml(pageTitle)}</em> has been sealed by you for <strong>${escapeXml(daysSealed)} days</strong>.</p>
${ctaLink(pageUrl, "Manage the seal")}
`.trim();

  return {
    summary: `"${artifactName}" sealed for ${daysSealed} days`,
    storageBody,
  };
}

/**
 * Release notification (Notify Me feature): file is now accessible.
 */
export function composeReleaseNoticeLayout({
  watcherAccountId,
  artifactName,
  pageTitle,
  pageUrl,
  unlockDate,
}) {
  const storageBody = `
<p>${HEADER} — <strong>File Now Accessible</strong></p>
<p>${mention(watcherAccountId)} — <strong>"${escapeXml(artifactName)}"</strong> on <em>${escapeXml(pageTitle)}</em> has been released${unlockDate ? ` on <strong>${escapeXml(unlockDate)}</strong>` : ""}.</p>
<p>You asked to be informed when this file became available.</p>
${ctaLink(pageUrl, "Open the page")}
`.trim();

  return {
    summary: `"${artifactName}" is now open`,
    storageBody,
  };
}

/**
 * Steward override: a steward forcefully unsealed an artifact.
 */
export function composeStewardOverrideLayout({
  ownerAccountId,
  stewardAccountId,
  stewardDisplayName,
  artifactName,
  pageTitle,
  pageUrl,
  unlockDate,
}) {
  const stewardLabel = stewardAccountId
    ? mention(stewardAccountId)
    : `<strong>${escapeXml(stewardDisplayName || "A space admin")}</strong>`;

  const storageBody = `
<p>${HEADER} — <strong>Space admin override</strong></p>
<p>${mention(ownerAccountId)} — ${stewardLabel} released your seal on <strong>"${escapeXml(artifactName)}"</strong> (<em>${escapeXml(pageTitle)}</em>)${unlockDate ? ` on <strong>${escapeXml(unlockDate)}</strong>` : ""}.</p>
<p>You no longer hold exclusive access to this file. Re-seal if you still need it, or contact the space admin if this was unintended.</p>
${ctaLink(pageUrl, "Open the page")}
`.trim();

  return {
    summary: `A space admin released your seal on "${artifactName}"`,
    storageBody,
  };
}

/**
 * Edit access requested: a user is asking the seal owner for edit rights on a
 * sealed attachment. Recipient is the owner; the requester is also mentioned.
 */
// SEC-9: `targetKind` ("attachment" | "section") — a section owner used to read "your sealed
// FILE "Decisions"", and the requester "you can edit this FILE". One word per kind, here.
const kindWord = (targetKind) => (targetKind === "section" ? "section" : "file");

export function composeEditRequestLayout({
  ownerAccountId,
  requesterAccountId,
  requesterName,
  artifactName,
  pageTitle,
  pageUrl,
  reason,
  targetKind = "attachment",
}) {
  const requesterLabel = requesterAccountId
    ? mention(requesterAccountId)
    : `<strong>${escapeXml(requesterName || "A user")}</strong>`;

  const reasonLine = reason
    ? `<p>Reason given: <em>"${escapeXml(reason)}"</em></p>`
    : "";

  const storageBody = `
<p>${HEADER} — <strong>Edit Access Requested</strong></p>
<p>${mention(ownerAccountId)} — ${requesterLabel} is requesting permission to edit your sealed ${kindWord(targetKind)} <strong>"${escapeXml(artifactName)}"</strong>${pageTitle ? ` on <em>${escapeXml(pageTitle)}</em>` : ""}.</p>
${reasonLine}
<p>Approve or decline from the Sentinel Vault panel on the page, from the page's Sentinel Vault byline, or from My work.</p>
${ctaLink(pageUrl, "Open the page")}
`.trim();

  return {
    summary: `Edit access requested for "${artifactName}"`,
    storageBody,
  };
}

/**
 * Edit access granted: the seal owner approved a request. Recipient is the
 * requester (dispatchNotice fills ownerAccountId with the recipient).
 */
export function composeEditApprovedLayout({
  ownerAccountId,
  artifactName,
  pageTitle,
  pageUrl,
  targetKind = "attachment",
}) {
  const storageBody = `
<p>${HEADER} — <strong>Edit Access Granted</strong></p>
<p>${mention(ownerAccountId)} — your request to edit the sealed ${kindWord(targetKind)} <strong>"${escapeXml(artifactName)}"</strong>${pageTitle ? ` on <em>${escapeXml(pageTitle)}</em>` : ""} has been approved. You can edit this ${kindWord(targetKind)} until the seal expires; other users remain blocked.</p>
${ctaLink(pageUrl, "Open the page")}
`.trim();

  return {
    summary: `Edit access granted for "${artifactName}"`,
    storageBody,
  };
}

/**
 * Edit access declined: the seal owner denied a request. Recipient is the
 * requester.
 */
export function composeEditDeniedLayout({
  ownerAccountId,
  artifactName,
  pageTitle,
  pageUrl,
  targetKind = "attachment",
  reason = null,
}) {
  const reasonLine = reason ? `<p>The owner said: <em>"${escapeXml(reason)}"</em></p>` : "";
  const storageBody = `
<p>${HEADER} — <strong>Edit Access Declined</strong></p>
<p>${mention(ownerAccountId)} — your request to edit the sealed ${kindWord(targetKind)} <strong>"${escapeXml(artifactName)}"</strong>${pageTitle ? ` on <em>${escapeXml(pageTitle)}</em>` : ""} was declined by the seal owner.</p>
${reasonLine}
${ctaLink(pageUrl, "Open the page")}
`.trim();

  return {
    summary: `Edit access declined for "${artifactName}"`,
    storageBody,
  };
}
