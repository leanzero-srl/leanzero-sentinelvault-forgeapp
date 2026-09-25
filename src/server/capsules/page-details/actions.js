/*
 * Page details capsule (5.0, mockup §4) — the modal behind the byline chip.
 *
 *   page-details-summary  { pageId }  → {
 *     ok, pageId, title, contentType, spaceKey,
 *     viewer: { accountId, canEditPage, isSpaceAdmin },
 *     classification: { effective: { level, source }, pageLevelId, spaceDefault, levels, canChange },
 *     seals: [{ kind: "attachment"|"section", id, name, ownerAccountId, ownerName, expiresAt,
 *               isExpired, isMine, isTrashed, watching, link,
 *               myEditStatus: "none"|"pending"|"granted"|"denied", myEditExpiresAt,
 *               pendingRequests: [{ requesterAccountId, requesterName, reason, requestedAt }] (owner only) }],
 *     waitingOnMe, activity: { entries, nextCursor },
 *     attachments: [{ id, name, fileSize, mediaType, createdAt, version, sealed }]  (every current attachment —
 *                   the seal action's checkbox rows; a sealed one points at its row in `seals` by id),
 *     sealDefaults: { holdSeconds }   the space's default hold (resolveSealHoldPeriod — the same chain seal-artifact uses)
 *   }
 *
 * Authorization (CLAUDE.md): the payload page id is attacker-controlled; the summary names files,
 * sections, who holds every seal and who is asking to edit, so it is gated on READ of that page
 * (mustVerify skips the round-trip only for the authentic context id). `canChange` on the
 * classification block is canEditPage — the same bar classification-set-page applies on write,
 * so the picker is shown to exactly the people whose write would succeed. Everything is READ
 * here; every mutation the modal triggers goes through the existing action keys
 * (seal-artifact, unseal-artifact, extend-seal, request-edit-access, approve/deny-edit-request,
 * request-section-edit, approve/deny-section-edit, unseal-section, watch/unwatch-artifact,
 * classification-set-page) and their own gates.
 *
 * Composition, not re-implementation: seals come from collectPageSeals (one paged attachment
 * listing + protection-* by key, sections via listSectionSealRecordsForPage); edit status from
 * editreq/logic (getActiveEditGrant, getActiveSectionEditGrant) and the request records by key;
 * the level from the classification provider; activity from getPageActivity (its own gate runs
 * again — one permission call, and the feed's decoration stays in one place).
 *
 * Lazy byline refresh: a space-default change is not fanned out to every page in the space.
 * Instead this read compares what the chip SHOULD say with the stored stamp and rewrites the
 * property when they differ (writeBylineFor skips the write when they match).
 */
import { asApp, route } from "@forge/api";
import { kvs, WhereConditions } from "@forge/kvs";
import { canEditPage, canReadPage, mustVerify } from "../../shared/content-access.js";
import { authorizeSteward } from "../../shared/steward-checks.js";
import { getClassificationProvider, resolveClassificationActive } from "../classification/provider.js";
import { getActiveEditGrant, getActiveSectionEditGrant, resolveEditCooldownMs } from "../editreq/logic.js";
// WF-6: the Workflow block reads through the same helper the byline uses.
import { describeWorkflowForPage, extractApprovalConfig } from "../workflow/approvals.js";
import { getSpaceWorkflowSettings } from "../workflow/logic.js";
import { readStatus, readConfirmationRequired } from "../workflow/read-acks.js";
import { retryAtFor } from "../../shared/edit-cooldown.js";
import { getPageActivity } from "../activity/actions.js";
import { resolveSealHoldPeriod } from "../sealing/logic.js";
import { collectPageSeals, readPageMeta } from "./logic.js";
import { writeBylineFor } from "./byline.js";
import { isWorkflowHeld, heldLabel } from "../../shared/seal-authority.js"; // SEC-2

const NOT_AUTHORIZED = "Not authorized";
const NUMERIC = /^\d{1,20}$/;

const isExpired = (iso) => !!(iso && new Date(iso).getTime() <= Date.now());

async function readSpaceKey(spaceId) {
  if (!spaceId || !NUMERIC.test(String(spaceId))) return null;
  try {
    const res = await asApp().requestConfluence(route`/wiki/api/v2/spaces/${spaceId}`, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json())?.key || null;
  } catch (_) { return null; }
}

/** The caller's own edit status on a seal: grant first (it wins), then the request record. */
async function myEditStatusFor({ grant, requestKey }) {
  if (grant) return { status: "granted", expiresAt: grant.expiresAt || null };
  const existing = await kvs.get(requestKey).catch(() => null);
  if (!existing) return { status: "none", expiresAt: null };
  if (existing.status === "pending") return { status: "pending", expiresAt: null };
  if (existing.status === "denied") {
    // Past the cooldown the request may be made again; the record itself is tidied by
    // check-edit-request on the next call that reads it, not by this read.
    const retryAt = retryAtFor(existing.deniedAt, await resolveEditCooldownMs());
    return retryAt ? { status: "denied", expiresAt: null, retryAt, deniedReason: existing.deniedReason || null } : { status: "none", expiresAt: null };
  }
  return { status: "none", expiresAt: null };
}

/** Pending requests on ONE seal (owner only — the caller is the owner when this is invoked). */
async function pendingRequestsFor(prefix) {
  try {
    const { results } = await kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(50).getMany();
    return (results || [])
      .map(({ value }) => value)
      .filter((v) => v?.status === "pending")
      .map((v) => ({
        requesterAccountId: v.requesterAccountId || null,
        requesterName: v.requesterName || null,
        reason: typeof v.reason === "string" ? v.reason.slice(0, 300) : "",
        requestedAt: v.requestedAt || null,
      }));
  } catch (e) {
    console.warn("[PAGE-DETAILS] pending requests read failed:", e?.message || e);
    return [];
  }
}

export const pageDetailsSummary = async (req) => {
  const ctxPageId = req.context?.extension?.content?.id;
  const accountId = req.context?.accountId;
  const pageId = String(req.payload?.pageId || ctxPageId || "");
  const closed = (reason) => ({ ok: false, reason });
  if (!accountId || !pageId || !NUMERIC.test(pageId)) return closed(NOT_AUTHORIZED);
  if (mustVerify(req.payload?.pageId, ctxPageId) && !(await canReadPage(accountId, pageId))) return closed(NOT_AUTHORIZED);

  const meta = await readPageMeta(pageId);
  if (!meta) return closed("Could not read the page");
  const spaceKey = await readSpaceKey(meta.spaceId);

  const [canEdit, isSpaceAdmin] = await Promise.all([
    canEditPage(accountId, pageId),
    spaceKey ? authorizeSteward(accountId, spaceKey).catch(() => false) : Promise.resolve(false),
  ]);

  // ── classification ──────────────────────────────────────────────────────────────────────────
  // CLS-1: `enabled:false` (+ which switch: "site" | "space") makes the modal omit the section;
  // nothing about levels is read or answered while off, and the stored override is untouched.
  const sw = await resolveClassificationActive(spaceKey);
  let classification = { enabled: sw.active, reason: sw.reason, effective: { level: null, source: "none" }, pageLevelId: null, spaceDefault: null, levels: [], canChange: canEdit };
  if (sw.active) {
    try {
      const { provider, levels } = await getClassificationProvider();
      const [effective, pageLevelId, spaceDefaultId] = await Promise.all([
        provider.effectiveLevel(pageId),
        provider.getPageLevel(pageId),
        meta.spaceId ? provider.getSpaceDefault(meta.spaceId).catch(() => null) : Promise.resolve(null),
      ]);
      const spaceDefault = spaceDefaultId != null ? (levels.find((l) => String(l.id) === String(spaceDefaultId)) || null) : null;
      classification = { enabled: true, reason: null, effective, pageLevelId: pageLevelId ?? null, spaceDefault, levels, canChange: canEdit, provider: provider.name };
    } catch (e) {
      console.error("[PAGE-DETAILS] classification failed:", e);
      classification.error = "Could not load the classification";
    }
  }

  // ── seals ───────────────────────────────────────────────────────────────────────────────────
  const seals = [];
  let attachmentsAll = [];
  let sealError = null;
  try {
    const { attachments, sections, all } = await collectPageSeals(pageId, meta.type);
    attachmentsAll = all;
    const rows = await Promise.all([
      ...attachments.map(async ({ id, record, trashed }) => {
        const isMine = record.lockedBy === accountId;
        const [grant, watch] = await Promise.all([
          isMine ? null : getActiveEditGrant(id, accountId),
          isMine ? null : kvs.get(`notify-request-${id}-${accountId}`).catch(() => null),
        ]);
        const mine = isMine ? { status: "none", expiresAt: null } : await myEditStatusFor({ grant, requestKey: `edit-request-${id}-${accountId}` });
        const pendingRequests = isMine ? await pendingRequestsFor(`edit-request-${id}-`) : [];
        return {
          kind: "attachment", id, name: record.attachmentName || "Unknown file",
          ownerAccountId: record.lockedBy, ownerName: record.lockedByName || null,
          expiresAt: record.expiresAt || null, isExpired: isExpired(record.expiresAt), isMine, isTrashed: trashed,
          watching: !!watch, link: record.downloadLink || null, note: record.note || null,
          myEditStatus: mine.status, myEditExpiresAt: mine.expiresAt, myRetryAt: mine.retryAt || null, myDeniedReason: mine.deniedReason || null, pendingRequests,
          workflowHeld: isWorkflowHeld(record), heldLabel: heldLabel(record), // SEC-2
        };
      }),
      ...sections.map(async (record) => {
        const id = record.sectionId;
        const isMine = record.lockedBy === accountId;
        const grant = isMine ? null : await getActiveSectionEditGrant(id, accountId);
        const mine = isMine ? { status: "none", expiresAt: null } : await myEditStatusFor({ grant, requestKey: `section-edit-request-${id}-${accountId}` });
        const pendingRequests = isMine ? await pendingRequestsFor(`section-edit-request-${id}-`) : [];
        return {
          kind: "section", id, name: record.sectionTitle || "Sealed section",
          ownerAccountId: record.lockedBy, ownerName: record.lockedByName || null,
          expiresAt: record.expiresAt || null, isExpired: isExpired(record.expiresAt), isMine, isTrashed: false,
          watching: false, link: null, note: record.note || null, // SEC-7: the seal-time note, like attachments
          myEditStatus: mine.status, myEditExpiresAt: mine.expiresAt, myRetryAt: mine.retryAt || null, myDeniedReason: mine.deniedReason || null, pendingRequests,
          workflowHeld: isWorkflowHeld(record), heldLabel: heldLabel(record), // SEC-2
        };
      }),
    ]);
    seals.push(...rows);
  } catch (e) {
    console.error("[PAGE-DETAILS] seals failed:", e);
    sealError = "Could not load the seals on this page";
  }
  const sealedIds = new Set(seals.filter((r) => r.kind === "attachment").map((r) => r.id));
  const attachments = attachmentsAll.map((a) => ({ id: a.id, name: a.title || "Unknown file", fileSize: a.fileSize, mediaType: a.mediaType, createdAt: a.createdAt, version: a.version, sealed: sealedIds.has(a.id) }));
  let sealDefaults = { holdSeconds: null };
  try { sealDefaults = { holdSeconds: await resolveSealHoldPeriod(spaceKey, undefined) }; } catch (e) { console.warn("[PAGE-DETAILS] hold period:", e?.message || e); }
  const waitingOnMe = seals.reduce((n, r) => n + (r.isMine ? r.pendingRequests.length : 0), 0);

  // ── workflow (WF-6: the modal's Workflow block, above Seals) ────────────────────────────────
  // The same read the byline uses (describeWorkflowForPage), plus what the block offers the
  // viewer: the Move-to targets (with which need an approval request), whether the viewer may set
  // the review date, whether the viewer is an approver on the open request, and the readers count.
  let workflow = { assigned: false };
  try {
    const wf = await describeWorkflowForPage(pageId, { spaceKey });
    if (wf?.assigned) {
      const settings = await getSpaceWorkflowSettings(wf.record?.spaceKey || spaceKey);
      const hasApprovers = !!extractApprovalConfig(settings?.approval);
      const record = wf.record || {};
      const ar = record.approvalRecord || null;
      const reviewedVersion = (typeof ar?.pinnedVersion === "number" ? ar.pinnedVersion : null) ?? record.approvedVersion ?? null;
      const dueMs = record.reviewDueAt ? new Date(record.reviewDueAt).getTime() : NaN;
      const readers = readConfirmationRequired(settings, record)
        ? await readStatus({ pageId, accountId, record, settings }).catch(() => null)
        : null;
      workflow = {
        assigned: true,
        workflowName: wf.def?.name || null,
        state: wf.state ? { id: wf.state.id, name: wf.state.name, color: wf.state.color || "neutral" } : { id: record.stateId, name: record.stateId, color: "neutral" },
        status: wf.status,
        enforced: !!record.enforce && record.approvedVersion != null,
        enforceMode: settings?.enforceMode === "revert" ? "revert" : "demote",
        reviewedVersion,
        baselineVersion: record.approvedVersion ?? null,
        approvalSummary: wf.approvalSummary,
        // The modal composes the approval sentence ITSELF from these (workflow/status.js
        // approvalSummary in the browser) so its dates are in the viewer's zone like every other
        // date on the modal — the server-composed sentence above is UTC and stays for API readers.
        recordForSummary: { enforce: !!record.enforce, approvedVersion: record.approvedVersion ?? null, approvedAt: record.approvedAt || null, approvalRecord: ar ? { outcome: ar.outcome, completedByName: ar.completedByName || null, completedAt: ar.completedAt || null, pinnedVersion: ar.pinnedVersion ?? null, mode: ar.mode ?? null, min: ar.min ?? null, approverCount: ar.approverCount ?? null, decisions: (ar.decisions || []).map((d) => ({ decision: d.decision })) } : null },
        approvalRecord: ar ? { outcome: ar.outcome, completedByName: ar.completedByName || null, completedAt: ar.completedAt || null, requestedByName: ar.requestedByName || null, decisions: (ar.decisions || []).map((d) => ({ name: d.name, decision: d.decision, decidedAt: d.decidedAt, reason: d.reason || null, signed: !!d.signed })) } : null,
        reviewDueAt: record.reviewDueAt || null,
        reviewOverdue: Number.isFinite(dueMs) && dueMs < Date.now(),
        lastDecision: wf.lastDecision || null,
        pending: wf.pending ? {
          toStateId: wf.pending.toStateId, toStateName: wf.pending.toStateName || wf.pending.toStateId, requestedByName: wf.pending.requestedByName || null, requestedAt: wf.pending.requestedAt || null,
          decided: wf.pendingDecided, required: wf.pending.mode === "any" ? 1 : (wf.pending.min || (wf.pending.approvers || []).length), mode: wf.pending.mode || null,
          iCanDecide: wf.pending.requestedBy !== accountId && (
            (Array.isArray(wf.pending.approvers) && wf.pending.approvers.includes(accountId))
            || (isSpaceAdmin && settings?.approval?.adminsCanApprove !== false)), // admins may decide too
        } : null,
        available: (wf.available || []).filter(Boolean).map((s) => ({ id: s.id, name: s.name, color: s.color || "neutral", requiresApproval: !!(s.enforce && hasApprovers) })),
        canMove: canEdit && (wf.available || []).length > 0 && !wf.pending,
        canSetReviewDue: isSpaceAdmin,
        readers: readers?.required ? { acked: readers.ackedCount ?? 0, audience: readers.audienceCount ?? 0, mine: !!readers.acked } : null,
      };
    }
  } catch (e) { console.warn("[PAGE-DETAILS] workflow failed:", e?.message || e); workflow = { assigned: false, error: "Could not load the workflow" }; }
  // Not in the workflow yet, the space runs one, and the viewer is its admin: offer to start it
  // on THIS page (owner, 2026-09-25 — "Apply to existing pages" was the only way in).
  if (!workflow.assigned && !workflow.error && isSpaceAdmin && spaceKey) {
    try { if ((await getSpaceWorkflowSettings(spaceKey))?.enabled) workflow = { assigned: false, canStart: true }; }
    catch (_) { /* no offer */ }
  }

  // ── activity (its own read gate; one permission call) ────────────────────────────────────────
  let activity = { entries: [], nextCursor: null };
  try {
    const a = await getPageActivity({ context: req.context, payload: { pageId, limit: 10 } });
    activity = { entries: Array.isArray(a?.entries) ? a.entries : [], nextCursor: a?.nextCursor || null };
  } catch (e) { console.warn("[PAGE-DETAILS] activity failed:", e?.message || e); }

  // ── lazy byline refresh (space-default changes reach the chip on open, not by fan-out) ─────
  if (!sealError) {
    const liveSeals = seals.filter((r) => !r.isTrashed).length;
    await writeBylineFor(pageId, { level: classification.effective?.level || null, source: classification.effective?.source || "none", sealCount: liveSeals, classificationEnabled: sw.active, workflow: workflow.assigned ? workflow.status : null })
      .catch((e) => console.warn("[PAGE-DETAILS] byline refresh failed:", e?.message || e));
  }

  return {
    ok: true, pageId, title: meta.title, contentType: meta.type, spaceKey,
    viewer: { accountId, canEditPage: canEdit, isSpaceAdmin },
    classification, workflow, seals, sealError, waitingOnMe, activity, attachments, sealDefaults,
  };
};

export const actions = [
  ["page-details-summary", pageDetailsSummary],
];
