import { asUser, asApp, route } from "@forge/api";
import { requestUserOrApp, currentUserProfile } from "../../shared/user-or-app.js";
import { kvs, WhereConditions } from "@forge/kvs";

// Import from shared
import { BASELINE_HOLD_SPAN, sanitizeHoldDuration } from "../../shared/baseline.js";
import { keysetPage, encodeKeysetCursor, decodeKeysetCursor } from "../../shared/pagination.js";
import { restampIfEnforced } from "../workflow/logic.js";
import { authorizeSteward } from "../../shared/steward-checks.js";
import { canEditPage, canReadPage, mustVerify, resolvePageSpaceKey, objectSpaceKeyOf, isStewardOfRecord } from "../../shared/content-access.js";
import { resolveBulletinToggles } from "../../shared/bulletin-flags.js";
import { setUntil } from "../../shared/kvs-ttl.js";

// Import from infra
import {
  mailSealConfirmation,
  mailStewardOverrideNotice,
  fetchOperatorProfile,
} from "../../infra/notice-composer.js";

// Import from capsule logic
import { countPageAttachments, writeSealContentProp, removeSealContentProp, touchSealTimestamp, resolveSealHoldPeriod } from "./logic.js";
import { readDocBody } from "../../infra/doc-surgery.js";
import { confirmAttachmentPurged, putAttachmentCurrent } from "../../infra/attachment-status.js";
import { findSealedMediaSingle, capturePresentation } from "../../infra/media-presentation.js";
import { purgeAllSealState } from "./confluence-sync.js";
import { releaseSeal } from "./release.js";
import { listSectionSealRecordsForPage } from "../section-seals/logic.js";
import { recordActivity } from "../../infra/activity-log.js";
import { validateReleaseReason } from "../../shared/release-reason.js";

// Import from sibling capsules
import { notifyWatchers, sweepWatchers } from "../bulletins/logic.js";
import { sweepEditAccess } from "../editreq/logic.js";
import { triggerPanelEmbed, removePanelNode } from "../../infra/doc-surgery.js";
import { refreshByline, writeBylineFor } from "../page-details/byline.js"; // 5.0 byline chip — one line per seal write, never awaited into the result
// 5.0 ribbon (mockup §2/§3): the summary carries the classification, the steward's ribbon setting,
// the viewer's waiting-on-me numbers for THIS page and the first seal the viewer does not own.
import { getClassificationProvider, classificationActiveForPage } from "../classification/provider.js";
import { heldRefusal, isWorkflowHeld } from "../../shared/seal-authority.js"; // SEC-2
import { isLiveAttachmentSeal } from "../../shared/live-seal.js"; // a trashedOnly stub is not a seal
import { getActiveEditGrant, getActiveSectionEditGrant, listPendingRequestsForOwner, listPendingSectionRequestsForOwner, resolveEditCooldownMs } from "../editreq/logic.js";
import { retryAtFor } from "../../shared/edit-cooldown.js"; // SEC-8: the ribbon's declined state
import { listMyApprovals, describeWorkflowForPage } from "../workflow/approvals.js";

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

        // Tester report 2026-09-21 (counts vs cards): the SAME seal test countPageAttachments uses —
        // an S7 trashedOnly tracking stub (or an ownerless record) is not a seal. Before, any record
        // read as HELD here while the counter skipped it, so the badge and the cards disagreed.
        if (sealRecord?.lockedBy && !sealRecord.trashedOnly) {
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
          workflowHeld: isWorkflowHeld(sealRecord), // SEC-2
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

    // Whole-page counts on the FIRST page only (tester report 2026-09-19: the group numbers were
    // the cards on screen, not the attachments on the page).
    let counts = null;
    if (!cursor || cursor === "0") {
      try { counts = await countPageAttachments(contentId, req.context.accountId, (u) => asUser().requestConfluence(u)); }
      catch (e) { console.warn("[ENUMERATE-DOC-ARTIFACTS] counts failed:", e?.message || e); }
    }
    return {
      attachments: artifactsWithSealState,
      hasMore,
      nextCursor,
      counts,
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
 * Steward power over an attachment seal: an admin of the space the file's page is in NOW and, if
 * the page moved since it was sealed, of the seal's own space too (content-access.js
 * recordAuthoritySpaces). The seal's stored space alone left the old space's admins able to force,
 * extend, purge or restore the file of a page that had left them. Never the caller's context.
 */
function stewardOfAttachmentSeal(check, accountId, sealRecord) {
  return isStewardOfRecord(check, accountId, { contentId: sealRecord?.contentId || null, storedKey: sealRecord?.spaceKey || null });
}

/**
 * Seal an artifact for the specified duration
 */
const sealArtifact = async (req) => {
  const { attachmentId } = req.payload;
  const operatorAccountId = req.context.accountId;

  // Guard: reject if already sealed by a DIFFERENT user — but treat an EXPIRED seal as
  // absent (SV-M8). The expiry sweep reminds the owner and releases the seal only after its
  // reminders run out (F5), so an expired-but-unreleased seal would otherwise block a
  // legitimate re-seal for days.
  //
  // An S7 trashedOnly TRACKING record is absent too: it is not a seal (its lockedBy is whoever
  // trashed the file, and it has no expiry), so a file restored outside the app — the record left
  // behind — used to read as "already sealed by another user" forever.
  //
  // Nothing is torn down HERE: the replaced record is only remembered, and its teardown runs
  // after the permission gate below. Deleting first let a caller who may not edit the file wipe
  // someone's lapsed seal (and its edit access) and only then be refused.
  const existingSeal = await kvs.get(`protection-${attachmentId}`);
  let staleSeal = null;
  let staleRealmIndexId = null;
  if (existingSeal?.trashedOnly) {
    staleSeal = existingSeal;
  } else if (isLiveAttachmentSeal(existingSeal) && existingSeal.lockedBy !== operatorAccountId) {
    const expired = existingSeal.expiresAt && new Date(existingSeal.expiresAt) < new Date();
    if (!expired) {
      return {
        success: false,
        reason: "Attachment is already sealed by another user",
      };
    }
    staleSeal = existingSeal;
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

  // The space policy is still read here for its spaceId fallback; the DURATION chain it used
  // to also compute inline now lives in resolveSealHoldPeriod (sealing/logic.js) so seal,
  // section-seal and extend-seal all resolve a hold period the same way. It carries the it55
  // /B14 clamp with it: store-policy persists autoUnlockTimeoutHours / defaultLockDuration RAW,
  // so a negative/NaN/absurd stored value would otherwise reach expiresAt as a date in the past
  // (a record that reads "sealed" while unprotected) or crash the Date.
  if (realmKey && !realmId) {
    const sanitizedRealmKey = realmKey.replace(/[^a-zA-Z0-9:._\s-#]/g, "_");
    const realmPolicy = await kvs.get(`admin-settings-space-${sanitizedRealmKey}`);
    if (realmPolicy?.spaceId) realmId = realmPolicy.spaceId;
  }

  // holdPeriod / expiresAt are computed AFTER the space derivation below: with no panel context
  // the space (and so its policy's default duration) is known only once the file's page is.

  // The sealer's display name (shown on the seal). Their email is NOT stored (2026-10-04): no
  // reader ever used it, and it was published in the page property (seal-property.js).
  let operatorDisplayName = "Current User";
  try {
    const prof = await currentUserProfile(operatorAccountId);
    operatorDisplayName = prof.displayName || "Current User";
  } catch (error) {
    console.warn("Failed to fetch operator display name:", error);
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
    const artifactResponse = await requestUserOrApp(artifactRoute);
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
    // ...and so does its SPACE. The context's space describes where the caller is standing, not
    // the file: keeping it would stamp the seal with a spaceKey the steward gates (unseal, purge,
    // restore, extend) then trust as the object's own. Re-derived from the page just below.
    realmKey = null;
    realmId = null;
  }
  // SEC-2 (tester 2026-09-25): on an Approved page nothing is sealed except by the workflow's
  // privileged set — a new personal seal would hand one person control of a file on a page that
  // is meant to change only through its approvers. Dynamic import: no cycle with workflow.
  if (contentId) {
    const { workflowPrivilegeForPage, ENFORCED_SEAL_REFUSAL } = await import("../workflow/privilege.js");
    const p = await workflowPrivilegeForPage(contentId, operatorAccountId).catch(() => ({ enforced: false }));
    if (p.enforced && !p.privileged) return { success: false, reason: ENFORCED_SEAL_REFUSAL };
  }
  // The caller has passed every gate — only now is the record this seal replaces torn down.
  if (staleSeal) {
    // Sweep the prior owner's edit-access records (it55; parity with every other teardown —
    // unseal/purge). editreq records carry no TTL, so without this a stale denied/pending
    // edit-request from the old owner leaks into the new owner's fresh seal (blocking a
    // requester, or surfacing a phantom request the new owner could approve). The record itself
    // is overwritten by the write below.
    await sweepEditAccess(attachmentId).catch(() => {});
    // Hunt H2-F5b: remember the old seal's space so its index leg can be dropped below once
    // the NEW seal's space is resolved — otherwise a stale row (previous owner's name/expiry)
    // survives whenever the new seal lands in a different space or resolves no space at all.
    staleRealmIndexId = staleSeal.spaceId || null;
  }
  // No panel context (the config API consumer, the hook), or a file that lives on another page
  // than the one the caller stands on: the space is a property of the page the file LIVES on,
  // derived from the object itself — never from a caller-supplied context.
  if (!realmKey && contentId) {
    realmKey = await resolvePageSpaceKey(contentId);
    if (realmKey && !realmId) {
      try {
        const sres = await asApp().requestConfluence(route`/wiki/api/v2/spaces?keys=${realmKey}&limit=1`, { headers: { Accept: "application/json" } });
        const sid = sres.ok ? (await sres.json())?.results?.[0]?.id : null;
        if (sid != null) realmId = String(sid);
      } catch (_) { /* index leg keyed by the policy row's spaceId below, if any */ }
      if (!realmId) {
        const realmPolicy = await kvs.get(`admin-settings-space-${realmKey.replace(/[^a-zA-Z0-9:._\s-#]/g, "_")}`);
        if (realmPolicy?.spaceId) realmId = realmPolicy.spaceId;
      }
    }
  }
  const holdPeriod = await resolveSealHoldPeriod(realmKey, req.payload.lockDuration);
  const expiresAt = new Date(Date.now() + holdPeriod * 1000).toISOString();

  // Fetch page title
  let pageTitle = "Unknown Page";
  if (contentId) {
    try {
      const pageResponse = await requestUserOrApp(
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
    note: typeof req.payload.note === "string" && req.payload.note.trim() ? req.payload.note.trim().slice(0, 300) : null, // 5.0 seal action: the optional note
  };

  // Hunt H2-F5b: the write below replaces the old record (an expired seal of another user, or a
  // trashedOnly stub) but not its space index leg — drop it now that the new space is known,
  // unless the new index write below will overwrite the very same key.
  if (staleRealmIndexId && String(staleRealmIndexId) !== String(realmId || "")) {
    await kvs.delete(`space-protection-${staleRealmIndexId}-${attachmentId}`).catch(() => {});
  }

  // A fresh seal starts a fresh lapse cycle. The sweep's counters are keyed by the attachment, not
  // by the seal: left from a previous seal on the same file (a lapsed one this replaces, or the
  // owner's own lapsed seal re-sealed), they would start the new seal's countdown part-way
  // through — fewer reminders than the policy promises before the auto-release.
  await kvs.delete(`expiry-notified-${attachmentId}`).catch(() => {});
  await kvs.delete(`fifty-percent-reminder-sent-${attachmentId}`).catch(() => {});
  await kvs.delete(`reminder-sent-${attachmentId}`).catch(() => {});

  // Store seal record
  await kvs.set(`protection-${attachmentId}`, sealPayload);
  await touchSealTimestamp();
  // A1: the seal exists from this write on — record it here, before the best-effort tail
  // (content property, index, comment, panel) any of which may fail without unsealing.
  await recordActivity({
    type: "seal.created",
    pageId: contentId || null,
    spaceKey: realmKey || null,
    actor: { accountId: operatorAccountId, name: operatorDisplayName },
    target: { kind: "attachment", id: attachmentId, name: artifactName },
    details: { expiresAt, lockDuration: holdPeriod, sealedVersion, embedded: embedded ?? null },
    version: null,
  });
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
  if (contentId) await refreshByline(contentId).catch((e) => console.warn("[BYLINE] seal refresh failed:", e?.message || e));

  return { success: true };
};

/**
 * Unseal an artifact (owner or steward override)
 */
const unsealArtifact = async (req) => {
  const { attachmentId, adminOverride, reason: rawReason } = req.payload;
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
  let forcedReason = null; // Part 3.5: the typed break-glass reason (steward path only)
  // The space the SEAL lives in: its own spaceKey, else its page's. Never the caller's context —
  // that is only used below where nothing is authorized by it (the panel re-embed's fallback).
  const objectSpaceKey = await objectSpaceKeyOf(sealRecord);

  if (sealRecord.lockedBy === operatorAccountId && !adminOverride) {
    // SEC-2: while the page is Approved the seal is the workflow's — the owner cannot release it.
    { const held = heldRefusal(sealRecord, "release"); if (held) return { success: false, reason: held }; }
    canRelease = true;
    releaseReason = "owner unlock";
  } else if (adminOverride && objectSpaceKey) {
    // SV-SEC-1 (confused deputy). This used to ask "is the caller a steward of the space they
    // are STANDING IN", while acting on a seal named by a payload attachmentId that carries its
    // own spaceKey. Administering one space — a personal space is enough — therefore granted force-unseal
    // over every sealed file on the site, and the teardown below drives an asApp body rewrite on
    // the victim's page. Authorize against the space the SEAL lives in. The caller's context used
    // to be the fallback for records that never recorded one, which reopened the same hole for
    // exactly those records; the fallback is now the record's PAGE's space (objectSpaceKeyOf),
    // and a record whose space cannot be resolved is refused.
    // A steward of the space the file's page is in NOW and, if the page moved since it was sealed,
    // of the seal's own space as well (content-access.js recordAuthoritySpaces).
    const hasStewardAccess = await stewardOfAttachmentSeal(authorizeSteward, operatorAccountId, sealRecord);
    if (hasStewardAccess) {
      // Part 3.5: same rule as unseal-section / steward-unseal — shared/release-reason.js.
      const v = validateReleaseReason(rawReason);
      if (!v.ok) return { success: false, reason: v.error };
      forcedReason = v.reason;
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
    // The teardown itself lives in ./release.js so the expiry sweep's auto-release (F5)
    // runs the SAME one — six key families have to be cleaned in step, and two copies of
    // that list is how they end up disagreeing.
    const released = await releaseSeal(attachmentId, sealRecord, { fallbackSpaceKey: objectSpaceKey || realmKey });
    if (!released.success) return released;

    // A1: the seal is gone from this point — owner release and steward force are different
    // events to the record (the second names someone acting on another person's seal).
    await recordActivity({
      type: releaseReason === "admin override" ? "seal.forced" : "seal.released",
      pageId: sealRecord.contentId || null,
      spaceKey: objectSpaceKey || null, // the seal's space — a row in the caller's space's report would misfile it
      actor: {
        accountId: operatorAccountId,
        name: releaseReason === "admin override" ? null : (sealRecord.lockedByName || null),
      },
      target: { kind: "attachment", id: attachmentId, name: sealRecord.attachmentName || null },
      details: releaseReason === "admin override"
        ? { forced: true, reason: forcedReason, ownerAccountId: sealRecord.lockedBy || null, ownerName: sealRecord.lockedByName || null }
        : {},
      version: null,
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
          sealRecord.spaceKey || null,
          forcedReason,
        );
      } catch (noticeError) {
        console.error(
          "[UNSEAL] Failed to post steward override notice:",
          noticeError,
        );
      }
    }

    return { success: true, reason: releaseReason };
  } else {
    return { success: false, reason: "Permission denied" };
  }
};

/**
 * Extend a seal's retention period (F4 — owner feedback 2026-08-27).
 *
 * Before this there was exactly one way out of an overdue seal: unseal it and seal it
 * again, which loses the labels, the comment, the presentation baseline and every edit
 * grant hanging off it. "Overdue" was therefore a dead end that the UI offered no way
 * back from, which is also what made the expired-seal refusal on approve-edit-request
 * look like a broken button.
 *
 * Authorization is the SAME bar as unsealArtifact, deliberately: the only client input
 * is attachmentId, and everything else is read from the seal record that id resolves to
 * (its own spaceKey, its own contentId), so there is no payload object to be a deputy
 * for. Owner, or a steward of the space the SEAL lives in — never the space the caller
 * happens to be standing in.
 */
export const extendSeal = async (req) => {
  const { attachmentId, additionalSeconds } = req.payload || {};
  const operatorAccountId = req.context.accountId;
  if (!attachmentId) return { success: false, reason: "Missing attachment" };

  const sealRecord = await kvs.get(`protection-${attachmentId}`);
  if (!sealRecord || !sealRecord.lockedBy) {
    return { success: false, reason: "This file is not sealed" };
  }
  // S7: a trashedOnly record is a tracking stub, not a seal — there is no retention to extend.
  if (sealRecord.trashedOnly) {
    return { success: false, reason: "This file is in the trash — restore it before extending the seal" };
  }

  // Review: the record's own space, or its page's — never the caller's context space (a steward
  // of any space could otherwise extend a spaceKey-less seal anywhere). The same key picks the
  // hold-period policy and files the activity row: the caller's context used to do both, so a
  // steward standing in another space extended by THAT space's policy and logged it there.
  let objectSpaceKey = null;
  try { objectSpaceKey = await objectSpaceKeyOf(sealRecord); } catch (_) { objectSpaceKey = null; }

  let authorized = sealRecord.lockedBy === operatorAccountId;
  if (!authorized) {
    authorized = !!objectSpaceKey && await stewardOfAttachmentSeal(authorizeSteward, operatorAccountId, sealRecord);
  }
  if (!authorized) {
    return { success: false, reason: "Only the seal owner or a space admin can extend this seal" };
  }
  { const held = heldRefusal(sealRecord, "extend"); if (held) return { success: false, reason: held }; } // SEC-2

  // How long to add: an explicit request wins, otherwise the same policy chain a fresh
  // seal would resolve. sanitizeHoldDuration is the it55 clamp — a negative or NaN value
  // would otherwise produce an expiry in the PAST, i.e. an "extension" that expires the seal.
  let addSeconds = sanitizeHoldDuration(additionalSeconds, 0);
  if (!addSeconds) {
    addSeconds = await resolveSealHoldPeriod(objectSpaceKey);
  }
  addSeconds = sanitizeHoldDuration(addSeconds, BASELINE_HOLD_SPAN);

  // A live seal extends from its current expiry (the owner keeps what they already had);
  // a lapsed one extends from now, because anchoring on a date in the past would hand back
  // a seal that is still overdue.
  const now = Date.now();
  const currentExpiryMs = sealRecord.expiresAt ? new Date(sealRecord.expiresAt).getTime() : 0;
  const anchorMs = Number.isFinite(currentExpiryMs) && currentExpiryMs > now ? currentExpiryMs : now;
  const newExpiresAt = new Date(anchorMs + addSeconds * 1000).toISOString();

  const updated = {
    ...sealRecord,
    expiresAt: newExpiresAt,
    extendedAt: new Date().toISOString(),
    extendedBy: operatorAccountId,
    extensionCount: (Number(sealRecord.extensionCount) || 0) + 1,
  };
  delete updated.lockedByEmail; // a 6.6.0-era record carried the sealer's email; no reader ever used it
  await kvs.set(`protection-${attachmentId}`, updated);
  await touchSealTimestamp();
  // A1: the new expiry is live from this write on.
  await recordActivity({
    type: "seal.extended",
    pageId: sealRecord.contentId || null,
    spaceKey: objectSpaceKey || null,
    actor: {
      accountId: operatorAccountId,
      name: sealRecord.lockedBy === operatorAccountId ? (sealRecord.lockedByName || null) : null,
    },
    target: { kind: "attachment", id: attachmentId, name: sealRecord.attachmentName || null },
    details: {
      previousExpiresAt: sealRecord.expiresAt || null,
      expiresAt: newExpiresAt,
      addedSeconds: addSeconds,
      extensionCount: updated.extensionCount,
      byOwner: sealRecord.lockedBy === operatorAccountId,
    },
    version: null,
  });

  // The space index row carries its own copy of expiresAt — the consoles render "Overdue"
  // from THAT, so leaving it behind means the steward view keeps showing a seal as lapsed
  // after it was extended.
  if (sealRecord.spaceId) {
    try {
      const indexKey = `space-protection-${sealRecord.spaceId}-${attachmentId}`;
      const indexRow = await kvs.get(indexKey);
      if (indexRow) await kvs.set(indexKey, { ...indexRow, expiresAt: newExpiresAt });
    } catch (e) {
      console.warn("[EXTEND-SEAL] index row update failed:", e);
    }
  }

  if (sealRecord.contentId) {
    await writeSealContentProp(sealRecord.contentId, updated).catch((e) =>
      console.warn("[EXTEND-SEAL] content property update failed:", e));
  }

  // Edit grants were written with a KVS TTL pinned to the OLD expiry so they die with the
  // seal. Extending the seal without extending them would silently revoke an approved
  // editor's access partway through the new period.
  try {
    const { results } = await kvs
      .query()
      .where("key", WhereConditions.beginsWith(`edit-grant-${attachmentId}-`))
      .limit(50)
      .getMany();
    for (const { key, value } of results || []) {
      if (!value) continue;
      await setUntil(key, { ...value, expiresAt: newExpiresAt }, new Date(newExpiresAt).getTime());
    }
  } catch (e) {
    console.warn("[EXTEND-SEAL] edit-grant TTL extension failed:", e);
  }

  // Restart the lapse cycle: the sweep's notice counter and its dedup flags describe the
  // period that just got extended. Leaving them would mean the next lapse notifies fewer
  // times than the policy promises, or not at all.
  await kvs.delete(`expiry-notified-${attachmentId}`).catch(() => {});
  await kvs.delete(`fifty-percent-reminder-sent-${attachmentId}`).catch(() => {});

  return { success: true, expiresAt: newExpiresAt, extensionCount: updated.extensionCount };
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
              (await confirmAttachmentPurged(artifactId, undefined, { pageId: value.contentId || null }))
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
          workflowHeld: isWorkflowHeld(value), // SEC-2: My work says "held by the approval of the page"
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
          workflowHeld: isWorkflowHeld(value), // SEC-2
          lockedOn: value.timestamp || null,
          isStale,
          staleReason,
          trashedBy: value.trashedBy || null,
          trashedAt: value.trashedAt || null,
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

  // Determine page ID from the attachment's own container, then the seal record.
  const sealRecord = await kvs.get(`protection-${attachmentId}`);
  // SV-SEC-1: req.payload.pageId used to sit in this chain, so a caller could name the page the
  // asApp PUT below would restore onto. The caller's context was the last fallback, which is the
  // same mistake one step removed: it names where the caller stands, not where the file lives.
  // The trashed attachment's v2 body carries its page (attachment-status.js decision table), and
  // the seal record names the page it was sealed on — only the object decides.
  // (A blog post's attachment names its container as blogPostId — the context used to cover it.)
  const pageId = probeData.pageId || probeData.blogPostId || sealRecord?.contentId || null;

  if (!pageId) {
    return { success: false, reason: "Cannot determine parent page — unable to restore" };
  }

  // SV-SEC-1. Nothing here consulted req.context.accountId at all: the only gate was the global
  // allowSealRestore toggle, and the un-trash runs as the app. So once an admin enabled the
  // feature, any logged-in user could resurrect any deleted attachment anywhere on the site —
  // including files removed deliberately — on a page they cannot read. Same bar as purge:
  // the seal's owner, or a steward of the space the SEAL lives in, evaluated against the object.
  // The space is the record's own, else its page's — never the caller's context (a steward of the
  // space they stand in used to clear every record that carried no spaceKey, site-wide).
  const operatorAccountId = req.context.accountId;
  // The steward arm: the space the file's page is in now and, if it moved, the seal's own.
  const restoreIsOwner = !!sealRecord?.lockedBy && sealRecord.lockedBy === operatorAccountId;
  if (!restoreIsOwner) {
    const stewardOk = await isStewardOfRecord(authorizeSteward, operatorAccountId, { contentId: pageId, storedKey: sealRecord?.spaceKey || null });
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

  // A newer file with the same name on the page makes Confluence refuse the restore (409); the
  // file then comes back as "<name> (restored).<ext>" and the caller is told (tester 2026-09-30).
  const originalTitle = probeData.title || sealRecord?.attachmentName || "Unknown";
  const put = await putAttachmentCurrent(pageId, attachmentId, originalTitle, currentVersion);
  if (!put.ok) {
    console.error(`[RESTORE] Failed ${attachmentId}: ${put.status} — ${put.text || ""}`);
    return { success: false, reason: put.status === 409 ? "Could not restore: a file with this name is already on the page and no free name was found." : `Restore failed: ${put.status}` };
  }
  if (put.renamed) console.warn(`[RESTORE] ${attachmentId} restored as "${put.title}" — a newer "${originalTitle}" is on the page`);

  // Clean up tracking-only records (not real seals) after restore
  if (sealRecord?.trashedOnly) {
    await kvs.delete(`protection-${attachmentId}`);
    // Review F2: the seal is gone for good — requests and grants against it would otherwise
    // outlive it as ghost rows on "My work" that Approve can no longer act on.
    await sweepEditAccess(attachmentId).catch((e) => console.warn("[RESTORE] edit-access sweep failed:", e));
  }

  await touchSealTimestamp();
  console.warn(`[RESTORE] Restored attachment ${attachmentId}`);
  return put.renamed
    ? { success: true, renamedTo: put.title, notice: `Restored as "${put.title}" — a newer file named "${originalTitle}" is already on the page.` }
    : { success: true };
};

/**
 * Purge an attachment permanently and clean up all seal state.
 * This is a destructive action — the attachment cannot be recovered.
 */
export const purgeSealRecord = async (req) => {
  const { attachmentId } = req.payload;
  const operatorAccountId = req.context.accountId;

  if (!attachmentId) {
    return { success: false, reason: "Missing attachmentId" };
  }

  // Check admin toggle
  const globalPolicy = await kvs.get("admin-settings-global");
  if (globalPolicy?.allowSealPurge !== true) {
    return { success: false, reason: "Purge is disabled by admin" };
  }

  const sealRecord = await kvs.get(`protection-${attachmentId}`);

  // Where the file LIVES, read before anything is decided (a read-only asApp GET). The trashed
  // attachment's v2 body names its page; the seal record names the page it was sealed on.
  let probeData = null;
  try {
    const probeRes = await asApp().requestConfluence(route`/wiki/api/v2/attachments/${attachmentId}`);
    if (probeRes.ok) probeData = await probeRes.json();
  } catch (err) {
    console.warn(`[PURGE] probe of ${attachmentId} failed:`, err);
  }
  // The attachment's own container first: a trashedOnly record's contentId can be a display hint
  // written from the deleter's context when the attachment read failed (panels deleteArtifact).
  const objectPageId = probeData?.pageId || probeData?.blogPostId || sealRecord?.contentId || null;

  // audit C2: the owner/steward gate now covers the NO-SEAL path too. Purge is a PERMANENT,
  // unrecoverable delete (`?purge=true` below). Previously this block was wrapped in
  // `if (sealRecord && sealRecord.lockedBy)`, so when no seal record existed the ONLY gate was the
  // global allowSealPurge toggle → ANY user could permanently purge ANY attachment by id (it46).
  // Require owner-or-steward UNCONDITIONALLY.
  //
  // SV-SEC-1 follow-on: the precedence here was inverted. It read the CALLER's context space
  // first and fell back to the seal's, which is the confused deputy again — a steward of any one
  // space could purge a seal belonging to another. The object's own space is authoritative.
  // The caller's context then survived as the FALLBACK for records without a spaceKey — and the
  // panel's delete writes exactly such records (trashedOnly, contentId only) — so a steward of any
  // space could still purge every one of them. The fallback is now the OBJECT's page's space
  // (record.contentId, else the attachment's own container); the caller's context is never read.
  const effectiveRealmKey = sealRecord?.spaceKey || (objectPageId ? await resolvePageSpaceKey(objectPageId) : null);
  const isOwner = !!sealRecord?.lockedBy && sealRecord.lockedBy === operatorAccountId;
  if (!isOwner) {
    if (effectiveRealmKey) {
      // The space the file's page is in now and, if it moved since it was sealed, the seal's own.
      if (!(await isStewardOfRecord(authorizeSteward, operatorAccountId, { contentId: objectPageId, storedKey: sealRecord?.spaceKey || null }))) {
        return { success: false, reason: "Only the seal owner or a space admin can purge" };
      }
    } else if (!objectPageId || !(await canEditPage(operatorAccountId, objectPageId))) {
      // No space resolves for the object, so no steward check can be about it. Purge is permanent
      // and unrecoverable: require rights on the PAGE the file lives on. (This used to ask about
      // the attachment id itself, and a permission check on a TRASHED attachment denies everyone.)
      return { success: false, reason: "You do not have permission to purge this file" };
    }
  }

  // Permanently delete the attachment from Confluence (if it still exists)
  try {
    // First check if attachment is trashed — must trash before purging
    if (probeData) {
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
    // A1: the file and its seal are gone for good (A1 review F6).
    await recordActivity({
      type: "seal.deleted",
      pageId: sealRecord.contentId || null,
      spaceKey: effectiveRealmKey || null,
      actor: { accountId: req.context?.accountId || null, name: null },
      target: { kind: "attachment", id: attachmentId, name: sealRecord.attachmentName || null },
      details: { via: "purge", ownerAccountId: sealRecord.lockedBy || null },
      version: null,
    });
  }

  // The file is gone for good; a "notify me when it is unsealed" watch has nothing left
  // to wait for.
  await sweepWatchers(attachmentId);

  // Clear any Edit Requests / grants tied to this seal
  await sweepEditAccess(attachmentId);

  console.warn(`[PURGE] Permanently removed ${sealRecord?.attachmentName || attachmentId}`);
  return { success: true };
};


/**
 * Bug 2.4 — the ONE question the page ribbon asks: "is there anything on this page worth a
 * banner row?" Counts sealed attachments and sealed sections for the page and, crucially,
 * says WHY a count is zero (`reason`), so a production "the ribbon never shows" case is
 * settled from the Forge log instead of re-diagnosed.
 *
 * Why not enumerate-doc-artifacts: that one takes the id from context only (silently [] on a
 * blogpost or a missing context id), fetches as the USER (a 403 reads as "no attachments"),
 * pages 10 at a time and never counts section seals. This reads as asApp() so the count is
 * the page's truth, not the caller's view of it — and the caller is only allowed to ask about
 * a page they can READ: the context id is authentic (SV-SEC-1: rendering inside it implies
 * read), a payload id is entitlement-checked before anything is fetched.
 */
const RIBBON_ATTACHMENT_PAGE_CAP = 20; // 20 × 250 = 5 000 attachments; past that we stop counting
const ribbonSummary = async (req) => {
  const contextId = req.context?.extension?.content?.id ?? null;
  const contentType = req.context?.extension?.content?.type ?? null;
  const accountId = req.context?.accountId ?? null;
  const payloadId = req.payload?.pageId != null && req.payload.pageId !== "" ? String(req.payload.pageId) : null;
  const out = {
    ok: false, pageId: null, contentIdSeen: contextId != null, contentType,
    attachments: 0, sealedAttachments: 0, sealedByMe: false, sectionSeals: 0, trashedSeals: 0, reason: "none",
  };
  const empty = (reason, detail) => {
    console.warn(`[RIBBON] summary empty — ${reason}: page=${out.pageId} ctx=${contextId} type=${contentType} ${detail || ""}`.trim());
    return { ...out, reason };
  };

  let pageId = contextId != null ? String(contextId) : null;
  if (!pageId && payloadId) {
    if (mustVerify(payloadId, contextId) && !(await canReadPage(accountId, payloadId))) {
      return empty("payload-page-unreadable");
    }
    pageId = payloadId;
  }
  out.pageId = pageId;
  if (!pageId) return empty("no-context-id");
  // The byline's workflow status, read alongside the attachments (lazy byline refresh, below).
  const workflowRead = describeWorkflowForPage(pageId).catch((e) => { console.warn("[RIBBON] workflow for the byline:", e?.message || e); return undefined; });

  // Attachments as the app: the count is the page's, not the caller's (a viewer whose user
  // token gets a 403 on attachments still sees the seal exists). v2 has one collection per
  // content type; a blogpost id on the /pages route is a 404, so pick by type and fall back.
  const ids = [];
  const collection = contentType === "blogpost" ? "blogposts" : "pages";
  const fetchAll = async (coll) => {
    let cursor = null;
    for (let i = 0; i < RIBBON_ATTACHMENT_PAGE_CAP; i++) {
      const url = coll === "blogposts"
        ? (cursor ? route`/wiki/api/v2/blogposts/${pageId}/attachments?limit=250&cursor=${cursor}` : route`/wiki/api/v2/blogposts/${pageId}/attachments?limit=250`)
        : (cursor ? route`/wiki/api/v2/pages/${pageId}/attachments?limit=250&cursor=${cursor}` : route`/wiki/api/v2/pages/${pageId}/attachments?limit=250`);
      const res = await asApp().requestConfluence(url);
      if (!res.ok) return res.status;
      const data = await res.json();
      for (const att of data?.results || []) if (att?.id) ids.push(String(att.id));
      const next = data?._links?.next;
      if (!next) return 200;
      try { cursor = new URL(next, "https://example.com").searchParams.get("cursor"); } catch (_) { cursor = null; }
      if (!cursor) return 200;
    }
    console.warn(`[RIBBON] attachments for ${pageId} hit the ${RIBBON_ATTACHMENT_PAGE_CAP}-page cap`);
    return 200;
  };
  let status;
  try {
    status = await fetchAll(collection);
    if (status === 404 && collection === "pages" && !contentType) status = await fetchAll("blogposts");
  } catch (e) {
    console.error("[RIBBON] attachments fetch threw:", e);
    status = 0;
  }
  // Classification review 2026-09-30 (B): a failed attachments read used to return HERE, before the
  // classification was read — the level vanished and the row became an error. The seal counts are
  // unknown in that case (the answer still says so: ok:false + reason), but the level, the viewer's
  // requests and the section seals are read regardless.
  const attachmentsOk = status === 200;
  out.attachments = ids.length;

  // A protection-* record is a seal unless it is the S7 trashedOnly TRACKING record (triggers.js).
  const liveSeals = []; // { id, record } — the page's live attachment seals, for the viewer's half below
  for (let i = 0; attachmentsOk && i < ids.length; i += 25) {
    const batch = ids.slice(i, i + 25);
    const records = await Promise.all(batch.map((id) => kvs.get(`protection-${id}`).catch(() => null)));
    records.forEach((r, j) => {
      if (!r) return;
      if (r.trashedOnly) { out.trashedSeals += 1; return; }
      out.sealedAttachments += 1;
      if (accountId && r.lockedBy === accountId) out.sealedByMe = true;
      liveSeals.push({ id: batch[j], record: r });
    });
  }
  // A sealed file sitting in the trash is still something to show: the overlay's Trash card is
  // where its owner restores it, and the ribbon is the only door to that overlay. The default
  // listing excludes trashed attachments, so ask for them explicitly (best effort).
  if (attachmentsOk) try {
    const trashed = await asApp().requestConfluence(route`/wiki/api/v2/${collection}/${pageId}/attachments?status=trashed&limit=250`);
    if (trashed.ok) {
      const tdata = await trashed.json();
      const tids = (tdata?.results || []).map((a) => String(a?.id || "")).filter((id) => id && !ids.includes(id));
      const trecords = await Promise.all(tids.map((id) => kvs.get(`protection-${id}`).catch(() => null)));
      for (const r of trecords) if (r) out.trashedSeals += 1;
    }
  } catch (e) { console.warn("[RIBBON] trashed-attachment probe failed:", e?.message || e); }

  let sectionRecords = [];
  try {
    sectionRecords = (await listSectionSealRecordsForPage(pageId)).filter((s) => s?.lockedBy);
    out.sectionSeals = sectionRecords.length;
  } catch (e) {
    console.error(`[RIBBON] section-seal listing threw for ${pageId}:`, e);
  }

  // ── 5.0 (mockup §2/§3): what the ROW shows. Every read below is bounded by this page's own
  // seals or by the viewer's own index prefix — never a site-wide scan. Each block is best effort
  // and logged: a failure degrades that block to "nothing", it never turns the summary into an
  // error row (the seal counts above are the truth the ribbon closes on).
  Object.assign(out, await ribbonViewerHalf({ pageId, accountId, liveSeals, sectionRecords }));

  // Lazy byline refresh (E1): this runs on EVERY page view, so the chip converges on the first view
  // after anything changed what it should say (a space default, the site switch, a space opt-out)
  // — the same stamp-checked write the details modal does, so an unchanged chip costs one KVS read.
  // Only with a known seal count; bounded so the banner never waits long on the property write.
  if (attachmentsOk) {
    const write = (async () => {
      const wf = await workflowRead;
      if (wf === undefined) return null; // the workflow read failed: do not write a chip without it
      const c = out.classification || {};
      return writeBylineFor(pageId, {
        level: c.level || null, source: c.source || "none", classificationEnabled: c.enabled === true,
        sealCount: liveSeals.filter(({ record }) => record?.lockedBy).length + sectionRecords.length,
        workflow: wf?.status || null,
      }, { lazy: true });
    })().catch((e) => console.warn("[RIBBON] byline refresh failed:", e?.message || e));
    await Promise.race([write, new Promise((r) => setTimeout(r, 1500))]);
  }
  if (!attachmentsOk) return empty(`attachments-http-${status}`);

  out.ok = true;
  if (out.sealedAttachments === 0 && out.sectionSeals === 0 && out.trashedSeals === 0) {
    console.info(`[RIBBON] nothing sealed on ${pageId}: attachments=${out.attachments} (type=${contentType})`);
    return { ...out, reason: "none" };
  }
  return { ...out, reason: "sealed" };
};

const isLapsed = (iso) => !!(iso && new Date(iso).getTime() <= Date.now());

/**
 * The classification, the viewer's waiting-on-me numbers scoped to
 * this page, and `lockedFor`: the FIRST live seal on the page the viewer does not own (journey 2:
 * "Locked by {owner} until {time} · Request edit"), with the viewer's own request status on it.
 * `waitingOnMe.grantsActive` lists the viewer's active edit grants on this page's seals.
 */
async function ribbonViewerHalf({ pageId, accountId, liveSeals, sectionRecords }) {
  const half = {
    classification: { level: null, source: "none", enabled: false },
    waitingOnMe: { requests: 0, approvals: 0, grantsActive: [] },
    lockedFor: null,
  };
  const settle = (label, p, fallback) => p.catch((e) => { console.warn(`[RIBBON] ${label} failed:`, e?.message || e); return fallback; });

  // CLS-1: the switch is read FIRST; off = the level is never read and the ribbon is told so
  // (`classification.enabled:false` → only seal / workflow / validation states open the row, and
  // the surface draws the brand block instead of a level). On = the row shows on every view.
  const sw = await settle("classification switch", classificationActiveForPage(pageId), { active: false, reason: "site" });
  const cls = sw.active
    ? await settle("classification", (async () => { const { provider } = await getClassificationProvider(); return provider.effectiveLevel(pageId); })(), null)
    : null;
  half.classification = { level: null, source: "none", enabled: sw.active };
  if (cls?.level) {
    const l = cls.level;
    half.classification = { level: { id: String(l.id), name: l.name, color: l.color || null, rank: Number(l.rank) || 0, description: typeof l.description === "string" ? l.description.slice(0, 160) : "" }, source: cls.source || "page", enabled: true };
  }
  if (!accountId) return half;

  // Waiting on ME, on THIS page: the same owner/approver index reads count-my-work uses, filtered
  // to this page (every record carries the page id it belongs to).
  const same = (id) => String(id || "") === String(pageId);
  const [fileReqs, sectionReqs, approvals] = await Promise.all([
    settle("file requests", listPendingRequestsForOwner(accountId), []),
    settle("section requests", listPendingSectionRequestsForOwner(accountId), []),
    settle("approvals", listMyApprovals(accountId), []),
  ]);
  half.waitingOnMe.requests = fileReqs.filter((r) => same(r.pageId)).length + sectionReqs.filter((r) => same(r.pageId)).length;
  half.waitingOnMe.approvals = approvals.filter((r) => same(r.pageId)).length;

  // The seals the viewer does NOT own on this page: grants (Edit now) and the first locked one.
  const foreign = [
    ...liveSeals.filter(({ record }) => record.lockedBy && record.lockedBy !== accountId && !isLapsed(record.expiresAt))
      .map(({ id, record }) => ({ kind: "attachment", id, name: record.attachmentName || "an attachment", owner: record.lockedByName || "its owner", until: record.expiresAt || null, held: isWorkflowHeld(record) })),
    ...sectionRecords.filter((s) => s.lockedBy !== accountId && !isLapsed(s.expiresAt))
      .map((s) => ({ kind: "section", id: s.sectionId, name: s.sectionTitle || "Sealed section", owner: s.lockedByName || "its owner", until: s.expiresAt || null, held: isWorkflowHeld(s) })),
  ];
  if (!foreign.length) return half;
  const probes = await Promise.all(foreign.map(async (seal) => {
    const grant = await settle(`grant ${seal.id}`, seal.kind === "attachment" ? getActiveEditGrant(seal.id, accountId) : getActiveSectionEditGrant(seal.id, accountId), null);
    if (grant) return { seal, grant };
    const req = await settle(`request ${seal.id}`, kvs.get(seal.kind === "attachment" ? `edit-request-${seal.id}-${accountId}` : `section-edit-request-${seal.id}-${accountId}`), null);
    // SEC-8: a declined request inside its cooldown is a state the ribbon shows ("Declined · ask
    // again W"), with the owner's reason when one was given.
    if (req?.status === "denied") {
      const retryAt = retryAtFor(req.deniedAt, await resolveEditCooldownMs().catch(() => 0));
      if (retryAt) return { seal, grant: null, myRequest: "denied", retryAt, deniedReason: req.deniedReason || null };
    }
    return { seal, grant: null, myRequest: req?.status === "pending" ? "pending" : "none" };
  }));
  half.waitingOnMe.grantsActive = probes.filter((p) => p.grant).map(({ seal, grant }) => ({ name: seal.name, kind: seal.kind, id: seal.id, until: grant.expiresAt || seal.until || null }));
  // "Locked" is the state of a seal the viewer can neither edit nor has been granted; a seal with
  // a pending request from the viewer comes first ("Waiting for {owner}" is the more specific state).
  const locked = probes.filter((p) => !p.grant);
  const pick = locked.find((p) => p.myRequest === "pending") || locked.find((p) => p.myRequest === "denied") || locked[0] || null;
  if (pick) half.lockedFor = { ...pick.seal, myRequest: pick.myRequest, retryAt: pick.retryAt || null, deniedReason: pick.deniedReason || null };
  return half;
}

export const actions = [
  ["ribbon-summary", ribbonSummary],
  ["seal-artifact", sealArtifact],
  ["unseal-artifact", unsealArtifact],
  ["extend-seal", extendSeal],
  ["enumerate-doc-artifacts", enumerateDocArtifacts],
  ["enumerate-operator-seals", enumerateOperatorSeals],
  ["enumerate-page-seals", enumeratePageSeals],
  ["check-seal-stamp", checkSealStamp],
  ["restore-sealed-artifact", restoreSealedArtifact],
  ["purge-seal-record", purgeSealRecord],
];
