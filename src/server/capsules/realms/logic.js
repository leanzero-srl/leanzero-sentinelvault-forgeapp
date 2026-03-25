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
    throw new Error("Realm key is required");
  }

  try {
    const response = await asUser().requestConfluence(
      route`/wiki/rest/api/space/${realmKey}`,
    );

    if (response.ok) {
      const realmData = await response.json();
      return {
        key: realmData.key,
        name: realmData.name,
        id: realmData.id,
      };
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
    throw new Error("Realm ID is required");
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
    throw new Error("Realm key and realm ID are required");
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
    throw new Error("Realm ID is required");
  }

  const status = await kvs.get(`space-scan-status-${realmId}`);
  return status || { status: "none" };
}
