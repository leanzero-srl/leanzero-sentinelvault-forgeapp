/**
 * Email templates for Sentinel Vault notifications
 * Redesigned with dark hero header, timeline layout, action pills, and Leanzero branding
 */

// ============================================================================
// STYLE CONSTANTS
// ============================================================================

const PALETTE = {
  // Background colors
  bgPrimary: "#FFFFFF",
  bgSecondary: "#F8F9FA",
  bgDark: "#1A1F2E",
  bgDarkSecondary: "#242938",

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
  textOnDark: "#E5E7EB",
  textOnDarkMuted: "#9CA3AF",

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
  fontSizeBase: "16px",
  fontSizeSmall: "14px",
  fontSizeXSmall: "13px",
  fontSizeXXSmall: "12px",
  lineHeight: "1.5",
  letterSpacing: "normal",
  letterSpacingButton: "0.02em",
  fontFamily:
    "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif",
};

const LEANZERO_URL = "https://leanzero.atlascrafted.com/overview";

// ============================================================================
// REUSABLE COMPONENTS
// ============================================================================

/**
 * Build a full-width status banner with colored top bar, icon, and message
 */
function composeStatusBanner({ badge, message, subMessage, type = "info", icon = "&#9670;" }) {
  const config = {
    danger: {
      barColor: PALETTE.cardDangerBorder,
      bg: PALETTE.cardDangerBg,
      badgeColor: PALETTE.cardDangerText,
      iconColor: PALETTE.cardDangerBorder,
    },
    info: {
      barColor: PALETTE.cardInfoBorder,
      bg: PALETTE.cardInfoBg,
      badgeColor: PALETTE.cardInfoText,
      iconColor: PALETTE.cardInfoBorder,
    },
    success: {
      barColor: PALETTE.cardSuccessBorder,
      bg: PALETTE.cardSuccessBg,
      badgeColor: PALETTE.cardSuccessText,
      iconColor: PALETTE.cardSuccessBorder,
    },
    warning: {
      barColor: PALETTE.cardWarningBorder,
      bg: PALETTE.cardWarningBg,
      badgeColor: PALETTE.cardWarningText,
      iconColor: PALETTE.cardWarningBorder,
    },
    "warning-light": {
      barColor: PALETTE.cardWarningBorder,
      bg: PALETTE.cardWarningBg,
      badgeColor: PALETTE.cardWarningText,
      iconColor: PALETTE.cardWarningBorder,
    },
  };

  const style = config[type];

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: 28px;">
      <!-- Color bar -->
      <tr>
        <td style="background-color: ${style.barColor}; height: 4px; border-radius: 8px 8px 0 0; font-size: 0; line-height: 0;">&nbsp;</td>
      </tr>
      <tr>
        <td style="background-color: ${style.bg}; padding: 20px 24px; border-radius: 0 0 8px 8px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td width="36" valign="top" style="padding-right: 14px;">
                <span style="font-size: 20px; color: ${style.iconColor};">${icon}</span>
              </td>
              <td valign="top">
                <p style="margin: 0 0 6px 0; color: ${style.badgeColor}; font-size: ${LAYOUT.fontSizeXXSmall}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;">
                  ${badge}
                </p>
                <p style="margin: 0; color: ${PALETTE.textPrimary}; font-size: ${LAYOUT.fontSizeBase}; line-height: ${LAYOUT.lineHeight};">
                  ${message}
                </p>
                ${subMessage ? `<p style="margin: 8px 0 0 0; color: ${PALETTE.textSecondary}; font-size: ${LAYOUT.fontSizeSmall}; line-height: 1.5;">${subMessage}</p>` : ""}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

/**
 * Build a vertical timeline with dot connectors for info items
 */
function composeTimeline({ title, items }) {
  const itemsHtml = items
    .map((item, index) => {
      const isLast = index === items.length - 1;
      const valueHtml = item.url
        ? `<a href="${item.url}" style="color: ${PALETTE.textAccent}; text-decoration: none; font-weight: 500; border-bottom: 1px solid ${PALETTE.textAccent};">${item.value}</a>`
        : `<span style="color: ${PALETTE.textPrimary}; font-weight: 500;">${item.value}</span>`;

      return `
        <tr>
          <td width="28" valign="top" style="padding: 0;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="28">
              <tr>
                <td align="center" style="width: 28px; padding-top: 3px;">
                  <!-- Dot -->
                  <div style="width: 10px; height: 10px; background-color: ${PALETTE.textAccent}; border-radius: 50%; margin: 0 auto;"></div>
                  ${!isLast ? `
                  <!--[if mso]>
                  <div style="width: 2px; height: 28px; background-color: ${PALETTE.borderLight}; margin: 4px auto 0 auto;">&nbsp;</div>
                  <![endif]-->
                  <!--[if !mso]><!-->
                  <div style="width: 2px; height: 28px; background-color: ${PALETTE.borderLight}; margin: 4px auto 0 auto;"></div>
                  <!--<![endif]-->
                  ` : ""}
                </td>
              </tr>
            </table>
          </td>
          <td valign="top" style="padding: 0 0 ${isLast ? "0" : "16px"} 8px;">
            <p style="margin: 0 0 2px 0; color: ${PALETTE.textTertiary}; font-size: ${LAYOUT.fontSizeXXSmall}; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em;">
              ${item.label}
            </p>
            <p style="margin: 0; font-size: ${LAYOUT.fontSizeSmall}; line-height: 1.4;">
              ${valueHtml}
            </p>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: 24px;">
      <tr>
        <td colspan="2" style="padding-bottom: 14px;">
          <p style="margin: 0; color: ${PALETTE.textSecondary}; font-size: ${LAYOUT.fontSizeXXSmall}; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em;">
            ${title}
          </p>
        </td>
      </tr>
      ${itemsHtml}
    </table>
  `;
}

/**
 * Build a 2-column grid of pill-shaped action items
 */
function composeActionPills({ title, items }) {
  // Build rows of 2 items each
  const rows = [];
  for (let i = 0; i < items.length; i += 2) {
    const left = items[i];
    const right = items[i + 1];
    rows.push(`
      <tr>
        <td width="50%" style="padding: 4px 4px 4px 0; vertical-align: top;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="background-color: ${PALETTE.bgSecondary}; border-radius: 6px; padding: 10px 14px;">
                <span style="color: ${PALETTE.textAccent}; font-size: 8px; vertical-align: middle;">&#9679;&ensp;</span>
                <span style="color: ${PALETTE.textPrimary}; font-size: ${LAYOUT.fontSizeSmall}; line-height: 1.4;">${left}</span>
              </td>
            </tr>
          </table>
        </td>
        ${right ? `
        <td width="50%" style="padding: 4px 0 4px 4px; vertical-align: top;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="background-color: ${PALETTE.bgSecondary}; border-radius: 6px; padding: 10px 14px;">
                <span style="color: ${PALETTE.textAccent}; font-size: 8px; vertical-align: middle;">&#9679;&ensp;</span>
                <span style="color: ${PALETTE.textPrimary}; font-size: ${LAYOUT.fontSizeSmall}; line-height: 1.4;">${right}</span>
              </td>
            </tr>
          </table>
        </td>
        ` : `<td width="50%" style="padding: 4px 0 4px 4px;">&nbsp;</td>`}
      </tr>
    `);
  }

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: 8px;">
      <tr>
        <td colspan="2" style="padding-bottom: 10px;">
          <p style="margin: 0; color: ${PALETTE.textSecondary}; font-size: ${LAYOUT.fontSizeXXSmall}; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em;">
            ${title}
          </p>
        </td>
      </tr>
      ${rows.join("")}
    </table>
  `;
}

/**
 * Build a ghost-style CTA button with colored border and text
 */
function composeCta({ text, url, type = "primary" }) {
  const config = {
    primary: PALETTE.btnPrimary,
    danger: PALETTE.btnDanger,
    success: PALETTE.btnSuccess,
    warning: PALETTE.btnWarning,
  };

  const accentColor = config[type] || config.primary;

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="padding-top: ${LAYOUT.paddingLarge}; text-align: center;">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${url}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="17%" stroke="t" strokecolor="${accentColor}" fillcolor="#ffffff">
            <v:stroke dashstyle="solid" weight="2px" color="${accentColor}" />
            <center style="color:${accentColor};font-family:${LAYOUT.fontFamily};font-size:${LAYOUT.fontSizeBase};font-weight:600;">${text}</center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-->
          <a href="${url}" style="display: inline-block; background-color: #ffffff; color: ${accentColor}; padding: 13px 36px; text-decoration: none; border-radius: 8px; font-size: ${LAYOUT.fontSizeBase}; font-weight: 600; letter-spacing: ${LAYOUT.letterSpacingButton}; min-width: 200px; text-align: center; border: 2px solid ${accentColor};">
            ${text} &rarr;
          </a>
          <!--<![endif]-->
        </td>
      </tr>
    </table>
  `;
}

// ============================================================================
// BASE EMAIL TEMPLATE
// ============================================================================

/**
 * Build base HTML email template with dark hero header, Leanzero ribbon, and refined footer
 */
function assembleEmailShell({ subject, previewText, title, bodyContent, statusColor = PALETTE.textAccent }) {
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
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { margin: 0 !important; padding: 0 !important; width: 100% !important; }
    a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; font-size: inherit !important; font-family: inherit !important; font-weight: inherit !important; line-height: inherit !important; }
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; margin: auto !important; }
      .mobile-padding { padding: 20px !important; }
      .stack-column { display: block !important; width: 100% !important; }
      .pill-cell { display: block !important; width: 100% !important; padding-left: 0 !important; padding-right: 0 !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: ${PALETTE.bgSecondary}; font-family: ${LAYOUT.fontFamily};">
  <!-- Preview text -->
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">${previewText}</div>

  <center style="width: 100%; background-color: ${PALETTE.bgSecondary}; padding: 24px 0;">
    <!--[if mso | IE]>
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: ${PALETTE.bgSecondary};">
    <tr><td align="center">
    <![endif]-->

    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="margin: 0 auto; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);" class="email-container">

      <!-- Status Color Bar -->
      <tr>
        <td style="background-color: ${statusColor}; height: 4px; font-size: 0; line-height: 0;">&nbsp;</td>
      </tr>

      <!-- Dark Hero Header -->
      <tr>
        <td style="background-color: ${PALETTE.bgDark}; padding: 32px 40px 28px 40px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td valign="middle" style="padding-right: 14px;" width="32">
                <span style="font-size: 24px; color: ${statusColor};">&#9733;</span>
              </td>
              <td valign="middle">
                <p style="margin: 0; color: ${PALETTE.textOnDark}; font-size: 20px; font-weight: 600; letter-spacing: -0.3px;">
                  Sentinel Vault
                </p>
                <p style="margin: 2px 0 0 0; color: ${PALETTE.textOnDarkMuted}; font-size: ${LAYOUT.fontSizeXXSmall}; letter-spacing: 0.04em;">
                  for Confluence
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Leanzero Ribbon -->
      <tr>
        <td style="background-color: ${PALETTE.bgDarkSecondary}; padding: 8px 40px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="font-size: ${LAYOUT.fontSizeXXSmall}; color: ${PALETTE.textOnDarkMuted};">
                Powered by <a href="${LEANZERO_URL}" style="color: ${PALETTE.textAccent}; text-decoration: none; font-weight: 600;">Leanzero</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Main Content -->
      <tr>
        <td style="padding: 36px 40px 20px 40px; background-color: ${PALETTE.bgPrimary};">
          <!-- Title -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="padding-bottom: 28px;">
                <h1 style="margin: 0; color: ${PALETTE.textPrimary}; font-size: 26px; font-weight: 700; line-height: 1.25; letter-spacing: -0.02em;">
                  ${title}
                </h1>
                <div style="margin-top: 12px; width: 40px; height: 3px; background-color: ${statusColor}; border-radius: 2px;"></div>
              </td>
            </tr>
          </table>

          <!-- Dynamic Body Content -->
          ${bodyContent}
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background-color: ${PALETTE.bgSecondary}; padding: 24px 40px; border-top: 1px solid ${PALETTE.borderLight};">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td style="text-align: center; color: ${PALETTE.textTertiary}; font-size: ${LAYOUT.fontSizeXXSmall}; line-height: 1.7;">
                <p style="margin: 0 0 8px 0;">
                  Automatically generated by Sentinel Vault &middot;
                  <a href="${LEANZERO_URL}" style="color: ${PALETTE.textAccent}; text-decoration: none;">Visit Leanzero</a>
                </p>
                <p style="margin: 0 0 8px 0; color: ${PALETTE.textTertiary};">
                  You received this because notifications are active for this file.
                  To opt out, contact your space administrator.
                </p>
                <p style="margin: 0; font-size: 11px; color: ${PALETTE.textTertiary};">
                  &copy; ${new Date().getFullYear()} Sentinel Vault &middot; All rights reserved
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
    statusColor: PALETTE.cardDangerBorder,
    bodyContent: `
      ${composeStatusBanner({
        type: "danger",
        icon: "&#9888;",
        badge: "UNAUTHORIZED CHANGE DETECTED",
        message: `<strong>${editorDisplayName}</strong> made changes to <strong>${artifactName}</strong> while it was under exclusive control of <strong>${ownerDisplayName}</strong>.`,
        subMessage:
          "Those changes have been automatically rolled back to the prior version.",
      })}

      ${composeTimeline({
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
    statusColor: PALETTE.cardSuccessBorder,
    bodyContent: `
      ${composeStatusBanner({
        type: "success",
        icon: "&#9989;",
        badge: "SEAL ACTIVE",
        message: `You have successfully sealed <strong>${artifactName}</strong> for exclusive use.`,
        subMessage:
          "No one else can modify this file while your seal is active.",
      })}

      ${composeTimeline({
        title: "Seal Summary",
        items: [
          { label: "File", value: artifactName, url: artifactUrl },
          { label: "Location", value: pageTitle, url: pageUrl },
          { label: "Valid until", value: expiryDate },
        ],
      })}

      ${composeActionPills({
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
    subject: "Your Seal Has Expired \u2014 Action Required",
    previewText: `Your seal on "${artifactName}" has expired`,
    title: "Seal Period Ended",
    statusColor: PALETTE.cardWarningBorder,
    bodyContent: `
      ${composeStatusBanner({
        type: "warning",
        icon: "&#9203;",
        badge: "SEAL EXPIRED \u2014 ACTION NEEDED",
        message: `Your seal on <strong>${artifactName}</strong> has expired. The file remains sealed until you release it.`,
        subMessage:
          "Please release the seal when you are finished to allow others to access this file.",
      })}

      ${composeTimeline({
        title: "Details",
        items: [
          { label: "Artifact", value: artifactName, url: artifactUrl },
          { label: "Page", value: pageTitle, url: pageUrl },
          { label: "Expired on", value: expiryDate },
        ],
      })}

      ${composeActionPills({
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
    subject: "File Now Accessible \u2014 Seal Cleared",
    previewText: `"${artifactName}" is now open for use`,
    title: "File Now Accessible",
    statusColor: PALETTE.cardSuccessBorder,
    bodyContent: `
      ${composeStatusBanner({
        type: "success",
        icon: "&#9989;",
        badge: "FILE IS NOW OPEN",
        message: `Great news! <strong>${artifactName}</strong> has been released and is ready for you to work with.`,
        subMessage:
          "You asked to be informed when this file became available.",
      })}

      ${composeTimeline({
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
    subject: "Seal Nearing Expiry \u2014 Half Time Elapsed",
    previewText: `Half of your seal time on "${artifactName}" has passed`,
    title: "Seal Half-Way Through",
    statusColor: PALETTE.cardWarningBorder,
    bodyContent: `
      ${composeStatusBanner({
        type: "warning-light",
        icon: "&#9202;",
        badge: "50% OF SEAL ELAPSED",
        message: `Your seal on <strong>${artifactName}</strong> is at the midpoint and will lapse soon.`,
        subMessage:
          "Consider wrapping up or renewing your seal.",
      })}

      ${composeTimeline({
        title: "Seal Summary",
        items: [
          { label: "File", value: artifactName, url: artifactUrl },
          { label: "Location", value: pageTitle, url: pageUrl },
          { label: "Lapses on", value: expiryDate },
        ],
      })}

      ${composeActionPills({
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
    statusColor: PALETTE.cardWarningBorder,
    bodyContent: `
      ${composeStatusBanner({
        type: "warning",
        icon: "&#128276;",
        badge: `HELD FOR ${daysSealed} DAYS`,
        message: `Just a reminder: <strong>${artifactName}</strong> has been sealed by you for <strong>${daysSealed} days</strong>.`,
      })}

      ${composeTimeline({
        title: "Seal Summary",
        items: [
          { label: "File", value: artifactName, url: artifactUrl },
          { label: "Location", value: pageTitle, url: pageUrl },
          { label: "Sealed since", value: sealDate },
          { label: "Duration", value: `${daysSealed} days` },
        ],
      })}

      ${composeActionPills({
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
    statusColor: PALETTE.cardWarningBorder,
    bodyContent: `
      ${composeStatusBanner({
        type: "warning",
        icon: "&#9881;",
        badge: "STEWARD ACTION",
        message: `Your seal on <strong>${artifactName}</strong> was removed by <strong>${stewardDisplayName}</strong> using elevated privileges.`,
        subMessage: "You no longer hold exclusive access to this file.",
      })}

      ${composeTimeline({
        title: "Action Summary",
        items: [
          { label: "File", value: artifactName, url: artifactUrl },
          { label: "Location", value: pageTitle, url: pageUrl },
          { label: "Cleared by", value: stewardDisplayName },
          { label: "Cleared on", value: unlockDate },
        ],
      })}

      ${composeActionPills({
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
