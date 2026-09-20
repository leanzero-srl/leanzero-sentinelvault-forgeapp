/*
 * Workflow state engine (ledger #42) — resolver actions.
 * Thin adapters: pull pageId / spaceKey / accountId from `req`, apply authz,
 * delegate to logic.js. Enforcement (#44) and the approver model (#43) land later.
 */
import { asApp, asUser, route } from "@forge/api";
import { currentUserProfile } from "../../shared/user-or-app.js";
import { kvs, WhereConditions } from "@forge/kvs";

import { authorizeSteward, isOperatorSiteAdmin } from "../../shared/steward-checks.js";
import { canEditPage, canReadPage, mustVerify, resolvePageSpaceKey } from "../../shared/content-access.js";
import { fetchPageStatuses } from "../../shared/page-status.js";
import {
  resolveWorkflowDef,
  loadWorkflowConfig,
  storeWorkflowConfig,
  getPageWorkflow,
  getWorkflowLog,
  lastDecisionFrom,
  assignPageWorkflow,
  transitionPageWorkflow,
  findState,
  getSpaceWorkflowSettings,
  setSpaceWorkflowSettings,
  bulkAssignPagesInSpace,
  readPageWorkflow,
  validateTransition,
  fetchLivePageVersion,
  setPageReviewDue,
  sanitize,
  listSpaceWorkflows,
  storeSpaceWorkflow,
  deleteSpaceWorkflow, restoreSpaceDefaultWorkflow } from "./logic.js";
import { runBundle } from "./bundle.js"; // WF-11
import {
  extractApprovalConfig,
  resolveApproverIds,
  requestApprovalTransition,
  decideApproval,
  getPageApprovalStatus,
  listMyApprovals,
  listMyApprovalRequests, // WF-3 (c)
  rerequestApproval,
  applyAiVerdict,
  buildApprovalRecord,
} from "./approvals.js";
import { enqueueAiGate, resolveRules } from "../validations/actions.js";
import { confirmRead, readStatus, readReport, readConfirmationRequired, requiredVersion } from "./read-acks.js";
import { signatureStatus, startEnrollment, confirmEnrollment, revokeSignature, verifySignature } from "./signature.js";
import { evaluateRules } from "../../infra/rules-engine.js";
import { readDocBody } from "../../infra/doc-surgery.js";
import { fetchPageLabels } from "../../infra/labels.js";

// #46 Part A: content-conditions gate — the space's block-severity validation rules must
// pass before the page may enter the target state. Reuses evaluateRules verbatim (sync).
// Returns a block result { success:false, ... } or null (allowed). Fail-closed on a read
// error (can't verify → don't let content through unchecked; the user can retry).
// Uses resolveRules (enabled-INDEPENDENT), NOT resolveEffectiveConfig — the transition
// condition is a deliberate steward action and must NOT silently no-op just because the
// separate space-wide post-save validation master switch happens to be off.
async function checkContentConditions(pageId, spaceKey) {
  const rules = await resolveRules(spaceKey);
  if (!rules.length) return null; // no authored rules → nothing to gate on
  let adfDoc;
  try { ({ adfDoc } = await readDocBody(pageId)); }
  catch (_) { return { success: false, blocked: true, reason: "Could not read the page to check content conditions — please retry." }; }
  const labels = await fetchPageLabels(pageId);
  const { passed, violations } = evaluateRules(adfDoc, labels, rules);
  if (passed) return null;
  return {
    success: false,
    blocked: true,
    reason: "This page doesn't yet meet the content requirements for that state.",
    violations: violations.filter((v) => v.severity === "block"),
  };
}

const pageIdOf = (req) =>
  req.payload?.pageId ||
  req.context?.extension?.content?.id ||
  req.context?.extension?.content?.content?.id ||
  null;

const spaceKeyOf = (req) =>
  req.payload?.spaceKey ||
  req.context?.extension?.content?.space?.key ||
  req.context?.extension?.space?.key ||
  null;

const ctxPageIdOf = (req) =>
  req.context?.extension?.content?.id ||
  req.context?.extension?.content?.content?.id ||
  null;

/**
 * SV-SEC-1. May this caller READ the page these actions are about?
 *
 * pageIdOf prefers req.payload.pageId, which is attacker-controlled, so every read-only
 * workflow action would otherwise hand back another page's state, history or approver list.
 * A context id is skipped: rendering the ribbon there already required read access.
 */
async function callerMayReadPage(req, pageId) {
  if (!mustVerify(req.payload?.pageId, ctxPageIdOf(req))) return true;
  return canReadPage(req.context?.accountId, pageId);
}

async function actorName(accountId) {
  try { return (await currentUserProfile(accountId)).displayName || null; }
  catch (_) { return null; }
}

const getWorkflow = async (req) => {
  const pageId = pageIdOf(req);
  if (!pageId) return { assigned: false, reason: "No page context" };
  if (!(await callerMayReadPage(req, pageId))) return { assigned: false, reason: "No page context" };
  const result = await getPageWorkflow(pageId, spaceKeyOf(req));
  // Flag which available transitions require approval (enforce state + approvers
  // configured) so the ribbon can say "Request approval" instead of "Move to".
  if (result?.assigned && Array.isArray(result.available)) {
    const settings = await getSpaceWorkflowSettings(result.record?.spaceKey || spaceKeyOf(req));
    const hasApprovers = !!extractApprovalConfig(settings.approval);
    result.available = result.available.map((s) => ({ ...s, requiresApproval: !!(s.enforce && hasApprovers) }));
    // A4: the ribbon's "changed since approval" line says what happens to the edit; that is the
    // space's enforce mode, which the settings read above already holds.
    result.enforceMode = settings?.enforceMode === "revert" ? "revert" : "demote";
    // A5: the ribbon turns the "Review due" chip into a button only for someone set-review-due
    // would accept — a steward of the page's own space (the edit check runs on the write).
    result.canSetReviewDue = !!(req.context?.accountId && result.record?.spaceKey)
      && await authorizeSteward(req.context.accountId, result.record.spaceKey);
    // B2: whether this page asks its readers to confirm; the counts come from get-read-status.
    result.readConfirmation = readConfirmationRequired(settings, result.record)
      ? { required: true, version: requiredVersion(result.record), canReport: result.canSetReviewDue }
      : { required: false };
  }
  // A4/A6: the page's CURRENT version, so the ribbon can say "changed since approval (now v{n})"
  // next to the approval evidence without a second resolver call. Best-effort: null on failure
  // (the ribbon then just omits the stale line — never a guess). Not added to get-workflow-log.
  if (result?.assigned && result.record?.enforce) result.liveVersion = await fetchLivePageVersion(pageId); // only where the ribbon uses it
  // WF-3: on a page that is not enforced and has no open request, the ribbon's details chip shows
  // the last denial (with its reason) or stale close — the author was reading "In Review · Set
  // review date" after a rejection and the reason existed only in this log. One KVS query, only
  // when it can matter.
  if (result?.assigned && !result.record?.enforce && !(await kvs.get(`workflow-pending-${pageId}`))) {
    const log = req.payload?.withLog ? (result.log = await getWorkflowLog(pageId)) : await getWorkflowLog(pageId);
    result.lastDecision = lastDecisionFrom(log);
  } else if (req.payload?.withLog) result.log = await getWorkflowLog(pageId);
  return result;
};

const getLog = async (req) => {
  const pageId = pageIdOf(req);
  if (!pageId) return { log: [] };
  // The log names who moved the page between states and when — history about a page the
  // caller may not be able to open.
  if (!(await callerMayReadPage(req, pageId))) return { log: [] };
  return { log: await getWorkflowLog(pageId) };
};

const assignWorkflow = async (req) => {
  const pageId = pageIdOf(req);
  const actorAccountId = req.context?.accountId;
  if (!pageId) return { success: false, reason: "No page context" };
  // SV-SEC-1 (confused deputy). The gate used to name spaceKeyOf(req) — the payload's spaceKey —
  // while the mutation targeted the payload's pageId. Two different objects, so a steward of any
  // one space could reset the workflow state of ANY page on the site, wiping the enforce baseline
  // that powers approved-page protection. requestTransition below already states the doctrine:
  // the authoritative space is the PAGE's own, never a caller-supplied one. Same here — and the
  // resolved key is what gets stored, so the index row cannot be filed under a foreign space.
  const spaceKey = (await readPageWorkflow(pageId))?.spaceKey || await resolvePageSpaceKey(pageId);
  if (!spaceKey) return { success: false, reason: "Could not resolve this page's space" };
  // Assigning a workflow is a steward act in v1 (per-page-owner assignment arrives with #43).
  if (!(await authorizeSteward(actorAccountId, spaceKey))) {
    return { success: false, reason: "Only a space admin can assign a workflow" };
  }
  return assignPageWorkflow({
    pageId,
    spaceKey,
    actorAccountId,
    actorName: await actorName(req.context?.accountId),
    workflowId: req.payload?.workflowId,
  });
};

export const requestTransition = async (req) => {
  const pageId = pageIdOf(req);
  const actorAccountId = req.context?.accountId;
  const toStateId = req.payload?.toStateId;
  if (!pageId || !toStateId) return { success: false, reason: "pageId and toStateId required" };

  // Authoritative space = the page's OWN workflow record, never a caller-supplied
  // spaceKey (else a steward of space X could drive an enforce transition on a page in
  // space Y). A transition requires the page to already have a workflow.
  const current = await readPageWorkflow(pageId);
  if (!current) return { success: false, reason: "Page has no workflow assigned" };
  const spaceKey = current.spaceKey || spaceKeyOf(req);

  // SV-SEC-1. The space was already derived correctly (above), but nothing checked the CALLER
  // against the page at all — so any logged-in user could move any workflow-assigned page to any
  // non-enforce state. Moving a page's governance state is changing the page, so the bar is being
  // able to change the page.
  if (!(await canEditPage(actorAccountId, pageId))) {
    return { success: false, reason: "You do not have permission to change this page's state" };
  }

  // Entering an `enforce`-marked state (e.g. Approved): if the space has approvers
  // configured (#43), open a multi-approver approval instead of transitioning now;
  // otherwise fall back to the #42 steward gate. B1: judged by the PAGE's workflow.
  const def = await resolveWorkflowDef(spaceKey, (await readPageWorkflow(pageId))?.workflowId);
  const target = findState(def, toStateId);

  // SV-SEC-1. Entering an enforce state is gated below; LEAVING one was not. Approved -> Draft
  // clears the enforce baseline, which is what makes the app revert unapproved edits — so the
  // cheapest way to switch protection off for a page was to walk it backwards out of Approved.
  // The exit deserves the same authority as the entry.
  const from = findState(def, current.stateId);
  if (from?.enforce && !target?.enforce
    && !(await authorizeSteward(actorAccountId, spaceKey))) {
    return { success: false, reason: `Only a space admin can move a page out of ${from.name}` }; // WF-10
  }

  // #46: transition conditions run BEFORE the enforce/approval branch. Content conditions
  // are checked synchronously here; if they fail, the move is blocked with the reasons.
  const wfSettings = await getSpaceWorkflowSettings(spaceKey);
  const entryCond = wfSettings.entryConditions?.[toStateId];
  if (entryCond?.requireRules) {
    const blocked = await checkContentConditions(pageId, spaceKey);
    if (blocked) return blocked;
  }

  const needsAi = !!entryCond?.requireAi;
  const spec = target?.enforce ? await resolveApproverIds(wfSettings.approval) : null;

  // Open a pending transition when there are human approvers (enforce + configured, #43)
  // AND/OR an AI review condition (#46). The AI rides the SAME pending record as a mandatory
  // review axis, AND-composed with the human quorum on one pinned version.
  if (spec || needsAi) {
    const check = validateTransition(def, current.stateId, toStateId);
    if (!check.ok) return { success: false, reason: check.reason };
    // #46 authority: the AI axis AUGMENTS, never replaces, enforce-state authority. An
    // enforce target with no human approvers still requires the requester to be a steward —
    // otherwise turning on "require AI review" would DOWNGRADE the gate to "anyone + AI".
    if (target?.enforce && !(spec?.approvers?.length) && !(await authorizeSteward(actorAccountId, spaceKey))) {
      return { success: false, reason: `Only a space admin can move a page into ${target?.name || toStateId} when no approvers are set` }; // WF-10
    }
    // Review #2: an approver GROUP that could not be expanded must not open a request that
    // nobody can complete (0 of 0, pending forever) or silently shrink an "all approvers" rule
    // to "all the ones we could resolve". Refuse with the cause; the steward can retry.
    if (spec?.unresolved) {
      return { success: false, reason: "The approver groups could not be resolved right now — try again in a moment" };
    }
    // Don't let a re-request silently discard approvers' / the AI's in-flight review.
    const existing = await getPageApprovalStatus(pageId);
    if (existing?.pending && existing.requestedBy !== actorAccountId && !(await authorizeSteward(actorAccountId, spaceKey))) {
      return { success: false, reason: "An approval is already pending for this page" };
    }
    const pinnedVersion = await fetchLivePageVersion(pageId);
    if (pinnedVersion == null) return { success: false, reason: "Could not verify the page version — please retry." };
    // B3 (review finding 11): with no human approvers the requester is the signing authority, so
    // a space that requires signed decisions takes the requester's code HERE — the AI-only
    // completion then carries it. With approvers, each of them signs their own decision.
    let requestSignature = null;
    if (target?.enforce && wfSettings.requireSignature && !(spec?.approvers?.length)) {
      const v = await verifySignature(actorAccountId, typeof req.payload?.code === "string" ? req.payload.code : null);
      if (!v.ok) return { success: false, reason: v.reason, signatureRequired: true };
      requestSignature = v.signature;
    }
    const names = {};
    (wfSettings.approval?.approvers || []).forEach((a) => { if (a.id) names[a.id] = a.name; });
    const result = await requestApprovalTransition({
      pageId, toStateId, toStateName: target?.name || toStateId, spaceKey,
      approvers: spec?.approvers || [], mode: spec?.mode || "any", min: spec?.min || 1,
      actorAccountId, actorName: await actorName(req.context?.accountId), pinnedVersion, approverNames: names,
      aiGate: needsAi ? { required: true, threshold: entryCond.aiThreshold } : null,
      requestSignature,
    });
    if (needsAi) {
      // Enqueue the async review; if it resolved without an LLM call (AI disabled / budget),
      // apply that verdict immediately so the gate can't hang — and REFLECT the outcome so the
      // ribbon doesn't show "review in progress" for a page that already moved (or was blocked).
      const enq = await enqueueAiGate({ pageId, spaceKey, pinnedVersion, threshold: entryCond.aiThreshold, onBudgetExhausted: entryCond.onBudgetExhausted });
      if (!enq.enqueued && enq.verdict) {
        const av = await applyAiVerdict(pageId, pinnedVersion, enq.verdict, enq.reason);
        if (av?.transitioned) return { success: true, transitioned: true, outcome: av.outcome, record: av.record };
        if (av?.status === "failed") return { success: false, blocked: true, reason: enq.reason || "AI content review did not pass." };
      }
    }
    return result;
  }

  if (target?.enforce) {
    // enforce, no approvers, no AI → #42/#44 direct steward gate. The steward IS the reviewing
    // authority acting on what they see now: capture approvedVersion, fail CLOSED on null.
    if (!(await authorizeSteward(actorAccountId, spaceKey))) {
      return { success: false, reason: `Only a space admin can move a page into ${target.name} when no approvers are set` }; // WF-10
    }
    const approvedVersion = await fetchLivePageVersion(pageId);
    if (approvedVersion == null) {
      return { success: false, reason: "Could not verify the page version — please retry." };
    }
    // B3 (review finding 11): the steward's direct approval is a decision too — signed when
    // the space requires it, so the evidence never shows an unsigned approval in such a space.
    let requestSignature = null;
    if (wfSettings.requireSignature) {
      const v = await verifySignature(actorAccountId, typeof req.payload?.code === "string" ? req.payload.code : null);
      if (!v.ok) return { success: false, reason: v.reason, signatureRequired: true };
      requestSignature = v.signature;
    }
    const snap = (await resolveApproverIds(wfSettings.approval))?.approvers || [];
    const stewardName = await actorName(req.context?.accountId);
    // A4: a direct steward approval still leaves an evidence block — no approvers, no decisions,
    // just who approved which version, when. Same shape as a quorum approval (buildApprovalRecord
    // with no pending record), so the ribbon renders one thing.
    const approvalRecord = buildApprovalRecord({
      pending: { pinnedVersion: approvedVersion, requestSignature }, records: [], outcome: "approved",
      completedBy: actorAccountId, completedByName: stewardName,
    });
    return transitionPageWorkflow({
      pageId, spaceKey, toStateId, actorAccountId, actorName: stewardName,
      reason: boundReason(req.payload?.reason), approvers: snap, approvedVersion, approvalRecord,
    });
  }
  return transitionPageWorkflow({
    pageId,
    spaceKey,
    toStateId,
    actorAccountId,
    actorName: await actorName(req.context?.accountId),
    reason: boundReason(req.payload?.reason),
  });
};

// A5: the steward-editable review date. Payload { pageId, reviewDueAt: ISO | null }.
// Two gates, both on the page the payload names: the caller must be able to change the page
// (canEditPage — the write bar, CLAUDE.md) AND be a steward of the page's OWN space, derived from
// its workflow record — never a payload spaceKey. A past date is refused; null clears the clock.
const setReviewDue = async (req) => {
  const pageId = pageIdOf(req);
  const actorAccountId = req.context?.accountId;
  if (!pageId) return { success: false, reason: "No page context" };
  if (!(await canEditPage(actorAccountId, pageId))) {
    return { success: false, reason: "You do not have permission to change this page's review date" };
  }
  const current = await readPageWorkflow(pageId);
  if (!current) return { success: false, reason: "Page has no workflow assigned" };
  const spaceKey = current.spaceKey || await resolvePageSpaceKey(pageId);
  if (!spaceKey || !(await authorizeSteward(actorAccountId, spaceKey))) {
    return { success: false, reason: "Only a space admin can change the review date" };
  }
  const r = await setPageReviewDue({
    pageId,
    reviewDueAt: req.payload?.reviewDueAt ?? null,
    actorAccountId,
    actorName: await actorName(req.context?.accountId),
    reason: boundReason(req.payload?.reason),
  });
  if (!r.success) return { success: false, reason: r.reason };
  return { success: true, reviewDueAt: r.reviewDueAt };
};

// B2: read confirmations. `confirm-read` is the caller's own statement about a page they can
// read; `get-read-status` returns counts (no names) to anyone who can read the page; the
// per-person report is steward-only (a list of who has NOT read something is a people list).
const confirmReadAction = async (req) => {
  const pageId = pageIdOf(req);
  const accountId = req.context?.accountId;
  if (!pageId || !accountId) return { success: false, reason: "No page context" };
  if (!(await canReadPage(accountId, pageId))) return { success: false, reason: "No page context" };
  const record = await readPageWorkflow(pageId);
  if (!record) return { success: false, reason: "Page has no workflow assigned" };
  const settings = await getSpaceWorkflowSettings(record.spaceKey);
  if (!readConfirmationRequired(settings, record)) return { success: false, reason: "This page does not ask for read confirmations" };
  return confirmRead({ pageId, accountId, name: await actorName(req.context?.accountId), record });
};

const getReadStatusAction = async (req) => {
  const pageId = pageIdOf(req);
  if (!pageId) return { required: false };
  if (!(await callerMayReadPage(req, pageId))) return { required: false };
  const record = await readPageWorkflow(pageId);
  if (!record) return { required: false };
  const settings = await getSpaceWorkflowSettings(record.spaceKey);
  return readStatus({ pageId, accountId: req.context?.accountId, record, settings });
};

const getReadReportAction = async (req) => {
  const pageId = pageIdOf(req);
  if (!pageId) return { required: false, readers: [] };
  const record = await readPageWorkflow(pageId);
  if (!record) return { required: false, readers: [] };
  const spaceKey = record.spaceKey || await resolvePageSpaceKey(pageId);
  if (!spaceKey || !(await authorizeSteward(req.context?.accountId, spaceKey))) return { required: false, readers: [], reason: "Only a space admin can see who has read this page" };
  const settings = await getSpaceWorkflowSettings(spaceKey);
  return readReport({ pageId, record, settings });
};

// A free-text reason is stored in the durable record; a 1 KB one would push the entry past the
// details cap and blank the fields that matter (A1 review F3). Same bound edit requests use.
const boundReason = (r) => (typeof r === "string" && r.trim() ? r.trim().slice(0, 300) : null);

const decideApprovalAction = async (req) => {
  const pageId = pageIdOf(req);
  const { decision } = req.payload || {};
  const reason = boundReason(req.payload?.reason);
  if (!pageId) return { success: false, reason: "No page context" };
  return decideApproval({ pageId, approverAccountId: req.context?.accountId, decision, reason, actorName: await actorName(req.context?.accountId), signatureCode: typeof req.payload?.code === "string" ? req.payload.code : null });
};

// WF-1: re-pin the open request to the live version (original requester kept). The steward check is
// the action's; the approver/requester checks are the capsule's. An AI gate is re-queued for the new
// version, exactly as request-transition does.
const rerequestApprovalAction = async (req) => {
  const pageId = pageIdOf(req);
  const actorAccountId = req.context?.accountId;
  if (!pageId) return { success: false, reason: "No page context" };
  if (!(await callerMayReadPage(req, pageId))) return { success: false, reason: "You do not have access to this page" };
  const spaceKey = (await readPageWorkflow(pageId))?.spaceKey || null;
  const isSteward = spaceKey ? await authorizeSteward(actorAccountId, spaceKey) : false;
  const r = await rerequestApproval({ pageId, actorAccountId, actorName: await actorName(actorAccountId), isSteward });
  if (r.success && r.changed && r.aiGate) {
    const wfSettings = await getSpaceWorkflowSettings(spaceKey);
    const entryCond = wfSettings.entryConditions?.[(await kvs.get(`workflow-pending-${pageId}`))?.toStateId] || {};
    const enq = await enqueueAiGate({ pageId, spaceKey, pinnedVersion: r.pinnedVersion, threshold: entryCond.aiThreshold, onBudgetExhausted: entryCond.onBudgetExhausted });
    if (!enq.enqueued && enq.verdict) await applyAiVerdict(pageId, r.pinnedVersion, enq.verdict, enq.reason);
  }
  return r;
};

const getPageApprovals = async (req) => {
  const pageId = pageIdOf(req);
  if (!pageId) return { pending: false };
  // Exposes the approver roster and each approver's decision for the named page.
  if (!(await callerMayReadPage(req, pageId))) return { pending: false };
  const status = await getPageApprovalStatus(pageId);
  // B3: the ribbon asks for a code only when the space requires one, and can say "set up your
  // signature first" when the caller has none.
  if (status?.pending) {
    const settings = await getSpaceWorkflowSettings(status.spaceKey || (await readPageWorkflow(pageId))?.spaceKey);
    status.requireSignature = !!settings?.requireSignature;
    if (status.requireSignature) status.signatureEnrolled = (await signatureStatus(req.context?.accountId)).enrolled;
  }
  return status;
};

// B3: the approver's signature device. All four act on the CALLER only (req.context) — there is
// no payload account, so nothing here can be pointed at someone else.
const signatureStatusAction = async (req) => signatureStatus(req.context?.accountId);
const enrollSignatureAction = async (req) => {
  const accountId = req.context?.accountId;
  if (!accountId) return { success: false, reason: "No account" };
  // The authenticator entry is "Sentinel Vault: <label>". Naming the SITE in the label keeps two
  // sites (or dev and production) from showing as two identical entries (tester report 2026-09-19).
  let site = "";
  try { site = new URL(req.context?.siteUrl || "").hostname.replace(/\.atlassian\.net$/, ""); } catch (_) { site = ""; }
  const who = (await actorName(req.context?.accountId)) || accountId;
  return startEnrollment(accountId, { accountLabel: site ? `${who} @ ${site}` : who, code: typeof req.payload?.code === "string" ? req.payload.code : null });
};
const confirmSignatureAction = async (req) => confirmEnrollment(req.context?.accountId, typeof req.payload?.code === "string" ? req.payload.code : "");
const revokeSignatureAction = async (req) => revokeSignature(req.context?.accountId, { code: typeof req.payload?.code === "string" ? req.payload.code : null });

// WF-3 (c): the caller's own approval requests (self-scoped: the index is the caller's prefix).
const listMyApprovalRequestsAction = async (req) => {
  const accountId = req.context?.accountId;
  if (!accountId) return { requests: [] };
  return { requests: await listMyApprovalRequests(accountId) };
};
const listMyApprovalsAction = async (req) => {
  const raw = await listMyApprovals(req.context?.accountId);
  const out = [];
  const head = raw.slice(0, 25); // bounded — the inbox is a working list, not a report
  // One batch lookup for title + where the page is: an approval on a page that sits in the
  // trash (or is gone) is not something an approver can act on, so it is not shown.
  const status = await fetchPageStatuses(head.map((r) => r.pageId));
  for (const r of head) {
    const place = status.get(String(r.pageId));
    if (place && ["trashed", "missing"].includes(place.status)) continue;
    const pending = await kvs.get(`workflow-pending-${r.pageId}`);
    if (!pending) continue; // resolved since; skip stale record
    if (pending.aiGate?.status === "failed") continue; // #46: AI review blocked it — the
    // requester must revise + re-request; don't nag approvers with a currently-blocked item
    // WF-1: the inbox says when the page moved on since the request, so a blind Approve there
    // meets the same refusal the ribbon shows — and the row explains it first.
    const liveVersion = pending.pinnedVersion != null ? await fetchLivePageVersion(r.pageId) : null;
    out.push({
      pageId: r.pageId,
      pageTitle: place?.title || `Page ${r.pageId}`,
      pinnedVersion: pending.pinnedVersion ?? null,
      liveVersion,
      stale: pending.pinnedVersion != null && liveVersion != null && liveVersion !== pending.pinnedVersion,
      spaceKey: null,
      toStateName: pending.toStateName || r.stateId,
      requestedByName: pending.requestedByName || null,
      requestedAt: r.requestedAt,
      mode: pending.mode || "any",
    });
  }
  return { approvals: out };
};

// User search for the approver picker (steward config). Confluence user search.
const searchUsers = async (req) => {
  const q = (req.payload?.query || "").trim();
  if (q.length < 2) return { users: [] };
  try {
    const cql = `user.fullname~"${q.replace(/"/g, "")}"`;
    const res = await asApp().requestConfluence(route`/wiki/rest/api/search/user?cql=${cql}&limit=8`);
    if (!res.ok) return { users: [] };
    const body = await res.json();
    const users = (body?.results || [])
      .map((r) => ({ accountId: r.user?.accountId, name: r.user?.displayName || r.user?.publicName }))
      .filter((u) => u.accountId);
    return { users };
  } catch (_) {
    return { users: [] };
  }
};

// Group search for the approver picker (any member of a chosen group can approve).
const searchGroups = async (req) => {
  const q = (req.payload?.query || "").trim();
  if (q.length < 1) return { groups: [] };
  try {
    const res = await asApp().requestConfluence(route`/wiki/rest/api/group/picker?query=${q}&limit=8`);
    if (!res.ok) return { groups: [] };
    const body = await res.json();
    const groups = (body?.results || []).map((g) => ({ id: g.id || g.name, name: g.name })).filter((g) => g.name);
    return { groups };
  } catch (_) {
    return { groups: [] };
  }
};

const loadConfig = async (req) => {
  const { scope, key } = req.payload || {};
  return loadWorkflowConfig(scope || "global", key);
};

const storeConfig = async (req) => {
  const { scope, key, def } = req.payload || {};
  // Scope-tiered authz (mirrors store-validation-config, it17): a SPACE def needs a steward of
  // THAT space; the GLOBAL def needs a site admin — previously any space steward could invoke
  // with scope:"global" and overwrite the org-wide workflow definition.
  const caller = req.context?.accountId;
  const authorized = !!caller && ((scope === "space" && (key || spaceKeyOf(req)))
    ? await authorizeSteward(caller, key || spaceKeyOf(req))
    : await isOperatorSiteAdmin(caller));
  if (!authorized) {
    return { success: false, reason: scope === "space" ? "Only a space admin can edit workflow definitions" : "Only a site admin can edit the global workflow definition" };
  }
  return storeWorkflowConfig(scope || "global", key, def);
};

// B1: the definition editor. The space IS the object here (the payload names it, the gate is
// on it), so a steward of that space edits that space's workflows and nothing else.
const listSpaceWorkflowsAction = async (req) => {
  const spaceKey = spaceKeyOf(req);
  if (!spaceKey || !(await authorizeSteward(req.context?.accountId, spaceKey))) return { error: "Only a space admin can view workflow definitions" };
  return listSpaceWorkflows(spaceKey);
};
const storeSpaceWorkflowAction = async (req) => {
  const spaceKey = spaceKeyOf(req);
  if (!spaceKey || !(await authorizeSteward(req.context?.accountId, spaceKey))) return { success: false, reason: "Only a space admin can edit workflow definitions" };
  const { workflowId, def, labels, priority } = req.payload || {};
  return storeSpaceWorkflow(spaceKey, { workflowId: typeof workflowId === "string" ? workflowId : null, def, labels, priority });
};
// WF-11: ONE Save for the default workflow's states AND the approval / protection settings — two
// records, all-or-nothing: the definition first, then the settings; a refused settings write puts
// the definition back exactly as it was (bundle.js runBundle, pure). Steward-gated on the space.
const saveWorkflowBundleAction = async (req) => {
  const spaceKey = spaceKeyOf(req);
  if (!spaceKey || !(await authorizeSteward(req.context?.accountId, spaceKey))) return { success: false, reason: "Only a space admin can edit workflow definitions" };
  const { def, labels, priority, settings } = req.payload || {};
  if (!settings || typeof settings !== "object") return storeSpaceWorkflow(spaceKey, { workflowId: "default", def, labels, priority });
  const prev = await listSpaceWorkflows(spaceKey);
  const prevSource = prev?.source || "builtin";
  const prevDef = prevSource === "space" ? prev.default : null;
  return runBundle({
    storeDef: () => storeSpaceWorkflow(spaceKey, { workflowId: "default", def, labels, priority }),
    storeSettings: () => setSpaceWorkflowSettings(spaceKey, settings || {}),
    restoreDef: () => restoreSpaceDefaultWorkflow(spaceKey, prevSource, prevDef),
  });
};
const deleteSpaceWorkflowAction = async (req) => {
  const spaceKey = spaceKeyOf(req);
  if (!spaceKey || !(await authorizeSteward(req.context?.accountId, spaceKey))) return { success: false, reason: "Only a space admin can edit workflow definitions" };
  return deleteSpaceWorkflow(spaceKey, String(req.payload?.workflowId || ""));
};

const getSpaceSettings = async (req) => {
  const spaceKey = spaceKeyOf(req);
  if (!spaceKey) return { settings: {}, def: null };
  // SV-SEC-1: spaceKey is payload-supplied and the settings carry the space's approver roster
  // and enforcement configuration. Its only caller is the steward-only Workflow tab
  // (WorkflowSettingsEditor.jsx:163), so the server now enforces what the UI assumed.
  if (!(await authorizeSteward(req.context?.accountId, spaceKey))) {
    return { settings: {}, def: null };
  }
  const settings = await getSpaceWorkflowSettings(spaceKey);
  const def = await resolveWorkflowDef(spaceKey);
  return { settings, def }; // def.states power the read-only preview chips in the config UI
};

const setSpaceSettings = async (req) => {
  const spaceKey = spaceKeyOf(req);
  if (!(await authorizeSteward(req.context?.accountId, spaceKey))) {
    return { success: false, reason: "Only a space admin can change workflow settings" };
  }
  return setSpaceWorkflowSettings(spaceKey, req.payload?.settings || {});
};

// Apply the space's workflow to existing pages without one (steward). Resolves the
// space id, then delegates the bounded scan+assign to the shared logic function.
const bulkAssign = async (req) => {
  const spaceKey = spaceKeyOf(req);
  if (!(await authorizeSteward(req.context?.accountId, spaceKey))) {
    return { success: false, reason: "Only a space admin can apply workflows" };
  }
  const settings = await getSpaceWorkflowSettings(spaceKey);
  if (!settings.enabled) return { success: false, reason: "Enable workflow for this space first" };

  // SV-SEC-1. The steward check above is about spaceKey, but the scan used to run against
  // req.payload.spaceId — a different, unchecked object. A steward of any one space could
  // therefore have the app enumerate another space's pages with its own identity and write app
  // state and content properties onto them. Resolve the id from the key that was authorized,
  // and from nothing else.
  let spaceId = null;
  const sres = await asApp().requestConfluence(route`/wiki/api/v2/spaces?keys=${spaceKey}`);
  if (sres.ok) spaceId = (await sres.json())?.results?.[0]?.id;
  if (!spaceId) return { success: false, reason: "Could not resolve the space" };

  return bulkAssignPagesInSpace({ spaceKey, spaceId, cursor: req.payload?.cursor || null, actorAccountId: req.context?.accountId });
};

// #48: workflow dashboard for a space — state distribution + a recent-pages table.
// Counts + overdue are EXACT from the by-state index (which carries reviewDueAt); only
// titles are fetched (bounded + parallel). Read-only; the UI generates the CSV client-side.
const LIST_CAP = 100;
export const getWorkflowDashboard = async (req) => {
  const spaceKey = spaceKeyOf(req);
  if (!spaceKey) return { error: "No space context" };
  // SV-SEC-1: naming any space in the payload returned that space's whole workflow inventory —
  // up to 100 page titles and webui URLs fetched with the app's identity, per-state counts and
  // review-overdue flags. It is the steward-only dashboard (WorkflowDashboard.jsx:22).
  if (!(await authorizeSteward(req.context?.accountId, spaceKey))) {
    return { error: "Only a space admin can view the workflow dashboard" };
  }
  const prefix = `workflow-idx-${sanitize(spaceKey)}-`;
  const entries = [];
  let cursor = null;
  for (let i = 0; i < 30; i++) { // bounded; ~3000 pages max
    let q = kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100);
    if (cursor) q = q.cursor(cursor);
    const { results, nextCursor } = await q.getMany();
    for (const { value } of results || []) if (value?.pageId) entries.push(value);
    cursor = nextCursor;
    if (!cursor) break;
  }
  const now = Date.now();
  // A5: any state may carry a review clock (definition, per-state override, or a steward-set
  // date), so "overdue" is a passed reviewDueAt on the index row, whatever the state — the same
  // rule workflowSweep's expiry pass applies. It used to be pinned to stateId === "approved".
  const isOverdue = (e) => !!(e.reviewDueAt && new Date(e.reviewDueAt).getTime() < now);
  const def = await resolveWorkflowDef(spaceKey);
  // B1: a label-scoped page's state name comes from ITS definition.
  const extraDefs = new Map();
  const { extras } = await listSpaceWorkflows(spaceKey);
  for (const x of extras) if (x.def) extraDefs.set(x.workflowId, x.def);
  // The index outlives the page: a trashed page keeps its row (and its state, for a restore) and
  // a purged page's row waits for the hourly sweep. Neither is work for a steward — on
  // 2026-09-05 every one of the thirteen pages this dashboard listed for WFH was in the trash.
  // ONE batch lookup (250 ids a call) answers status AND title for every row, where each row
  // used to cost its own request for the title alone.
  const status = await fetchPageStatuses(entries.map((e) => e.pageId));
  const placeOf = (e) => status.get(String(e.pageId))?.status || "unknown";
  const shown = entries.filter((e) => !["trashed", "missing"].includes(placeOf(e)));
  const inTrash = entries.filter((e) => placeOf(e) === "trashed").length;
  const missing = entries.filter((e) => placeOf(e) === "missing").length;
  const counts = {};
  let overdue = 0;
  for (const e of shown) {
    counts[e.stateId] = (counts[e.stateId] || 0) + 1;
    if (isOverdue(e)) overdue++;
  }
  // Most-recently-changed first, bounded.
  const list = shown
    .slice()
    .sort((a, b) => String(b.enteredAt || "").localeCompare(String(a.enteredAt || "")))
    .slice(0, LIST_CAP);
  const stateName = (id, wid) => (extraDefs.get(wid) || def)?.states?.find((s) => s.id === id)?.name || def?.states?.find((s) => s.id === id)?.name || id;
  const pages = list.map((e) => ({
    pageId: e.pageId,
    title: status.get(String(e.pageId))?.title || `(page ${e.pageId})`,
    url: status.get(String(e.pageId))?.url || null,
    stateId: e.stateId,
    stateName: stateName(e.stateId, e.workflowId),
    workflowId: e.workflowId || null,
    enteredAt: e.enteredAt || null,
    reviewDueAt: e.reviewDueAt || null,
    overdue: isOverdue(e),
  }));
  return {
    spaceKey,
    total: shown.length,
    inTrash,
    missing,
    truncated: shown.length > LIST_CAP,
    listCap: LIST_CAP,
    overdue,
    // B1: chips for the default's states AND every label-scoped workflow's (review finding 13 —
    // pages in an extra's state had a count but no chip). Deduped by id, the default first.
    states: [...(def?.states || []), ...[...extraDefs.values()].flatMap((d) => d.states || [])]
      .filter((s, i, arr) => arr.findIndex((x) => x.id === s.id) === i)
      .map((s) => ({ id: s.id, name: s.name, color: s.color, count: counts[s.id] || 0 })),
    pages,
  };
};

// SEC-2 (d): what approving this page will take custody of — the approval dialog lists it.
const sealsToFreezeAction = async (req) => {
  const pageId = pageIdOf(req);
  if (!pageId) return { sections: [], attachments: [] };
  if (!(await callerMayReadPage(req, pageId))) return { sections: [], attachments: [] };
  try {
    const { describeSealsToFreeze } = await import("./seal-custody.js");
    return await describeSealsToFreeze(pageId);
  } catch (e) { console.warn("[SEAL-CUSTODY] seals-to-freeze failed:", e?.message || e); return { sections: [], attachments: [] }; }
};

export const actions = [
  ["get-page-workflow", getWorkflow],
  ["workflow-seals-to-freeze", sealsToFreezeAction],
  ["get-workflow-dashboard", getWorkflowDashboard],
  ["get-workflow-log", getLog],
  ["assign-workflow", assignWorkflow],
  ["request-transition", requestTransition],
  ["load-workflow-config", loadConfig],
  ["store-workflow-config", storeConfig],
  ["get-space-workflow-settings", getSpaceSettings],
  ["set-space-workflow-settings", setSpaceSettings],
  ["set-review-due", setReviewDue],
  ["confirm-read", confirmReadAction],
  ["list-space-workflows", listSpaceWorkflowsAction],
  ["store-space-workflow", storeSpaceWorkflowAction],
  ["save-workflow-bundle", saveWorkflowBundleAction], // WF-11
  ["delete-space-workflow", deleteSpaceWorkflowAction],
  ["signature-status", signatureStatusAction],
  ["enroll-signature", enrollSignatureAction],
  ["confirm-signature-enrollment", confirmSignatureAction],
  ["revoke-signature", revokeSignatureAction],
  ["get-read-status", getReadStatusAction],
  ["get-read-report", getReadReportAction],
  ["bulk-assign-workflow", bulkAssign],
  ["decide-approval", decideApprovalAction],
  ["rerequest-approval", rerequestApprovalAction],
  ["get-page-approvals", getPageApprovals],
  ["list-my-approvals", listMyApprovalsAction],
  ["list-my-approval-requests", listMyApprovalRequestsAction], // WF-3 (c)
  ["search-workflow-users", searchUsers],
  ["search-workflow-groups", searchGroups],
];
