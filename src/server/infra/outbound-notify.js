/**
 * Native Confluence notification transport
 *
 * Posts a footer comment on a page using `asApp().requestConfluence()`.
 * When the storage body contains `<ac:link><ri:user ri:account-id="..."/></ac:link>`
 * mention tags, Confluence's notification engine emails the mentioned user
 * (subject to their personal notification preferences).
 *
 * No external egress, no API keys — qualifies for the "Runs on Atlassian" badge.
 */

import { asApp, route } from "@forge/api";
import { resolveBulletinToggles } from "../shared/bulletin-flags.js";

const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 600,
  maxDelayMs: 5000,
};

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableStatus = (status) => status === 429 || (status >= 500 && status < 600);

/**
 * Post a footer comment on a Confluence page.
 *
 * @param {Object} options
 * @param {string} options.pageId - ID of the Confluence page where the comment is posted
 * @param {string} options.storageBody - Confluence storage XML body (may contain mention tags)
 * @returns {Promise<{success: boolean, commentId?: string, reason?: string}>}
 */
export async function postCommentWithMention({ pageId, storageBody }) {
  if (!pageId) {
    return { success: false, reason: "Missing pageId" };
  }
  if (!storageBody) {
    return { success: false, reason: "Missing storageBody" };
  }

  const toggles = await resolveBulletinToggles();
  if (!toggles.ENABLE_NATIVE_NOTIFICATIONS) {
    return { success: false, reason: "Native notifications disabled" };
  }

  let lastReason = null;

  for (let attempt = 1; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const response = await asApp().requestConfluence(
        route`/wiki/api/v2/footer-comments`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            pageId,
            body: {
              representation: "storage",
              value: storageBody,
            },
          }),
        },
      );

      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        return { success: true, commentId: data?.id };
      }

      const errorText = await response.text().catch(() => response.statusText);
      lastReason = `HTTP ${response.status}: ${errorText}`;

      if (isRetryableStatus(response.status) && attempt < RETRY_CONFIG.maxRetries) {
        const delayMs = Math.min(
          RETRY_CONFIG.initialDelayMs * Math.pow(2, attempt - 1),
          RETRY_CONFIG.maxDelayMs,
        );
        console.warn(
          `[NOTIFY] Comment POST returned ${response.status} (attempt ${attempt}/${RETRY_CONFIG.maxRetries}), retrying in ${delayMs}ms`,
        );
        await pause(delayMs);
        continue;
      }

      console.error(`[NOTIFY] Failed to post comment on page ${pageId}: ${lastReason}`);
      return { success: false, reason: lastReason };
    } catch (error) {
      lastReason = error.message || "Unknown error";
      if (attempt < RETRY_CONFIG.maxRetries) {
        const delayMs = Math.min(
          RETRY_CONFIG.initialDelayMs * Math.pow(2, attempt - 1),
          RETRY_CONFIG.maxDelayMs,
        );
        console.warn(
          `[NOTIFY] Comment POST exception (attempt ${attempt}/${RETRY_CONFIG.maxRetries}): ${lastReason}; retrying in ${delayMs}ms`,
        );
        await pause(delayMs);
        continue;
      }
      console.error(`[NOTIFY] Comment POST failed after ${attempt} attempts:`, error);
      return { success: false, reason: lastReason };
    }
  }

  return { success: false, reason: lastReason || "Max retries exceeded" };
}
