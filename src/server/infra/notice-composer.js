/**
 * Centralized notification orchestrator.
 *
 * `dispatchNotice(type, data)` resolves the recipient's display name, builds a
 * Confluence storage-format body via the appropriate blueprint, and posts a
 * footer comment on the page. The mention tag in the body causes Confluence to
 * email the recipient (subject to their personal notification preferences).
 *
 * The 8 legacy `mailXxx` wrappers are kept under the same names so the existing
 * callsites only need an import-path change.
 */

import { asApp, route } from "@forge/api";
import { postCommentWithMention } from "./outbound-notify.js";
import {
  composeViolationLayout,
  composeSealConfirmLayout,
  composeHalfwayLayout,
  composeExpiryLayout,
  composePeriodicLayout,
  composeReleaseNoticeLayout,
  composeStewardOverrideLayout,
  composeEditRequestLayout,
  composeEditApprovedLayout,
  composeEditDeniedLayout,
} from "./notice-blueprints.js";

export {
  composeViolationLayout,
  composeSealConfirmLayout,
  composeHalfwayLayout,
  composeExpiryLayout,
  composeAutoReleaseLayout,
  composePeriodicLayout,
  composeReleaseNoticeLayout,
  composeStewardOverrideLayout,
  composeEditRequestLayout,
  composeEditApprovedLayout,
  composeEditDeniedLayout,
} from "./notice-blueprints.js";



export const ALERT_CATEGORIES = {
  SEAL_VIOLATION: "seal_violation",
  SEAL_CREATED: "seal_created",
  FIFTY_PERCENT_REMINDER: "fifty_percent_reminder",
  AUTO_RELEASE: "auto_release",
  EXPIRY_NOTIFICATION: "expiry_notification",
  PERIODIC_REMINDER: "periodic_reminder",
  RELEASE_NOTIFICATION: "release_notification",
  STEWARD_OVERRIDE_RELEASE: "steward_override_release",
  EDIT_ACCESS_REQUEST: "edit_access_request",
  EDIT_ACCESS_APPROVED: "edit_access_approved",
  EDIT_ACCESS_DENIED: "edit_access_denied",
};

/**
 * Resolve display name for an Atlassian account.
 * Email lookup is no longer needed — Confluence's notification engine
 * handles the mention email itself.
 */
export async function fetchOperatorProfile(accountId) {
  let displayName = "Unknown User";

  try {
    const response = await asApp().requestConfluence(
      route`/wiki/rest/api/user?accountId=${accountId}`,
    );
    if (response.ok) {
      const data = await response.json();
      displayName = data.displayName || "Unknown User";
    }
  } catch (error) {
    console.error(`[NOTICE] Failed to fetch user info for ${accountId}:`, error);
  }

  return { displayName, accountId };
}

/**
 * Build the page URL from a page response.
 */
async function resolvePageUrl(pageId) {
  if (!pageId) return { pageTitle: "Unknown Page", pageUrl: "", historyUrl: "" };
  try {
    const response = await asApp().requestConfluence(
      route`/wiki/api/v2/pages/${pageId}`,
    );
    if (!response.ok) return { pageTitle: "Unknown Page", pageUrl: "", historyUrl: "" };
    const data = await response.json();
    const baseUrl = data._links?.base || "";
    const webui = data._links?.webui || "";
    return {
      pageTitle: data.title || "Unknown Page",
      pageUrl: baseUrl && webui ? `${baseUrl}${webui}` : "",
      // Page version history — where a reverted change can be recovered from.
      historyUrl: baseUrl ? `${baseUrl}/pages/viewpreviousversions.action?pageId=${pageId}` : "",
    };
  } catch (error) {
    console.warn(`[NOTICE] Failed to fetch page ${pageId}:`, error);
    return { pageTitle: "Unknown Page", pageUrl: "", historyUrl: "" };
  }
}

/**
 * Build the storage body for a notification type.
 */
function buildBlueprint(type, data) {
  switch (type) {
    case ALERT_CATEGORIES.SEAL_VIOLATION:
      return composeViolationLayout(data);
    case ALERT_CATEGORIES.SEAL_CREATED:
      return composeSealConfirmLayout(data);
    case ALERT_CATEGORIES.FIFTY_PERCENT_REMINDER:
      return composeHalfwayLayout(data);
    case ALERT_CATEGORIES.AUTO_RELEASE:
    case ALERT_CATEGORIES.EXPIRY_NOTIFICATION:
      return composeExpiryLayout(data);
    case ALERT_CATEGORIES.PERIODIC_REMINDER:
      return composePeriodicLayout(data);
    case ALERT_CATEGORIES.RELEASE_NOTIFICATION:
      return composeReleaseNoticeLayout(data);
    case ALERT_CATEGORIES.STEWARD_OVERRIDE_RELEASE:
      return composeStewardOverrideLayout(data);
    case ALERT_CATEGORIES.EDIT_ACCESS_REQUEST:
      return composeEditRequestLayout(data);
    case ALERT_CATEGORIES.EDIT_ACCESS_APPROVED:
      return composeEditApprovedLayout(data);
    case ALERT_CATEGORIES.EDIT_ACCESS_DENIED:
      return composeEditDeniedLayout(data);
    default:
      return null;
  }
}

/**
 * Centralized notice dispatcher.
 *
 * @param {string} type - One of ALERT_CATEGORIES
 * @param {Object} data
 * @param {string} data.recipientAccountId - Atlassian accountId of the primary mention recipient
 * @param {string} data.pageId - Confluence page where the comment is posted
 * @param {string} data.artifactName
 * @param {Object} [data.extra] - Type-specific fields (expiryDate, editorAccountId, …)
 * @returns {Promise<{success: boolean, commentId?: string, reason?: string}>}
 */
export async function dispatchNotice(type, data) {
  const { recipientAccountId, pageId, artifactName, extra = {} } = data;

  if (!recipientAccountId) {
    return { success: false, reason: "Missing recipientAccountId" };
  }
  if (!pageId) {
    return { success: false, reason: "Missing pageId" };
  }

  console.info(
    `[NOTICE] Preparing ${type} notice for ${recipientAccountId} on artifact "${artifactName}"`,
  );

  try {
    const { pageTitle, pageUrl, historyUrl } = await resolvePageUrl(pageId);

    const blueprintData = {
      ownerAccountId: recipientAccountId,
      watcherAccountId: recipientAccountId,
      artifactName: artifactName || "Unknown Attachment",
      pageTitle,
      pageUrl,
      historyUrl,
      ...extra,
    };

    const blueprint = buildBlueprint(type, blueprintData);
    if (!blueprint) {
      console.error(`[NOTICE] Unknown notice type: ${type}`);
      return { success: false, reason: `Unknown notice type: ${type}` };
    }

    const result = await postCommentWithMention({
      pageId,
      storageBody: blueprint.storageBody,
    });

    if (result.success) {
      console.info(
        `[NOTICE] ${type} comment posted on page ${pageId} (commentId=${result.commentId || "n/a"})`,
      );
    } else {
      console.warn(`[NOTICE] ${type} comment failed: ${result.reason}`);
    }

    return result;
  } catch (error) {
    console.error(`[NOTICE] Exception in ${type}:`, error);
    return { success: false, reason: error.message };
  }
}

// ============================================================================
// LEGACY WRAPPERS — Same names as the old `mail-composer.js` so callsites
// only need an import-path change. They now post comments instead of emails.
// ============================================================================

export async function mailViolationAlert(
  ownerAccountId,
  editorAccountId,
  artifactName,
  pageId,
  actionVerb = "edit",
) {
  return dispatchNotice(ALERT_CATEGORIES.SEAL_VIOLATION, {
    recipientAccountId: ownerAccountId,
    pageId,
    artifactName,
    extra: { editorAccountId, actionVerb },
  });
}

export async function mailSealConfirmation(
  ownerAccountId,
  artifactName,
  pageId,
  expiryDate,
) {
  return dispatchNotice(ALERT_CATEGORIES.SEAL_CREATED, {
    recipientAccountId: ownerAccountId,
    pageId,
    artifactName,
    extra: { expiryDate },
  });
}

export async function mailHalfwayReminder(
  ownerAccountId,
  artifactName,
  pageId,
  expiryDate,
) {
  return dispatchNotice(ALERT_CATEGORIES.FIFTY_PERCENT_REMINDER, {
    recipientAccountId: ownerAccountId,
    pageId,
    artifactName,
    extra: { expiryDate },
  });
}

export async function mailExpiryNotice(
  ownerAccountId,
  artifactName,
  pageId,
  expiryDate,
) {
  return dispatchNotice(ALERT_CATEGORIES.EXPIRY_NOTIFICATION, {
    recipientAccountId: ownerAccountId,
    pageId,
    artifactName,
    extra: { expiryDate },
  });
}

export async function dispatchAutoReleaseAlert(
  ownerAccountId,
  artifactName,
  pageId,
  unlockDate,
) {
  return mailExpiryNotice(ownerAccountId, artifactName, pageId, unlockDate);
}

export async function mailPeriodicReminder(
  ownerAccountId,
  artifactName,
  pageId,
  sealDate,
  daysSealed,
) {
  return dispatchNotice(ALERT_CATEGORIES.PERIODIC_REMINDER, {
    recipientAccountId: ownerAccountId,
    pageId,
    artifactName,
    extra: { sealDate, daysSealed },
  });
}

export async function mailReleaseNotice(
  watcherAccountId,
  artifactName,
  pageId,
  unlockDate,
) {
  return dispatchNotice(ALERT_CATEGORIES.RELEASE_NOTIFICATION, {
    recipientAccountId: watcherAccountId,
    pageId,
    artifactName,
    extra: { unlockDate },
  });
}

export async function mailStewardOverrideNotice(
  sealOwnerAccountId,
  stewardAccountId,
  stewardDisplayName,
  artifactName,
  pageId,
  unlockDate,
) {
  return dispatchNotice(ALERT_CATEGORIES.STEWARD_OVERRIDE_RELEASE, {
    recipientAccountId: sealOwnerAccountId,
    pageId,
    artifactName,
    extra: { stewardAccountId, stewardDisplayName, unlockDate },
  });
}

// --- Edit Requests notifications ---

export async function mailEditRequest(
  ownerAccountId,
  requesterAccountId,
  requesterName,
  artifactName,
  pageId,
  reason,
) {
  return dispatchNotice(ALERT_CATEGORIES.EDIT_ACCESS_REQUEST, {
    recipientAccountId: ownerAccountId,
    pageId,
    artifactName,
    extra: { requesterAccountId, requesterName, reason },
  });
}

export async function mailEditApproved(requesterAccountId, artifactName, pageId) {
  return dispatchNotice(ALERT_CATEGORIES.EDIT_ACCESS_APPROVED, {
    recipientAccountId: requesterAccountId,
    pageId,
    artifactName,
  });
}

export async function mailEditDenied(requesterAccountId, artifactName, pageId) {
  return dispatchNotice(ALERT_CATEGORIES.EDIT_ACCESS_DENIED, {
    recipientAccountId: requesterAccountId,
    pageId,
    artifactName,
  });
}
