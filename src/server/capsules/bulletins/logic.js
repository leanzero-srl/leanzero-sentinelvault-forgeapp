import { asApp, route } from "@forge/api";
import { kvs, WhereConditions } from "@forge/kvs";
import { fetchOperatorProfile, mailReleaseNotice } from "../../infra/mail-composer.js";
import { resolveBulletinToggles } from "../../shared/bulletin-flags.js";

/**
 * Send a Confluence bulletin via page footer comment
 * Used when an unauthorized edit attempt is detected
 *
 * @param {string} pageId - ID of the Confluence page
 * @param {string} ownerAccountId - Account ID of the operator who sealed the artifact
 * @param {string} editorAccountId - Account ID of the operator who attempted the edit
 * @param {string} artifactName - Name of the sealed artifact
 * @param {string} artifactId - ID of the artifact
 */
export async function postDocFootnote(
  pageId,
  ownerAccountId,
  editorAccountId,
  artifactName,
  artifactId,
) {
  const bulletinConfig = await resolveBulletinToggles();
  if (!bulletinConfig.ENABLE_CONFLUENCE_BULLETINS) {
    return;
  }

  try {
    const [ownerInfo, editorInfo] = await Promise.all([
      fetchOperatorProfile(ownerAccountId),
      fetchOperatorProfile(editorAccountId),
    ]);

    // Create a simple comment (plain text with user mentions)
    const commentBody = `<p><strong>🔒 Protection Alert</strong></p><p><ac:link><ri:user ri:account-id="${editorInfo.accountId}" /></ac:link> tried to edit <strong>"${artifactName}"</strong>, locked by <ac:link><ri:user ri:account-id="${ownerInfo.accountId}" /></ac:link>. Changes were reverted.</p>`;

    const response = await asApp().requestConfluence(
      route`/wiki/api/v2/footer-comments`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pageId: pageId,
          body: {
            representation: "storage",
            value: commentBody,
          },
        }),
      },
    );

    if (response.ok) {
      // Bulletin sent successfully
    } else {
      const errorText = await response.text();
      console.error(
        `Failed to send Confluence bulletin: ${response.status} - ${errorText}`,
      );
    }
  } catch (error) {
    console.error("Error sending Confluence bulletin:", error);
  }
}

/**
 * Store dispatch event for frontend to retrieve
 * Used by Options 1 & 2 (Toast + Page Banner)
 *
 * @param {Object} eventData - The event data to store
 * @param {string} eventData.type - Type of dispatch (e.g., "LOCK_CONFLICT")
 * @param {string} eventData.attachmentId - ID of the artifact
 * @param {string} eventData.attachmentName - Name of the artifact
 * @param {string} eventData.pageId - ID of the page
 * @param {string} eventData.ownerAccountId - Account ID of the sealer
 * @param {string} eventData.ownerDisplayName - Display name of the sealer
 * @param {string} eventData.editorAccountId - Account ID of the editor
 * @param {string} eventData.editorDisplayName - Display name of the editor
 * @param {string} eventData.action - Action that occurred (e.g., "edit_reverted")
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
    const dispatchId = `notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Store with expiresAt of 5 minutes (300 seconds = 300000 milliseconds)
    await kvs.set(
      dispatchId,
      {
        ...eventData,
        timestamp: new Date().toISOString(),
      },
      { expiresAt: Date.now() + 300000 },
    );

    // Also maintain a list of recent dispatches for page banner
    const recentBulletins = (await kvs.get("recent-notifications")) || {
      events: [],
    };
    recentBulletins.events.unshift({
      id: dispatchId,
      ...eventData,
      timestamp: new Date().toISOString(),
    });

    // Keep only last 10 dispatches
    recentBulletins.events = recentBulletins.events.slice(0, 10);

    await kvs.set("recent-notifications", recentBulletins, {
      expiresAt: Date.now() + 3600000,
    }); // 1 hour
  } catch (error) {
    console.error("Error storing dispatch event:", error);
  }
}

/**
 * Process and send "Notify Me" unseal bulletin emails.
 * Queries all notify-request-{artifactId}-* keys, sends emails, and cleans up.
 * Uses asApp() for API calls so it works in all contexts (operator, CRON, event handler).
 *
 * @param {string} artifactId - The artifact ID that was unsealed
 * @param {Object} opts
 * @param {string} [opts.attachmentName] - Artifact name (from seal data, avoids extra API call)
 * @param {string} [opts.contentId] - Parent page/content ID (from seal data)
 * @returns {Promise<{sent: number, failed: number}>}
 */
export async function notifyWatchers(
  artifactId,
  { attachmentName = "Unknown Attachment", contentId = null } = {},
) {
  const result = { sent: 0, failed: 0 };

  try {
    const bulletinConfig = await resolveBulletinToggles();

    if (!bulletinConfig.ENABLE_EMAIL_BULLETINS) {
      console.warn(
        "[NOTIFY-ME] Email bulletins are disabled globally - skipping",
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

    // Resolve page details once for all bulletins
    let pageTitle = "Unknown Page";
    let pageUrl = "";

    if (contentId) {
      try {
        const pageResponse = await asApp().requestConfluence(
          route`/wiki/api/v2/pages/${contentId}`,
        );
        if (pageResponse.ok) {
          const pageData = await pageResponse.json();
          pageTitle = pageData.title || "Unknown Page";
          const baseUrl = pageData._links?.base || "";
          const webui = pageData._links?.webui || "";
          pageUrl = baseUrl && webui ? `${baseUrl}${webui}` : "";
        }
      } catch (error) {
        console.warn("[NOTIFY-ME] Failed to fetch page details:", error);
      }
    }

    const unsealDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    for (const { key, value } of watcherRequests) {
      try {
        const emailResult = await mailReleaseNotice(
          value.accountId,
          artifactId,
          attachmentName,
          pageTitle,
          pageUrl,
          unsealDate,
        );

        if (emailResult.success) {
          result.sent++;
        } else {
          result.failed++;
          console.warn(
            `[NOTIFY-ME] Failed to send to ${value.accountId}: ${emailResult.reason}`,
          );
        }
      } catch (emailError) {
        result.failed++;
        console.error(
          `[NOTIFY-ME] Error sending to ${value.accountId}:`,
          emailError,
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
