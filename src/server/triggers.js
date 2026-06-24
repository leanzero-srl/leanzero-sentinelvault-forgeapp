import { asApp, route } from "@forge/api";
import { kvs, WhereConditions } from "@forge/kvs";

import {
  mailHalfwayReminder,
  mailExpiryNotice,
} from "./infra/notice-composer.js";

import { recordDispatch, postDocFootnote } from "./capsules/bulletins/logic.js";
import { resolveBulletinToggles } from "./shared/bulletin-flags.js";
import { touchSealTimestamp, removeSealContentProp } from "./capsules/sealing/logic.js";
import { getActiveEditGrant, sweepEditAccess, getActiveSectionEditGrant } from "./capsules/editreq/logic.js";
import {
  resolveEffectiveConfig,
  writeValidationState,
  getLastGoodVersion,
  setLastGoodVersion,
  wasVersionChecked,
  markVersionChecked,
} from "./capsules/validations/logic.js";
import { evaluateRules } from "./infra/rules-engine.js";
import { postValidationComment } from "./infra/validation-blueprints.js";
import { readDocBody, readDocBodyAtVersion, writeDocBody, collectMediaFileIds, extractMediaSingleNodes, spliceMediaNodes, locateBodiedSectionNodes, replaceSectionBody, spliceSectionWrapper, hashAdf } from "./infra/doc-surgery.js";

// --- Helpers ---

/**
 * Resolve the app's own Atlassian account ID (cached in KVS).
 * Used to prevent infinite loops when the app edits/restores artifacts.
 */
async function resolveAppAccountId() {
  let systemAccountId = await kvs.get("app-account-id");
  if (!systemAccountId) {
    try {
      const myselfResponse = await asApp().requestConfluence(
        route`/wiki/rest/api/user/current`,
      );
      if (myselfResponse.ok) {
        const myself = await myselfResponse.json();
        systemAccountId = myself.accountId;
        await kvs.set("app-account-id", systemAccountId);
      }
    } catch (e) {
      console.error("Error fetching App Account ID:", e);
    }
  }
  return systemAccountId;
}

// --- Artifact Event Trigger (Forge Trigger) ---
export async function artifactEventTrigger(event) {
  try {
    const { eventType, atlassianId, attachment } = event;

    if (!attachment || !attachment.id) {
      console.error("Invalid artifact event payload");
      return;
    }

    const artifactId = attachment.id;
    const contentId = attachment.container?.id;

    console.warn(`[TRIGGER] ${eventType} for ${artifactId} by ${atlassianId}`);

    // Prevent infinite loops - ignore actions made by our own app
    const systemAccountId = await resolveAppAccountId();
    if (systemAccountId && atlassianId === systemAccountId) {
      return;
    }

    const sealRecord = await kvs.get(`protection-${artifactId}`);

    if (!sealRecord || !sealRecord.lockedBy) {
      return;
    }

    if (eventType === "avi:confluence:updated:attachment") {
      await handleSealedArtifactEdit(sealRecord, artifactId, contentId, atlassianId, attachment);
    } else if (eventType === "avi:confluence:trashed:attachment") {
      await handleSealedArtifactTrash(sealRecord, artifactId, contentId, atlassianId, attachment);
    } else if (eventType === "avi:confluence:deleted:attachment") {
      await handleSealedArtifactDeleted(sealRecord, artifactId, contentId, atlassianId, attachment);
    }
  } catch (error) {
    console.error("Error in artifact event trigger:", error);
  }
}

// --- Page Content Trigger (Forge Trigger) ---
// Unified page-body protection pipeline. Multiple features want to inspect and
// repair the page body on the SAME avi:confluence:(updated|created):page event:
//   (A) sealed-section restore  (Content Sealing)
//   (B) sealed-media restore    (attachment embeds)
//   (C) validation enforcement  (advisory / gate / hard-revert)
//   (D) Semantic AI validation  (enqueue — manual-first, so disabled here)
// To avoid 409 storms, ordering hazards and infinite loops, the handler does a
// SINGLE read -> ordered passes mutate one in-memory ADF -> SINGLE write inside
// one shared 409-backoff loop. Every write is asApp(), so the app's own re-save
// re-fires this trigger and is short-circuited by the loop-guard below.
export async function pageContentTrigger(event) {
  try {
    const { atlassianId, content } = event;
    const pageId = content?.id;

    if (!pageId) {
      console.error("[PAGE-PROTECT] Invalid page event payload — no content.id");
      return;
    }

    // Prevent infinite loops — ignore actions made by our own app
    const systemAccountId = await resolveAppAccountId();
    if (systemAccountId && atlassianId === systemAccountId) {
      return;
    }

    const globalPolicy = await kvs.get("admin-settings-global");
    const contentProtectionOn = globalPolicy?.enableContentProtection !== false;

    // --- Gather applicable body-protection work via cheap probes (no ADF read) ---
    const sealFileMap = contentProtectionOn
      ? await collectMediaSealsForPage(pageId)
      : [];
    const sectionSeals = contentProtectionOn
      ? await collectSectionSealsForPage(pageId)
      : [];

    const hasBodyWork = sealFileMap.length > 0 || sectionSeals.length > 0;

    // --- Single read -> passes -> single write, with shared 409 backoff ---
    const MAX_RETRIES = 3;
    const notifyMap = new Map();
    let anyChange = false;

    for (let attempt = 0; hasBodyWork && attempt < MAX_RETRIES; attempt++) {
      let ctx;
      try {
        const { pageData, adfDoc } = await readDocBody(pageId);
        ctx = {
          pageId,
          atlassianId,
          pageData,
          adfDoc,
          currentVersion: pageData.version?.number,
          changed: false,
          notifications: [],
        };
      } catch (err) {
        console.error("[PAGE-PROTECT] Failed to read page body:", err);
        break;
      }

      // Pass A: sealed-section restore
      if (sectionSeals.length > 0) {
        try { await restoreSealedSectionsPass(ctx, sectionSeals); }
        catch (e) { console.error("[PAGE-PROTECT] section pass error:", e); }
      }
      // Pass B: sealed-media restore
      if (sealFileMap.length > 0) {
        try { await restoreMediaPass(ctx, sealFileMap); }
        catch (e) { console.error("[PAGE-PROTECT] media pass error:", e); }
      }
      // Pass C (Phase 4): validation enforcement — slots in here.

      // Accumulate notifications (dedup across retries by type + target).
      for (const n of ctx.notifications) {
        notifyMap.set(`${n.type}:${n.targetId || ""}`, n);
      }

      if (!ctx.changed) {
        break; // nothing to write this attempt
      }

      const putRes = await writeDocBody(
        ctx.pageId,
        ctx.pageData,
        ctx.adfDoc,
        "(Sentinel Vault restored protected content)",
      );

      if (putRes.ok) {
        anyChange = true;
        break;
      }
      if (putRes.status === 409) {
        const delay = Math.pow(2, attempt) * 500;
        console.warn(`[PAGE-PROTECT] Version conflict, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      const errorText = await putRes.text();
      console.error(`[PAGE-PROTECT] Failed to patch page: ${putRes.status} — ${errorText}`);
      break;
    }

    // Dispatch notifications once (post-loop), regardless of write success.
    for (const n of notifyMap.values()) {
      try { await dispatchPipelineNotification(n); }
      catch (e) { console.error("[PAGE-PROTECT] notify error:", e); }
    }

    if (anyChange) {
      await touchSealTimestamp();
    }

    // --- Conditions & Validations phase (independent of seals) ---
    try {
      await runValidationPhase(event, pageId, atlassianId);
    } catch (e) {
      console.error("[VALIDATE] phase error:", e);
    }
  } catch (error) {
    console.error("[PAGE-PROTECT] Error in page content trigger:", error);
  }
}

// --- Pipeline: gather media seals applicable to a page (cheap, no ADF read) ---
async function collectMediaSealsForPage(pageId) {
  // Fast path: does this page carry any seal content properties?
  const propsResponse = await asApp().requestConfluence(
    route`/wiki/api/v2/pages/${pageId}/properties?key=protection-`,
  );
  if (!propsResponse.ok) return [];
  const propsData = await propsResponse.json();
  if (!propsData.results || propsData.results.length === 0) return [];

  const { results: allSeals } = await kvs
    .query()
    .where("key", WhereConditions.beginsWith("protection-"))
    .limit(100)
    .getMany();

  const pageSeals = allSeals.filter(
    ({ value }) => value?.contentId === pageId && value?.lockedBy,
  );
  if (pageSeals.length === 0) return [];

  const sealFileMap = []; // { seal, fileId }
  for (const { value: seal } of pageSeals) {
    let fileId = seal.sealedFileId || null;
    if (!fileId && seal.attachmentId) {
      try {
        const attRes = await asApp().requestConfluence(
          route`/wiki/api/v2/attachments/${seal.attachmentId}`,
        );
        if (attRes.ok) {
          const attData = await attRes.json();
          fileId = attData.fileId || null;
        }
      } catch (_) { /* best effort */ }
    }
    if (fileId) sealFileMap.push({ seal, fileId });
  }
  return sealFileMap;
}

// --- Pipeline pass: re-insert removed sealed media blocks ---
async function restoreMediaPass(ctx, sealFileMap) {
  const presentFileIds = collectMediaFileIds(ctx.adfDoc);
  const violations = sealFileMap.filter(
    ({ seal, fileId }) =>
      !presentFileIds.has(fileId) && seal.lockedBy !== ctx.atlassianId,
  );
  if (violations.length === 0) return;

  if (!ctx.currentVersion || ctx.currentVersion < 2) {
    console.warn("[PAGE-PROTECT] Cannot revert media — page has no previous version");
    return;
  }

  const violatedFileIds = new Set(violations.map(({ fileId }) => fileId));
  const prevVersion = ctx.currentVersion - 1;
  const { adfDoc: previousAdf } = await readDocBodyAtVersion(ctx.pageId, prevVersion);
  const restoredEntries = extractMediaSingleNodes(previousAdf, violatedFileIds);
  if (restoredEntries.length === 0) {
    console.warn("[PAGE-PROTECT] Could not find sealed media in previous version — skipping");
    return;
  }

  spliceMediaNodes(ctx.adfDoc, restoredEntries);
  ctx.changed = true;
  console.warn(
    `[PAGE-PROTECT] Re-inserted ${restoredEntries.length} sealed media block(s) into page ${ctx.pageId}`,
  );
  for (const { seal } of violations) {
    ctx.notifications.push({
      type: "content-removal",
      targetId: seal.attachmentId,
      seal,
      actor: ctx.atlassianId,
      pageId: ctx.pageId,
      artifactName: seal.attachmentName || "Unknown Attachment",
    });
  }
}

// --- Pipeline: dispatch a single accumulated notification ---
async function dispatchPipelineNotification(n) {
  if (n.type === "content-removal") {
    await sendViolationNotifications(
      n.seal, n.seal.attachmentId, n.pageId, n.actor, n.artifactName, "content-removal",
    );
  } else if (n.type === "section-revert") {
    await sendSectionViolationNotifications(n.seal, n.pageId, n.actor, n.kind);
  }
}

// --- Pipeline: gather section seals applicable to a page (cheap, no ADF read) ---
async function collectSectionSealsForPage(pageId) {
  // Fast path: does this page carry any section-seal content properties?
  const propsResponse = await asApp().requestConfluence(
    route`/wiki/api/v2/pages/${pageId}/properties?key=section-protection-`,
  );
  if (!propsResponse.ok) return [];
  const propsData = await propsResponse.json();
  if (!propsData.results || propsData.results.length === 0) return [];

  // section-protection-{sectionId} primary records (excludes section-snapshot-*
  // and space-section-protection-* by prefix).
  const { results } = await kvs
    .query()
    .where("key", WhereConditions.beginsWith("section-protection-"))
    .limit(100)
    .getMany();

  return results
    .map(({ value }) => value)
    .filter((v) => v?.pageId === pageId && v?.lockedBy && v?.sectionId);
}

// --- Pipeline pass: restore tampered / removed sealed sections ---
async function restoreSealedSectionsPass(ctx, sectionSeals) {
  const now = Date.now();
  const wrappers = new Map();
  for (const w of locateBodiedSectionNodes(ctx.adfDoc)) {
    if (w.sectionId) wrappers.set(w.sectionId, w);
  }

  for (const seal of sectionSeals) {
    // Owner edits their own sealed section freely.
    if (seal.lockedBy === ctx.atlassianId) continue;
    // Expired seals are inert (full auto-unseal handled by the expiry sweep).
    if (seal.expiresAt && new Date(seal.expiresAt).getTime() <= now) continue;

    const wrapper = wrappers.get(seal.sectionId);
    const snapshot = await kvs.get(`section-snapshot-${seal.sectionId}`);

    if (!wrapper) {
      // The entire sealed-section macro was deleted/cut — re-insert it.
      let entry = null;
      if (snapshot?.wrapperNode) {
        entry = {
          node: snapshot.wrapperNode,
          originalIndex: typeof snapshot.originalIndex === "number"
            ? snapshot.originalIndex
            : ctx.adfDoc.content?.length || 0,
        };
      } else if (ctx.currentVersion && ctx.currentVersion >= 2) {
        // Fallback: pull the wrapper from the previous page version.
        try {
          const { adfDoc: prev } = await readDocBodyAtVersion(ctx.pageId, ctx.currentVersion - 1);
          const prevWrap = locateBodiedSectionNodes(prev).find((w) => w.sectionId === seal.sectionId);
          if (prevWrap) entry = { node: prevWrap.node, originalIndex: prevWrap.originalIndex };
        } catch (_) { /* best effort */ }
      }
      if (!entry) {
        console.warn(`[SECTION] Cannot restore removed section ${seal.sectionId} — no snapshot or prior version`);
        continue;
      }
      spliceSectionWrapper(ctx.adfDoc, [entry]);
      ctx.changed = true;
      ctx.notifications.push({
        type: "section-revert", targetId: seal.sectionId,
        seal, actor: ctx.atlassianId, pageId: ctx.pageId, kind: "removed",
      });
      continue;
    }

    // Wrapper present — compare the canonical hash of its body to the sealed hash.
    const liveHash = hashAdf(wrapper.node.content);
    if (seal.contentHash && liveHash === seal.contentHash) continue; // untouched

    // Approved section editor (Edit Requests) — allow the edit and re-baseline so
    // future reverts compare against the edited content.
    const sectionGrant = await getActiveSectionEditGrant(seal.sectionId, ctx.atlassianId);
    if (sectionGrant) {
      try {
        const newBody = JSON.parse(JSON.stringify(wrapper.node.content || []));
        const newHash = hashAdf(newBody);
        await kvs.set(`section-protection-${seal.sectionId}`, { ...seal, contentHash: newHash });
        await kvs.set(`section-snapshot-${seal.sectionId}`, {
          wrapperNode: JSON.parse(JSON.stringify(wrapper.node)),
          bodyContent: newBody, hash: newHash, version: null, originalIndex: wrapper.originalIndex,
        });
        console.warn(`[SECTION] Allowed approved edit of section ${seal.sectionId} by ${ctx.atlassianId} — re-baselined`);
      } catch (e) { console.error("[SECTION] re-baseline failed:", e); }
      continue;
    }

    // Body was edited — restore the sealed body from the snapshot.
    if (snapshot?.bodyContent) {
      const ok = replaceSectionBody(ctx.adfDoc, seal.sectionId, snapshot.bodyContent);
      if (ok) {
        ctx.changed = true;
        ctx.notifications.push({
          type: "section-revert", targetId: seal.sectionId,
          seal, actor: ctx.atlassianId, pageId: ctx.pageId, kind: "body-edited",
        });
      }
    } else {
      console.warn(`[SECTION] Section ${seal.sectionId} body changed but no snapshot to restore from`);
    }
  }
}

// --- Conditions & Validations phase (runs after the body-protection pipeline) ---
async function runValidationPhase(event, pageId, atlassianId) {
  const spaceKey =
    event?.space?.key || event?.content?.space?.key || event?.content?.spaceKey || null;

  const config = await resolveEffectiveConfig(spaceKey);
  if (!config.enabled || !(config.rules || []).length) return;

  const { pageData, adfDoc } = await readDocBody(pageId);

  // Only enforce on published pages.
  if (pageData.status && pageData.status !== "current") return;

  const version = pageData.version?.number;
  if (await wasVersionChecked(pageId, version)) return;

  // Fetch page labels (required-label rule).
  let labels = [];
  try {
    const res = await asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}/labels`);
    if (res.ok) { const b = await res.json(); labels = (b.results || []).map((l) => l.name); }
  } catch (_) { /* best effort */ }

  const { passed, violations } = evaluateRules(adfDoc, labels, config.rules);
  const modes = config.modes || { advisory: true, gate: false, revert: false };
  const base = pageData._links?.base;
  const historyUrl = base ? `${base}/pages/viewpreviousversions.action?pageId=${pageId}` : "";

  if (passed) {
    await setLastGoodVersion(pageId, version);
    if (modes.gate) {
      await writeValidationState(pageId, { state: "passed", violations: [], version, checkedAt: new Date().toISOString() });
    }
    await markVersionChecked(pageId, version);
    return;
  }

  // Failed.
  if (modes.advisory) {
    try { await postValidationComment({ pageId, editorAccountId: atlassianId, violations, reverted: false }); }
    catch (e) { console.error("[VALIDATE] advisory comment failed:", e); }
  }
  if (modes.gate) {
    await writeValidationState(pageId, { state: "failed", violations, version, checkedAt: new Date().toISOString() });
  }
  if (modes.revert) {
    const lastGood = await getLastGoodVersion(pageId);
    if (lastGood && version && lastGood < version) {
      let reverted = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const current = await readDocBody(pageId);
          const { adfDoc: goodAdf } = await readDocBodyAtVersion(pageId, lastGood);
          const putRes = await writeDocBody(pageId, current.pageData, goodAdf, "(Sentinel Vault reverted non-compliant content)");
          if (putRes.ok) { reverted = true; break; }
          if (putRes.status === 409) { await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500)); continue; }
          break;
        } catch (e) { console.error("[VALIDATE] revert error:", e); break; }
      }
      if (reverted && !modes.advisory) {
        try { await postValidationComment({ pageId, editorAccountId: atlassianId, violations, reverted: true, historyUrl }); }
        catch (_) { /* best effort */ }
      }
    } else if (!modes.advisory) {
      // No compliant version to revert to (e.g. v1) — fall back to flagging.
      try { await postValidationComment({ pageId, editorAccountId: atlassianId, violations, reverted: false }); }
      catch (_) { /* best effort */ }
    }
  }

  await markVersionChecked(pageId, version);
}

// --- Notify the section-seal owner of an unauthorized section change ---
async function sendSectionViolationNotifications(seal, pageId, actor, kind) {
  const title = seal.sectionTitle || "a sealed section";
  const verb = kind === "removed" ? "content-removal" : "edit";
  await recordDispatch({
    id: `notification-${Date.now()}`,
    type: kind === "removed" ? "section-restored" : "section-reverted",
    sectionId: seal.sectionId,
    attachmentName: title,
    ownerAccountId: seal.lockedBy,
    editorAccountId: actor,
    timestamp: Date.now(),
    pageId,
  });
  try {
    await postDocFootnote(pageId, seal.lockedBy, actor, title, verb);
  } catch (e) {
    console.error("[SECTION] Failed to post section violation comment:", e);
  }
}

// --- Handle unauthorized edit of a sealed artifact ---
async function handleSealedArtifactEdit(sealRecord, artifactId, contentId, atlassianId, attachment) {
  const currentVersion = attachment.version?.number;

  // Allow the seal owner to edit their own sealed artifact
  if (sealRecord.lockedBy === atlassianId) {
    return;
  }

  // Allow approved editors (Edit Requests) to edit without reverting. Re-baseline
  // the seal to the new version + fileId so future reverts target the edited
  // content, and pageContentTrigger's media-presence check keeps matching.
  const grant = await getActiveEditGrant(artifactId, atlassianId);
  if (grant) {
    try {
      let newFileId = sealRecord.sealedFileId || null;
      const attRes = await asApp().requestConfluence(
        route`/wiki/api/v2/attachments/${artifactId}`,
      );
      if (attRes.ok) {
        const attData = await attRes.json();
        newFileId = attData.fileId || newFileId;
      }
      await kvs.set(`protection-${artifactId}`, {
        ...sealRecord,
        sealedVersion: currentVersion || sealRecord.sealedVersion,
        sealedFileId: newFileId,
      });
      await touchSealTimestamp();
      console.warn(
        `[EDIT-GRANT] Allowed approved edit of ${artifactId} by ${atlassianId} — re-baselined seal to v${currentVersion}`,
      );
    } catch (e) {
      console.error("[EDIT-GRANT] Failed to re-baseline seal after approved edit:", e);
    }
    return;
  }

  // Determine target version: prefer the exact version captured at seal time,
  // fall back to currentVersion - 1 for seals created before sealedVersion was tracked.
  const targetVersion = sealRecord.sealedVersion || (currentVersion ? currentVersion - 1 : null);

  if (!targetVersion || targetVersion < 1) {
    console.warn(
      `Cannot revert artifact ${artifactId} - no valid target version (sealedVersion=${sealRecord.sealedVersion}, current=${currentVersion})`,
    );
    return;
  }

  // If the current version already matches the sealed version, no revert needed
  if (currentVersion === targetVersion) {
    return;
  }

  // Get artifact details to obtain the filename for re-upload
  const artifactRoute = route`/wiki/api/v2/attachments/${artifactId}`;
  const artifactResponse = await asApp().requestConfluence(artifactRoute);

  if (!artifactResponse.ok) {
    console.error(
      `Failed to get artifact details: ${artifactResponse.status}`,
    );
    return;
  }

  const artifactDetails = await artifactResponse.json();

  // Download the sealed version
  const downloadRoute = route`/wiki/rest/api/content/${contentId}/child/attachment/${artifactId}/download?version=${targetVersion}`;
  const downloadResponse = await asApp().requestConfluence(downloadRoute);

  if (!downloadResponse.ok) {
    console.error(
      `Failed to download previous version: ${downloadResponse.status}`,
    );
    return;
  }

  // Re-upload the previous version
  const fileBuffer = await downloadResponse.arrayBuffer();
  const formData = new FormData();
  formData.append("file", new Blob([fileBuffer]), artifactDetails.title);
  formData.append(
    "comment",
    "(Sentinel Vault automatically reversed modifications)",
  );
  formData.append("minorEdit", "true");

  const updateRoute = route`/wiki/rest/api/content/${contentId}/child/attachment/${artifactId}/data`;
  const updateResponse = await asApp().requestConfluence(updateRoute, {
    method: "POST",
    headers: { "X-Atlassian-Token": "nocheck" },
    body: formData,
  });

  if (!updateResponse.ok) {
    console.error(`Failed to revert artifact: ${updateResponse.status}`);
    return;
  }

  console.warn(`[EDIT-REVERT] Reverted ${artifactDetails.title} to v${targetVersion}`);

  // Send seal violation email to the seal owner
  const artifactName = artifactDetails.title || attachment.fileName;
  await sendViolationNotifications(sealRecord, artifactId, contentId, atlassianId, artifactName, "edit");
}

// --- Handle trashing of a sealed artifact — restore from trash ---
async function handleSealedArtifactTrash(sealRecord, artifactId, contentId, atlassianId, attachment) {
  // Allow the seal owner to trash their own sealed attachment
  if (sealRecord.lockedBy === atlassianId) {
    return;
  }
  const pageId = contentId || sealRecord.contentId;
  const currentVersion = attachment.version?.number;
  const attachmentTitle = attachment.title || sealRecord.attachmentName || "Unknown";

  if (!pageId) {
    console.error(`[TRASH-RESTORE] Cannot restore ${artifactId} — no pageId available`);
    return;
  }

  if (!currentVersion) {
    console.error(`[TRASH-RESTORE] Cannot restore ${artifactId} — no version number in event`);
    return;
  }

  console.warn(`[TRASH-RESTORE] Sealed artifact ${artifactId} trashed by ${atlassianId} — restoring`);

  // Use the v1 attachment properties endpoint with correct required fields
  const restoreRoute = route`/wiki/rest/api/content/${pageId}/child/attachment/${artifactId}`;
  const restoreResponse = await asApp().requestConfluence(restoreRoute, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: artifactId,
      type: "attachment",
      status: "current",
      title: attachmentTitle,
      version: { number: currentVersion + 1 },
    }),
  });

  if (!restoreResponse.ok) {
    const errorText = await restoreResponse.text();
    console.error(`[TRASH-RESTORE] Failed ${artifactId}: ${restoreResponse.status} — ${errorText}`);
    // Restore failed — clean up seal since attachment is unrecoverable
    console.warn(`[TRASH-RESTORE] Cleaning up seal for unrestorable attachment ${artifactId}`);
    await kvs.delete(`protection-${artifactId}`);
    if (sealRecord.spaceId) {
      await kvs.delete(`space-protection-${sealRecord.spaceId}-${artifactId}`);
    }
    if (pageId) {
      try { await removeSealContentProp(pageId); } catch (_) { /* best effort */ }
    }
    await touchSealTimestamp();
    await sendViolationNotifications(sealRecord, artifactId, pageId, atlassianId, attachmentTitle, "delete");
    return;
  }

  console.warn(`[TRASH-RESTORE] Restored ${attachmentTitle} (${artifactId})`);

  // Touch seal timestamp so frontend polling picks up the change
  await touchSealTimestamp();

  // Send violation notifications
  await sendViolationNotifications(sealRecord, artifactId, pageId, atlassianId, attachmentTitle, "delete");
}

// --- Handle permanent deletion of a sealed artifact ---
async function handleSealedArtifactDeleted(sealRecord, artifactId, contentId, atlassianId, attachment) {
  const pageId = contentId || sealRecord.contentId;
  const artifactName = attachment.title || sealRecord.attachmentName || "Unknown";

  console.warn(`[SEAL-DELETED] Sealed artifact ${artifactId} permanently deleted by ${atlassianId}`);

  // Send violation notifications before cleanup
  await sendViolationNotifications(sealRecord, artifactId, pageId, atlassianId, artifactName, "delete");

  // Clean up KVS records since attachment is gone
  await kvs.delete(`protection-${artifactId}`);
  if (sealRecord.spaceId) {
    await kvs.delete(`space-protection-${sealRecord.spaceId}-${artifactId}`);
  }

  // Remove content property
  if (pageId) {
    try { await removeSealContentProp(pageId); } catch (_) { /* best effort */ }
  }

  // Clear any Edit Requests / grants tied to this seal
  await sweepEditAccess(artifactId);

  await touchSealTimestamp();
  console.warn(`[SEAL-DELETED] Cleaned up seal records for ${artifactName} (${artifactId})`);
}

// --- Shared violation notification logic ---
async function sendViolationNotifications(sealRecord, artifactId, contentId, atlassianId, artifactName, actionVerb) {
  const bulletinToggles = await resolveBulletinToggles();

  const dispatchType = actionVerb === "delete" ? "trash-restored"
    : actionVerb === "content-removal" ? "content-reverted"
    : "edit-reverted";
  const dispatchPayload = {
    id: `notification-${Date.now()}`,
    type: dispatchType,
    attachmentId: artifactId,
    attachmentName: artifactName,
    ownerAccountId: sealRecord.lockedBy,
    editorAccountId: atlassianId,
    timestamp: Date.now(),
    pageId: contentId,
  };

  await recordDispatch(dispatchPayload);

  // Post Confluence comment with @mentions of owner and editor.
  // Confluence's notification engine emails the seal owner.
  await postDocFootnote(
    contentId,
    sealRecord.lockedBy,
    atlassianId,
    artifactName,
    actionVerb,
  );

  if (bulletinToggles?.ENABLE_TOAST_DISPATCHES) {
    const violationKey = `violation-alert-${sealRecord.lockedBy}-${artifactId}-${Date.now()}`;
    await kvs.set(violationKey, dispatchPayload, {
      expiresAt: Date.now() + 3600000,
    });
  }
}

// --- Lifecycle Trigger (Forge Trigger) ---
export async function lifecycleTrigger(event) {
  try {
    if (event.eventType === "avi:forge:uninstalled:app") {
      const { results: keys } = await kvs.query().limit(1000).getMany();
      for (const { key } of keys) {
        await kvs.delete(key);
      }
    }
  } catch (error) {
    console.error("Error cleaning up storage:", error);
  }
}

// --- Expiry Sweep Task (Scheduled Job) ---
export async function expirySweepTask() {
  try {
    // Read policy and bulletin toggles once for the entire task
    const systemPolicy = await kvs.get("admin-settings-global");
    const autoUnsealActive = systemPolicy?.autoUnlockEnabled !== false;
    const bulletinToggles = await resolveBulletinToggles(systemPolicy);

    if (!autoUnsealActive) {
      return {
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ notifiedCount: 0, fiftyPctReminders: 0 }),
      };
    }

    // Determine if halfway reminders should be sent
    const sendHalfwayAlerts =
      bulletinToggles.ENABLE_NATIVE_NOTIFICATIONS &&
      bulletinToggles.ENABLE_HALFWAY_REMINDER_NOTICE;

    const { results: activeSeals } = await kvs
      .query()
      .where("key", WhereConditions.beginsWith("protection-"))
      .limit(100)
      .getMany();

    if (!activeSeals || activeSeals.length === 0) {
      return {
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ notifiedCount: 0, fiftyPctReminders: 0 }),
      };
    }

    const now = new Date();
    let notifiedCount = 0;
    let halfwayAlertsSent = 0;

    for (const { key, value } of activeSeals) {
      try {
        const artifactId = key.replace("protection-", "");

        if (!value || !value.timestamp || !value.expiresAt) {
          continue;
        }

        const expiresAt = new Date(value.expiresAt);

        // --- Notify on expired seals ---
        if (now >= expiresAt) {
          const dedupKey = `expiry-notified-${artifactId}`;
          const alreadyNotified = await kvs.get(dedupKey);

          if (alreadyNotified) {
            continue;
          }

          // Post expiry notification comment with @mention of seal owner
          if (
            bulletinToggles.ENABLE_NATIVE_NOTIFICATIONS &&
            bulletinToggles.ENABLE_EXPIRY_NOTICE &&
            value.contentId
          ) {
            try {
              const expiryDate = now.toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              });

              const noticeResult = await mailExpiryNotice(
                value.lockedBy,
                value.attachmentName || "Unknown Attachment",
                value.contentId,
                expiryDate,
              );

              if (!noticeResult.success) {
                console.warn(
                  `Failed to post expiry notice: ${noticeResult.reason}`,
                );
              }
            } catch (noticeError) {
              console.error("Error posting expiry notice:", noticeError);
            }
          }

          // Store dedup flag so we don't re-notify
          await kvs.set(dedupKey, {
            sentAt: now.toISOString(),
            attachmentId: artifactId,
          });

          // Store dispatch event for page banner
          await recordDispatch({
            id: `notification-${Date.now()}`,
            type: "reservation-expired",
            attachmentId: artifactId,
            attachmentName: value.attachmentName || "Unknown Attachment",
            ownerAccountId: value.lockedBy,
            timestamp: Date.now(),
            pageId: value.contentId,
          });

          notifiedCount++;
          continue;
        }

        // --- Halfway expiry reminder (only for non-expired seals) ---
        if (!sendHalfwayAlerts || !value.lockedBy || !value.contentId) {
          continue;
        }

        const sealCreatedAt = new Date(value.timestamp);
        const fullPeriod = expiresAt - sealCreatedAt;
        const midpointTime = sealCreatedAt.getTime() + fullPeriod * 0.5;

        if (now.getTime() >= midpointTime && now.getTime() < expiresAt.getTime()) {
          const halfwayKey = `fifty-percent-reminder-sent-${artifactId}`;
          const previouslySent = await kvs.get(halfwayKey);
          if (previouslySent) {
            continue;
          }

          try {
            const expiryDate = expiresAt.toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });

            const result = await mailHalfwayReminder(
              value.lockedBy,
              value.attachmentName || "Unknown Attachment",
              value.contentId,
              expiryDate,
            );

            if (result.success) {
              await kvs.set(halfwayKey, {
                sentAt: now.toISOString(),
              });
              halfwayAlertsSent++;
            } else {
              console.warn(
                `Failed to post halfway reminder for ${artifactId}: ${result.reason}`,
              );
            }
          } catch (noticeError) {
            console.error("Error posting halfway reminder:", noticeError);
          }
        }
      } catch (error) {
        console.error(`Error processing seal ${key}:`, error);
      }
    }

    if (notifiedCount > 0 || halfwayAlertsSent > 0) {
      console.warn(`[EXPIRY-SWEEP] ${notifiedCount} expiry notifications, ${halfwayAlertsSent} reminders sent`);
    }
    return {
      statusCode: 200,
      headers: {},
      body: JSON.stringify({ notifiedCount, fiftyPctReminders: halfwayAlertsSent }),
    };
  } catch (error) {
    console.error("Error in expiry sweep task:", error);
    return {
      statusCode: 500,
      headers: {},
      body: JSON.stringify({ notifiedCount: 0, error: error.message }),
    };
  }
}

/**
 * Recurring nudge task for long-held seals.
 *
 * Records a banner-only dispatch (no comment) every N days while auto-unseal
 * is disabled. Comments are skipped to avoid cluttering pages with daily
 * notifications; the banner surfaces on the user's next page visit.
 */
export async function recurringNudgeTask() {
  try {
    const systemPolicy = await kvs.get("admin-settings-global");
    const autoUnsealActive = systemPolicy?.autoUnlockEnabled !== false;
    const nudgeIntervalDays = systemPolicy?.reminderIntervalDays || 7;

    // Only nudge when auto-unseal is DISABLED.
    if (autoUnsealActive) {
      return {
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ reminderCount: 0 }),
      };
    }

    const bulletinToggles = await resolveBulletinToggles(systemPolicy);
    if (
      !bulletinToggles.ENABLE_PERIODIC_REMINDER_BANNER ||
      !bulletinToggles.ENABLE_PAGE_BANNERS
    ) {
      return {
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ reminderCount: 0 }),
      };
    }

    const { results: activeSeals } = await kvs
      .query()
      .where("key", WhereConditions.beginsWith("protection-"))
      .limit(100)
      .getMany();

    if (activeSeals.length === 0) {
      return {
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ reminderCount: 0 }),
      };
    }

    const now = new Date();
    const nudgeTally = new Map();

    for (const { key, value } of activeSeals) {
      try {
        if (!value || !value.timestamp) {
          continue;
        }

        const artifactId = key.replace("protection-", "");
        const sealCreatedAt = new Date(value.timestamp);
        const daysHeld = Math.floor(
          (now - sealCreatedAt) / (1000 * 60 * 60 * 24),
        );

        const nudgeKey = `reminder-sent-${artifactId}`;
        const priorNudgeData = await kvs.get(nudgeKey);

        const nudgeDue =
          !priorNudgeData ||
          Math.floor(
            (now - new Date(priorNudgeData.sentAt)) / (1000 * 60 * 60 * 24),
          ) >= nudgeIntervalDays;

        if (!nudgeDue) {
          continue;
        }

        const artifactName = value.attachmentName || "Unknown Attachment";
        const contentId = value.contentId;

        if (!contentId) {
          continue;
        }

        await recordDispatch({
          id: `notification-${Date.now()}-${artifactId}`,
          type: "periodic-reminder",
          attachmentId: artifactId,
          attachmentName: artifactName,
          ownerAccountId: value.lockedBy,
          daysSealed: daysHeld,
          timestamp: Date.now(),
          pageId: contentId,
        });

        await kvs.set(nudgeKey, {
          sentAt: now.toISOString(),
          reminderNumber: (priorNudgeData?.reminderNumber || 0) + 1,
        });

        nudgeTally.set(artifactId, (nudgeTally.get(artifactId) || 0) + 1);
      } catch (error) {
        console.error(`Error processing seal ${key} for nudge:`, error);
      }
    }

    const totalNudges = Array.from(nudgeTally.values()).reduce(
      (a, b) => a + b,
      0,
    );
    if (totalNudges > 0) {
      console.warn(`[NUDGE] ${totalNudges} periodic-reminder banners recorded`);
    }
    return {
      statusCode: 200,
      headers: {},
      body: JSON.stringify({ reminderCount: totalNudges }),
    };
  } catch (error) {
    console.error("Error in recurring nudge task:", error);
    return {
      statusCode: 500,
      headers: {},
      body: JSON.stringify({ reminderCount: 0, error: error.message }),
    };
  }
}

// halfwayCheckTask merged into expirySweepTask. Kept as no-op for manifest compatibility.
export async function halfwayCheckTask() {
  return { statusCode: 200, headers: {}, body: JSON.stringify({ reminderCount: 0 }) };
}
