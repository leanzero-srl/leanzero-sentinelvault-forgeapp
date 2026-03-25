import { asUser, route } from "@forge/api";
import { kvs, WhereConditions } from "@forge/kvs";

// Import from shared
import { BASELINE_HOLD_SPAN } from "../../shared/baseline.js";
import { authorizeSteward } from "../../shared/steward-checks.js";
import { resolveBulletinToggles } from "../../shared/bulletin-flags.js";

// Import from infra
import {
  mailSealConfirmation,
  mailStewardOverrideNotice,
  fetchOperatorProfile,
} from "../../infra/mail-composer.js";

// Import from capsule logic
import { writeSealContentProp, removeSealContentProp, touchSealTimestamp } from "./logic.js";

// Import from sibling capsules
import { recordDispatch, postDocFootnote, notifyWatchers } from "../bulletins/logic.js";
import { triggerPanelEmbed, removePanelNode } from "../../infra/doc-surgery.js";

/**
 * Get attachments for the current page with seal status
 */
const enumerateDocArtifacts = async (req) => {
  const { cursor, limit = 10 } = req.payload;
  const contentId = req.context.extension?.content?.id;

  if (!contentId) {
    console.warn("No content ID found in context");
    return {
      attachments: [],
      hasMore: false,
      nextCursor: null,
    };
  }

  try {
    console.info(
      `[ENUMERATE-DOC-ARTIFACTS] Fetching with pagination: cursor=${cursor || "null"}, limit=${limit}`,
    );

    // Get global policy to check autoUnseal
    const globalPolicy = await kvs.get("admin-settings-global");
    const autoUnsealActive = globalPolicy?.autoUnlockEnabled !== false;

    // Build URL with cursor if present
    let url = route`/wiki/api/v2/pages/${contentId}/attachments?limit=${limit}`;
    if (cursor && cursor !== "0") {
      url = route`/wiki/api/v2/pages/${contentId}/attachments?limit=${limit}&cursor=${cursor}`;
    }

    console.log(`[ENUMERATE-DOC-ARTIFACTS] Request URL: ${url}`);

    const response = await asUser().requestConfluence(url);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Failed to fetch attachments: ${response.status} - ${errorText}`,
      );
      return {
        attachments: [],
        hasMore: false,
        nextCursor: null,
      };
    }

    const data = await response.json();

    if (!data || !data.results) {
      return {
        attachments: [],
        hasMore: false,
        nextCursor: null,
      };
    }

    const artifactsWithSealState = await Promise.all(
      data.results.map(async (att) => {
        const sealRecord = await kvs.get(`protection-${att.id}`);

        let computedSealState = "OPEN";
        let expiresAt = null;
        let heldByAccountId = null;
        let hasLapsed = false;

        if (sealRecord) {
          const sealLapsed =
            sealRecord.expiresAt && new Date(sealRecord.expiresAt) < new Date();

          if (sealRecord.lockedBy === req.context.accountId) {
            computedSealState = "HELD_BY_ACTOR";
            heldByAccountId = req.context.accountId;
          } else {
            computedSealState = "HELD";
            heldByAccountId = sealRecord.lockedBy;
          }
          expiresAt = sealRecord.expiresAt;
          hasLapsed = sealLapsed;
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
          console.warn(`[ENUMERATE-DOC-ARTIFACTS] Failed to fetch labels for ${att.id}:`, e);
        }

        return {
          ...att,
          lockStatus: computedSealState,
          lockedByAccountId: heldByAccountId,
          expiresAt,
          isExpired: hasLapsed,
          autoUnlockEnabled: autoUnsealActive,
          labels,
          comment: att.version?.message || null,
          versionNumber: att.version?.number || null,
        };
      }),
    );

    const hasMore = !!(data._links && data._links.next);

    let nextCursor = null;
    if (hasMore && data._links.next) {
      try {
        const urlObj = new URL(data._links.next, "https://example.com");
        nextCursor = urlObj.searchParams.get("cursor");
        console.log(
          `[ENUMERATE-DOC-ARTIFACTS] Extracted cursor from _links.next: ${nextCursor || "null"}`,
        );
      } catch (e) {
        console.warn(
          `[ENUMERATE-DOC-ARTIFACTS] Failed to parse cursor from _links.next: ${data._links.next}`,
          e,
        );
      }
    }

    console.info(
      `[ENUMERATE-DOC-ARTIFACTS] Returning ${artifactsWithSealState.length} attachments, hasMore=${hasMore}, nextCursor=${nextCursor}`,
    );

    return {
      attachments: artifactsWithSealState,
      hasMore,
      nextCursor,
    };
  } catch (error) {
    console.error("Error fetching attachments:", error);
    return {
      attachments: [],
      hasMore: false,
      nextCursor: null,
    };
  }
};

/**
 * Seal an artifact for the specified duration
 */
const sealArtifact = async (req) => {
  console.info(
    `seal-artifact called: attachmentId=${req.payload.attachmentId}, userAccountId=${req.context.accountId}`,
  );

  const { attachmentId } = req.payload;
  const operatorAccountId = req.context.accountId;
  console.info(`Sealing artifact ${attachmentId} for operator ${operatorAccountId}`);

  // Guard: reject if already sealed by a different user
  const existingSeal = await kvs.get(`protection-${attachmentId}`);
  if (existingSeal && existingSeal.lockedBy && existingSeal.lockedBy !== operatorAccountId) {
    return {
      success: false,
      reason: "Artifact is already sealed by another user",
    };
  }

  let realmKey =
    req.context.extension?.content?.space?.key ||
    req.context.extension?.space?.key;

  let realmId =
    req.context.extension?.content?.space?.id ||
    req.context.extension?.space?.id;

  const contentId =
    req.context.extension?.content?.id ||
    req.context.extension?.content?.content?.id;

  let holdPeriod = req.payload.lockDuration || BASELINE_HOLD_SPAN;

  if (realmKey) {
    const sanitizedRealmKey = realmKey.replace(/[^a-zA-Z0-9:._\s-#]/g, "_");
    const realmPolicy = await kvs.get(
      `admin-settings-space-${sanitizedRealmKey}`,
    );

    if (!realmId && realmPolicy?.spaceId) {
      realmId = realmPolicy.spaceId;
    }

    if (
      realmPolicy?.autoUnlockTimeoutHours &&
      realmPolicy.autoUnlockTimeoutHours !== null
    ) {
      holdPeriod = realmPolicy.autoUnlockTimeoutHours * 3600;
    } else {
      const globalPolicy = await kvs.get("admin-settings-global");

      if (globalPolicy?.defaultLockDuration) {
        holdPeriod = globalPolicy.defaultLockDuration;
      }
    }
  } else {
    const globalPolicy = await kvs.get("admin-settings-global");
    if (globalPolicy?.defaultLockDuration) {
      holdPeriod = globalPolicy.defaultLockDuration;
    }
  }

  const expiresAt = new Date(Date.now() + holdPeriod * 1000).toISOString();

  // Fetch current operator's email and display name
  let operatorEmail = null;
  let operatorDisplayName = "Current User";
  try {
    const operatorResponse = await asUser().requestConfluence(
      route`/wiki/rest/api/user/current`,
    );
    if (operatorResponse.ok) {
      const operatorData = await operatorResponse.json();
      operatorEmail = operatorData.email || null;
      operatorDisplayName = operatorData.displayName || "Current User";
    }
  } catch (error) {
    console.warn("Failed to fetch operator email:", error);
  }

  // Fetch artifact details
  let artifactName = "Unknown Attachment";
  let fileSize = null;
  let creatorAccountId = null;
  let sealedVersion = null;
  try {
    const artifactRoute = route`/wiki/api/v2/attachments/${attachmentId}`;
    const artifactResponse = await asUser().requestConfluence(artifactRoute);
    if (artifactResponse.ok) {
      const artifactData = await artifactResponse.json();
      artifactName = artifactData.title || "Unknown Attachment";
      fileSize = artifactData.fileSize || null;
      creatorAccountId = artifactData.version?.authorId || null;
      sealedVersion = artifactData.version?.number || null;
    }
  } catch (error) {
    console.warn("Failed to fetch artifact details:", error);
  }

  // Fetch page title
  let pageTitle = "Unknown Page";
  if (contentId) {
    try {
      const pageResponse = await asUser().requestConfluence(
        route`/wiki/api/v2/pages/${contentId}`,
      );
      if (pageResponse.ok) {
        const pageData = await pageResponse.json();
        pageTitle = pageData.title || "Unknown Page";
      }
    } catch (error) {
      console.warn("Failed to fetch page title:", error);
    }
  }

  const sealPayload = {
    lockedBy: operatorAccountId,
    lockedByEmail: operatorEmail,
    lockedByName: operatorDisplayName,
    timestamp: new Date().toISOString(),
    expiresAt: expiresAt,
    lockDuration: holdPeriod,
    spaceKey: realmKey,
    spaceId: realmId || null,
    contentId: contentId,
    attachmentId: attachmentId,
    attachmentName: artifactName,
    sealedVersion: sealedVersion,
  };

  // Store seal record
  await kvs.set(`protection-${attachmentId}`, sealPayload);
  await touchSealTimestamp();

  // Store as content property for CQL searchability
  if (contentId) {
    await writeSealContentProp(contentId, sealPayload);
  }

  // Write realm-seal index key
  if (realmId) {
    try {
      await kvs.set(`space-protection-${realmId}-${attachmentId}`, {
        attachmentId,
        attachmentName: artifactName,
        lockedBy: operatorAccountId,
        lockedByName: operatorDisplayName,
        timestamp: sealPayload.timestamp,
        expiresAt,
        contentId: contentId || null,
        spaceKey: realmKey || null,
        pageTitle,
        fileSize: fileSize || null,
        creatorName: null,
        creatorAccountId: creatorAccountId || null,
      });
      console.log(
        `[SEAL-ARTIFACT] Wrote realm-seal index key for artifact ${attachmentId} in realm ${realmId}`,
      );
    } catch (indexError) {
      console.warn(
        `[SEAL-ARTIFACT] Failed to write realm-seal index:`,
        indexError,
      );
    }
  }

  // Send seal confirmation email
  const bulletinToggles = await resolveBulletinToggles();

  if (!bulletinToggles.ENABLE_EMAIL_BULLETINS) {
    console.warn(
      "Email notifications are disabled - skipping seal confirmation email",
    );
  } else if (!bulletinToggles.ENABLE_SEAL_EXPIRY_REMINDER_EMAIL) {
    console.warn("Seal expiry reminder email is disabled - skipping email");
  } else {
    try {
      if (contentId) {
        const pageResponse = await asUser().requestConfluence(
          route`/wiki/api/v2/pages/${contentId}`,
        );

        if (pageResponse.ok) {
          const pageData = await pageResponse.json();
          const docTitle = pageData.title || "Unknown Page";
          const baseUrl = pageData._links?.base || "";
          const webui = pageData._links?.webui || "";
          const pageUrl = baseUrl && webui ? `${baseUrl}${webui}` : "";

          const expiryDate = new Date(expiresAt).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });

          const emailResult = await mailSealConfirmation(
            operatorAccountId,
            attachmentId,
            artifactName,
            docTitle,
            pageUrl,
            expiryDate,
          );

          if (emailResult.success) {
            console.info(
              `Seal confirmation email sent successfully to operator ${operatorAccountId}`,
            );
          } else {
            console.error(
              `Seal confirmation email failed: ${emailResult.reason}`,
            );
          }
        } else {
          console.error(`Failed to fetch page details: ${pageResponse.status}`);
        }
      } else {
        console.warn(
          `No contentId found for artifact - cannot send email. Context: ${JSON.stringify(req.context.extension)}`,
        );
      }
    } catch (error) {
      console.error("Error sending seal confirmation email:", error);
    }
  }

  // Auto-insert panel on the page when a seal is added
  if (contentId) {
    try {
      await triggerPanelEmbed(contentId, realmKey);
    } catch (e) {
      console.warn("[SEAL-ARTIFACT] Panel auto-insert failed:", e);
    }
  }

  return { success: true };
};

/**
 * Unseal an artifact (owner or steward override)
 */
const unsealArtifact = async (req) => {
  const { attachmentId, adminOverride } = req.payload;
  const operatorAccountId = req.context.accountId;
  const realmKey =
    req.context.extension?.content?.space?.key ||
    req.context.extension?.space?.key;
  const sealRecord = await kvs.get(`protection-${attachmentId}`);

  if (!sealRecord) {
    return { success: false, reason: "Attachment is not locked" };
  }

  let canRelease = false;
  let releaseReason = "";

  if (sealRecord.lockedBy === operatorAccountId) {
    canRelease = true;
    releaseReason = "owner unlock";
  } else if (adminOverride && realmKey) {
    const hasStewardAccess = await authorizeSteward(
      operatorAccountId,
      realmKey,
    );
    if (hasStewardAccess) {
      canRelease = true;
      releaseReason = "admin override";
    } else {
      return {
        success: false,
        reason: "Admin override denied - insufficient permissions",
      };
    }
  }

  if (canRelease) {
    await kvs.delete(`protection-${attachmentId}`);

    // Re-verify the seal was actually removed before proceeding
    const verifyDeleted = await kvs.get(`protection-${attachmentId}`);
    if (verifyDeleted) {
      return { success: false, reason: "Seal removal could not be confirmed" };
    }

    await touchSealTimestamp();

    // Remove content property
    if (sealRecord.contentId) {
      await removeSealContentProp(sealRecord.contentId);
    }

    // Remove realm-seal index key
    if (sealRecord.spaceId) {
      try {
        await kvs.delete(`space-protection-${sealRecord.spaceId}-${attachmentId}`);
        console.log(
          `[UNSEAL] Removed realm-seal index key for artifact ${attachmentId} in realm ${sealRecord.spaceId}`,
        );
      } catch (indexError) {
        console.warn(`[UNSEAL] Failed to delete realm-seal index:`, indexError);
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

    // Notify seal owner when a steward forcefully unseals their artifact
    if (releaseReason === "admin override" && sealRecord.lockedBy) {
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
              "[UNSEAL] Failed to fetch page details for steward override email:",
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
          "[UNSEAL] Failed to send steward override email:",
          emailError,
        );
      }
    }

    // Manage inline panel: keep if other seals remain, remove if page is clear
    if (sealRecord.contentId) {
      try {
        const realmKeyForPanel = sealRecord.spaceKey || realmKey;
        const { results: remainingSeals } = await kvs
          .query()
          .where("key", WhereConditions.beginsWith("protection-"))
          .limit(100)
          .getMany();
        const pageHasSeals = remainingSeals.some(
          ({ value }) => value && value.contentId === sealRecord.contentId,
        );

        if (pageHasSeals && realmKeyForPanel) {
          await triggerPanelEmbed(sealRecord.contentId, realmKeyForPanel);
        } else if (!pageHasSeals) {
          await removePanelNode(sealRecord.contentId);
        }
      } catch (panelErr) {
        console.warn("[UNSEAL] Panel management failed:", panelErr);
      }
    }

    return { success: true, reason: releaseReason };
  } else {
    return { success: false, reason: "Permission denied" };
  }
};

/**
 * Get all artifacts sealed by the current operator across the entire instance
 */
const enumerateOperatorSeals = async (req) => {
  const { cursor, limit = 10 } = req.payload;
  const operatorAccountId = req.context.accountId;
  console.info(
    `[ENUMERATE-OPERATOR-SEALS] Called with operatorAccountId: ${operatorAccountId}, cursor=${cursor || "null"}, limit=${limit}`,
  );

  if (!operatorAccountId) {
    console.warn("[ENUMERATE-OPERATOR-SEALS] No operator account ID found in context");
    return {
      attachments: [],
      hasMore: false,
      nextCursor: null,
      total: 0,
    };
  }

  try {
    // Get global policy to check autoUnseal
    const globalPolicy = await kvs.get("admin-settings-global");
    const autoUnsealActive = globalPolicy?.autoUnlockEnabled !== false;

    // Query all seals from KVS with pagination
    console.info("[ENUMERATE-OPERATOR-SEALS] Querying KVS for protection- keys...");
    const allSeals = [];

    const start = cursor !== null ? parseInt(cursor, 10) : 0;
    let kvsCursor = start > 0 ? cursor : null;
    let iteration = 0;
    const maxIterations = 10;

    console.log(
      `[ENUMERATE-OPERATOR-SEALS] Starting KVS pagination: cursor=${cursor}, start=${start}, kvsCursor=${kvsCursor || "null"}`,
    );

    let query = kvs
      .query()
      .where("key", WhereConditions.beginsWith("protection-"))
      .limit(100);

    if (kvsCursor) {
      console.log("[ENUMERATE-OPERATOR-SEALS] Using KVS cursor:", kvsCursor);
      query = query.cursor(kvsCursor);
    } else {
      console.log("[ENUMERATE-OPERATOR-SEALS] No cursor - getting first page of results");
    }

    do {
      iteration++;
      console.log(`[ENUMERATE-OPERATOR-SEALS] KVS query iteration ${iteration}`);

      try {
        const { results, nextCursor } = await query.getMany();
        console.log(
          `[ENUMERATE-OPERATOR-SEALS] Got ${results?.length || 0} results, nextCursor=${nextCursor ? "present" : "null"}, iteration=${iteration}`,
        );
        if (results && results.length > 0) {
          allSeals.push(...results);
        }

        kvsCursor = nextCursor;

        if (iteration >= maxIterations) {
          console.warn("[ENUMERATE-OPERATOR-SEALS] Hit iteration limit, stopping");
          break;
        }

        if (kvsCursor) {
          console.log("[ENUMERATE-OPERATOR-SEALS] Preparing next query with cursor");
          query = kvs
            .query()
            .where("key", WhereConditions.beginsWith("protection-"))
            .limit(100)
            .cursor(kvsCursor);
        }
      } catch (queryError) {
        console.error(
          `[ENUMERATE-OPERATOR-SEALS] Error on iteration ${iteration}:`,
          queryError,
        );
        break;
      }
    } while (kvsCursor);

    console.log(
      `[ENUMERATE-OPERATOR-SEALS] Total iterations: ${iteration}, total seals from KVS: ${allSeals.length}`,
    );

    if (allSeals.length === 0) {
      console.info("[ENUMERATE-OPERATOR-SEALS] No seals found in KVS");
      return {
        attachments: [],
        hasMore: false,
        nextCursor: null,
        total: 0,
      };
    }

    // Debug: Log sample of fetched seals
    console.log(
      `[ENUMERATE-OPERATOR-SEALS] Sample seal keys: ${allSeals
        .slice(0, 3)
        .map((s) => s.key)
        .join(", ")}`,
    );
    console.log(
      `[ENUMERATE-OPERATOR-SEALS] Operator account ID from context: ${operatorAccountId}`,
    );

    const sampleLockedByValues = allSeals.slice(0, 5).map((s) => ({
      key: s.key,
      lockedBy: s.value?.lockedBy,
      hasLockedBy: !!s.value?.lockedBy,
    }));
    console.log(
      `[ENUMERATE-OPERATOR-SEALS] Sample lockedBy values: ${JSON.stringify(sampleLockedByValues)}`,
    );

    // Filter seals owned by the current operator
    const operatorSeals = allSeals.filter(
      ({ value }) => value && value.lockedBy === operatorAccountId,
    );
    console.info(
      `[ENUMERATE-OPERATOR-SEALS] Found ${operatorSeals.length} seals for operator ${operatorAccountId}`,
    );

    if (operatorSeals.length === 0 && allSeals.length > 0) {
      console.warn(
        `[ENUMERATE-OPERATOR-SEALS] NO MATCHES - checking for partial matches or format issues`,
      );
      const sealsWithLockedBy = allSeals.filter((s) => s.value?.lockedBy);
      console.warn(
        `[ENUMERATE-OPERATOR-SEALS] Seals with lockedBy field: ${sealsWithLockedBy.length}`,
      );
    }

    if (operatorSeals.length === 0) {
      return {
        attachments: [],
        hasMore: false,
        nextCursor: null,
        total: 0,
      };
    }

    // Build artifact details for each seal
    const sealedArtifacts = [];

    for (const { key, value } of operatorSeals) {
      try {
        const artifactId = key.replace("protection-", "");

        let artifactTitle = value.attachmentName || "Unknown Attachment";
        let fileSize = "Unknown";

        try {
          const artifactResponse = await asUser().requestConfluence(
            route`/wiki/api/v2/attachments/${artifactId}`,
          );
          if (artifactResponse.ok) {
            const artifactData = await artifactResponse.json();
            artifactTitle = artifactData.title || artifactTitle;
            fileSize = artifactData.fileSize
              ? `${Math.round(artifactData.fileSize / 1024)}KB`
              : "Unknown";
          }
        } catch (attErr) {
          console.warn(`Failed to fetch artifact ${artifactId}:`, attErr);
        }

        let docTitle = "Unknown Page";
        let pageUrl = "";
        let realmKey = value.spaceKey || "";
        let realmName = "";

        if (value.contentId) {
          try {
            const pageResponse = await asUser().requestConfluence(
              route`/wiki/api/v2/pages/${value.contentId}`,
            );
            if (pageResponse.ok) {
              const pageData = await pageResponse.json();
              docTitle = pageData.title || "Unknown Page";
              const baseUrl = pageData._links?.base || "";
              const webui = pageData._links?.webui || "";
              pageUrl = baseUrl && webui ? `${baseUrl}${webui}` : "";

              if (pageData.spaceId) {
                try {
                  const realmResponse = await asUser().requestConfluence(
                    route`/wiki/api/v2/spaces/${pageData.spaceId}`,
                  );
                  if (realmResponse.ok) {
                    const realmData = await realmResponse.json();
                    realmName = realmData.name || "";
                    realmKey = realmData.key || realmKey;
                  }
                } catch (realmErr) {
                  console.warn("Failed to fetch realm info:", realmErr);
                }
              }
            }
          } catch (pageErr) {
            console.warn(`Failed to fetch page ${value.contentId}:`, pageErr);
          }
        }

        const sealLapsed =
          value.expiresAt && new Date(value.expiresAt) < new Date();

        sealedArtifacts.push({
          id: artifactId,
          title: artifactTitle,
          fileSize,
          pageTitle: docTitle,
          pageUrl,
          pageId: value.contentId,
          spaceKey: realmKey,
          spaceName: realmName,
          lockedOn: value.timestamp,
          expiresAt: value.expiresAt,
          isExpired: sealLapsed,
          autoUnlockEnabled: autoUnsealActive,
        });
      } catch (sealErr) {
        console.error(`Error processing seal ${key}:`, sealErr);
      }
    }

    // Sort by sealed date (most recent first)
    sealedArtifacts.sort(
      (a, b) => new Date(b.lockedOn) - new Date(a.lockedOn),
    );

    const total = sealedArtifacts.length;

    // Paginate on client side after getting ALL seals from KVS
    const paginatedArtifacts = sealedArtifacts.slice(start, start + limit);
    const hasMore = total > start + limit;
    const nextCursor = hasMore ? String(start + limit) : null;

    console.info(
      `[ENUMERATE-OPERATOR-SEALS] Returning ${paginatedArtifacts.length} of ${total} total artifacts, hasMore=${hasMore}, nextCursor=${nextCursor}`,
    );

    return {
      attachments: paginatedArtifacts,
      hasMore,
      nextCursor,
      total,
    };
  } catch (error) {
    console.error("Error fetching operator's sealed artifacts:", error);
    return {
      attachments: [],
      hasMore: false,
      nextCursor: null,
      total: 0,
    };
  }
};

/**
 * Fast path: get all claimed files for a page directly from KVS.
 * Returns claimed artifacts with seal metadata (no Confluence API call).
 * The frontend displays these instantly, then backfills with the full list.
 */
const enumeratePageSeals = async (req) => {
  const contentId =
    req.payload?.pageId ||
    req.context.extension?.content?.id;

  if (!contentId) {
    return { claimedArtifacts: [] };
  }

  try {
    const operatorAccountId = req.context.accountId;
    const allSeals = [];
    let query = kvs
      .query()
      .where("key", WhereConditions.beginsWith("protection-"))
      .limit(100);

    let iterations = 0;
    do {
      iterations++;
      const { results, nextCursor } = await query.getMany();
      if (results?.length > 0) {
        allSeals.push(...results);
      }
      if (!nextCursor || iterations >= 10) break;
      query = kvs
        .query()
        .where("key", WhereConditions.beginsWith("protection-"))
        .limit(100)
        .cursor(nextCursor);
    } while (true);

    // Filter to seals on this page
    const pageSeals = allSeals.filter(
      ({ value }) => value && value.contentId === contentId,
    );

    const claimedArtifacts = pageSeals.map(({ key, value }) => {
      const isMine = value.lockedBy === operatorAccountId;
      const isExpired = value.expiresAt && new Date(value.expiresAt) < new Date();
      return {
        id: value.attachmentId || key.replace("protection-", ""),
        title: value.attachmentName || "Unknown file",
        lockStatus: isMine ? "HELD_BY_ACTOR" : "HELD",
        lockedByAccountId: value.lockedBy,
        lockedByName: value.lockedByName,
        expiresAt: value.expiresAt || null,
        isExpired: !!isExpired,
        lockedOn: value.timestamp || null,
        // Minimal data — Confluence metadata will be merged later
        fileSize: null,
        mediaType: null,
        labels: [],
        comment: null,
        notifyRequested: false,
      };
    });

    return { claimedArtifacts };
  } catch (error) {
    console.error("[ENUMERATE-PAGE-SEALS] Error:", error);
    return { claimedArtifacts: [] };
  }
};

/**
 * Return the last-modified timestamp for seal operations.
 * Used by the inline panel to detect changes made in other surfaces.
 */
const checkSealStamp = async () => {
  const stamp = await kvs.get("protections-last-modified");
  return { stamp: stamp || 0 };
};

export const actions = [
  ["seal-artifact", sealArtifact],
  ["unseal-artifact", unsealArtifact],
  ["enumerate-doc-artifacts", enumerateDocArtifacts],
  ["enumerate-operator-seals", enumerateOperatorSeals],
  ["enumerate-page-seals", enumeratePageSeals],
  ["check-seal-stamp", checkSealStamp],
];
