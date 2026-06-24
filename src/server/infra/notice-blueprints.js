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
export function composeViolationLayout({
  ownerAccountId,
  editorAccountId,
  artifactName,
  pageUrl,
  actionVerb = "edit",
}) {
  const outcome =
    actionVerb === "delete"
      ? "The attachment has been restored."
      : actionVerb === "content-removal"
        ? "The page content has been reverted."
        : "The change has been reverted.";

  const storageBody = `
<p>${HEADER} — <strong>Seal Violation</strong></p>
<p>${mention(ownerAccountId)} — ${mention(editorAccountId)} attempted to ${escapeXml(actionVerb)} <strong>"${escapeXml(artifactName)}"</strong>. ${escapeXml(outcome)}</p>
${ctaLink(pageUrl, "Open the page")}
`.trim();

  return {
    summary: `Seal violation on "${artifactName}"`,
    storageBody,
  };
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

// Backwards-compatible alias.
export const composeAutoReleaseLayout = composeExpiryLayout;

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
    : `<strong>${escapeXml(stewardDisplayName || "A steward")}</strong>`;

  const storageBody = `
<p>${HEADER} — <strong>Steward Override</strong></p>
<p>${mention(ownerAccountId)} — ${stewardLabel} released your seal on <strong>"${escapeXml(artifactName)}"</strong> (<em>${escapeXml(pageTitle)}</em>)${unlockDate ? ` on <strong>${escapeXml(unlockDate)}</strong>` : ""}.</p>
<p>You no longer hold exclusive access to this file. Re-seal if you still need it, or contact the steward if this was unintended.</p>
${ctaLink(pageUrl, "Open the page")}
`.trim();

  return {
    summary: `Steward released your seal on "${artifactName}"`,
    storageBody,
  };
}

/**
 * Edit access requested: a user is asking the seal owner for edit rights on a
 * sealed attachment. Recipient is the owner; the requester is also mentioned.
 */
export function composeEditRequestLayout({
  ownerAccountId,
  requesterAccountId,
  requesterName,
  artifactName,
  pageTitle,
  pageUrl,
}) {
  const requesterLabel = requesterAccountId
    ? mention(requesterAccountId)
    : `<strong>${escapeXml(requesterName || "A user")}</strong>`;

  const storageBody = `
<p>${HEADER} — <strong>Edit Access Requested</strong></p>
<p>${mention(ownerAccountId)} — ${requesterLabel} is requesting permission to edit your sealed file <strong>"${escapeXml(artifactName)}"</strong>${pageTitle ? ` on <em>${escapeXml(pageTitle)}</em>` : ""}.</p>
<p>Approve or deny this request from the Sentinel Vault space console (Edit Requests).</p>
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
}) {
  const storageBody = `
<p>${HEADER} — <strong>Edit Access Granted</strong></p>
<p>${mention(ownerAccountId)} — your request to edit <strong>"${escapeXml(artifactName)}"</strong>${pageTitle ? ` on <em>${escapeXml(pageTitle)}</em>` : ""} has been approved. You can edit this file until the seal expires; other users remain blocked.</p>
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
}) {
  const storageBody = `
<p>${HEADER} — <strong>Edit Access Declined</strong></p>
<p>${mention(ownerAccountId)} — your request to edit <strong>"${escapeXml(artifactName)}"</strong>${pageTitle ? ` on <em>${escapeXml(pageTitle)}</em>` : ""} was declined by the seal owner.</p>
${ctaLink(pageUrl, "Open the page")}
`.trim();

  return {
    summary: `Edit access declined for "${artifactName}"`,
    storageBody,
  };
}
