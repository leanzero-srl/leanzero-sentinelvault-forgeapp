import { asUser, asApp, route } from "@forge/api";
import { kvs, WhereConditions } from "@forge/kvs";

// Import from shared
import { BASELINE_HOLD_SPAN, sanitizeHoldDuration } from "../../shared/baseline.js";
import { keysetPage, encodeKeysetCursor, decodeKeysetCursor } from "../../shared/pagination.js";
import { restampIfEnforced } from "../workflow/logic.js";
import { authorizeSteward } from "../../shared/steward-checks.js";
import { canEditPage, canReadPage, mustVerify } from "../../shared/content-access.js";
import { resolveBulletinToggles } from "../../shared/bulletin-flags.js";

// Import from infra
import {
  mailSealConfirmation,
  mailStewardOverrideNotice,
  fetchOperatorProfile,
} from "../../infra/notice-composer.js";

// Import from capsule logic
import { writeSealContentProp, removeSealContentProp, touchSealTimestamp } from "./logic.js";
import { readDocBody } from "../../infra/doc-surgery.js";
import { confirmAttachmentPurged } from "../../infra/attachment-status.js";
import { findSealedMediaSingle, capturePresentation } from "../../infra/media-presentation.js";
import { purgeAllSealState } from "./confluence-sync.js";

// Import from sibling capsules
import { notifyWatchers } from "../bulletins/logic.js";
import { sweepEditAccess } from "../editreq/logic.js";
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
    // Get global policy to check autoUnseal and action toggles
    const globalPolicy = await kvs.get("admin-settings-global");
    const autoUnsealActive = globalPolicy?.autoUnlockEnabled !== false;
    const allowSealRestore = globalPolicy?.allowSealRestore === true;
    const allowSealPurge = globalPolicy?.allowSealPurge === true;
    const allowArtifactDelete = globalPolicy?.allowArtifactDelete === true;

    // Build URL with cursor if present
    let url = route`/wiki/api/v2/pages/${contentId}/attachments?limit=${limit}`;
    if (cursor && cursor !== "0") {
      url = route`/wiki/api/v2/pages/${contentId}/attachments?limit=${limit}&cursor=${cursor}`;
    }

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
          allowRestore: allowSealRestore,
          allowPurge: allowSealPurge,
          allowDelete: allowArtifactDelete,
          labels,
          comment: att.version?.message || null,
          versionNumber: att.version?.number || null,
          downloadLink: att.downloadLink || att._links?.download || null,
          webuiLink: att.webuiLink || att._links?.webui || null,
        };
      }),
    );

    const hasMore = !!(data._links && data._links.next);

    let nextCursor = null;
    if (hasMore && data._links.next) {
      try {
        const urlObj = new URL(data._links.next, "https://example.com");
        nextCursor = urlObj.searchParams.get("cursor");
      } catch (e) {
        console.warn(
          `[ENUMERATE-DOC-ARTIFACTS] Failed to parse cursor from _links.next: ${data._links.next}`,
          e,
        );
      }
    }

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
  const { attachmentId } = req.payload;
  const operatorAccountId = req.context.accountId;

  // Guard: reject if already sealed by a DIFFERENT user — but treat an EXPIRED seal as
  // absent (SV-M8). The expiry sweep only notifies and never deletes, so an expired-but-
  // unswept seal would otherwise block a legitimate re-seal until the sweep runs.
  const existingSeal = await kvs.get(`protection-${attachmentId}`);
  let staleRealmIndexId = null;
  if (existingSeal && existingSeal.lockedBy && existingSeal.lockedBy !== operatorAccountId) {
    const expired = existingSeal.expiresAt && new Date(existingSeal.expiresAt) < new Date();
    if (!expired) {
      return {
        success: false,
        reason: "Attachment is already sealed by another user",
      };
    }
    // Expired and not yet swept — clear it AND sweep the prior owner's edit-access records (it55;
    // parity with every other teardown — unseal/purge). editreq records carry no TTL, so without
    // this a stale denied/pending edit-request from the old owner leaks into the new owner's fresh
    // seal (blocking a requester, or surfacing a phantom request the new owner could approve).
    await kvs.delete(`protection-${attachmentId}`).catch(() => {});
    await sweepEditAccess(attachmentId).catch(() => {});
    // Hunt H2-F5b: remember the old seal's space so its index leg can be dropped below once
    // the NEW seal's space is resolved — otherwise a stale row (previous owner's name/expiry)
    // survives whenever the new seal lands in a different space or resolves no space at all.
    staleRealmIndexId = existingSeal.spaceId || null;
  }

  let realmKey =
    req.context.extension?.content?.space?.key ||
    req.context.extension?.space?.key;

  let realmId =
    req.context.extension?.content?.space?.id ||
    req.context.extension?.space?.id;

  let contentId =
    req.context.extension?.content?.id ||
    req.context.extension?.content?.content?.id;

  // it55: sanitize the API-only lockDuration (negative → past expiresAt / "sealed" but unprotected;
  // string/NaN/huge → Date crash). The policy chain below still overrides this default.
  let holdPeriod = sanitizeHoldDuration(req.payload.lockDuration, BASELINE_HOLD_SPAN);

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

  // B14 (it55 completion): the policy chain above may OVERRIDE holdPeriod with a STORED policy value
  // (autoUnlockTimeoutHours / defaultLockDuration) that store-policy persists RAW — never bounds-checked
  // (the it55 guard lives in the dead policies/logic.js:savePolicyRuleset, which nothing calls). So a
  // negative/zero/absurd/NaN stored value would flow straight into expiresAt: a past date (attachment
  // reads "sealed" but is already expired → unprotected) or an overflowing/NaN Date. Re-run the FINAL
  // holdPeriod through the same clamp as the API-only path above — defense-in-depth at the seal boundary,
  // independent of whether store-time validation ever lands.
  holdPeriod = sanitizeHoldDuration(holdPeriod, BASELINE_HOLD_SPAN);
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
  let sealedFileId = null;
  let artifactDownloadLink = null;
  let artifactPageId = null;
  try {
    const artifactRoute = route`/wiki/api/v2/attachments/${attachmentId}`;
    const artifactResponse = await asUser().requestConfluence(artifactRoute);
    if (artifactResponse.ok) {
      const artifactData = await artifactResponse.json();
      artifactName = artifactData.title || "Unknown Attachment";
      fileSize = artifactData.fileSize || null;
      creatorAccountId = artifactData.version?.authorId || null;
      sealedVersion = artifactData.version?.number || null;
      sealedFileId = artifactData.fileId || null;
      artifactDownloadLink = artifactData.downloadLink || artifactData._links?.download || null;
      artifactPageId = artifactData.pageId || null;
    }
  } catch (error) {
    console.warn("Failed to fetch artifact details:", error);
  }

  // SV-SEC-1. attachmentId is payload-supplied and nothing above this point checked the caller
  // against it — the asUser read just overhead is best-effort and swallows its own failure, so an
  // unentitled caller simply got artifactName "Unknown Attachment" and carried on to write the
  // seal record. That record is not inert: the page trigger reads `protection-{id}` and reverts
  // or re-restores the real owner's edits through asApp, and it names the writer as `lockedBy`,
  // which is what purge and unseal treat as ownership. So an ungated seal is a durable takeover
  // of someone else's file. Sealing stops other people editing a file, so the bar is being able
  // to edit it yourself.
  if (!(await canEditPage(operatorAccountId, attachmentId))) {
    return { success: false, reason: "You do not have permission to seal this file" };
  }

  // Where the file actually LIVES beats where the caller happens to be standing. contentId comes
  // from the resolver context, so a mismatch means the seal record, its content property, the
  // presentation baseline and the panel embed would all be filed against the wrong page.
  if (artifactPageId && String(artifactPageId) !== String(contentId || "")) {
    contentId = String(artifactPageId);
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

  // Fix 6 (STRICT presentation seal): capture the on-page presentation baseline at seal time
  // from a SERVER READ of the ADF (normalization-consistent with later trigger reads). Failure
  // → no baseline → attr protection simply skipped for this seal (fail-open, logged).
  let mediaBaseline = null;
  // Whether the sealed file was EMBEDDED in the page body at seal time. Tri-state on purpose:
  // true/false only from a successful ADF read; undefined (omitted from the record) when the
  // read failed or there was no fileId — so the phantom-violation gate in triggers.js can
  // distinguish "provably never embedded" from "unknown".
  let embedded;
  if (contentId && sealedFileId) {
    try {
      const { adfDoc } = await readDocBody(contentId);
      const sealedNode = findSealedMediaSingle(adfDoc, sealedFileId);
      embedded = sealedNode != null;
      mediaBaseline = capturePresentation(sealedNode);
    } catch (e) {
      console.warn(`[SEAL] presentation-baseline capture failed for ${attachmentId} (attr protection inactive):`, e?.message);
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
    sealedFileId: sealedFileId,
    downloadLink: artifactDownloadLink,
    mediaBaseline,
    embedded,
  };

  // Hunt H2-F5b: the expired-other-user re-seal above removed `protection-{id}` but not the
  // old space index leg — drop it now that the new space is known, unless the new index write
  // below will overwrite the very same key.
  if (staleRealmIndexId && String(staleRealmIndexId) !== String(realmId || "")) {
    await kvs.delete(`space-protection-${staleRealmIndexId}-${attachmentId}`).catch(() => {});
  }

  // Store seal record
  await kvs.set(`protection-${attachmentId}`, sealPayload);
  await touchSealTimestamp();
  if (contentId) await restampIfEnforced(contentId); // #44 §2.7: keep an enforced baseline seal-complete

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
        downloadLink: artifactDownloadLink,
        creatorName: null,
        creatorAccountId: creatorAccountId || null,
      });
    } catch (indexError) {
      console.warn(
        `[SEAL-ARTIFACT] Failed to write realm-seal index:`,
        indexError,
      );
    }
  }

  // Post seal confirmation comment with @mention of the sealer.
  // Confluence's notification engine emails the user.
  const bulletinToggles = await resolveBulletinToggles();

  if (!bulletinToggles.ENABLE_NATIVE_NOTIFICATIONS) {
    console.warn(
      "Native notifications are disabled - skipping seal confirmation",
    );
  } else if (!bulletinToggles.ENABLE_HALFWAY_REMINDER_NOTICE) {
    console.warn("Seal confirmation notice is disabled - skipping");
  } else if (!contentId) {
    console.warn(
      `No contentId found for artifact - cannot post comment. Context: ${JSON.stringify(req.context.extension)}`,
    );
  } else {
    try {
      const expiryDate = new Date(expiresAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      const noticeResult = await mailSealConfirmation(
        operatorAccountId,
        artifactName,
        contentId,
        expiryDate,
      );

      if (!noticeResult.success) {
        console.error(
          `Seal confirmation notice failed: ${noticeResult.reason}`,
        );
      }
    } catch (error) {
      console.error("Error posting seal confirmation notice:", error);
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
  } else if (adminOverride && (sealRecord.spaceKey || realmKey)) {
    // SV-SEC-1 (confused deputy). This used to ask "is the caller a steward of the space they
    // are STANDING IN", while acting on a seal named by a payload attachmentId that carries its
    // own spaceKey. Administering one space — a personal space is enough — therefore granted force-unseal
    // over every sealed file on the site, and the teardown below drives an asApp body rewrite on
    // the victim's page. Authorize against the space the SEAL lives in; the caller's context is
    // only a fallback for records that never recorded one.
    const hasStewardAccess = await authorizeSteward(
      operatorAccountId,
      sealRecord.spaceKey || realmKey,
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

    // Clear any Edit Requests / grants tied to this seal
    await sweepEditAccess(attachmentId);

    // Notify watchers
    await notifyWatchers(attachmentId, {
      attachmentName: sealRecord.attachmentName,
      contentId: sealRecord.contentId,
    });

    // Notify seal owner when a steward forcefully unseals their artifact
    if (releaseReason === "admin override" && sealRecord.lockedBy && sealRecord.contentId) {
      try {
        const stewardInfo = await fetchOperatorProfile(operatorAccountId);
        const unsealDate = new Date().toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        await mailStewardOverrideNotice(
          sealRecord.lockedBy,
          operatorAccountId,
          stewardInfo.displayName,
          sealRecord.attachmentName || "Unknown Attachment",
          sealRecord.contentId,
          unsealDate,
        );
      } catch (noticeError) {
        console.error(
          "[UNSEAL] Failed to post steward override notice:",
          noticeError,
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
    const allSeals = [];

    // it56: the incoming `cursor` is a stable KEYSET anchor (`t|id`) over the filtered+sorted result,
    // NOT an opaque KVS cursor (the KVS scan always starts fresh below) and NOT a numeric OFFSET —
    // the offset dup'd/skipped items under concurrent seal/unseal (audit C2 / it55 finding). An old
    // numeric cursor decodes to null → a one-time reset to page 1 on deploy (harmless).
    const pageCursor = decodeKeysetCursor(cursor);
    let kvsCursor = null;
    let iteration = 0;
    const maxIterations = 10;

    let query = kvs
      .query()
      .where("key", WhereConditions.beginsWith("protection-"))
      .limit(100);

    if (kvsCursor) {
      query = query.cursor(kvsCursor);
    }

    do {
      iteration++;

      try {
        const { results, nextCursor } = await query.getMany();
        if (results && results.length > 0) {
          allSeals.push(...results);
        }

        kvsCursor = nextCursor;

        if (iteration >= maxIterations) {
          console.warn("[ENUMERATE-OPERATOR-SEALS] Hit iteration limit, stopping");
          break;
        }

        if (kvsCursor) {
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

    if (allSeals.length === 0) {
      return {
        attachments: [],
        hasMore: false,
        nextCursor: null,
        total: 0,
      };
    }

    // Filter seals owned by the current operator
    const operatorSeals = allSeals.filter(
      ({ value }) => value && value.lockedBy === operatorAccountId,
    );

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
        let attDownloadLink = null;
        let attMediaType = null;
        let isStale = false;
        let staleReason = null;

        // Hunt H2-F1: a READ must never tear down protection state on an unproven negative
        // (the 2026-07-17 doctrine). Delete only a DOUBLE-CONFIRMED purge; a trashed file is
        // recoverable → mark stale (enumeratePageSeals parity); anything transient keeps the
        // seal and just skips the row for this render.
        try {
          const artifactResponse = await asUser().requestConfluence(
            route`/wiki/api/v2/attachments/${artifactId}`,
          );
          if (!artifactResponse.ok) {
            if (
              artifactResponse.status === 404 &&
              (await confirmAttachmentPurged(artifactId))
            ) {
              await kvs.delete(`protection-${artifactId}`);
              if (value.spaceId) {
                await kvs.delete(`space-protection-${value.spaceId}-${artifactId}`);
              }
            }
            continue;
          }
          const artifactData = await artifactResponse.json();
          if (artifactData.status && artifactData.status !== "current") {
            isStale = true;
            staleReason = artifactData.status === "trashed" ? "trashed" : artifactData.status;
          }
          artifactTitle = artifactData.title || artifactTitle;
          fileSize = artifactData.fileSize
            ? `${Math.round(artifactData.fileSize / 1024)}KB`
            : "Unknown";
          attDownloadLink = artifactData.downloadLink || artifactData._links?.download || null;
          attMediaType = artifactData.mediaType || null;
        } catch (attErr) {
          console.warn(
            `[ENUMERATE-OPERATOR-SEALS] probe failed for ${artifactId} — keeping seal, skipping row:`,
            attErr,
          );
          continue;
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
          isStale,
          staleReason,
          autoUnlockEnabled: autoUnsealActive,
          downloadLink: attDownloadLink,
          mediaType: attMediaType,
        });
      } catch (sealErr) {
        console.error(`Error processing seal ${key}:`, sealErr);
      }
    }

    // it56: stable keyset pagination (sort by lockedOn desc, id desc; then SEEK past the anchor)
    // over the filtered result — no dup/skip under concurrent seal/unseal.
    const { page, hasMore, nextCursor, total } = keysetPage(sealedArtifacts, pageCursor, limit);

    return {
      attachments: page,
      hasMore,
      nextCursor: encodeKeysetCursor(nextCursor),
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
  const ctxPageId = req.context.extension?.content?.id;
  const contentId = req.payload?.pageId || ctxPageId;

  if (!contentId) {
    return { claimedArtifacts: [] };
  }

  // SV-SEC-1 (disclosure side): the records carry attachment ids and filenames, who holds each
  // seal and their display name, and lock/expiry times — so a payload-named page id enumerated
  // all of that for any page on the site. A context id needs no call: rendering here already
  // required read access.
  if (mustVerify(req.payload?.pageId, ctxPageId)
    && !(await canReadPage(req.context.accountId, contentId))) {
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

    // Read global policy for restore/purge toggles
    const globalPolicy = await kvs.get("admin-settings-global");
    const allowRestore = globalPolicy?.allowSealRestore === true;
    const allowPurge = globalPolicy?.allowSealPurge === true;
    const allowDelete = globalPolicy?.allowArtifactDelete === true;

    const claimedArtifacts = await Promise.all(
      pageSeals.map(async ({ key, value }) => {
        const artifactId = value.attachmentId || key.replace("protection-", "");
        const isMine = value.lockedBy === operatorAccountId;
        const isExpired = value.expiresAt && new Date(value.expiresAt) < new Date();

        // Probe attachment existence to detect stale seals
        let isStale = false;
        let staleReason = null;
        try {
          const probeRes = await asApp().requestConfluence(
            route`/wiki/api/v2/attachments/${artifactId}`,
          );
          if (probeRes.ok) {
            const probeData = await probeRes.json();
            if (probeData.status === "trashed") {
              isStale = true;
              staleReason = "trashed";
            }
          } else if (probeRes.status === 404) {
            isStale = true;
            staleReason = "deleted";
          }
        } catch (_) {
          // Probe failure — treat as non-stale to avoid false positives
        }

        return {
          id: artifactId,
          title: value.attachmentName || "Unknown file",
          lockStatus: isMine ? "HELD_BY_ACTOR" : "HELD",
          lockedByAccountId: value.lockedBy,
          lockedByName: value.lockedByName,
          expiresAt: value.expiresAt || null,
          isExpired: !!isExpired,
          lockedOn: value.timestamp || null,
          isStale,
          staleReason,
          allowRestore,
          allowPurge,
          allowDelete,
          // Minimal data — Confluence metadata will be merged later
          fileSize: null,
          mediaType: null,
          labels: [],
          comment: null,
          notifyRequested: false,
        };
      }),
    );

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

/**
 * Restore a trashed attachment back to the page.
 * Works for any trashed attachment — with or without a seal record.
 */
export const restoreSealedArtifact = async (req) => {
  const { attachmentId } = req.payload;

  if (!attachmentId) {
    return { success: false, reason: "Missing attachmentId" };
  }

  // Check admin toggle
  const globalPolicy = await kvs.get("admin-settings-global");
  if (globalPolicy?.allowSealRestore !== true) {
    return { success: false, reason: "Restore is disabled by admin" };
  }

  // Probe attachment status
  const probeRes = await asApp().requestConfluence(
    route`/wiki/api/v2/attachments/${attachmentId}`,
  );

  if (probeRes.status === 404) {
    return { success: false, reason: "Attachment was permanently deleted and cannot be recovered", unrecoverable: true };
  }

  if (!probeRes.ok) {
    return { success: false, reason: `Failed to probe attachment: ${probeRes.status}` };
  }

  const probeData = await probeRes.json();

  if (probeData.status === "current") {
    return { success: false, reason: "Attachment already exists on the page" };
  }

  if (probeData.status !== "trashed") {
    return { success: false, reason: `Unexpected attachment status: ${probeData.status}` };
  }

  // Determine page ID from seal record or attachment container
  const sealRecord = await kvs.get(`protection-${attachmentId}`);
  // SV-SEC-1: req.payload.pageId used to sit in this chain, so a caller could name the page the
  // asApp PUT below would restore onto. Only the seal's own record or the caller's genuine
  // context may decide that.
  const pageId = sealRecord?.contentId || req.context.extension?.content?.id;

  if (!pageId) {
    return { success: false, reason: "Cannot determine parent page — unable to restore" };
  }

  // SV-SEC-1. Nothing here consulted req.context.accountId at all: the only gate was the global
  // allowSealRestore toggle, and the un-trash runs as the app. So once an admin enabled the
  // feature, any logged-in user could resurrect any deleted attachment anywhere on the site —
  // including files removed deliberately — on a page they cannot read. Same bar as purge:
  // the seal's owner, or a steward of the space the SEAL lives in, evaluated against the object.
  const operatorAccountId = req.context.accountId;
  const restoreRealmKey = sealRecord?.spaceKey
    || req.context.extension?.content?.space?.key
    || req.context.extension?.space?.key
    || null;
  const restoreIsOwner = !!sealRecord?.lockedBy && sealRecord.lockedBy === operatorAccountId;
  if (!restoreIsOwner) {
    const stewardOk = restoreRealmKey
      ? await authorizeSteward(operatorAccountId, restoreRealmKey)
      : false;
    // No record, or not a steward of its space: fall back to the caller's own rights on the page
    // the file would land on. That keeps the legitimate "restore a file I could have deleted"
    // case working without handing out the app's site-wide reach.
    if (!stewardOk && !(await canEditPage(operatorAccountId, pageId))) {
      return { success: false, reason: "You do not have permission to restore this file" };
    }
  }

  const currentVersion = probeData.version?.number;
  if (!currentVersion) {
    return { success: false, reason: "Cannot determine attachment version" };
  }

  const restoreRoute = route`/wiki/rest/api/content/${pageId}/child/attachment/${attachmentId}`;
  const restoreRes = await asApp().requestConfluence(restoreRoute, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: attachmentId,
      type: "attachment",
      status: "current",
      title: probeData.title || sealRecord?.attachmentName || "Unknown",
      version: { number: currentVersion + 1 },
    }),
  });

  if (!restoreRes.ok) {
    const errorText = await restoreRes.text();
    console.error(`[RESTORE] Failed ${attachmentId}: ${restoreRes.status} — ${errorText}`);
    return { success: false, reason: `Restore failed: ${restoreRes.status}` };
  }

  // Clean up tracking-only records (not real seals) after restore
  if (sealRecord?.trashedOnly) {
    await kvs.delete(`protection-${attachmentId}`);
  }

  await touchSealTimestamp();
  console.warn(`[RESTORE] Restored attachment ${attachmentId}`);
  return { success: true };
};

/**
 * Purge an attachment permanently and clean up all seal state.
 * This is a destructive action — the attachment cannot be recovered.
 */
export const purgeSealRecord = async (req) => {
  const { attachmentId } = req.payload;
  const operatorAccountId = req.context.accountId;
  const realmKey =
    req.context.extension?.content?.space?.key ||
    req.context.extension?.space?.key;

  if (!attachmentId) {
    return { success: false, reason: "Missing attachmentId" };
  }

  // Check admin toggle
  const globalPolicy = await kvs.get("admin-settings-global");
  if (globalPolicy?.allowSealPurge !== true) {
    return { success: false, reason: "Purge is disabled by admin" };
  }

  const sealRecord = await kvs.get(`protection-${attachmentId}`);

  // audit C2: the owner/steward gate now covers the NO-SEAL path too. Purge is a PERMANENT,
  // unrecoverable delete (`?purge=true` below). Previously this block was wrapped in
  // `if (sealRecord && sealRecord.lockedBy)`, so when no seal record existed the ONLY gate was the
  // global allowSealPurge toggle → ANY user could permanently purge ANY attachment by id (it46).
  // Require owner-or-steward UNCONDITIONALLY. realmKey falls back to the seal record's own spaceKey
  // when the calling surface lacks page/space context, so a legitimate steward isn't wrongly denied.
  //
  // SV-SEC-1 follow-on: the precedence here was inverted. It read the CALLER's context space
  // first and fell back to the seal's, which is the confused deputy again — a steward of any one
  // space could purge a seal belonging to another. The object's own space is authoritative;
  // context is the fallback, which is what the paragraph above always meant.
  const effectiveRealmKey = sealRecord?.spaceKey || realmKey || null;
  const isOwner = !!sealRecord?.lockedBy && sealRecord.lockedBy === operatorAccountId;
  if (!isOwner) {
    const hasStewardAccess = effectiveRealmKey
      ? await authorizeSteward(operatorAccountId, effectiveRealmKey)
      : false;
    if (!hasStewardAccess) {
      return { success: false, reason: "Only the seal owner or a steward can purge" };
    }
    // With no seal record there is no trustworthy space for the TARGET at all, so the steward
    // check above can only ever have been about somewhere else. Purge is permanent and
    // unrecoverable, so in that case also require rights on the attachment itself.
    if (!sealRecord && !(await canEditPage(operatorAccountId, attachmentId))) {
      return { success: false, reason: "You do not have permission to purge this file" };
    }
  }

  // Permanently delete the attachment from Confluence (if it still exists)
  try {
    // First check if attachment is trashed — must trash before purging
    const probeRes = await asApp().requestConfluence(
      route`/wiki/api/v2/attachments/${attachmentId}`,
    );
    if (probeRes.ok) {
      const probeData = await probeRes.json();
      if (probeData.status === "current") {
        // Trash it first
        const trashRes = await asUser().requestConfluence(
          route`/wiki/api/v2/attachments/${attachmentId}`,
          { method: "DELETE" },
        );
        if (!trashRes.ok && trashRes.status !== 204) {
          return { success: false, reason: `Failed to trash attachment: ${trashRes.status}` };
        }
      }
      // Now permanently delete
      const purgeRes = await asApp().requestConfluence(
        route`/wiki/api/v2/attachments/${attachmentId}?purge=true`,
        { method: "DELETE" },
      );
      if (!purgeRes.ok && purgeRes.status !== 204 && purgeRes.status !== 404) {
        console.warn(`[PURGE] Permanent delete returned ${purgeRes.status} for ${attachmentId}`);
      }
    }
    // 404 = already gone — that's fine
  } catch (err) {
    console.warn(`[PURGE] Error deleting attachment ${attachmentId}:`, err);
  }

  // Clean up seal state if present
  if (sealRecord) {
    await purgeAllSealState(attachmentId, sealRecord);
  }

  // Clean up watcher subscriptions
  const watchPrefix = `notification-${attachmentId}-`;
  const { results: watchEntries } = await kvs
    .query()
    .where("key", WhereConditions.beginsWith(watchPrefix))
    .limit(50)
    .getMany();
  for (const { key } of watchEntries) {
    await kvs.delete(key);
  }

  // Clear any Edit Requests / grants tied to this seal
  await sweepEditAccess(attachmentId);

  console.warn(`[PURGE] Permanently removed ${sealRecord?.attachmentName || attachmentId}`);
  return { success: true };
};

export const actions = [
  ["seal-artifact", sealArtifact],
  ["unseal-artifact", unsealArtifact],
  ["enumerate-doc-artifacts", enumerateDocArtifacts],
  ["enumerate-operator-seals", enumerateOperatorSeals],
  ["enumerate-page-seals", enumeratePageSeals],
  ["check-seal-stamp", checkSealStamp],
  ["restore-sealed-artifact", restoreSealedArtifact],
  ["purge-seal-record", purgeSealRecord],
];
