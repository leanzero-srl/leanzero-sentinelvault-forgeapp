import { asApp, route } from "@forge/api";
import { kvs, WhereConditions } from "@forge/kvs";

import { authorizeSteward } from "../../shared/steward-checks.js";
import { resolveBulletinToggles } from "../../shared/bulletin-flags.js";
import {
  mailEditRequest,
  mailEditApproved,
  mailEditDenied,
} from "../../infra/notice-composer.js";
import { getActiveEditGrant, getActiveSectionEditGrant } from "./logic.js";

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
  if (seal.lockedBy === accountId) return { success: false, reason: "You own this seal" };

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
      return { status: "none" };
    }
    return { status: "denied", deniedAt: existing.deniedAt };
  }
  return { status: "none" };
};

/**
 * List pending requests for one attachment (owner/steward only).
 */
const listEditRequests = async (req) => {
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

  const requests = [];
  let query = kvs.query().where("key", WhereConditions.beginsWith("edit-request-")).limit(100);
  let iterations = 0;
  do {
    const { results, nextCursor } = await query.getMany();
    for (const { value } of results || []) {
      if (value?.ownerAccountId === accountId && value?.status === "pending") {
        requests.push(value);
      }
    }
    if (!nextCursor || ++iterations >= 10) break;
    query = kvs
      .query()
      .where("key", WhereConditions.beginsWith("edit-request-"))
      .limit(100)
      .cursor(nextCursor);
  } while (true);
  return { requests };
};

/**
 * Approve a request → write an edit grant scoped to the seal's lifetime.
 */
const approveEditRequest = async (req) => {
  const { attachmentId, requesterAccountId } = req.payload || {};
  const accountId = req.context.accountId;
  if (!attachmentId || !requesterAccountId) return { success: false, reason: "Missing params" };
  const { seal, authorized } = await loadSealForOwnerAction(attachmentId, accountId);
  if (!seal) return { success: false, reason: "Seal not found" };
  if (!authorized) return { success: false, reason: "Not the seal owner" };

  const requestKey = `edit-request-${attachmentId}-${requesterAccountId}`;
  const request = await kvs.get(requestKey);
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
    await kvs.set(grantKey, grant, { expiresAt: expiryMs });
  } else {
    await kvs.set(grantKey, grant);
  }

  await kvs.delete(requestKey);

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
const denyEditRequest = async (req) => {
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
const revokeEditGrant = async (req) => {
  const { attachmentId, editorAccountId } = req.payload || {};
  const accountId = req.context.accountId;
  if (!attachmentId || !editorAccountId) return { success: false, reason: "Missing params" };
  const { seal, authorized } = await loadSealForOwnerAction(attachmentId, accountId);
  if (!seal) return { success: false, reason: "Seal not found" };
  if (!authorized) return { success: false, reason: "Not the seal owner" };

  await kvs.delete(`edit-grant-${attachmentId}-${editorAccountId}`);
  return { success: true };
};

/**
 * List active editors for an attachment (owner/steward).
 */
const listEditGrants = async (req) => {
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

const requestSectionEdit = async (req) => {
  const { sectionId, reason } = req.payload || {};
  const accountId = req.context.accountId;
  if (!sectionId || !accountId) return { success: false, reason: "Missing context" };

  const seal = await kvs.get(`section-protection-${sectionId}`);
  if (!seal || !seal.lockedBy) return { success: false, reason: "This section is not sealed" };
  if (seal.lockedBy === accountId) return { success: false, reason: "You own this section" };
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

  if (seal.pageId && (await notifyEnabled())) {
    try { await mailEditRequest(seal.lockedBy, accountId, requesterName, sectionTitle, seal.pageId, reason); }
    catch (e) { console.error("[SECTION-EDIT-REQ] notify failed:", e); }
  }
  return { success: true };
};

const checkSectionEdit = async (req) => {
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

const listSectionEditRequests = async (req) => {
  const { sectionId } = req.payload || {};
  const accountId = req.context.accountId;
  if (!sectionId) return { requests: [] };
  const { seal, authorized } = await loadSectionForOwnerAction(sectionId, accountId);
  if (!seal || !authorized) return { requests: [], reason: "Not authorized" };
  const { results } = await kvs.query().where("key", WhereConditions.beginsWith(`section-edit-request-${sectionId}-`)).limit(50).getMany();
  return { requests: (results || []).map(({ value }) => value).filter((v) => v?.status === "pending") };
};

const approveSectionEdit = async (req) => {
  const { sectionId, requesterAccountId } = req.payload || {};
  const accountId = req.context.accountId;
  if (!sectionId || !requesterAccountId) return { success: false, reason: "Missing params" };
  const { seal, authorized } = await loadSectionForOwnerAction(sectionId, accountId);
  if (!seal) return { success: false, reason: "Section not found" };
  if (!authorized) return { success: false, reason: "Not the section owner" };

  const requestKey = `section-edit-request-${sectionId}-${requesterAccountId}`;
  const request = await kvs.get(requestKey);
  const grant = { sectionId, editorAccountId: requesterAccountId, editorName: request?.requesterName || "User", grantedBy: accountId, grantedAt: new Date().toISOString(), expiresAt: seal.expiresAt || null };
  const grantKey = `section-edit-grant-${sectionId}-${requesterAccountId}`;
  const expiryMs = seal.expiresAt ? new Date(seal.expiresAt).getTime() : 0;
  if (expiryMs > Date.now()) await kvs.set(grantKey, grant, { expiresAt: expiryMs });
  else await kvs.set(grantKey, grant);
  await kvs.delete(requestKey);

  if (seal.pageId && (await notifyEnabled())) {
    try { await mailEditApproved(requesterAccountId, seal.sectionTitle || "a sealed section", seal.pageId); } catch (_) { /* best effort */ }
  }
  return { success: true };
};

const denySectionEdit = async (req) => {
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
