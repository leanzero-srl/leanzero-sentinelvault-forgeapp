import { asUser, asApp, route } from "@forge/api";
import { kvs } from "@forge/kvs";

import {
  insertPanelNode,
  removePanelNode,
  panelExistsInDoc,
  readDocBody,
  locateExtensionNodes,
  isPanelExtensionKey,
  triggerPanelEmbed,
  resolveExtensionKey,
} from "../../infra/doc-surgery.js";

/**
 * Get attachments for a page with seal status, labels, and version comments
 * Enriched data specifically for the panel table
 */
const enumeratePanelArtifacts = async (req) => {
  const { pageId, cursor, limit = 10 } = req.payload;
  const contentId = pageId || req.context.extension?.content?.id;

  if (!contentId) {
    return { attachments: [], hasMore: false, nextCursor: null };
  }

  try {
    // Fetch global policy
    const globalPolicy = await kvs.get("admin-settings-global");
    const autoUnsealActive = globalPolicy?.autoUnlockEnabled !== false;
    const allowArtifactDelete =
      globalPolicy?.allowAttachmentDelete === true;
    const allowSealRestore = globalPolicy?.allowSealRestore === true;
    const allowSealPurge = globalPolicy?.allowSealPurge === true;

    // Fetch attachments via v2 API
    let url = route`/wiki/api/v2/pages/${contentId}/attachments?limit=${limit}`;
    if (cursor && cursor !== "0") {
      url = route`/wiki/api/v2/pages/${contentId}/attachments?limit=${limit}&cursor=${cursor}`;
    }

    const response = await asUser().requestConfluence(url);
    if (!response.ok) {
      console.error(
        `[PANEL] Failed to fetch attachments: ${response.status}`,
      );
      return { attachments: [], hasMore: false, nextCursor: null };
    }

    const data = await response.json();
    if (!data?.results) {
      return { attachments: [], hasMore: false, nextCursor: null };
    }

    const operatorAccountId = req.context.accountId;

    // Enrich each artifact with seal status, labels, and comments
    const enrichedArtifacts = await Promise.all(
      data.results.map(async (att) => {
        // Seal status
        const sealData = await kvs.get(`protection-${att.id}`);
        let sealStatus = "OPEN";
        let sealedByAccountId = null;
        let expiresAt = null;
        let isExpired = false;

        if (sealData) {
          const sealLapsed =
            sealData.expiresAt &&
            new Date(sealData.expiresAt) < new Date();

          if (sealData.lockedBy === operatorAccountId) {
            sealStatus = "HELD_BY_ACTOR";
          } else {
            sealStatus = "HELD";
          }
          sealedByAccountId = sealData.lockedBy;
          expiresAt = sealData.expiresAt;
          isExpired = sealLapsed;
        }

        // Labels via v2 API
        let labels = [];
        try {
          const labelsRes = await asUser().requestConfluence(
            route`/wiki/api/v2/attachments/${att.id}/labels`,
          );
          if (labelsRes.ok) {
            const labelsData = await labelsRes.json();
            labels = (labelsData.results || []).map((l) => ({
              id: l.id,
              name: l.name,
              prefix: l.prefix,
            }));
          }
        } catch (e) {
          console.warn(`[PANEL] Failed to fetch labels for ${att.id}:`, e);
        }

        // Version comment from the attachment itself
        const comment = att.version?.comment || null;

        // Check watch request state for this operator
        let watchRequested = false;
        if (sealData && sealData.lockedBy !== operatorAccountId) {
          try {
            const watchKey = `notify-request-${att.id}-${operatorAccountId}`;
            const watchData = await kvs.get(watchKey);
            watchRequested = !!watchData;
          } catch (e) {
            // ignore
          }
        }

        return {
          id: att.id,
          title: att.title,
          fileSize: att.fileSize || null,
          mediaType: att.mediaType || null,
          lockStatus: sealStatus,
          lockedByAccountId: sealedByAccountId,
          expiresAt,
          isExpired,
          autoUnlockEnabled: autoUnsealActive,
          allowDelete: allowArtifactDelete,
          allowRestore: allowSealRestore,
          allowPurge: allowSealPurge,
          labels,
          comment,
          notifyRequested: watchRequested,
        };
      }),
    );

    // Pagination
    const hasMore = !!(data._links && data._links.next);
    let nextCursor = null;
    if (hasMore && data._links.next) {
      try {
        const urlObj = new URL(data._links.next, "https://example.com");
        nextCursor = urlObj.searchParams.get("cursor");
      } catch (e) {
        console.warn("[PANEL] Failed to parse cursor:", e);
      }
    }

    return { attachments: enrichedArtifacts, hasMore, nextCursor };
  } catch (error) {
    console.error("[PANEL] Error fetching panel artifacts:", error);
    return { attachments: [], hasMore: false, nextCursor: null };
  }
};

/**
 * Add a label to an artifact (v1 API)
 */
const labelArtifact = async (req) => {
  const { attachmentId, labelName } = req.payload;

  if (!labelName || !attachmentId) {
    return { success: false, reason: "Missing attachmentId or labelName" };
  }

  try {
    const response = await asUser().requestConfluence(
      route`/wiki/rest/api/content/${attachmentId}/label`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: "global", name: labelName.trim() }),
      },
    );

    if (response.ok) {
      return { success: true };
    }

    const errorText = await response.text();
    console.error(`[PANEL] Failed to add label: ${response.status} - ${errorText}`);
    return { success: false, reason: `API error: ${response.status}` };
  } catch (error) {
    console.error("[PANEL] Error adding label:", error);
    return { success: false, reason: error.message };
  }
};

/**
 * Remove a label from an artifact (v1 API)
 */
const unlabelArtifact = async (req) => {
  const { attachmentId, labelName } = req.payload;

  if (!labelName || !attachmentId) {
    return { success: false, reason: "Missing attachmentId or labelName" };
  }

  try {
    const response = await asUser().requestConfluence(
      route`/wiki/rest/api/content/${attachmentId}/label/${labelName}`,
      { method: "DELETE" },
    );

    if (response.ok || response.status === 404) {
      return { success: true };
    }

    const errorText = await response.text();
    console.error(`[PANEL] Failed to remove label: ${response.status} - ${errorText}`);
    return { success: false, reason: `API error: ${response.status}` };
  } catch (error) {
    console.error("[PANEL] Error removing label:", error);
    return { success: false, reason: error.message };
  }
};

/**
 * Delete an artifact (moves to trash)
 * Conditional on global setting `allowAttachmentDelete`
 */
const deleteArtifact = async (req) => {
  const { attachmentId } = req.payload;

  if (!attachmentId) {
    return { success: false, reason: "Missing attachmentId" };
  }

  // Check global policy
  const globalPolicy = await kvs.get("admin-settings-global");
  if (globalPolicy?.allowAttachmentDelete !== true) {
    return { success: false, reason: "Attachment deletion is disabled by admin" };
  }

  try {
    // Check if artifact is sealed - prevent deleting sealed artifacts
    const sealData = await kvs.get(`protection-${attachmentId}`);
    if (sealData && sealData.lockedBy) {
      return {
        success: false,
        reason: "Cannot delete a locked attachment. Unlock it first.",
      };
    }

    const response = await asUser().requestConfluence(
      route`/wiki/api/v2/attachments/${attachmentId}`,
      { method: "DELETE" },
    );

    if (response.ok || response.status === 204) {
      return { success: true };
    }

    const errorText = await response.text();
    console.error(`[PANEL] Failed to delete artifact: ${response.status} - ${errorText}`);
    return { success: false, reason: `API error: ${response.status}` };
  } catch (error) {
    console.error("[PANEL] Error deleting artifact:", error);
    return { success: false, reason: error.message };
  }
};

/**
 * Inject the panel into a page (manual trigger from UI)
 */
const injectPanel = async (req) => {
  const { pageId } = req.payload;

  if (!pageId) {
    return { success: false, reason: "Missing pageId" };
  }

  const extensionKey = await resolveExtensionKey();
  if (!extensionKey) {
    return {
      success: false,
      reason: "Could not determine the macro extension key.",
    };
  }

  return await insertPanelNode(pageId, extensionKey);
};

/**
 * Remove the panel from a page
 */
const extractPanel = async (req) => {
  const { pageId } = req.payload;

  if (!pageId) {
    return { success: false, reason: "Missing pageId" };
  }

  return await removePanelNode(pageId);
};

/**
 * Check if the panel exists on a page + get page-level panel settings
 */
const checkPanelStatus = async (req) => {
  const pageId =
    req.payload?.pageId || req.context.extension?.content?.id;

  if (!pageId) {
    return { macroExists: false, macroDisabled: false };
  }

  let panelExists = false;
  try {
    const { adfDoc } = await readDocBody(pageId);
    panelExists = panelExistsInDoc(adfDoc);
  } catch (e) {
    console.warn("[PANEL] Failed to check panel existence:", e);
  }

  // Get page-level settings from content property
  let panelDisabled = false;
  try {
    const propsRes = await asApp().requestConfluence(
      route`/wiki/api/v2/pages/${pageId}/properties?key=sentinel-vault-page-settings`,
    );
    if (propsRes.ok) {
      const propsData = await propsRes.json();
      const pageSetting = propsData.results?.[0]?.value;
      panelDisabled = pageSetting?.macroDisabled === true;
    }
  } catch (e) {
    console.warn("[PANEL] Failed to get page panel settings:", e);
  }

  return { macroExists: panelExists, macroDisabled: panelDisabled };
};

/**
 * Save page-level panel settings (panelDisabled toggle)
 */
const storeDocPanelPrefs = async (req) => {
  const { macroDisabled } = req.payload;
  const pageId =
    req.payload?.pageId || req.context.extension?.content?.id;

  if (!pageId) {
    return { success: false, reason: "Missing pageId" };
  }

  const propertyKey = "sentinel-vault-page-settings";

  try {
    // Check if property already exists
    const getRes = await asApp().requestConfluence(
      route`/wiki/api/v2/pages/${pageId}/properties?key=${propertyKey}`,
    );

    if (getRes.ok) {
      const getBody = await getRes.json();
      const existing = getBody.results?.[0];

      if (existing) {
        // Update
        const propertyId = existing.id;
        const nextVersion = (existing.version?.number || 1) + 1;
        const putRes = await asApp().requestConfluence(
          route`/wiki/api/v2/pages/${pageId}/properties/${propertyId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              key: propertyKey,
              value: { macroDisabled },
              version: { number: nextVersion },
            }),
          },
        );
        if (!putRes.ok) {
          const errorText = await putRes.text();
          return { success: false, reason: `Update failed: ${putRes.status} - ${errorText}` };
        }
      } else {
        // Create
        const postRes = await asApp().requestConfluence(
          route`/wiki/api/v2/pages/${pageId}/properties`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              key: propertyKey,
              value: { macroDisabled },
            }),
          },
        );
        if (!postRes.ok) {
          const errorText = await postRes.text();
          return { success: false, reason: `Create failed: ${postRes.status} - ${errorText}` };
        }
      }
    }

    // If panel is being disabled and exists on page, optionally remove it
    if (macroDisabled) {
      try {
        await removePanelNode(pageId);
      } catch (e) {
        console.warn("[PANEL] Failed to remove panel after disabling:", e);
      }
    }

    return { success: true };
  } catch (error) {
    console.error("[PANEL] Error saving page panel settings:", error);
    return { success: false, reason: error.message };
  }
};

/**
 * Upload a file as an attachment to the current page
 */
const uploadArtifact = async (req) => {
  const { fileName, fileDataBase64, comment } = req.payload;
  const contentId =
    req.payload?.pageId || req.context.extension?.content?.id;

  if (!contentId) {
    return { success: false, reason: "Missing page context" };
  }
  if (!fileName || !fileDataBase64) {
    return { success: false, reason: "Missing file data" };
  }

  // Validate file size
  const estimatedBytes = fileDataBase64.length * 0.75;
  const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB
  if (estimatedBytes > MAX_FILE_SIZE) {
    return { success: false, reason: "File too large. Maximum size is 4 MB." };
  }

  try {
    const binaryData = Buffer.from(fileDataBase64, "base64");
    const formData = new FormData();
    formData.append("file", new Blob([binaryData]), fileName);
    if (comment) {
      formData.append("comment", comment);
    }
    formData.append("minorEdit", "true");

    const response = await asUser().requestConfluence(
      route`/wiki/rest/api/content/${contentId}/child/attachment`,
      {
        method: "POST",
        headers: { "X-Atlassian-Token": "nocheck" },
        body: formData,
      },
    );

    if (response.ok) {
      return { success: true };
    }

    const errorText = await response.text();
    console.error(
      `[PANEL] Failed to upload artifact: ${response.status} - ${errorText}`,
    );
    return { success: false, reason: `Upload failed: ${response.status}` };
  } catch (error) {
    console.error("[PANEL] Error uploading artifact:", error);
    return { success: false, reason: error.message };
  }
};

/**
 * Store the panel's extension key in KVS
 */
const registerPanelKey = async (req) => {
  const { extensionKey } = req.payload;

  if (!extensionKey) {
    return { success: false, reason: "Missing extensionKey" };
  }

  const existing = await kvs.get("macro-extension-key");
  if (existing !== extensionKey) {
    await kvs.set("macro-extension-key", extensionKey);
  }

  return { success: true };
};

/**
 * Discover the panel's extensionKey by reading the page ADF.
 */
const discoverPanelKey = async (req) => {
  const pageId =
    req.payload?.pageId || req.context.extension?.content?.id;

  if (!pageId) {
    return { success: false, reason: "Missing pageId" };
  }

  // Check if already discovered
  const existing = await kvs.get("macro-extension-key");
  if (existing) {
    return { success: true, alreadyStored: true };
  }

  try {
    const { adfDoc } = await readDocBody(pageId);

    // Find our panel's extension node in the ADF tree
    const nodes = locateExtensionNodes(
      adfDoc,
      (node) => isPanelExtensionKey(node.attrs?.extensionKey),
    );

    if (nodes.length === 0) {
      console.warn("[PANEL] Could not find Sentinel Vault panel node in page ADF");
      return { success: false, reason: "Macro node not found in page ADF" };
    }

    const extensionKey = nodes[0].attrs.extensionKey;
    await kvs.set("macro-extension-key", extensionKey);
    return { success: true, extensionKey };
  } catch (error) {
    console.error("[PANEL] Error discovering extension key:", error);
    return { success: false, reason: error.message };
  }
};

export const actions = [
  ["enumerate-panel-artifacts", enumeratePanelArtifacts],
  ["label-artifact", labelArtifact],
  ["unlabel-artifact", unlabelArtifact],
  ["delete-artifact", deleteArtifact],
  ["inject-panel", injectPanel],
  ["extract-panel", extractPanel],
  ["check-panel-status", checkPanelStatus],
  ["store-doc-panel-prefs", storeDocPanelPrefs],
  ["upload-artifact", uploadArtifact],
  ["register-panel-key", registerPanelKey],
  ["discover-panel-key", discoverPanelKey],
];
