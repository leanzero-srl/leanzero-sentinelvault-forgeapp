import { asApp, route } from "@forge/api";
import { resolveArtifactUrl } from "./artifact-fetch.js";
import {
  composeViolationLayout,
  composeSealConfirmLayout,
  composeHalfwayLayout,
  composeExpiryLayout,
  composeAutoReleaseLayout,
  composePeriodicLayout,
  composeReleaseNoticeLayout,
  composeStewardOverrideLayout,
} from "./mail-blueprints.js";
import { transmitMail, SENDER_ADDRESS } from "./outbound-mail.js";

export {
  composeExpiryLayout,
  composeAutoReleaseLayout,
  composeReleaseNoticeLayout,
} from "./mail-blueprints.js";

/**
 * Email notification service - CENTRALIZED
 *
 * ALL emails go through composeMail() which:
 * 1. Gets user info (display name + email)
 * 2. Gets artifact download URL
 * 3. Builds HTML from template
 * 4. Sends via Resend
 */

/**
 * Email template types
 */
export const ALERT_CATEGORIES = {
  SEAL_VIOLATION: "seal_violation",
  SEAL_CREATED: "seal_created",
  FIFTY_PERCENT_REMINDER: "fifty_percent_reminder",
  AUTO_RELEASE: "auto_release",
  EXPIRY_NOTIFICATION: "expiry_notification",
  PERIODIC_REMINDER: "periodic_reminder",
  RELEASE_NOTIFICATION: "release_notification",
  STEWARD_OVERRIDE_RELEASE: "steward_override_release",
};

/**
 * Get user display information for notifications
 * @param {string} accountId - User account ID
 * @returns {Promise<{displayName: string, email: string|null, accountId: string}>}
 */
export async function fetchOperatorProfile(accountId) {
  let displayName = "Unknown User";
  let email = null;

  try {
    const userResponse = await asApp().requestConfluence(
      route`/wiki/rest/api/user?accountId=${accountId}`,
    );

    if (userResponse.ok) {
      const userData = await userResponse.json();
      displayName = userData.displayName || "Unknown User";
    }

    const emailResponse = await asApp().requestConfluence(
      route`/wiki/rest/api/user/email?accountId=${accountId}`,
    );

    if (emailResponse.ok) {
      const emailData = await emailResponse.json();
      email = emailData.email || null;
    }
  } catch (error) {
    console.error(`Failed to get user info for ${accountId}:`, error);
  }

  return {
    displayName,
    email,
    accountId,
  };
}

/**
 * CENTRALIZED email sending function
 * All notification emails go through this single function
 *
 * @param {string} type - Email type from ALERT_CATEGORIES
 * @param {Object} data - Email data
 * @param {string} data.recipientAccountId - Account ID of recipient
 * @param {string} data.artifactId - Artifact ID
 * @param {string} data.artifactName - Artifact name
 * @param {string} data.pageTitle - Page title
 * @param {string} data.pageUrl - Page URL
 * @param {Object} [data.extra] - Extra data specific to email type
 * @returns {Promise<{success: boolean, messageId?: string, reason?: string}>}
 */
export async function composeMail(type, data) {
  const {
    recipientAccountId,
    artifactId,
    artifactName,
    pageTitle,
    pageUrl,
    extra = {},
  } = data;

  console.info(
    `[EMAIL] Preparing ${type} email for recipient ${recipientAccountId}, artifact "${artifactName}"`,
  );

  try {
    // Step 1: Get user info and artifact URL in parallel
    const [recipientInfo, artifactUrl] = await Promise.all([
      fetchOperatorProfile(recipientAccountId),
      resolveArtifactUrl(artifactId),
    ]);

    console.info(
      `[EMAIL] User info retrieved: ${recipientInfo.displayName}, email=${recipientInfo.email || "NONE"}`,
    );

    // Step 2: Determine recipient email
    const recipientEmail = recipientInfo.email || SENDER_ADDRESS;
    if (!recipientInfo.email) {
      console.warn(
        `[EMAIL] User ${recipientAccountId} has no email, using fallback: ${SENDER_ADDRESS}`,
      );
    }

    // Step 3: Build subject and HTML based on type
    let subject;
    let html;

    const baseTemplateData = {
      artifactName,
      artifactUrl,
      pageTitle,
      pageUrl,
    };

    switch (type) {
      case ALERT_CATEGORIES.SEAL_VIOLATION:
        subject = `Seal Violation: "${artifactName}"`;
        html = composeViolationLayout({
          ...baseTemplateData,
          ownerDisplayName: recipientInfo.displayName,
          editorDisplayName: extra.editorDisplayName || "Someone",
        });
        break;

      case ALERT_CATEGORIES.SEAL_CREATED:
        subject = `Seal Created: "${artifactName}"`;
        html = composeSealConfirmLayout({
          ...baseTemplateData,
          ownerDisplayName: recipientInfo.displayName,
          expiryDate: extra.expiryDate,
        });
        break;

      case ALERT_CATEGORIES.FIFTY_PERCENT_REMINDER:
        subject = `Seal Expiring Soon: "${artifactName}" - 50% Time Remaining`;
        html = composeHalfwayLayout({
          ...baseTemplateData,
          ownerDisplayName: recipientInfo.displayName,
          expiryDate: extra.expiryDate,
        });
        break;

      case ALERT_CATEGORIES.AUTO_RELEASE:
        subject = `Artifact Auto-Released: "${artifactName}"`;
        html = composeAutoReleaseLayout({
          ...baseTemplateData,
          ownerDisplayName: recipientInfo.displayName,
          unlockDate: extra.unlockDate,
        });
        break;

      case ALERT_CATEGORIES.EXPIRY_NOTIFICATION:
        subject = `Your Seal Has Expired — Action Required: "${artifactName}"`;
        html = composeExpiryLayout({
          ...baseTemplateData,
          ownerDisplayName: recipientInfo.displayName,
          expiryDate: extra.expiryDate,
        });
        break;

      case ALERT_CATEGORIES.PERIODIC_REMINDER:
        subject = `Reminder: Your Artifact "${artifactName}" is Still Sealed`;
        html = composePeriodicLayout({
          ...baseTemplateData,
          ownerDisplayName: recipientInfo.displayName,
          sealDate: extra.sealDate,
          daysSealed: extra.daysSealed,
        });
        break;

      case ALERT_CATEGORIES.RELEASE_NOTIFICATION:
        subject = `Artifact Released: "${artifactName}"`;
        html = composeReleaseNoticeLayout({
          ...baseTemplateData,
          requesterDisplayName: recipientInfo.displayName,
          unlockDate: extra.unlockDate,
        });
        break;

      case ALERT_CATEGORIES.STEWARD_OVERRIDE_RELEASE:
        subject = `Steward Override: Your Seal on "${artifactName}" Was Removed`;
        html = composeStewardOverrideLayout({
          ...baseTemplateData,
          ownerDisplayName: recipientInfo.displayName,
          stewardDisplayName: extra.stewardDisplayName || "A steward",
          unlockDate: extra.unlockDate,
        });
        break;

      default:
        console.error(`[EMAIL] Unknown email type: ${type}`);
        return { success: false, reason: `Unknown email type: ${type}` };
    }

    console.info(`[EMAIL] Sending ${type} email to ${recipientEmail}...`);

    // Step 4: Send via Resend
    const result = await transmitMail({
      to: recipientEmail,
      subject,
      html,
    });

    if (result.success) {
      console.info(
        `[EMAIL] SUCCESS: ${type} email sent to ${recipientEmail} for "${artifactName}" (messageId=${result.messageId})`,
      );
    } else {
      console.error(
        `[EMAIL] FAILED: ${type} email to ${recipientEmail} failed: ${result.reason}`,
      );
    }

    return result;
  } catch (error) {
    console.error(`[EMAIL] EXCEPTION in ${type} email:`, error);
    return { success: false, reason: error.message };
  }
}

// ============================================================================
// LEGACY WRAPPER FUNCTIONS - These call composeMail internally
// Kept for backwards compatibility until all callers are migrated
// ============================================================================

export async function mailViolationAlert(
  ownerAccountId,
  editorAccountId,
  artifactId,
  artifactName,
  pageTitle,
  pageUrl,
) {
  const editorInfo = await fetchOperatorProfile(editorAccountId);
  return composeMail(ALERT_CATEGORIES.SEAL_VIOLATION, {
    recipientAccountId: ownerAccountId,
    artifactId,
    artifactName,
    pageTitle,
    pageUrl,
    extra: { editorDisplayName: editorInfo.displayName },
  });
}

export async function mailSealConfirmation(
  ownerAccountId,
  artifactId,
  artifactName,
  pageTitle,
  pageUrl,
  expiryDate,
) {
  return composeMail(ALERT_CATEGORIES.SEAL_CREATED, {
    recipientAccountId: ownerAccountId,
    artifactId,
    artifactName,
    pageTitle,
    pageUrl,
    extra: { expiryDate },
  });
}

export async function mailHalfwayReminder(
  ownerAccountId,
  artifactId,
  artifactName,
  pageTitle,
  pageUrl,
  expiryDate,
) {
  return composeMail(ALERT_CATEGORIES.FIFTY_PERCENT_REMINDER, {
    recipientAccountId: ownerAccountId,
    artifactId,
    artifactName,
    pageTitle,
    pageUrl,
    extra: { expiryDate },
  });
}

export async function mailExpiryNotice(
  ownerAccountId,
  artifactId,
  artifactName,
  pageTitle,
  pageUrl,
  expiryDate,
) {
  return composeMail(ALERT_CATEGORIES.EXPIRY_NOTIFICATION, {
    recipientAccountId: ownerAccountId,
    artifactId,
    artifactName,
    pageTitle,
    pageUrl,
    extra: { expiryDate },
  });
}

export async function dispatchAutoReleaseAlert(
  ownerAccountId,
  artifactId,
  artifactName,
  pageTitle,
  pageUrl,
  unlockDate,
) {
  return mailExpiryNotice(
    ownerAccountId,
    artifactId,
    artifactName,
    pageTitle,
    pageUrl,
    unlockDate,
  );
}

export async function mailPeriodicReminder(
  ownerAccountId,
  artifactId,
  artifactName,
  pageTitle,
  pageUrl,
  sealDate,
  daysSealed,
) {
  return composeMail(ALERT_CATEGORIES.PERIODIC_REMINDER, {
    recipientAccountId: ownerAccountId,
    artifactId,
    artifactName,
    pageTitle,
    pageUrl,
    extra: { sealDate, daysSealed },
  });
}

export async function mailReleaseNotice(
  recipientAccountId,
  artifactId,
  artifactName,
  pageTitle,
  pageUrl,
  unlockDate,
) {
  return composeMail(ALERT_CATEGORIES.RELEASE_NOTIFICATION, {
    recipientAccountId,
    artifactId,
    artifactName,
    pageTitle,
    pageUrl,
    extra: { unlockDate },
  });
}

export async function mailStewardOverrideNotice(
  sealOwnerAccountId,
  stewardDisplayName,
  artifactId,
  artifactName,
  pageTitle,
  pageUrl,
  unlockDate,
) {
  return composeMail(ALERT_CATEGORIES.STEWARD_OVERRIDE_RELEASE, {
    recipientAccountId: sealOwnerAccountId,
    artifactId,
    artifactName,
    pageTitle,
    pageUrl,
    extra: { stewardDisplayName, unlockDate },
  });
}
