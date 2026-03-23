import api, { asUser, asApp, route } from "@forge/api";
import { kvs } from "@forge/kvs";
import { deriveSealState, eraseSealProperty, stampSealMutation } from "../data/guard-data.js";
import { fetchOperatorProfile } from "./mail-composer.js";
import {
  storeSignalEvent,
  postDocComment,
  notifySubscribers,
} from "../data/alert-store.js";
import { mailViolationAlert } from "./mail-composer.js";
import { deriveSignalFlags } from "../shared/alert-config.js";

/**
 * Fetches the full download URL for a specific artifact from Confluence
 * Uses the v2 API which returns downloadLink in the response
 * @param {string} artifactId - The ID of the artifact
 * @returns {Promise<string|null>} - The full download URL or null if not found
 */
export async function resolveArtifactUrl(artifactId) {
  try {
    const response = await asApp().requestConfluence(
      route`/wiki/api/v2/attachments/${artifactId}`,
      {
        headers: {
          Accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      console.error(
        `Failed to fetch artifact ${artifactId}: ${response.status} ${response.statusText}`,
      );
      return null;
    }

    const artifactData = await response.json();

    // The v2 API returns downloadLink directly and _links.download
    // downloadLink is the relative path, _links.base is the base URL
    const downloadLink =
      artifactData?.downloadLink || artifactData?._links?.download;
    const baseUrl = artifactData?._links?.base;

    if (!downloadLink) {
      console.warn(`No download link found for artifact ${artifactId}`);
      return null;
    }

    // If we have a base URL, construct the full URL
    // Otherwise return just the download path (which may work in some contexts)
    if (baseUrl) {
      return `${baseUrl}${downloadLink}`;
    }

    return downloadLink;
  } catch (error) {
    console.error(
      `Error fetching artifact download URL for ${artifactId}:`,
      error,
    );
    return null;
  }
}

/**
 * Get artifacts for a page with their seal status
 *
 * @param {string} contentId - The page/content ID
 * @param {string} userAccountId - The current user's account ID
 * @returns {Promise<Array>} Array of artifacts with seal status
 */
export async function fetchArtifactMetadata(contentId, userAccountId) {
  if (!contentId) {
    console.error("No content ID provided!");
    return [];
  }

  try {
    const response = await asUser().requestConfluence(
      route`/wiki/api/v2/pages/${contentId}/attachments`,
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to fetch artifacts:", response.status, errorText);
      return [];
    }

    const data = await response.json();

    if (!data || !data.results) {
      return [];
    }

    const artifactsWithStatus = await Promise.all(
      data.results.map(async (att) => {
        const { lockStatus, lockedByAccountId, expiresAt } =
          await deriveSealState(att.id, userAccountId);

        return {
          ...att,
          lockStatus,
          lockedByAccountId,
          expiresAt,
        };
      }),
    );

    return artifactsWithStatus;
  } catch (error) {
    console.error("Error fetching artifacts:", error);
    return [];
  }
}

/**
 * Handle artifact update events
 * Detects unauthorized edits and reverts them
 *
 * @param {Object} event - The event payload
 * @param {string} event.eventType - The event type
 * @param {string} event.atlassianId - The user's account ID
 * @param {Object} event.attachment - The attachment object
 * @returns {Promise<void>}
 */
export async function artifactEventHandler(event) {
  try {
    const { eventType, atlassianId, attachment } = event;

    if (eventType !== "avi:confluence:updated:attachment") {
      return;
    }

    if (!attachment || !attachment.id) {
      console.error("Invalid artifact event payload");
      return;
    }

    const artifactId = attachment.id;
    const userAccountId = atlassianId;
    const currentVersion = attachment.version?.number;

    // Prevent infinite loops - ignore edits made by our own app
    const shouldIgnore = await shouldIgnoreEvent(userAccountId);
    if (shouldIgnore) {
      return;
    }

    // Check if artifact is sealed
    const sealRecord = await kvs.get(`protection-${artifactId}`);

    if (!sealRecord) {
      return;
    }

    // Check if seal has expired
    if (sealRecord.expiresAt && new Date(sealRecord.expiresAt) < new Date()) {
      await kvs.delete(`protection-${artifactId}`);
      await stampSealMutation();
      // Also delete the seal property from the parent page for CQL searchability
      if (sealRecord.contentId) {
        await eraseSealProperty(sealRecord.contentId);
      }
      // Clean up space-seal index key
      if (sealRecord.spaceId) {
        try {
          await kvs.delete(`space-protection-${sealRecord.spaceId}-${artifactId}`);
        } catch (e) {
          /* best effort */
        }
      }
      await notifySubscribers(artifactId, {
        attachmentName: sealRecord.attachmentName,
        contentId: sealRecord.contentId,
      });
      return;
    }

    // Check ownership
    if (sealRecord.lockedBy === userAccountId) {
      return;
    }

    // VIOLATION: Unauthorized edit detected
    console.log(
      `Artifact ${artifactId} was edited while sealed by ${sealRecord.lockedBy}`,
    );

    const contentId = attachment.container?.id;
    if (!contentId) {
      console.error("No contentId found - cannot revert");
      return;
    }

    await handleSealViolation({
      artifactId,
      attachment,
      sealRecord,
      contentId,
      userAccountId,
      currentVersion,
    });
  } catch (error) {
    console.error("Unexpected error in artifactEventHandler:", error);
  }
}

/**
 * Check if the event should be ignored (app's own edits)
 *
 * @param {string} userAccountId - The user's account ID
 * @returns {Promise<boolean>} True if event should be ignored
 */
async function shouldIgnoreEvent(userAccountId) {
  // Prevent infinite loops - ignore edits made by our own app
  let appAccountId = await kvs.get("app-account-id");
  if (!appAccountId) {
    try {
      const myselfResponse = await asApp().requestConfluence(
        route`/wiki/rest/api/user/current`,
      );
      if (myselfResponse.ok) {
        const myself = await myselfResponse.json();
        appAccountId = myself.accountId;
        await kvs.set("app-account-id", appAccountId);
      }
    } catch (e) {
      console.error("Error fetching App Account ID:", e);
    }
  }

  if (appAccountId && userAccountId === appAccountId) {
    return true;
  }

  return false;
}

/**
 * Handle a seal violation by sending notifications and reverting the artifact
 *
 * @param {Object} params - The parameters
 * @param {string} params.artifactId - The artifact ID
 * @param {Object} params.attachment - The attachment object
 * @param {Object} params.sealRecord - The seal record object
 * @param {string} params.contentId - The content/page ID
 * @param {string} params.userAccountId - The violator's account ID
 * @param {number} params.currentVersion - The current version number
 * @returns {Promise<void>}
 */
async function handleSealViolation({
  artifactId,
  attachment,
  sealRecord,
  contentId,
  userAccountId,
  currentVersion,
}) {
  const artifactTitle = attachment.title || "Unknown Artifact";

  // Get user display names for better notifications
  const [ownerInfo, editorInfo] = await Promise.all([
    fetchOperatorProfile(sealRecord.lockedBy),
    fetchOperatorProfile(userAccountId),
  ]);

  // Store notification event for frontend (Options 1 & 2)
  await storeSignalEvent({
    type: "SEAL_CONFLICT",
    attachmentId: artifactId,
    attachmentName: artifactTitle,
    pageId: contentId,
    ownerAccountId: sealRecord.lockedBy,
    ownerDisplayName: ownerInfo.displayName,
    editorAccountId: userAccountId,
    editorDisplayName: editorInfo.displayName,
    action: "edit_reverted",
  });

  // Send Confluence notification via comment (Option 3)
  await postDocComment(
    contentId,
    sealRecord.lockedBy,
    userAccountId,
    artifactTitle,
    artifactId,
  );

  // Send email notification via Resend (Option 4)
  const alertConfig = await deriveSignalFlags();
  if (alertConfig.ENABLE_EMAIL_NOTIFICATIONS) {
    // Build page URL from available context in the event
    const siteBaseUrl =
      attachment.container?._links?.webui ||
      `https://your-site.atlassian.net/wiki`;
    const pageUrl = `${siteBaseUrl}/${contentId}`;
    const emailResult = await mailViolationAlert(
      sealRecord.lockedBy,
      userAccountId,
      artifactId,
      artifactTitle,
      "Confluence Page",
      pageUrl,
    );

    if (!emailResult.success) {
      console.warn(
        `Failed to send seal violation email for artifact ${artifactTitle}: ${emailResult.reason}`,
      );
    }
  }

  // Revert the artifact to previous version
  await rollbackArtifact(
    artifactId,
    contentId,
    currentVersion,
    artifactTitle,
  );
}

/**
 * Revert an artifact to the previous version
 *
 * @param {string} artifactId - The artifact ID
 * @param {string} contentId - The content/page ID
 * @param {number} currentVersion - The current version number
 * @param {string} artifactTitle - The artifact title (for logging)
 * @returns {Promise<void>}
 */
async function rollbackArtifact(
  artifactId,
  contentId,
  currentVersion,
  artifactTitle,
) {
  try {
    // Get artifact details with all versions
    const artifactRoute = route`/wiki/api/v2/attachments/${artifactId}?include-versions=true`;
    const artifactResponse = await asApp().requestConfluence(artifactRoute);

    if (!artifactResponse.ok) {
      console.error(
        `Failed to get artifact details: ${artifactResponse.status}`,
      );
      return;
    }

    const artifactDetails = await artifactResponse.json();
    const versions = artifactDetails.versions?.results || [];

    if (versions.length < 2) {
      console.warn(
        `Cannot revert artifact ${artifactId} - not enough versions`,
      );
      return;
    }

    // Find the previous version
    const previousVersion = versions.find(
      (v) => v.number === currentVersion - 1,
    );
    if (!previousVersion) {
      console.error(`Previous version ${currentVersion - 1} not found`);
      return;
    }

    console.log(
      `Reverting artifact ${artifactId} from version ${currentVersion} to ${previousVersion.number}`,
    );

    // Download the previous version
    const downloadRoute = route`/wiki/rest/api/content/${contentId}/child/attachment/${artifactId}/download?version=${previousVersion.number}`;
    const downloadResponse = await asApp().requestConfluence(downloadRoute);

    if (!downloadResponse.ok) {
      console.error(
        `Failed to download previous version: ${downloadResponse.status}`,
      );
      return;
    }

    // Re-upload the previous version
    const fileBuffer = await downloadResponse.arrayBuffer();
    const formData = new FormData();
    formData.append("file", new Blob([fileBuffer]), artifactDetails.title);
    formData.append(
      "comment",
      "(Sentinel-Vault automatically reverted changes)",
    );
    formData.append("minorEdit", "true");

    const updateRoute = route`/wiki/rest/api/content/${contentId}/child/attachment/${artifactId}/data`;
    const updateResponse = await asApp().requestConfluence(updateRoute, {
      method: "POST",
      headers: { "X-Atlassian-Token": "nocheck" },
      body: formData,
    });

    if (!updateResponse.ok) {
      console.error(`Failed to revert artifact: ${updateResponse.status}`);
      return;
    }

    console.log(
      `Successfully reverted ${artifactDetails.title} to version ${previousVersion.number}`,
    );
  } catch (error) {
    console.error("Error during artifact revert:", error);
  }
}

/**
 * Download an artifact's binary content
 *
 * @param {string} artifactId - The artifact ID
 * @param {string} contentId - The content/page ID
 * @param {number} [version] - Optional specific version to download
 * @returns {Promise<{buffer: ArrayBuffer, title: string}|null>}
 */
export async function downloadArtifactBinary(artifactId, contentId, version) {
  try {
    let downloadRoute;
    if (version) {
      downloadRoute = route`/wiki/rest/api/content/${contentId}/child/attachment/${artifactId}/download?version=${version}`;
    } else {
      downloadRoute = route`/wiki/rest/api/content/${contentId}/child/attachment/${artifactId}/download`;
    }

    const response = await asApp().requestConfluence(downloadRoute);

    if (!response.ok) {
      console.error(
        `Failed to download artifact ${artifactId}: ${response.status}`,
      );
      return null;
    }

    const buffer = await response.arrayBuffer();

    // Get title from artifact metadata
    const metaResponse = await asApp().requestConfluence(
      route`/wiki/api/v2/attachments/${artifactId}`,
      { headers: { Accept: "application/json" } },
    );

    let title = "unknown";
    if (metaResponse.ok) {
      const metaData = await metaResponse.json();
      title = metaData.title || "unknown";
    }

    return { buffer, title };
  } catch (error) {
    console.error(`Error downloading artifact ${artifactId}:`, error);
    return null;
  }
}
