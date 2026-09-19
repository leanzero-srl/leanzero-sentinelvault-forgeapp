import { kvs } from "@forge/kvs";
import { asApp, route } from "@forge/api";
import { authorizeSteward } from "../../shared/steward-checks.js";
import { BASELINE_HOLD_SPAN, sanitizeHoldDuration } from "../../shared/baseline.js";
import { notifyWatchers } from "../bulletins/logic.js";

/**
 * Resolve the effective seal hold period, in seconds, for a space.
 *
 * space policy (autoUnlockTimeoutHours) → global policy (defaultLockDuration) → baseline.
 *
 * This chain existed in three places — inline in sealArtifact, again as resolveHoldPeriod
 * in the section-seals capsule, and it was about to be written a fourth time for the
 * extend-seal action. Three copies of one rule is how they end up disagreeing about which
 * level wins, so there is one and the callers share it.
 *
 * The result is clamped: store-policy persists autoUnlockTimeoutHours / defaultLockDuration
 * RAW, so a negative or absurd stored value would otherwise flow into an expiresAt in the
 * past (a record that reads "sealed" while being unprotected) or an overflowing Date.
 */
export async function resolveSealHoldPeriod(spaceKey, override) {
  const explicit = sanitizeHoldDuration(override, 0);
  if (explicit) return explicit;

  if (spaceKey) {
    const sanitizedKey = String(spaceKey).replace(/[^a-zA-Z0-9:._\s-#]/g, "_");
    const spacePolicy = await kvs.get(`admin-settings-space-${sanitizedKey}`);
    if (spacePolicy?.autoUnlockTimeoutHours) {
      return sanitizeHoldDuration(spacePolicy.autoUnlockTimeoutHours * 3600, BASELINE_HOLD_SPAN);
    }
  }
  const globalPolicy = await kvs.get("admin-settings-global");
  if (globalPolicy?.defaultLockDuration) {
    return sanitizeHoldDuration(globalPolicy.defaultLockDuration, BASELINE_HOLD_SPAN);
  }
  return BASELINE_HOLD_SPAN;
}

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

/**
 * Whole-page attachment counts (tester report 2026-09-19: "AVAILABLE 11" was the number of cards
 * on screen — the real number was 13, one Show more away). The listers page 10 at a time and
 * enrich each card (labels, watches, previews), so the counts come from a separate cheap walk:
 * ids only, at most 4 × 250, one KVS get per id. Same seal test the cards use (a record with an
 * owner; trashed-only tracking records are not seals).
 */
export async function countPageAttachments(pageId, operatorAccountId, requestFn) {
  const counts = { total: 0, sealed: 0, sealedByMe: 0, available: 0, complete: true };
  let cursor = null;
  for (let page = 0; page < 4; page++) {
    const url = cursor
      ? route`/wiki/api/v2/pages/${pageId}/attachments?limit=250&cursor=${cursor}`
      : route`/wiki/api/v2/pages/${pageId}/attachments?limit=250`;
    const res = await requestFn(url);
    if (!res.ok) return { ...counts, complete: false };
    const data = await res.json();
    const ids = (data.results || []).map((a) => a.id).filter(Boolean);
    const seals = await Promise.all(ids.map((id) => kvs.get(`protection-${id}`).catch(() => null)));
    for (const seal of seals) {
      counts.total++;
      if (seal?.lockedBy && !seal.trashedOnly) { counts.sealed++; if (seal.lockedBy === operatorAccountId) counts.sealedByMe++; }
      else counts.available++;
    }
    const next = data._links?.next ? new URL(data._links.next, "https://x").searchParams.get("cursor") : null;
    if (!next) return counts;
    cursor = next;
  }
  return { ...counts, complete: false };
}
