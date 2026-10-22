import { route } from "@forge/api";
import { appConfluence } from "../../shared/confluence-call.js";
import { kvs, WhereConditions } from "@forge/kvs";

import { authorizeSteward, isAccountStewardAsApp } from "../../shared/steward-checks.js";
import { proposalAskees, proposalNotifyTargets, mayDecideProposal, proposalDecision } from "./proposal-rules.js";
import { resolveBulletinToggles } from "../../shared/bulletin-flags.js";
import { setUntil } from "../../shared/kvs-ttl.js";
import { currentUserProfile } from "../../shared/user-or-app.js";
import { heldRefusal, isWorkflowHeld } from "../../shared/seal-authority.js"; // SEC-2: a held seal takes no personal action — except a PROPOSAL to the approvers (SEC-2 (e))
import {
  mailEditRequest,
  mailEditApproved,
  mailEditDenied,
} from "../../infra/notice-composer.js";
import {
  getActiveEditGrant, getActiveSectionEditGrant,
  writeOwnerIndex, dropOwnerIndex, listPendingRequestsForOwner,
  writeSectionOwnerIndex, dropSectionOwnerIndex, listPendingSectionRequestsForOwner,
  writeMineIndex, listMyRequests,
  resolveEditCooldownMs, writeProposalIndex, writeSectionProposalIndex } from "./logic.js";
import { retryAtFor } from "../../shared/edit-cooldown.js";
import { DECLINED_REASON } from "../../../ui/kit/status-language.js";
import { listMyStewardRequestsCore } from "../realms/actions.js";
import { viewableProposals } from "./viewable.js";
import { waitingApprovals, newApproverCheck, approverRefusal, cannotViewToDecide, viewToDecideRefusal } from "../workflow/approvals.js";
import { canReadPage, isStewardOfSeal } from "../../shared/content-access.js";
import { recordActivity } from "../../infra/activity-log.js";
import { errText } from "../../shared/action-log.js";

// The wait after a declined request is the site setting `editRequestCooldownHours`
// (shared/edit-cooldown.js is its one home). A refusal names WHEN the person may ask again.
// SEC-8: the server never formats a clock (the lambda runs in UTC — "20:19 UTC" reached a human
// in the critique); the refusal carries `retryAt` and the surface composes "ask again Tue 22:19"
// in the viewer's zone (status-language `refusalText`).
const declinedReason = () => DECLINED_REASON;
const clip = (v) => (typeof v === "string" ? v.trim().slice(0, 300) : "");

/**
 * Load the seal for an owner-gated action and decide if the caller may act.
 * Authorized = the seal owner, or a steward (when admin override is enabled).
 */
async function loadSealForOwnerAction(attachmentId, accountId) {
  const seal = await kvs.get(`protection-${attachmentId}`);
  if (!seal || !seal.lockedBy) return { seal: null, authorized: false };
  let authorized = seal.lockedBy === accountId;
  if (!authorized) authorized = await stewardOfSeal(authorizeSteward, accountId, seal);
  return { seal, authorized };
}

/**
 * Steward power over a seal (attachment: `contentId`, section: `pageId`): an admin of the space its
 * page is in NOW and, if the page moved since it was sealed, of the seal's own space too
 * (content-access.js recordAuthoritySpaces). The seal's stored space alone left the old space's
 * admins deciding edit access on a page that had left them. Never the caller's context.
 */
function stewardOfSeal(check, accountId, seal) {
  return isStewardOfSeal(check, accountId, seal);
}

/**
 * SEC-2 (e) "Propose a change": on a workflow-HELD seal the personal grant path is closed (the
 * approval owns the seal), so a request becomes a PROPOSAL addressed to the page's approvers —
 * the approver snapshot on the page's workflow record (a steward may decide too, as always).
 * Approving a proposal is the workflow's own door: the page is moved back for review (custody
 * hands every seal back), and only then is the ordinary grant minted on the now-personal seal.
 */
async function proposalApproversFor(pageId) {
  if (!pageId) return [];
  try {
    const { readPageWorkflow } = await import("../workflow/logic.js");
    const rec = await readPageWorkflow(pageId);
    return Array.isArray(rec?.approvers) ? rec.approvers.filter(Boolean) : [];
  } catch (_) { return []; }
}
/**
 * 8.14: the approver arm of a proposal decision. Being listed on the proposal (its approver snapshot)
 * counts only while the caller is still one of the approvers of the space the page's workflow lives
 * in (workflow/approvals.js approverStatusNow — the one rule). One read of that list per call:
 * `const approverNow = proposalApproverCheck(pageId)`, then `approverNow(request, accountId)`.
 */
function proposalApproverCheck(pageId) {
  const check = newApproverCheck();
  let space = null;
  return async (request, accountId) => {
    space ??= (async () => {
      try {
        const { readPageWorkflow } = await import("../workflow/logic.js");
        return (await readPageWorkflow(pageId))?.spaceKey || request?.spaceKey || null;
      } catch (_) { return request?.spaceKey || null; }
    })();
    return check(request?.approvers, accountId, await space);
  };
}

/**
 * SEC-2 (e) + 8.14: may `accountId` decide this PROPOSAL? The seal's owner/steward answer
 * (`authorized`) stands only on a seal the approval no longer holds; otherwise the page's approvers
 * (still on the space's list) or a space admin. `{ authorized, refusal }` — `refusal` is set when
 * the approver list could not be read (never a yes) so the caller answers "try again".
 */
async function proposalAuthority(request, accountId, seal, pageId, authorized) {
  if (!isWorkflowHeld(seal) && authorized) return { authorized: true, refusal: null };
  // 8.16: deciding a proposal is a workflow decision on the page: the decider must be able to view
  // it (workflow/approvals.js decideApproval, the same rule and refusal). A page that cannot be named
  // is a no.
  const viewRefusal = pageId ? await viewToDecideRefusal(accountId, pageId) : cannotViewToDecide();
  if (viewRefusal) return { authorized: false, refusal: viewRefusal };
  const approverNow = proposalApproverCheck(pageId);
  const d = await proposalDecision(request, accountId, () => stewardOfSeal(isAccountStewardAsApp, accountId, seal), () => approverNow(request, accountId));
  return { authorized: d.may, refusal: d.unknown ? approverRefusal("unknown") : null };
}


async function moveBackForProposal(pageId, approverAccountId, request) {
  const wf = await import("../workflow/logic.js");
  const record = await wf.readPageWorkflow(pageId);
  if (!record?.enforce) return { success: true, moved: false }; // already handed back
  // Accepting moves the page out of Approved: held on a page that moved spaces (moved-hold.js).
  const { movedPageHold } = await import("../workflow/moved-hold.js");
  const hold = await movedPageHold(pageId, { actorAccountId: approverAccountId, storedKey: record.spaceKey || null });
  if (hold) return { success: false, reason: hold.reason };
  const def = await wf.resolveWorkflowDef(record.spaceKey, record.workflowId);
  const settings = await wf.getSpaceWorkflowSettings(record.spaceKey);
  // The same plan the enforcement uses (state-machine.js planDemote): a move this workflow cannot make
  // is refused here with the reason, before the transition would refuse it with an internal one.
  const plan = wf.planDemote(def, settings, record.stateId);
  if (!plan.ok) return { success: false, reason: plan.reason };
  const target = plan.target;
  let actorName = null;
  try { actorName = (await currentUserProfile(approverAccountId))?.displayName || null; } catch (_) { /* best effort */ }
  const r = await wf.transitionPageWorkflow({ pageId, spaceKey: record.spaceKey, toStateId: target.id, actorAccountId: approverAccountId, actorName: actorName || "Approver", reason: `proposal by ${request?.requesterName || "a requester"} accepted — moved back to ${target.name || target.id} for the change` });
  if (!r?.success) return { success: false, reason: r?.reason || "Could not move the page back for the change" };
  return { success: true, moved: true, toStateId: target.id, toStateName: target.name || target.id };
}

async function notifyEnabled() {
  try {
    const toggles = await resolveBulletinToggles();
    return !!toggles.ENABLE_NATIVE_NOTIFICATIONS;
  } catch (_) {
    return false;
  }
}

/**
 * Requester asks the seal owner for edit access to a sealed attachment.
 */
const requestEditAccess = async (req) => {
  const { attachmentId, reason } = req.payload || {};
  const accountId = req.context.accountId;
  if (!attachmentId || !accountId) return { success: false, reason: "Missing context" };
  const requestReason = typeof reason === "string" ? reason.trim().slice(0, 300) : "";

  const seal = await kvs.get(`protection-${attachmentId}`);
  if (!seal || !seal.lockedBy || seal.trashedOnly) return { success: false, reason: "This file is not sealed" };
  // SEC-2 (e): on a held seal the request is a PROPOSAL to the page's approvers (the owner may
  // propose too — the approval owns the seal, not them).
  const proposal = isWorkflowHeld(seal);
  // The owner check runs FIRST deliberately: it is self-knowledge (you are this record's
  // lockedBy), so it discloses nothing, and the owner gets the accurate message rather than the
  // deliberately-vague one below.
  if (!proposal && seal.lockedBy === accountId) return { success: false, reason: "You own this seal" };
  // SV-SEC-1. attachmentId is payload-supplied and every sibling in this file gates through
  // loadSealForOwnerAction — this one did not. Unchecked it is both an oracle ("is file X
  // sealed?") and a way to have the app post an @mention comment, as the app, on a page the
  // caller cannot open. Asking for access to something presupposes being able to see it. The
  // reason string deliberately matches the not-sealed one so the refusal itself says nothing.
  if (seal.contentId && !(await canReadPage(accountId, seal.contentId))) {
    return { success: false, reason: "This file is not sealed" };
  }

  if (await getActiveEditGrant(attachmentId, accountId)) {
    return { success: false, reason: "You already have edit access" };
  }

  const existing = await kvs.get(`edit-request-${attachmentId}-${accountId}`);
  if (existing?.status === "pending") return { success: false, reason: "Request already pending" };
  if (existing?.status === "denied") {
    const retryAt = retryAtFor(existing.deniedAt, await resolveEditCooldownMs());
    if (retryAt) return { success: false, reason: declinedReason(), retryAt };
  }

  let requesterName = "Unknown User";
  try {
    const userRes = await appConfluence(
      route`/wiki/rest/api/user?accountId=${accountId}`,
      { headers: { Accept: "application/json" } },
    );
    if (userRes.ok) {
      const u = await userRes.json();
      requesterName = u.displayName || requesterName;
    }
  } catch (_) { /* best effort */ }

  const approvers = proposal ? proposalAskees(await proposalApproversFor(seal.contentId), accountId) : [];
  await kvs.set(`edit-request-${attachmentId}-${accountId}`, {
    artifactId: attachmentId,
    requesterAccountId: accountId,
    requesterName,
    ownerAccountId: seal.lockedBy,
    contentId: seal.contentId || null,
    spaceKey: seal.spaceKey || null,
    attachmentName: seal.attachmentName || "Unknown Attachment",
    reason: requestReason,
    status: "pending",
    requestedAt: new Date().toISOString(),
    ...(proposal ? { proposal: true, approvers } : {}),
  });
  // K1: the index row goes with the record (read back by key: the set is strongly consistent) —
  // the owner's row, or (SEC-2 (e)) one per approver for a proposal.
  const written = await kvs.get(`edit-request-${attachmentId}-${accountId}`);
  if (proposal) await writeProposalIndex(written).catch((e) => console.warn("[EDIT-ACCESS] proposal index", errText(e)));
  else await writeOwnerIndex(written).catch((e) => console.warn("[EDIT-ACCESS] owner index", errText(e)));
  await writeMineIndex({ requesterAccountId: accountId, kind: "attachment", id: attachmentId, name: seal.attachmentName || null, pageId: seal.contentId || null, spaceKey: seal.spaceKey || null }).catch((e) => console.warn("[EDIT-ACCESS] mine index", errText(e))); // SEC-8
  // A1: the request exists from this write on.
  await recordActivity({
    type: "editreq.requested",
    pageId: seal.contentId || null,
    spaceKey: seal.spaceKey || null,
    actor: { accountId, name: requesterName },
    target: { kind: "attachment", id: attachmentId, name: seal.attachmentName || null },
    details: { scope: "attachment", reason: requestReason, ownerAccountId: seal.lockedBy || null, ...(proposal ? { proposal: true, approvers: approvers.slice(0, 10) } : {}) },
    version: null,
  });

  if (seal.contentId && (await notifyEnabled())) {
    try {
      for (const to of proposal ? proposalNotifyTargets(approvers) : [seal.lockedBy]) {
        await mailEditRequest(to, accountId, requesterName, seal.attachmentName || "Unknown Attachment", seal.contentId, requestReason);
      }
    } catch (e) { console.error("[EDIT-REQ] notify failed:", errText(e)); }
  }

  return { success: true };
};

/**
 * Status of the calling user's edit access for an attachment.
 */
const checkEditRequest = async (req) => {
  const { attachmentId } = req.payload || {};
  const accountId = req.context.accountId;
  if (!attachmentId || !accountId) return { status: "none" };

  const grant = await getActiveEditGrant(attachmentId, accountId);
  if (grant) return { status: "granted", expiresAt: grant.expiresAt || null };

  const existing = await kvs.get(`edit-request-${attachmentId}-${accountId}`);
  if (!existing) return { status: "none" };
  if (existing.status === "pending") return { status: "pending" };
  if (existing.status === "denied") {
    const retryAt = retryAtFor(existing.deniedAt, await resolveEditCooldownMs());
    if (!retryAt) {
      await kvs.delete(`edit-request-${attachmentId}-${accountId}`);
      await dropOwnerIndex(existing);
      return { status: "none" };
    }
    return { status: "denied", deniedAt: existing.deniedAt, retryAt, deniedReason: existing.deniedReason || null };
  }
  return { status: "none" };
};

/**
 * List pending requests for one attachment (owner/steward only).
 */
export const listEditRequests = async (req) => {
  const { attachmentId } = req.payload || {};
  const accountId = req.context.accountId;
  if (!attachmentId) return { requests: [] };
  const { seal, authorized } = await loadSealForOwnerAction(attachmentId, accountId);
  if (!seal) return { requests: [], reason: "Not authorized" };
  const held = isWorkflowHeld(seal);
  // SEC-2 (e): on a held seal the list is the PROPOSALS the caller may decide (approvers, space
  // admins), never their own; otherwise the owner/steward list as before.
  if (!held && !authorized) return { requests: [], reason: "Not authorized" };

  const { results } = await kvs
    .query()
    .where("key", WhereConditions.beginsWith(`edit-request-${attachmentId}-`))
    .limit(50)
    .getMany();
  const pending = (results || []).map(({ value }) => value).filter((v) => v?.status === "pending" && v.requesterAccountId !== accountId);
  if (!held) return { requests: pending };
  let admin = null;
  const isAdmin = async () => (admin ??= await stewardOfSeal(isAccountStewardAsApp, accountId, seal));
  const requests = [];
  const approverNow = proposalApproverCheck(seal.contentId);
  // 8.16: proposals are offered only to someone who can view the page (proposalAuthority's rule).
  const mayView = seal.contentId ? await canReadPage(accountId, seal.contentId) : false;
  if (mayView) for (const r of pending) if (await mayDecideProposal(r, accountId, isAdmin, () => approverNow(r, accountId))) requests.push(r);
  // Same answer as a refusal when there is nothing for this caller — no oracle on "is it held".
  if (!requests.length && !authorized) return { requests: [], reason: "Not authorized" };
  return { requests };
};

/**
 * Owner inbox: all pending edit requests across every seal the caller owns.
 */
const listMyEditRequests = async (req) => {
  const accountId = req.context.accountId;
  if (!accountId) return { requests: [] };

  // K1 index discipline: the owner's OWN prefix, confirmed by key — never a site-wide scan of
  // every request filtered client-side (which went blind past ~1,000 records, like the
  // approvals inbox did before it61).
  const stats = { unverified: 0 };
  const requests = await viewableProposals(await listPendingRequestsForOwner(accountId), accountId, { stats });
  return { requests, unverified: stats.unverified };
};

/**
 * Approve a request → write an edit grant scoped to the seal's lifetime.
 */
export const approveEditRequest = async (req) => {
  const { attachmentId, requesterAccountId } = req.payload || {};
  const accountId = req.context.accountId;
  if (!attachmentId || !requesterAccountId) return { success: false, reason: "Missing params" };
  let { seal, authorized } = await loadSealForOwnerAction(attachmentId, accountId);
  if (!seal) return { success: false, reason: "Seal not found" };
  const request0 = await kvs.get(`edit-request-${attachmentId}-${requesterAccountId}`);
  // SEC-2 (e): a proposal is decided by the page's approvers (or a steward, as always).
  // SEC-2 (e): a proposal is a workflow decision — the page's approvers or a space admin, never the
  // proposer, and the seal's owner only as one of those (tester 2026-09-30).
  if (request0?.proposal) {
    const pa = await proposalAuthority(request0, accountId, seal, seal.contentId, authorized);
    if (pa.refusal) return pa.refusal;
    authorized = pa.authorized;
  }
  if (!authorized) return { success: false, reason: request0?.proposal ? "Only this page's approvers or a space admin can decide a proposed change" : "Not the seal owner" };
  if (isWorkflowHeld(seal)) {
    if (!request0?.proposal) { const held = heldRefusal(seal, "grant"); if (held) return { success: false, reason: held }; } // SEC-2
    // The workflow's own door: move the page back for review (custody hands the seal back), then grant.
    const moved = await moveBackForProposal(seal.contentId, accountId, request0);
    if (!moved.success) return { success: false, reason: moved.reason };
    seal = (await kvs.get(`protection-${attachmentId}`)) || seal;
    if (isWorkflowHeld(seal)) return { success: false, reason: "The page was moved back but the seal is still held — try again in a moment" };
  }
  // it54: an EXPIRED seal is inert — approving it would only mint a dead, never-reaped grant. Reject.
  // F1 (owner feedback 2026-08-27): "the request remains available even if I choose approve; it
  // disappears if I choose deny instead". This branch was the cause — deny has no expiry check, so
  // on an overdue seal (which every seal in the reported screenshot was) approve failed while deny
  // worked, and the panel swallowed the failure into a console.error. Still a refusal, because the
  // grant really would be born dead, but the message now names the fix the UI can actually offer.
  if (seal.expiresAt && new Date(seal.expiresAt).getTime() <= Date.now()) {
    return { success: false, reason: "This seal has lapsed — extend it first (⋯ → Extend the seal), then grant edit access" };
  }

  const requestKey = `edit-request-${attachmentId}-${requesterAccountId}`;
  const request = await kvs.get(requestKey);
  // it51: approve only an EXISTING request (parity with denyEditRequest) — otherwise an owner/steward
  // could mint an edit grant for a user who never requested, with no request/audit trail.
  if (!request) return { success: false, reason: "Request not found" };
  const editorName = request?.requesterName || "User";

  const grant = {
    artifactId: attachmentId,
    editorAccountId: requesterAccountId,
    editorName,
    grantedBy: accountId,
    grantedAt: new Date().toISOString(),
    expiresAt: seal.expiresAt || null,
  };
  const grantKey = `edit-grant-${attachmentId}-${requesterAccountId}`;
  const expiryMs = seal.expiresAt ? new Date(seal.expiresAt).getTime() : 0;
  if (expiryMs > Date.now()) {
    await setUntil(grantKey, grant, expiryMs);
  } else {
    await kvs.set(grantKey, grant);
  }

  await kvs.delete(requestKey);
  await dropOwnerIndex(request);
  // A1: grant written, request consumed — the approval is a fact.
  await recordActivity({
    type: "editreq.approved",
    pageId: seal.contentId || null,
    spaceKey: seal.spaceKey || null,
    actor: { accountId, name: seal.lockedBy === accountId ? (seal.lockedByName || null) : null },
    target: { kind: "attachment", id: attachmentId, name: seal.attachmentName || null },
    details: { scope: "attachment", requesterAccountId, requesterName: editorName, expiresAt: grant.expiresAt, ...(request?.proposal ? { proposal: true } : {}) },
    version: null,
  });

  if (seal.contentId && (await notifyEnabled())) {
    try {
      await mailEditApproved(requesterAccountId, seal.attachmentName || "Unknown Attachment", seal.contentId);
    } catch (e) { console.error("[EDIT-REQ] notify approve failed:", errText(e)); }
  }

  return { success: true };
};

/**
 * Deny a request → mark denied (the site's edit-request cooldown applies before a retry).
 */
export const denyEditRequest = async (req) => {
  const { attachmentId, requesterAccountId } = req.payload || {};
  const deniedReason = clip(req.payload?.reason); // SEC-8: an optional reason that reaches the requester
  const accountId = req.context.accountId;
  if (!attachmentId || !requesterAccountId) return { success: false, reason: "Missing params" };
  let { seal, authorized } = await loadSealForOwnerAction(attachmentId, accountId);
  if (!seal) return { success: false, reason: "Seal not found" };
  const requestKey = `edit-request-${attachmentId}-${requesterAccountId}`;
  const existing = await kvs.get(requestKey);
  if (existing?.proposal) { // SEC-2 (e)
    const pa = await proposalAuthority(existing, accountId, seal, seal.contentId, authorized);
    if (pa.refusal) return pa.refusal;
    authorized = pa.authorized;
  }
  if (!authorized) return { success: false, reason: existing?.proposal ? "Only this page's approvers or a space admin can decide a proposed change" : "Not the seal owner" };
  if (!existing?.proposal) { const held = heldRefusal(seal, "grant"); if (held) return { success: false, reason: held }; } // SEC-2
  if (!existing) return { success: false, reason: "Request not found" };
  await kvs.set(requestKey, { ...existing, status: "denied", deniedAt: new Date().toISOString(), deniedReason: deniedReason || null });
  await dropOwnerIndex(existing);
  // A1
  await recordActivity({
    type: "editreq.denied",
    pageId: seal.contentId || null,
    spaceKey: seal.spaceKey || null,
    actor: { accountId, name: seal.lockedBy === accountId ? (seal.lockedByName || null) : null },
    target: { kind: "attachment", id: attachmentId, name: seal.attachmentName || null },
    details: { scope: "attachment", requesterAccountId, requesterName: existing.requesterName || null, reason: deniedReason || null },
    version: null,
  });

  if (seal.contentId && (await notifyEnabled())) {
    try {
      await mailEditDenied(requesterAccountId, seal.attachmentName || "Unknown Attachment", seal.contentId, null, { targetKind: "attachment", reason: deniedReason });
    } catch (e) { console.error("[EDIT-REQ] notify deny failed:", errText(e)); }
  }

  return { success: true };
};

/**
 * Revoke an active edit grant (owner/steward).
 */
export const revokeEditGrant = async (req) => {
  const { attachmentId, editorAccountId } = req.payload || {};
  const accountId = req.context.accountId;
  if (!attachmentId || !editorAccountId) return { success: false, reason: "Missing params" };
  const { seal, authorized } = await loadSealForOwnerAction(attachmentId, accountId);
  if (!seal) return { success: false, reason: "Seal not found" };
  if (!authorized) return { success: false, reason: "Not the seal owner" };
  { const held = heldRefusal(seal, "grant"); if (held) return { success: false, reason: held }; } // SEC-2

  const grantKey = `edit-grant-${attachmentId}-${editorAccountId}`;
  if (!(await kvs.get(grantKey))) return { success: false, reason: "No active grant for that editor" };
  await kvs.delete(grantKey);
  // A1: the grant is gone from this delete on (and there WAS one — a double click must not
  // record a second revocation, A1 review F4).
  await recordActivity({
    type: "editreq.revoked",
    pageId: seal.contentId || null,
    spaceKey: seal.spaceKey || null,
    actor: { accountId, name: seal.lockedBy === accountId ? (seal.lockedByName || null) : null },
    target: { kind: "attachment", id: attachmentId, name: seal.attachmentName || null },
    details: { scope: "attachment", editorAccountId },
    version: null,
  });
  return { success: true };
};

/**
 * List active editors for an attachment (owner/steward).
 */
export const listEditGrants = async (req) => {
  const { attachmentId } = req.payload || {};
  const accountId = req.context.accountId;
  if (!attachmentId) return { grants: [] };
  const { seal, authorized } = await loadSealForOwnerAction(attachmentId, accountId);
  if (!seal || !authorized) return { grants: [], reason: "Not authorized" };

  const { results } = await kvs
    .query()
    .where("key", WhereConditions.beginsWith(`edit-grant-${attachmentId}-`))
    .limit(50)
    .getMany();
  const now = Date.now();
  const grants = (results || [])
    .map(({ value }) => value)
    .filter((g) => g && (!g.expiresAt || new Date(g.expiresAt).getTime() > now));
  return { grants };
};

// ===========================================================================
// Direct grants — the sealer names a person (tester report 2026-09-17)
// ===========================================================================
// "If the sealer declines my request and I then explain on Teams why I need it, either I can
// ask again or the sealer can give me the permission." it51 refused a grant with no request
// because it left NO audit trail; a direct grant keeps the trail (activity `editreq.granted`,
// `direct: true` on the grant) and removes the dead end. Same gate as approve: the seal owner,
// or a steward of the OBJECT's space. The named person must be able to open the page — the app
// never hands authority over content to someone who cannot see it, and the notice @mentions
// them on that page. A pending or declined request from that person is consumed by the grant.
async function lookupDisplayName(accountId) {
  try {
    const res = await appConfluence(route`/wiki/rest/api/user?accountId=${accountId}`, { headers: { Accept: "application/json" } });
    if (res.ok) return (await res.json())?.displayName || null;
  } catch (_) { /* best effort */ }
  return null;
}
const ACCOUNT_ID = /^[A-Za-z0-9:_-]{1,128}$/;

async function grantDirect({ scope, id, seal, pageId, name, accountId, editorAccountId }) {
  if (!ACCOUNT_ID.test(String(editorAccountId))) return { success: false, reason: "Pick a person to give access to" };
  if (editorAccountId === seal.lockedBy) return { success: false, reason: "The seal owner can already edit" };
  if (seal.trashedOnly) return { success: false, reason: "This file is in the trash" };
  if (seal.expiresAt && new Date(seal.expiresAt).getTime() <= Date.now()) {
    return { success: false, reason: "This seal has lapsed — extend it first (⋯ → Extend the seal), then give edit access" };
  }
  if (!pageId || !(await canReadPage(editorAccountId, pageId))) {
    return { success: false, reason: "That person cannot open this page, so they cannot be given edit access here" };
  }
  const section = scope === "section";
  const grantKey = section ? `section-edit-grant-${id}-${editorAccountId}` : `edit-grant-${id}-${editorAccountId}`;
  const requestKey = section ? `section-edit-request-${id}-${editorAccountId}` : `edit-request-${id}-${editorAccountId}`;
  const request = await kvs.get(requestKey);
  const editorName = request?.requesterName || (await lookupDisplayName(editorAccountId)) || "User";
  const grant = {
    ...(section ? { sectionId: id } : { artifactId: id }),
    editorAccountId, editorName, grantedBy: accountId, grantedAt: new Date().toISOString(),
    expiresAt: seal.expiresAt || null, direct: true,
  };
  const expiryMs = seal.expiresAt ? new Date(seal.expiresAt).getTime() : 0;
  if (expiryMs > Date.now()) await setUntil(grantKey, grant, expiryMs);
  else await kvs.set(grantKey, grant);
  if (request) {
    await kvs.delete(requestKey);
    await (section ? dropSectionOwnerIndex(request) : dropOwnerIndex(request));
  }
  await writeMineIndex({ requesterAccountId: editorAccountId, kind: section ? "section" : "attachment", id, name, pageId: pageId || null, spaceKey: seal.spaceKey || null }).catch(() => {}); // SEC-8: the grantee's own list
  await recordActivity({
    type: "editreq.granted",
    pageId: pageId || null,
    spaceKey: seal.spaceKey || null,
    actor: { accountId, name: seal.lockedBy === accountId ? (seal.lockedByName || null) : null },
    target: { kind: section ? "section" : "attachment", id, name },
    details: { scope: section ? "section" : "attachment", editorAccountId, editorName, expiresAt: grant.expiresAt, hadRequest: request?.status || null },
    version: null,
  });
  if (pageId && (await notifyEnabled())) {
    try { await mailEditApproved(editorAccountId, name, pageId, null, { targetKind: section ? "section" : "attachment" }); } // SEC-9
    catch (e) { console.error("[EDIT-REQ] notify direct grant failed:", errText(e)); }
  }
  return { success: true, grant: { editorAccountId, editorName, grantedAt: grant.grantedAt, expiresAt: grant.expiresAt } };
}

export const grantEditAccess = async (req) => {
  const { attachmentId, editorAccountId } = req.payload || {};
  const accountId = req.context.accountId;
  if (!attachmentId || !editorAccountId || !accountId) return { success: false, reason: "Missing params" };
  const { seal, authorized } = await loadSealForOwnerAction(attachmentId, accountId);
  if (!seal) return { success: false, reason: "Seal not found" };
  if (!authorized) return { success: false, reason: "Not the seal owner" };
  { const held = heldRefusal(seal, "grant"); if (held) return { success: false, reason: held }; } // SEC-2
  return grantDirect({ scope: "attachment", id: attachmentId, seal, pageId: seal.contentId || null, name: seal.attachmentName || "Unknown Attachment", accountId, editorAccountId });
};

export const grantSectionEdit = async (req) => {
  const { sectionId, editorAccountId } = req.payload || {};
  const accountId = req.context.accountId;
  if (!sectionId || !editorAccountId || !accountId) return { success: false, reason: "Missing params" };
  const { seal, authorized } = await loadSectionForOwnerAction(sectionId, accountId);
  if (!seal) return { success: false, reason: "Section not found" };
  if (!authorized) return { success: false, reason: "Not the section owner" };
  { const held = heldRefusal(seal, "grant"); if (held) return { success: false, reason: held }; } // SEC-2
  return grantDirect({ scope: "section", id: sectionId, seal, pageId: seal.pageId || null, name: seal.sectionTitle || "a sealed section", accountId, editorAccountId });
};

/**
 * People the sealer can name — a Confluence user search, for a caller who owns (or stewards)
 * at least the seal they are acting on. The result is names + account ids the caller could
 * find in Confluence's own people search; whether the PICKED person may be granted is decided
 * by grantDirect, never here.
 */
export const searchGrantees = async (req) => {
  const { attachmentId, sectionId, query } = req.payload || {};
  const accountId = req.context.accountId;
  const q = typeof query === "string" ? query.trim().slice(0, 80) : "";
  if (!accountId || q.length < 2) return { users: [] };
  const gate = sectionId ? await loadSectionForOwnerAction(sectionId, accountId)
    : attachmentId ? await loadSealForOwnerAction(attachmentId, accountId) : { seal: null, authorized: false };
  if (!gate.seal || !gate.authorized) return { users: [], reason: "Not authorized" };
  try {
    const cql = `type=user AND user.fullname~"${q.replace(/["\\]/g, " ")}"`;
    const res = await appConfluence(route`/wiki/rest/api/search/user?cql=${cql}&limit=8`, { headers: { Accept: "application/json" } });
    if (!res.ok) return { users: [], reason: `Search failed (${res.status})` };
    const data = await res.json();
    const users = (data.results || [])
      .map((r) => r.user)
      .filter((u) => u?.accountId && u.accountType === "atlassian" && u.accountId !== gate.seal.lockedBy)
      .map((u) => ({ accountId: u.accountId, displayName: u.displayName || "Unknown user", avatar: u.profilePicture?.path || null }));
    return { users };
  } catch (e) {
    console.error("[EDIT-REQ] grantee search failed:", errText(e));
    return { users: [], reason: "Search failed" };
  }
};

// ===========================================================================
// Section edit requests (Content Sealing) — parallel to the attachment flow
// ===========================================================================

async function loadSectionForOwnerAction(sectionId, accountId) {
  const seal = await kvs.get(`section-protection-${sectionId}`);
  if (!seal || !seal.lockedBy) return { seal: null, authorized: false };
  let authorized = seal.lockedBy === accountId;
  if (!authorized) {
    // GAP 4 (req 2.3): the space is a property of the RECORD's page (CLAUDE.md — never the
    // caller's context space). A record sealed without a spaceKey used to refuse every steward;
    // its page's space answers. A page that moved needs both spaces (stewardOfSeal).
    authorized = await stewardOfSeal(authorizeSteward, accountId, seal);
  }
  return { seal, authorized };
}

export const requestSectionEdit = async (req) => {
  const { sectionId, reason } = req.payload || {};
  const accountId = req.context.accountId;
  if (!sectionId || !accountId) return { success: false, reason: "Missing context" };

  const seal = await kvs.get(`section-protection-${sectionId}`);
  if (!seal || !seal.lockedBy) return { success: false, reason: "This section is not sealed" };
  const proposal = isWorkflowHeld(seal); // SEC-2 (e): a request on a held seal is a proposal to the approvers
  // Owner first — self-knowledge, no disclosure, accurate message (see requestEditAccess).
  if (!proposal && seal.lockedBy === accountId) return { success: false, reason: "You own this section" };
  // SV-SEC-1, mirror of requestEditAccess: same oracle, and the same app-authored @mention
  // comment carrying the caller's text onto a page they may have no access to.
  if (seal.pageId && !(await canReadPage(accountId, seal.pageId))) {
    return { success: false, reason: "This section is not sealed" };
  }
  if (await getActiveSectionEditGrant(sectionId, accountId)) return { success: false, reason: "You already have edit access" };

  const existing = await kvs.get(`section-edit-request-${sectionId}-${accountId}`);
  if (existing?.status === "pending") return { success: false, reason: "Request already pending" };
  if (existing?.status === "denied") {
    const retryAt = retryAtFor(existing.deniedAt, await resolveEditCooldownMs());
    if (retryAt) return { success: false, reason: declinedReason(), retryAt };
  }

  let requesterName = "Unknown User";
  try {
    const userRes = await appConfluence(route`/wiki/rest/api/user?accountId=${accountId}`, { headers: { Accept: "application/json" } });
    if (userRes.ok) { const u = await userRes.json(); requesterName = u.displayName || requesterName; }
  } catch (_) { /* best effort */ }

  const sectionTitle = seal.sectionTitle || "a sealed section";
  const approvers = proposal ? proposalAskees(await proposalApproversFor(seal.pageId), accountId) : [];
  await kvs.set(`section-edit-request-${sectionId}-${accountId}`, {
    sectionId, requesterAccountId: accountId, requesterName, ownerAccountId: seal.lockedBy,
    contentId: seal.pageId || null, spaceKey: seal.spaceKey || null, sectionTitle,
    reason: typeof reason === "string" ? reason.trim().slice(0, 300) : "",
    status: "pending", requestedAt: new Date().toISOString(),
    ...(proposal ? { proposal: true, approvers } : {}),
  });
  // P1-3: the index row goes with the record (read back by key: the set is strongly consistent) —
  // the owner's row, or (SEC-2 (e)) one per approver for a proposal.
  const written = await kvs.get(`section-edit-request-${sectionId}-${accountId}`);
  if (proposal) await writeSectionProposalIndex(written).catch((e) => console.warn("[SECTION-EDIT-REQ] proposal index", errText(e)));
  else await writeSectionOwnerIndex(written).catch((e) => console.warn("[SECTION-EDIT-REQ] owner index", errText(e)));
  await writeMineIndex({ requesterAccountId: accountId, kind: "section", id: sectionId, name: sectionTitle, pageId: seal.pageId || null, spaceKey: seal.spaceKey || null }).catch((e) => console.warn("[SECTION-EDIT-REQ] mine index", errText(e))); // SEC-8
  // A1 (section scope)
  await recordActivity({
    type: "editreq.requested",
    pageId: seal.pageId || null,
    spaceKey: seal.spaceKey || null,
    actor: { accountId, name: requesterName },
    target: { kind: "section", id: sectionId, name: sectionTitle },
    details: {
      scope: "section",
      reason: typeof reason === "string" ? reason.trim().slice(0, 300) : "",
      ownerAccountId: seal.lockedBy || null,
      ...(proposal ? { proposal: true, approvers: approvers.slice(0, 10) } : {}),
    },
    version: null,
  });

  if (seal.pageId && (await notifyEnabled())) {
    try {
      for (const to of proposal ? proposalNotifyTargets(approvers) : [seal.lockedBy]) {
        await mailEditRequest(to, accountId, requesterName, sectionTitle, seal.pageId, reason, null, { targetKind: "section" });
      }
    } catch (e) { console.error("[SECTION-EDIT-REQ] notify failed:", errText(e)); }
  }
  return { success: true };
};

export const checkSectionEdit = async (req) => {
  const { sectionId } = req.payload || {};
  const accountId = req.context.accountId;
  if (!sectionId || !accountId) return { status: "none" };
  if (await getActiveSectionEditGrant(sectionId, accountId)) return { status: "granted" };
  const existing = await kvs.get(`section-edit-request-${sectionId}-${accountId}`);
  if (!existing) return { status: "none" };
  if (existing.status === "pending") return { status: "pending" };
  if (existing.status === "denied") {
    const retryAt = retryAtFor(existing.deniedAt, await resolveEditCooldownMs());
    if (!retryAt) { await kvs.delete(`section-edit-request-${sectionId}-${accountId}`); await dropSectionOwnerIndex(existing); return { status: "none" }; }
    return { status: "denied", deniedAt: existing.deniedAt, retryAt, deniedReason: existing.deniedReason || null };
  }
  return { status: "none" };
};

export const listSectionEditRequests = async (req) => {
  const { sectionId } = req.payload || {};
  const accountId = req.context.accountId;
  if (!sectionId) return { requests: [] };
  const { seal, authorized } = await loadSectionForOwnerAction(sectionId, accountId);
  if (!seal) return { requests: [], reason: "Not authorized" };
  const held = isWorkflowHeld(seal);
  if (!held && !authorized) return { requests: [], reason: "Not authorized" }; // SEC-2 (e): see listEditRequests
  const { results } = await kvs.query().where("key", WhereConditions.beginsWith(`section-edit-request-${sectionId}-`)).limit(50).getMany();
  const pending = (results || []).map(({ value }) => value).filter((v) => v?.status === "pending" && v.requesterAccountId !== accountId);
  if (!held) return { requests: pending };
  let admin = null;
  const isAdmin = async () => {
    if (admin === null) admin = await stewardOfSeal(isAccountStewardAsApp, accountId, seal);
    return admin;
  };
  const requests = [];
  const approverNow = proposalApproverCheck(seal.pageId);
  // 8.16: proposals are offered only to someone who can view the page (proposalAuthority's rule).
  const mayView = seal.pageId ? await canReadPage(accountId, seal.pageId) : false;
  if (mayView) for (const r of pending) if (await mayDecideProposal(r, accountId, isAdmin, () => approverNow(r, accountId))) requests.push(r);
  // Same answer as a refusal when there is nothing for this caller — no oracle on "is it held".
  if (!requests.length && !authorized) return { requests: [], reason: "Not authorized" };
  return { requests };
};

export const approveSectionEdit = async (req) => {
  const { sectionId, requesterAccountId } = req.payload || {};
  const accountId = req.context.accountId;
  if (!sectionId || !requesterAccountId) return { success: false, reason: "Missing params" };
  let { seal, authorized } = await loadSectionForOwnerAction(sectionId, accountId);
  if (!seal) return { success: false, reason: "Section not found" };
  const request0 = await kvs.get(`section-edit-request-${sectionId}-${requesterAccountId}`);
  if (request0?.proposal) { // SEC-2 (e)
    const pa = await proposalAuthority(request0, accountId, seal, seal.pageId, authorized);
    if (pa.refusal) return pa.refusal;
    authorized = pa.authorized;
  }
  if (!authorized) return { success: false, reason: request0?.proposal ? "Only this page's approvers or a space admin can decide a proposed change" : "Not the section owner" };
  if (isWorkflowHeld(seal)) {
    if (!request0?.proposal) { const held = heldRefusal(seal, "grant"); if (held) return { success: false, reason: held }; } // SEC-2
    // SEC-2 (e): the workflow's own door — move the page back for review (custody hands the seal back), then grant.
    const moved = await moveBackForProposal(seal.pageId, accountId, request0);
    if (!moved.success) return { success: false, reason: moved.reason };
    seal = (await kvs.get(`section-protection-${sectionId}`)) || seal;
    if (isWorkflowHeld(seal)) return { success: false, reason: "The page was moved back but the seal is still held — try again in a moment" };
  }
  // it54: an EXPIRED seal is inert (the section is no longer protected) — approving it would only
  // mint a dead, never-reaped grant (grant.expiresAt in the past → getActiveSectionEditGrant returns
  // null). Reject instead of leaking a zombie record.
  // F1: same asymmetry as the attachment path — see approveEditRequest.
  if (seal.expiresAt && new Date(seal.expiresAt).getTime() <= Date.now()) {
    return { success: false, reason: "This section's seal has lapsed — extend it first (⋯ → Extend the seal), then grant edit access" };
  }

  const requestKey = `section-edit-request-${sectionId}-${requesterAccountId}`;
  const request = await kvs.get(requestKey);
  // it51: approve only an EXISTING request (parity with denySectionEdit) — otherwise an owner/steward
  // could mint a grant for a user who never requested, with no request/audit trail.
  if (!request) return { success: false, reason: "Request not found" };
  const grant = { sectionId, editorAccountId: requesterAccountId, editorName: request?.requesterName || "User", grantedBy: accountId, grantedAt: new Date().toISOString(), expiresAt: seal.expiresAt || null };
  const grantKey = `section-edit-grant-${sectionId}-${requesterAccountId}`;
  const expiryMs = seal.expiresAt ? new Date(seal.expiresAt).getTime() : 0;
  if (expiryMs > Date.now()) await setUntil(grantKey, grant, expiryMs);
  else await kvs.set(grantKey, grant);
  await kvs.delete(requestKey);
  await dropSectionOwnerIndex(request);
  // A1 (section scope)
  await recordActivity({
    type: "editreq.approved",
    pageId: seal.pageId || null,
    spaceKey: seal.spaceKey || null,
    actor: { accountId, name: seal.lockedBy === accountId ? (seal.lockedByName || null) : null },
    target: { kind: "section", id: sectionId, name: seal.sectionTitle || "Sealed section" },
    details: { scope: "section", requesterAccountId, requesterName: grant.editorName, expiresAt: grant.expiresAt, ...(request?.proposal ? { proposal: true } : {}) },
    version: null,
  });

  if (seal.pageId && (await notifyEnabled())) {
    try { await mailEditApproved(requesterAccountId, seal.sectionTitle || "a sealed section", seal.pageId, null, { targetKind: "section" }); } catch (_) { /* best effort */ }
  }
  return { success: true };
};

export const denySectionEdit = async (req) => {
  const { sectionId, requesterAccountId } = req.payload || {};
  const deniedReason = clip(req.payload?.reason); // SEC-8
  const accountId = req.context.accountId;
  if (!sectionId || !requesterAccountId) return { success: false, reason: "Missing params" };
  let { seal, authorized } = await loadSectionForOwnerAction(sectionId, accountId);
  if (!seal) return { success: false, reason: "Section not found" };
  const requestKey = `section-edit-request-${sectionId}-${requesterAccountId}`;
  const existing = await kvs.get(requestKey);
  if (existing?.proposal) { // SEC-2 (e)
    const pa = await proposalAuthority(existing, accountId, seal, seal.pageId, authorized);
    if (pa.refusal) return pa.refusal;
    authorized = pa.authorized;
  }
  if (!authorized) return { success: false, reason: existing?.proposal ? "Only this page's approvers or a space admin can decide a proposed change" : "Not the section owner" };
  if (!existing?.proposal) { const held = heldRefusal(seal, "grant"); if (held) return { success: false, reason: held }; } // SEC-2
  if (!existing) return { success: false, reason: "Request not found" };
  await kvs.set(requestKey, { ...existing, status: "denied", deniedAt: new Date().toISOString(), deniedReason: deniedReason || null });
  await dropSectionOwnerIndex(existing);
  // A1 (section scope)
  await recordActivity({
    type: "editreq.denied",
    pageId: seal.pageId || null,
    spaceKey: seal.spaceKey || null,
    actor: { accountId, name: seal.lockedBy === accountId ? (seal.lockedByName || null) : null },
    target: { kind: "section", id: sectionId, name: seal.sectionTitle || "Sealed section" },
    details: { scope: "section", requesterAccountId, requesterName: existing.requesterName || null, reason: deniedReason || null },
    version: null,
  });
  if (seal.pageId && (await notifyEnabled())) {
    try { await mailEditDenied(requesterAccountId, seal.sectionTitle || "a sealed section", seal.pageId, null, { targetKind: "section", reason: deniedReason }); } catch (_) { /* best effort */ }
  }
  return { success: true };
};

/**
 * GAP 5 (req 2.3): revoke an active SECTION edit grant (owner/steward). Deletes the key
 * approveSectionEdit writes; mirrors revokeEditGrant for attachments.
 */
export const revokeSectionEditGrant = async (req) => {
  const { sectionId, editorAccountId } = req.payload || {};
  const accountId = req.context.accountId;
  if (!sectionId || !editorAccountId) return { success: false, reason: "Missing params" };
  const { seal, authorized } = await loadSectionForOwnerAction(sectionId, accountId);
  if (!seal) return { success: false, reason: "Section not found" };
  if (!authorized) return { success: false, reason: "Not the section owner" };
  { const held = heldRefusal(seal, "grant"); if (held) return { success: false, reason: held }; } // SEC-2

  const grantKey = `section-edit-grant-${sectionId}-${editorAccountId}`;
  if (!(await kvs.get(grantKey))) return { success: false, reason: "No active grant for that editor" };
  await kvs.delete(grantKey);
  // A1 (section scope): the grant is gone from this delete on, and there WAS one.
  await recordActivity({
    type: "editreq.revoked",
    pageId: seal.pageId || null,
    spaceKey: seal.spaceKey || null,
    actor: { accountId, name: seal.lockedBy === accountId ? (seal.lockedByName || null) : null },
    target: { kind: "section", id: sectionId, name: seal.sectionTitle || "Sealed section" },
    details: { scope: "section", editorAccountId },
    version: null,
  });
  return { success: true };
};

/**
 * Owner/steward: active edit grants on a SECTION — the section twin of listEditGrants, so the
 * panel can show "Editors with access" and revoke from the row (docx report 2026-09-15, item 6:
 * a granted right could be seen on the editor's side but never taken back by the owner).
 */
export const listSectionEditGrants = async (req) => {
  const { sectionId } = req.payload || {};
  const accountId = req.context.accountId;
  if (!sectionId) return { grants: [] };
  const { seal, authorized } = await loadSectionForOwnerAction(sectionId, accountId);
  if (!seal || !authorized) return { grants: [], reason: "Not authorized" };
  const { results } = await kvs
    .query()
    .where("key", WhereConditions.beginsWith(`section-edit-grant-${sectionId}-`))
    .limit(50)
    .getMany();
  const now = Date.now();
  const grants = (results || [])
    .map(({ value }) => value)
    .filter((g) => g && (!g.expiresAt || new Date(g.expiresAt).getTime() > now));
  return { grants };
};

/**
 * P1-3: owner inbox for SECTIONS — every pending edit request on a sealed section the caller
 * owns, across every space. Same K1 shape as listMyEditRequests: the caller's own index prefix,
 * each row confirmed by key, stale rows healed. Nothing in the payload is read.
 */
const listMySectionEditRequests = async (req) => {
  const accountId = req.context.accountId;
  if (!accountId) return { requests: [] };
  const stats = { unverified: 0 };
  const requests = await viewableProposals(await listPendingSectionRequestsForOwner(accountId), accountId, { stats });
  return { requests, unverified: stats.unverified };
};

/**
 * P1-3: what is waiting on the caller, as numbers — for the My work header. SVT-147: every number
 * counts exactly what its list on My work lists, by the list's own rule: approvals through
 * waitingApprovals (the inbox's rows), file and section requests through viewableProposals (the
 * request lists' rows), access requests through listMyStewardRequestsCore (the access list's rows).
 * Before, the approvals and request numbers read the raw indexes and could be higher than the lists.
 * The space-admin aggregate costs nothing when no space has anyone waiting (the common case).
 * Every arm fails soft to 0 so one broken index cannot blank the whole badge.
 */
/**
 * SEC-8: the caller's OWN requests — pending / declined (inside the cooldown, with the owner's
 * reason and the retry time) / granted (with the grant's expiry). The requester used to be the one
 * person with nowhere to look. Index read only (editreq-mine-{me}-…), confirmed by key.
 */
const listMyRequestsAction = async (req) => {
  const accountId = req.context.accountId;
  if (!accountId) return { requests: [] };
  const requests = await listMyRequests(accountId, await resolveEditCooldownMs());
  return { requests };
};

const countMyWork = async (req) => {
  const accountId = req.context.accountId;
  if (!accountId) return { approvals: 0, fileRequests: 0, sectionRequests: 0, accessRequests: 0, total: 0, unverified: 0 };
  const settle = async (p) => { try { return (await p).length; } catch (e) { console.warn("[MY-WORK] count", errText(e)); return 0; } };
  // One view check per page for the whole count (the arms share `memo`); a check Confluence could not
  // answer leaves that row out of the number, as its list does, and is counted in `unverified`.
  const stats = { unverified: 0 };
  const memo = new Map();
  const [approvals, fileRequests, sectionRequests, accessRequests] = await Promise.all([
    settle(waitingApprovals(accountId, { stats, memo })),
    settle(listPendingRequestsForOwner(accountId).then((rows) => viewableProposals(rows, accountId, { stats, memo }))),
    settle(listPendingSectionRequestsForOwner(accountId).then((rows) => viewableProposals(rows, accountId, { stats, memo }))),
    settle(listMyStewardRequestsCore(accountId).then((r) => r.requests)),
  ]);
  return { approvals, fileRequests, sectionRequests, accessRequests, total: approvals + fileRequests + sectionRequests + accessRequests, unverified: stats.unverified };
};

export const actions = [
  ["request-edit-access", requestEditAccess],
  ["check-edit-request", checkEditRequest],
  ["list-edit-requests", listEditRequests],
  ["list-my-edit-requests", listMyEditRequests],
  ["approve-edit-request", approveEditRequest],
  ["deny-edit-request", denyEditRequest],
  ["revoke-edit-grant", revokeEditGrant],
  ["list-edit-grants", listEditGrants],
  ["request-section-edit", requestSectionEdit],
  ["check-section-edit", checkSectionEdit],
  ["list-section-edit-requests", listSectionEditRequests],
  ["list-my-section-edit-requests", listMySectionEditRequests],
  ["list-my-requests", listMyRequestsAction], // SEC-8
  ["count-my-work", countMyWork],
  ["approve-section-edit", approveSectionEdit],
  ["deny-section-edit", denySectionEdit],
  ["revoke-section-edit-grant", revokeSectionEditGrant],
  ["list-section-edit-grants", listSectionEditGrants],
  ["grant-edit-access", grantEditAccess],
  ["grant-section-edit", grantSectionEdit],
  ["search-grantees", searchGrantees],
];
