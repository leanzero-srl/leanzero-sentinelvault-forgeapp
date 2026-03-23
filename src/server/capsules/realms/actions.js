import { asUser, route } from "@forge/api";
import { kvs, WhereConditions } from "@forge/kvs";
import { Queue } from "@forge/events";

import { authorizeSteward } from "../../shared/steward-checks.js";
import { removeSealContentProp, touchSealTimestamp } from "../sealing/logic.js";
import { notifyWatchers } from "../bulletins/logic.js";
import {
  mailStewardOverrideNotice,
  fetchOperatorProfile,
} from "../../infra/mail-composer.js";

// Queue for background realm scanning
const realmScanQueue = new Queue({ key: "space-admin-scan-queue" });

/**
 * Get realm information by realm key
 */
const identifyRealm = async (req) => {
  const { spaceKey } = req.payload;

  if (!spaceKey) {
    throw new Error("Space key is required");
  }

  try {
    const response = await asUser().requestConfluence(
      route`/wiki/rest/api/space/${spaceKey}`,
    );

    if (response.ok) {
      const realmData = await response.json();
      return {
        key: realmData.key,
        name: realmData.name,
        id: realmData.id,
      };
    }

    return { key: spaceKey, name: "Current Space", id: null };
  } catch (error) {
    console.error("Error getting realm info:", error);
    return { key: spaceKey, name: "Current Space", id: null };
  }
};

/**
 * Get sealed artifacts for a realm using KVS secondary index.
 */
const enumerateRealmSeals = async (req) => {
  const { spaceId, cursor = null, limit = 50 } = req.payload;

  if (!spaceId) {
    throw new Error("Space ID is required");
  }

  try {
    const prefix = `space-protection-${spaceId}-`;
    console.log(
      `[REALM-SEALS] Querying KVS with prefix: ${prefix}, cursor=${cursor || "null"}, limit=${limit}`,
    );

    let query = kvs
      .query()
      .where("key", WhereConditions.beginsWith(prefix))
      .limit(Math.min(limit, 100));

    if (cursor) {
      query = query.cursor(cursor);
    }

    const { results, nextCursor } = await query.getMany();

    console.log(
      `[REALM-SEALS] Got ${results?.length || 0} results, nextCursor=${nextCursor ? "present" : "null"}`,
    );

    const attachments = (results || []).map(({ key, value }) => {
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
      attachments,
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
};

/**
 * Trigger a background scan to rebuild the realm-seal index.
 */
const launchRealmAudit = async (req) => {
  const { spaceKey, spaceId } = req.payload;

  if (!spaceKey || !spaceId) {
    throw new Error("Space key and space ID are required");
  }

  // Check if a scan is already in progress
  const existingStatus = await kvs.get(`space-scan-status-${spaceId}`);
  if (existingStatus?.status === "processing") {
    console.log(`[REALM-AUDIT] Scan already in progress for realm ${spaceId}`);
    return {
      jobId: existingStatus.jobId,
      status: "already-running",
    };
  }

  const jobId = `scan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Store initial job status
  await kvs.set(`space-scan-status-${spaceId}`, {
    jobId,
    status: "queued",
    createdAt: new Date().toISOString(),
    spaceKey,
    spaceId,
  });

  // Push to the async queue
  await realmScanQueue.push({
    body: { jobId, spaceKey, spaceId },
  });

  console.log(`[REALM-AUDIT] Queued scan job ${jobId} for realm ${spaceKey}`);

  return { jobId, status: "queued" };
};

/**
 * Get the status of a background realm scan job.
 */
const checkAuditStatus = async (req) => {
  const { spaceId } = req.payload;

  if (!spaceId) {
    throw new Error("Space ID is required");
  }

  const status = await kvs.get(`space-scan-status-${spaceId}`);
  return status || { status: "none" };
};

/**
 * Unseal an artifact as realm steward (steward override)
 */
const stewardUnseal = async (req) => {
  const { attachmentId, spaceKey, spaceId } = req.payload;
  const operatorAccountId = req.context.accountId;
  const sealRecord = await kvs.get(`protection-${attachmentId}`);

  if (!sealRecord) {
    return { success: false, reason: "Attachment is not locked" };
  }

  // Resolve realmId from seal data, payload, or settings
  let resolvedRealmId = spaceId || sealRecord.spaceId || null;
  if (!resolvedRealmId && spaceKey) {
    try {
      const sanitizedRealmKey = spaceKey.replace(/[^a-zA-Z0-9:._\s-#]/g, "_");
      const realmPolicy = await kvs.get(
        `admin-settings-space-${sanitizedRealmKey}`,
      );
      resolvedRealmId = realmPolicy?.spaceId || null;
    } catch (e) {
      // ignore
    }
  }

  // Check if auto-unseal is enabled before auto-deleting expired seals
  const globalPolicy = await kvs.get("admin-settings-global");
  const autoUnsealActive = globalPolicy?.autoUnlockEnabled !== false;

  if (sealRecord.expiresAt && new Date(sealRecord.expiresAt) < new Date()) {
    if (autoUnsealActive) {
      await kvs.delete(`protection-${attachmentId}`);
      await touchSealTimestamp();
      if (sealRecord.contentId) {
        await removeSealContentProp(sealRecord.contentId);
      }

      // Remove realm-seal index key
      if (resolvedRealmId) {
        try {
          await kvs.delete(`space-protection-${resolvedRealmId}-${attachmentId}`);
        } catch (indexError) {
          console.warn(
            `[STEWARD-UNSEAL] Failed to delete realm-seal index:`,
            indexError,
          );
        }
      }

      await notifyWatchers(attachmentId, {
        attachmentName: sealRecord.attachmentName,
        contentId: sealRecord.contentId,
      });

      return { success: true, reason: "lock expired" };
    }
  }

  const hasStewardAccess = await authorizeSteward(
    operatorAccountId,
    spaceKey,
  );
  if (!hasStewardAccess) {
    return {
      success: false,
      reason: "Admin override denied - insufficient permissions",
    };
  }

  await kvs.delete(`protection-${attachmentId}`);
  await touchSealTimestamp();

  if (sealRecord.contentId) {
    await removeSealContentProp(sealRecord.contentId);
  }

  // Remove realm-seal index key
  if (resolvedRealmId) {
    try {
      await kvs.delete(`space-protection-${resolvedRealmId}-${attachmentId}`);
      console.log(
        `[STEWARD-UNSEAL] Removed realm-seal index key for artifact ${attachmentId} in realm ${resolvedRealmId}`,
      );
    } catch (indexError) {
      console.warn(
        `[STEWARD-UNSEAL] Failed to delete realm-seal index:`,
        indexError,
      );
    }
  }

  const watchPrefix = `notification-${attachmentId}-`;
  const { results: watchEntries } = await kvs
    .query()
    .where("key", WhereConditions.beginsWith(watchPrefix))
    .limit(50)
    .getMany();
  for (const { key } of watchEntries) {
    await kvs.delete(key);
  }

  // Notify watchers
  await notifyWatchers(attachmentId, {
    attachmentName: sealRecord.attachmentName,
    contentId: sealRecord.contentId,
  });

  // Notify seal owner that a steward forcefully unsealed their artifact
  if (sealRecord.lockedBy) {
    try {
      const stewardInfo = await fetchOperatorProfile(operatorAccountId);
      const unsealDate = new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      let docTitle = "Unknown Page";
      let pageUrl = "";
      if (sealRecord.contentId) {
        try {
          const pageResponse = await asUser().requestConfluence(
            route`/wiki/api/v2/pages/${sealRecord.contentId}`,
          );
          if (pageResponse.ok) {
            const pageData = await pageResponse.json();
            docTitle = pageData.title || "Unknown Page";
            const baseUrl = pageData._links?.base || "";
            const webui = pageData._links?.webui || "";
            pageUrl = baseUrl && webui ? `${baseUrl}${webui}` : "";
          }
        } catch (e) {
          console.warn(
            "[STEWARD-UNSEAL] Failed to fetch page details for steward override email:",
            e,
          );
        }
      }

      await mailStewardOverrideNotice(
        sealRecord.lockedBy,
        stewardInfo.displayName,
        attachmentId,
        sealRecord.attachmentName || "Unknown Attachment",
        docTitle,
        pageUrl,
        unsealDate,
      );
    } catch (emailError) {
      console.error(
        "[STEWARD-UNSEAL] Failed to send steward override email:",
        emailError,
      );
    }
  }

  return { success: true, reason: "admin override" };
};

export const actions = [
  ["identify-realm", identifyRealm],
  ["enumerate-realm-seals", enumerateRealmSeals],
  ["launch-realm-audit", launchRealmAudit],
  ["check-audit-status", checkAuditStatus],
  ["steward-unseal", stewardUnseal],
];
