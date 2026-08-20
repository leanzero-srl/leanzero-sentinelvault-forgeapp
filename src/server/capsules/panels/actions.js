import { asUser, asApp, route } from "@forge/api";
import { kvs } from "@forge/kvs";
import { withinUploadSizeLimit, MAX_UPLOAD_LABEL } from "../../shared/upload-limits.js";
import { canEditPage, canReadPage, mustVerify } from "../../shared/content-access.js";
import { isOperatorSiteAdmin } from "../../shared/steward-checks.js";

import {
  insertPanelNode,
  removePanelNode,
  panelExistsInDoc,
  readDocBody,
  locateExtensionNodes,
  isPanelExtensionKey,
  triggerPanelEmbed,
  resolveExtensionKey,
  deriveExtensionKeyFromContext,
} from "../../infra/doc-surgery.js";
import { resolveArtifactPreview } from "../../infra/artifact-fetch.js";

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
      globalPolicy?.allowArtifactDelete === true;
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
          downloadLink: att.downloadLink || att._links?.download || null,
          webuiLink: att.webuiLink || att._links?.webui || null,
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
 * Works for any attachment state: unsealed, sealed (own claim), or stale.
 * If sealed, removes the seal record first to prevent auto-restore triggers.
 * Conditional on global setting `allowAttachmentDelete`
 */
export const deleteArtifact = async (req) => {
  const { attachmentId } = req.payload;

  if (!attachmentId) {
    return { success: false, reason: "Missing attachmentId" };
  }

  // Check global policy
  const globalPolicy = await kvs.get("admin-settings-global");
  if (globalPolicy?.allowArtifactDelete !== true) {
    return { success: false, reason: "Attachment deletion is disabled by admin" };
  }

  try {
    // Block deletion of attachments sealed by another user
    const sealData = await kvs.get(`protection-${attachmentId}`);
    if (sealData && sealData.lockedBy && sealData.lockedBy !== req.context.accountId) {
      return {
        success: false,
        reason: "Cannot delete an attachment sealed by another user.",
      };
    }

    // For unsealed items, fetch metadata before trashing so we can create a tracking record
    let attTitle = "Unknown Attachment";
    const isUnsealed = !sealData;
    if (isUnsealed) {
      try {
        const attRes = await asApp().requestConfluence(
          route`/wiki/api/v2/attachments/${attachmentId}`,
        );
        if (attRes.ok) {
          const attData = await attRes.json();
          attTitle = attData.title || attTitle;
        }
      } catch (_) { /* best effort */ }
    }

    const response = await asUser().requestConfluence(
      route`/wiki/api/v2/attachments/${attachmentId}`,
      { method: "DELETE" },
    );

    if (response.ok || response.status === 204) {
      // For unsealed items, create a tracking record so trashed item is discoverable
      if (isUnsealed) {
        const contentId = req.context.extension?.content?.id;
        const spaceId = req.context.extension?.content?.space?.id || null;
        await kvs.set(`protection-${attachmentId}`, {
          lockedBy: req.context.accountId,
          timestamp: new Date().toISOString(),
          contentId,
          spaceId,
          attachmentId,
          attachmentName: attTitle,
          trashedOnly: true,
        });
        const { touchSealTimestamp } = await import("../sealing/logic.js");
        await touchSealTimestamp();
      } else if (sealData.lockedBy === req.context.accountId && !sealData.trashedOnly) {
        // Hunt F2: deleting your OWN sealed file releases the seal — convert the live record
        // to an inert S7 trashedOnly tracking record HERE, not only in the trash trigger (the
        // trashed:attachment event can drop). A live seal left behind would let the next
        // non-owner page save un-trash this deliberate delete and blame a bystander.
        // Merge onto a fresh read — the trash trigger's own conversion can race this write.
        const freshSeal = (await kvs.get(`protection-${attachmentId}`)) || sealData;
        await kvs.set(`protection-${attachmentId}`, { ...freshSeal, trashedOnly: true });
        const { touchSealTimestamp } = await import("../sealing/logic.js");
        await touchSealTimestamp();
      }
      return { success: true };
    }

    const errorText = await response.text();
    console.error(`[PANEL] Failed to delete attachment: ${response.status} - ${errorText}`);
    return { success: false, reason: `API error: ${response.status}` };
  } catch (error) {
    console.error("[PANEL] Error deleting attachment:", error);
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

  // SV-SEC-1. insertPanelNode reads and REWRITES this page through asApp(), which carries
  // site-wide write:confluence-content, and pageId comes straight off the payload — so
  // ungated this let any logged-in user append a node to, and bump the version of, any page
  // on the site. Unconditional: this is a write, and a context id would only prove the
  // caller can see the page, not change it.
  if (!(await canEditPage(req.context.accountId, pageId))) {
    return { success: false, reason: "You do not have permission to edit this page" };
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

  // SV-SEC-1, mirror of injectPanel: removePanelNode is the same asApp() read+write. Stripping
  // the panel off a page is removing the protection surface, so it needs the edit bar too.
  if (!(await canEditPage(req.context.accountId, pageId))) {
    return { success: false, reason: "You do not have permission to edit this page" };
  }

  return await removePanelNode(pageId);
};

/**
 * Check if the panel exists on a page + get page-level panel settings
 */
const checkPanelStatus = async (req) => {
  const ctxPageId = req.context.extension?.content?.id;
  const pageId = req.payload?.pageId || ctxPageId;

  if (!pageId) {
    return { macroExists: false, macroDisabled: false };
  }

  // SV-SEC-1 (disclosure side): reads the page body via asApp(). What leaks is thin — two
  // booleans — but it is still an oracle over pages the caller cannot open, so a payload-named
  // id gets checked. A context id does not: rendering here already required read access.
  if (mustVerify(req.payload?.pageId, ctxPageId)
    && !(await canReadPage(req.context.accountId, pageId))) {
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

  // SV-SEC-1. Two privileged writes hang off this pageId: the content property below (asApp)
  // and, when macroDisabled is set, removePanelNode — an asApp body rewrite. So ungated, any
  // logged-in user could permanently suppress the protection panel on a page they have no
  // rights to. Unconditional, as for every other write path: the overlay's only call site
  // passes pageId: null and picks up the context id, which is unaffected by this.
  if (!(await canEditPage(req.context.accountId, pageId))) {
    return { success: false, reason: "You do not have permission to change settings for this page" };
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

  // it57: validate the RAW (decoded) file size via the shared helper — the 4 MB limit is on the
  // decoded bytes, not the ~33%-larger base64 string; the limit + label live together so they stay in sync.
  if (!withinUploadSizeLimit(fileDataBase64.length)) {
    return { success: false, reason: `File too large. Maximum size is ${MAX_UPLOAD_LABEL}.` };
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

  // SV-SEC-1. This value is TENANT-GLOBAL and the app stamps it, as the app, into the ADF of
  // every page it auto-embeds the panel onto — so an arbitrary string accepted here is written
  // site-wide under write:confluence-content. Nothing in the UI calls this action; the correct
  // key is derivable from the Forge app context, so the caller's value is MATCHED against the
  // derived one rather than believed. If the context cannot produce one, fall back to a shape
  // check behind a site-admin gate rather than accepting anything.
  const canonical = deriveExtensionKeyFromContext();
  if (canonical) {
    if (extensionKey !== canonical) {
      return { success: false, reason: "Rejected: not this app's macro key" };
    }
  } else if (!isPanelExtensionKey(extensionKey)
    || !(await isOperatorSiteAdmin(req.context.accountId))) {
    return { success: false, reason: "Not authorized" };
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
  const ctxPageId = req.context.extension?.content?.id;
  const pageId = req.payload?.pageId || ctxPageId;

  if (!pageId) {
    return { success: false, reason: "Missing pageId" };
  }

  // SV-SEC-1: reads the page ADF via asApp(), and what it finds is written to the same
  // tenant-global key registerPanelKey guards. A payload-named page gets a read check.
  if (mustVerify(req.payload?.pageId, ctxPageId)
    && !(await canReadPage(req.context.accountId, pageId))) {
    return { success: false, reason: "Not authorized" };
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

const resolvePreview = async (req) => {
  const { artifactId, contentId } = req.payload;
  if (!artifactId || !contentId) {
    return null;
  }
  // SV-SEC-1 (the worst of the set). Both ids came from the payload and the download ran as
  // the app, so this returned the raw bytes of any attachment on the site as a base64 data
  // URI — and because the caller also supplied mediaType, claiming "image/png" skipped the
  // metadata read that enforced image-only and the 5 MB cap, making it any file of any size.
  // Two changes: the type/size are now read from the attachment (artifact-fetch.js) and the
  // download runs as the user; this gate is the third, so the caller cannot even probe an
  // attachment on a page they may not read.
  if (!(await canReadPage(req.context.accountId, contentId))) {
    return null;
  }
  return resolveArtifactPreview(artifactId, contentId);
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
  ["resolve-artifact-preview", resolvePreview],
];
