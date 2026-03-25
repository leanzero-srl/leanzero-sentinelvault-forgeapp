/**
 * Internal Resend Configuration
 *
 * SECURITY WARNING:
 * This module contains sensitive Resend API credentials.
 * These are internal Sentinel Vault configurations and should NEVER be:
 * - Exposed through any API endpoints
 * - Modified by app users/admins
 * - Stored in external configuration files
 * - Committed to public repositories with actual values
 *
 * Resend credentials are for Sentinel Vault internal use only.
 * App users should not have access to these credentials.
 */

import { Resend } from "resend";
import { resolveBulletinToggles } from "../shared/bulletin-flags.js";

// =====================================================
// INTERNAL RESEND CONFIGURATION
// API key stored via Forge encrypted environment variables
// Set with: forge variables set --encrypt RESEND_API_KEY "your-key"
// =====================================================
const RESEND_CONFIG = {
  apiKey: process.env.RESEND_API_KEY,
  fromEmail: "noreply@leanzero.atlascrafted.com",
  domain: "leanzero.atlascrafted.com",
};

// Rate limiting configuration
const THROTTLE_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 600, // Start with 600ms (just over Resend's 2 req/sec limit)
  maxDelayMs: 5000, // Max 5 seconds between retries
};

// Initialize Resend client
const resend = new Resend(RESEND_CONFIG.apiKey);

// Export the from email for fallback use (when user has no email)
// This is safe to export as it's not sensitive (just the sender address)
export const SENDER_ADDRESS = RESEND_CONFIG.fromEmail;

/**
 * Sleep helper for retry delays
 * @param {number} ms - Milliseconds to sleep
 */
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Check if error is a rate limit error
 * @param {string} errorMessage - Error message from Resend
 * @returns {boolean}
 */
const isThrottleError = (errorMessage) => {
  return (
    errorMessage?.toLowerCase().includes("too many requests") ||
    errorMessage?.toLowerCase().includes("rate limit")
  );
};

/**
 * Send email via Resend API with automatic retry on rate limit
 *
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML body content
 * @param {string} [options.text] - Plain text body (optional)
 * @returns {Promise<{success: boolean, messageId?: string, reason?: string}>}
 */
export async function transmitMail({ to, subject, html, text }) {
  if (!RESEND_CONFIG.apiKey || !RESEND_CONFIG.fromEmail) {
    console.error("Resend not configured - missing API key or from email");
    return {
      success: false,
      reason: "Resend not configured",
    };
  }

  const alertConfig = await resolveBulletinToggles();

  if (!alertConfig.ENABLE_EMAIL_BULLETINS) {
    console.info(
      `Email not sent to ${to}: Email notifications disabled by admin settings`,
    );
    return {
      success: false,
      reason: "Email notifications disabled",
    };
  }

  // Retry loop with exponential backoff
  let lastError = null;
  for (let attempt = 1; attempt <= THROTTLE_CONFIG.maxRetries; attempt++) {
    try {
      const { data, error } = await resend.emails.send({
        from: `Sentinel Vault <${RESEND_CONFIG.fromEmail}>`,
        to: to,
        subject: subject,
        html: html,
        ...(text && { text }),
      });

      if (error) {
        lastError = error.message || "Unknown error";

        // Check if it's a rate limit error and we have retries left
        if (
          isThrottleError(lastError) &&
          attempt < THROTTLE_CONFIG.maxRetries
        ) {
          const delayMs = Math.min(
            THROTTLE_CONFIG.initialDelayMs * Math.pow(2, attempt - 1),
            THROTTLE_CONFIG.maxDelayMs,
          );
          console.warn(
            `Resend rate limit hit (attempt ${attempt}/${THROTTLE_CONFIG.maxRetries}), retrying in ${delayMs}ms...`,
          );
          await pause(delayMs);
          continue;
        }

        console.error(`Resend API error: ${lastError}`);
        return {
          success: false,
          reason: lastError,
        };
      }

      // Success!
      if (attempt > 1) {
        console.info(
          `Resend API success after ${attempt} attempts: Email sent to ${to}, messageId=${data.id}`,
        );
      } else {
        console.info(
          `Resend API success: Email sent to ${to}, messageId=${data.id}`,
        );
      }
      return {
        success: true,
        messageId: data.id,
      };
    } catch (error) {
      lastError = error.message || "Unknown error";

      // Check if it's a rate limit error and we have retries left
      if (
        isThrottleError(lastError) &&
        attempt < THROTTLE_CONFIG.maxRetries
      ) {
        const delayMs = Math.min(
          THROTTLE_CONFIG.initialDelayMs * Math.pow(2, attempt - 1),
          THROTTLE_CONFIG.maxDelayMs,
        );
        console.warn(
          `Resend rate limit hit (attempt ${attempt}/${THROTTLE_CONFIG.maxRetries}), retrying in ${delayMs}ms...`,
        );
        await pause(delayMs);
        continue;
      }

      console.error(`Resend exception: ${lastError}`);
      return {
        success: false,
        reason: lastError,
      };
    }
  }

  // Should not reach here, but just in case
  return {
    success: false,
    reason: lastError || "Max retries exceeded",
  };
}

/**
 * Get Resend configuration status (for internal debugging only)
 * Returns status without exposing actual credentials
 *
 * @returns {Object} Configuration status
 */
export function getResendStatus() {
  return {
    configured: !!(RESEND_CONFIG.apiKey && RESEND_CONFIG.fromEmail),
    fromEmail: RESEND_CONFIG.fromEmail,
    domain: RESEND_CONFIG.domain,
    apiKeySet: !!RESEND_CONFIG.apiKey,
  };
}

// Export main function (config is never exported directly)
export default {
  transmitMail,
  getResendStatus,
};
