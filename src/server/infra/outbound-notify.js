/**
 * Native Confluence notification transport
 *
 * Posts a footer comment on a page using `asApp().requestConfluence()`.
 * When the storage body contains `<ac:link><ri:user ri:account-id="..."/></ac:link>`
 * mention tags, Confluence's own notification engine notifies the mentioned user
 * (and may email them, subject to their personal notification preferences).
 *
 * No external egress, no API keys, no email service — this app never sends mail and never will;
 * "email" anywhere in this codebase means only "an @mention in a comment, which Confluence itself
 * may email". Qualifies for the "Runs on Atlassian" badge.
 */

import { asApp, route } from "@forge/api";
import { resolveBulletinToggles, resolveSpaceNotificationsMode } from "../shared/bulletin-flags.js";
import { shouldPostComment } from "../shared/notice-policy.js";
import { resolvePageSpaceKey } from "../shared/content-access.js";


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
 * THE single choke point for every comment (+ @mention) this app posts (P1-4). Two gates run
 * here, in order, and BOTH the global opt-in flags and the per-space quiet mode are enforced for
 * every caller — violations, seal created / released / forced, edit requests, approvals,
 * validations, the expiry sweep — whether or not the caller passed `spaceKey`.
 *
 * @param {Object} options
 * @param {string} options.pageId - ID of the Confluence page where the comment is posted
 * @param {string} options.storageBody - Confluence storage XML body (may contain mention tags)
 * @param {string} [options.spaceKey] - the page's space. Pass it when you have it; when absent it
 *   is derived from the page (`resolvePageSpaceKey`, two asApp reads). A caller that only holds a
 *   pageId therefore still gets the space's quiet mode applied — it just pays the lookup.
 * @param {string} [options.noticeType] - one of notice-composer's ALERT_CATEGORIES (or a caller
 *   label), for the log line and the pure decision.
 * @returns {Promise<{success: boolean, commentId?: string, reason?: string, suppressed?: boolean}>}
 *   `suppressed: true` marks a DELIBERATE non-post (a flag off, or quiet mode) as opposed to a
 *   transport failure — callers that count notices (the lapse sweep) advance on it; callers that
 *   claim a dedup marker (postDedupedFootnote) release it, so a later un-quiet gets its comment.
 */
export async function postCommentWithMention({ pageId, storageBody, spaceKey = null, noticeType = null }) {
  if (!pageId) {
    return { success: false, reason: "Missing pageId" };
  }
  if (!storageBody) {
    return { success: false, reason: "Missing storageBody" };
  }

  const toggles = await resolveBulletinToggles();
  // Quiet mode is per space; derive the space from the PAGE when the caller did not pass it
  // (never from any payload — the page is the object being commented on). Fail OPEN: an
  // unresolvable page (deleted, or an asApp blip) is treated as "normal" so a genuine notice is
  // not lost silently — the global flags still apply. The miss is logged.
  let resolvedSpaceKey = spaceKey;
  if (!resolvedSpaceKey) {
    resolvedSpaceKey = await resolvePageSpaceKey(pageId);
    if (!resolvedSpaceKey) {
      console.warn(`[NOTIFY] Could not resolve the space of page ${pageId} — quiet mode not applied (fail open)`);
    }
  }
  const mode = await resolveSpaceNotificationsMode(resolvedSpaceKey);
  const decision = shouldPostComment({ mode, flags: toggles, noticeType });
  if (!decision.post) {
    const why = decision.reason === "quiet-mode"
      ? `space ${resolvedSpaceKey} is in quiet mode`
      : "comments with @mentions are switched off (opt-in)";
    console.info(`[NOTIFY] ${noticeType || "comment"} on page ${pageId} not posted: ${why}`);
    return { success: false, suppressed: true, reason: `Not posted: ${why}` };
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
