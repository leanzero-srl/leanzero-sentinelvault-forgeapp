import { asApp, asUser, route } from "@forge/api";
import { kvs, WhereConditions } from "@forge/kvs";
import { resolveRealm } from "./logic.js";
import { Queue } from "@forge/events";

import { authorizeSteward, isOperatorSteward, isOperatorSiteAdmin, isOperatorRealmSteward, isOperatorInStewardCohorts, newStewardMemo } from "../../shared/steward-checks.js";
import { mapLimited } from "../../shared/map-limited.js";
import { probeAttachmentStatus } from "../../infra/attachment-status.js";
import { releaseSeal } from "../sealing/release.js"; // the ONE attachment-seal teardown
import { writeSpaceIndex, listSpacesWithPendingStewardRequests, listPendingStewardRequestsInSpace } from "../editreq/logic.js";
import {
  mailStewardOverrideNotice,
  fetchOperatorProfile,
} from "../../infra/notice-composer.js";
import { recordActivity } from "../../infra/activity-log.js";
import { canEditPage, objectSpaceKeyOf } from "../../shared/content-access.js";
import { validateReleaseReason } from "../../shared/release-reason.js";

// Queue for background realm scanning
// it57: realm-audit-queue is constructed lazily at push time (see launch-realm-audit) so this module
// is import-safe for the dev test-hook (no Queue at module load — the it17 trap).

// audit D7: sanitize a space key for use in a KVS key (a personal `~`-space key would
// otherwise throw). Matches the regex admin-settings-space-* already uses.
const skKey = (k) => String(k).replace(/[^a-zA-Z0-9:._\s-#]/g, "_");

/**
 * Get realm information by realm key
 */
const identifyRealm = async (req) => {
  const { spaceKey } = req.payload;
  if (!spaceKey) {
    throw new Error("Space key is required");
  }
  return resolveRealm(spaceKey);
};

/**
 * SV-SEC-1 helper. Resolve a space's id from its KEY, server-side.
 *
 * The realm console sends both key and id in the payload, and the steward gate can only ever
 * be about the KEY — so trusting the accompanying id would let a steward of one space name
 * another space's id and read its index. The key is what was authorized; the id must be
 * derived from it, not accepted alongside it.
 */
async function resolveRealmIdFromKey(spaceKey) {
  try {
    const res = await asApp().requestConfluence(
      route`/wiki/api/v2/spaces?keys=${spaceKey}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const body = await res.json();
    return body?.results?.[0]?.id ? String(body.results[0].id) : null;
  } catch (e) {
    console.warn(`[REALM] Could not resolve space id for ${spaceKey}:`, e?.message);
    return null;
  }
}

/**
 * Get sealed artifacts for a realm using KVS secondary index.
 */
const enumerateRealmSeals = async (req) => {
  const { spaceKey, cursor = null, limit = 50 } = req.payload;
  const operatorAccountId = req.context.accountId;

  if (!spaceKey) {
    throw new Error("Space key is required");
  }

  // SV-SEC-1. This took spaceId straight off the payload and never looked at the caller at all,
  // so any logged-in user could list every sealed file of any space — filenames, page titles and
  // ids, download links, and the name and accountId of whoever sealed each one, all assembled by
  // asApp() crawls. The realm console only ever shows this tab to a steward (index.jsx:1647), so
  // the server now enforces what the UI already assumed.
  if (!(await isOperatorSteward(operatorAccountId, spaceKey))) {
    return { attachments: [], hasMore: false, nextCursor: null };
  }

  // Derive the id from the key that was just authorized; the payload's own spaceId is ignored.
  const spaceId = await resolveRealmIdFromKey(spaceKey);
  if (!spaceId) {
    return { attachments: [], hasMore: false, nextCursor: null };
  }

  try {
    const prefix = `space-protection-${spaceId}-`;
    console.log(
      `[REALM-SEALS] Querying KVS with prefix: ${prefix}, cursor=${cursor || "null"}, limit=${limit}`,
    );

    let query = kvs
      .query()
      .where("key", WhereConditions.beginsWith(prefix))
      .limit(Math.min(limit, 100));

    if (cursor) {
      query = query.cursor(cursor);
    }

    const { results, nextCursor } = await query.getMany();

    console.log(
      `[REALM-SEALS] Got ${results?.length || 0} results, nextCursor=${nextCursor ? "present" : "null"}`,
    );

    const attachments = (results || []).map(({ key, value }) => {
      const artifactId = key.replace(prefix, "");
      return {
        id: artifactId,
        title: value.attachmentName || "Unknown Attachment",
        fileSize: value.fileSize
          ? `${Math.round(value.fileSize / 1024)}KB`
          : "Unknown",
        creator: value.creatorName || "Unknown",
        creatorAccountId: value.creatorAccountId || null,
        pageTitle: value.pageTitle || "Unknown Page",
        pageId: value.contentId || null,
        lockedBy:
          value.lockedByName || `User ${(value.lockedBy || "").slice(-4)}`,
        lockedByAccountId: value.lockedBy,
        lockedOn: value.timestamp,
        expiresAt: value.expiresAt,
        isExpired: !!(value.expiresAt && new Date(value.expiresAt) < new Date()),
        downloadLink: value.downloadLink || null,
        mediaType: value.mediaType || null,
        isStale: false,
        staleReason: null,
      };
    });

    // Fix 5 (incident 2026-07-22): stale-parity with the inline panel. The console listed a
    // seal as a normal live row while its attachment sat in TRASH — the two surfaces
    // disagreed. Bounded chunked probe (concurrency 10, ≤ one page of rows, runs on the
    // seals-tab fetch — never on bootstrap, it26); probe failure → non-stale (panel parity).
    const CHUNK = 10;
    for (let i = 0; i < attachments.length; i += CHUNK) {
      await Promise.all(
        attachments.slice(i, i + CHUNK).map(async (a) => {
          try {
            const probe = await probeAttachmentStatus(a.id);
            if (probe.status === "trashed") { a.isStale = true; a.staleReason = "trashed"; }
            else if (probe.status === "deleted") { a.isStale = true; a.staleReason = "deleted"; }
          } catch (_) { /* non-stale on probe failure */ }
        }),
      );
    }

    return {
      attachments,
      hasMore: !!nextCursor,
      nextCursor: nextCursor || null,
    };
  } catch (error) {
    console.error("[REALM-SEALS] Error querying realm-seal index:", error);
    return {
      attachments: [],
      hasMore: false,
      nextCursor: null,
    };
  }
};

/**
 * Trigger a background scan to rebuild the realm-seal index.
 */
const launchRealmAudit = async (req) => {
  const { spaceKey } = req.payload;

  if (!spaceKey) {
    throw new Error("Space key is required");
  }

  // SV-SEC-1. Ungated, this made the app crawl any named space with its own site-wide identity
  // and index what it found — and clobber that space's scan-job record while doing it. It is
  // the steward-only "Reconstruct index" button (index.jsx:998); gate it accordingly, and derive
  // the id from the authorized key so the crawl and the job record cannot be aimed elsewhere.
  if (!(await isOperatorSteward(req.context.accountId, spaceKey))) {
    return { status: "denied" };
  }

  const spaceId = await resolveRealmIdFromKey(spaceKey);
  if (!spaceId) {
    return { status: "denied" };
  }

  // Check if a scan is already in progress
  const existingStatus = await kvs.get(`space-scan-status-${spaceId}`);
  if (existingStatus?.status === "processing") {
    console.log(`[REALM-AUDIT] Scan already in progress for realm ${spaceId}`);
    return {
      jobId: existingStatus.jobId,
      status: "already-running",
    };
  }

  const jobId = `scan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Store initial job status
  await kvs.set(`space-scan-status-${spaceId}`, {
    jobId,
    status: "queued",
    createdAt: new Date().toISOString(),
    spaceKey,
    spaceId,
  });

  // Push to the async queue. it57: instantiate LAZILY here (not at module load) so importing this
  // capsule doesn't construct a Queue at load — which broke the dev test-hook bundle (it17) and
  // blocked wiring the realms resolvers (check-user-role / steward-request flow) for testing.
  await new Queue({ key: "realm-audit-queue" }).push({
    body: { jobId, spaceKey, spaceId },
  });

  console.log(`[REALM-AUDIT] Queued scan job ${jobId} for realm ${spaceKey}`);

  return { jobId, status: "queued" };
};

/**
 * Get the status of a background realm scan job.
 */
const checkAuditStatus = async (req) => {
  // The space to authorize against is the scan record's own space (CLAUDE.md: derive the space
  // from the object being read).
  const { spaceId } = req.payload || {};
  if (!spaceId) {
    throw new Error("Space ID is required");
  }
  const status = await kvs.get(`space-scan-status-${spaceId}`);
  if (!status) return { status: "none" };
  const realmKey = await scanRecordSpaceKey(status, spaceId);
  if (!realmKey || !(await isOperatorSteward(req.context.accountId, realmKey))) {
    return { status: "none" };
  }
  return status;
};

/**
 * The space a scan record belongs to: the record's own spaceKey (written with the record, from a
 * key the starting steward was authorized on), else the key Confluence gives for the record's
 * space id. Never a key from the request. null when neither resolves (the caller then denies).
 */
export async function scanRecordSpaceKey(status, spaceId) {
  if (status?.spaceKey) return String(status.spaceKey);
  const id = status?.spaceId ?? spaceId;
  if (!/^\d+$/.test(String(id || ""))) return null;
  try {
    const res = await asApp().requestConfluence(route`/wiki/api/v2/spaces/${String(id)}`, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json())?.key || null;
  } catch (_) { return null; }
}

/**
 * Unseal an artifact as realm steward (steward override)
 */
const stewardUnseal = async (req) => {
  // The payload's spaceKey / spaceId are NOT read: everything here is decided by the seal the
  // attachmentId resolves to (CLAUDE.md — derive the space from the OBJECT).
  const { attachmentId, reason: rawReason } = req.payload;
  const operatorAccountId = req.context.accountId;
  const sealRecord = await kvs.get(`protection-${attachmentId}`);

  if (!sealRecord) {
    return { success: false, reason: "Attachment is not locked" };
  }

  // Part 3.5: this console action releases someone ELSE's seal on both branches below. Unless
  // the caller happens to own it, a typed reason is required and lands in the trail. ONE rule —
  // shared/release-reason.js.
  const isOwner = !!sealRecord.lockedBy && sealRecord.lockedBy === operatorAccountId;
  let forcedReason = null;
  if (!isOwner) {
    const v = validateReleaseReason(rawReason);
    if (!v.ok) return { success: false, reason: v.error };
    forcedReason = v.reason;
  }

  // SV-SEC-1 (confused deputy). The space the SEAL lives in: its own spaceKey, else its page's.
  // The payload's spaceKey used to be the fallback for records that never recorded one, which
  // let a steward of the space they named force-unseal exactly those records anywhere on the
  // site; it is no longer read. null = no steward gate can pass.
  const objectSpaceKey = await objectSpaceKeyOf(sealRecord);

  // Check if auto-unseal is enabled before auto-deleting expired seals
  const globalPolicy = await kvs.get("admin-settings-global");
  const autoUnsealActive = globalPolicy?.autoUnlockEnabled !== false;

  if (sealRecord.expiresAt && new Date(sealRecord.expiresAt) < new Date()) {
    if (autoUnsealActive) {
      // A lapsed seal used to be deletable by ANY logged-in user here — no check at all — and
      // with a partial teardown (no edit-access sweep, no panel, no reminder counters). The bar
      // is now the one the section-seal lapsed release already uses (section-seals/actions.js
      // unsealSection): the owner, a steward of the seal's own space, or — because the seal has
      // lapsed — anyone who may edit the page it lives on.
      let allowed = isOwner;
      if (!allowed && objectSpaceKey) {
        try { allowed = await authorizeSteward(operatorAccountId, objectSpaceKey); } catch (_) { allowed = false; }
      }
      if (!allowed && sealRecord.contentId) {
        try { allowed = await canEditPage(operatorAccountId, sealRecord.contentId); } catch (_) { allowed = false; }
      }
      if (!allowed) {
        return { success: false, reason: "Only the seal owner, a space admin or an editor of its page can release this lapsed seal" };
      }

      // ONE teardown with unseal-artifact and the expiry sweep (sealing/release.js): the seal,
      // its index row, the page property (only if it was the page's last seal), edit access,
      // reminder counters, watchers (notified once, there), the panel and the byline.
      const released = await releaseSeal(attachmentId, sealRecord, { fallbackSpaceKey: objectSpaceKey });
      if (!released.success) return released;
      await dropUnrecordedIndexRow(attachmentId, sealRecord, objectSpaceKey);

      // A1: a lapsed seal cleared by whoever clicked — not the sweep's auto-release; the
      // details say which it was.
      await recordActivity({
        type: "seal.released",
        pageId: sealRecord.contentId || null,
        // Not the payload's spaceKey: an attacker-chosen key would land a row in another space's
        // report (A1 review F2). The object's own space.
        spaceKey: objectSpaceKey || null,
        actor: { accountId: operatorAccountId, name: null },
        target: { kind: "attachment", id: attachmentId, name: sealRecord.attachmentName || null },
        details: {
          forced: !isOwner,
          ...(forcedReason ? { reason: forcedReason } : {}), // Part 3.5: the typed reason (was the literal "lapsed")
          lapsed: true, via: "steward-unseal", ownerAccountId: sealRecord.lockedBy || null,
        },
        version: null,
      });

      return { success: true, reason: "lock expired" };
    }
  }

  // SV-SEC-1 (confused deputy). The gate named the PAYLOAD's spaceKey while the action tears
  // down the seal named by the payload's attachmentId — two different objects. Administering any
  // single space therefore granted force-unseal over every sealed file on the site. Authorize
  // against the space the SEAL is in (objectSpaceKey above — the record's, else its page's).
  const effectiveRealmKey = objectSpaceKey;
  const hasStewardAccess = effectiveRealmKey
    ? await authorizeSteward(operatorAccountId, effectiveRealmKey)
    : false;
  if (!hasStewardAccess) {
    return {
      success: false,
      reason: "Admin override denied - insufficient permissions",
    };
  }

  // The shared teardown (sealing/release.js) — it deletes the seal, re-verifies the delete
  // before anything else, and cleans every key family the inline copy here used to (and the
  // ones it missed: the reminder counters and the panel). Watchers are notified once, there.
  const released = await releaseSeal(attachmentId, sealRecord, { fallbackSpaceKey: effectiveRealmKey });
  if (!released.success) return released;
  await dropUnrecordedIndexRow(attachmentId, sealRecord, effectiveRealmKey);

  // A1: the seal is confirmed gone (releaseSeal's verified read-back); the record follows.
  await recordActivity({
    type: "seal.forced",
    pageId: sealRecord.contentId || null,
    spaceKey: effectiveRealmKey,
    actor: { accountId: operatorAccountId, name: null },
    target: { kind: "attachment", id: attachmentId, name: sealRecord.attachmentName || null },
    details: {
      forced: !isOwner,
      ...(forcedReason ? { reason: forcedReason } : {}), // Part 3.5
      ownerAccountId: sealRecord.lockedBy || null, ownerName: sealRecord.lockedByName || null, via: "realm-console",
    },
    version: null,
  });

  // Notify seal owner that a steward forcefully unsealed their artifact
  if (sealRecord.lockedBy && sealRecord.contentId) {
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
        effectiveRealmKey || null, // P1-4: the seal's own space → quiet mode without a page lookup
        forcedReason,
      );
    } catch (noticeError) {
      console.error(
        "[STEWARD-UNSEAL] Failed to post steward override notice:",
        noticeError,
      );
    }
  }

  return { success: true, reason: "admin override" };
};

/**
 * releaseSeal drops the index row keyed by the record's own spaceId. A record that never carried
 * one can still have a row the console lists from (written by the realm scan under the space's
 * id), so resolve that id from the OBJECT's space — never from the payload's spaceId, which used to
 * let the caller pick which index row this deleted. Best effort.
 */
async function dropUnrecordedIndexRow(attachmentId, sealRecord, objectSpaceKey) {
  if (sealRecord?.spaceId || !objectSpaceKey) return;
  try {
    const sid = await resolveRealmIdFromKey(objectSpaceKey);
    if (sid) await kvs.delete(`space-protection-${sid}-${attachmentId}`);
  } catch (e) {
    console.warn("[STEWARD-UNSEAL] index row cleanup failed:", e?.message || e);
  }
}

/**
 * Check if the current user is a steward for the given space.
 */
export const checkUserRole = async (req) => {
  const accountId = req.context.accountId;
  const spaceKey = req.payload?.spaceKey;
  if (!spaceKey || !accountId) return { role: "user" };
  try {
    // Use isOperatorSteward (not authorizeSteward) so the role check is
    // independent of the allowAdminOverride toggle.  Stewards should always
    // see the steward tabs even when force-unseal is globally disabled.
    const isSteward = await isOperatorSteward(accountId, spaceKey);
    // canForceRelease: the same answer unseal-artifact / unseal-section give (authorizeSteward =
    // steward AND allowAdminOverride), so the ⋯ menu never offers a release the server refuses.
    const site = isSteward ? await kvs.get("admin-settings-global").catch(() => null) : null;
    return { role: isSteward ? "steward" : "user", canForceRelease: isSteward && site?.allowAdminOverride !== false };
  } catch (e) {
    console.warn("[CHECK-USER-ROLE] Error:", e);
    return { role: "user" };
  }
};

/**
 * User requests to become a steward for a space.
 */
// A declined steward request can be made again 48 hours after it was declined. ONE rule for the
// write (request-steward-access) and the read (check-steward-request). PURE.
export const STEWARD_REQUEST_COOLDOWN_MS = 48 * 60 * 60 * 1000;
export function stewardRequestCooldownActive(existing, now = Date.now()) {
  if (existing?.status !== "denied") return false;
  const deniedAt = existing.deniedAt ? new Date(existing.deniedAt).getTime() : NaN;
  if (!Number.isFinite(deniedAt)) return true; // a decline with no date is still a decline
  return now - deniedAt < STEWARD_REQUEST_COOLDOWN_MS;
}

// The space a request names, as Confluence knows it: the space the caller is standing in, or a key
// Confluence answers for. null when there is no such space.
async function resolveRequestedSpaceKey(req) {
  const ctxKey = req.context.extension?.space?.key || req.context.extension?.content?.space?.key || null;
  const asked = req.payload?.spaceKey || ctxKey;
  if (!asked) return null;
  if (ctxKey && asked === ctxKey) return ctxKey;
  try {
    const res = await asApp().requestConfluence(route`/wiki/api/v2/spaces?keys=${asked}&limit=1`, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const found = (await res.json())?.results?.[0]?.key || null;
    return found && found === asked ? found : null;
  } catch (_) { return null; }
}

export const requestStewardAccess = async (req) => {
  const accountId = req.context.accountId;
  const asked = req.payload?.spaceKey || req.context.extension?.space?.key || req.context.extension?.content?.space?.key;
  if (!asked || !accountId) return { success: false, reason: "Missing context" };
  const spaceKey = await resolveRequestedSpaceKey(req);
  if (!spaceKey) return { success: false, reason: "That space could not be found" };

  try {
    const key = `steward-request-${skKey(spaceKey)}-${accountId}`;
    const existing = await kvs.get(key);
    // A declined request stays declined for 48 hours (the screen says so); an open one is not
    // re-filed, so asking again does not move it back to the top of the admins' list.
    if (stewardRequestCooldownActive(existing)) {
      return { success: false, status: "denied", deniedAt: existing.deniedAt || null, reason: "Your request was declined. You can ask again 48 hours after it was declined." };
    }
    if (existing?.status === "pending") return { success: true, alreadyPending: true };

    // Get user display name for the request
    let displayName = "Unknown User";
    try {
      const userRes = await asApp().requestConfluence(
        route`/wiki/rest/api/user?accountId=${accountId}`,
        { headers: { Accept: "application/json" } },
      );
      if (userRes.ok) {
        const userData = await userRes.json();
        displayName = userData.displayName || displayName;
      }
    } catch (e) { /* ignore */ }

    await kvs.set(key, {
      accountId,
      displayName,
      spaceKey,
      requestedAt: new Date().toISOString(),
      status: "pending",
    });
    // P1-3: the space joins the "someone is waiting" index with the record (read back by key).
    await writeSpaceIndex(await kvs.get(key)).catch((e) => console.warn("[REQUEST-STEWARD] space index", e));
    return { success: true };
  } catch (e) {
    console.error("[REQUEST-STEWARD] Error:", e);
    return { success: false, reason: e.message };
  }
};

/**
 * Check if the current user already has a pending or denied steward request for a space.
 */
export const checkStewardRequest = async (req) => {
  const accountId = req.context.accountId;
  const spaceKey = req.payload?.spaceKey;
  if (!spaceKey || !accountId) return { status: "none" };
  try {
    const existing = await kvs.get(`steward-request-${skKey(spaceKey)}-${accountId}`);
    if (!existing) return { status: "none" };
    if (existing.status === "pending") return { status: "pending" };
    if (existing.status === "denied") {
      if (!stewardRequestCooldownActive(existing)) {
        // Cooldown elapsed — clear the denied record so user can retry
        await kvs.delete(`steward-request-${skKey(spaceKey)}-${accountId}`);
        await listPendingStewardRequestsInSpace(spaceKey).catch(() => {}); // heals the space index row
        return { status: "none" };
      }
      return { status: "denied", deniedAt: existing.deniedAt };
    }
    return { status: "none" };
  } catch (e) {
    return { status: "none" };
  }
};

/**
 * List pending steward requests for a space (steward-only).
 */
const listStewardRequests = async (req) => {
  const spaceKey = req.payload?.spaceKey;
  const accountId = req.context.accountId;
  if (!spaceKey) return { requests: [] };

  // Verify caller is steward (role-based, independent of force-unseal toggle)
  const isSteward = await isOperatorSteward(accountId, spaceKey);
  if (!isSteward) return { requests: [], reason: "Not authorized" };

  try {
    const prefix = `steward-request-${skKey(spaceKey)}-`;
    const allRequests = [];
    let query = kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(50);
    const { results } = await query.getMany();
    if (results) {
      for (const { value } of results) {
        if (value?.status === "pending") {
          allRequests.push(value);
        }
      }
    }
    return { requests: allRequests };
  } catch (e) {
    console.error("[LIST-STEWARD-REQUESTS] Error:", e);
    return { requests: [] };
  }
};

/**
 * Approve a pending steward access request (steward-only).
 */
const approveStewardRequest = async (req) => {
  const { requestAccountId, spaceKey } = req.payload;
  const callerAccountId = req.context.accountId;

  if (!requestAccountId || !spaceKey) return { success: false, reason: "Missing params" };

  // Verify caller is steward (role-based, independent of force-unseal toggle)
  const isSteward = await isOperatorSteward(callerAccountId, spaceKey);
  if (!isSteward) return { success: false, reason: "Not authorized" };

  try {
    // Get request data
    const requestKey = `steward-request-${skKey(spaceKey)}-${requestAccountId}`;
    const requestData = await kvs.get(requestKey);
    if (!requestData) return { success: false, reason: "Request not found" };

    // Add user to realm admin users
    const sanitizedKey = spaceKey.replace(/[^a-zA-Z0-9:._\s-#]/g, "_");
    const realmSettings = await kvs.get(`admin-settings-space-${sanitizedKey}`) || {};
    const adminUsers = realmSettings.adminUsers || [];

    if (!adminUsers.some(u => (typeof u === "string" ? u : u.accountId) === requestAccountId)) {
      adminUsers.push({ accountId: requestAccountId, displayName: requestData.displayName || "User" });
      realmSettings.adminUsers = adminUsers;
      await kvs.set(`admin-settings-space-${sanitizedKey}`, realmSettings);
    }

    // Delete the request
    await kvs.delete(requestKey);
    await listPendingStewardRequestsInSpace(spaceKey).catch(() => {}); // heals the space index row

    return { success: true };
  } catch (e) {
    console.error("[APPROVE-STEWARD] Error:", e);
    return { success: false, reason: e.message };
  }
};

/**
 * Deny a pending steward access request (steward-only).
 */
const denyStewardRequest = async (req) => {
  const { requestAccountId, spaceKey } = req.payload;
  const callerAccountId = req.context.accountId;

  if (!requestAccountId || !spaceKey) return { success: false, reason: "Missing params" };

  // Verify caller is steward (role-based, independent of force-unseal toggle)
  const isSteward = await isOperatorSteward(callerAccountId, spaceKey);
  if (!isSteward) return { success: false, reason: "Not authorized" };

  try {
    const requestKey = `steward-request-${skKey(spaceKey)}-${requestAccountId}`;
    const existing = await kvs.get(requestKey);
    if (!existing) return { success: false, reason: "Request not found" };
    // Mark as denied with timestamp so the user can retry after 48 hours
    await kvs.set(requestKey, {
      ...existing,
      status: "denied",
      deniedAt: new Date().toISOString(),
    });
    await listPendingStewardRequestsInSpace(spaceKey).catch(() => {}); // heals the space index row
    return { success: true };
  } catch (e) {
    console.error("[DENY-STEWARD] Error:", e);
    return { success: false, reason: e.message };
  }
};

/**
 * P1-3: the space-admin access requests the CALLER may decide, across every space. The approver
 * of a request is a role, not an account, so there is no per-approver index; instead the space
 * index says which spaces have someone waiting (a handful, normally none), and every one of them
 * is gated on the caller's role in THAT space (SV-SEC-1: the caller must be a space admin of each
 * space it aggregates; the payload names nothing). A site admin passes every gate at once.
 * `eligible` tells the UI whether the caller decides access requests at all: a site admin, a
 * configured admin user, or an admin of at least one space with someone waiting.
 */
export async function listMyStewardRequestsCore(accountId) {
  if (!accountId) return { requests: [], eligible: false };
  const siteAdmin = await isOperatorSiteAdmin(accountId);
  let eligible = siteAdmin;
  if (!eligible) {
    try {
      const globalConfig = await kvs.get("admin-settings-global");
      eligible = (globalConfig?.adminUsers || []).some((u) => (typeof u === "string" ? u : u?.accountId) === accountId);
    } catch (_) { /* stays false */ }
  }
  const spaces = (await listSpacesWithPendingStewardRequests()).slice(0, 25);
  const requests = [];
  const memo = newStewardMemo(); // the caller's groups are read once for all the spaces
  const allowedBySpace = siteAdmin ? spaces.map(() => true) : await mapLimited(spaces, 5, async (spaceKey) => {
    try { return (await isOperatorRealmSteward(accountId, spaceKey, { memo })) || (await isOperatorInStewardCohorts(accountId, spaceKey)); }
    catch (_) { return false; }
  });
  for (const [i, spaceKey] of spaces.entries()) {
    const allowed = allowedBySpace[i] === true;
    if (!allowed) continue;
    eligible = true;
    for (const r of await listPendingStewardRequestsInSpace(spaceKey)) {
      requests.push({ spaceKey: r.spaceKey || spaceKey, accountId: r.accountId, displayName: r.displayName || null, requestedAt: r.requestedAt || null });
    }
  }
  requests.sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")));
  return { requests, eligible };
}

const listMyStewardRequests = async (req) => {
  try { return await listMyStewardRequestsCore(req.context?.accountId); }
  catch (e) { console.error("[LIST-MY-STEWARD-REQUESTS] Error:", e); throw e; } // a failure must reach the UI as one, not as "nothing waiting"
};

export const actions = [
  ["identify-realm", identifyRealm],
  ["enumerate-realm-seals", enumerateRealmSeals],
  ["launch-realm-audit", launchRealmAudit],
  ["check-audit-status", checkAuditStatus],
  ["steward-unseal", stewardUnseal],
  ["check-user-role", checkUserRole],
  ["request-steward-access", requestStewardAccess],
  ["check-steward-request", checkStewardRequest],
  ["list-steward-requests", listStewardRequests],
  ["list-my-steward-requests", listMyStewardRequests],
  ["approve-steward-request", approveStewardRequest],
  ["deny-steward-request", denyStewardRequest],
];
