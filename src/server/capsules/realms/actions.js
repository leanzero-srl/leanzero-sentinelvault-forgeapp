import { asApp, asUser, route } from "@forge/api";
import { kvs, WhereConditions } from "@forge/kvs";
import { resolveRealm } from "./logic.js";
import { Queue } from "@forge/events";

import { authorizeSteward, isOperatorSteward, isOperatorSiteAdmin, isOperatorRealmSteward, isOperatorInStewardCohorts } from "../../shared/steward-checks.js";
import { probeAttachmentStatus } from "../../infra/attachment-status.js";
import { removeSealContentProp, touchSealTimestamp } from "../sealing/logic.js";
import { notifyWatchers, sweepWatchers } from "../bulletins/logic.js";
import { sweepEditAccess, writeSpaceIndex, listSpacesWithPendingStewardRequests, listPendingStewardRequestsInSpace } from "../editreq/logic.js";
import {
  mailStewardOverrideNotice,
  fetchOperatorProfile,
} from "../../infra/notice-composer.js";
import { recordActivity } from "../../infra/activity-log.js";
import { resolvePageSpaceKey } from "../../shared/content-access.js";
import { validateReleaseReason } from "../../shared/release-reason.js";
import { refreshByline } from "../page-details/byline.js"; // 5.0 byline chip

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
  const { spaceId, spaceKey } = req.payload;

  if (!spaceId) {
    throw new Error("Space ID is required");
  }

  // SV-SEC-1 (minor disclosure): the job record names the space and its scan statistics. The
  // caller may only see it for a space they steward. spaceKey is what the console has to hand;
  // when it is absent the record's own spaceKey is the thing to authorize against.
  const status = await kvs.get(`space-scan-status-${spaceId}`);
  const realmKey = spaceKey || status?.spaceKey || null;
  if (!realmKey || !(await isOperatorSteward(req.context.accountId, realmKey))) {
    return { status: "none" };
  }
  return status || { status: "none" };
};

/**
 * Unseal an artifact as realm steward (steward override)
 */
const stewardUnseal = async (req) => {
  const { attachmentId, spaceKey, spaceId, reason: rawReason } = req.payload;
  const operatorAccountId = req.context.accountId;
  const sealRecord = await kvs.get(`protection-${attachmentId}`);

  if (!sealRecord) {
    return { success: false, reason: "Attachment is not locked" };
  }

  // Part 3.5: this console action releases someone ELSE's seal on both branches below (the
  // lapsed one has no steward gate, the live one does). Unless the caller happens to own it, a
  // typed reason is required and lands in the trail. ONE rule — shared/release-reason.js.
  const isOwner = !!sealRecord.lockedBy && sealRecord.lockedBy === operatorAccountId;
  let forcedReason = null;
  if (!isOwner) {
    const v = validateReleaseReason(rawReason);
    if (!v.ok) return { success: false, reason: v.error };
    forcedReason = v.reason;
  }

  // SV-SEC-1: the seal's OWN space id first. This used to prefer the payload's, so a caller
  // could steer which realm-index key the expired-seal branch below deletes.
  let resolvedRealmId = sealRecord.spaceId || spaceId || null;
  if (!resolvedRealmId && spaceKey) {
    try {
      const sanitizedRealmKey = spaceKey.replace(/[^a-zA-Z0-9:._\s-#]/g, "_");
      const realmPolicy = await kvs.get(
        `admin-settings-space-${sanitizedRealmKey}`,
      );
      resolvedRealmId = realmPolicy?.spaceId || null;
    } catch (e) {
      // ignore
    }
  }

  // Check if auto-unseal is enabled before auto-deleting expired seals
  const globalPolicy = await kvs.get("admin-settings-global");
  const autoUnsealActive = globalPolicy?.autoUnlockEnabled !== false;

  if (sealRecord.expiresAt && new Date(sealRecord.expiresAt) < new Date()) {
    if (autoUnsealActive) {
      await kvs.delete(`protection-${attachmentId}`);
      await touchSealTimestamp();
      if (sealRecord.contentId) {
        await removeSealContentProp(sealRecord.contentId);
      }

      // Remove realm-seal index key
      if (resolvedRealmId) {
        try {
          await kvs.delete(`space-protection-${resolvedRealmId}-${attachmentId}`);
        } catch (indexError) {
          console.warn(
            `[STEWARD-UNSEAL] Failed to delete realm-seal index:`,
            indexError,
          );
        }
      }

      // A1: a lapsed seal cleared by whoever clicked — not a force (no steward gate ran on this
      // branch) and not the sweep's auto-release; the details say which it was.
      await recordActivity({
        type: "seal.released",
        pageId: sealRecord.contentId || null,
        // Not the payload's spaceKey: this branch runs with no steward gate, so an attacker-chosen
        // key would land a row in another space's report (A1 review F2). The object's own space.
        spaceKey: sealRecord.spaceKey || (sealRecord.contentId ? await resolvePageSpaceKey(sealRecord.contentId) : null) || null,
        actor: { accountId: operatorAccountId, name: null },
        target: { kind: "attachment", id: attachmentId, name: sealRecord.attachmentName || null },
        details: {
          forced: !isOwner,
          ...(forcedReason ? { reason: forcedReason } : {}), // Part 3.5: the typed reason (was the literal "lapsed")
          lapsed: true, via: "steward-unseal", ownerAccountId: sealRecord.lockedBy || null,
        },
        version: null,
      });

      await notifyWatchers(attachmentId, {
        attachmentName: sealRecord.attachmentName,
        contentId: sealRecord.contentId,
      });

      if (sealRecord.contentId) await refreshByline(sealRecord.contentId).catch((e) => console.warn("[BYLINE] steward-unseal (expired) refresh failed:", e?.message || e));
      return { success: true, reason: "lock expired" };
    }
  }

  // SV-SEC-1 (confused deputy). The gate named the PAYLOAD's spaceKey while the action tears
  // down the seal named by the payload's attachmentId — two different objects. Administering any
  // single space therefore granted force-unseal over every sealed file on the site. Authorize
  // against the space the SEAL is in; the payload's key is only a fallback for records that
  // never recorded one.
  const effectiveRealmKey = sealRecord.spaceKey || spaceKey || null;
  const hasStewardAccess = effectiveRealmKey
    ? await authorizeSteward(operatorAccountId, effectiveRealmKey)
    : false;
  if (!hasStewardAccess) {
    return {
      success: false,
      reason: "Admin override denied - insufficient permissions",
    };
  }

  await kvs.delete(`protection-${attachmentId}`);

  // Re-verify the seal was actually removed before proceeding
  const verifyDeleted = await kvs.get(`protection-${attachmentId}`);
  if (verifyDeleted) {
    return { success: false, reason: "Seal removal could not be confirmed" };
  }

  await touchSealTimestamp();

  // A1: the seal is confirmed gone (verified read-back above); the rest of the teardown is
  // best-effort and must not stand between the fact and its record.
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

  if (sealRecord.contentId) {
    await removeSealContentProp(sealRecord.contentId);
  }

  // Remove realm-seal index key
  if (resolvedRealmId) {
    try {
      await kvs.delete(`space-protection-${resolvedRealmId}-${attachmentId}`);
      console.log(
        `[STEWARD-UNSEAL] Removed realm-seal index key for artifact ${attachmentId} in realm ${resolvedRealmId}`,
      );
    } catch (indexError) {
      console.warn(
        `[STEWARD-UNSEAL] Failed to delete realm-seal index:`,
        indexError,
      );
    }
  }

  // Clear any Edit Requests / grants tied to this seal
  await sweepEditAccess(attachmentId);

  // Notify watchers, then sweep whatever a failed notice left behind (never before —
  // the sweep used to run first under a prefix nothing wrote, which is the only reason
  // watchers were ever notified at all).
  await notifyWatchers(attachmentId, {
    attachmentName: sealRecord.attachmentName,
    contentId: sealRecord.contentId,
  });
  await sweepWatchers(attachmentId);

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
        sealRecord.spaceKey || null, // P1-4: the seal's own space → quiet mode without a page lookup
      );
    } catch (noticeError) {
      console.error(
        "[STEWARD-UNSEAL] Failed to post steward override notice:",
        noticeError,
      );
    }
  }

  if (sealRecord.contentId) await refreshByline(sealRecord.contentId).catch((e) => console.warn("[BYLINE] steward-unseal refresh failed:", e?.message || e));
  return { success: true, reason: "admin override" };
};

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
    return { role: isSteward ? "steward" : "user" };
  } catch (e) {
    console.warn("[CHECK-USER-ROLE] Error:", e);
    return { role: "user" };
  }
};

/**
 * User requests to become a steward for a space.
 */
export const requestStewardAccess = async (req) => {
  const accountId = req.context.accountId;
  const spaceKey = req.payload?.spaceKey;
  if (!spaceKey || !accountId) return { success: false, reason: "Missing context" };

  try {
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

    await kvs.set(`steward-request-${skKey(spaceKey)}-${accountId}`, {
      accountId,
      displayName,
      spaceKey,
      requestedAt: new Date().toISOString(),
      status: "pending",
    });
    // P1-3: the space joins the "someone is waiting" index with the record (read back by key).
    await writeSpaceIndex(await kvs.get(`steward-request-${skKey(spaceKey)}-${accountId}`)).catch((e) => console.warn("[REQUEST-STEWARD] space index", e));
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
      const deniedAt = existing.deniedAt ? new Date(existing.deniedAt) : null;
      const cooldownMs = 48 * 60 * 60 * 1000; // 48 hours
      if (deniedAt && (Date.now() - deniedAt.getTime()) >= cooldownMs) {
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
  for (const spaceKey of spaces) {
    let allowed = siteAdmin;
    if (!allowed) {
      try { allowed = (await isOperatorRealmSteward(accountId, spaceKey)) || (await isOperatorInStewardCohorts(accountId, spaceKey)); }
      catch (_) { allowed = false; }
    }
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
