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
import { fetchPageLabels } from "./infra/labels.js";
import {
  autoAssignOnEvent, getSpaceWorkflowSettings, resolveWorkflowDef, findState, getInitialState,
  transitionPageWorkflow, readPageWorkflow, restampApprovedVersion, fetchLivePageVersion,
} from "./capsules/workflow/logic.js";
import { resolveApproverIds, applyAiVerdict } from "./capsules/workflow/approvals.js";
import { postEnforceComment } from "./infra/approval-blueprints.js";
import { isAccountStewardAsApp } from "./shared/steward-checks.js";
import { postValidationComment } from "./infra/validation-blueprints.js";
import { readDocBody, readDocBodyAtVersion, writeDocBody, collectMediaFileIds, extractMediaSingleNodes, spliceMediaNodes, locateBodiedSectionNodes, spliceSectionWrapper, hashAdf, canonicalizeAdf, nonEmptySectionBody } from "./infra/doc-surgery.js";

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
      } else {
        // SV-M3: surface a non-ok /user/current so a persistent 401/403/429 is visible.
        console.error(`[APP-ACCOUNT] /user/current returned ${myselfResponse.status} — app account id unresolved`);
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
    // audit C4: fail CLOSED, mirroring pageContentTrigger's SV-M3 guard. When our own account id
    // can't be resolved we can't tell our own revert re-saves from a real edit — the OLD guard
    // (`if (systemAccountId && ...)`) fell OPEN and kept enforcing, so in the narrow window where the
    // id is unresolved (fresh-install race / persistent /user/current 401/429) our own revert write
    // re-fires this trigger and is NOT recognised as self → an unbounded revert / version-churn loop.
    // Skip enforcement this run instead (briefly-unprotected is safer than a runaway loop).
    if (!systemAccountId) {
      console.error("[TRIGGER] App account id unresolved — skipping artifact enforcement this run (fail-closed).");
      return;
    }
    if (atlassianId === systemAccountId) {
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
    // SV-M3: if we can't resolve our own account id, we cannot distinguish our own restore
    // re-saves from a real edit. Fail CLOSED — skip body-mutating work this run rather than
    // risk an unbounded revert / version-churn loop.
    if (!systemAccountId) {
      console.error("[PAGE-PROTECT] App account id unresolved — skipping body protection this run (fail-closed).");
      return;
    }
    if (atlassianId === systemAccountId) {
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

    // #44: enforced Approved-state probe (cheap; no ADF read). May act inline (demote)
    // or ask for a whole-page revert. See collectWorkflowEnforcementForPage.
    const enforcement = contentProtectionOn
      ? await collectWorkflowEnforcementForPage(pageId, atlassianId, content?.version?.number, systemAccountId)
      : null;
    const needsRevert = enforcement?.action === "revert";

    const hasBodyWork = sealFileMap.length > 0 || sectionSeals.length > 0 || needsRevert;

    // --- Single read -> passes -> single write, with shared 409 backoff ---
    const MAX_RETRIES = 3;
    const notifyMap = new Map();
    let anyChange = false;
    let writtenVersion = null; // #44: the version an app write actually produced (§2.5)
    let enforceReverted = false; // #44: a Pass-0 revert actually wrote (for the SV-M2 notice)
    let enforceRevertVersion = null;
    let enforceObservedEqual = false; // #44: the revert pass CONFIRMED content-equality (no write needed)

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
          enforcedRevert: false, // #44: set by Pass 0 to short-circuit A/B + suppress SV-M5
          notifications: [],
        };
      } catch (err) {
        console.error("[PAGE-PROTECT] Failed to read page body:", err);
        break;
      }

      // Pass 0 (#44): enforced-state whole-page revert — runs FIRST, short-circuits A/B (who-wins).
      if (enforcement?.action === "revert") {
        try { await enforceApprovedStatePass(ctx, enforcement); }
        catch (e) { console.error("[WORKFLOW-ENFORCE] pass error:", e); }
      }
      // Pass A: sealed-section restore (suppressed while enforcing — who-wins + SV-M5 suppression)
      if (!ctx.enforcedRevert && sectionSeals.length > 0) {
        try { await restoreSealedSectionsPass(ctx, sectionSeals); }
        catch (e) { console.error("[PAGE-PROTECT] section pass error:", e); }
      }
      // Pass B: sealed-media restore
      if (!ctx.enforcedRevert && sealFileMap.length > 0) {
        try { await restoreMediaPass(ctx, sealFileMap); }
        catch (e) { console.error("[PAGE-PROTECT] media pass error:", e); }
      }
      // Pass C (Phase 4): validation enforcement — slots in here.

      // Accumulate notifications (dedup across retries by type + target).
      for (const n of ctx.notifications) {
        notifyMap.set(`${n.type}:${n.targetId || ""}`, n);
      }
      // #44: capture a CONFIRMED-equality observation (revert pass found the body already
      // equal to the baseline) so §2.5 can advance the baseline ONLY on genuine equality,
      // never on an abort/failed-write path (which must leave approvedVersion untouched).
      if (ctx.enforceObservedEqual) enforceObservedEqual = true;

      if (!ctx.changed) {
        break; // nothing to write this attempt
      }

      const putRes = await writeDocBody(
        ctx.pageId,
        ctx.pageData,
        ctx.adfDoc,
        ctx.enforceMessage || "(Sentinel Vault restored protected content)",
      );

      if (putRes.ok) {
        anyChange = true;
        writtenVersion = (ctx.currentVersion || 0) + 1; // #44: the version this PUT created
        if (ctx.enforcedRevert) { enforceReverted = true; enforceRevertVersion = ctx.enforceRevertTo; }
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

    // SV-M2: only notify after a CONFIRMED write. If every attempt 409'd or errored
    // (anyChange false), the content is still tampered — don't tell the owner it was
    // "restored/reverted".
    if (anyChange) {
      for (const n of notifyMap.values()) {
        try { await dispatchPipelineNotification(n); }
        catch (e) { console.error("[PAGE-PROTECT] notify error:", e); }
      }
      await touchSealTimestamp();
    }

    // #44: the enforce-revert notice — only after a CONFIRMED write (SV-M2).
    if (anyChange && enforceReverted) {
      try { await postEnforceComment(pageId, atlassianId, "revert", { approvedVersion: enforceRevertVersion }); }
      catch (e) { console.error("[WORKFLOW-ENFORCE] notice error:", e); }
    }

    // --- #44 reconciliation (§2.5): keep approvedVersion == the last version the app or
    // a privileged actor actually produced (never a pre-pass guess). Forward-only. ---
    try {
      if (enforcement && enforcement.action !== "demote") {
        let newBaseline = null;
        if (anyChange && writtenVersion) {
          newBaseline = writtenVersion; // app wrote (revert, or a seal restore on a privileged edit)
        } else if (enforcement.action === "privileged") {
          newBaseline = content?.version?.number || (await fetchLivePageVersion(pageId)); // editor's live version
        } else if (enforcement.action === "revert" && enforceObservedEqual) {
          // ONLY when the pass CONFIRMED the body already equals the baseline (no write
          // needed) do we advance to live. On any abort/failed-write path the body is
          // still the un-reverted tamper — do NOT launder it into approvedVersion; leave
          // the baseline at V0 so the hourly sweep re-attempts (fail-closed).
          newBaseline = await fetchLivePageVersion(pageId);
        }
        if (newBaseline) await restampApprovedVersion(pageId, newBaseline).catch(() => {});
      }
    } catch (e) {
      console.error("[WORKFLOW-ENFORCE] reconciliation error:", e);
    }

    // --- Conditions & Validations phase (independent of seals) ---
    try {
      await runValidationPhase(event, pageId, atlassianId);
    } catch (e) {
      console.error("[VALIDATE] phase error:", e);
    }

    // --- Workflow auto-assign phase (#42; CREATED pages only, independent of seals).
    // Gated to created:page so "autoAssignNew" means exactly new pages and the log
    // reason is accurate (existing-page backfill is the job of the explicit bulk-apply).
    // Idempotent + a one-shot claim marker guards duplicate deliveries; content-property
    // writes don't re-fire page events (same as the seal props), so no loop. ---
    try {
      const isCreate = typeof event?.eventType === "string" && event.eventType.includes("created");
      const wfSpaceKey = event?.space?.key || event?.content?.space?.key || event?.content?.spaceKey || null;
      if (isCreate && wfSpaceKey) {
        await autoAssignOnEvent({ pageId, spaceKey: wfSpaceKey, actorAccountId: atlassianId || null, actorName: null });
      }
    } catch (e) {
      console.error("[WORKFLOW] auto-assign phase error:", e);
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

  // audit B4: cursor-paginate — a single limit(100) over the instance-wide protection-*
  // records silently DROPPED a page's seal once >100 seals existed anywhere, so a tamper on
  // page 101+ was never reverted and no error was raised. This scan only runs on a page that
  // already carries the seal content-property (a minority of pages). (A per-page seal index
  // is the proper O(1) fix; this raises the bound from 100 to ~5000 with high confidence.)
  const pageSeals = [];
  let sealQuery = kvs.query().where("key", WhereConditions.beginsWith("protection-")).limit(100);
  let sealIters = 0;
  do {
    const { results, nextCursor } = await sealQuery.getMany();
    for (const entry of results || []) {
      if (entry.value?.contentId === pageId && entry.value?.lockedBy) pageSeals.push(entry);
    }
    if (!nextCursor || ++sealIters >= 50) break;
    sealQuery = kvs.query().where("key", WhereConditions.beginsWith("protection-")).limit(100).cursor(nextCursor);
  } while (true);
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
  if (ctx.enforcedRevert) return; // #44: an enforce revert already replaced the whole body
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
  // SV-M6 + it23: the version still containing each sealed media may not be exactly
  // currentVersion-1 (a second edit or a trigger lag pushes it back), AND different violated
  // files may last exist in DIFFERENT older versions. Walk backward a bounded number of
  // versions and ACCUMULATE — restoring each file from the most-recent version that still had
  // it, shrinking the still-needed set until it's empty. (The old code broke on the FIRST
  // version yielding ANY media, so a file deleted in an earlier version was never restored —
  // a silent, permanent protection bypass once it fell past MAX_LOOKBACK.)
  const restoredEntries = [];
  const stillNeeded = new Set(violatedFileIds);
  const MAX_LOOKBACK = 5;
  for (let v = ctx.currentVersion - 1; v >= 1 && v >= ctx.currentVersion - MAX_LOOKBACK && stillNeeded.size > 0; v--) {
    try {
      const { adfDoc: olderAdf } = await readDocBodyAtVersion(ctx.pageId, v);
      const found = extractMediaSingleNodes(olderAdf, stillNeeded);
      for (const entry of found) {
        restoredEntries.push(entry);
        for (const fid of collectMediaFileIds(entry.node)) stillNeeded.delete(fid);
      }
    } catch (_) { /* best effort */ }
  }
  if (restoredEntries.length === 0) {
    console.warn("[PAGE-PROTECT] Could not find sealed media in recent versions — skipping");
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
  // and space-section-protection-* by prefix). audit B4: cursor-paginate — a single
  // limit(100) silently dropped a page's sealed section once >100 sections existed anywhere.
  const out = [];
  let q = kvs.query().where("key", WhereConditions.beginsWith("section-protection-")).limit(100);
  let iters = 0;
  do {
    const { results, nextCursor } = await q.getMany();
    for (const { value: v } of results || []) {
      if (v?.pageId === pageId && v?.lockedBy && v?.sectionId) out.push(v);
    }
    if (!nextCursor || ++iters >= 50) break;
    q = kvs.query().where("key", WhereConditions.beginsWith("section-protection-")).limit(100).cursor(nextCursor);
  } while (true);
  return out;
}

// --- Pipeline pass: restore tampered / removed sealed sections ---
// Flatten the visible text of a node (used to anchor a removed section by its heading). SV-m6.
function sectionHeadingText(node) {
  let t = "";
  const walk = (x) => { if (x?.type === "text") t += x.text || ""; if (Array.isArray(x?.content)) x.content.forEach(walk); };
  walk(node);
  return t.trim();
}

async function restoreSealedSectionsPass(ctx, sectionSeals) {
  if (ctx.enforcedRevert) return; // #44: suppress SV-M5 re-baseline + restore while enforcing
  const now = Date.now();
  // it24 (R3-F1): group ALL wrappers per sectionId, not a last-wins Map. A page can hold
  // DUPLICATE sealed sections (copy-paste, or an attacker PUT-ing ADF with two same-sectionId
  // bodiedExtensions via REST). A Map hid all but one copy, so detection read one copy while
  // replaceSectionBody rewrote the FIRST scan-match — a tamper on a non-selected copy was
  // missed, and restore rewrote the wrong (pristine) copy with a false "reverted" notice.
  const wrappersById = new Map();
  for (const w of locateBodiedSectionNodes(ctx.adfDoc)) {
    if (!w.sectionId) continue;
    const list = wrappersById.get(w.sectionId) || [];
    list.push(w);
    wrappersById.set(w.sectionId, list);
  }

  for (const seal of sectionSeals) {
    // Owner edits their own sealed section freely — but RE-BASELINE the snapshot (SV-M5),
    // otherwise a later unrelated non-owner save sees the stale hash and reverts the owner's
    // own edit, destroying it and falsely blaming the non-owner.
    if (seal.lockedBy === ctx.atlassianId) {
      const ownWrap = (wrappersById.get(seal.sectionId) || [])[0];
      if (ownWrap) {
        const ownHash = hashAdf(ownWrap.node.content);
        if (seal.contentHash && ownHash !== seal.contentHash) {
          try {
            const newBody = JSON.parse(JSON.stringify(ownWrap.node.content || []));
            await kvs.set(`section-protection-${seal.sectionId}`, { ...seal, contentHash: ownHash });
            await kvs.set(`section-snapshot-${seal.sectionId}`, {
              wrapperNode: JSON.parse(JSON.stringify(ownWrap.node)),
              bodyContent: newBody, hash: ownHash, version: null, originalIndex: ownWrap.originalIndex,
            });
            console.warn(`[SECTION] Owner re-baselined section ${seal.sectionId}`);
          } catch (e) { console.error("[SECTION] owner re-baseline failed:", e); }
        }
      }
      continue;
    }
    // Expired seals are inert (full auto-unseal handled by the expiry sweep).
    if (seal.expiresAt && new Date(seal.expiresAt).getTime() <= now) continue;

    const wrapperList = wrappersById.get(seal.sectionId) || [];
    const snapshot = await kvs.get(`section-snapshot-${seal.sectionId}`);

    if (wrapperList.length === 0) {
      // The entire sealed-section macro was deleted/cut — re-insert the SEALED wrapper.
      const restoreNode = snapshot?.wrapperNode || null;
      // SV-m6: position the restore by ANCHORING to the section's preceding heading (read from
      // the previous version) rather than the FROZEN seal-time originalIndex, which drops the
      // wrapper in the wrong place when blocks shifted above it since sealing.
      let originalIndex = typeof snapshot?.originalIndex === "number"
        ? snapshot.originalIndex
        : (ctx.adfDoc.content?.length || 0);
      let prevNode = null;
      if (ctx.currentVersion && ctx.currentVersion >= 2) {
        try {
          const { adfDoc: prev } = await readDocBodyAtVersion(ctx.pageId, ctx.currentVersion - 1);
          const prevWrap = locateBodiedSectionNodes(prev).find((w) => w.sectionId === seal.sectionId);
          if (prevWrap) {
            prevNode = prevWrap.node;
            originalIndex = prevWrap.originalIndex; // recent absolute position (better than seal-time)
            const before = (prev.content || [])[prevWrap.originalIndex - 1];
            const anchorText = before?.type === "heading" ? sectionHeadingText(before) : null;
            if (anchorText) {
              const cur = ctx.adfDoc.content || [];
              const at = cur.findIndex((b) => b?.type === "heading" && sectionHeadingText(b) === anchorText);
              if (at >= 0) originalIndex = at + 1; // insert right after the same heading
            }
          }
        } catch (_) { /* best effort */ }
      }
      const finalNode = restoreNode || prevNode;
      if (!finalNode) {
        console.warn(`[SECTION] Cannot restore removed section ${seal.sectionId} — no snapshot or prior version`);
        continue;
      }
      spliceSectionWrapper(ctx.adfDoc, [{ node: finalNode, originalIndex }]);
      ctx.changed = true;
      ctx.notifications.push({
        type: "section-revert", targetId: seal.sectionId,
        seal, actor: ctx.atlassianId, pageId: ctx.pageId, kind: "removed",
      });
      continue;
    }

    // it24 (R3-F1): one or MORE copies of the sealed section are present. Compare EVERY copy to
    // the sealed baseline — the old Map-based code inspected only one, so a tamper on another
    // copy was missed, and replaceSectionBody rewrote the FIRST scan-match (not the copy it
    // inspected), so a tampered non-first copy survived with a false "reverted" notice.
    const isUntouched = (node) => {
      if (!(seal.contentHash && hashAdf(node.content) === seal.contentHash)) return false;
      // SV-M7: a matching 32-bit hash is not proof — confirm STRUCTURALLY against the snapshot.
      return !snapshot?.bodyContent ||
        JSON.stringify(canonicalizeAdf(node.content)) === JSON.stringify(canonicalizeAdf(snapshot.bodyContent));
    };
    const changedWrappers = wrapperList.filter((w) => !isUntouched(w.node));
    if (changedWrappers.length === 0) continue; // every copy matches the seal — untouched

    // Approved section editor (Edit Requests) — allow the edit and re-baseline from the edited copy.
    const sectionGrant = await getActiveSectionEditGrant(seal.sectionId, ctx.atlassianId);
    if (sectionGrant) {
      try {
        const edited = changedWrappers[0];
        const newBody = JSON.parse(JSON.stringify(edited.node.content || []));
        const newHash = hashAdf(newBody);
        await kvs.set(`section-protection-${seal.sectionId}`, { ...seal, contentHash: newHash });
        await kvs.set(`section-snapshot-${seal.sectionId}`, {
          wrapperNode: JSON.parse(JSON.stringify(edited.node)),
          bodyContent: newBody, hash: newHash, version: null, originalIndex: edited.originalIndex,
        });
        // it52: converge any OTHER same-sectionId copies to the accepted body + write the page, so a
        // duplicate copy tampered in the SAME save can't survive undetected (and can't later be
        // promoted to the seal baseline once the accepted copy matches). Parity with the restore
        // branch below, which loops ALL changedWrappers for exactly this duplicate-tamper vector
        // (it24/it40). Single-copy edits (the common case) skip the loop → behavior unchanged.
        for (let ci = 1; ci < changedWrappers.length; ci++) {
          changedWrappers[ci].node.content = nonEmptySectionBody(JSON.parse(JSON.stringify(newBody)));
          ctx.changed = true;
        }
        console.warn(`[SECTION] Allowed approved edit of section ${seal.sectionId} by ${ctx.atlassianId} — re-baselined (${changedWrappers.length} cop${changedWrappers.length === 1 ? "y" : "ies"})`);
      } catch (e) { console.error("[SECTION] re-baseline failed:", e); }
      continue;
    }

    // Body edited by a non-authorized user — restore the sealed body into EVERY differing copy,
    // mutating the exact nodes we inspected (no first-vs-last desync).
    if (snapshot?.bodyContent) {
      // it40 (R3-F5): an empty-baseline snapshot ([]) is truthy, so guard it — restoring
      // content:[] is invalid ADF that 400s the whole-page PUT, dropping EVERY sibling
      // section's restore on this page. nonEmptySectionBody → one empty paragraph.
      for (const w of changedWrappers) {
        w.node.content = nonEmptySectionBody(JSON.parse(JSON.stringify(snapshot.bodyContent)));
      }
      ctx.changed = true;
      ctx.notifications.push({
        type: "section-revert", targetId: seal.sectionId,
        seal, actor: ctx.atlassianId, pageId: ctx.pageId, kind: "body-edited",
      });
    } else {
      console.warn(`[SECTION] Section ${seal.sectionId} body changed but no snapshot to restore from`);
    }
  }
}

// ============================================================================
// #44 — Enforced Approved state (revert-on-tamper). See F44-DESIGN.md in the skill.
// ============================================================================

// Cheap probe (§2.1): decides whether an enforced page needs a revert, is a privileged
// edit, or should be demoted (done inline). NO ADF read on the fast path.
export async function collectWorkflowEnforcementForPage(pageId, atlassianId, eventVersion, systemAccountId) {
  // 1. Fast path — content-property probe. Absent/non-enforced -> nothing to do.
  let prop = null;
  try {
    const res = await asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}/properties?key=sentinel-vault-workflow`);
    if (res.ok) prop = (await res.json())?.results?.[0]?.value;
  } catch (_) { return null; }
  if (!prop || prop.enforce !== true) return null;

  // 2. Authoritative record + re-confirm the state is still an enforce state.
  const record = await readPageWorkflow(pageId);
  if (!record?.enforce) return null;
  const def = await resolveWorkflowDef(record.spaceKey);
  if (!findState(def, record.stateId)?.enforce) return null;

  // 3. Privileged? snapshot ∩ live-config approvers, OR live steward (§0.D/§0.E).
  //    If live group-expansion FAILED (outage), trust the snapshot rather than reverting a
  //    real approver's edit — revocation is only honored when expansion actually succeeds.
  const settings = await getSpaceWorkflowSettings(record.spaceKey);
  const liveSpec = await resolveApproverIds(settings.approval);
  const liveApprovers = liveSpec?.approvers || [];
  const liveUnresolved = !!liveSpec?.unresolved;
  const privileged =
    (Array.isArray(record.approvers) && record.approvers.includes(atlassianId) && (liveApprovers.includes(atlassianId) || liveUnresolved))
    || await isAccountStewardAsApp(atlassianId, record.spaceKey);
  if (privileged) return { action: "privileged", record }; // reconciliation (§2.5) advances the baseline

  // 4. Not privileged -> revert (opt-in) or demote (default). CL-5: empty approver set
  //    + revert downgrades to demote (a misconfig must not blank every non-steward edit).
  let mode = settings?.enforceMode === "revert" ? "revert" : "demote";
  if (mode === "revert" && (!Array.isArray(record.approvers) || record.approvers.length === 0)) mode = "demote";
  if (mode === "revert") return { action: "revert", record, spaceKey: record.spaceKey };

  // DEMOTE inline (§2.6) — no body write, no ADF read, no ping-pong surface.
  try {
    const initial = getInitialState(def);
    const res = await transitionPageWorkflow({
      pageId, spaceKey: record.spaceKey, toStateId: initial.id,
      actorAccountId: systemAccountId, actorName: "Sentinel Vault",
      reason: "auto-demoted: edited by non-approver while Approved",
    });
    if (res.success) await postEnforceComment(pageId, atlassianId, "demote").catch(() => {});
    // #7: the default workflow has an Approved->Draft edge; a custom workflow that lacks one
    // would leave the page enforced-but-not-demoted — surface it rather than fail silently.
    else console.error(`[WORKFLOW-ENFORCE] demote of ${pageId} did not apply: ${res.reason}`);
  } catch (e) { console.error("[WORKFLOW-ENFORCE] demote error:", e); }
  return { action: "demote" };
}

// Pass 0 (§2.3): whole-page revert to the approved baseline. Mutates ctx.adfDoc; the
// shared single writeDocBody performs the one write. Re-reads approvedVersion fresh.
async function enforceApprovedStatePass(ctx, enf) {
  const rec = await readPageWorkflow(ctx.pageId);
  if (!rec?.enforce) return;                          // demoted/left enforce mid-flight
  const av = rec.approvedVersion;
  if (!(typeof av === "number" && av >= 1)) return;   // no valid baseline
  const cur = ctx.currentVersion || 0;
  if (cur <= av) return;                              // behind/equal — nothing to enforce

  // #6 (TOCTOU): a sanctioned edit may sit between the baseline and the current tamper (a
  // privileged actor's edit whose reconciliation hasn't advanced approvedVersion yet). Revert
  // to the HIGHEST privileged-authored version in (av, cur), not blindly to av — otherwise a
  // concurrent approver edit is destroyed. targetV === av when there's no intervening edit.
  const targetV = (cur - av > 1) ? await highestSanctionedVersion(ctx.pageId, rec, av, cur) : av;

  const { adfDoc: approvedAdf } = await readDocBodyAtVersion(ctx.pageId, targetV);
  // CL-1: never let an empty/unreadable baseline blank the page.
  if (!approvedAdf?.content?.length) {
    console.error(`[WORKFLOW-ENFORCE] approved v${targetV} body empty/unreadable for ${ctx.pageId} — aborting revert`);
    return;
  }
  // CL-7: hash match is not proof (32-bit FNV) — confirm canonical structures too.
  if (hashAdf(ctx.adfDoc) === hashAdf(approvedAdf) &&
      JSON.stringify(canonicalizeAdf(ctx.adfDoc.content)) === JSON.stringify(canonicalizeAdf(approvedAdf.content))) {
    ctx.enforceObservedEqual = true; // CONFIRMED equality — §2.5 may advance the baseline to live
    return; // already equal — no body write
  }
  ctx.adfDoc.content = approvedAdf.content;           // whole-body replace, in place
  ctx.changed = true;
  ctx.enforcedRevert = true;                          // short-circuit A/B + suppress SV-M5
  ctx.enforceRevertTo = targetV;                      // for the comment copy (§5)
  ctx.enforceMessage = "(Sentinel Vault reverted unapproved change to the approved version)";
}

// #6: highest version in (av, cur) authored by a privileged actor (approver-snapshot ∩ live
// config, or trigger-safe steward) — the last SANCTIONED content to revert to. Returns av if
// none. One versions GET; only called when intervening versions exist.
async function highestSanctionedVersion(pageId, record, av, cur) {
  try {
    const res = await asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}/versions?limit=50`);
    if (!res.ok) return av;
    const versions = (await res.json())?.results || [];
    const settings = await getSpaceWorkflowSettings(record.spaceKey);
    const liveSpec = await resolveApproverIds(settings.approval);
    const liveApprovers = liveSpec?.approvers || [];
    const liveUnresolved = !!liveSpec?.unresolved;
    let best = av;
    for (const v of versions) {
      const n = v.number;
      if (typeof n !== "number" || n <= av || n >= cur || n <= best) continue;
      const author = v.authorId;
      const priv = author && (
        (Array.isArray(record.approvers) && record.approvers.includes(author) && (liveApprovers.includes(author) || liveUnresolved))
        || await isAccountStewardAsApp(author, record.spaceKey));
      if (priv) best = n;
    }
    return best;
  } catch (_) { return av; }
}

// §4.4: author of the current top version (for the sweep's authorized-drift check).
async function fetchLiveVersionAuthor(pageId) {
  try {
    const res = await asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}/versions?limit=1`);
    if (res.ok) return (await res.json())?.results?.[0]?.authorId ?? null;
  } catch (_) { /* fail-closed toward enforcement */ }
  return null;
}

// §4.3: standalone revert used by the sweep (not inside the ctx loop). Same 409 backoff.
export async function sweepRevertToApproved(pageId, record) {
  const fresh = await readPageWorkflow(pageId);
  const av = fresh?.approvedVersion;
  if (!(typeof av === "number" && av >= 1)) return false;
  let approvedAdf;
  try { ({ adfDoc: approvedAdf } = await readDocBodyAtVersion(pageId, av)); } catch (_) { return false; }
  if (!approvedAdf?.content?.length) return false; // CL-1: never blank
  for (let attempt = 0; attempt < 3; attempt++) {
    let head;
    try { head = await readDocBody(pageId); } catch (_) { return false; }
    if ((head.pageData.version?.number || 0) <= av) return false; // no drift now
    // Content already equals the baseline (a version bump with no real change) — advance
    // the baseline to resolve the drift WITHOUT a needless destructive rewrite (mirror the
    // event-path CL-7 guard). Return true: the drift is reconciled.
    if (hashAdf(head.adfDoc) === hashAdf(approvedAdf) &&
        JSON.stringify(canonicalizeAdf(head.adfDoc.content)) === JSON.stringify(canonicalizeAdf(approvedAdf.content))) {
      await restampApprovedVersion(pageId, head.pageData.version?.number || 0).catch(() => {});
      return true;
    }
    head.adfDoc.content = approvedAdf.content;
    const putRes = await writeDocBody(pageId, head.pageData, head.adfDoc, "(Sentinel Vault reverted unapproved change to the approved version)");
    if (putRes.ok) { await restampApprovedVersion(pageId, (head.pageData.version?.number || 0) + 1).catch(() => {}); return true; }
    if (putRes.status === 409) { await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500)); continue; }
    return false; // SV-M2: don't claim success on a non-409 error
  }
  return false;
}

// §4.2: hourly integrity sweep — the durable backstop for dropped events. Cursor-paginated,
// author-aware (never reverts an authorized dropped-event edit), self-healing, dedup-guarded.
export async function workflowSweep() {
  const systemAccountId = await resolveAppAccountId();
  if (!systemAccountId) return { body: JSON.stringify({ swept: 0, reason: "no app account" }) };
  let reverted = 0, demoted = 0, healed = 0, expired = 0;
  const nowMs = Date.now();
  const defCache = new Map(); // per-space def cache — most pages in a space share one workflow
  const defFor = async (sk) => { if (!defCache.has(sk)) defCache.set(sk, await resolveWorkflowDef(sk)); return defCache.get(sk); };
  let query = kvs.query().where("key", WhereConditions.beginsWith("workflow-idx-")).limit(100);
  let iterations = 0;
  do {
    const { results, nextCursor } = await query.getMany();
    for (const { value: idx } of (results || [])) {
      try {
        const record = await readPageWorkflow(idx.pageId);
        if (!record) continue;
        const def = await defFor(record.spaceKey);
        // #45 review-expiry (runs FIRST): an Approved page past its review-due date
        // auto-transitions to Expired + notifies. Leaving Approved also ends enforcement,
        // so this page needs no enforce processing this tick.
        if (record.reviewDueAt && findState(def, record.stateId)?.reviewAfterDays &&
            new Date(record.reviewDueAt).getTime() < nowMs && findState(def, "expired")) {
          const res = await transitionPageWorkflow({
            pageId: idx.pageId, spaceKey: record.spaceKey, toStateId: "expired",
            actorAccountId: systemAccountId, actorName: "Sentinel Vault",
            reason: "review period elapsed — auto-expired",
          });
          if (res.success) { expired++; await postEnforceComment(idx.pageId, record.enteredBy, "expired").catch(() => {}); }
          continue;
        }
        if (!record?.enforce) continue;
        if (!findState(def, record.stateId)?.enforce) continue;
        const live = await fetchLivePageVersion(idx.pageId);
        if (live == null) continue;
        // Gap B: a null baseline on an enforced page is a hole — self-heal, don't skip.
        if (record.approvedVersion == null) {
          if (await restampApprovedVersion(idx.pageId, live)) healed++;
          continue;
        }
        if (live === record.approvedVersion) {
          await kvs.delete(`workflow-integrity-notified-${idx.pageId}`).catch(() => {});
          continue;
        }
        // DRIFT. Gap C/CL-3: a dropped event may have been an AUTHORIZED edit — check the author.
        const author = await fetchLiveVersionAuthor(idx.pageId);
        const settings = await getSpaceWorkflowSettings(record.spaceKey);
        const liveSpec = await resolveApproverIds(settings.approval);
        const liveApprovers = liveSpec?.approvers || [];
        const liveUnresolved = !!liveSpec?.unresolved;
        const authorized = author && (
          author === systemAccountId // the app's own version bumps (revert re-saves) are never tampers
          || (record.approvers.includes(author) && (liveApprovers.includes(author) || liveUnresolved))
          || await isAccountStewardAsApp(author, record.spaceKey));
        if (authorized) {
          if (await restampApprovedVersion(idx.pageId, live)) healed++;
          await kvs.delete(`workflow-integrity-notified-${idx.pageId}`).catch(() => {});
          continue;
        }
        const mode = settings?.enforceMode || "demote";
        const alreadyNotified = await kvs.get(`workflow-integrity-notified-${idx.pageId}`);
        if (mode === "revert" && record.approvers.length > 0) { // CL-5
          const ok = await sweepRevertToApproved(idx.pageId, record);
          if (ok) { reverted++; await kvs.delete(`workflow-integrity-notified-${idx.pageId}`).catch(() => {}); }
          else if (!alreadyNotified) {
            await postEnforceComment(idx.pageId, record.enteredBy, "revert-failed").catch(() => {});
            await kvs.set(`workflow-integrity-notified-${idx.pageId}`, { at: new Date().toISOString() });
          }
        } else {
          const initial = getInitialState(def);
          const res = await transitionPageWorkflow({
            pageId: idx.pageId, spaceKey: record.spaceKey, toStateId: initial.id,
            actorAccountId: systemAccountId, actorName: "Sentinel Vault",
            reason: "auto-demoted by integrity sweep (unauthorized drift)",
          });
          if (res.success && !alreadyNotified) {
            demoted++;
            await postEnforceComment(idx.pageId, record.enteredBy, "demote").catch(() => {});
            await kvs.set(`workflow-integrity-notified-${idx.pageId}`, { at: new Date().toISOString() });
          }
        }
      } catch (e) { console.error("[WORKFLOW-SWEEP]", e); }
    }
    if (!nextCursor || ++iterations >= 20) break;
    query = kvs.query().where("key", WhereConditions.beginsWith("workflow-idx-")).limit(100).cursor(nextCursor);
  } while (true);

  // #46 reaper: fail a transition AI review whose worker delivery never arrived (the pending
  // record's only TTL). CAS-guarded in applyAiVerdict — a late worker that already wrote a
  // verdict is a no-op. Timeout = 15 min; older enqueuedAt still pending → terminal failed.
  let aiTimedOut = 0;
  const AI_GATE_TIMEOUT_MS = 15 * 60 * 1000;
  let pq = kvs.query().where("key", WhereConditions.beginsWith("workflow-pending-")).limit(100);
  let piter = 0;
  do {
    const { results, nextCursor } = await pq.getMany();
    for (const { key, value: pend } of (results || [])) {
      try {
        if (pend?.aiGate?.required && pend.aiGate.status === "pending"
            && typeof pend.aiGate.enqueuedAt === "number" && (nowMs - pend.aiGate.enqueuedAt) > AI_GATE_TIMEOUT_MS) {
          const pageId = String(key).replace(/^workflow-pending-/, "");
          const r = await applyAiVerdict(pageId, null, "failed", "AI review timed out — please re-request.");
          if (r?.applied) aiTimedOut++;
        }
      } catch (e) { console.error("[WORKFLOW-SWEEP] ai-reaper", e); }
    }
    if (!nextCursor || ++piter >= 20) break;
    pq = kvs.query().where("key", WhereConditions.beginsWith("workflow-pending-")).limit(100).cursor(nextCursor);
  } while (true);

  return { body: JSON.stringify({ reverted, demoted, healed, expired, aiTimedOut }) };
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
  if (!version) return; // SV-m1: an undefined version would bypass dedup entirely
  if (await wasVersionChecked(pageId, version)) return;
  // SV-m1: claim this version up-front (before any side effect) so a duplicate updated:page
  // delivery for the same version can't double-post advisory comments / state writes.
  await markVersionChecked(pageId, version);

  // Fetch page labels (required-label rule) — shared helper (#46 reuse).
  const labels = await fetchPageLabels(pageId);

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
  // it50: when revert mode is also on, DON'T post the pre-revert "review and update" advisory here —
  // the revert path below posts the single coherent "was reverted / recover from history" comment.
  // (Otherwise the author sees a "review and update" comment for content that was just rolled back.)
  if (modes.advisory && !modes.revert) {
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
          // SV-M1: if the page changed since we evaluated it (a concurrent newer save), DON'T
          // overwrite that content with our last-good body — abort and let the newer version's
          // own validation pass handle it.
          if ((current.pageData.version?.number || 0) !== version) {
            console.warn(`[VALIDATE] page changed during revert (evaluated v${version}, now v${current.pageData.version?.number}) — skipping revert`);
            break;
          }
          const { adfDoc: goodAdf } = await readDocBodyAtVersion(pageId, lastGood);
          const putRes = await writeDocBody(pageId, current.pageData, goodAdf, "(Sentinel Vault reverted non-compliant content)");
          if (putRes.ok) {
            reverted = true;
            // SV-m2: the content is compliant again — reconcile the gate state so the inline
            // panel / doc ribbon don't keep showing a stale "failed".
            if (modes.gate) {
              try {
                const newVersion = (current.pageData.version?.number || version) + 1;
                await writeValidationState(pageId, { state: "passed", violations: [], version: newVersion, checkedAt: new Date().toISOString() });
              } catch (_) { /* best effort */ }
            }
            break;
          }
          if (putRes.status === 409) { await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500)); continue; }
          break;
        } catch (e) { console.error("[VALIDATE] revert error:", e); break; }
      }
      // it50: always surface the reverted:true comment (with the history recovery link) on a
      // successful revert — even under advisory mode (the pre-revert advisory is suppressed above),
      // so the author always learns their edit was rolled back and how to recover it.
      if (reverted) {
        try { await postValidationComment({ pageId, editorAccountId: atlassianId, violations, reverted: true, historyUrl }); }
        catch (_) { /* best effort */ }
      }
    } else {
      // No compliant version to revert to (e.g. v1) — flag once. The pre-revert advisory is
      // suppressed under revert mode, so this is the author's single notice. it50.
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

  // audit C3: an EXPIRED (but not-yet-swept) seal must stop enforcing — otherwise a dead seal
  // keeps reverting everyone's edits, denying service. Sections already guard this
  // (restoreSealedSectionsPass); attachments did not.
  if (sealRecord.expiresAt && new Date(sealRecord.expiresAt).getTime() <= Date.now()) {
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

  // Get the filename for re-upload (best-effort — fall back to the event's fileName so a
  // transient details-GET failure doesn't abort the revert).
  let artifactName = attachment?.fileName || "attachment";
  try {
    const ar = await asApp().requestConfluence(route`/wiki/api/v2/attachments/${artifactId}`);
    if (ar.ok) artifactName = (await ar.json())?.title || artifactName;
  } catch (_) { /* fall back to event fileName */ }

  // audit B1/B2: retry the download+re-upload; on definitive failure, notify LOUDLY instead
  // of returning silently (the seal is a fail-OPEN otherwise — a single 429/5xx blip would
  // permanently let the tampered version stand with the owner believing it was protected).
  const revert = await revertAttachmentToVersion(contentId, artifactId, artifactName, targetVersion);
  if (!revert.ok) {
    console.error(`[EDIT-REVERT] FAILED to enforce seal on "${artifactName}" -> v${targetVersion} (${revert.stage} ${revert.status || revert.error || ""}) — the tampered version is LIVE; notifying owner.`);
    await notifyAttachmentRevertFailed(sealRecord, artifactId, contentId, atlassianId, artifactName).catch(() => {});
    return;
  }

  console.warn(`[EDIT-REVERT] Reverted ${artifactName} to v${targetVersion}`);
  await sendViolationNotifications(sealRecord, artifactId, contentId, atlassianId, artifactName, "edit");
}

// audit B1/B2: attachment revert with bounded 429/5xx backoff. A single transient failure
// must not silently bypass a seal (there is no attachment-side sweep backstop). Returns
// { ok } | { ok:false, stage, status?, error? }.
async function revertAttachmentToVersion(contentId, artifactId, title, targetVersion) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const backoff = () => new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
    try {
      const dl = await asApp().requestConfluence(
        route`/wiki/rest/api/content/${contentId}/child/attachment/${artifactId}/download?version=${targetVersion}`,
      );
      if (!dl.ok) {
        if ((dl.status === 429 || dl.status >= 500) && attempt < 2) { await backoff(); continue; }
        return { ok: false, stage: "download", status: dl.status };
      }
      const fileBuffer = await dl.arrayBuffer();
      const formData = new FormData();
      formData.append("file", new Blob([fileBuffer]), title);
      formData.append("comment", "(Sentinel Vault automatically reversed modifications)");
      formData.append("minorEdit", "true");
      const up = await asApp().requestConfluence(
        route`/wiki/rest/api/content/${contentId}/child/attachment/${artifactId}/data`,
        { method: "POST", headers: { "X-Atlassian-Token": "nocheck" }, body: formData },
      );
      if (!up.ok) {
        if ((up.status === 429 || up.status >= 500) && attempt < 2) { await backoff(); continue; }
        return { ok: false, stage: "upload", status: up.status };
      }
      return { ok: true };
    } catch (e) {
      if (attempt < 2) { await backoff(); continue; }
      return { ok: false, stage: "exception", error: String(e?.message || e) };
    }
  }
  return { ok: false, stage: "exhausted" };
}

// audit B1: surface a failed attachment revert (owner comment + a distinct dispatch) rather
// than failing silently. Best-effort; never throws into the trigger.
async function notifyAttachmentRevertFailed(sealRecord, artifactId, contentId, atlassianId, artifactName) {
  try {
    await recordDispatch({
      id: `revert-failed-${Date.now()}`,
      type: "revert-failed",
      attachmentId: artifactId,
      attachmentName: artifactName,
      ownerAccountId: sealRecord.lockedBy,
      editorAccountId: atlassianId,
      timestamp: Date.now(),
      pageId: contentId,
    });
  } catch (_) { /* best-effort */ }
  try {
    await postDocFootnote(contentId, sealRecord.lockedBy, atlassianId, artifactName, "revert-failed");
  } catch (_) { /* best-effort */ }
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
  const restoreBody = JSON.stringify({
    id: artifactId, type: "attachment", status: "current", title: attachmentTitle,
    version: { number: currentVersion + 1 },
  });
  // audit C4: retry the restore on a transient failure; a single 429/5xx must not be treated
  // as "unrecoverable".
  let restoreOk = false, lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const restoreResponse = await asApp().requestConfluence(restoreRoute, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: restoreBody,
    });
    if (restoreResponse.ok) { restoreOk = true; break; }
    lastStatus = restoreResponse.status;
    if ((restoreResponse.status === 429 || restoreResponse.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500)); continue;
    }
    console.error(`[TRASH-RESTORE] Failed ${artifactId}: ${restoreResponse.status} — ${(await restoreResponse.text()).slice(0, 200)}`);
    break;
  }

  if (!restoreOk) {
    // audit C4: do NOT hard-delete the seal on a restore failure — the attachment is still in
    // TRASH and recoverable, so deleting the seal permanently strips protection AND the old code
    // emailed a false "deleted". Keep the seal; tell the owner the restore could not be applied.
    console.error(`[TRASH-RESTORE] Could not restore ${artifactId} (last status ${lastStatus}) — KEEPING the seal (attachment recoverable from trash); notifying.`);
    await notifyAttachmentRevertFailed(sealRecord, artifactId, pageId, atlassianId, attachmentTitle).catch(() => {});
    return;
  }

  console.warn(`[TRASH-RESTORE] Restored ${attachmentTitle} (${artifactId})`);

  // Touch seal timestamp so frontend polling picks up the change
  await touchSealTimestamp();

  // Send violation notifications
  await sendViolationNotifications(sealRecord, artifactId, pageId, atlassianId, attachmentTitle, "delete");
}

// --- Handle permanent deletion of a sealed artifact ---
// B13: exported so the permanent-delete cleanup can be exercised directly (the trigger only fires on a
// real avi:confluence:deleted:attachment, which a harness can't emit). Signature unchanged; the internal
// caller in artifactEventTrigger is unaffected.
export async function handleSealedArtifactDeleted(sealRecord, artifactId, contentId, atlassianId, attachment) {
  const pageId = contentId || sealRecord.contentId;
  const artifactName = attachment.title || sealRecord.attachmentName || "Unknown";

  console.warn(`[SEAL-DELETED] Sealed artifact ${artifactId} permanently deleted by ${atlassianId}`);

  // B13 (ordering fix): the final notice is BEST-EFFORT — a notification failure MUST NOT abort the
  // record purge below. Previously an unguarded throw here (e.g. postDocFootnote 4xx/5xx on a since-gone
  // page) skipped every kvs.delete, leaving protection-*/space-protection-*/edit-grant-* ORPHANED with
  // no retry — so the (now-deleted) attachment read as "still sealed" forever. Wrap it; always clean up.
  try {
    await sendViolationNotifications(sealRecord, artifactId, pageId, atlassianId, artifactName, "delete");
  } catch (e) {
    console.error("[SEAL-DELETED] final notice failed (continuing cleanup):", e);
  }

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
      // audit B3: cursor-paginate to exhaustion — a single limit(1000) getMany() left every
      // key past the first 1000 behind (incl. never-TTL'd workflow-log-* compliance history
      // and page snapshots) — a data-retention leak on any mature tenant.
      let query = kvs.query().limit(250);
      let iterations = 0;
      do {
        const { results, nextCursor } = await query.getMany();
        for (const { key } of results || []) await kvs.delete(key).catch(() => {});
        if (!nextCursor || ++iterations >= 400) break; // 400×250 = 100k keys, a runaway backstop
        query = kvs.query().limit(250).cursor(nextCursor);
      } while (true);
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

    // audit C1: cursor-paginate — a single limit(100) meant expiry + 50% notices were never
    // processed for seals beyond the first 100 instance-wide (a permanent blind spot).
    const activeSeals = [];
    {
      let sq = kvs.query().where("key", WhereConditions.beginsWith("protection-")).limit(100);
      let si = 0;
      do {
        const { results, nextCursor } = await sq.getMany();
        for (const e of results || []) activeSeals.push(e);
        if (!nextCursor || ++si >= 50) break;
        sq = kvs.query().where("key", WhereConditions.beginsWith("protection-")).limit(100).cursor(nextCursor);
      } while (true);
    }

    if (!activeSeals.length) {
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
          // audit C5: TTL the dedup flag so it can't accumulate forever nor suppress the
          // notice when the same attachment is re-sealed later (flag dies with the seal +7d).
          await kvs.set(dedupKey, {
            sentAt: now.toISOString(),
            attachmentId: artifactId,
          }, { expiresAt: expiresAt.getTime() + 7 * 86400000 });

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
              }, { expiresAt: expiresAt.getTime() + 7 * 86400000 }); // audit C5: die with the seal
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

    // audit C1: cursor-paginate — periodic reminders were never sent for seals beyond 100.
    const activeSeals = [];
    {
      let sq = kvs.query().where("key", WhereConditions.beginsWith("protection-")).limit(100);
      let si = 0;
      do {
        const { results, nextCursor } = await sq.getMany();
        for (const e of results || []) activeSeals.push(e);
        if (!nextCursor || ++si >= 50) break;
        sq = kvs.query().where("key", WhereConditions.beginsWith("protection-")).limit(100).cursor(nextCursor);
      } while (true);
    }

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

        // audit C5: TTL the nudge dedup flag to the seal's lifetime (+7d) so it neither
        // accumulates forever nor suppresses reminders when the attachment is re-sealed.
        const nudgeTtl = (value?.expiresAt ? new Date(value.expiresAt).getTime() : Date.now() + 365 * 86400000) + 7 * 86400000;
        await kvs.set(nudgeKey, {
          sentAt: now.toISOString(),
          reminderNumber: (priorNudgeData?.reminderNumber || 0) + 1,
        }, { expiresAt: nudgeTtl });

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

