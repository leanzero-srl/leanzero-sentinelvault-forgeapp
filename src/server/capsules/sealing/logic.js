import { kvs } from "@forge/kvs";
import { asApp, route } from "@forge/api";
import { authorizeSteward } from "../../shared/steward-checks.js";
import { notifyWatchers } from "../bulletins/logic.js";

/**
 * Update the seals-last-modified timestamp so the sealIndexCron
 * can skip full scans when nothing has changed.
 */
export async function touchSealTimestamp() {
  try {
    await kvs.set("protections-last-modified", Date.now());
  } catch (err) {
    console.warn("[touchSealTimestamp] Failed to update timestamp:", err);
  }
}

/**
 * Get seal status for an artifact
 *
 * @param {string} artifactId - The artifact ID
 * @returns {Promise<Object|null>} Seal status object or null if not sealed
 */
export async function readSealRecord(artifactId) {
  return await kvs.get(`protection-${artifactId}`);
}

/**
 * Store seal data as a content property on the parent page for CQL searchability
 * The property key is "protection-" which matches the manifest's contentPropertyIndex
 *
 * @param {string} contentId - The parent page/content ID
 * @param {Object} sealData - The seal data to store
 * @returns {Promise<void>}
 */
export async function writeSealContentProp(contentId, sealData) {
  const propertyKey = "protection-";
  try {
    // Check if property already exists by listing with key filter
    const getResponse = await asApp().requestConfluence(
      route`/wiki/api/v2/pages/${contentId}/properties?key=${propertyKey}`,
      { method: "GET" },
    );

    if (getResponse.ok) {
      const getBody = await getResponse.json();
      const existing = getBody.results?.[0];

      if (existing) {
        // Property exists — update using its numeric ID
        const propertyId = existing.id;
        const nextVersion = (existing.version?.number || 1) + 1;
        const putResponse = await asApp().requestConfluence(
          route`/wiki/api/v2/pages/${contentId}/properties/${propertyId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              key: propertyKey,
              value: sealData,
              version: { number: nextVersion },
            }),
          },
        );
        if (!putResponse.ok) {
          const errorText = await putResponse.text();
          console.error(
            `[SEAL-PROPERTY] Failed to update seal property: ${putResponse.status} - ${errorText}`,
          );
        }
      } else {
        // Property doesn't exist — create
        const postResponse = await asApp().requestConfluence(
          route`/wiki/api/v2/pages/${contentId}/properties`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              key: propertyKey,
              value: sealData,
            }),
          },
        );
        if (!postResponse.ok) {
          const errorText = await postResponse.text();
          console.error(
            `[SEAL-PROPERTY] Failed to create seal property: ${postResponse.status} - ${errorText}`,
          );
        }
      }
    } else {
      const errorText = await getResponse.text();
      console.error(
        `[SEAL-PROPERTY] Failed to check existing property: ${getResponse.status} - ${errorText}`,
      );
    }
  } catch (error) {
    console.error(`[SEAL-PROPERTY] Error storing seal property:`, error);
  }
}

/**
 * Delete seal data from content properties on the parent page
 *
 * @param {string} contentId - The parent page/content ID
 * @returns {Promise<void>}
 */
export async function removeSealContentProp(contentId) {
  const propertyKey = "protection-";
  try {
    // Look up the property by key to get its numeric ID
    const getResponse = await asApp().requestConfluence(
      route`/wiki/api/v2/pages/${contentId}/properties?key=${propertyKey}`,
      { method: "GET" },
    );

    if (!getResponse.ok) {
      // 404 means page not found — property is effectively gone
      if (getResponse.status === 404) return;
      const errorText = await getResponse.text();
      console.error(
        `[SEAL-PROPERTY] Failed to look up seal property for deletion: ${getResponse.status} - ${errorText}`,
      );
      return;
    }

    const getBody = await getResponse.json();
    const existing = getBody.results?.[0];
    if (!existing) return; // Property doesn't exist, nothing to delete

    const propertyId = existing.id;
    const response = await asApp().requestConfluence(
      route`/wiki/api/v2/pages/${contentId}/properties/${propertyId}`,
      {
        method: "DELETE",
      },
    );

    if (!response.ok && response.status !== 404) {
      const errorText = await response.text();
      console.error(
        `[SEAL-PROPERTY] Failed to delete seal property: ${response.status} - ${errorText}`,
      );
    }
  } catch (error) {
    console.error(`[SEAL-PROPERTY] Error deleting seal property:`, error);
  }
}

/**
 * Check if an artifact is sealed and if the seal has expired
 * Returns computed seal status accounting for expiry
 *
 * @param {string} artifactId - The artifact ID
 * @param {string} operatorAccountId - The current operator's account ID
 * @returns {Promise<Object>} Object with lockStatus, lockedByAccountId, and expiresAt
 */
export async function computeSealStatus(artifactId, operatorAccountId) {
  const sealRecord = await readSealRecord(artifactId);

  let computedSealState = "OPEN";
  let expiresAt = null;
  let heldByAccountId = null;

  if (sealRecord) {
    // Check if seal has expired
    if (sealRecord.expiresAt && new Date(sealRecord.expiresAt) < new Date()) {
      await kvs.delete(`protection-${artifactId}`);
      await touchSealTimestamp();
      // Also delete the seal property from the parent page for CQL searchability
      if (sealRecord.contentId) {
        await removeSealContentProp(sealRecord.contentId);
      }
      // Clean up realm-seal index key
      if (sealRecord.spaceId) {
        try {
          await kvs.delete(`space-protection-${sealRecord.spaceId}-${artifactId}`);
        } catch (e) {
          /* best effort */
        }
      }
      await notifyWatchers(artifactId, {
        attachmentName: sealRecord.attachmentName,
        contentId: sealRecord.contentId,
      });
      computedSealState = "OPEN";
    } else {
      // Seal is still valid
      if (sealRecord.lockedBy === operatorAccountId) {
        computedSealState = "HELD_BY_ACTOR";
        heldByAccountId = operatorAccountId;
      } else {
        computedSealState = "HELD";
        heldByAccountId = sealRecord.lockedBy;
      }
      expiresAt = sealRecord.expiresAt;
    }
  }

  return { lockStatus: computedSealState, lockedByAccountId: heldByAccountId, expiresAt };
}

/**
 * Break a seal on an artifact
 *
 * @param {string} artifactId - The artifact ID
 * @param {string} operatorAccountId - The operator's account ID
 * @param {string} [realmKey] - Optional realm key for steward check
 * @param {boolean} [stewardOverride=false] - Whether this is a steward override
 * @returns {Promise<{success: boolean, reason: string}>} Result object
 */
export async function breakSeal(
  artifactId,
  operatorAccountId,
  realmKey,
  stewardOverride = false,
) {
  const sealRecord = await readSealRecord(artifactId);

  if (!sealRecord) {
    return { success: false, reason: "Attachment is not locked" };
  }

  // Check if seal has expired - auto-unseal without permission check
  if (sealRecord.expiresAt && new Date(sealRecord.expiresAt) < new Date()) {
    await kvs.delete(`protection-${artifactId}`);
    await touchSealTimestamp();
    if (sealRecord.spaceId) {
      try {
        await kvs.delete(`space-protection-${sealRecord.spaceId}-${artifactId}`);
      } catch (e) {
        /* best effort */
      }
    }
    return { success: true, reason: "lock expired" };
  }

  let canRelease = false;
  let releaseReason = "";

  // Check if operator owns the seal
  if (sealRecord.lockedBy === operatorAccountId) {
    canRelease = true;
    releaseReason = "owner unlock";
  }
  // Check steward override capability
  else if (stewardOverride && realmKey) {
    const hasStewardPermission = await authorizeSteward(
      operatorAccountId,
      realmKey,
    );
    if (hasStewardPermission) {
      canRelease = true;
      releaseReason = "admin override";
    } else {
      return {
        success: false,
        reason: "Admin override denied - insufficient permissions",
      };
    }
  }
  // Unauthorized unseal attempt
  else {
    return {
      success: false,
      reason: "You do not have permission to unlock this attachment",
    };
  }

  if (canRelease) {
    await kvs.delete(`protection-${artifactId}`);
    await touchSealTimestamp();

    // Also delete the seal property from the parent page for CQL searchability
    if (sealRecord?.contentId) {
      await removeSealContentProp(sealRecord.contentId);
    }

    // Clean up realm-seal index key
    if (sealRecord?.spaceId) {
      try {
        await kvs.delete(`space-protection-${sealRecord.spaceId}-${artifactId}`);
      } catch (e) {
        /* best effort */
      }
    }

    return { success: true, reason: releaseReason };
  }

  return { success: false, reason: "Unlock failed" };
}
