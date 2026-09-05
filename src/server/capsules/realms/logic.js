import { asUser, route } from "@forge/api";
import { kvs, WhereConditions } from "@forge/kvs";

/**
 * Resolve realm (space) details by realm key.
 *
 * @param {string} realmKey - The Confluence space key
 * @returns {Promise<Object>} Realm information with key, name, and id
 */
export async function resolveRealm(realmKey) {
  if (!realmKey) {
    throw new Error("Space key is required");
  }

  // v2, as the user. The v1 `/rest/api/space/{key}` call this used to make answers a Forge
  // asUser() request with a non-2xx on this site (an API token gets a 200 for the same URL),
  // so every realm console rendered the "Current Space" fallback — found 2026-09-05 by a spec
  // asserting on the REAL space name rather than "not blank". This is the ONE resolver of a
  // space's name; identify-realm delegates here, and the two other copies that existed
  // (operators/logic.getRealmInfo, an inline one in realms/actions) were deleted.
  try {
    const response = await asUser().requestConfluence(
      route`/wiki/api/v2/spaces?keys=${realmKey}`,
      { headers: { Accept: "application/json" } },
    );

    if (response.ok) {
      const body = await response.json();
      const realmData = body?.results?.[0];
      if (realmData?.key) {
        return {
          key: realmData.key,
          name: realmData.name,
          id: realmData.id != null ? String(realmData.id) : null,
        };
      }
    } else {
      console.warn(`[REALM] resolveRealm ${realmKey}: v2 spaces answered ${response.status}`);
    }

    return { key: realmKey, name: "Current Space", id: null };
  } catch (error) {
    console.error("Error getting realm info:", error);
    return { key: realmKey, name: "Current Space", id: null };
  }
}

/**
 * List sealed artifacts for a realm using KVS secondary index.
 * Queries space-protection-{realmId}-* keys directly — no page scanning needed.
 * Returns results instantly with KVS cursor-based pagination.
 *
 * @param {string} realmId - The realm (space) ID
 * @param {string|null} [cursor=null] - KVS pagination cursor
 * @param {number} [limit=50] - Maximum results per page
 * @returns {Promise<Object>} Object containing artifacts array and pagination metadata
 */
export async function listRealmSeals(realmId, cursor = null, limit = 50) {
  if (!realmId) {
    throw new Error("Space ID is required");
  }

  try {
    const prefix = `space-protection-${realmId}-`;

    // Build KVS query with realm-seal prefix
    let query = kvs
      .query()
      .where("key", WhereConditions.beginsWith(prefix))
      .limit(Math.min(limit, 100)); // KVS max is 100

    if (cursor) {
      query = query.cursor(cursor);
    }

    const { results, nextCursor } = await query.getMany();

    // Map KVS results to artifact objects for the frontend
    const artifacts = (results || []).map(({ key, value }) => {
      const artifactId = key.replace(prefix, "");
      return {
        id: artifactId,
        title: value.attachmentName || "Unknown Attachment",
        fileSize: value.fileSize
          ? `${Math.round(value.fileSize / 1024)}KB`
          : "Unknown",
        creator: value.creatorName || "Unknown",
        creatorAccountId: value.creatorAccountId || null,
        pageTitle: value.pageTitle || "Unknown Page",
        pageId: value.contentId || null,
        lockedBy:
          value.lockedByName || `User ${(value.lockedBy || "").slice(-4)}`,
        lockedByAccountId: value.lockedBy,
        lockedOn: value.timestamp,
        expiresAt: value.expiresAt,
      };
    });

    return {
      attachments: artifacts,
      hasMore: !!nextCursor,
      nextCursor: nextCursor || null,
    };
  } catch (error) {
    console.error("[REALM-SEALS] Error querying realm-seal index:", error);
    return {
      attachments: [],
      hasMore: false,
      nextCursor: null,
    };
  }
}

/**
 * Trigger a background scan to rebuild the realm-seal index.
 * Pushes a job to the async queue which runs with up to 15 min timeout.
 * This finds seals that predate the index and adds them.
 *
 * @param {string} realmKey - The realm (space) key
 * @param {string} realmId - The realm (space) ID
 * @param {Object} scanQueue - Queue instance for background scanning
 * @returns {Promise<Object>} Job ID for status polling
 */
export async function initiateRealmSweep(realmKey, realmId, scanQueue) {
  if (!realmKey || !realmId) {
    throw new Error("Space key and space ID are required");
  }

  // Check if a scan is already in progress
  const existingStatus = await kvs.get(`space-scan-status-${realmId}`);
  if (existingStatus?.status === "processing") {
    return {
      jobId: existingStatus.jobId,
      status: "already-running",
    };
  }

  const jobId = `scan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Store initial job status
  await kvs.set(`space-scan-status-${realmId}`, {
    jobId,
    status: "queued",
    createdAt: new Date().toISOString(),
    spaceKey: realmKey,
    spaceId: realmId,
  });

  // Push to the async queue
  await scanQueue.push({
    body: { jobId, spaceKey: realmKey, spaceId: realmId },
  });

  return { jobId, status: "queued" };
}

/**
 * Get the status of a background realm scan job.
 *
 * @param {string} realmId - The realm (space) ID
 * @returns {Promise<Object>} Job status
 */
export async function pollSweepProgress(realmId) {
  if (!realmId) {
    throw new Error("Space ID is required");
  }

  const status = await kvs.get(`space-scan-status-${realmId}`);
  return status || { status: "none" };
}
