import { asApp, route } from "@forge/api";
import { kvs, WhereConditions } from "@forge/kvs";

import { authorizeSteward } from "../../shared/steward-checks.js";
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
import { listMyApprovals } from "../workflow/approvals.js";
import { canReadPage, resolvePageSpaceKey } from "../../shared/content-access.js";
import { recordActivity } from "../../infra/activity-log.js";

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
  if (!authorized) {
    try { authorized = await authorizeSteward(accountId, seal.spaceKey); }
    catch (_) { /* default deny */ }
  }
  return { seal, authorized };
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
async function moveBackForProposal(pageId, approverAccountId, request) {
  const wf = await import("../workflow/logic.js");
  const record = await wf.readPageWorkflow(pageId);
  if (!record?.enforce) return { success: true, moved: false }; // already handed back
  const def = await wf.resolveWorkflowDef(record.spaceKey, record.workflowId);
  const settings = await wf.getSpaceWorkflowSettings(record.spaceKey);
  const target = wf.resolveDemoteTarget(def, settings, record.stateId);
  if (!target?.id) return { success: false, reason: "This workflow has no state to move the page back to" };
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
    const userRes = await asApp().requestConfluence(
      route`/wiki/rest/api/user?accountId=${accountId}`,
      { headers: { Accept: "application/json" } },
    );
    if (userRes.ok) {
      const u = await userRes.json();
      requesterName = u.displayName || requesterName;
    }
  } catch (_) { /* best effort */ }

  const approvers = proposal ? await proposalApproversFor(seal.contentId) : [];
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
  if (proposal) await writeProposalIndex(written).catch((e) => console.warn("[EDIT-ACCESS] proposal index", e));
  else await writeOwnerIndex(written).catch((e) => console.warn("[EDIT-ACCESS] owner index", e));
  await writeMineIndex({ requesterAccountId: accountId, kind: "attachment", id: attachmentId, name: seal.attachmentName || null, pageId: seal.contentId || null, spaceKey: seal.spaceKey || null }).catch((e) => console.warn("[EDIT-ACCESS] mine index", e)); // SEC-8
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
      for (const to of proposal ? (approvers.length ? approvers : [seal.lockedBy]) : [seal.lockedBy]) {
        await mailEditRequest(to, accountId, requesterName, seal.attachmentName || "Unknown Attachment", seal.contentId, requestReason);
      }
    } catch (e) { console.error("[EDIT-REQ] notify failed:", e); }
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
  if (!seal || !authorized) return { requests: [], reason: "Not authorized" };

  const { results } = await kvs
    .query()
    .where("key", WhereConditions.beginsWith(`edit-request-${attachmentId}-`))
    .limit(50)
    .getMany();
  const requests = (results || []).map(({ value }) => value).filter((v) => v?.status === "pending");
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
  const requests = await listPendingRequestsForOwner(accountId);
  return { requests };
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
  if (!authorized && request0?.proposal && (request0.approvers || []).includes(accountId)) authorized = true;
  if (!authorized) return { success: false, reason: "Not the seal owner" };
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
    } catch (e) { console.error("[EDIT-REQ] notify approve failed:", e); }
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
  if (!authorized && existing?.proposal && (existing.approvers || []).includes(accountId)) authorized = true; // SEC-2 (e)
  if (!authorized) return { success: false, reason: "Not the seal owner" };
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
    } catch (e) { console.error("[EDIT-REQ] notify deny failed:", e); }
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
    const res = await asApp().requestConfluence(route`/wiki/rest/api/user?accountId=${accountId}`, { headers: { Accept: "application/json" } });
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
    catch (e) { console.error("[EDIT-REQ] notify direct grant failed:", e); }
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
    const res = await asApp().requestConfluence(route`/wiki/rest/api/search/user?cql=${cql}&limit=8`, { headers: { Accept: "application/json" } });
    if (!res.ok) return { users: [], reason: `Search failed (${res.status})` };
    const data = await res.json();
    const users = (data.results || [])
      .map((r) => r.user)
      .filter((u) => u?.accountId && u.accountType === "atlassian" && u.accountId !== gate.seal.lockedBy)
      .map((u) => ({ accountId: u.accountId, displayName: u.displayName || "Unknown user", avatar: u.profilePicture?.path || null }));
    return { users };
  } catch (e) {
    console.error("[EDIT-REQ] grantee search failed:", e);
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
    // resolve it from the page like unsealSection does.
    try {
      const objectSpaceKey = seal.spaceKey || (seal.pageId ? await resolvePageSpaceKey(seal.pageId) : null);
      authorized = !!objectSpaceKey && await authorizeSteward(accountId, objectSpaceKey);
    } catch (_) { /* deny */ }
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
    const userRes = await asApp().requestConfluence(route`/wiki/rest/api/user?accountId=${accountId}`, { headers: { Accept: "application/json" } });
    if (userRes.ok) { const u = await userRes.json(); requesterName = u.displayName || requesterName; }
  } catch (_) { /* best effort */ }

  const sectionTitle = seal.sectionTitle || "a sealed section";
  const approvers = proposal ? await proposalApproversFor(seal.pageId) : [];
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
  if (proposal) await writeSectionProposalIndex(written).catch((e) => console.warn("[SECTION-EDIT-REQ] proposal index", e));
  else await writeSectionOwnerIndex(written).catch((e) => console.warn("[SECTION-EDIT-REQ] owner index", e));
  await writeMineIndex({ requesterAccountId: accountId, kind: "section", id: sectionId, name: sectionTitle, pageId: seal.pageId || null, spaceKey: seal.spaceKey || null }).catch((e) => console.warn("[SECTION-EDIT-REQ] mine index", e)); // SEC-8
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
      for (const to of proposal ? (approvers.length ? approvers : [seal.lockedBy]) : [seal.lockedBy]) {
        await mailEditRequest(to, accountId, requesterName, sectionTitle, seal.pageId, reason, null, { targetKind: "section" });
      }
    } catch (e) { console.error("[SECTION-EDIT-REQ] notify failed:", e); }
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
  if (!seal || !authorized) return { requests: [], reason: "Not authorized" };
  const { results } = await kvs.query().where("key", WhereConditions.beginsWith(`section-edit-request-${sectionId}-`)).limit(50).getMany();
  return { requests: (results || []).map(({ value }) => value).filter((v) => v?.status === "pending") };
};

export const approveSectionEdit = async (req) => {
  const { sectionId, requesterAccountId } = req.payload || {};
  const accountId = req.context.accountId;
  if (!sectionId || !requesterAccountId) return { success: false, reason: "Missing params" };
  let { seal, authorized } = await loadSectionForOwnerAction(sectionId, accountId);
  if (!seal) return { success: false, reason: "Section not found" };
  const request0 = await kvs.get(`section-edit-request-${sectionId}-${requesterAccountId}`);
  if (!authorized && request0?.proposal && (request0.approvers || []).includes(accountId)) authorized = true; // SEC-2 (e)
  if (!authorized) return { success: false, reason: "Not the section owner" };
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
  if (!authorized && existing?.proposal && (existing.approvers || []).includes(accountId)) authorized = true; // SEC-2 (e)
  if (!authorized) return { success: false, reason: "Not the section owner" };
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
  const requests = await listPendingSectionRequestsForOwner(accountId);
  return { requests };
};

/**
 * P1-3: what is waiting on the caller, as numbers — for the My work header and, later, the
 * ribbon/chip badge. Index reads only: three per-caller prefixes confirmed by key, and the
 * space-admin aggregate, which costs nothing when no space has anyone waiting (the common case)
 * and one role check per such space otherwise. `approvals` is the raw index count (it does not
 * drop approvals on trashed pages or AI-blocked transitions the way the inbox lister does, which
 * needs a REST lookup per page); the inbox card stays the authority for what is listed.
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
  if (!accountId) return { approvals: 0, fileRequests: 0, sectionRequests: 0, accessRequests: 0, total: 0 };
  const settle = async (p) => { try { return (await p).length; } catch (e) { console.warn("[MY-WORK] count", e); return 0; } };
  const [approvals, fileRequests, sectionRequests, accessRequests] = await Promise.all([
    settle(listMyApprovals(accountId)),
    settle(listPendingRequestsForOwner(accountId)),
    settle(listPendingSectionRequestsForOwner(accountId)),
    settle(listMyStewardRequestsCore(accountId).then((r) => r.requests)),
  ]);
  return { approvals, fileRequests, sectionRequests, accessRequests, total: approvals + fileRequests + sectionRequests + accessRequests };
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
