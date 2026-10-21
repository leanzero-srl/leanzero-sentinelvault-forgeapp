import { asApp, route } from "@forge/api";
import { appConfluence, isRateLimited } from "./shared/confluence-call.js";
import { resolveAppAccountId } from "./shared/app-account.js";
import { hookVersionAuthor } from "./shared/hook-author.js"; // dev harness seam (inert outside the test hook)
import { pageMayCarrySeals, markGuardedPage, backfillGuardMarkers, healGuardMarkers, sealPageOf, reopenGuardBackfill } from "./shared/guarded-page.js"; // which pages carry a seal (KVS)
import { kvs, WhereConditions } from "@forge/kvs";

import {
  mailHalfwayReminder,
  mailExpiryNotice,
  mailLapseNotice,
  mailAutoReleaseNotice,
  mailEditorReverted,
} from "./infra/notice-composer.js";

import { recordDispatch, postDocFootnote, sweepWatchers } from "./capsules/bulletins/logic.js";
import { resolveBulletinToggles } from "./shared/bulletin-flags.js";
import { touchSealTimestamp, releaseSealContentPropIfLast } from "./capsules/sealing/logic.js";
import { releaseSeal } from "./capsules/sealing/release.js";
import { releaseSectionSeal } from "./capsules/section-seals/release.js"; // SEC-7 (d): the sweep hands lapsed sections back too
import { adoptInsertedSection, insertIntentKey } from "./capsules/section-seals/adopt.js"; // SEC-4 (a): seal on insert
import { refreshSectionContentProp } from "./capsules/section-seals/logic.js"; // SEC-4 (a): the macro badge reads the content property
import { getActiveEditGrant, sweepEditAccess, getActiveSectionEditGrant, sweepEditRequestIndex } from "./capsules/editreq/logic.js";
import {
  resolveEffectiveConfig,
  readValidationState,
  writeValidationState,
  getLastGoodVersion,
  setLastGoodVersion,
  wasVersionChecked,
  markVersionChecked,
} from "./capsules/validations/logic.js";
import { evaluateRules } from "./infra/rules-engine.js";
import { fetchPageLabelsChecked } from "./infra/labels.js";
import { rulesNeedLabels } from "./shared/rule-config.js";
import { rulesFingerprint } from "./capsules/validations/recheck.js";
import {
  autoAssignOnEvent, getSpaceWorkflowSettings, resolveWorkflowDef, findState, validateTransition, restampIfEnforced,
  transitionPageWorkflow, readPageWorkflow, purgePageWorkflow, mirrorStateLabel, readLabelStamp, clearStateLabel, restampApprovedVersion, fetchLivePageVersion,
} from "./capsules/workflow/logic.js";
import { applyAiVerdict, sweepApprovalIndex, clearPageApprovals } from "./capsules/workflow/approvals.js";
import { fetchPageStatuses } from "./shared/page-status.js";
import { postEnforceComment, buildWorkflowEnforcementDispatch } from "./infra/approval-blueprints.js";
import { postValidationComment } from "./infra/validation-blueprints.js";
import { readDocBody, readDocBodyAtVersion, writeDocBody, collectMediaFileIds, extractMediaSingleNodes, spliceMediaNodes, locateBodiedSectionNodes, spliceSectionWrapper, hashAdf, canonicalizeAdf, nonEmptySectionBody, adoptOrphanWrappers, summarizeAdfDiff, findUnrecordedWrappers, stampSectionId } from "./infra/doc-surgery.js";
import { panelRestoreVerdict, judgeRestoreWrite, deferRestoreCheck, RESTORE_RECHECK_PREFIX, RESTORE_RECHECK_MAX_TRIES } from "./shared/trash-rights.js";
import { probeAttachmentStatus, restoreAttachmentFromTrash, decideMediaRestoreAction, confirmAttachmentPurged, fileIdAtVersion } from "./infra/attachment-status.js";
import { findSealedMediaSingle, findAllSealedMediaSingles, capturePresentation, presentationDiffers, applyPresentation, presentationText } from "./infra/media-presentation.js";
import { setWithTtl, setUntil } from "./shared/kvs-ttl.js";
import { resolvePageSpaceKey, recordAuthority } from "./shared/content-access.js";
import { decideSectionRetry, nextRetryMarker, sectionRetryKey, SECTION_RETRY_PREFIX, SECTION_RETRY_TTL_MS, SECTION_RETRY_SWEEP_CAP } from "./shared/section-retry.js";
// F5 (owner feedback 2026-08-27): a lapsed seal gets a bounded run of reminders and is then
// released automatically. The decision is time-based, so it lives in a pure zero-import module
// that unit tests can hand clocks to rather than waiting three days for a live sweep.
import { decideLapseAction, resolveLapsePolicy, priorNoticeCount, lapseSubject, decideLapseDelivery } from "./shared/lapse-policy.js";
import { decideAnnounce, decideRelease, confirmClaim, decideClear } from "./shared/notice-dedup.js";
import { randomUUID } from "node:crypto";
// A1: the activity record. Written ONLY on a CONFIRMED outcome (after the successful page
// write / attachment restore / KVS purge), never on an attempt, and never between a dedup
// marker claim and the side effect that marker protects (T6). It never throws.
import { recordActivity } from "./infra/activity-log.js";
import { refreshByline } from "./capsules/page-details/byline.js"; // 5.0 byline chip — refreshed once per page save, after the restore passes
import { isWorkflowHeld, mayEditInside } from "./shared/seal-authority.js"; // SEC-2
import { isLiveAttachmentSeal, advancesSealedVersion } from "./shared/live-seal.js";
import { workflowPrivilegeForPage } from "./capsules/workflow/privilege.js";
import { approvedPageJudge, judgeVersionsAfter, highestSanctionedBelow, sanctionedRestampTarget, firstUnsanctionedAuthor } from "./capsules/workflow/sanctioned.js"; // which versions count
import { enforcementPlan, isEnforcedNow, eventPredatesBaseline, contentProtectionEnabled } from "./capsules/workflow/enforce-rules.js"; // 2026-10-16: one home per enforcement rule
import { restoredContentOf, reviewedVersionOf } from "./capsules/workflow/baseline.js";
import { withLegacySource } from "./capsules/workflow/baseline-read.js"; // review round 2 D1: pre-8.11.0 records // B2: a revert names the approved content, never an approver
import { errText, reasonText, safeKey } from "./shared/action-log.js";

// --- Fix 3 (CORE T6 extension): cross-run violation-comment dedup ---
// K1: `violation-noticed-{pageId}-{targetId}-{class}`, TTL 24h, claimed BEFORE the footer
// comment (the markVersionChecked pattern). Kills the incident-2026-07-22 spam loop: a stale
// editor draft re-publishing every few minutes re-ran the restore and re-posted an identical
// comment each time. The bulletin/dispatch record still fires PER OCCURRENCE (the console
// timeline stays truthful); only the page comment is deduped. A clean save (no violations)
// clears the markers so a genuinely NEW tamper comments afresh. KVS has no CAS — the tiny
// concurrent double-claim window is the same one T6 already accepts.
const VIOLATION_NOTICE_TTL_MS = 24 * 3600 * 1000;
// A5: an overdue page whose state cannot move to Expired is announced once per due date; the
// marker keeps the due date it announced, so a re-set date that passes again is announced again.
// The marker has NO TTL on purpose (A2/A5 review, finding 1): with a 7-day TTL a page whose state
// has no edge to Expired would be re-announced weekly forever. It is deleted when the page does
// expire, and cleared with the rest of the workflow keys when the page leaves the workflow.

// Hunt H2-F3: "delete" (trash handler) and "content-removal" (media pass) are one physical
// event — a UI delete of an embedded attachment fires BOTH trashed:attachment and updated:page.
// They share one marker class so a single delete can never yield two comments regardless of
// event ordering. Section classes (hunt H1-F4) close the incident spam loop on that surface.
const NOTICE_CLASS_ALIASES = { delete: "content-loss", "content-removal": "content-loss" };
const DEDUPED_NOTICE_CLASSES = ["content-loss", "revert-failed", "layout-changed", "section-removed", "section-edited"];
// Marker classes cleared by each surface's clean-save path (targetId spaces differ:
// attachmentId for media, sectionId for sections — never clear across the split).
// "content-removal"/"delete" are never claimed anymore (aliased to content-loss) but existing
// installs hold PERMANENT copies of those keys (the expiresAt TTL bug wrote them with no
// expiry) — the clean-save clear is the only reaper they have, so keep them in the clear list.
const MEDIA_NOTICE_CLASSES = ["content-loss", "revert-failed", "layout-changed", "content-removal", "delete"];
const SECTION_NOTICE_CLASSES = ["section-removed", "section-edited"];
function noticeMarkerKey(pageId, targetId, klass) {
  return `violation-noticed-${pageId}-${targetId}-${NOTICE_CLASS_ALIASES[klass] || klass}`;
}
// F2 (owner feedback 2026-08-27): the marker records WHICH outcome it stands for, so the
// "restored from the trash" message is no longer swallowed by its "page content reverted"
// sibling. The KEY is still the aliased class, so both share one 24h window; the OUTCOME is the
// raw verb, which is what actually differs in the comment the user reads. The decision itself is
// pure and lives in shared/notice-dedup.js with its tests.
// it69: KVS has no compare-and-swap, so the claim is check-then-act. The marker carries a
// per-outcome claim TOKEN: write, wait CLAIM_SETTLE_MS, re-read, and announce only if our own
// token still stands. Two deliveries that both read "no marker" now resolve to ONE speaker (the
// last writer); the other backs off without releasing anything. A marker that a sibling OUTCOME's
// writer clobbered in that window (the F2 delete/content-removal pair) is merged back once, so a
// materially different message is never lost to the token. The residual window is a claimer whose
// own get→set stalls longer than the settle interval — a KVS round-trip that slow is a platform
// incident, not a code path.
const CLAIM_SETTLE_MS = 400;
async function claimViolationNotice(pageId, targetId, klass) {
  const effective = NOTICE_CLASS_ALIASES[klass] || klass;
  if (!DEDUPED_NOTICE_CLASSES.includes(effective)) return true;
  const key = noticeMarkerKey(pageId, targetId, klass);
  try {
    const token = randomUUID();
    let existing = await kvs.get(key);
    const { announce, marker } = decideAnnounce(existing, klass, token);
    if (!announce) return false;
    await setWithTtl(key, { ...(existing || {}), at: new Date().toISOString(), ...marker }, VIOLATION_NOTICE_TTL_MS);
    for (let round = 0; round < 2; round++) {
      await new Promise((r) => setTimeout(r, CLAIM_SETTLE_MS));
      existing = await kvs.get(key);
      const verdict = confirmClaim(existing, klass, token);
      if (verdict === "held") return true;
      if (verdict === "lost") {
        console.warn(`[NOTICE-DEDUP] ${klass} on ${pageId}/${targetId}: a concurrent run holds the claim — staying silent`);
        return false;
      }
      // clobbered: merge our outcome back beside the sibling's and confirm once more
      const again = decideAnnounce(existing, klass, token);
      if (!again.announce) return false; // the sibling's write already carries our outcome
      await setWithTtl(key, { ...(existing || {}), at: new Date().toISOString(), ...again.marker }, VIOLATION_NOTICE_TTL_MS);
    }
    return true; // two merges and still unsettled: announce rather than lose the message
  } catch (e) {
    console.error("[NOTICE-DEDUP] marker claim failed — notifying anyway:", errText(e));
    return true; // marker infra failure must not suppress a real violation notice
  }
}
// Hunt H2-F4/H1-F5: a claimed marker whose comment did NOT post must be released — otherwise a
// transient post failure consumes the 24h window and the owner never hears about the tamper.
// Releases only the outcome THIS call claimed: dropping the whole key would also un-announce a
// sibling outcome that did post, and it would then post a second time.
async function releaseViolationNotice(pageId, targetId, klass) {
  const key = noticeMarkerKey(pageId, targetId, klass);
  try {
    const existing = await kvs.get(key);
    const { drop, marker } = decideRelease(existing, klass);
    if (drop) {
      await kvs.delete(key).catch(() => {});
      return;
    }
    await setWithTtl(key, { ...existing, ...marker }, VIOLATION_NOTICE_TTL_MS);
  } catch (_) {
    await kvs.delete(key).catch(() => {});
  }
}
async function clearViolationNotices(pageId, targetId, classes = MEDIA_NOTICE_CLASSES) {
  for (const klass of classes) {
    await kvs.delete(`violation-noticed-${pageId}-${targetId}-${klass}`).catch(() => {});
  }
}

// Hunt H1-F5 (claim ordering): claim the dedup marker ONLY when the comment channel is
// actually postable (both toggles on — postDocFootnote/dispatchNotice would silently skip
// otherwise, burning the marker with no comment), post, and release the marker when the post
// throws or reports failure. Best-effort: an undetectable failure (no return value) keeps the
// marker — the 24h TTL bounds the damage.
//
// 2026-09-17 (tester: "you save, 20 min later Sentinel deletes it and you never knew"): when the
// two-party violation comment is switched off (it is opt-in), the EDITOR still gets their own
// comment — what was undone, a link to the version holding their work, how to get access. It
// rides the SAME marker, so whichever of the two posts, there is one comment per outcome.
async function postDedupedFootnote(bulletinToggles, pageId, markerTargetId, markerClass, ownerAccountId, editorAccountId, artifactName, actionVerb, editorNotice = null) {
  const footnoteOn = !!(bulletinToggles?.ENABLE_CONFLUENCE_BULLETINS && bulletinToggles?.ENABLE_NATIVE_NOTIFICATIONS);
  const editorOnly = !footnoteOn && bulletinToggles?.NOTIFY_EDITOR_ON_REVERT === true
    && !!editorAccountId && editorAccountId !== ownerAccountId && actionVerb !== "permanently-deleted"
    // Nothing was undone when a restore FAILED: the editor's "your change was undone" notice would be false.
    && actionVerb !== "revert-failed" && actionVerb !== "section-restore-failed";
  if (!footnoteOn && !editorOnly) return;
  if (!(await claimViolationNotice(pageId, markerTargetId, markerClass))) return;
  let posted = false;
  try {
    const res = footnoteOn
      ? await postDocFootnote(pageId, ownerAccountId, editorAccountId, artifactName, actionVerb)
      : await mailEditorReverted(editorAccountId, ownerAccountId, artifactName, pageId, {
        targetKind: editorNotice?.targetKind || "attachment", actionVerb, revertedVersion: editorNotice?.revertedVersion || null,
      });
    posted = !(res && res.success === false);
  } catch (e) {
    console.error(`[NOTICE-DEDUP] footer comment failed (${markerClass}) — releasing marker:`, errText(e));
  }
  if (!posted) await releaseViolationNotice(pageId, markerTargetId, markerClass);
}

// --- Helpers ---

// resolveAppAccountId: shared/app-account.js (one home; the baseline rules need it too).

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

    console.warn(`[TRIGGER] ${eventType} for ${artifactId} actor=${atlassianId ? "set" : "none"}`);

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

    // S7: trashedOnly TRACKING records are NOT seals — they must never trigger edit-revert or
    // trash-restore (vet finding: a panel-deleted unsealed attachment would get un-deleted).
    // Permanent delete still cleans the dangling record up — silently (handleSealedArtifactDeleted
    // posts no notice for a stub: it was never a seal).
    if (sealRecord.trashedOnly && eventType !== "avi:confluence:deleted:attachment") {
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
    console.error("Error in artifact event trigger:", errText(error));
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
  // SEC-4 (a): a failed adoption's per-version claim, released after the page write. Declared out here so a
  // throw between the adopt pass and that release (a network error on the PUT, a KVS error) releases it too.
  let adoptClaimToRelease = null;
  try {
    const { atlassianId, content } = event;
    const pageId = content?.id;
    // Delivery instrument (2026-09-15): one line per invocation, whatever happens next — the
    // only way to tell "event never arrived" from "arrived and exited silently" in forge logs.
    console.info(`[PAGE-EVENT] ${event?.eventType || "?"} page=${pageId} v=${content?.version?.number ?? "?"} actor=${atlassianId ? "set" : "none"}`);

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
    const contentProtectionOn = contentProtectionEnabled(globalPolicy);

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
      ? await collectWorkflowEnforcementForPage(pageId, atlassianId, content?.version?.number, systemAccountId, event?.space?.key || content?.space?.key || null)
      : null;
    const needsRevert = enforcement?.action === "revert";

    // SEC-4 (a): a Sealed Section macro was inserted on this page and not yet sealed — read the
    // body to adopt it (the one case a page with no seal costs an ADF read).
    const insertIntent = contentProtectionOn ? await kvs.get(insertIntentKey(pageId)).catch(() => null) : null;
    const hasBodyWork = sealFileMap.length > 0 || sectionSeals.length > 0 || needsRevert || !!insertIntent;

    // --- Single read -> passes -> single write, with shared 409 backoff ---
    const MAX_RETRIES = 3;
    const notifyMap = new Map();
    // Fix 1: attachment-layer resolutions for the media pass, cached ACROSS 409 retries so a
    // retry never re-probes, re-restores, re-cleans or re-notifies the same attachment.
    const mediaProbeCache = new Map();
    let anyChange = false;
    let writtenVersion = null; // #44: the version an app write actually produced (§2.5)
    let enforceReverted = false; // #44: a Pass-0 revert actually wrote (for the SV-M2 notice)
    let enforceRevertVersion = null;
    let enforceRevertContent = null; // B2: { contentOf, editedIn } of what Pass 0 restored, judged on the record it read
    let enforceObservedEqual = false; // #44: the revert pass CONFIRMED content-equality (no write needed)
    let enforceObservedContent = null; // what that equal version holds when it is a later sanctioned one ({ contentOf, editedIn })
    let sectionChanged = false; // GAP 2: the last attempt's section pass had a restore pending
    const adoptedSections = []; // SEC-4 (a): wrappers this run sealed on publish (record written, id stamped)
    let adoptComplete = false; // SEC-4 (a): the adopt pass ran and left no wrapper unadopted (the insert marker may go)
    let sealPassesSkipped = false; // a late event met a newer version by someone else (see below)
    let enforceStoodDown = false; // 8.12.0: Pass 0 could not judge who edited in between (no write, no new baseline)
    let enforceLiveCounts = null; // Pass 0 found the live version itself sanctioned: { version, cause }

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
          // it69: who saved the version this run is judging. The app's own restore is never a
          // "clean save" that re-arms the comment (decideClear).
          readAuthorId: hookVersionAuthor(pageId, pageData.version?.number) || pageData.version?.authorId || null, // hook-author.js: dev harness seam, null outside it
          appAccountId: systemAccountId,
          changed: false,
          enforcedRevert: false, // #44: set by Pass 0 to short-circuit A/B + suppress SV-M5
          notifications: [],
          // Fix 6: presentation-seal enforcement is ON by default (owner decision: STRICT —
          // sealing an image also seals its on-page presentation). Rollout is inherently
          // bounded: only seals created after this ship carry a mediaBaseline; legacy seals
          // are skipped. The flag remains an explicit opt-out. Shadow+strict were both
          // live-verified (drift detection exact; revert to baseline; one deduped comment).
          enforceMediaAttrs: globalPolicy?.enforceMediaPresentation !== false,
          // SEC-2: on an Approved page the WORKFLOW's privileged set (approver snapshot ∩ live, or a
          // steward) is the set that edits inside a held seal; the section pass reads this.
          workflowPrivileged: enforcement?.action === "privileged",
        };
      } catch (err) {
        console.error("[PAGE-PROTECT] Failed to read page body:", errText(err));
        break;
      }

      // A LATE event (2026-10-16): the passes below judge the LIVE body but take the editor from the
      // event. When the live version is newer than the event's and someone else saved it, the event's
      // author would be credited with that person's edit — a seal owner's late event re-baselined a
      // non-owner's change inside the owner's sealed section, and the newer save's own event then
      // found nothing to restore (test/section-late-event.test.mjs). The event is judged only for the
      // version it describes: the seal passes stand down and the newer version is judged by its own
      // event, the view guard or the five-minute page-guard sweep, all with its real author. Pass 0
      // compares versions, not people, and still runs.
      const eventVersion = content?.version?.number;
      const lateForLiveBody = typeof eventVersion === "number" && typeof ctx.currentVersion === "number"
        && ctx.currentVersion > eventVersion && !!ctx.readAuthorId && ctx.readAuthorId !== atlassianId;
      // "unknown" (who may edit an Approved page could not be judged): the seal passes stand down too,
      // so the app writes nothing that would carry this version's other changes into the page; the
      // sweeps judge it again.
      let judgeLater = lateForLiveBody || enforcement?.action === "unknown";
      if (judgeLater) sealPassesSkipped = true;
      // Pass 0 (#44): enforced-state whole-page revert — runs FIRST, short-circuits A/B (who-wins).
      if (enforcement?.action === "revert") {
        try { await enforceApprovedStatePass(ctx, enforcement); }
        catch (e) { console.error("[WORKFLOW-ENFORCE] pass error:", errText(e)); ctx.enforceStoodDown = true; } // a failed pass judges nothing either
        // 8.12.0 (review 2026-10-18): Pass 0 STOOD DOWN (who may have edited between the baseline and
        // now could not be judged, e.g. Confluence answered 429). Judge nothing else either: a section
        // or media restore would write a version carrying the unjudged edit, and that write would then
        // become the approved baseline. Exactly as for "unknown"; the sweeps judge it again.
        if (ctx.enforceStoodDown) { judgeLater = true; sealPassesSkipped = true; enforceStoodDown = true; }
        // The live version counts (an approver's or steward's save, or the app's on top of one): the
        // live body is not this event's editor's, so the seal passes do not judge it either; the
        // reconciliation moves the baseline to it.
        if (ctx.enforceLiveCounts) { judgeLater = true; sealPassesSkipped = true; enforceLiveCounts = ctx.enforceLiveCounts; }
      }
      // Pass A: sealed-section restore (suppressed while enforcing — who-wins + SV-M5 suppression)
      if (!ctx.enforcedRevert && !judgeLater && sectionSeals.length > 0) {
        try { await restoreSealedSectionsPass(ctx, sectionSeals, mediaProbeCache); }
        catch (e) { console.error("[PAGE-PROTECT] section pass error:", errText(e)); }
      }
      // GAP 2 (req 2.3): remember whether the SECTION pass wants a write — Pass 0 skips A, and B
      // runs after, so at this point ctx.changed is the section pass's verdict alone. Read after
      // the loop to decide the retry marker when no attempt confirmed a write.
      sectionChanged = !ctx.enforcedRevert && ctx.changed;
      // Pass A2 (SEC-4 (a)): a Sealed Section wrapper with no record — inserted in the editor and
      // published — is sealed to the person who published it. Not while an enforce-revert is
      // rewriting the body (the wrapper may not survive it); the insert marker stays and the next publish adopts it then.
      if (!ctx.enforcedRevert && !judgeLater && (insertIntent || sectionSeals.length > 0)) {
        try { adoptComplete = await adoptInsertedSectionsPass(ctx, sectionSeals, adoptedSections, enforcement); }
        catch (e) { adoptComplete = false; console.error("[SECTION-ADOPT] pass error:", errText(e)); }
        if (ctx.adoptClaimToRelease) adoptClaimToRelease = ctx.adoptClaimToRelease;
      }
      // Pass B: sealed-media restore
      if (!ctx.enforcedRevert && !judgeLater && sealFileMap.length > 0) {
        try { await restoreMediaPass(ctx, sealFileMap, mediaProbeCache); }
        catch (e) { console.error("[PAGE-PROTECT] media pass error:", errText(e)); }
      }
      // Pass C (Phase 4): validation enforcement — slots in here.

      // Rebuild the notify set from THIS attempt only (vet F3: a 409'd attempt's entries must
      // not survive into the dispatch — attempt 2's recompute may legitimately drop a seal to
      // the revert-failed branch, and dispatching the stale attempt-1 "reverted" claim beside
      // it is a false statement). Only the attempt that actually WRITES is dispatched (SV-M2),
      // and on success we break immediately, so last-attempt-wins is exactly right.
      notifyMap.clear();
      for (const n of ctx.notifications) {
        notifyMap.set(`${n.type}:${n.targetId || ""}`, n);
      }
      // #44: capture a CONFIRMED-equality observation (revert pass found the body already
      // equal to the baseline) so §2.5 can advance the baseline ONLY on genuine equality,
      // never on an abort/failed-write path (which must leave approvedVersion untouched).
      if (ctx.enforceObservedEqual) { enforceObservedEqual = true; enforceObservedContent = ctx.enforceObservedContent || null; }

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
        if (ctx.enforcedRevert) { enforceReverted = true; enforceRevertVersion = ctx.enforceRevertTo; enforceRevertContent = ctx.enforceRevertContent || null; }
        break;
      }
      if (putRes.status === 409) {
        const delay = Math.pow(2, attempt) * 500;
        console.warn(`[PAGE-PROTECT] Version conflict, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      console.error(`[PAGE-PROTECT] Failed to patch page: ${putRes.status}`);
      break;
    }

    // GAP 2 (req 2.3): every attempt 409'd/errored with a section restore pending → the tamper is
    // still on the page. Leave a marker so the hourly sweep retries; clear it on a clean run.
    if (sectionSeals.length > 0 && !sealPassesSkipped) { // a skipped late event says nothing about the live body
      try {
        if (decideSectionRetry({ sectionChanged, anyChange })) {
          const prev = await kvs.get(sectionRetryKey(pageId));
          const marker = nextRetryMarker(prev, pageId, new Date().toISOString());
          await setWithTtl(sectionRetryKey(pageId), marker, SECTION_RETRY_TTL_MS);
          console.warn(`[SECTION-RETRY] page ${pageId}: restore not written after ${MAX_RETRIES} attempts — marker set (attempt ${marker.attempts})`);
        } else {
          await kvs.delete(sectionRetryKey(pageId)); // a confirmed write or a clean pass: nothing pending
        }
      } catch (e) { console.error("[SECTION-RETRY] marker update failed:", errText(e)); }
    }

    // SV-M2: only notify after a CONFIRMED write. If every attempt 409'd or errored
    // (anyChange false), the content is still tampered — don't tell the owner it was
    // "restored/reverted".
    if (anyChange) {
      for (const n of notifyMap.values()) {
        try { await dispatchPipelineNotification(n, writtenVersion); }
        catch (e) { console.error("[PAGE-PROTECT] notify error:", errText(e)); }
      }
      await touchSealTimestamp();
    }

    // SEC-4 (a): the adopted wrappers' ids are on the page now (or the write failed and the next
    // run re-adopts by title/hash through adoptOrphanWrappers); either way the marker is consumed.
    if (adoptedSections.length) {
      try {
        await refreshSectionContentProp(pageId);
        if (anyChange) await restampIfEnforced(pageId); // #44 §2.7: an enforced baseline stays seal-complete
        await touchSealTimestamp();
        console.warn(`[SECTION-ADOPT] page ${pageId}: sealed on publish ${adoptedSections.map((a) => a.sectionId).join(", ")}`);
      } catch (e) { console.error("[SECTION-ADOPT] post-write:", errText(e)); }
    }
    // The insert marker goes only when every inserted wrapper was adopted: a skipped late event, a run that
    // did not adopt (not privileged, claimed elsewhere) or a failed adoption keeps it for the next publish.
    if (insertIntent && !sealPassesSkipped && adoptComplete) await kvs.delete(insertIntentKey(pageId)).catch(() => {});
    // A failed adoption's claim goes only now, after the write stamped the wrappers that did adopt: the
    // next run (the guard, the late event, the next publish) can then adopt the one that failed.
    if (adoptClaimToRelease) { await kvs.delete(adoptClaimToRelease).catch(() => {}); adoptClaimToRelease = null; }
    await refreshByline(pageId).catch((e) => console.warn("[BYLINE] trigger refresh failed:", errText(e)));

    // #44: the enforce-revert notice — only after a CONFIRMED write (SV-M2).
    if (anyChange && enforceReverted) {
      // B2 (2026-10-18): what the editor got back is the CONTENT of the version restored — after an
      // earlier revert the baseline is the app's copy (v9 holds approved v7), so "restored the
      // approved version (v9)" named a copy. The row, the comment and the banner pill name the
      // approved content; the row keeps restoredTo (the version written back) for the audit.
      const restoredContent = enforceRevertContent?.contentOf ?? enforceRevertVersion ?? null;
      const reviewedVersion = reviewedVersionOf(enforcement?.record) ?? null;
      // A1: same confirmation bar as the notice — the revert is a fact at writtenVersion.
      await recordActivity({
        type: "workflow.enforced",
        pageId,
        spaceKey: enforcement?.spaceKey || enforcement?.record?.spaceKey || null,
        actor: null,
        target: { kind: "page", id: pageId, name: null },
        details: {
          mode: "revert", editor: atlassianId || null, approvedVersion: enforceRevertVersion ?? null, restoredTo: enforceRevertVersion ?? null, restoredContent, reviewedVersion,
          // 2026-10-21: the space moves edited pages back, but this workflow could not (the code says why).
          ...(enforcement?.demoteFallback ? { demoteFallback: enforcement.demoteFallback } : {}),
        },
        version: writtenVersion,
      });
      // The version holding the editor's text is the one the app's write replaced (as the seal path
      // computes it: writtenVersion − 1).
      await announceWorkflowEnforcement({
        pageId, mode: "revert", editorAccountId: atlassianId, record: enforcement?.record || null,
        approvedVersion: restoredContent, revertedVersion: writtenVersion ? writtenVersion - 1 : null, via: "event",
        demoteFallback: enforcement?.demoteFallback || null,
      });
    }

    // --- #44 reconciliation (§2.5): keep approvedVersion == the last version the app or
    // a privileged actor actually produced (never a pre-pass guess). Forward-only. ---
    try {
      if (enforcement && enforcement.action !== "demote" && enforcement.action !== "unknown" && !enforceStoodDown) {
        let newBaseline = null;
        let cause = null; // B2: why the baseline moves (baseline.js) — never an approver for the app's write
        if (anyChange && writtenVersion && (enforceReverted || enforcement.action === "privileged")) {
          newBaseline = writtenVersion; // app wrote (revert, or a seal restore on a privileged edit)
          // A privileged save the app saved again (seals restored): the edit is the editor's version, never the app's.
          cause = enforceReverted ? { kind: "restored", from: enforceRevertVersion, ...(enforceRevertContent || {}) }
            // The version the app read and saved again (writtenVersion = the read version + 1), never the event's:
            // a later save by the same editor may be what was read (review round 2 D3).
            : { kind: "edit", editedIn: writtenVersion - 1 };
        } else if (anyChange && writtenVersion) {
          // Any other write (a seal restore while the event was judged "predates-approval"): the app's
          // version carries the body it read, so it moves the baseline only to versions that count
          // (sanctioned.js); could not tell: no move.
          const fresh = await readPageWorkflow(pageId);
          const t = fresh?.enforce ? await sanctionedRestampTarget(pageId, fresh, { appAccountId: systemAccountId }) : { known: false };
          if (t.known && t.version > (fresh.approvedVersion ?? 0)) newBaseline = t.version;
        } else if (enforcement.action === "privileged") {
          newBaseline = content?.version?.number || (await fetchLivePageVersion(pageId)); // editor's live version
          cause = { kind: "edit" };
        } else if (enforcement.action === "revert" && enforceLiveCounts) {
          newBaseline = enforceLiveCounts.version; // the live version counts (Pass 0): kept, and it is the new baseline
          cause = enforceLiveCounts.cause;
        } else if (enforcement.action === "revert" && enforceObservedEqual) {
          cause = { kind: "unchanged", ...(enforceObservedContent || {}) };
          // ONLY when the pass CONFIRMED the body already equals the baseline (no write
          // needed) do we advance to live. On any abort/failed-write path the body is
          // still the un-reverted tamper — do NOT launder it into approvedVersion; leave
          // the baseline at V0 so the hourly sweep re-attempts (fail-closed).
          newBaseline = await fetchLivePageVersion(pageId);
        }
        if (newBaseline) await restampApprovedVersion(pageId, newBaseline, cause).catch(() => {});
      }
    } catch (e) {
      console.error("[WORKFLOW-ENFORCE] reconciliation error:", errText(e));
    }

    // --- Conditions & Validations phase (independent of seals) ---
    try {
      await runValidationPhase(event, pageId, atlassianId);
    } catch (e) {
      console.error("[VALIDATE] phase error:", errText(e));
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
      console.error("[WORKFLOW] auto-assign phase error:", errText(e));
    }
    // What this run did to the page's workflow state, for the callers that run the pipeline
    // themselves (guardPageNow, the hook): a demote writes no page version, so without this the
    // banner that asked had no way to know the page left Approved (2026-10-16). Forge ignores the
    // return value of the event trigger.
    return { workflowAction: enforcement?.action || null, demoted: enforcement?.action === "demote" && enforcement.applied === true, adopted: adoptedSections.length };
  } catch (error) {
    console.error("[PAGE-PROTECT] Error in page content trigger:", errText(error));
    if (adoptClaimToRelease) await kvs.delete(adoptClaimToRelease).catch(() => {});
  }
  return { workflowAction: null, demoted: false };
}

// --- Pipeline: gather media seals applicable to a page (cheap, no ADF read) ---
async function collectMediaSealsForPage(pageId) {
  // Fast path: does this page carry a seal? The app's own KVS marker answers (shared/guarded-page.js),
  // never a page property an editor can delete.
  if (!(await pageMayCarrySeals(pageId))) return [];

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
      if (entry.value?.contentId === pageId && entry.value?.lockedBy) {
        // S7 (vet finding): trashedOnly TRACKING records are NOT seals — enforcing one here
        // would UN-DELETE a deliberately panel-deleted unsealed attachment.
        if (entry.value?.trashedOnly) continue;
        // Expired seals are inert on the media pass too (§6 parity with sections and the
        // edit/trash handlers) — a dead seal must not keep reverting page edits.
        const exp = entry.value?.expiresAt;
        if (exp && new Date(exp).getTime() <= Date.now()) continue;
        pageSeals.push(entry);
      }
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
        const attRes = await appConfluence(
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
// Fix 1 (incident 2026-07-22): the ADF layer and the attachment layer are now UNIFIED.
// Before re-splicing a sealed media node, the pass probes the attachment itself:
//   current  → splice (the pre-fix path)
//   trashed  → restore the attachment from trash FIRST, then splice — the old code re-inserted
//              a node pointing at a trashed file, which renders NOTHING while the comment
//              claimed "reverted" (the owner had to un-trash it by hand on 07-22)
//   deleted  → never splice a dead node; run the permanent-delete cleanup + honest notice
//   unknown  → splice (fail toward the pre-fix behavior)
// Resolutions are cached in `probeCache` across 409 retries (no re-probe/re-restore/re-notify).
// Hunt F2b/F4: an authorized actor (owner or active grantee) removed their own sealed embed —
// the seal stays live on the FILE but stops expecting on-page presence. Hunt F5: merge onto a
// FRESH read (this can race the attachment trigger's grant re-baseline); this path owns only
// embedded + mediaBaseline. Mutates the in-memory seal too so later passes/retries see it.
async function rebaselineSealNotEmbedded(seal, who) {
  if (!seal.attachmentId) return;
  try {
    // Never resurrect: `|| seal` used to re-create a seal released while this save was in flight.
    const fresh = await kvs.get(`protection-${seal.attachmentId}`);
    if (!isLiveAttachmentSeal(fresh)) return;
    await kvs.set(`protection-${seal.attachmentId}`, { ...fresh, embedded: false, mediaBaseline: null });
    seal.embedded = false;
    seal.mediaBaseline = null;
    await touchSealTimestamp(); // S5
    console.warn(`[PAGE-PROTECT] ${who} removed their own sealed embed ${seal.attachmentId} — re-baselined seal to embedded:false (future absence is sanctioned)`);
  } catch (e) {
    console.error(`[PAGE-PROTECT] not-embedded re-baseline failed for ${seal.attachmentId}:`, errText(e));
  }
}

/** Exported for test/trash-rights.test.mjs only (the attachment-layer triage of a page save). */
export async function restoreMediaPass(ctx, sealFileMap, probeCache = new Map()) {
  if (ctx.enforcedRevert) return; // #44: an enforce revert already replaced the whole body
  const presentFileIds = collectMediaFileIds(ctx.adfDoc);

  // --- Fix 6: STRICT presentation seal (attrs) — for sealed media still PRESENT on the page.
  // Protect-list comparison only (layout/width/widthType + media width/height) → immune to
  // editor attr-regen noise; legacy seals without a baseline are skipped. SHADOW mode (log,
  // no write) unless the global `enforceMediaPresentation` flag is true — flip after soak.
  let attrViolations = 0;
  for (const { seal, fileId } of sealFileMap) {
    if (!presentFileIds.has(fileId) || !seal.mediaBaseline) continue;
    try {
      // Hunt F7: check EVERY copy of the sealed embed — copy-paste duplicates share the fileId,
      // and the old first-match-only scan let a resized second copy stand while reporting clean.
      const nodes = findAllSealedMediaSingles(ctx.adfDoc, fileId);
      if (nodes.length === 0) continue;
      const differing = nodes.filter((n) => presentationDiffers(seal.mediaBaseline, capturePresentation(n)));
      if (differing.length === 0) continue;
      const isOwner = seal.lockedBy === ctx.atlassianId;
      const grant = isOwner ? null : await getActiveEditGrant(seal.attachmentId, ctx.atlassianId);
      if (isOwner || grant) {
        // Authorized presentation change → re-baseline the seal to the new look (the FIRST
        // copy is canonical). Hunt F5: merge onto a FRESH read of the record — the attachment
        // trigger's grant re-baseline can race this write; patch only mediaBaseline here.
        const current = capturePresentation(nodes[0]);
        // Never resurrect: `|| seal` used to re-create a seal released while this save was in flight.
        const fresh = await kvs.get(`protection-${seal.attachmentId}`);
        if (!isLiveAttachmentSeal(fresh)) continue;
        await kvs.set(`protection-${seal.attachmentId}`, { ...fresh, mediaBaseline: current });
        seal.mediaBaseline = current;
        await touchSealTimestamp(); // hunt H2-F5: S5 — every seal mutation touches the stamp
        console.warn(`[MEDIA-ATTRS] re-baselined sealed ${seal.attachmentId} presentation (authorized ${isOwner ? "owner" : "grantee"} change)`);
        continue;
      }
      attrViolations++;
      if (!ctx.enforceMediaAttrs) {
        console.warn(`[MEDIA-ATTRS] SHADOW: presentation drift on sealed ${seal.attachmentId} (${differing.length} cop${differing.length === 1 ? "y" : "ies"}): ${presentationText(seal.mediaBaseline)} -> ${presentationText(capturePresentation(differing[0]))} (not enforcing)`);
        continue;
      }
      let mutated = false;
      for (const n of differing) {
        if (applyPresentation(n, seal.mediaBaseline)) mutated = true;
      }
      if (mutated) {
        ctx.changed = true;
        console.warn(`[MEDIA-ATTRS] restored sealed presentation of ${seal.attachmentId} on ${differing.length} cop${differing.length === 1 ? "y" : "ies"} (non-owner change)`);
        ctx.notifications.push({
          type: "layout-changed",
          targetId: seal.attachmentId,
          seal,
          actor: ctx.atlassianId,
          pageId: ctx.pageId,
          artifactName: seal.attachmentName || "Unknown Attachment",
        });
      }
    } catch (e) {
      console.error(`[MEDIA-ATTRS] attr check failed for ${seal.attachmentId} (skipping):`, errText(e));
    }
  }

  // Hunt F2b: an OWNER removing their own sealed embed is sanctioned — record it on the seal
  // (embedded:false, baseline dropped) BEFORE the violations filter, otherwise the next
  // non-owner save sees "absent", re-splices the owner's deliberate removal and blames a
  // bystander. Runs before the filter so the very save that removed the embed re-baselines.
  for (const { seal, fileId } of sealFileMap) {
    if (presentFileIds.has(fileId) || seal.lockedBy !== ctx.atlassianId) continue;
    if (seal.embedded === false) continue; // already recorded as not-embedded
    await rebaselineSealNotEmbedded(seal, "owner");
  }

  // Hunt F1: absence is tamper evidence ONLY for seals that were actually embedded.
  // embedded === false (captured at seal time, or re-baselined above) → the sealed file is
  // attached-not-embedded and its absence from the body is its normal state, not a violation.
  // Legacy seals (no field) keep the lookback but degrade to a silent skip on exhaustion below.
  const violations = [];
  for (const entry of sealFileMap) {
    const { seal, fileId } = entry;
    if (presentFileIds.has(fileId) || seal.lockedBy === ctx.atlassianId) continue;
    if (seal.embedded === false) continue;
    // Hunt F4 (G2): an ACTIVE edit grant makes the grantee's removal authoritative — treat it
    // like the owner case (re-baseline, no restore, no accusation). Grant lookups only happen
    // for seals that would otherwise be violations (cost-bounded).
    const grant = seal.attachmentId ? await getActiveEditGrant(seal.attachmentId, ctx.atlassianId) : null;
    if (grant) {
      await rebaselineSealNotEmbedded(seal, "grantee");
      continue;
    }
    violations.push(entry);
  }
  if (violations.length > 0) probeCache.set("__saw-violations", true);
  if (violations.length === 0) {
    // Fix 3: a clean save clears the comment-dedup markers — the NEXT tamper on this page is
    // a genuinely new incident and must produce a fresh comment. "Clean" means NO violation of
    // ANY kind: a save with an ATTR-only violation must NOT clear the layout-changed marker
    // the previous run just claimed (found in-suite: two rapid resizes → run B cleared run A's
    // marker before dispatching its own comment → double comment). AND the run itself must
    // never have seen a violation: an at-least-once DUPLICATE delivery that loses the 409 race
    // re-reads the sibling's restored body, judges it "clean", and would clear the marker the
    // winner just claimed (observed live — twin invocations 400ms apart on one tamper).
    // it69: ...and the body judged clean must be a USER's save — a late/duplicate delivery that
    // reads the app's own restore (version.authorId == app) is looking at the fix, not at a
    // clean save, and would otherwise release the window its sibling just claimed (SECURITY-TODO
    // race 1, observed ~1 run in 3). Pure rule: shared/notice-dedup.js decideClear.
    const clearOk = decideClear({ sawViolations: !!probeCache.get("__saw-violations"), readAuthorId: ctx.readAuthorId, appAccountId: ctx.appAccountId });
    if (attrViolations === 0 && !clearOk && ctx.readAuthorId && ctx.readAuthorId === ctx.appAccountId) {
      console.log(`[NOTICE-DEDUP] v${ctx.currentVersion} of ${ctx.pageId} is the app's own restore — dedup markers kept (late/duplicate delivery)`);
    }
    if (attrViolations === 0 && clearOk) {
      for (const { seal } of sealFileMap) {
        if (seal.attachmentId) await clearViolationNotices(ctx.pageId, seal.attachmentId);
      }
    }
    return;
  }

  // --- Attachment-layer triage (Fix 1) ---
  const MAX_PROBES = 15; // bound REST cost on pathological pages; overflow → "unknown" → splice
  // Hunt F8: purge corroboration is the expensive step (settle delay + 2 probes, serialized) —
  // cap it per trigger run or a multi-purge sweep blows the 25s Forge budget mid-triage. The
  // counter lives in probeCache so 409 retries share it (the "__" key can't collide with an
  // attachment id). Beyond the cap a 404 is treated as NOT confirmed → "hold" (nothing done);
  // a later event finishes the job.
  const MAX_PURGE_CONFIRMS = 3;
  const confirmPurgedBudgeted = async (attId, pageId) => {
    const used = probeCache.get("__purge-confirms") || 0;
    if (used >= MAX_PURGE_CONFIRMS) {
      console.warn(`[PAGE-PROTECT] purge-confirmation budget exhausted for ${attId} — treating as NOT confirmed`);
      return false;
    }
    probeCache.set("__purge-confirms", used + 1);
    return confirmAttachmentPurged(attId, undefined, { pageId });
  };
  let probesUsed = 0;
  const spliceable = []; // violations whose attachment renders (current, restored, or unknown)
  for (const violation of violations) {
    const attId = violation.seal.attachmentId;
    let resolution = attId ? probeCache.get(attId) : null;
    if (!resolution) {
      let probe = { status: "unknown", version: null };
      let budgetSkipped = true;
      if (attId && probesUsed < MAX_PROBES) {
        probesUsed++;
        budgetSkipped = false;
        probe = await probeAttachmentStatus(attId);
      }
      resolution = { action: decideMediaRestoreAction(probe.status), probe, notified: false };
      if (resolution.action === "cleanup") {
        // Vet F1 (lens 3): a SINGLE 404 must never license the destructive branch — a
        // trash-propagation window or container visibility can 404 a live attachment.
        // Corroborate on the file's container after a settle delay; unconfirmed → hold.
        // A 404 that cannot be proven a purge (no positive witness on the file's current page) is
        // left alone: no restore attempt, no notice, the seal kept. A trashed file answers 200, so
        // this never skips a restore the seal owes; the deleted:attachment event and the sweeps
        // finish a real purge.
        const purged = await confirmPurgedBudgeted(attId, ctx.pageId || violation.seal.contentId);
        if (!purged) resolution.action = "hold";
      }
      if (resolution.action === "restore-splice") {
        const r = await restoreAttachmentFromTrash({
          attachmentId: attId,
          pageId: ctx.pageId,
          title: violation.seal.attachmentName,
          currentVersion: probe.version,
        });
        if (r.ok) {
          console.warn(`[PAGE-PROTECT] Un-trashed sealed attachment ${attId} before re-splice`);
          resolution.action = "splice";
        } else if (r.status === "deleted") {
          resolution.action = (await confirmPurgedBudgeted(attId, ctx.pageId || violation.seal.contentId)) ? "cleanup" : "hold";
        } else {
          resolution.action = "restore-failed";
        }
      }
      // Cache only real, keyed resolutions: a falsy attId would collide under one key, and a
      // budget-skipped "unknown" would freeze splice-forever across retries for no reason.
      if (attId && !budgetSkipped) probeCache.set(attId, resolution);
    }

    if (resolution.action === "cleanup") {
      if (!resolution.notified) {
        resolution.notified = true;
        // Attachment permanently gone (double-confirmed): S3 cleanup (purges the seal triad +
        // honest "cannot be restored" notice). Direct call — there is no page write to ride.
        // Vet F4: actor is NULL — the current page editor did not perform the purge; the
        // notice must state the fact without accusing whoever happened to edit the page.
        try {
          await handleSealedArtifactDeleted(
            violation.seal, attId, ctx.pageId, null,
            { title: violation.seal.attachmentName || "Unknown Attachment" },
          );
        } catch (e) { console.error("[PAGE-PROTECT] cleanup for deleted attachment failed:", errText(e)); }
      }
      continue;
    }
    if (resolution.action === "hold") continue; // unproven purge: nothing done, nothing said, seal kept
    if (resolution.action === "restore-failed") {
      if (!resolution.notified) {
        resolution.notified = true;
        // Attachment still in trash and the un-trash failed: keep the seal (audit C4),
        // never splice a dead node, tell the owner honestly.
        console.error(`[PAGE-PROTECT] Sealed attachment ${attId} is in trash and could not be restored — notifying owner`);
        await notifyAttachmentRevertFailed(
          violation.seal, attId, ctx.pageId, ctx.atlassianId,
          violation.seal.attachmentName || "Unknown Attachment",
        ).catch(() => {});
      }
      continue;
    }
    spliceable.push(violation);
  }
  if (spliceable.length === 0) return;

  if (!ctx.currentVersion || ctx.currentVersion < 2) {
    console.warn("[PAGE-PROTECT] Cannot revert media — page has no previous version");
    return;
  }

  const violatedFileIds = new Set(spliceable.map(({ fileId }) => fileId));
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

  if (restoredEntries.length > 0) {
    spliceMediaNodes(ctx.adfDoc, restoredEntries);
    ctx.changed = true;
    console.warn(
      `[PAGE-PROTECT] Re-inserted ${restoredEntries.length} sealed media block(s) into page ${ctx.pageId}`,
    );
  }

  for (const { seal, fileId } of spliceable) {
    if (!stillNeeded.has(fileId)) {
      // This seal's media WAS found and re-spliced — the "reverted" claim is true for it.
      // (Pre-fix code notified for EVERY violation whenever ANY entry was restored — an
      // overclaim for the ones the lookback never found.)
      ctx.notifications.push({
        type: "content-removal",
        targetId: seal.attachmentId,
        seal,
        actor: ctx.atlassianId,
        pageId: ctx.pageId,
        artifactName: seal.attachmentName || "Unknown Attachment",
      });
    } else if (seal.embedded === true) {
      // Fix 4: MAX_LOOKBACK exhausted — the embed location is lost (the attachment itself is
      // fine). Loud + honest instead of the old silent skip; keep the seal; once per run.
      // Hunt F1: the loud notice fires ONLY for seals PROVEN embedded at seal time — for a
      // legacy seal absence may just mean "attached, never embedded" (see the branch below).
      // Hunt F11: a budget-skipped probe has no cached resolution — synthesize one locally so
      // the notice isn't silently dropped; the "__notified-" sentinel (collision-free with
      // attachment-id keys) stops a 409 retry from double-dispatching.
      const resolution = probeCache.get(seal.attachmentId)
        || { notified: probeCache.get(`__notified-${seal.attachmentId}`) === true };
      if (!resolution.notified) {
        resolution.notified = true;
        probeCache.set(`__notified-${seal.attachmentId}`, true);
        console.warn(`[PAGE-PROTECT] Could not find sealed media ${seal.attachmentId} within ${MAX_LOOKBACK} prior versions — notifying owner (embed location lost)`);
        await notifyAttachmentRevertFailed(
          seal, seal.attachmentId, ctx.pageId, ctx.atlassianId,
          seal.attachmentName || "Unknown Attachment",
        ).catch(() => {});
      }
    } else {
      // Hunt F1: legacy seal (no `embedded` field) with the lookback exhausted — pre-campaign
      // SILENT skip. Without proof the file was ever embedded, "could NOT restore / was
      // modified" would be a false public accusation of whoever happened to edit the page
      // (the most common seal shape: a sealed file that is merely attached).
      console.warn(`[PAGE-PROTECT] Sealed media ${seal.attachmentId} absent and not in ${MAX_LOOKBACK} prior versions; seal carries no embed evidence — skipping silently (legacy/attached-only seal)`);
    }
  }
}

// --- Pipeline: dispatch a single accumulated notification ---
// A1: this runs ONLY after the single page write succeeded (SV-M2 gates the caller on
// anyChange), so the notifications list IS the set of confirmed restore outcomes — the passes
// themselves cannot know whether their splice ever landed. The activity entry is written
// FIRST: sendViolationNotifications claims a dedup marker before its comment, and the record
// must not sit between that claim and its side effect (T6).
const PIPELINE_ACTIVITY_TYPE = {
  "content-removal": "seal.embed-restored",
  "layout-changed": "seal.presentation-restored",
};
async function dispatchPipelineNotification(n, writtenVersion = null) {
  const seal = n.seal || {};
  if (n.type === "section-revert") {
    await recordActivity({
      type: n.kind === "removed" ? "section.restored" : "section.reverted",
      pageId: n.pageId,
      spaceKey: seal.spaceKey || null,
      actor: n.actor ? { accountId: n.actor, name: null } : null,
      target: { kind: "section", id: seal.sectionId || n.targetId, name: seal.sectionTitle || "Sealed section" },
      details: { kind: n.kind, ownerAccountId: seal.lockedBy || null },
      version: writtenVersion,
    });
  } else if (PIPELINE_ACTIVITY_TYPE[n.type]) {
    await recordActivity({
      type: PIPELINE_ACTIVITY_TYPE[n.type],
      pageId: n.pageId,
      spaceKey: seal.spaceKey || null,
      actor: n.actor ? { accountId: n.actor, name: null } : null,
      target: { kind: "attachment", id: seal.attachmentId || n.targetId, name: n.artifactName || seal.attachmentName || null },
      details: { ownerAccountId: seal.lockedBy || null },
      version: writtenVersion,
    });
  }
  if (n.type === "content-removal") {
    await sendViolationNotifications(
      n.seal, n.seal.attachmentId, n.pageId, n.actor, n.artifactName, "content-removal", writtenVersion ? writtenVersion - 1 : null,
    );
  } else if (n.type === "layout-changed") {
    // Fix 6: sealed presentation restored (deduped like content-removal).
    await sendViolationNotifications(
      n.seal, n.seal.attachmentId, n.pageId, n.actor, n.artifactName, "layout-changed", writtenVersion ? writtenVersion - 1 : null,
    );
  } else if (n.type === "section-revert") {
    await sendSectionViolationNotifications(n.seal, n.pageId, n.actor, n.kind, writtenVersion ? writtenVersion - 1 : null);
  }
}

// --- Pipeline: gather section seals applicable to a page (cheap, no ADF read) ---
async function collectSectionSealsForPage(pageId) {
  // Fast path: does this page carry a seal? The app's own KVS marker (shared/guarded-page.js).
  if (!(await pageMayCarrySeals(pageId))) return [];

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

// Part 3.5: a re-baseline (the owner's or a grantee's edit becoming the new sealed body) is a
// fact in the trail, with a compact diff of what changed — never the body. Recorded AFTER the
// snapshot write (the re-baseline is confirmed by then); the page version is the one being
// judged, which is the version that carries the edit.
async function recordSectionRebaseline(ctx, seal, by, prevBody, newBody) {
  let diff = null;
  try { diff = summarizeAdfDiff(prevBody, newBody); } catch (_) { diff = null; }
  await recordActivity({
    type: "section.rebaselined",
    pageId: ctx.pageId,
    spaceKey: seal.spaceKey || null,
    actor: { accountId: ctx.atlassianId || null, name: by === "owner" ? (seal.lockedByName || null) : null },
    target: { kind: "section", id: seal.sectionId, name: seal.sectionTitle || "Sealed section" },
    details: { by, ownerAccountId: seal.lockedBy || null, diff },
    version: ctx.currentVersion || null,
  });
}

// SEC-4 (a): adopt every Sealed Section wrapper that has no record. The owner is the person who
// published the version being judged (ctx.atlassianId) — the inserter, in the case this exists
// for. On an ENFORCED page only the privileged set may add a sealed section this way (anyone
// else's publish is being demoted / reverted by the workflow anyway); the wrapper is left as it
// is and adopted on the next privileged publish. Mutates the nodes (id stamped) → ctx.changed.
// Returns true when no wrapper is left unadopted (the insert marker may then be consumed); false when
// one was left for a later publish (not privileged here, claimed by another run, or a failed adoption).
// A failed adoption sets ctx.adoptClaimToRelease: the caller releases that claim AFTER its page write
// (success or not), never before — the wrappers that did adopt are only stamped by that write, and a
// same-version run in between must still find the claim.
async function adoptInsertedSectionsPass(ctx, sectionSeals, adopted, enforcement) {
  const candidates = findUnrecordedWrappers(ctx.adfDoc, sectionSeals.map((s) => s.sectionId));
  if (!candidates.length) return true;
  if (enforcement && enforcement.action !== "privileged" && enforcement.action !== null) return false;
  if (!ctx.atlassianId) return false;
  // The publish's event and the view-time guard can judge the SAME version within seconds of each
  // other (a page opened right after publish); without a claim both would mint a record for one
  // wrapper. One claim per (page, version) — the first judge adopts, the other finds the claim.
  const claimKey = `section-adopt-claim-${ctx.pageId}-v${ctx.currentVersion || 0}`;
  if (await kvs.get(claimKey).catch(() => null)) { console.info(`[SECTION-ADOPT] page ${ctx.pageId} v${ctx.currentVersion}: already claimed by another run`); return false; }
  await setWithTtl(claimKey, { at: new Date().toISOString(), by: ctx.atlassianId }, 10 * 60_000);
  let spaceKey = ctx.pageData?.spaceKey || null;
  if (!spaceKey) { try { spaceKey = await resolvePageSpaceKey(ctx.pageId); } catch (_) { spaceKey = null; } }
  let all = true;
  for (const c of candidates) {
    try {
      const { sectionId, record } = await adoptInsertedSection({
        pageId: ctx.pageId, spaceKey, spaceId: ctx.pageData?.spaceId || null, pageTitle: ctx.pageData?.title || null,
        node: c.node, originalIndex: c.originalIndex, ownerAccountId: ctx.atlassianId, version: (ctx.currentVersion || 0) + 1,
      });
      stampSectionId(c.node, sectionId);
      ctx.changed = true;
      adopted.push({ sectionId, sectionTitle: record.sectionTitle });
    } catch (e) { all = false; console.error("[SECTION-ADOPT] adopt failed:", errText(e)); }
  }
  if (!all) ctx.adoptClaimToRelease = claimKey;
  return all;
}

async function restoreSealedSectionsPass(ctx, sectionSeals, probeCache = new Map()) {
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

  const knownSectionIds = sectionSeals.map((s) => s.sectionId);
  for (const seal of sectionSeals) {
    // GAP 1 (req 2.3): no wrapper carries this seal's id, but the macro may still be on the page
    // with its guestParams.sectionId stripped (editor copy/paste, REST). Without this the pass
    // splices the snapshot back AND leaves that copy behind as an unprotected duplicate that
    // survives every save. Adopt a lone candidate (matched by heading title or body hash) so the
    // normal owner / grant / compare / restore logic below runs on it; two candidates are
    // ambiguous and are removed so the snapshot splice is the only copy left. Expired seals are
    // inert here as everywhere else. A re-stamp is a body change, so it must be written.
    if (!(wrappersById.get(seal.sectionId) || []).length
      && !(seal.expiresAt && new Date(seal.expiresAt).getTime() <= now)) {
      try {
        const snap = await kvs.get(`section-snapshot-${seal.sectionId}`);
        const { adopted, removed } = adoptOrphanWrappers(ctx.adfDoc, {
          sectionId: seal.sectionId, sectionTitle: seal.sectionTitle,
          snapshotHash: snap?.hash || seal.contentHash || null, knownSectionIds,
        });
        if (adopted || removed) {
          ctx.changed = true;
          console.warn(`[SECTION] Orphaned wrapper(s) for ${seal.sectionId}: adopted ${adopted}, removed ${removed}`);
          if (adopted) {
            const found = locateBodiedSectionNodes(ctx.adfDoc).filter((w) => w.sectionId === seal.sectionId);
            if (found.length) wrappersById.set(seal.sectionId, found);
          }
        }
      } catch (e) { console.error("[SECTION] orphan adoption failed:", errText(e)); }
    }
    // Owner edits their own sealed section freely — but RE-BASELINE the snapshot (SV-M5),
    // otherwise a later unrelated non-owner save sees the stale hash and reverts the owner's
    // own edit, destroying it and falsely blaming the non-owner.
    // SEC-2: a held seal's "owner" for this pass is the workflow's privileged set (the personal
    // owner and every grantee are outside it unless they are approvers); a personal seal keeps its
    // owner. shared/seal-authority.js mayEditInside is the ONE rule.
    const heldByWorkflow = isWorkflowHeld(seal);
    const editorIsOwner = mayEditInside({ seal, actorId: ctx.atlassianId, isOwner: seal.lockedBy === ctx.atlassianId, hasGrant: false, workflowPrivileged: ctx.workflowPrivileged });
    if (editorIsOwner) {
      const ownWrap = (wrappersById.get(seal.sectionId) || [])[0];
      if (ownWrap) {
        const ownHash = hashAdf(ownWrap.node.content);
        // A record without contentHash compares with the snapshot's hash, so the owner's edit always
        // becomes the new sealed body.
        const prevSnap = await kvs.get(`section-snapshot-${seal.sectionId}`).catch(() => null);
        const sealedHash = seal.contentHash || prevSnap?.hash || null;
        if (ownHash !== sealedHash) {
          try {
            const newBody = JSON.parse(JSON.stringify(ownWrap.node.content || []));
            await kvs.set(`section-protection-${seal.sectionId}`, { ...seal, contentHash: ownHash });
            await kvs.set(`section-snapshot-${seal.sectionId}`, {
              wrapperNode: JSON.parse(JSON.stringify(ownWrap.node)),
              bodyContent: newBody, hash: ownHash, version: null, originalIndex: ownWrap.originalIndex,
            });
            await touchSealTimestamp(); // hunt H2-F5: S5 — every seal mutation touches the stamp
            console.warn(`[SECTION] Owner re-baselined section ${seal.sectionId}`);
            await recordSectionRebaseline(ctx, seal, heldByWorkflow && seal.lockedBy !== ctx.atlassianId ? "approver" : "owner", prevSnap?.bodyContent, newBody);
          } catch (e) { console.error("[SECTION] owner re-baseline failed:", errText(e)); }
        }
      }
      continue;
    }
    // Expired seals are inert (full auto-unseal handled by the expiry sweep).
    if (seal.expiresAt && new Date(seal.expiresAt).getTime() <= now) continue;

    const wrapperList = wrappersById.get(seal.sectionId) || [];
    const snapshot = await kvs.get(`section-snapshot-${seal.sectionId}`);
    // The sealed body this pass compares against and restores: the snapshot, or — when it
    // is missing (a lost write, a partial restore or import) — recovered from the page's own history
    // (recoverSectionBaseline). null = nothing trustworthy: fail CLOSED (no hash-only "untouched",
    // no restore from an unverified version), flag the seal and tell its owner.
    const base = Array.isArray(snapshot?.bodyContent)
      ? { body: snapshot.bodyContent, wrapperNode: snapshot.wrapperNode || null, originalIndex: snapshot.originalIndex, source: "snapshot" }
      : await recoverSectionBaseline(ctx, seal, probeCache);
    if (base && !seal.contentHash) {
      // A record that lost its hash gets it back from the body it is checked against (no restore churn).
      try { const r = await kvs.get(`section-protection-${seal.sectionId}`); if (r && !r.contentHash) await kvs.set(`section-protection-${seal.sectionId}`, { ...r, contentHash: hashAdf(base.body) }); } catch (_) { /* best effort */ }
    }

    if (wrapperList.length === 0) {
      // The entire sealed-section macro was deleted/cut — re-insert the SEALED wrapper.
      let restoreNode = base?.wrapperNode ? JSON.parse(JSON.stringify(base.wrapperNode)) : null;
      // SV-m6: position the restore by ANCHORING to the section's preceding heading (read from
      // the previous version) rather than the FROZEN seal-time originalIndex, which drops the
      // wrapper in the wrong place when blocks shifted above it since sealing.
      let originalIndex = typeof base?.originalIndex === "number"
        ? base.originalIndex
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
      // The previous version gives the POSITION and, at most, the wrapper's shell: its body is
      // whatever that version held (an unjudged edit included), so the sealed body always comes from
      // `base`. No base: nothing trustworthy to put back.
      if (!restoreNode && base && prevNode) restoreNode = { ...JSON.parse(JSON.stringify(prevNode)), content: nonEmptySectionBody(JSON.parse(JSON.stringify(base.body))) };
      const finalNode = restoreNode;
      if (!finalNode) {
        console.warn(`[SECTION] Cannot restore removed section ${seal.sectionId} — no trustworthy sealed copy`);
        await flagBrokenSectionSeal(ctx, seal, { tampered: true, probeCache });
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
    // SV-M7 / 2026-10-21: a matching 32-bit hash is never proof on its own — every copy is confirmed
    // STRUCTURALLY against the sealed body. The hash (of that body, not the record's field, so a
    // record whose hash drifted does not restore on every save) is only the fast negative.
    const baseHash = base ? hashAdf(base.body) : null;
    const baseCanon = base ? JSON.stringify(canonicalizeAdf(base.body)) : null;
    const isUntouched = (node) => !!base && hashAdf(node.content) === baseHash && JSON.stringify(canonicalizeAdf(node.content)) === baseCanon;
    const changedWrappers = wrapperList.filter((w) => !isUntouched(w.node));
    if (changedWrappers.length > 0) probeCache.set("__saw-violations", true);
    if (changedWrappers.length === 0) {
      // Hunt H1-F4: a clean save for THIS section clears its comment-dedup markers (mirror of
      // the media clean-save clear) so the next genuine tamper comments afresh.
      // SV-m3: ...and it must be a REAL mirror. The media clear also requires that THIS RUN never
      // saw a violation; without that, an at-least-once duplicate that loses the 409 race re-reads
      // the sibling's restored section, finds changedWrappers empty, and deletes the marker the
      // winner just claimed — costing the 24h suppression window, so the NEXT occurrence comments
      // when it should have been swallowed. Found 2026-08-27 while fact-checking the write-up of
      // the media-surface fix: the comment above claimed "mirror" while missing the guard.
      // it69: same clear rule as the media surface — a user's clean save, never the app's restore.
      if (decideClear({ sawViolations: !!probeCache.get("__saw-violations"), readAuthorId: ctx.readAuthorId, appAccountId: ctx.appAccountId })) {
        await clearViolationNotices(ctx.pageId, seal.sectionId, SECTION_NOTICE_CLASSES);
      }
      continue; // every copy matches the seal — untouched
    }

    // Approved section editor (Edit Requests) — allow the edit and re-baseline from the edited copy.
    // SEC-2: grants are FROZEN while the workflow holds the seal — a grantee is outside the approver set.
    const sectionGrant = heldByWorkflow ? null : await getActiveSectionEditGrant(seal.sectionId, ctx.atlassianId);
    if (sectionGrant) {
      try {
        const edited = changedWrappers[0];
        const newBody = JSON.parse(JSON.stringify(edited.node.content || []));
        const newHash = hashAdf(newBody);
        const prevBody = base?.body; // read above, before the snapshot is overwritten
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
        await touchSealTimestamp(); // hunt H2-F5: S5 — same stamp duty as the owner re-baseline
        console.warn(`[SECTION] Allowed approved edit of section ${seal.sectionId} — re-baselined (${changedWrappers.length} cop${changedWrappers.length === 1 ? "y" : "ies"})`);
        await recordSectionRebaseline(ctx, seal, "grantee", prevBody, newBody);
      } catch (e) { console.error("[SECTION] re-baseline failed:", errText(e)); }
      continue;
    }

    // Body edited by a non-authorized user — restore the sealed body into EVERY differing copy,
    // mutating the exact nodes we inspected (no first-vs-last desync).
    if (base) {
      // it40 (R3-F5): an empty-baseline snapshot ([]) is truthy, so guard it — restoring
      // content:[] is invalid ADF that 400s the whole-page PUT, dropping EVERY sibling
      // section's restore on this page. nonEmptySectionBody → one empty paragraph.
      for (const w of changedWrappers) {
        w.node.content = nonEmptySectionBody(JSON.parse(JSON.stringify(base.body)));
      }
      ctx.changed = true;
      ctx.notifications.push({
        type: "section-revert", targetId: seal.sectionId,
        seal, actor: ctx.atlassianId, pageId: ctx.pageId, kind: "body-edited",
      });
    } else {
      // Nothing trustworthy to compare with or restore from. Nothing is written — no invented content, no restore loop — the seal is
      // flagged and its owner told. A copy that still carries the record's hash may be untouched, so
      // it is reported once, not on every save.
      const looksUnchanged = !!seal.contentHash && wrapperList.every((w) => hashAdf(w.node.content) === seal.contentHash);
      console.warn(`[SECTION] Section ${seal.sectionId}: no trustworthy sealed copy — ${looksUnchanged ? "cannot verify it" : "edit cannot be restored"}; seal flagged`);
      await flagBrokenSectionSeal(ctx, seal, { tampered: !looksUnchanged, probeCache });
    }
  }
}

// 2026-10-21: a section seal whose snapshot is missing gets its sealed body back from the page's own
// history, in this order, and only from a version the APP or the seal's OWNER saved (the people whose
// saves make the sealed body — never a version anyone else wrote, which is what is being judged):
//   1. the version written at sealing (record.sealedVersion: the app's wrap or adoption write), its
//      section matching the record's contentHash when the record has one;
//   2. the newest earlier version (at most SECTION_RECOVERY_LOOKBACK back, never re-reading versions an
//      earlier run already checked) whose section matches the record's contentHash.
// A hit rebuilds the snapshot (the next save costs nothing). Reads that fail count as no hit.
const SECTION_RECOVERY_LOOKBACK = 10;
async function recoverSectionBaseline(ctx, seal, probeCache = new Map()) {
  const cacheKey = `__section-base-${seal.sectionId}`;
  if (probeCache.has(cacheKey)) return probeCache.get(cacheKey);
  const trusted = new Set([ctx.appAccountId, seal.lockedBy].filter(Boolean));
  const cur = typeof ctx.currentVersion === "number" ? ctx.currentVersion : 0;
  const tryVersion = async (n, needHash) => {
    try {
      const { pageData, adfDoc } = await readDocBodyAtVersion(ctx.pageId, n);
      if (!trusted.has(pageData?.version?.authorId || null)) return null;
      const w = locateBodiedSectionNodes(adfDoc).find((x) => x.sectionId === seal.sectionId);
      if (!w || !Array.isArray(w.node?.content)) return null;
      const h = hashAdf(w.node.content);
      if (seal.contentHash ? h !== seal.contentHash : needHash) return null;
      return { body: JSON.parse(JSON.stringify(w.node.content)), wrapperNode: JSON.parse(JSON.stringify(w.node)), originalIndex: w.originalIndex, hash: h, version: n, source: "history" };
    } catch (_) { return null; }
  };
  const checkedThrough = typeof seal.broken?.checkedVersion === "number" ? seal.broken.checkedVersion : 0;
  let found = null;
  const sv = seal.sealedVersion;
  if (typeof sv === "number" && sv >= 1 && sv <= cur && sv > checkedThrough) found = await tryVersion(sv, false);
  if (!found && seal.contentHash) {
    for (let n = cur - 1; n >= Math.max(1, cur - SECTION_RECOVERY_LOOKBACK, checkedThrough + 1); n--) {
      if (n === sv) continue;
      found = await tryVersion(n, true);
      if (found) break;
    }
  }
  if (found) {
    try {
      await kvs.set(`section-snapshot-${seal.sectionId}`, { wrapperNode: found.wrapperNode, bodyContent: found.body, hash: found.hash, version: found.version, originalIndex: found.originalIndex, recovered: true });
      const r = await kvs.get(`section-protection-${seal.sectionId}`);
      if (r?.broken) { const { broken: _b, ...rest } = r; await kvs.set(`section-protection-${seal.sectionId}`, rest); }
      console.warn(`[SECTION] snapshot of ${seal.sectionId} was missing — rebuilt from page v${found.version}`);
    } catch (e) { console.error("[SECTION] snapshot rebuild failed:", errText(e)); }
  }
  probeCache.set(cacheKey, found);
  return found;
}

// The section's sealed copy is gone and nothing trustworthy could replace it: flag the seal
// (`broken` on the record, with the last version checked so later runs read only newer versions) and
// tell its owner through the existing "could not restore" paths — the activity row (space admins see
// it in the space's report), the banner dispatch and the deduped page comment. Once per run; a copy
// that may be untouched is reported only when first flagged.
const BROKEN_SEAL_REASON = "snapshot-missing";
async function flagBrokenSectionSeal(ctx, seal, { tampered, probeCache = new Map() }) {
  const onceKey = `__section-broken-${seal.sectionId}`;
  if (probeCache.has(onceKey)) return;
  probeCache.set(onceKey, true);
  if (tampered) probeCache.set("__saw-violations", true);
  let firstTime = true;
  try {
    const r = await kvs.get(`section-protection-${seal.sectionId}`);
    if (!r) return;
    firstTime = !r.broken;
    const checkedVersion = Math.max(0, (ctx.currentVersion || 1) - 1);
    const broken = { since: r.broken?.since || new Date().toISOString(), reason: BROKEN_SEAL_REASON, checkedVersion };
    await kvs.set(`section-protection-${seal.sectionId}`, { ...r, broken });
  } catch (e) { console.error("[SECTION] could not flag the seal:", errText(e)); }
  if (!tampered && !firstTime) return;
  const title = seal.sectionTitle || "a sealed section";
  const actor = ctx.atlassianId && ctx.atlassianId !== ctx.appAccountId ? ctx.atlassianId : null;
  await recordActivity({
    type: "section.restore-failed",
    pageId: ctx.pageId,
    spaceKey: seal.spaceKey || null,
    actor: actor ? { accountId: actor, name: null } : null,
    target: { kind: "section", id: seal.sectionId, name: title },
    details: { ownerAccountId: seal.lockedBy || null, reason: BROKEN_SEAL_REASON, changed: !!tampered },
    version: ctx.currentVersion || null,
  });
  try {
    await recordDispatch({
      id: `revert-failed-${Date.now()}`,
      type: "revert-failed",
      sectionId: seal.sectionId,
      attachmentName: title,
      ownerAccountId: seal.lockedBy,
      editorAccountId: actor,
      timestamp: Date.now(),
      pageId: ctx.pageId,
    });
  } catch (_) { /* best-effort */ }
  try {
    const bulletinToggles = await resolveBulletinToggles();
    await postDedupedFootnote(bulletinToggles, ctx.pageId, seal.sectionId, "revert-failed", seal.lockedBy, actor, title, "section-restore-failed");
  } catch (_) { /* best-effort */ }
}

// ============================================================================
// #44 — Enforced Approved state (revert-on-tamper). See F44-DESIGN.md in the skill.
// ============================================================================

// Probe (§2.1): decides whether an enforced page needs a revert, is a privileged edit, or should be
// demoted (done inline). NO ADF read. The KVS record is the authority (one get); the page property
// `sentinel-vault-workflow` mirrors it for CQL and is never read here — an editor can delete it.
export async function collectWorkflowEnforcementForPage(pageId, atlassianId, eventVersion, systemAccountId, liveSpaceKey = null) {
  // 1. The record. Unreadable: "unknown" — nothing is demoted, undone or accepted this run (the seal
  //    passes stand down too), and the sweeps judge the version again. Never "not protected".
  let record;
  try { record = await readPageWorkflow(pageId); } catch (_) { return { action: "unknown", record: null }; }
  if (!record?.enforce) return null;
  // Where the page is now (the event names it: no lookup) against the space the record was made in
  // (content-access.js recordAuthority). A page that MOVED keeps the protection it was approved
  // under: the old space's definition no longer describes a space the page is in, so a change there
  // (Approved no longer locking) does not switch it off. Unknown — Confluence could not be asked —
  // is judged as enforced, and below it never demotes or undoes anything (see "unknown").
  const auth = await recordAuthority({ contentId: pageId, storedKey: record.spaceKey || null, liveKey: liveSpaceKey });
  const def = await resolveWorkflowDef(record.spaceKey, record.workflowId);
  // 2026-10-21: a record whose state the definition no longer knows (a definition or backup written
  // past the "state still has pages" check) is judged as enforced too — it was enforced when the
  // definition last knew it, and enforcementPlan reverts it (no state to move back from).
  if (!isEnforcedNow(record, def, auth)) return null;
  // 3. Privileged? snapshot ∩ live-config approvers, OR live steward (§0.D/§0.E).
  //    If live group-expansion FAILED (outage), trust the snapshot rather than reverting a
  //    real approver's edit — revocation is only honored when expansion actually succeeds.
  // workflow/sanctioned.js approvedPageJudge is the ONE rule. The approver arm needs no space lookup,
  // so it answers first (an outage never costs an approver); reconciliation (§2.5) then advances the
  // baseline. Where the page is could not be read, or a steward check a 429 left open (8.12.0:
  // Confluence's rate limit is not an answer — reverting an admin's edit because Confluence was busy
  // was the outage of 2026-10-18): "unknown" demotes and undoes nothing, advances no baseline, and is
  // not privileged inside held seals or for adopting new wrappers; the page-guard and hourly sweeps
  // judge the version again. A steward = of the space the page is in NOW and, if it moved, of the
  // record's (recordAuthority).
  const judgeOf = await approvedPageJudge(record, { spaces: auth.known ? auth.spaces : null });
  const settings = judgeOf.settings;
  const who = await judgeOf.judge(atlassianId);
  if (who.privileged) return { action: "privileged", record };
  if (who.unknown) return { action: "unknown", record };

  // 3b. A late event for a version the approval already covers (the requester's own last save
  //     before the approval, delivered ~10 min after it — or the guard judging that version on the
  //     first view after the approval) is not an edit to the Approved page. Revert mode was safe by
  //     accident (Pass 0 compares the LIVE version); demote mode acted on the event alone and sent a
  //     freshly approved page back to Draft. Checked AFTER the privileged test so an approver's or
  //     steward's late event keeps its "privileged" answer for the seal passes, exactly as before;
  //     for everyone else the answer is "predates-approval": no enforcement, and — like the old
  //     demote/revert answers — not privileged inside held seals and no adoption of new wrappers.
  if (eventPredatesBaseline(eventVersion, record.approvedVersion)) return { action: "predates-approval", record };

  // 4. Not privileged -> revert (opt-in) or demote (default) — the mode the space admin chose, with
  //    or without named approvers (enforce-rules.js enforceModeOf says why the old CL-5 downgrade went).
  // A moved page is always reverted: the old space's settings (its mode, its demote target and the
  // definition's edges) are not the new space's, and a body revert depends on none of them.
  // A demote this workflow cannot make (no transition to the target, the target is itself an enforce
  // state — enforcementPlan / state-machine.js planDemote) is a REVERT through Pass 0, and the
  // activity row and the editor's notice say why.
  const plan = enforcementPlan(settings, { moved: auth.moved, def, stateId: record.stateId });
  const revertInstead = (demoteFallback) => ({ action: "revert", record, spaceKey: record.spaceKey, stewardSpaces: auth.spaces, ...(demoteFallback ? { demoteFallback } : {}) });
  if (plan.mode === "revert") {
    if (plan.fallback) console.warn(`[WORKFLOW-ENFORCE] ${pageId}: the demote cannot be made in this workflow (${plan.fallback.code}); reverting instead`);
    return revertInstead(plan.fallback?.code || null);
  }

  // DEMOTE inline (§2.6) — no body write, no ADF read, no ping-pong surface.
  // A2: the target is the space's configured `demoteTo` when this page can reach it, else the first
  // state (planDemote, the ONE rule this path, the sweep, the saves and the Workflow tab share).
  const target = plan.target;
  try {
    const res = await transitionPageWorkflow({
      activity: false, // the workflow.enforced row below is the record of this event (A1 review F5)
      pageId, spaceKey: record.spaceKey, toStateId: target.id,
      actorAccountId: systemAccountId, actorName: "Sentinel Vault",
      reason: `auto-demoted to ${target.name || target.id}: edited by non-approver while Approved`,
    });
    if (res.success) {
      // A1: the demotion transition persisted — enforcement happened (mode demote).
      await recordActivity({
        type: "workflow.enforced",
        pageId,
        spaceKey: record.spaceKey || null,
        actor: null,
        target: { kind: "page", id: pageId, name: null },
        details: {
          mode: "demote", editor: atlassianId || null, approvedVersion: record.approvedVersion ?? null, reviewedVersion: reviewedVersionOf(record), restoredTo: null,
          demotedTo: target.id, demotedToName: target.name || target.id,
          driftedVersion: typeof eventVersion === "number" ? eventVersion : null, via: "event",
        },
        version: typeof eventVersion === "number" ? eventVersion : null,
      });
      await announceWorkflowEnforcement({ pageId, mode: "demote", editorAccountId: atlassianId, record, approvedVersion: reviewedVersionOf(record), demotedToName: target.name || target.id, via: "event" });
      // `applied`: the state really moved — the guard tells the banner to refresh on it.
      return { action: "demote", applied: true };
    }
    // Refused after the plan said yes (the definition or the page's state changed in between): the
    // revert, never a silent no-op. Pass 0 re-reads the record and does nothing if the page already
    // left the enforce state (e.g. a duplicate delivery demoted it first).
    console.error(`[WORKFLOW-ENFORCE] demote of ${pageId} did not apply (${reasonText(res.reason)}); reverting instead`);
  } catch (e) { console.error("[WORKFLOW-ENFORCE] demote error; reverting instead:", errText(e)); }
  return revertInstead("transition-refused");
}

// WF-2 (UX critique 2026-09-19): the ONE place a workflow enforcement is announced to the person it
// happened to — a dispatch (the ribbon's pill, editor + approver as parties) AND the editor's comment
// (editor_revert carve-out). Every enforcement site (event demote, event revert, sweep demote, sweep
// revert) goes through here; the activity row stays at the site because its facts differ per path.
async function announceWorkflowEnforcement({ pageId, mode, editorAccountId, record, approvedVersion, revertedVersion, demotedToName, via, comment = true, demoteFallback = null }) {
  const approverAccountId = record?.approvalRecord?.completedBy || record?.enteredBy || null;
  // B2: approvedVersion here is what came back (the restored content); reviewedVersion the version that
  // was approved — the pill and the comment name both when they differ (baseline.js restoredLabel).
  const reviewedVersion = reviewedVersionOf(record);
  try {
    await recordDispatch(buildWorkflowEnforcementDispatch({ pageId, mode, editorAccountId, approverAccountId, approvedVersion, reviewedVersion, revertedVersion, demotedToName, via }));
  } catch (e) { console.error("[WORKFLOW-ENFORCE] dispatch failed:", errText(e)); }
  if (comment && editorAccountId) {
    await postEnforceComment(pageId, editorAccountId, mode === "revert" ? "revert" : "demote", { approvedVersion, reviewedVersion, revertedVersion, demotedToName, demoteFallback: !!demoteFallback }).catch(() => {});
  }
}

// B2 (review 2026-10-18 #2): does version `a` of the page carry the same body as version `b`? Used only
// where the sweep finds an app-authored version beyond the baseline. A failed read answers false.
async function sameBodyAsVersion(pageId, a, b) {
  try {
    if (!(typeof a === "number" && typeof b === "number")) return false;
    const [{ adfDoc: x }, { adfDoc: y }] = await Promise.all([readDocBodyAtVersion(pageId, a), readDocBodyAtVersion(pageId, b)]);
    if (!x?.content || !y?.content) return false;
    return hashAdf(x) === hashAdf(y) && JSON.stringify(canonicalizeAdf(x.content)) === JSON.stringify(canonicalizeAdf(y.content));
  } catch (_) { return false; }
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

  // #6 (TOCTOU): sanctioned saves may sit after the baseline (a privileged actor's edit whose
  // reconciliation hasn't advanced approvedVersion yet), and the LIVE version is one of the candidates:
  // the event may be older than the live version. The target is the highest version in (av, cur] that
  // counts (workflow/sanctioned.js). When that is the live version itself, nothing is reverted and the
  // baseline moves to it; otherwise the page goes back to that version (av when none counts). The
  // walk is skipped only when the live version is the event's own and the probe already judged its
  // author (one version past the baseline, saved by the person this event is about).
  const liveJudged = cur - av === 1 && !!ctx.readAuthorId && ctx.readAuthorId === ctx.atlassianId;
  const targetV = liveJudged ? av : await highestSanctionedVersion(ctx.pageId, rec, av, cur, enf?.stewardSpaces);
  if (targetV == null) { ctx.enforceStoodDown = true; return; } // who may edit could not be judged: no revert, no other write, this run
  if (targetV === cur) {
    // The live version counts: keep it, and move the baseline to it (the reconciliation below).
    ctx.enforceLiveCounts = { version: cur, cause: ctx.readAuthorId && ctx.readAuthorId !== ctx.appAccountId ? { kind: "edit" } : null };
    return;
  }

  let approvedAdf = null;
  try { ({ adfDoc: approvedAdf } = await readDocBodyAtVersion(ctx.pageId, targetV)); } catch (_) { approvedAdf = null; }
  // CL-1: never let an empty/unreadable baseline blank the page, and STAND DOWN: with no revert this
  // run, no other pass writes either (any write would carry the unapproved edit) and the baseline
  // stays. The hourly sweep tries the revert again.
  if (!approvedAdf?.content?.length) {
    console.error(`[WORKFLOW-ENFORCE] approved v${targetV} body empty/unreadable for ${ctx.pageId} — aborting revert, standing down`);
    ctx.enforceStoodDown = true;
    return;
  }
  // CL-7: hash match is not proof (32-bit FNV) — confirm canonical structures too.
  if (hashAdf(ctx.adfDoc) === hashAdf(approvedAdf) &&
      JSON.stringify(canonicalizeAdf(ctx.adfDoc.content)) === JSON.stringify(canonicalizeAdf(approvedAdf.content))) {
    ctx.enforceObservedEqual = true; // CONFIRMED equality — §2.5 may advance the baseline to live
    // Equal to a LATER sanctioned version (targetV > av): the new baseline holds that version's content.
    if (targetV !== av) ctx.enforceObservedContent = restoredContentOf(await withLegacySource(ctx.pageId, rec), targetV);
    return; // already equal — no body write
  }
  ctx.adfDoc.content = approvedAdf.content;           // whole-body replace, in place
  ctx.changed = true;
  ctx.enforcedRevert = true;                          // short-circuit A/B + suppress SV-M5
  ctx.enforceRevertTo = targetV;                      // for the comment copy (§5)
  ctx.enforceRevertContent = restoredContentOf(await withLegacySource(ctx.pageId, rec), targetV); // B2: what comes back, judged on the record read here
  ctx.enforceMessage = "(Sentinel Vault reverted unapproved change to the approved version)";
}

// #6: highest version in (av, cur] that COUNTS (workflow/sanctioned.js: an approver's or steward's
// save, or the app's write on top of one) — the live version `cur` included: when it is the answer,
// the live content is sanctioned and there is nothing to revert. Returns av if none counts, or when
// the version list cannot be read (a revert to the baseline never keeps a plain edit). null = could
// not tell (8.12.0: Confluence's 429 on the list or on a steward check says nothing about who
// edited): the caller does not revert this run, rather than undo a sanctioned edit.
async function highestSanctionedVersion(pageId, record, av, cur, knownStewardSpaces = null) {
  try {
    if (!(cur > av)) return av;
    // The steward arm: the page's space now and, if it moved, the record's — looked up once (the
    // probe's answer when it has one). Unknown: null, and the caller does not revert this run.
    let stewardSpaces = knownStewardSpaces;
    if (!stewardSpaces) {
      const auth = await recordAuthority({ contentId: pageId, storedKey: record.spaceKey || null });
      if (!auth.known) return null;
      stewardSpaces = auth.spaces;
    }
    const { judge } = await approvedPageJudge(record, { spaces: stewardSpaces });
    const walk = await judgeVersionsAfter(pageId, av, cur, { judge, appAccountId: await resolveAppAccountId() });
    if (walk.status === "limited" || walk.status === "unknown") return null;
    if (walk.status !== "ok") return av;
    return highestSanctionedBelow(walk.byVersion, av, cur + 1);
  } catch (_) { return av; }
}

// §4.4: author of the current top version (for the sweep's authorized-drift check).
// 8.12.0: RATE_LIMITED_AUTHOR when Confluence answered 429: the sweep judges that page next run.
const RATE_LIMITED_AUTHOR = Symbol("rate-limited");
async function fetchLiveVersionAuthor(pageId) {
  try {
    const res = await appConfluence(route`/wiki/api/v2/pages/${pageId}/versions?limit=1`);
    if (isRateLimited(res)) return RATE_LIMITED_AUTHOR;
    if (res.ok) return (await res.json())?.results?.[0]?.authorId ?? null;
  } catch (_) { /* fail-closed toward enforcement */ }
  return null;
}

// §4.3: standalone revert used by the sweep (not inside the ctx loop). Same 409 backoff.
// `targetVersion` (8.12.0): the version to give back when it is not the baseline itself — the highest
// version an approver or space admin wrote after the baseline (highestSanctionedVersion), as the
// event path does; never lower than the baseline.
export async function sweepRevertToApproved(pageId, record, targetVersion = null) {
  const fresh = await readPageWorkflow(pageId);
  const av = fresh?.approvedVersion;
  if (!(typeof av === "number" && av >= 1)) return false;
  const tv = typeof targetVersion === "number" && targetVersion > av ? targetVersion : av;
  let approvedAdf;
  try { ({ adfDoc: approvedAdf } = await readDocBodyAtVersion(pageId, tv)); } catch (_) { return false; }
  if (!approvedAdf?.content?.length) return false; // CL-1: never blank
  const restored = restoredContentOf(await withLegacySource(pageId, fresh), tv); // B2: what this revert gives back, on the record it read
  for (let attempt = 0; attempt < 3; attempt++) {
    let head;
    try { head = await readDocBody(pageId); } catch (_) { return false; }
    if ((head.pageData.version?.number || 0) <= av) return false; // no drift now
    if (tv > av && (head.pageData.version?.number || 0) <= tv) return false; // the sanctioned version is live: nothing to undo
    // Content already equals the baseline (a version bump with no real change) — advance
    // the baseline to resolve the drift WITHOUT a needless destructive rewrite (mirror the
    // event-path CL-7 guard). Return true: the drift is reconciled.
    if (hashAdf(head.adfDoc) === hashAdf(approvedAdf) &&
        JSON.stringify(canonicalizeAdf(head.adfDoc.content)) === JSON.stringify(canonicalizeAdf(approvedAdf.content))) {
      const live = head.pageData.version?.number || 0;
      // Equal to a later sanctioned version (tv > av): the baseline holds THAT version's content.
      await restampApprovedVersion(pageId, live, { kind: "unchanged", ...(tv > av ? { contentOf: restored.contentOf ?? tv, editedIn: restored.editedIn ?? tv } : {}) }).catch(() => {});
      // Truthfulness (A1 review F1): this branch wrote NOTHING — the live version became the
      // baseline. Callers that record the outcome must not call it a revert.
      return { ok: true, wrote: false, version: live, restoredTo: null };
    }
    head.adfDoc.content = approvedAdf.content;
    const putRes = await writeDocBody(pageId, head.pageData, head.adfDoc, "(Sentinel Vault reverted unapproved change to the approved version)");
    if (putRes.ok) {
      const written = (head.pageData.version?.number || 0) + 1;
      await restampApprovedVersion(pageId, written, { kind: "restored", from: tv, ...restored }).catch(() => {});
      return { ok: true, wrote: true, version: written, restoredTo: tv, restoredContent: restored.contentOf ?? tv };
    }
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
  let reverted = 0, demoted = 0, healed = 0, expired = 0, overdue = 0, skippedTrashed = 0, purgedPages = 0;
  const nowMs = Date.now();
  const protectionOn = contentProtectionEnabled(await kvs.get("admin-settings-global").catch(() => null));
  const defCache = new Map(); // per-space def cache — most pages in a space share one workflow
  const settingsCache = new Map(); // per-space settings (B4 label sync reads them per row)
  const spaceKeyById = new Map(); // workflowSweep: space id -> key, once per run
  let labelsSynced = 0;
  const LABEL_SYNC_PER_RUN = 40;
  const defFor = async (sk, wid = null) => { const k = `${sk}|${wid || ""}`; if (!defCache.has(k)) defCache.set(k, await resolveWorkflowDef(sk, wid)); return defCache.get(k); };
  let query = kvs.query().where("key", WhereConditions.beginsWith("workflow-idx-")).limit(100);
  let iterations = 0;
  do {
    const { results, nextCursor } = await query.getMany();
    // Where each page IS, one batch call per query page: a trashed page keeps its record (it
    // may be restored) but gets no enforcement, expiry or comment while it is in the trash; a
    // page Confluence has forgotten (purged) has its workflow keys purged too — the dashboard
    // otherwise lists it forever. `unknown` (a failed lookup) is left alone this tick.
    const places = await fetchPageStatuses((results || []).map((r) => r?.value?.pageId).filter(Boolean));
    // The batch above already says which space each page is in now; its key is read once per space.
    const liveKeyOfSpaceId = async (spaceId) => {
      if (spaceId == null) return null;
      if (!spaceKeyById.has(spaceId)) {
        let key = null;
        try { const r = await appConfluence(route`/wiki/api/v2/spaces/${spaceId}`); if (r.ok) key = (await r.json())?.key || null; } catch (_) { key = null; }
        spaceKeyById.set(spaceId, key);
      }
      return spaceKeyById.get(spaceId);
    };
    for (const { value: idx } of (results || [])) {
      try {
        const place = places.get(String(idx?.pageId))?.status || "unknown";
        if (place === "trashed") { skippedTrashed++; continue; }
        if (place === "missing") {
          await purgePageWorkflow(idx.pageId, { clearApprovals: clearPageApprovals });
          purgedPages++;
          continue;
        }
        const record = await readPageWorkflow(idx.pageId);
        if (!record) continue;
        const def = await defFor(record.spaceKey, record.workflowId);
        // Where the page is now (content-access.js recordAuthority; the batch above named its space):
        // a page that moved spaces holds still (workflow/moved-hold.js) — no review expiry moves it.
        // Asked only where it matters (a passed review date, an enforced record), once per row.
        let authAnswer = null;
        const authOf = async () => (authAnswer ??= await recordAuthority({ contentId: idx.pageId, storedKey: record.spaceKey || null, liveKey: await liveKeyOfSpaceId(places.get(String(idx.pageId))?.spaceId) }));
        // B4: label backfill / removal. On → any row whose stamp lags its state gets the label
        // (covers "enabled after pages existed"); off → rows still stamped lose their state
        // labels. One label round-trip per lagging row, none for rows already in step.
        try {
          const sk = record.spaceKey;
          if (!settingsCache.has(sk)) settingsCache.set(sk, await getSpaceWorkflowSettings(sk));
          const sset = settingsCache.get(sk);
          // Capped per run (review finding 6): a 600-page space enabling sync must not spend the
          // whole 25 s budget on labels and starve the expiry pass, the AI reaper and the inbox
          // housekeeping below — the backfill simply continues next hour.
          if (labelsSynced < LABEL_SYNC_PER_RUN) {
            const stamp = await readLabelStamp(idx.pageId);
            if (sset?.syncLabels && stamp !== record.stateId) {
              if ((await mirrorStateLabel(idx.pageId, record, sset))?.ok) labelsSynced++;
            } else if (!sset?.syncLabels && stamp) {
              if ((await clearStateLabel(idx.pageId)).ok) labelsSynced++;
            }
          }
        } catch (e) { console.warn("[WORKFLOW-SWEEP] label sync", errText(e)); }
        // #45/A5 review-expiry (runs FIRST): ANY page whose review date has passed — the clock
        // may come from the definition, a per-state override, or a steward-set date, so the
        // record's reviewDueAt is the only thing consulted. When the definition has a transition
        // from its state to Expired it moves there (leaving Approved also ends enforcement, so
        // the page needs no enforce processing this tick); otherwise it stays put, overdue, and is
        // recorded + commented ONCE per due date (workflow-review-notified-{pageId}, 7-day TTL —
        // an hourly sweep must not comment hourly). A page already in Expired has nowhere to go.
        // Not judged while where the page is cannot be read: neither expired nor noticed this tick.
        if (record.reviewDueAt && record.stateId !== "expired" && new Date(record.reviewDueAt).getTime() < nowMs && (await authOf()).known) {
          const auth = await authOf();
          const fromName = findState(def, record.stateId)?.name || record.stateId;
          const canExpire = auth.known && !auth.moved && !!findState(def, "expired") && validateTransition(def, record.stateId, "expired").ok;
          if (canExpire) {
            const res = await transitionPageWorkflow({
              activity: false, // the dedicated row below records this event (A1 review F5)
              pageId: idx.pageId, spaceKey: record.spaceKey, toStateId: "expired",
              actorAccountId: systemAccountId, actorName: "Sentinel Vault",
              reason: "review period elapsed — auto-expired",
            });
            if (res.success) {
              expired++;
              // A1: the Expired transition persisted.
              await recordActivity({
                type: "workflow.expired",
                pageId: idx.pageId,
                spaceKey: record.spaceKey || null,
                actor: null,
                target: { kind: "page", id: idx.pageId, name: null },
                details: { from: record.stateId, fromName, reviewDueAt: record.reviewDueAt || null, approvedVersion: record.approvedVersion ?? null, lastEnteredBy: record.enteredBy || null },
                version: record.approvedVersion ?? null,
              });
              await kvs.delete(`workflow-review-notified-${idx.pageId}`).catch(() => {});
              await postEnforceComment(idx.pageId, record.enteredBy, "expired", { toName: findState(def, "expired")?.name || null }).catch(() => {});
            }
            continue;
          }
          const notified = await kvs.get(`workflow-review-notified-${idx.pageId}`);
          if (notified?.reviewDueAt !== record.reviewDueAt) {
            // Claim the marker BEFORE the side effects (T6): a duplicate tick must not comment twice.
            await kvs.set(`workflow-review-notified-${idx.pageId}`, { at: new Date().toISOString(), reviewDueAt: record.reviewDueAt });
            overdue++;
            await recordActivity({
              type: "workflow.expired",
              pageId: idx.pageId,
              spaceKey: record.spaceKey || null,
              actor: null,
              target: { kind: "page", id: idx.pageId, name: null },
              details: { from: record.stateId, fromName, noTransition: true, reviewDueAt: record.reviewDueAt || null, approvedVersion: record.approvedVersion ?? null, lastEnteredBy: record.enteredBy || null },
              version: record.approvedVersion ?? null,
            });
            // Address a HUMAN: after a demote `enteredBy` is the app account, and a notice that
            // @mentions Sentinel Vault reaches nobody (review finding 7). Nobody is better than that.
            const overdueAddressee = record.enteredBy && record.enteredBy !== systemAccountId ? record.enteredBy : (record.approvedBy && record.approvedBy !== systemAccountId ? record.approvedBy : null);
            await postEnforceComment(idx.pageId, overdueAddressee, "expired", { noTransition: true, stateName: fromName }).catch(() => {});
          }
          // fall through: an overdue enforced page is still enforced
        }
        if (!record?.enforce) continue;
        // Unknown (see auth above) -> next run; a moved page keeps the protection it was approved
        // under (see collectWorkflowEnforcementForPage).
        const auth = await authOf();
        if (!auth.known) continue;
        // A state the definition no longer knows is judged as enforced (the event path's rule, 2026-10-21).
        if (!isEnforcedNow(record, def, auth)) continue;
        // "Protect Sealed Attachments in Page Body" off switches Approved-page enforcement off —
        // the event path always honoured it, the sweep did not and still demoted / reverted.
        // Nothing here is touched while it is off: no enforcement, no baseline re-stamp (that would
        // record an unreviewed edit as the approved version), no comment.
        if (!protectionOn) continue;
        const live = await fetchLivePageVersion(idx.pageId);
        if (live == null) continue;
        // Gap B: a null baseline on an enforced page is a hole — self-heal, don't skip.
        if (record.approvedVersion == null) {
          if (await restampApprovedVersion(idx.pageId, live, { kind: "healed" })) healed++;
          continue;
        }
        if (live === record.approvedVersion) {
          await kvs.delete(`workflow-integrity-notified-${idx.pageId}`).catch(() => {});
          continue;
        }
        // DRIFT. Gap C/CL-3: a dropped event may have been an AUTHORIZED edit — check the author.
        const author = await fetchLiveVersionAuthor(idx.pageId);
        if (author === RATE_LIMITED_AUTHOR) { console.warn(`[WORKFLOW-SWEEP] ${idx.pageId}: the live version's author could not be read (Confluence 429); judged next run`); continue; }
        const judgeOf = await approvedPageJudge(record, { spaces: auth.spaces });
        const settings = judgeOf.settings;
        let authorized = false;
        let cause = null;
        let editor = author || null; // whom the notices name: never the app account
        if (author && author === systemAccountId) {
          // The app's own version is judged like any other: a section restore, a seal's wrap or an
          // adoption is made from the live body and carries whatever that body held. It counts when
          // its body equals the baseline's (a re-save: the baseline's history
          // carries forward, "unchanged") or when every version since the baseline counts
          // (workflow/sanctioned.js: approver, steward, or the app on top of one — no cause, so no
          // surface names anyone). Could not tell: judged next run.
          if (await sameBodyAsVersion(idx.pageId, live, record.approvedVersion)) { authorized = true; cause = { kind: "unchanged" }; }
          else {
            const t = await sanctionedRestampTarget(idx.pageId, record, { live, spaces: auth.spaces, appAccountId: systemAccountId, judge: judgeOf.judge });
            if (!t.known) { console.warn(`[WORKFLOW-SWEEP] ${idx.pageId}: who edited after the baseline could not be judged; judged next run`); continue; }
            authorized = t.version === live;
            if (!authorized) editor = firstUnsanctionedAuthor(t.walk, record.approvedVersion, live, systemAccountId);
          }
        } else if (author) {
          // 8.12.0: a steward check a 429 left open judges nothing this hour (next sweep asks again).
          const who = await judgeOf.judge(author);
          if (who.unknown) { console.warn(`[WORKFLOW-SWEEP] ${idx.pageId}: who edited could not be checked (Confluence 429); judged next run`); continue; }
          authorized = who.privileged;
          cause = { kind: "edit" }; // an approver's or space admin's save is a sanctioned edit
        }
        if (authorized) {
          if (await restampApprovedVersion(idx.pageId, live, cause)) healed++;
          await kvs.delete(`workflow-integrity-notified-${idx.pageId}`).catch(() => {});
          continue;
        }
        // The event path's rule (enforcementPlan): a moved page reverts, and so does a demote this workflow
        // cannot make (the activity row and the notice say why).
        const plan = enforcementPlan(settings, { moved: auth.moved, def, stateId: record.stateId });
        let mode = plan.mode;
        let demoteFallback = plan.fallback?.code || null;
        if (demoteFallback) console.warn(`[WORKFLOW-SWEEP] ${idx.pageId}: the demote cannot be made in this workflow (${demoteFallback}); reverting instead`);
        const alreadyNotified = await kvs.get(`workflow-integrity-notified-${idx.pageId}`);
        if (mode === "demote") {
          const target = plan.target; // A2: the same plan as the event path
          let res;
          try {
            res = await transitionPageWorkflow({
              activity: false, // the dedicated row below records this event (A1 review F5)
              pageId: idx.pageId, spaceKey: record.spaceKey, toStateId: target.id,
              actorAccountId: systemAccountId, actorName: "Sentinel Vault",
              reason: `auto-demoted to ${target.name || target.id} by integrity sweep (unauthorized drift)`,
            });
          } catch (e) { console.error("[WORKFLOW-SWEEP] demote error:", errText(e)); res = { success: false, reason: null }; } // the event path's rule: fall back, never skip
          if (res.success) {
            // A1: the demotion persisted whether or not the (once-only) comment goes out.
            await recordActivity({
              type: "workflow.enforced",
              pageId: idx.pageId,
              spaceKey: record.spaceKey || null,
              actor: null,
              target: { kind: "page", id: idx.pageId, name: null },
              details: { mode: "demote", editor: editor || null, approvedVersion: record.approvedVersion ?? null, reviewedVersion: reviewedVersionOf(record), restoredTo: null, demotedTo: target.id, demotedToName: target.name || target.id, driftedVersion: live, via: "sweep" },
              version: live,
            });
            if (!alreadyNotified) {
              demoted++;
              await announceWorkflowEnforcement({
                pageId: idx.pageId, mode: "demote", editorAccountId: editor || record.enteredBy || null, record,
                approvedVersion: reviewedVersionOf(record), demotedToName: target.name || target.id, via: "sweep",
              });
              await kvs.set(`workflow-integrity-notified-${idx.pageId}`, { at: new Date().toISOString() });
            }
          } else if ((await readPageWorkflow(idx.pageId))?.enforce) {
            // Refused after the plan said yes (the definition changed in between) and the page is still
            // enforced: the revert below, never a silent no-op.
            console.error(`[WORKFLOW-SWEEP] demote of ${idx.pageId} did not apply (${reasonText(res.reason)}); reverting instead`);
            mode = "revert";
            demoteFallback = "transition-refused";
          }
        }
        if (mode === "revert") {
          // 8.12.0 (review 2026-10-18): give back the last SANCTIONED version, not the baseline blindly —
          // an approver's or space admin's edit whose event never landed (dropped, or judged "unknown"
          // while Confluence was limiting) is kept, as the event path keeps it. Unknown: next run.
          // The live version was judged just above and does not count, so the walk runs only when
          // versions sit between it and the baseline; it is still a candidate there (one rule with Pass 0).
          let targetV = (live - record.approvedVersion > 1) ? await highestSanctionedVersion(idx.pageId, record, record.approvedVersion, live, auth.spaces) : record.approvedVersion;
          if (targetV === live) targetV = null; // the walk and the check above disagree (a change in between): judged next run
          if (targetV == null) { console.warn(`[WORKFLOW-SWEEP] ${idx.pageId}: who edited after the baseline could not be judged; judged next run`); continue; }
          const ok = await sweepRevertToApproved(idx.pageId, record, targetV);
          // B2: the approved content the sweep's revert gave back (a copy of a copy names the original).
          const restoredContent = ok?.restoredContent ?? record.approvedVersion ?? null;
          if (ok) {
            reverted++;
            // A1: sweepRevertToApproved succeeds on TWO branches — a confirmed write, or confirmed
            // equality where nothing was written and the live version became the baseline. The
            // record says which; "reverted to v5" when v6 stayed live would be a false statement
            // in a no-TTL compliance record (A1 review F1).
            await recordActivity({
              type: "workflow.enforced",
              pageId: idx.pageId,
              spaceKey: record.spaceKey || null,
              actor: null,
              target: { kind: "page", id: idx.pageId, name: null },
              details: {
                mode: "revert", editor: editor || null, approvedVersion: record.approvedVersion ?? null,
                restoredTo: ok.wrote ? (ok.restoredTo ?? record.approvedVersion ?? null) : null, // the version the body was copied from (8.12.0: can be a later sanctioned one)
                restoredContent: ok.wrote ? restoredContent : null, reviewedVersion: reviewedVersionOf(record),
                reconciled: ok.wrote ? "reverted" : "baseline-advanced",
                driftedVersion: live, via: "sweep",
                ...(demoteFallback && ok.wrote ? { demoteFallback } : {}), // 2026-10-21: the move back could not be made here (said only when the edit was really undone)
              },
              version: ok.version ?? null,
            });
            await kvs.delete(`workflow-integrity-notified-${idx.pageId}`).catch(() => {});
            if (ok.wrote) {
              await announceWorkflowEnforcement({
                pageId: idx.pageId, mode: "revert", editorAccountId: editor || null, record,
                approvedVersion: restoredContent, revertedVersion: live, via: "sweep", demoteFallback,
              });
            }
          }
          else if (!alreadyNotified) {
            await postEnforceComment(idx.pageId, record.enteredBy, "revert-failed").catch(() => {});
            await kvs.set(`workflow-integrity-notified-${idx.pageId}`, { at: new Date().toISOString() });
          }
        }
      } catch (e) { console.error("[WORKFLOW-SWEEP]", errText(e)); }
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
      } catch (e) { console.error("[WORKFLOW-SWEEP] ai-reaper", errText(e)); }
    }
    if (!nextCursor || ++piter >= 20) break;
    pq = kvs.query().where("key", WhereConditions.beginsWith("workflow-pending-")).limit(100).cursor(nextCursor);
  } while (true);

  // Inbox index housekeeping (2026-09-05): backfill rows for in-flight approvals, drop orphans.
  let inbox = { backfilled: 0, orphansRemoved: 0 };
  try { inbox = await sweepApprovalIndex({ nowMs }); } catch (e) { console.error("[WORKFLOW-SWEEP] inbox index", errText(e)); }

  return { body: JSON.stringify({ reverted, demoted, healed, expired, overdue, skippedTrashed, purgedPages, labelsSynced, aiTimedOut, inboxBackfilled: inbox.backfilled, orphanApprovalsRemoved: inbox.orphansRemoved }) };
}

// --- Conditions & Validations phase (runs after the body-protection pipeline) ---
async function runValidationPhase(event, pageId, atlassianId) {
  // The early guard's synthetic event carries no space; resolving it from the page keeps SPACE
  // rules in play — otherwise this run judged the page against the global rules only and
  // marked the version checked, so the real event (with the space) skipped it (2026-09-19).
  let spaceKey =
    event?.space?.key || event?.content?.space?.key || event?.content?.spaceKey || null;
  if (!spaceKey) spaceKey = await resolvePageSpaceKey(pageId).catch(() => null);

  const config = await resolveEffectiveConfig(spaceKey);
  if (!config.enabled || !(config.rules || []).length) return;

  const { pageData, adfDoc } = await readDocBody(pageId);

  // Only enforce on published pages.
  if (pageData.status && pageData.status !== "current") return;

  const version = pageData.version?.number;
  if (!version) return; // SV-m1: an undefined version would bypass dedup entirely
  if (await wasVersionChecked(pageId, version)) return;

  // Page labels (required-label rule) — read BEFORE the claim below, and only a read, so the
  // SV-m1 "claim before any side effect" order still holds. A label read that did not complete
  // must not be judged as "no labels" (tester, 2026-09-23): skip this run WITHOUT claiming the
  // version, so a later delivery or the early guard judges it on a complete read.
  const { labels, complete: labelsComplete } = await fetchPageLabelsChecked(pageId);
  if (!labelsComplete && rulesNeedLabels(config.rules)) {
    console.error(`[VALIDATE] page ${pageId} v${version}: label read incomplete — not judged this run (label rules present)`);
    return;
  }

  // SV-m1: claim this version up-front (before any side effect) so a duplicate updated:page
  // delivery for the same version can't double-post advisory comments / state writes.
  await markVersionChecked(pageId, version);

  const { passed, violations } = evaluateRules(adfDoc, labels, config.rules);
  const modes = config.modes || { advisory: true, gate: false, revert: false };
  const base = pageData._links?.base;
  const historyUrl = base ? `${base}/pages/viewpreviousversions.action?pageId=${pageId}` : "";
  const violationLabels = (violations || []).map((v) => v?.label || v?.type || "rule").slice(0, 25);

  // A1: `validation.gate` is recorded on a CHANGE of gate state only — every save re-evaluates
  // the rules, and a feed that repeats "passed" per version says nothing. The prior state is
  // read once, before the write that replaces it (a read; not a side effect — the SV-m1 claim
  // above is untouched by it).
  const priorRead = modes.gate ? await readValidationState(pageId) : null;
  const priorGate = priorRead?.unknown === true ? null : priorRead; // unreadable: the row records no "previous"
  const recordGateIfChanged = async (state) => {
    if (!modes.gate || priorGate?.state === state) return;
    await recordActivity({
      type: "validation.gate",
      pageId,
      spaceKey,
      actor: atlassianId ? { accountId: atlassianId, name: null } : null,
      target: { kind: "page", id: pageId, name: null },
      details: { state, previous: priorGate?.state || null, violations: state === "failed" ? violationLabels : [] },
      version,
    });
  };

  if (passed) {
    await setLastGoodVersion(pageId, version);
    if (modes.gate) {
      await writeValidationState(pageId, { state: "passed", violations: [], version, checkedAt: new Date().toISOString(), rulesFp: rulesFingerprint(config.rules) });
      await recordGateIfChanged("passed");
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
    catch (e) { console.error("[VALIDATE] advisory comment failed:", errText(e)); }
  }
  if (modes.gate) {
    await writeValidationState(pageId, { state: "failed", violations, version, checkedAt: new Date().toISOString(), rulesFp: rulesFingerprint(config.rules) });
    await recordGateIfChanged("failed");
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
            const newVersion = (current.pageData.version?.number || version) + 1;
            // A1: the revert write is confirmed — the tampered version is gone at newVersion.
            await recordActivity({
              type: "validation.reverted",
              pageId,
              spaceKey,
              actor: atlassianId ? { accountId: atlassianId, name: null } : null,
              target: { kind: "page", id: pageId, name: null },
              details: { violations: violationLabels, restoredTo: lastGood, revertedVersion: version },
              version: newVersion,
            });
            // SV-m2: the content is compliant again — reconcile the gate state so the inline
            // panel / doc ribbon don't keep showing a stale "failed".
            if (modes.gate) {
              try {
                await writeValidationState(pageId, { state: "passed", violations: [], version: newVersion, checkedAt: new Date().toISOString(), rulesFp: rulesFingerprint(config.rules) });
              } catch (_) { /* best effort */ }
            }
            break;
          }
          if (putRes.status === 409) { await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500)); continue; }
          break;
        } catch (e) { console.error("[VALIDATE] revert error:", errText(e)); break; }
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
async function sendSectionViolationNotifications(seal, pageId, actor, kind, revertedVersion = null) {
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
    // The page version that carries the editor's change — the ribbon links to it.
    revertedVersion: revertedVersion || null,
  });
  // Hunt H1-F4: section comments get the same cross-run dedup the media path has (the
  // incident-2026-07-22 spam loop — a stale draft re-publishing every few minutes — was
  // reproducible verbatim on the section surface). Marker keyed by sectionId; the dispatch
  // record above still fires per occurrence.
  const bulletinToggles = await resolveBulletinToggles();
  const markerClass = kind === "removed" ? "section-removed" : "section-edited";
  await postDedupedFootnote(bulletinToggles, pageId, seal.sectionId, markerClass, seal.lockedBy, actor, title, verb, { targetKind: "section", revertedVersion });
}

// --- A sanctioned new version of a sealed file becomes the seal's baseline ---
// Sanctioned = the seal owner's upload while the seal is personal, an active grantee's, or (SEC-2)
// the workflow's privileged set while the page holds it. One re-baseline for all three (it was
// written for grantees only; the owner and the held+privileged path returned without one).
async function rebaselineSanctionedEdit(sealRecord, artifactId, pageId, currentVersion, atlassianId, who) {
  try {
    // Never resurrect and never move backwards. The old `(await kvs.get(…)) || sealRecord`
    // re-created a seal released while this event was in flight; and the trigger is at-least-once
    // and unordered, so a redelivered OLDER upload must not pull the baseline back under a newer one.
    const before = await kvs.get(`protection-${artifactId}`);
    if (!isLiveAttachmentSeal(before)) return;
    if (!advancesSealedVersion(before.sealedVersion, currentVersion)) {
      console.warn(`[EDIT-GRANT] ${who} edit of ${artifactId} at v${currentVersion} does not advance the baseline (v${before.sealedVersion}) — skipped`);
      return;
    }
    let newFileId = before.sealedFileId || sealRecord.sealedFileId || null;
    const attRes = await appConfluence(
      route`/wiki/api/v2/attachments/${artifactId}`,
    );
    if (attRes.ok) {
      const attData = await attRes.json();
      newFileId = attData.fileId || newFileId;
    }
    // Hunt F6: the approved upload replaced the binary — the OLD file's presentation
    // baseline is stale (new natural dimensions surface as attr drift that would later be
    // "restored" onto the new image, distorting it and accusing an innocent editor).
    // Refresh from a fresh server read against the NEW fileId; on any failure keep NO
    // baseline (attr protection off until the next authorized change beats stale-revert).
    let newBaseline = null;
    if (pageId && newFileId) {
      try {
        const { adfDoc } = await readDocBody(pageId);
        newBaseline = capturePresentation(findSealedMediaSingle(adfDoc, newFileId));
      } catch (_) { /* null baseline — fail toward no attr protection */ }
    }
    // Hunt F5: merge onto a FRESH record — the page trigger's attr-pass re-baseline can race
    // this write (one grantee save fires both events); patch only the fields this path owns
    // (sealedVersion/sealedFileId/mediaBaseline), never persist the trigger-entry snapshot.
    const fresh = await kvs.get(`protection-${artifactId}`);
    if (!isLiveAttachmentSeal(fresh) || !advancesSealedVersion(fresh.sealedVersion, currentVersion)) return;
    if (!(await markGuardedPage(fresh.contentId || pageId))) await reopenGuardBackfill(); // self-heal: a seal record always has its page marker (the backfill rebuilds it)
    await kvs.set(`protection-${artifactId}`, {
      ...fresh,
      sealedVersion: currentVersion || fresh.sealedVersion,
      sealedFileId: newFileId,
      mediaBaseline: newBaseline,
    });
    await touchSealTimestamp();
    console.warn(
      `[EDIT-GRANT] Allowed ${who} edit of ${artifactId} — re-baselined seal to v${currentVersion}`,
    );
  } catch (e) {
    console.error(`[EDIT-GRANT] Failed to re-baseline seal after ${who} edit:`, errText(e));
  }
}

// --- Handle unauthorized edit of a sealed artifact ---
async function handleSealedArtifactEdit(sealRecord, artifactId, contentId, atlassianId, attachment, { restoreJudged = false } = {}) {
  let currentVersion = attachment.version?.number;
  let pageId = contentId || sealRecord.contentId;

  // SEC-2 parity (tester 2026-09-25): while the page is Approved the seal is the WORKFLOW's — its
  // privileged set (approvers, space admins) may change the file; the personal owner and any
  // grantee may not, exactly as sections already do (mayEditInside, grants frozen). Before this,
  // an "Edit now" grant still let its holder replace a file on an Approved page.
  const held = isWorkflowHeld(sealRecord);
  // Hunt F9 (Fix-2 parity): a degraded updated:attachment event can omit container/version —
  // the trash handler completes those from a probe, this handler built a download route with
  // "undefined" and failed open. Fill the gaps the same way before proceeding. (Before the
  // sanctioned-edit check now: a sanctioned edit needs the version to re-baseline to.)
  const fillGaps = async () => {
    if (!pageId || !currentVersion) {
      const probe = await probeAttachmentStatus(artifactId);
      pageId = pageId || probe.pageId;
      currentVersion = currentVersion || probe.version;
    }
  };
  // The panel's Restore runs as the person (shared/trash-rights.js), so its update event arrives here
  // under their account. Left alone only for a marker of THAT person covering this version AND the
  // same file (fileId) as before the restore and as sealed: a restore never changes the bytes. A
  // busy fileId answer defers the decision to the re-check sweep (sweepRestoreRechecks) instead of
  // reverting a legitimate restore; any mismatch is enforced.
  if (atlassianId && !restoreJudged) {
    await fillGaps();
    const readFileId = (v) => fileIdAtVersion(artifactId, v);
    const { verdict, mark } = await panelRestoreVerdict(artifactId, atlassianId, currentVersion, { sealedFileId: sealRecord.sealedFileId || null, sealedVersion: sealRecord.sealedVersion ?? null, readFileId });
    if (verdict === "restore") {
      console.warn(`[EDIT-REVERT] ${artifactId} v${currentVersion} is the panel restore's own write — not an edit`);
      return;
    }
    if (verdict === "unknown") {
      await deferRestoreCheck({ attachmentId: artifactId, accountId: atlassianId, version: currentVersion, pageId, mark });
      console.warn(`[EDIT-REVERT] ${artifactId} v${currentVersion}: could not compare the file now — re-checked by the sweep`);
      return;
    }
  }
  let sanctionedBy = null;
  if (held) {
    const p = await workflowPrivilegeForPage(pageId, atlassianId).catch(() => ({ privileged: false }));
    if (p.privileged) sanctionedBy = "workflow-privileged";
  } else if (sealRecord.lockedBy === atlassianId) {
    // Allow the seal owner to edit their own sealed artifact
    sanctionedBy = "owner";
  }
  if (sanctionedBy) {
    // The owner's (or, while held, the workflow's) new version IS the seal's content from now
    // on. This used to return without re-baselining, so the seal still pointed at the ORIGINAL
    // sealed version: the next unauthorized upload was reverted to that, silently discarding the
    // owner's update. Same re-baseline the grantee path below has always done.
    await fillGaps();
    await rebaselineSanctionedEdit(sealRecord, artifactId, pageId, currentVersion, atlassianId, sanctionedBy);
    return;
  }

  // audit C3: an EXPIRED (but not-yet-swept) seal must stop enforcing — otherwise a dead seal
  // keeps reverting everyone's edits, denying service. Sections already guard this
  // (restoreSealedSectionsPass); attachments did not.
  if (sealRecord.expiresAt && new Date(sealRecord.expiresAt).getTime() <= Date.now()) {
    return;
  }

  await fillGaps();

  // Allow approved editors (Edit Requests) to edit without reverting. Re-baseline
  // the seal to the new version + fileId so future reverts target the edited
  // content, and pageContentTrigger's media-presence check keeps matching.
  const grant = held ? null : await getActiveEditGrant(artifactId, atlassianId); // frozen while held
  if (grant) {
    await rebaselineSanctionedEdit(sealRecord, artifactId, pageId, currentVersion, atlassianId, "grantee");
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
    const ar = await appConfluence(route`/wiki/api/v2/attachments/${artifactId}`);
    if (ar.ok) artifactName = (await ar.json())?.title || artifactName;
  } catch (_) { /* fall back to event fileName */ }

  // audit B1/B2: retry the download+re-upload; on definitive failure, notify LOUDLY instead
  // of returning silently (the seal is a fail-OPEN otherwise — a single 429/5xx blip would
  // permanently let the tampered version stand with the owner believing it was protected).
  const revert = await revertAttachmentToVersion(pageId, artifactId, artifactName, targetVersion);
  if (!revert.ok) {
    console.error(`[EDIT-REVERT] FAILED to enforce seal on ${artifactId} -> v${targetVersion} (${safeKey(revert.stage, "-")} ${revert.status || reasonText(revert.error)}) — the tampered version is LIVE; notifying owner.`);
    await notifyAttachmentRevertFailed(sealRecord, artifactId, pageId, atlassianId, artifactName).catch(() => {});
    return;
  }

  console.warn(`[EDIT-REVERT] Reverted ${artifactId} to v${targetVersion}`);
  // A1: the re-upload succeeded — the sealed version is live again. Recorded before the
  // notification, which claims a dedup marker ahead of its comment (T6 placement).
  await recordActivity({
    type: "seal.edit-reverted",
    pageId: pageId || null,
    spaceKey: sealRecord.spaceKey || null,
    actor: atlassianId ? { accountId: atlassianId, name: null } : null,
    target: { kind: "attachment", id: artifactId, name: artifactName },
    details: { restoredTo: targetVersion, revertedVersion: currentVersion ?? null, ownerAccountId: sealRecord.lockedBy || null },
    version: null,
  });
  await sendViolationNotifications(sealRecord, artifactId, pageId, atlassianId, artifactName, "edit");
}

// audit B1/B2: attachment revert with bounded 429/5xx backoff. A single transient failure
// must not silently bypass a seal (there is no attachment-side sweep backstop). Returns
// { ok } | { ok:false, stage, status?, error? }.
async function revertAttachmentToVersion(contentId, artifactId, title, targetVersion) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const backoff = () => new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
    try {
      const dl = await appConfluence(
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
      const up = await appConfluence(
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
  // A1: a CONFIRMED failure to enforce — every caller reaches here only after the revert /
  // restore definitively did not apply (edit revert exhausted, trash restore refused, embed
  // lookback exhausted). One record site for all of them, ahead of the dedup claim below.
  await recordActivity({
    type: "seal.revert-failed",
    pageId: contentId || null,
    spaceKey: sealRecord?.spaceKey || null,
    actor: atlassianId ? { accountId: atlassianId, name: null } : null,
    target: { kind: "attachment", id: artifactId, name: artifactName || null },
    details: { ownerAccountId: sealRecord?.lockedBy || null, sealedVersion: sealRecord?.sealedVersion ?? null },
    version: null,
  });
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
    // Fix 3: the revert-failed comment is deduped too — a persistently unrestorable attachment
    // would otherwise re-comment on every page edit (vet F5 / the incident's own spam shape).
    // Hunt H2-F4: claim only when postable, release on a failed post (postDedupedFootnote).
    const bulletinToggles = await resolveBulletinToggles();
    await postDedupedFootnote(bulletinToggles, contentId, artifactId, "revert-failed", sealRecord.lockedBy, atlassianId, artifactName, "revert-failed");
  } catch (_) { /* best-effort */ }
}

// --- Handle trashing of a sealed artifact — restore from trash ---
// Fix 2 (incident 2026-07-22): exported so the harness can drive the version-less/container-less
// event shape the Confluence UI delete emits (the trigger only fires on a real trashed:attachment
// event, which REST can't emit with a controlled payload). Mirrors the B13 export precedent.
export async function handleSealedArtifactTrash(sealRecord, artifactId, contentId, atlassianId, attachment) {
  // Hunt F2a: the owner trashing their own sealed file RELEASES the seal — convert the record
  // to an inert S7 trashedOnly TRACKING record (the restore UI already handles those) instead
  // of returning with the live seal intact. A live seal left behind means the NEXT non-owner
  // page save un-trashes the owner's deliberate delete and publicly blames that bystander.
  //
  // SEC-2: while the workflow HOLDS the seal (the page is Approved) it is not the owner's to end.
  // The edit path refuses the owner then and lets only the workflow's privileged set (approvers ∩
  // live, or a space admin) change the file; trashing is a change, so the same rule decides here.
  // A held trash by anyone else falls through to the restore below like any unauthorized trash.
  const held = isWorkflowHeld(sealRecord);
  let sanctioned = false;
  if (held) {
    const p = await workflowPrivilegeForPage(contentId || sealRecord.contentId, atlassianId).catch(() => ({ privileged: false }));
    sanctioned = p.privileged === true;
  } else {
    sanctioned = sealRecord.lockedBy === atlassianId;
  }
  if (sanctioned) {
    try {
      // Trash events can land a minute or more after the delete. A file that is current again by
      // then (its owner restored it meanwhile) keeps its seal: the release follows the file's state
      // now, not the event. ("unknown" keeps the event's word: the file was trashed.)
      const now = await probeAttachmentStatus(artifactId);
      if (now.status === "current") {
        console.warn(`[TRASH-RESTORE] ${artifactId}: trashed event arrived after the file was back — seal kept`);
        return;
      }
      // F5 discipline: merge onto a fresh read (the panel's own delete-artifact conversion can
      // race this event); this path owns only trashedOnly (and ends a hold with the seal — a stub
      // that still read as held would never be handed back by seal-custody).
      const fresh = (await kvs.get(`protection-${artifactId}`)) || sealRecord;
      const { workflowHeld: _endedHold, ...ended } = fresh;
      // `trashedFromPage`: the page the event names — the file's current container when it was trashed.
      await kvs.set(`protection-${artifactId}`, { ...ended, trashedOnly: true, trashedBy: atlassianId, trashedAt: new Date().toISOString(), trashedFromPage: contentId || now.pageId || null });
      await touchSealTimestamp();
      // Review F2: same teardown discipline as every other seal end (release, purge, re-seal).
      await sweepEditAccess(artifactId).catch((e) => console.warn("[TRASH-RESTORE] edit-access sweep failed:", errText(e)));
      console.warn(`[TRASH-RESTORE] ${held ? "workflow-privileged" : "owner"} trashed sealed ${artifactId} — seal released (trashedOnly tracking record)`);
      // A1: the seal ended here (owner intent, S3) — a feed that shows "sealed" and then nothing
      // while the file sits in the trash would be lying by omission (A1 review F6).
      await recordActivity({
        type: "seal.released",
        pageId: contentId || sealRecord.contentId || null,
        spaceKey: sealRecord.spaceKey || null,
        actor: { accountId: atlassianId, name: sealRecord.lockedBy === atlassianId ? (sealRecord.lockedByName || null) : null },
        target: { kind: "attachment", id: artifactId, name: sealRecord.attachmentName || attachment?.title || null },
        details: sealRecord.lockedBy === atlassianId
          ? { reason: "owner-trashed", via: "trash-event" }
          : { reason: "workflow-trashed", via: "trash-event", forced: true, ownerAccountId: sealRecord.lockedBy || null },
        version: null,
      });
    } catch (e) {
      console.error(`[TRASH-RESTORE] failed to release seal on sanctioned trash of ${artifactId}:`, errText(e));
    }
    return;
  }
  // Expired seals are inert (parity with the edit handler's audit-C3 guard and the
  // section pass) — a dead seal must not un-trash anyone's delete.
  if (sealRecord.expiresAt && new Date(sealRecord.expiresAt).getTime() <= Date.now()) {
    return;
  }
  let pageId = contentId || sealRecord.contentId;
  let currentVersion = attachment.version?.number;
  let attachmentTitle = attachment.title || sealRecord.attachmentName || "Unknown";

  // Incident 2026-07-22: the UI-driven delete can emit an event WITHOUT version/container —
  // the old guards returned silently and the sealed file stayed in the trash (the owner had
  // to restore it by hand). Fetch what the event omitted instead of abandoning the restore.
  if (!currentVersion || !pageId) {
    const probe = await probeAttachmentStatus(artifactId);
    if (probe.status === "current") return; // already restored by a concurrent run/user
    if (probe.status === "deleted" && (await confirmAttachmentPurged(artifactId, undefined, { pageId: pageId || sealRecord.contentId, containerCurrent: !!contentId }))) {
      // Trash event raced a purge (double-confirmed — a single transient 404 must never
      // trigger the destructive cleanup): permanent-delete path + honest notice.
      await handleSealedArtifactDeleted(sealRecord, artifactId, pageId, atlassianId, attachment);
      return;
    }
    currentVersion = currentVersion || probe.version;
    pageId = pageId || probe.pageId;
    attachmentTitle = attachment.title || probe.title || attachmentTitle;
  }

  if (!pageId || !currentVersion) {
    console.error(`[TRASH-RESTORE] Cannot restore ${artifactId} — ${!pageId ? "no pageId" : "no version"} from event OR probe; keeping the seal and notifying the owner.`);
    await notifyAttachmentRevertFailed(sealRecord, artifactId, pageId || sealRecord.contentId, atlassianId, attachmentTitle).catch(() => {});
    return;
  }

  console.warn(`[TRASH-RESTORE] Sealed artifact ${artifactId} trashed by a non-owner — restoring`);

  const restore = await restoreAttachmentFromTrash({
    attachmentId: artifactId, pageId, title: attachmentTitle, currentVersion,
  });

  if (!restore.ok) {
    if (restore.status === "deleted" && (await confirmAttachmentPurged(artifactId, undefined, { pageId: pageId || sealRecord.contentId, containerCurrent: !!contentId }))) {
      await handleSealedArtifactDeleted(sealRecord, artifactId, pageId, atlassianId, attachment);
      return;
    }
    // audit C4: do NOT hard-delete the seal on a restore failure — the attachment is still in
    // TRASH and recoverable, so deleting the seal permanently strips protection AND the old code
    // emailed a false "deleted". Keep the seal; tell the owner the restore could not be applied.
    console.error(`[TRASH-RESTORE] Could not restore ${artifactId} (${restore.status}) — KEEPING the seal (attachment recoverable from trash); notifying.`);
    await notifyAttachmentRevertFailed(sealRecord, artifactId, pageId, atlassianId, attachmentTitle).catch(() => {});
    return;
  }

  if (restore.already) return; // nothing was restored this run — no duplicate notice

  console.warn(`[TRASH-RESTORE] Restored ${artifactId}`);

  // Touch seal timestamp so frontend polling picks up the change
  await touchSealTimestamp();

  // A1: restore confirmed (restore.ok, not `already`) — ahead of the dedup-claiming notice.
  await recordActivity({
    type: "seal.trash-restored",
    pageId: pageId || null,
    spaceKey: sealRecord.spaceKey || null,
    actor: atlassianId ? { accountId: atlassianId, name: null } : null,
    target: { kind: "attachment", id: artifactId, name: attachmentTitle },
    details: { ownerAccountId: sealRecord.lockedBy || null, attachmentVersion: currentVersion ?? null },
    version: null,
  });

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

  console.warn(`[SEAL-DELETED] Sealed artifact ${artifactId} permanently deleted`);

  // B13 (ordering fix): the final notice is BEST-EFFORT — a notification failure MUST NOT abort the
  // record purge below. Previously an unguarded throw here (e.g. postDocFootnote 4xx/5xx on a since-gone
  // page) skipped every kvs.delete, leaving protection-*/space-protection-*/edit-grant-* ORPHANED with
  // no retry — so the (now-deleted) attachment read as "still sealed" forever. Wrap it; always clean up.
  //
  // S7: a trashedOnly TRACKING record was never a seal (a deleted file the app keeps
  // discoverable, or a seal that already ended when its owner trashed the file). Purging the file
  // is the end of the stub, not a violation: no "permanently deleted" notice to its "owner" (the
  // person who trashed it), no dispatch — a silent cleanup. The seal.deleted activity row below
  // still records it, flagged trashedOnly.
  if (!sealRecord.trashedOnly) {
    try {
      // Fix 1 copy: its own verb — the generic "delete" layout claimed "has been restored",
      // false on THIS (permanent) path.
      await sendViolationNotifications(sealRecord, artifactId, pageId, atlassianId, artifactName, "permanently-deleted");
    } catch (e) {
      console.error("[SEAL-DELETED] final notice failed (continuing cleanup):", errText(e));
    }
  }

  // Clean up KVS records since attachment is gone
  await kvs.delete(`protection-${artifactId}`);
  // A1: the seal record is purged — the seal ended with its file. Actor is whoever the event
  // named; null on the media-pass cleanup path (vet F4: the page editor did not purge it).
  await recordActivity({
    type: "seal.deleted",
    pageId: pageId || null,
    spaceKey: sealRecord.spaceKey || null,
    actor: atlassianId ? { accountId: atlassianId, name: null } : null,
    target: { kind: "attachment", id: artifactId, name: artifactName },
    details: { ownerAccountId: sealRecord.lockedBy || null, trashedOnly: !!sealRecord.trashedOnly },
    version: null,
  });
  if (sealRecord.spaceId) {
    // Best effort like the rest of the tail: an unguarded throw here skipped the edit-access sweep
    // and the stamp below, orphaning grants on a file that no longer exists.
    await kvs.delete(`space-protection-${sealRecord.spaceId}-${artifactId}`).catch((e) =>
      console.warn("[SEAL-DELETED] index row delete failed (continuing cleanup):", errText(e)));
  }

  // Remove content property — ONLY when this was the page's last live seal (the `protection-`
  // property is ONE per page and mirrors the page's seals for CQL and the UI). The check is the one
  // every remover shares (sealing/logic.js).
  if (pageId) await releaseSealContentPropIfLast(pageId, artifactId);

  // Clear any Edit Requests / grants tied to this seal
  await sweepEditAccess(artifactId).catch((e) => console.warn("[SEAL-DELETED] edit-access sweep failed:", errText(e)));
  // The file is gone for good: its "notify me when unsealed" watches and the sweep's reminder
  // counters have nothing left to describe (parity with purge-seal-record / releaseSeal). Not the
  // whole releaseSeal: that also rewrites the page body for the panel, and this runs from inside
  // the page pipeline's media pass, whose own write would then race it.
  await sweepWatchers(artifactId).catch(() => {});
  await kvs.delete(`expiry-notified-${artifactId}`).catch(() => {});
  await kvs.delete(`fifty-percent-reminder-sent-${artifactId}`).catch(() => {});
  await kvs.delete(`reminder-sent-${artifactId}`).catch(() => {});

  await touchSealTimestamp();
  console.warn(`[SEAL-DELETED] Cleaned up seal records for ${artifactId}`);
}

// --- Shared violation notification logic ---
async function sendViolationNotifications(sealRecord, artifactId, contentId, atlassianId, artifactName, actionVerb, revertedVersion = null) {
  const bulletinToggles = await resolveBulletinToggles();

  const dispatchType = actionVerb === "delete" ? "trash-restored"
    : actionVerb === "content-removal" ? "content-reverted"
    : actionVerb === "permanently-deleted" ? "seal-released"
    : actionVerb === "layout-changed" ? "presentation-restored"
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
    revertedVersion: revertedVersion || null, // page-body outcomes only (an attachment edit has no page version)
  };

  await recordDispatch(dispatchPayload);

  // Post Confluence comment with @mentions of owner and editor.
  // Confluence's notification engine emails the seal owner.
  // Fix 3: at most one comment per (page, attachment, class) per 24h / until a clean save —
  // the dispatch record above still fires per occurrence. Hunt H1-F5: the claim happens only
  // when the comment channel is ON and is released if the post fails (postDedupedFootnote) —
  // a toggled-off week or a transient 5xx must not consume the dedup window.
  await postDedupedFootnote(bulletinToggles, contentId, artifactId, actionVerb, sealRecord.lockedBy, atlassianId, artifactName, actionVerb, { targetKind: "attachment", revertedVersion });

  if (bulletinToggles?.ENABLE_TOAST_DISPATCHES) {
    const violationKey = `violation-alert-${sealRecord.lockedBy}-${artifactId}-${Date.now()}`;
    await setWithTtl(violationKey, dispatchPayload, 3600000);
  }
}

// --- Lifecycle Trigger (Forge Trigger) ---
// Pillar 12 (2026-10-02, docs/BACKUP-AND-RESTORE.md): the uninstall handler NO LONGER wipes KVS.
// Forge already soft-deletes an uninstalled app's storage and purges it after 28 days; wiping it
// here made Atlassian's 21-day "re-link data to a reinstalled app" path restore an EMPTY store
// for every Sentinel Vault customer. The setup itself survives in the backup page (capsules/
// backup); the KVS is left for the platform's own retention, which is the privacy guarantee.
// On install, nothing is written either: the site console finds a backup on its own (rediscovery).
export async function lifecycleTrigger(event) {
  try {
    if (event?.eventType === "avi:forge:uninstalled:app" || event?.eventType === "avi:forge:installed:app") {
      console.log(`[LIFECYCLE] ${event.eventType} — storage left to Forge's own retention; the backup page survives in Confluence`);
    }
  } catch (error) {
    console.error("Lifecycle trigger error:", errText(error));
  }
}

// --- GAP 2 (req 2.3): re-run the sealed-section restore for one page, outside the trigger ---
// Same passes and the same write/notify path the trigger uses (restoreSealedSectionsPass →
// writeDocBody → dispatchPipelineNotification), with the actor taken from the version being
// judged (its author), so an owner's own last edit re-baselines exactly as it would have in
// the trigger. Returns { clean } — true when the page was confirmed clean (nothing to write, or
// the restore was written); false when the write could not be confirmed and the marker should
// stay for the next sweep.
// Does an enforced workflow own this page right now? The trigger probe's test (enforce-rules.js
// isEnforcedNow): null = no, the retry runs; otherwise the retry's answer. Unreadable = held (fail closed).
async function retryHeldByWorkflow(pageId) {
  let record;
  try { record = await readPageWorkflow(pageId); } catch (_) { return { clean: false, reason: "workflow record unreadable" }; }
  if (!record?.enforce) return null;
  let enforced = false;
  try {
    // enforce-rules.js isEnforcedNow, the probe's and the sweep's rule (a state gone from the
    // workflow counts as enforced); where the page is is asked only when the state alone does not say.
    const def = await resolveWorkflowDef(record.spaceKey, record.workflowId);
    enforced = isEnforcedNow(record, def, { known: true, moved: false });
    if (!enforced && record.enforce === true) enforced = isEnforcedNow(record, def, await recordAuthority({ contentId: pageId, storedKey: record.spaceKey || null }));
  } catch (_) { enforced = true; }
  if (!enforced) return null;
  const live = await fetchLivePageVersion(pageId);
  if (typeof live === "number" && typeof record.approvedVersion === "number" && live <= record.approvedVersion) {
    return { clean: true, reason: "approved page at its baseline" };
  }
  return { clean: false, reason: "approved page: the workflow enforcement owns it" };
}

export async function runSectionRestoreForPage(pageId) {
  const systemAccountId = await resolveAppAccountId();
  if (!systemAccountId) return { clean: false, reason: "app account unresolved" };
  const globalPolicy = await kvs.get("admin-settings-global");
  if (!contentProtectionEnabled(globalPolicy)) return { clean: true, reason: "content protection off" };
  const sectionSeals = await collectSectionSealsForPage(pageId);
  if (sectionSeals.length === 0) return { clean: true, reason: "no section seals" };
  // An Approved (enforced) page is the workflow's: this path restores only the sealed section, while
  // Pass 0 and the workflow sweep revert or demote the WHOLE change. The retry stands down there and
  // keeps its marker until then (it goes when the page is at its approved baseline: nothing pending).
  const hold = await retryHeldByWorkflow(pageId);
  if (hold) return hold;

  const MAX_RETRIES = 3;
  const probeCache = new Map();
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let ctx;
    try {
      const { pageData, adfDoc } = await readDocBody(pageId);
      const authorId = pageData.version?.authorId || null;
      ctx = {
        pageId, atlassianId: authorId, pageData, adfDoc,
        currentVersion: pageData.version?.number, readAuthorId: authorId, appAccountId: systemAccountId,
        changed: false, enforcedRevert: false, notifications: [],
      };
    } catch (err) {
      console.error(`[SECTION-RETRY] page ${pageId}: read failed:`, errText(err));
      return { clean: false, reason: "read failed" };
    }
    if (ctx.atlassianId === systemAccountId) {
      // Our own write is the live version: the restore landed. The page is clean by definition.
      return { clean: true, reason: "app authored the live version" };
    }
    try { await restoreSealedSectionsPass(ctx, sectionSeals, probeCache); }
    catch (e) { console.error("[SECTION-RETRY] section pass error:", errText(e)); return { clean: false, reason: "pass error" }; }
    if (!ctx.changed) return { clean: true, reason: "nothing to write" };

    const putRes = await writeDocBody(ctx.pageId, ctx.pageData, ctx.adfDoc, "(Sentinel Vault restored protected content)");
    if (putRes.ok) {
      const writtenVersion = (ctx.currentVersion || 0) + 1;
      for (const n of ctx.notifications) {
        try { await dispatchPipelineNotification(n, writtenVersion); }
        catch (e) { console.error("[SECTION-RETRY] notify error:", errText(e)); }
      }
      await touchSealTimestamp();
      return { clean: true, reason: "restored", version: writtenVersion };
    }
    if (putRes.status === 409) {
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
      continue;
    }
    console.error(`[SECTION-RETRY] page ${pageId}: write failed ${putRes.status}`);
    return { clean: false, reason: `write ${putRes.status}` };
  }
  return { clean: false, reason: "409 exhausted" };
}

// --- Early guard (2026-09-17): run the page pipeline NOW instead of waiting for the event ---
// Tester report: text typed into a sealed section stayed on the page for 20–25 minutes. The
// restore was never slow — the `updated:page` EVENT was (measured 9–10 min late on 2026-09-15).
// Enforcement cannot be made to depend on event delivery alone, so two callers deliver the same
// event early: the `guard-page-now` resolver (the sealed-section macro and the ribbon call it
// when someone VIEWS the page — which the editor does the moment they publish) and the
// five-minute `pageGuardSweep`. Both build a synthetic `updated:page` event from the LIVE
// version and hand it to pageContentTrigger — the identical pipeline (enforce pass, sections,
// media, dedup, notices), which is already safe under at-least-once delivery, so the real
// event arriving later reads the app's own restore and exits.
const PAGE_GUARD_PREFIX = "page-guard-";
const PAGE_GUARD_TTL_MS = 30 * 24 * 3600 * 1000;
const PAGE_GUARD_ECHO_MS = 3 * 60 * 1000;

async function readLiveVersion(pageId) {
  const res = await appConfluence(route`/wiki/api/v2/pages/${pageId}`, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const data = await res.json();
  return { number: data?.version?.number || null, authorId: data?.version?.authorId || null, status: data?.status || null };
}

/**
 * @returns {{ checked: boolean, restored: boolean, workflowChanged?: boolean, reason?: string, version?: number, authorId?: string|null, restoredVersion?: number }}
 */
export async function guardPageNow(pageId, source = "view") {
  const systemAccountId = await resolveAppAccountId();
  if (!systemAccountId) return { checked: false, restored: false, reason: "app account unresolved" };
  const live = await readLiveVersion(pageId);
  if (!live?.number || live.status !== "current") return { checked: false, restored: false, reason: "page unreadable" };
  const key = `${PAGE_GUARD_PREFIX}${pageId}`;
  const seen = await kvs.get(key);
  if (seen?.version >= live.number) {
    // A page with several sealed sections mounts several macros; all but the first land here.
    // For a short window they are told what the first caller's run restored, so the macro whose
    // section it was can say so (and the others stay silent).
    // The same echo for a demote: the banner and a section macro race for the first call, and the
    // banner must still learn the page left Approved when the macro's call ran the pipeline.
    const r = seen.restored;
    const fresh = (at) => !!at && Date.now() - new Date(at).getTime() < PAGE_GUARD_ECHO_MS;
    const wfEcho = fresh(seen.workflowChanged?.at);
    if (r && fresh(r.at)) {
      return { checked: false, restored: true, workflowChanged: wfEcho, version: r.from, authorId: r.authorId, restoredVersion: seen.version, sectionIds: r.sectionIds || [] };
    }
    if (wfEcho) return { checked: false, restored: false, workflowChanged: true, reason: "version already judged", version: live.number };
    return { checked: false, restored: false, reason: "version already judged", version: live.number };
  }
  const startedAt = Date.now();
  // Claim BEFORE the work: a page with five sealed sections mounts five macros that all call
  // this at once. (No CAS in KVS — a lost race runs the pipeline twice, which it tolerates.)
  await setWithTtl(key, { version: live.number, at: new Date().toISOString(), source }, PAGE_GUARD_TTL_MS);
  if (live.authorId === systemAccountId) return { checked: true, restored: false, reason: "app authored the live version", version: live.number };

  console.info(`[PAGE-GUARD] ${source}: judging page=${pageId} v=${live.number} author=${live.authorId ? "set" : "none"} ahead of its event`);
  const run = await pageContentTrigger({
    eventType: "avi:confluence:updated:page",
    atlassianId: live.authorId,
    content: { id: String(pageId), version: { number: live.number } },
  });
  const after = await readLiveVersion(pageId);
  const restored = !!(after?.number > live.number && after.authorId === systemAccountId);
  // A demote moves the page out of Approved WITHOUT a page write, so `restored` stays false; the
  // banner re-reads the workflow on this flag (else it showed "Approved vN" until a reload).
  const workflowChanged = run?.demoted === true;
  // SEC-4 (a): this run sealed at least one wrapper on publish (a record written and its id stamped).
  const adoptedOnPublish = (run?.adopted || 0) > 0;
  let sectionIds = [];
  if (restored) {
    // Which sealed sections this run put back — read from the dispatch records the pipeline
    // wrote (they exist only after a CONFIRMED write, SV-M2).
    try {
      const recent = (await kvs.get("recent-notifications"))?.events || [];
      sectionIds = [...new Set(recent
        .filter((e) => String(e.pageId) === String(pageId) && e.sectionId && new Date(e.timestamp).getTime() >= startedAt - 1000)
        .map((e) => e.sectionId))];
    } catch (_) { /* the notice is a courtesy; the restore already happened */ }
  }
  if (restored || workflowChanged) {
    const at = new Date().toISOString();
    await setWithTtl(key, {
      version: restored ? after.number : live.number, at, source,
      ...(restored ? { restored: { from: live.number, authorId: live.authorId, sectionIds, at } } : {}),
      ...(workflowChanged ? { workflowChanged: { at } } : {}),
    }, PAGE_GUARD_TTL_MS);
  }
  return { checked: true, restored, workflowChanged, version: live.number, authorId: live.authorId, restoredVersion: restored ? after.number : undefined, sectionIds, adoptedOnPublish };
}

// Pages that carry a live seal whose PAGE BODY the app protects: sealed sections, and sealed
// attachments embedded in the body. Bounded per run; the cursor rotates so a site with more
// pages than one run can judge still reaches all of them within a few runs.
const PAGE_GUARD_SWEEP_CAP = 40;
const PAGE_GUARD_BUDGET_MS = 40_000;
async function collectGuardedPageIds() {
  const pages = new Set();
  const sealPages = new Set(); // every page a seal record names (self-heal of its KVS marker)
  const now = Date.now();
  const live = (v) => !(v?.expiresAt && new Date(v.expiresAt).getTime() <= now);
  for (const [prefix, pick] of [
    ["section-protection-", (v) => (v?.lockedBy && v?.sectionId ? v.pageId : null)],
    ["protection-", (v) => (v?.lockedBy && !v?.trashedOnly && v?.embedded !== false ? v.contentId : null)],
  ]) {
    let q = kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100);
    let iters = 0;
    do {
      const { results, nextCursor } = await q.getMany();
      for (const { key, value } of results || []) {
        const id = live(value) ? pick(value) : null;
        if (id) pages.add(String(id));
        const sp = sealPageOf(key, value);
        if (sp) sealPages.add(sp);
      }
      if (!nextCursor || ++iters >= 20) break;
      q = kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100).cursor(nextCursor);
    } while (true);
  }
  try {
    const h = await healGuardMarkers(sealPages);
    if (h.written) console.warn(`[GUARD-MARKER] self-heal wrote ${h.written} missing marker(s)`);
  } catch (e) { console.error("[GUARD-MARKER] self-heal failed:", errText(e)); }
  return [...pages].sort();
}

// Tester report 2026-09-22 (item 7, "Require a heading does nothing on save"): the validation
// phase rides the page event, which on this platform can arrive 10+ minutes late, and the ribbon's
// guard call only runs for someone who VIEWS the page afterwards. With validation on, every page
// edited in the last VALIDATION_SWEEP_LOOKBACK is judged by the sweep as well (guardPageNow skips a
// version it has already seen in one KVS read), so a rule's verdict lands within a sweep interval
// whether or not the event or a viewer ever shows up. One CQL search per run, bounded.
const VALIDATION_SWEEP_LOOKBACK = "-20m";
const VALIDATION_SWEEP_LIMIT = 50;
async function collectRecentlyEditedPagesForValidation() {
  let cfg = null;
  try { cfg = await kvs.get("validation-config-global"); } catch (_) { return []; }
  if (!cfg || cfg.enabled !== true || !(cfg.rules || []).length) return [];
  try {
    const cql = `type = page and lastmodified > now("${VALIDATION_SWEEP_LOOKBACK}") order by lastmodified desc`;
    const res = await appConfluence(route`/wiki/rest/api/content/search?cql=${cql}&limit=${String(VALIDATION_SWEEP_LIMIT)}`, { headers: { Accept: "application/json" } });
    if (!res.ok) { console.warn(`[PAGE-GUARD] validation lookback search answered ${res.status}`); return []; }
    const data = await res.json();
    return (data?.results || []).map((r) => String(r.id)).filter((id) => /^\d+$/.test(id));
  } catch (e) { console.warn("[PAGE-GUARD] validation lookback search failed:", errText(e)); return []; }
}

// Deferred restore decisions (shared/trash-rights.js deferRestoreCheck): re-judge each with the
// marker it was judged against. Still busy → try again next sweep, enforced after
// RESTORE_RECHECK_MAX_TRIES (never left alone for good); no live seal any more → dropped.
export async function sweepRestoreRechecks({ limit = 20 } = {}) {
  let judged = 0, enforced = 0, left = 0;
  try {
    const { results } = await kvs.query().where("key", WhereConditions.beginsWith(RESTORE_RECHECK_PREFIX)).limit(limit).getMany();
    for (const { key, value } of results || []) {
      try {
        const attId = value?.attachmentId;
        const seal = attId ? await kvs.get(`protection-${attId}`) : null;
        if (!attId || !seal?.lockedBy || seal.trashedOnly || (seal.expiresAt && new Date(seal.expiresAt).getTime() <= Date.now())) { await kvs.delete(key); continue; }
        const verdict = await judgeRestoreWrite(value.mark, value.accountId, value.version, {
          sealedFileId: seal.sealedFileId || null, sealedVersion: seal.sealedVersion ?? null,
          readFileId: (v) => fileIdAtVersion(attId, v), now: Number(value.eventAt) || Date.now(),
        });
        judged++;
        if (verdict === "restore") { await kvs.delete(key); continue; }
        const tries = (Number(value.tries) || 0) + 1;
        if (verdict === "unknown" && tries < RESTORE_RECHECK_MAX_TRIES) {
          await deferRestoreCheck({ ...value, tries });
          left++;
          continue;
        }
        await kvs.delete(key);
        enforced++;
        await handleSealedArtifactEdit(seal, attId, value.pageId || null, value.accountId, { id: attId, version: { number: value.version } }, { restoreJudged: true });
      } catch (e) { console.error("[RESTORE-RECHECK] one row failed:", errText(e)); }
    }
  } catch (e) { console.error("[RESTORE-RECHECK] sweep failed:", errText(e)); }
  if (judged) console.info(`[RESTORE-RECHECK] judged=${judged} enforced=${enforced} left=${left}`);
  return { judged, enforced, left };
}

export async function pageGuardSweep(event = null, context = null) {
  const started = Date.now();
  await sweepRestoreRechecks();
  // 8.14.1: the one-time scrub of pre-8.14 validation mirrors starts from here (one KVS read per fresh
  // instance once it is done, nothing after that). Confluence installation only.
  try { const { kickValidationMirrorScrub } = await import("./capsules/privacy/worker.js"); await kickValidationMirrorScrub(context || event?.context || null); }
  catch (e) { console.warn("[VALIDATION-MIRROR] kick failed:", errText(e)); }
  // Once after an upgrade or a restore: every page with a seal record gets its KVS marker.
  try { const b = await backfillGuardMarkers(); if (!b.skipped) console.info(`[GUARD-MARKER] backfill written=${b.written} done=${b.done}`); }
  catch (e) { console.error("[GUARD-MARKER] backfill failed:", errText(e)); }
  try {
    const globalPolicy = await kvs.get("admin-settings-global");
    // The markers are kept complete whatever the switch says: when protection is switched back on, the
    // pipeline must find every sealed page from its first event.
    const guarded = await collectGuardedPageIds();
    if (!contentProtectionEnabled(globalPolicy)) return { pages: 0, judged: 0, restored: 0 };
    const recent = await collectRecentlyEditedPagesForValidation();
    // Recently edited pages go FIRST (their verdict is what someone is waiting for); the rotating
    // cursor below still walks the guarded set fairly.
    const pages = [...new Set([...recent, ...guarded])];
    if (pages.length === 0) return { pages: 0, judged: 0, restored: 0 };
    const state = (await kvs.get("page-guard-sweep-cursor")) || { after: null };
    const startAt = state.after ? Math.max(0, pages.findIndex((p) => p > state.after)) : 0;
    const order = [...pages.slice(startAt), ...pages.slice(0, startAt)].slice(0, PAGE_GUARD_SWEEP_CAP);
    let judged = 0, restored = 0, last = null;
    for (const pageId of order) {
      if (Date.now() - started > PAGE_GUARD_BUDGET_MS) break;
      try {
        const r = await guardPageNow(pageId, "sweep");
        if (r.checked) judged++;
        if (r.restored) restored++;
      } catch (e) { console.error(`[PAGE-GUARD] sweep: page ${pageId} failed:`, errText(e)); }
      last = pageId;
    }
    await kvs.set("page-guard-sweep-cursor", { after: order.length < pages.length ? last : null, at: new Date().toISOString() });
    if (judged || restored) console.info(`[PAGE-GUARD] sweep: ${pages.length} guarded pages, ${judged} judged ahead of their event, ${restored} restored`);
    return { pages: pages.length, judged, restored };
  } catch (e) {
    console.error("[PAGE-GUARD] sweep failed:", errText(e));
    return { pages: 0, judged: 0, restored: 0, error: true };
  }
}

// Walk the section-restore-pending-* markers (≤ SECTION_RETRY_SWEEP_CAP per run) and retry each.
async function sweepSectionRestoreRetries() {
  let retried = 0, cleaned = 0;
  let q = kvs.query().where("key", WhereConditions.beginsWith(SECTION_RETRY_PREFIX)).limit(100);
  let iters = 0;
  do {
    const { results, nextCursor } = await q.getMany();
    for (const { key, value } of results || []) {
      if (retried >= SECTION_RETRY_SWEEP_CAP) return { retried, cleaned };
      retried++;
      const pageId = value?.pageId || key.slice(SECTION_RETRY_PREFIX.length);
      try {
        const res = await runSectionRestoreForPage(pageId);
        if (res.clean) {
          await kvs.delete(key);
          cleaned++;
          console.warn(`[SECTION-RETRY] page ${pageId}: clean (${reasonText(res.reason)}) — marker cleared`);
        } else {
          await setWithTtl(key, nextRetryMarker(value, pageId, new Date().toISOString()), SECTION_RETRY_TTL_MS);
          console.warn(`[SECTION-RETRY] page ${pageId}: still pending (${reasonText(res.reason)}) — will retry next sweep`);
        }
      } catch (e) { console.error(`[SECTION-RETRY] page ${pageId}: retry error:`, errText(e)); }
    }
    if (!nextCursor || ++iters >= 5) break;
    q = kvs.query().where("key", WhereConditions.beginsWith(SECTION_RETRY_PREFIX)).limit(100).cursor(nextCursor);
  } while (true);
  return { retried, cleaned };
}

// --- Expiry Sweep Task (Scheduled Job) ---
// The hourly job is two jobs: the seal sweep below (section-restore retries, reminders, lapse
// releases — which returns early when auto-unseal is OFF or no seal exists) and the K1 backfill of
// the edit-request owner index behind "edit requests waiting on me". The backfill used to sit at
// the END of the seal sweep, so every early return skipped it: on a site with auto-unseal off the
// index was never backfilled at all. It now runs after the seal sweep, whatever that returned.
export async function expirySweepTask() {
  const result = await expirySweepSeals();
  // K1: the owner index behind "edit requests waiting on me" is backfilled hourly.
  let editreqIndex = { backfilled: 0 };
  try { editreqIndex = await sweepEditRequestIndex(); } catch (e) { console.error("[EXPIRY-SWEEP] editreq index", errText(e)); }
  try {
    const body = JSON.parse(result?.body || "{}");
    body.editreqIndexBackfilled = editreqIndex?.backfilled ?? 0;
    return { ...result, body: JSON.stringify(body) };
  } catch (_) {
    return result;
  }
}

// Confirm a page the batched lookup reported `missing` before the sweep acts on it: the batch
// only knows PAGES (a blog post always reads as missing there), so ask for the id directly as a
// page and as a blog post. "missing" only when both answer 404; a trashed copy reads as trashed;
// any other answer is "unknown" — an unproven negative must not release anything.
async function confirmContainerStatus(id) {
  let sawOnly404 = true;
  for (const coll of ["pages", "blogposts"]) {
    try {
      const res = await appConfluence(
        coll === "pages" ? route`/wiki/api/v2/pages/${id}` : route`/wiki/api/v2/blogposts/${id}`,
        { headers: { Accept: "application/json" } },
      );
      if (res.ok) {
        const body = await res.json().catch(() => null);
        return body?.status === "trashed" ? "trashed" : "current";
      }
      if (res.status !== 404) sawOnly404 = false;
    } catch (_) { sawOnly404 = false; }
  }
  return sawOnly404 ? "missing" : "unknown";
}

async function expirySweepSeals() {
  try {
    // GAP 2 (req 2.3): section-restore retries run FIRST and regardless of the auto-unseal policy
    // below — a restore that lost its 409 race has nothing to do with expiry.
    try {
      const r = await sweepSectionRestoreRetries();
      if (r.retried) console.warn(`[SECTION-RETRY] sweep: ${r.retried} retried, ${r.cleaned} cleaned`);
    } catch (e) { console.error("[SECTION-RETRY] sweep failed:", errText(e)); }

    // Read policy and bulletin toggles once for the entire task
    const systemPolicy = await kvs.get("admin-settings-global");
    const autoUnsealActive = systemPolicy?.autoUnlockEnabled !== false;
    const bulletinToggles = await resolveBulletinToggles(systemPolicy);

    if (!autoUnsealActive) {
      return {
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ notifiedCount: 0, fiftyPctReminders: 0, autoReleasedCount: 0 }),
      };
    }

    // F5: how many overdue reminders an owner gets before the seal is released for them, and
    // how far apart. Stewards can tune both in admin-settings-global; the defaults are the
    // owner's brief — three reminders, one a day. 0 disables the release and keeps the pre-F5
    // behaviour of reminding once and holding the seal indefinitely.
    const { limit: lapseNoticeLimit, intervalMs: lapseNoticeIntervalMs } = resolveLapsePolicy(systemPolicy);

    // Determine if halfway reminders should be sent
    const sendHalfwayAlerts =
      bulletinToggles.ENABLE_NATIVE_NOTIFICATIONS &&
      bulletinToggles.ENABLE_HALFWAY_REMINDER_NOTICE;

    // audit C1: cursor-paginate — a single limit(100) meant expiry + 50% notices were never
    // processed for seals beyond the first 100 instance-wide (a permanent blind spot).
    // SEC-7 (d) (2026-09-20): SECTION seals ride the same sweep — the same clock, the same
    // reminders, the same auto-release after the reminders run out. `lapseSubject` (pure,
    // shared/lapse-policy.js) is the one mapping between the two record shapes.
    const subjects = [];
    for (const [prefix, kind] of [["protection-", "attachment"], ["section-protection-", "section"]]) {
      let sq = kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100);
      let si = 0;
      do {
        const { results, nextCursor } = await sq.getMany();
        for (const e of results || []) {
          // `protection-` is not a prefix of `section-protection-`, and neither of the other index
          // families (space-protection-…, section-snapshot-…), so each loop sees exactly its own kind.
          const subject = lapseSubject(kind, e.key, e.value);
          if (subject) subjects.push({ ...subject, value: e.value });
        }
        if (!nextCursor || ++si >= 50) break;
        sq = kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100).cursor(nextCursor);
      } while (true);
    }

    if (!subjects.length) {
      return {
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ notifiedCount: 0, fiftyPctReminders: 0, autoReleasedCount: 0 }),
      };
    }

    const now = new Date();
    let notifiedCount = 0;
    let halfwayAlertsSent = 0;
    let autoReleasedCount = 0;

    // Where each page that may get a notice this run IS (2026-10-11): a seal on a trashed or
    // purged page used to retry its notice every hour forever (404 "Could not find container",
    // counter never advanced, never released). One batched lookup for the pages of the lapsed and
    // halfway-due seals; a `missing` answer is re-checked per page (confirmContainerStatus) before
    // anything is released on it. decideLapseDelivery (pure, shared/lapse-policy.js) decides.
    const statusPageIds = new Set();
    for (const s of subjects) {
      if (!s.pageId) continue;
      const exp = new Date(s.value.expiresAt).getTime();
      const start = new Date(s.value.timestamp).getTime();
      const halfwayDue = sendHalfwayAlerts && Number.isFinite(start) && now.getTime() >= start + (exp - start) * 0.5;
      if (now.getTime() >= exp || halfwayDue) statusPageIds.add(String(s.pageId));
    }
    let batchedStatuses = new Map();
    try { batchedStatuses = await fetchPageStatuses([...statusPageIds]); }
    catch (e) { console.warn("[EXPIRY-SWEEP] page status lookup failed — delivering as before:", errText(e)); }
    const confirmedStatuses = new Map();
    const deliveryFor = async (pageId) => {
      if (!pageId) return "deliver";
      const key = String(pageId);
      if (!confirmedStatuses.has(key)) {
        let st = batchedStatuses.get(key)?.status || "unknown";
        if (st === "missing") st = await confirmContainerStatus(key);
        confirmedStatuses.set(key, st);
      }
      return decideLapseDelivery(confirmedStatuses.get(key));
    };

    for (const subject of subjects) {
      const { kind, id: artifactId, name, pageId: subjectPageId, spaceKey: subjectSpaceKey, ownerAccountId, dedupKey, halfwayKey, value } = subject;
      const isSection = kind === "section";
      const mailOpts = { targetKind: kind };
      try {
        const expiresAt = new Date(value.expiresAt);

        // --- Lapsed seal: remind, then release (F5) ---
        if (now >= expiresAt) {
          // The page is gone for good (confirmed): nothing left to protect and nowhere to post.
          // Release now, without a notice — whatever the reminder countdown says. Not when the
          // policy never auto-releases (limit 0): "gone" is two 404s, and a page the app can no
          // longer SEE answers the same way, so a site that chose never to release keeps the seal;
          // its one reminder is counted as undeliverable instead (below) and the retries stop.
          let delivery = await deliveryFor(subjectPageId);
          if (delivery === "release-silently" && !(lapseNoticeLimit > 0)) delivery = "undeliverable";
          if (delivery === "release-silently") {
            const sentSoFar = priorNoticeCount(await kvs.get(dedupKey));
            const autoRelease = { reason: "page-deleted", noticeCount: sentSoFar, noticeLimit: lapseNoticeLimit };
            const released = isSection
              ? await releaseSectionSeal(artifactId, value, { autoRelease })
              : await releaseSeal(artifactId, value, { autoRelease, notify: false });
            if (!released.success) {
              console.error(`[EXPIRY-SWEEP] release of ${kind} ${artifactId} on deleted page ${subjectPageId} failed: ${reasonText(released.reason)}`);
              continue;
            }
            autoReleasedCount++;
            console.warn(`[EXPIRY-SWEEP] released ${kind} ${artifactId} without notice — its page ${subjectPageId} no longer exists`);
            continue;
          }
          const noticeDeliverable = delivery === "deliver";

          const prior = await kvs.get(dedupKey);
          const priorCount = priorNoticeCount(prior);
          const lastSentMs = prior?.sentAt ? new Date(prior.sentAt).getTime() : 0;
          const releaseEnabled = lapseNoticeLimit > 0;

          const decision = decideLapseAction({
            priorCount,
            lastSentMs,
            nowMs: now.getTime(),
            limit: lapseNoticeLimit,
            intervalMs: lapseNoticeIntervalMs,
          });

          if (decision.action === "wait") continue;

          // --- Reminders are exhausted: hand the file / section back ---
          // This is the case the owner reported: someone seals a file, leaves the company, and
          // the file is listed as sealed forever because the only two ways out (the owner
          // unsealing, or a steward force-unsealing) both need a person who is not coming back.
          if (decision.action === "release") {
            // A1: `autoRelease` makes the shared teardown record `seal.auto-released` /
            // `section.auto-released` once the deletion is confirmed — this is the only caller that passes it.
            const autoRelease = { reason: "lapse-policy", noticeCount: priorCount, noticeLimit: lapseNoticeLimit };
            const released = isSection
              ? await releaseSectionSeal(artifactId, value, { autoRelease })
              // A trashed page refuses comments: the watchers' release notice would only fail.
              : await releaseSeal(artifactId, value, { autoRelease, notify: noticeDeliverable });
            if (!released.success) {
              console.error(`[EXPIRY-SWEEP] auto-release of ${kind} ${artifactId} failed: ${reasonText(released.reason)}`);
              continue;
            }
            autoReleasedCount++;
            console.warn(`[EXPIRY-SWEEP] auto-released ${kind} ${artifactId} after ${priorCount} reminder(s)`);

            if (noticeDeliverable && bulletinToggles.ENABLE_NATIVE_NOTIFICATIONS && bulletinToggles.ENABLE_EXPIRY_NOTICE && subjectPageId) {
              try {
                await mailAutoReleaseNotice(
                  ownerAccountId,
                  name,
                  subjectPageId,
                  { noticeLimit: lapseNoticeLimit, ...mailOpts },
                  subjectSpaceKey, // P1-4: the seal's own space → quiet mode without a page lookup
                );
              } catch (noticeError) {
                console.error("Error posting auto-release notice:", errText(noticeError));
              }
            }
            await recordDispatch({
              id: `notification-${Date.now()}`,
              type: "seal-auto-released",
              ...(isSection ? { sectionId: artifactId } : { attachmentId: artifactId }),
              attachmentName: name,
              ownerAccountId,
              timestamp: Date.now(),
              pageId: subjectPageId,
            });
            // the teardown already dropped the counter key with the rest of the seal's state.
            continue;
          }

          // --- decision.action === "notify" ---
          const { noticeNumber, releaseAtMs } = decision;

          // Hunt H1-F6: the counter advances ONLY when the notice actually posted (or the
          // toggle deliberately suppressed it) — a transient post failure must not consume
          // one of the owner's reminders, because the release is counted off them.
          let noticePosted = false;
          const noticeWanted =
            bulletinToggles.ENABLE_NATIVE_NOTIFICATIONS &&
            bulletinToggles.ENABLE_EXPIRY_NOTICE &&
            subjectPageId;
          // 2026-10-11: the page is in the TRASH — Confluence refuses the comment (404 "Could not
          // find container"), and that is not transient: holding the counter on it meant retrying
          // every hour forever and never releasing. The reminder is counted as undeliverable so
          // the lapse policy completes (the release follows after the last one, as for any seal).
          if (noticeWanted && !noticeDeliverable) {
            noticePosted = true;
            console.warn(`[EXPIRY-SWEEP] lapse notice ${noticeNumber}/${lapseNoticeLimit} for ${kind} ${artifactId} is undeliverable — page ${subjectPageId} is ${confirmedStatuses.get(String(subjectPageId)) || "unavailable"}; counted, not posted`);
          } else if (noticeWanted) {
            try {
              const dateOpts = { year: "numeric", month: "long", day: "numeric" };
              // With auto-release off there is no deadline to name, and the countdown wording
              // would promise a release that never comes — send the plain expiry notice instead.
              const noticeResult = releaseEnabled
                ? await mailLapseNotice(
                  ownerAccountId,
                  name,
                  subjectPageId,
                  {
                    expiryDate: expiresAt.toLocaleDateString("en-US", dateOpts),
                    noticeNumber,
                    noticeLimit: lapseNoticeLimit,
                    releaseDate: new Date(releaseAtMs).toLocaleDateString("en-US", dateOpts),
                    ...mailOpts,
                  },
                  subjectSpaceKey, // P1-4
                )
                : await mailExpiryNotice(
                  ownerAccountId,
                  name,
                  subjectPageId,
                  expiresAt.toLocaleDateString("en-US", dateOpts),
                  subjectSpaceKey, // P1-4
                  mailOpts,
                );

              // P1-4: a DELIBERATE non-post (the space is in quiet mode, or the comment channel is
              // opt-out) counts like the toggle-off branch below — the owner chose not to be
              // told on the page, and the ribbon / activity still say so — so the countdown to
              // the release advances. Only a transport failure holds the counter.
              noticePosted = noticeResult?.success === true || noticeResult?.suppressed === true;
              if (!noticePosted) {
                console.warn(
                  `Failed to post lapse notice ${noticeNumber}/${lapseNoticeLimit} for ${kind} ${artifactId}: ${reasonText(noticeResult?.reason)} — counter NOT advanced (will retry next sweep)`,
                );
              }
            } catch (noticeError) {
              console.error("Error posting lapse notice (counter NOT advanced):", errText(noticeError));
            }
          }

          if (noticePosted || !noticeWanted) {
            // audit C5: TTL the counter so it can't accumulate forever. It has to outlive the
            // whole reminder run, so the window is the full countdown plus the old 7-day margin
            // — the pre-F5 `expiresAt + 7d` would have reaped the counter mid-countdown on any
            // seal whose reminders span more than a week.
            await setUntil(dedupKey, {
              sentAt: now.toISOString(),
              firstSentAt: prior?.firstSentAt || now.toISOString(),
              count: noticeNumber,
              ...(isSection ? { sectionId: artifactId } : { attachmentId: artifactId }),
            }, now.getTime() + (Math.max(lapseNoticeLimit, 1) + 1) * lapseNoticeIntervalMs + 7 * 86400000);
          }

          // Store dispatch event for page banner
          await recordDispatch({
            id: `notification-${Date.now()}`,
            type: "reservation-expired",
            ...(isSection ? { sectionId: artifactId } : { attachmentId: artifactId }),
            attachmentName: name,
            ownerAccountId,
            timestamp: Date.now(),
            pageId: subjectPageId,
          });

          notifiedCount++;
          continue;
        }

        // --- Halfway expiry reminder (only for non-expired seals) ---
        if (!sendHalfwayAlerts || !subjectPageId) {
          continue;
        }

        const sealCreatedAt = new Date(value.timestamp);
        const fullPeriod = expiresAt - sealCreatedAt;
        const midpointTime = sealCreatedAt.getTime() + fullPeriod * 0.5;

        if (now.getTime() >= midpointTime && now.getTime() < expiresAt.getTime()) {
          const previouslySent = await kvs.get(halfwayKey);
          if (previouslySent) {
            continue;
          }
          // A page in the trash (or gone) refuses the comment every hour until the seal lapses —
          // mark the halfway reminder handled instead (as a suppressed one is); the lapse branch
          // above takes it from there.
          if ((await deliveryFor(subjectPageId)) !== "deliver") {
            await setUntil(halfwayKey, { sentAt: now.toISOString(), undeliverable: true }, expiresAt.getTime() + 7 * 86400000);
            console.warn(`[EXPIRY-SWEEP] halfway reminder for ${kind} ${artifactId} is undeliverable — page ${subjectPageId} is trashed or gone`);
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
              ownerAccountId,
              name,
              subjectPageId,
              expiryDate,
              subjectSpaceKey, // P1-4: the seal's own space → quiet mode without a page lookup
              mailOpts,
            );

            // P1-4: a suppressed reminder (quiet space / channel opt-out) is marked as handled
            // too — re-composing it every hourly sweep would only burn page reads for a comment
            // the space asked not to receive.
            if (result.success || result.suppressed) {
              await setUntil(halfwayKey, {
                sentAt: now.toISOString(),
              }, expiresAt.getTime() + 7 * 86400000); // audit C5: die with the seal
              if (result.success) halfwayAlertsSent++;
            } else {
              console.warn(
                `Failed to post halfway reminder for ${kind} ${artifactId}: ${reasonText(result.reason)}`,
              );
            }
          } catch (noticeError) {
            console.error("Error posting halfway reminder:", errText(noticeError));
          }
        }
      } catch (error) {
        console.error(`Error processing ${kind} seal ${artifactId}:`, errText(error));
      }
    }

    if (notifiedCount > 0 || halfwayAlertsSent > 0 || autoReleasedCount > 0) {
      console.warn(`[EXPIRY-SWEEP] ${notifiedCount} expiry notifications, ${halfwayAlertsSent} reminders sent, ${autoReleasedCount} auto-released`);
    }
    // (The K1 edit-request index backfill runs in expirySweepTask, after this, on every path.)
    return {
      statusCode: 200,
      headers: {},
      body: JSON.stringify({ notifiedCount, fiftyPctReminders: halfwayAlertsSent, autoReleasedCount }),
    };
  } catch (error) {
    console.error("Error in expiry sweep task:", errText(error));
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
        // Hunt F12 (S7): trashedOnly tracking records are NOT seals — a merely-deleted file
        // must not generate "sealed for N days" banners.
        if (value.trashedOnly) {
          continue;
        }
        // SEC-2: a seal the workflow holds has no expiry BY DESIGN (paused) — not a never-expiring seal to nag about.
        if (isWorkflowHeld(value)) continue;

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
        // accumulates forever nor suppresses reminders when the attachment is re-sealed
        // (setUntil clamps the no-expiry 365d+7d case to the platform's TTL ceiling).
        const nudgeTtl = (value?.expiresAt ? new Date(value.expiresAt).getTime() : Date.now() + 365 * 86400000) + 7 * 86400000;
        await setUntil(nudgeKey, {
          sentAt: now.toISOString(),
          reminderNumber: (priorNudgeData?.reminderNumber || 0) + 1,
        }, nudgeTtl);

        nudgeTally.set(artifactId, (nudgeTally.get(artifactId) || 0) + 1);
      } catch (error) {
        console.error(`Error processing seal ${key} for nudge:`, errText(error));
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
    console.error("Error in recurring nudge task:", errText(error));
    return {
      statusCode: 500,
      headers: {},
      body: JSON.stringify({ reminderCount: 0, error: error.message }),
    };
  }
}

