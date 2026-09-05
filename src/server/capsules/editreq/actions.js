import { asApp, route } from "@forge/api";
import { kvs, WhereConditions } from "@forge/kvs";

import { authorizeSteward } from "../../shared/steward-checks.js";
import { resolveBulletinToggles } from "../../shared/bulletin-flags.js";
import { setUntil } from "../../shared/kvs-ttl.js";
import {
  mailEditRequest,
  mailEditApproved,
  mailEditDenied,
} from "../../infra/notice-composer.js";
import { getActiveEditGrant, getActiveSectionEditGrant, writeOwnerIndex, dropOwnerIndex, listPendingRequestsForOwner } from "./logic.js";
import { canReadPage } from "../../shared/content-access.js";
import { recordActivity } from "../../infra/activity-log.js";

const COOLDOWN_MS = 48 * 60 * 60 * 1000; // 48h after a denial before re-requesting

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
  if (!seal || !seal.lockedBy) return { success: false, reason: "This file is not sealed" };
  // The owner check runs FIRST deliberately: it is self-knowledge (you are this record's
  // lockedBy), so it discloses nothing, and the owner gets the accurate message rather than the
  // deliberately-vague one below.
  if (seal.lockedBy === accountId) return { success: false, reason: "You own this seal" };
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
    const deniedAt = existing.deniedAt ? new Date(existing.deniedAt).getTime() : 0;
    if (Date.now() - deniedAt < COOLDOWN_MS) {
      return { success: false, reason: "A previous request was declined; try again later" };
    }
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
  });
  // K1: the owner's index row goes with the record (read back by key: the set is strongly consistent).
  await writeOwnerIndex(await kvs.get(`edit-request-${attachmentId}-${accountId}`)).catch((e) => console.warn("[EDIT-ACCESS] owner index", e));
  // A1: the request exists from this write on.
  await recordActivity({
    type: "editreq.requested",
    pageId: seal.contentId || null,
    spaceKey: seal.spaceKey || null,
    actor: { accountId, name: requesterName },
    target: { kind: "attachment", id: attachmentId, name: seal.attachmentName || null },
    details: { scope: "attachment", reason: requestReason, ownerAccountId: seal.lockedBy || null },
    version: null,
  });

  if (seal.contentId && (await notifyEnabled())) {
    try {
      await mailEditRequest(
        seal.lockedBy, accountId, requesterName,
        seal.attachmentName || "Unknown Attachment", seal.contentId, requestReason,
      );
    } catch (e) { console.error("[EDIT-REQ] notify owner failed:", e); }
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
    const deniedAt = existing.deniedAt ? new Date(existing.deniedAt).getTime() : 0;
    if (Date.now() - deniedAt >= COOLDOWN_MS) {
      await kvs.delete(`edit-request-${attachmentId}-${accountId}`);
      await dropOwnerIndex(existing);
      return { status: "none" };
    }
    return { status: "denied", deniedAt: existing.deniedAt };
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
  const { seal, authorized } = await loadSealForOwnerAction(attachmentId, accountId);
  if (!seal) return { success: false, reason: "Seal not found" };
  if (!authorized) return { success: false, reason: "Not the seal owner" };
  // it54: an EXPIRED seal is inert — approving it would only mint a dead, never-reaped grant. Reject.
  // F1 (owner feedback 2026-08-27): "the request remains available even if I choose approve; it
  // disappears if I choose deny instead". This branch was the cause — deny has no expiry check, so
  // on an overdue seal (which every seal in the reported screenshot was) approve failed while deny
  // worked, and the panel swallowed the failure into a console.error. Still a refusal, because the
  // grant really would be born dead, but the message now names the fix the UI can actually offer.
  if (seal.expiresAt && new Date(seal.expiresAt).getTime() <= Date.now()) {
    return { success: false, reason: "This seal has lapsed — extend it first, then grant edit access" };
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
    details: { scope: "attachment", requesterAccountId, requesterName: editorName, expiresAt: grant.expiresAt },
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
 * Deny a request → mark denied (48h cooldown before retry).
 */
export const denyEditRequest = async (req) => {
  const { attachmentId, requesterAccountId } = req.payload || {};
  const accountId = req.context.accountId;
  if (!attachmentId || !requesterAccountId) return { success: false, reason: "Missing params" };
  const { seal, authorized } = await loadSealForOwnerAction(attachmentId, accountId);
  if (!seal) return { success: false, reason: "Seal not found" };
  if (!authorized) return { success: false, reason: "Not the seal owner" };

  const requestKey = `edit-request-${attachmentId}-${requesterAccountId}`;
  const existing = await kvs.get(requestKey);
  if (!existing) return { success: false, reason: "Request not found" };
  await kvs.set(requestKey, { ...existing, status: "denied", deniedAt: new Date().toISOString() });
  await dropOwnerIndex(existing);
  // A1
  await recordActivity({
    type: "editreq.denied",
    pageId: seal.contentId || null,
    spaceKey: seal.spaceKey || null,
    actor: { accountId, name: seal.lockedBy === accountId ? (seal.lockedByName || null) : null },
    target: { kind: "attachment", id: attachmentId, name: seal.attachmentName || null },
    details: { scope: "attachment", requesterAccountId, requesterName: existing.requesterName || null },
    version: null,
  });

  if (seal.contentId && (await notifyEnabled())) {
    try {
      await mailEditDenied(requesterAccountId, seal.attachmentName || "Unknown Attachment", seal.contentId);
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
// Section edit requests (Content Sealing) — parallel to the attachment flow
// ===========================================================================

async function loadSectionForOwnerAction(sectionId, accountId) {
  const seal = await kvs.get(`section-protection-${sectionId}`);
  if (!seal || !seal.lockedBy) return { seal: null, authorized: false };
  let authorized = seal.lockedBy === accountId;
  if (!authorized) {
    try { authorized = await authorizeSteward(accountId, seal.spaceKey); } catch (_) { /* deny */ }
  }
  return { seal, authorized };
}

export const requestSectionEdit = async (req) => {
  const { sectionId, reason } = req.payload || {};
  const accountId = req.context.accountId;
  if (!sectionId || !accountId) return { success: false, reason: "Missing context" };

  const seal = await kvs.get(`section-protection-${sectionId}`);
  if (!seal || !seal.lockedBy) return { success: false, reason: "This section is not sealed" };
  // Owner first — self-knowledge, no disclosure, accurate message (see requestEditAccess).
  if (seal.lockedBy === accountId) return { success: false, reason: "You own this section" };
  // SV-SEC-1, mirror of requestEditAccess: same oracle, and the same app-authored @mention
  // comment carrying the caller's text onto a page they may have no access to.
  if (seal.pageId && !(await canReadPage(accountId, seal.pageId))) {
    return { success: false, reason: "This section is not sealed" };
  }
  if (await getActiveSectionEditGrant(sectionId, accountId)) return { success: false, reason: "You already have edit access" };

  const existing = await kvs.get(`section-edit-request-${sectionId}-${accountId}`);
  if (existing?.status === "pending") return { success: false, reason: "Request already pending" };
  if (existing?.status === "denied") {
    const deniedAt = existing.deniedAt ? new Date(existing.deniedAt).getTime() : 0;
    if (Date.now() - deniedAt < COOLDOWN_MS) return { success: false, reason: "A previous request was declined; try again later" };
  }

  let requesterName = "Unknown User";
  try {
    const userRes = await asApp().requestConfluence(route`/wiki/rest/api/user?accountId=${accountId}`, { headers: { Accept: "application/json" } });
    if (userRes.ok) { const u = await userRes.json(); requesterName = u.displayName || requesterName; }
  } catch (_) { /* best effort */ }

  const sectionTitle = seal.sectionTitle || "a sealed section";
  await kvs.set(`section-edit-request-${sectionId}-${accountId}`, {
    sectionId, requesterAccountId: accountId, requesterName, ownerAccountId: seal.lockedBy,
    contentId: seal.pageId || null, spaceKey: seal.spaceKey || null, sectionTitle,
    reason: typeof reason === "string" ? reason.trim().slice(0, 300) : "",
    status: "pending", requestedAt: new Date().toISOString(),
  });
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
    },
    version: null,
  });

  if (seal.pageId && (await notifyEnabled())) {
    try { await mailEditRequest(seal.lockedBy, accountId, requesterName, sectionTitle, seal.pageId, reason); }
    catch (e) { console.error("[SECTION-EDIT-REQ] notify failed:", e); }
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
    const deniedAt = existing.deniedAt ? new Date(existing.deniedAt).getTime() : 0;
    if (Date.now() - deniedAt >= COOLDOWN_MS) { await kvs.delete(`section-edit-request-${sectionId}-${accountId}`); return { status: "none" }; }
    return { status: "denied" };
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
  const { seal, authorized } = await loadSectionForOwnerAction(sectionId, accountId);
  if (!seal) return { success: false, reason: "Section not found" };
  if (!authorized) return { success: false, reason: "Not the section owner" };
  // it54: an EXPIRED seal is inert (the section is no longer protected) — approving it would only
  // mint a dead, never-reaped grant (grant.expiresAt in the past → getActiveSectionEditGrant returns
  // null). Reject instead of leaking a zombie record.
  // F1: same asymmetry as the attachment path — see approveEditRequest.
  if (seal.expiresAt && new Date(seal.expiresAt).getTime() <= Date.now()) {
    return { success: false, reason: "This section's seal has lapsed — extend it first, then grant edit access" };
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
  // A1 (section scope)
  await recordActivity({
    type: "editreq.approved",
    pageId: seal.pageId || null,
    spaceKey: seal.spaceKey || null,
    actor: { accountId, name: seal.lockedBy === accountId ? (seal.lockedByName || null) : null },
    target: { kind: "section", id: sectionId, name: seal.sectionTitle || "Sealed section" },
    details: { scope: "section", requesterAccountId, requesterName: grant.editorName, expiresAt: grant.expiresAt },
    version: null,
  });

  if (seal.pageId && (await notifyEnabled())) {
    try { await mailEditApproved(requesterAccountId, seal.sectionTitle || "a sealed section", seal.pageId); } catch (_) { /* best effort */ }
  }
  return { success: true };
};

export const denySectionEdit = async (req) => {
  const { sectionId, requesterAccountId } = req.payload || {};
  const accountId = req.context.accountId;
  if (!sectionId || !requesterAccountId) return { success: false, reason: "Missing params" };
  const { seal, authorized } = await loadSectionForOwnerAction(sectionId, accountId);
  if (!seal) return { success: false, reason: "Section not found" };
  if (!authorized) return { success: false, reason: "Not the section owner" };
  const requestKey = `section-edit-request-${sectionId}-${requesterAccountId}`;
  const existing = await kvs.get(requestKey);
  if (!existing) return { success: false, reason: "Request not found" };
  await kvs.set(requestKey, { ...existing, status: "denied", deniedAt: new Date().toISOString() });
  // A1 (section scope)
  await recordActivity({
    type: "editreq.denied",
    pageId: seal.pageId || null,
    spaceKey: seal.spaceKey || null,
    actor: { accountId, name: seal.lockedBy === accountId ? (seal.lockedByName || null) : null },
    target: { kind: "section", id: sectionId, name: seal.sectionTitle || "Sealed section" },
    details: { scope: "section", requesterAccountId, requesterName: existing.requesterName || null },
    version: null,
  });
  if (seal.pageId && (await notifyEnabled())) {
    try { await mailEditDenied(requesterAccountId, seal.sectionTitle || "a sealed section", seal.pageId); } catch (_) { /* best effort */ }
  }
  return { success: true };
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
  ["approve-section-edit", approveSectionEdit],
  ["deny-section-edit", denySectionEdit],
];
