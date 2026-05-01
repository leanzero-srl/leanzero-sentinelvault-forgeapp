import { kvs, WhereConditions } from "@forge/kvs";
import { mailReleaseNotice, mailViolationAlert } from "../../infra/notice-composer.js";
import { resolveBulletinToggles } from "../../shared/bulletin-flags.js";

/**
 * Post a Confluence footer comment with mentions of the seal owner and the
 * editor who attempted the unauthorized change. Confluence's own notification
 * engine then emails the mentioned users (subject to their preferences).
 *
 * @param {string} pageId - ID of the Confluence page
 * @param {string} ownerAccountId - Account ID of the seal owner
 * @param {string} editorAccountId - Account ID of the editor who attempted the change
 * @param {string} artifactName - Name of the sealed artifact
 * @param {string} actionVerb - "edit" | "delete" | "content-removal"
 */
export async function postDocFootnote(
  pageId,
  ownerAccountId,
  editorAccountId,
  artifactName,
  actionVerb = "edit",
) {
  const bulletinConfig = await resolveBulletinToggles();
  if (!bulletinConfig.ENABLE_CONFLUENCE_BULLETINS) {
    return;
  }

  await mailViolationAlert(
    ownerAccountId,
    editorAccountId,
    artifactName,
    pageId,
    actionVerb,
  );
}

/**
 * Store dispatch event for frontend to retrieve.
 * Used by the toast/page-banner surfaces.
 */
export async function recordDispatch(eventData) {
  const bulletinConfig = await resolveBulletinToggles();
  if (
    !bulletinConfig.ENABLE_TOAST_DISPATCHES &&
    !bulletinConfig.ENABLE_PAGE_BANNERS
  ) {
    return;
  }

  try {
    const dispatchId = `notification-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    await kvs.set(
      dispatchId,
      {
        ...eventData,
        timestamp: new Date().toISOString(),
      },
      { expiresAt: Date.now() + 300000 },
    );

    const recentBulletins = (await kvs.get("recent-notifications")) || {
      events: [],
    };
    recentBulletins.events.unshift({
      id: dispatchId,
      ...eventData,
      timestamp: new Date().toISOString(),
    });

    recentBulletins.events = recentBulletins.events.slice(0, 10);

    await kvs.set("recent-notifications", recentBulletins, {
      expiresAt: Date.now() + 3600000,
    });
  } catch (error) {
    console.error("Error storing dispatch event:", error);
  }
}

/**
 * Process and send "Notify Me" release notifications.
 * Queries all notify-request-{artifactId}-* keys, posts a comment with mention
 * to each watcher, and cleans up the keys.
 *
 * @param {string} artifactId - The artifact ID that was unsealed
 * @param {Object} opts
 * @param {string} [opts.attachmentName]
 * @param {string} [opts.contentId] - Parent page ID
 * @returns {Promise<{sent: number, failed: number}>}
 */
export async function notifyWatchers(
  artifactId,
  { attachmentName = "Unknown Attachment", contentId = null } = {},
) {
  const result = { sent: 0, failed: 0 };

  try {
    const bulletinConfig = await resolveBulletinToggles();

    if (!bulletinConfig.ENABLE_NATIVE_NOTIFICATIONS) {
      console.warn(
        "[NOTIFY-ME] Native notifications are disabled globally - skipping",
      );
      return result;
    }

    if (!contentId) {
      console.warn(
        `[NOTIFY-ME] Missing contentId for artifact ${artifactId} - cannot post comment`,
      );
      return result;
    }

    const watcherPrefix = `notify-request-${artifactId}-`;
    const { results: watcherRequests } = await kvs
      .query()
      .where("key", WhereConditions.beginsWith(watcherPrefix))
      .limit(50)
      .getMany();

    if (!watcherRequests || watcherRequests.length === 0) {
      return result;
    }

    console.info(
      `[NOTIFY-ME] Found ${watcherRequests.length} "Notify Me" requests for artifact ${artifactId}`,
    );

    const unsealDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    for (const { key, value } of watcherRequests) {
      try {
        const noticeResult = await mailReleaseNotice(
          value.accountId,
          attachmentName,
          contentId,
          unsealDate,
        );

        if (noticeResult.success) {
          result.sent++;
        } else {
          result.failed++;
          console.warn(
            `[NOTIFY-ME] Failed to notify ${value.accountId}: ${noticeResult.reason}`,
          );
        }
      } catch (noticeError) {
        result.failed++;
        console.error(
          `[NOTIFY-ME] Error notifying ${value.accountId}:`,
          noticeError,
        );
      } finally {
        await kvs.delete(key);
      }
    }

    console.info(
      `[NOTIFY-ME] Processed ${watcherRequests.length} requests: ${result.sent} sent, ${result.failed} failed`,
    );
  } catch (error) {
    console.error("[NOTIFY-ME] Error processing notify-me requests:", error);
  }

  return result;
}
