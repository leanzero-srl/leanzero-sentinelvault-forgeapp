/**
 * Email templates for Sentinel Vault notifications
 * Branded email templates
 * Refactored with modular, reusable components for consistency and maintainability
 */

// ============================================================================
// STYLE CONSTANTS
// ============================================================================

const PALETTE = {
  // Background colors
  bgPrimary: "#FFFFFF",
  bgSecondary: "#F8F9FA",

  // Card variants - muted pastels
  cardDangerBg: "#FEF2F2",
  cardDangerBorder: "#DC2626",
  cardDangerText: "#991B1B",
  cardInfoBg: "#F0FDFA",
  cardInfoBorder: "#0D9488",
  cardInfoText: "#115E59",
  cardSuccessBg: "#F0FDF4",
  cardSuccessBorder: "#059669",
  cardSuccessText: "#065F46",
  cardWarningBg: "#FFFBEB",
  cardWarningBorder: "#D97706",
  cardWarningText: "#92400E",

  // Border colors
  borderLight: "#E5E7EB",
  borderMedium: "#D1D5DB",

  // Text colors
  textPrimary: "#111827",
  textSecondary: "#4B5563",
  textTertiary: "#9CA3AF",
  textAccent: "#0D9488",

  // Button colors
  btnPrimary: "#0D9488",
  btnPrimaryHover: "#0F766E",
  btnDanger: "#DC2626",
  btnSuccess: "#059669",
  btnWarning: "#D97706",
};

const LAYOUT = {
  paddingSmall: "16px",
  paddingMedium: "24px",
  paddingLarge: "32px",
  borderRadius: "8px",
  fontSizeBase: "16px", // Increased from 15px for better readability
  fontSizeSmall: "14px",
  fontSizeXSmall: "13px",
  fontSizeXXSmall: "12px",
  lineHeight: "1.5",
  letterSpacing: "normal", // Remove wide spacing for body text
  letterSpacingButton: "0.02em",
  fontFamily:
    "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif",
};

// ============================================================================
// REUSABLE COMPONENTS
// ============================================================================

/**
 * Build an alert/info card component
 * @param {Object} params
 * @param {string} params.badge - Badge text (e.g., "SEAL EXPIRING SOON")
 * @param {string} params.message - Main message
 * @param {string} params.subMessage - Optional sub-message
 * @param {string} params.type - Card type: 'danger', 'info', 'success', 'warning'
 * @returns {string} HTML string
 */
function composeNoticeBlock({ badge, message, subMessage, type = "info" }) {
  const config = {
    danger: {
      bg: PALETTE.cardDangerBg,
      border: PALETTE.cardDangerBorder,
      badgeColor: PALETTE.cardDangerText,
    },
    info: {
      bg: PALETTE.cardInfoBg,
      border: PALETTE.cardInfoBorder,
      badgeColor: PALETTE.cardInfoText,
    },
    success: {
      bg: PALETTE.cardSuccessBg,
      border: PALETTE.cardSuccessBorder,
      badgeColor: PALETTE.cardSuccessText,
    },
    warning: {
      bg: PALETTE.cardWarningBg,
      border: PALETTE.cardWarningBorder,
      badgeColor: PALETTE.cardWarningText,
    },
    "warning-light": {
      bg: PALETTE.cardWarningBg,
      border: PALETTE.cardWarningBorder,
      badgeColor: PALETTE.cardWarningText,
    },
  };

  const style = config[type];

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: ${style.bg}; border-left: 3px solid ${style.border}; border-radius: 8px; margin-bottom: 24px;">
      <tr>
        <td style="padding: ${LAYOUT.paddingSmall};">
          <p style="margin: 0 0 12px 0; color: ${style.badgeColor}; font-size: ${LAYOUT.fontSizeSmall}; font-weight: 500;">
            ${badge}
          </p>
          <p style="margin: 0; color: ${PALETTE.textPrimary}; font-size: ${LAYOUT.fontSizeBase}; line-height: ${LAYOUT.lineHeight};">
            ${message}
          </p>
          ${subMessage ? `<p style="margin: 0; color: ${PALETTE.textSecondary}; font-size: ${LAYOUT.fontSizeSmall};">${subMessage}</p>` : ""}
        </td>
      </tr>
    </table>
  `;
}

/**
 * Build a details section with label-value pairs
 * @param {Object} params
 * @param {string} params.title - Section title (e.g., "Seal Details")
 * @param {Array<{label: string, value: string, url?: string}>} params.items - Array of label-value objects (optional url for hyperlink)
 * @returns {string} HTML string
 */
function composeInfoGrid({ title, items }) {
  const itemsHtml = items
    .map((item, index) => {
      const valueHtml = item.url
        ? `<a href="${item.url}" style="color: ${PALETTE.textAccent}; text-decoration: underline;">${item.value}</a>`
        : item.value;

      return `
    <tr>
      <td style="padding: 8px 0 ${index < items.length - 1 ? "16px" : "0"} 0; color: ${PALETTE.textPrimary}; font-size: ${LAYOUT.fontSizeSmall};">
        <span style="color: ${PALETTE.textSecondary};">${item.label}:</span> ${valueHtml}
      </td>
    </tr>
  `;
    })
    .join("");

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="padding-bottom: 16px;">
          <p style="margin: 0 0 8px 0; color: ${PALETTE.textSecondary}; font-size: ${LAYOUT.fontSizeXXSmall}; font-weight: 500; text-transform: uppercase; letter-spacing: ${LAYOUT.letterSpacing};">
            ${title}
          </p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            ${itemsHtml}
          </table>
        </td>
      </tr>
    </table>
  `;
}

/**
 * Build a checklist/recommendations section
 * @param {Object} params
 * @param {string} params.title - Section title (e.g., "What You Can Do")
 * @param {Array<string>} params.items - Array of recommendation strings
 * @returns {string} HTML string
 */
function composeActionList({ title, items }) {
  const itemsHtml = items
    .map(
      (item) => `
    <tr>
      <td style="padding: 12px 0; color: ${PALETTE.textPrimary}; font-size: ${LAYOUT.fontSizeBase}; line-height: ${LAYOUT.lineHeight};">
        <span style="color: ${PALETTE.textAccent}; font-weight: 500;">&#8226;</span> ${item}
      </td>
    </tr>
  `,
    )
    .join("");

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="padding: ${LAYOUT.paddingMedium} 0 0 0;">
          <p style="margin: 0 0 8px 0; color: ${PALETTE.textSecondary}; font-size: ${LAYOUT.fontSizeXXSmall}; font-weight: 500; text-transform: uppercase; letter-spacing: ${LAYOUT.letterSpacing};">
            ${title}
          </p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            ${itemsHtml}
          </table>
        </td>
      </tr>
    </table>
  `;
}

/**
 * Build a CTA button
 * @param {Object} params
 * @param {string} params.text - Button text
 * @param {string} params.url - Button URL
 * @param {string} params.type - Button type: 'primary', 'danger', 'success', 'warning'
 * @returns {string} HTML string
 */
function composeCta({ text, url, type = "primary" }) {
  const config = {
    primary: PALETTE.btnPrimary,
    danger: PALETTE.btnDanger,
    success: PALETTE.btnSuccess,
    warning: PALETTE.btnWarning,
  };

  const bgColor = config[type] || config.primary;

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="padding-top: ${LAYOUT.paddingLarge}; text-align: center;">
          <a href="${url}" style="display: inline-block; background-color: ${bgColor}; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-size: ${LAYOUT.fontSizeBase}; font-weight: 500; letter-spacing: ${LAYOUT.letterSpacingButton}; min-width: 200px; text-align: center;">
            ${text}
          </a>
        </td>
      </tr>
    </table>
  `;
}

/**
 * Build a simple text list (without checkmarks)
 * @param {Object} params
 * @param {string} params.title - Section title
 * @param {Array<string>} params.items - Array of text items
 * @returns {string} HTML string
 */
function composeTextList({ title, items }) {
  const itemsHtml = items
    .map(
      (item) => `
    <tr>
      <td style="padding: 12px 0; color: ${PALETTE.textPrimary}; font-size: ${LAYOUT.fontSizeBase}; line-height: ${LAYOUT.lineHeight};">
        ${item}
      </td>
    </tr>
  `,
    )
    .join("");

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="padding: ${LAYOUT.paddingMedium} 0 0 0;">
          <p style="margin: 0 0 8px 0; color: ${PALETTE.textSecondary}; font-size: ${LAYOUT.fontSizeXXSmall}; font-weight: 500; text-transform: uppercase; letter-spacing: ${LAYOUT.letterSpacing};">
            ${title}
          </p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            ${itemsHtml}
          </table>
        </td>
      </tr>
    </table>
  `;
}

// ============================================================================
// BASE EMAIL TEMPLATE
// ============================================================================

/**
 * Build base HTML email template with consistent header/footer
 * This ensures all emails have the same branding and structure
 *
 * @param {Object} params - Template parameters
 * @param {string} params.subject - Email subject (used in title)
 * @param {string} params.previewText - Preview text for email clients
 * @param {string} params.title - Main heading in body
 * @param {string} params.bodyContent - Main content HTML (varies by email type)
 * @returns {string} - Complete HTML email content
 */
function assembleEmailShell({ subject, previewText, title, bodyContent }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${subject}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style type="text/css">
    /* Reset */
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { margin: 0 !important; padding: 0 !important; width: 100% !important; }
    a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; font-size: inherit !important; font-family: inherit !important; font-weight: inherit !important; line-height: inherit !important; }
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; margin: auto !important; }
      .mobile-padding { padding: 20px !important; }
      .stack-column { display: block !important; width: 100% !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: ${PALETTE.bgPrimary}; font-family: ${LAYOUT.fontFamily};">
  <center style="width: 100%; background-color: ${PALETTE.bgPrimary};">
    <!--[if mso | IE]>
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: ${PALETTE.bgPrimary};">
    <tr><td align="center">
    <![endif]-->

    <!-- Email Container -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="margin: 0 auto;" class="email-container">

      <!-- Header -->
      <tr>
        <td style="padding: 40px 40px 30px 40px; background-color: ${PALETTE.bgPrimary};">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="text-align: center;">
                <h2 style="margin: 0; color: ${PALETTE.textAccent}; font-size: 24px; font-weight: 600; letter-spacing: -0.5px;">
                  Sentinel Vault for Confluence
                </h2>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 16px; text-align: center;">
                <hr style="border: none; border-top: 2px solid ${PALETTE.textAccent}; margin: 0; width: 80%;">
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Main Content -->
      <tr>
        <td style="padding: 40px 40px 30px 40px; background-color: ${PALETTE.bgPrimary};">
          <!-- Title -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="padding-bottom: 24px;">
                <h1 style="margin: 0; color: ${PALETTE.textPrimary}; font-size: 28px; font-weight: 600; line-height: 1.3; letter-spacing: -0.02em;">
                  ${title}
                </h1>
              </td>
            </tr>
          </table>

          <!-- Dynamic Body Content -->
          ${bodyContent}

        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="padding: 30px 40px 40px 40px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="text-align: center; color: ${PALETTE.textTertiary}; font-size: ${LAYOUT.fontSizeXSmall}; line-height: 1.6;">
                <p style="margin: 0 0 12px 0;">
                  This message was generated automatically by Sentinel Vault for Confluence.
                </p>
                <p style="margin: 0;">
                  You are receiving this because notifications are active for this file.
                  <br>
                  To opt out, please reach out to your space administrator.
                </p>
                <p style="margin: 16px 0 0 0; font-size: 11px; color: ${PALETTE.textTertiary};">
                  &copy; ${new Date().getFullYear()} Sentinel Vault. All rights reserved.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

    </table>
    <!--[if mso | IE]>
    </td></tr>
    </table>
    <![endif]-->
  </center>
</body>
</html>`;
}

// ============================================================================
// EMAIL TEMPLATE EXPORTS
// ============================================================================

/**
 * Build seal violation email HTML
 * @param {Object} params
 * @param {string} params.editorDisplayName - Name of user who attempted edit
 * @param {string} params.ownerDisplayName - Name of user who holds the seal
 * @param {string} params.artifactName - Name of artifact
 * @param {string} params.artifactUrl - URL to the artifact
 * @param {string} params.pageTitle - Title of page
 * @param {string} params.pageUrl - URL to the page
 * @returns {string} HTML email content
 */
export function composeViolationLayout({
  editorDisplayName,
  ownerDisplayName,
  artifactName,
  artifactUrl,
  pageTitle,
  pageUrl,
}) {
  return assembleEmailShell({
    subject: "Unauthorized Modification Notice",
    previewText: `Unverified change intercepted on "${artifactName}"`,
    title: "Unverified File Modification Intercepted",
    bodyContent: `
      ${composeNoticeBlock({
        type: "danger",
        badge: "UNAUTHORIZED CHANGE DETECTED",
        message: `<strong>${editorDisplayName}</strong> made changes to <strong>${artifactName}</strong> while it was under exclusive control of <strong>${ownerDisplayName}</strong>.`,
        subMessage:
          "Those changes have been automatically rolled back to the prior version.",
      })}

      ${composeInfoGrid({
        title: "Incident Summary",
        items: [
          { label: "File", value: artifactName, url: artifactUrl },
          { label: "Location", value: pageTitle, url: pageUrl },
          { label: "Held by", value: ownerDisplayName },
        ],
      })}

      ${composeCta({ text: "Open File Location", url: pageUrl, type: "danger" })}
    `,
  });
}

/**
 * Build seal created confirmation email HTML
 * Sent when a user successfully seals an artifact
 * @param {Object} params
 * @param {string} params.ownerDisplayName - Name of user who sealed the artifact
 * @param {string} params.artifactName - Name of artifact
 * @param {string} params.artifactUrl - URL to the artifact
 * @param {string} params.pageTitle - Title of page
 * @param {string} params.pageUrl - URL to the page
 * @param {string} params.expiryDate - Formatted expiry date
 * @returns {string} HTML email content
 */
export function composeSealConfirmLayout({
  ownerDisplayName,
  artifactName,
  artifactUrl,
  pageTitle,
  pageUrl,
  expiryDate,
}) {
  return assembleEmailShell({
    subject: "Seal Confirmed",
    previewText: `You have sealed "${artifactName}" successfully`,
    title: "Seal Confirmed",
    bodyContent: `
      ${composeNoticeBlock({
        type: "success",
        badge: "SEAL ACTIVE",
        message: `You have successfully sealed <strong>${artifactName}</strong> for exclusive use.`,
        subMessage:
          "No one else can modify this file while your seal is active.",
      })}

      ${composeInfoGrid({
        title: "Seal Summary",
        items: [
          { label: "File", value: artifactName, url: artifactUrl },
          { label: "Location", value: pageTitle, url: pageUrl },
          { label: "Valid until", value: expiryDate },
        ],
      })}

      ${composeActionList({
        title: "Available Options",
        items: [
          "Edit the file freely during your seal period",
          "Renew by releasing and re-sealing before it lapses",
          "Release the seal once your work is complete",
          "Reach out to your space administrator for extended access",
        ],
      })}

      ${composeCta({ text: "Open File Location", url: pageUrl, type: "primary" })}
    `,
  });
}

/**
 * Build expiry notification email HTML
 * Sent when a seal has expired but persists until manually released
 * @param {Object} params
 * @param {string} params.ownerDisplayName - Name of user who sealed the artifact
 * @param {string} params.artifactName - Name of artifact
 * @param {string} params.artifactUrl - URL to the artifact
 * @param {string} params.pageTitle - Title of page
 * @param {string} params.pageUrl - URL to the page
 * @param {string} params.expiryDate - Formatted expiry date
 * @returns {string} HTML email content
 */
export function composeExpiryLayout({
  ownerDisplayName,
  artifactName,
  artifactUrl,
  pageTitle,
  pageUrl,
  expiryDate,
}) {
  return assembleEmailShell({
    subject: "Your Seal Has Expired — Action Required",
    previewText: `Your seal on "${artifactName}" has expired`,
    title: "Seal Period Ended",
    bodyContent: `
      ${composeNoticeBlock({
        type: "warning",
        badge: "SEAL EXPIRED — ACTION NEEDED",
        message: `Your seal on <strong>${artifactName}</strong> has expired. The file remains sealed until you release it.`,
        subMessage:
          "Please release the seal when you are finished to allow others to access this file.",
      })}

      ${composeInfoGrid({
        title: "Details",
        items: [
          { label: "Artifact", value: artifactName, url: artifactUrl },
          { label: "Page", value: pageTitle, url: pageUrl },
          { label: "Expired on", value: expiryDate },
        ],
      })}

      ${composeActionList({
        title: "What You Can Do",
        items: [
          "Release the seal if you are done with your work",
          "Keep it sealed if you still need exclusive access",
          "Contact your space administrator if you need assistance",
        ],
      })}

      ${composeCta({ text: "Go to Page", url: pageUrl, type: "warning" })}
    `,
  });
}

// Backwards compatibility alias
export const composeAutoReleaseLayout = composeExpiryLayout;

/**
 * Build manual release notification email HTML (Notify Me feature)
 * @param {Object} params
 * @param {string} params.requesterDisplayName - Name of user who requested notification
 * @param {string} params.artifactName - Name of artifact
 * @param {string} params.artifactUrl - URL to the artifact
 * @param {string} params.pageTitle - Title of page
 * @param {string} params.pageUrl - URL to the page
 * @param {string} params.unlockDate - Formatted unlock date
 * @returns {string} HTML email content
 */
export function composeReleaseNoticeLayout({
  requesterDisplayName,
  artifactName,
  artifactUrl,
  pageTitle,
  pageUrl,
  unlockDate,
}) {
  return assembleEmailShell({
    subject: "File Now Accessible — Seal Cleared",
    previewText: `"${artifactName}" is now open for use`,
    title: "File Now Accessible",
    bodyContent: `
      ${composeNoticeBlock({
        type: "success",
        badge: "FILE IS NOW OPEN",
        message: `Great news! <strong>${artifactName}</strong> has been released and is ready for you to work with.`,
        subMessage:
          "You asked to be informed when this file became available.",
      })}

      ${composeInfoGrid({
        title: "File Information",
        items: [
          { label: "File", value: artifactName, url: artifactUrl },
          { label: "Location", value: pageTitle, url: pageUrl },
          { label: "Released on", value: unlockDate },
        ],
      })}

      ${composeCta({ text: "Open File Now", url: pageUrl, type: "success" })}
    `,
  });
}

/**
 * Build 50% seal expiry reminder email HTML
 * Sent when a seal has reached 50% of its duration
 * @param {Object} params
 * @param {string} params.ownerDisplayName - Name of user who sealed the artifact
 * @param {string} params.artifactName - Name of artifact
 * @param {string} params.artifactUrl - URL to the artifact
 * @param {string} params.pageTitle - Title of page
 * @param {string} params.pageUrl - URL to the page
 * @param {string} params.expiryDate - Formatted expiry date
 * @returns {string} HTML email content
 */
export function composeHalfwayLayout({
  ownerDisplayName,
  artifactName,
  artifactUrl,
  pageTitle,
  pageUrl,
  expiryDate,
}) {
  return assembleEmailShell({
    subject: "Seal Nearing Expiry — Half Time Elapsed",
    previewText: `Half of your seal time on "${artifactName}" has passed`,
    title: "Seal Half-Way Through",
    bodyContent: `
      ${composeNoticeBlock({
        type: "warning-light",
        badge: "50% OF SEAL ELAPSED",
        message: `Your seal on <strong>${artifactName}</strong> is at the midpoint and will lapse soon.`,
        subMessage:
          "Consider wrapping up or renewing your seal.",
      })}

      ${composeInfoGrid({
        title: "Seal Summary",
        items: [
          { label: "File", value: artifactName, url: artifactUrl },
          { label: "Location", value: pageTitle, url: pageUrl },
          { label: "Lapses on", value: expiryDate },
        ],
      })}

      ${composeActionList({
        title: "Available Options",
        items: [
          "Wrap up before the seal lapses",
          "Renew by releasing and immediately re-sealing",
          "Release the file if your work is done",
        ],
      })}

      ${composeCta({ text: "Open File Location", url: pageUrl, type: "warning" })}
    `,
  });
}

/**
 * Build periodic reminder email for sealed artifacts
 * @param {Object} params
 * @param {string} params.ownerDisplayName - Name of user who sealed the artifact
 * @param {string} params.artifactName - Name of artifact
 * @param {string} params.artifactUrl - URL to the artifact
 * @param {string} params.pageTitle - Title of page
 * @param {string} params.pageUrl - URL to the page
 * @param {string} params.sealDate - Date when artifact was sealed
 * @param {string} params.daysSealed - Number of days sealed
 * @returns {string} HTML email content
 */
export function composePeriodicLayout({
  ownerDisplayName,
  artifactName,
  artifactUrl,
  pageTitle,
  pageUrl,
  sealDate,
  daysSealed,
}) {
  return assembleEmailShell({
    subject: `Heads Up: "${artifactName}" Is Still Under Your Control`,
    previewText: `You have held "${artifactName}" for ${daysSealed} days`,
    title: "File Still Under Your Seal",
    bodyContent: `
      ${composeNoticeBlock({
        type: "warning",
        badge: `HELD FOR ${daysSealed} DAYS`,
        message: `Just a reminder: <strong>${artifactName}</strong> has been sealed by you for <strong>${daysSealed} days</strong>.`,
      })}

      ${composeInfoGrid({
        title: "Seal Summary",
        items: [
          { label: "File", value: artifactName, url: artifactUrl },
          { label: "Location", value: pageTitle, url: pageUrl },
          { label: "Sealed since", value: sealDate },
          { label: "Duration", value: `${daysSealed} days` },
        ],
      })}

      ${composeTextList({
        title: "Available Options",
        items: [
          "Release the file if your work is finished",
          "Maintain the seal if you still require sole access",
          "Get in touch with your space administrator for help",
        ],
      })}

      ${composeCta({ text: "Manage Seal", url: pageUrl, type: "primary" })}
    `,
  });
}

/**
 * Build steward override release notification email HTML
 * Sent to the seal owner when a steward forcefully releases their artifact
 * @param {Object} params
 * @param {string} params.ownerDisplayName - Name of user who owned the seal
 * @param {string} params.stewardDisplayName - Name of steward who performed the release
 * @param {string} params.artifactName - Name of artifact
 * @param {string} params.artifactUrl - URL to the artifact
 * @param {string} params.pageTitle - Title of page
 * @param {string} params.pageUrl - URL to the page
 * @param {string} params.unlockDate - Formatted unlock date
 * @returns {string} HTML email content
 */
export function composeStewardOverrideLayout({
  ownerDisplayName,
  stewardDisplayName,
  artifactName,
  artifactUrl,
  pageTitle,
  pageUrl,
  unlockDate,
}) {
  return assembleEmailShell({
    subject: "Steward Released Your Seal",
    previewText: `A steward has released your seal on "${artifactName}"`,
    title: "Seal Cleared by Steward",
    bodyContent: `
      ${composeNoticeBlock({
        type: "warning",
        badge: "STEWARD ACTION",
        message: `Your seal on <strong>${artifactName}</strong> was removed by <strong>${stewardDisplayName}</strong> using elevated privileges.`,
        subMessage: "You no longer hold exclusive access to this file.",
      })}

      ${composeInfoGrid({
        title: "Action Summary",
        items: [
          { label: "File", value: artifactName, url: artifactUrl },
          { label: "Location", value: pageTitle, url: pageUrl },
          { label: "Cleared by", value: stewardDisplayName },
          { label: "Cleared on", value: unlockDate },
        ],
      })}

      ${composeActionList({
        title: "Available Options",
        items: [
          "Re-seal the file if you still need sole access",
          "Contact the steward if this was unintended",
          "Back up any ongoing work to prevent conflicts",
        ],
      })}

      ${composeCta({ text: "Open File Location", url: pageUrl, type: "primary" })}
    `,
  });
}
