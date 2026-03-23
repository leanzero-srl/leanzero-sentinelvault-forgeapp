import { kvs } from "@forge/kvs";
import { writeSealContentProp, removeSealContentProp, touchSealTimestamp } from "./logic.js";

/**
 * Write a per-artifact realm-seal index key for fast realm-scoped queries.
 * Key pattern: space-protection-{realmId}-{artifactId}
 * These keys are queryable via KVS beginsWith prefix.
 *
 * @param {string} realmId - The realm (space) ID
 * @param {string} artifactId - The artifact (attachment) ID
 * @param {Object} indexData - The index data to store
 * @param {string} indexData.artifactId - The artifact ID
 * @param {string} indexData.artifactName - The artifact name
 * @param {string} indexData.sealedBy - Account ID of sealer
 * @param {string} indexData.sealedByName - Display name of sealer
 * @param {string} indexData.timestamp - ISO timestamp of seal creation
 * @param {string} indexData.expiresAt - ISO expiry timestamp
 * @param {string} indexData.contentId - Parent page/content ID
 * @param {string} indexData.realmKey - The realm key
 * @param {string} indexData.pageTitle - Title of the parent page
 * @param {number|null} indexData.fileSize - File size in bytes
 * @param {string|null} indexData.creatorAccountId - Original creator account ID
 * @returns {Promise<void>}
 */
export async function writeRealmSealIndex(realmId, artifactId, indexData) {
  try {
    await kvs.set(`space-protection-${realmId}-${artifactId}`, {
      attachmentId: indexData.artifactId,
      attachmentName: indexData.artifactName,
      lockedBy: indexData.sealedBy,
      lockedByName: indexData.sealedByName,
      timestamp: indexData.timestamp,
      expiresAt: indexData.expiresAt,
      contentId: indexData.contentId || null,
      spaceKey: indexData.realmKey || null,
      pageTitle: indexData.pageTitle,
      fileSize: indexData.fileSize || null,
      creatorName: null, // v2 API only returns authorId, not display name
      creatorAccountId: indexData.creatorAccountId || null,
    });
    console.log(
      `[SEAL-SYNC] Wrote realm-seal index key for artifact ${artifactId} in realm ${realmId}`,
    );
  } catch (indexError) {
    console.warn(
      `[SEAL-SYNC] Failed to write realm-seal index:`,
      indexError,
    );
  }
}

/**
 * Remove a realm-seal index key when a seal is broken.
 *
 * @param {string} realmId - The realm (space) ID
 * @param {string} artifactId - The artifact (attachment) ID
 * @returns {Promise<void>}
 */
export async function removeRealmSealIndex(realmId, artifactId) {
  try {
    await kvs.delete(`space-protection-${realmId}-${artifactId}`);
    console.log(
      `[SEAL-SYNC] Removed realm-seal index key for artifact ${artifactId} in realm ${realmId}`,
    );
  } catch (indexError) {
    console.warn(`[SEAL-SYNC] Failed to delete realm-seal index:`, indexError);
  }
}

/**
 * Synchronise seal data to Confluence content properties on a page.
 * Creates or updates the "protection-" content property for CQL searchability.
 *
 * @param {string} contentId - The parent page/content ID
 * @param {Object} sealData - The seal payload to persist as content property
 * @returns {Promise<void>}
 */
export async function syncSealToContentProp(contentId, sealData) {
  if (!contentId) return;
  await writeSealContentProp(contentId, sealData);
}

/**
 * Remove seal content property from a page when it is unsealed.
 *
 * @param {string} contentId - The parent page/content ID
 * @returns {Promise<void>}
 */
export async function clearSealContentProp(contentId) {
  if (!contentId) return;
  await removeSealContentProp(contentId);
}

/**
 * Full cleanup of all seal-related external state for an artifact.
 * Removes KVS seal record, content property, and realm index key.
 *
 * @param {string} artifactId - The artifact (attachment) ID
 * @param {Object} sealRecord - The existing seal record
 * @param {string} [sealRecord.contentId] - Parent page ID
 * @param {string} [sealRecord.spaceId] - Realm/space ID
 * @returns {Promise<void>}
 */
export async function purgeAllSealState(artifactId, sealRecord) {
  await kvs.delete(`protection-${artifactId}`);
  await touchSealTimestamp();

  if (sealRecord?.contentId) {
    await removeSealContentProp(sealRecord.contentId);
  }

  if (sealRecord?.spaceId) {
    try {
      await kvs.delete(`space-protection-${sealRecord.spaceId}-${artifactId}`);
    } catch (e) {
      /* best effort */
    }
  }
}
