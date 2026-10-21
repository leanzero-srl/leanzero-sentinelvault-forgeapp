import { kvs, WhereConditions } from "@forge/kvs";
import { route } from "@forge/api";
import { appConfluence } from "../../shared/confluence-call.js";
import { BASELINE_HOLD_SPAN, sanitizeHoldDuration } from "../../shared/baseline.js";
import { sealPropertyValue } from "./seal-property.js";
// 2026-10-11: computeSealStatus / breakSeal (a lazy "delete the expired seal on read" and an
// owner-or-steward release with partial teardowns) lived here with zero callers; deleted. Releases
// go through release.js releaseSeal; lapsed seals through the expiry sweep (F5).
import { isOtherSealOnPage } from "../../shared/live-seal.js";
import { errText } from "../../shared/action-log.js";

/**
 * Resolve the effective seal hold period, in seconds, for a space.
 *
 * space policy (autoUnlockTimeoutHours) → global policy (defaultLockDuration) → baseline.
 *
 * This chain existed in three places — inline in sealArtifact, again as resolveHoldPeriod
 * in the section-seals capsule, and it was about to be written a fourth time for the
 * extend-seal action. Three copies of one rule is how they end up disagreeing about which
 * level wins, so there is one and the callers share it.
 *
 * The result is clamped: store-policy persists autoUnlockTimeoutHours / defaultLockDuration
 * RAW, so a negative or absurd stored value would otherwise flow into an expiresAt in the
 * past (a record that reads "sealed" while being unprotected) or an overflowing Date.
 */
export async function resolveSealHoldPeriod(spaceKey, override) {
  const explicit = sanitizeHoldDuration(override, 0);
  if (explicit) return explicit;

  if (spaceKey) {
    const sanitizedKey = String(spaceKey).replace(/[^a-zA-Z0-9:._\s-#]/g, "_");
    const spacePolicy = await kvs.get(`admin-settings-space-${sanitizedKey}`);
    if (spacePolicy?.autoUnlockTimeoutHours) {
      return sanitizeHoldDuration(spacePolicy.autoUnlockTimeoutHours * 3600, BASELINE_HOLD_SPAN);
    }
  }
  const globalPolicy = await kvs.get("admin-settings-global");
  if (globalPolicy?.defaultLockDuration) {
    return sanitizeHoldDuration(globalPolicy.defaultLockDuration, BASELINE_HOLD_SPAN);
  }
  return BASELINE_HOLD_SPAN;
}

/**
 * Update the seals-last-modified timestamp so the sealIndexCron
 * can skip full scans when nothing has changed.
 */
export async function touchSealTimestamp() {
  try {
    await kvs.set("protections-last-modified", Date.now());
  } catch (err) {
    console.warn("[touchSealTimestamp] Failed to update timestamp:", errText(err));
  }
}

/**
 * Get seal status for an artifact
 *
 * @param {string} artifactId - The artifact ID
 * @returns {Promise<Object|null>} Seal status object or null if not sealed
 */
export async function readSealRecord(artifactId) {
  return await kvs.get(`protection-${artifactId}`);
}

/**
 * Store seal data as a content property on the parent page for CQL searchability
 * The property key is "protection-" which matches the manifest's contentPropertyIndex
 *
 * @param {string} contentId - The parent page/content ID
 * @param {Object} sealData - The seal data to store
 * @returns {Promise<void>}
 */
export async function writeSealContentProp(contentId, sealData) {
  const propertyKey = "protection-";
  // Anyone who can read the page can read this property: account id + timestamps only, never
  // the email, the display name or the note (seal-property.js).
  const value = sealPropertyValue(sealData);
  try {
    // Check if property already exists by listing with key filter
    const getResponse = await appConfluence(
      route`/wiki/api/v2/pages/${contentId}/properties?key=${propertyKey}`,
      { method: "GET" },
    );

    if (getResponse.ok) {
      const getBody = await getResponse.json();
      const existing = getBody.results?.[0];

      if (existing) {
        // Property exists — update using its numeric ID
        const propertyId = existing.id;
        const nextVersion = (existing.version?.number || 1) + 1;
        const putResponse = await appConfluence(
          route`/wiki/api/v2/pages/${contentId}/properties/${propertyId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              key: propertyKey,
              value,
              version: { number: nextVersion },
            }),
          },
        );
        if (!putResponse.ok) {
          console.error(
            `[SEAL-PROPERTY] Failed to update seal property: ${putResponse.status}`,
          );
        }
      } else {
        // Property doesn't exist — create
        const postResponse = await appConfluence(
          route`/wiki/api/v2/pages/${contentId}/properties`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              key: propertyKey,
              value,
            }),
          },
        );
        if (!postResponse.ok) {
          console.error(
            `[SEAL-PROPERTY] Failed to create seal property: ${postResponse.status}`,
          );
        }
      }
    } else {
      console.error(
        `[SEAL-PROPERTY] Failed to check existing property: ${getResponse.status}`,
      );
    }
  } catch (error) {
    console.error(`[SEAL-PROPERTY] Error storing seal property:`, errText(error));
  }
}

/**
 * Delete seal data from content properties on the parent page
 *
 * @param {string} contentId - The parent page/content ID
 * @returns {Promise<void>}
 */
export async function removeSealContentProp(contentId) {
  const propertyKey = "protection-";
  try {
    // Look up the property by key to get its numeric ID
    const getResponse = await appConfluence(
      route`/wiki/api/v2/pages/${contentId}/properties?key=${propertyKey}`,
      { method: "GET" },
    );

    if (!getResponse.ok) {
      // 404 means page not found — property is effectively gone
      if (getResponse.status === 404) return;
      console.error(
        `[SEAL-PROPERTY] Failed to look up seal property for deletion: ${getResponse.status}`,
      );
      return;
    }

    const getBody = await getResponse.json();
    const existing = getBody.results?.[0];
    if (!existing) return; // Property doesn't exist, nothing to delete

    const propertyId = existing.id;
    const response = await appConfluence(
      route`/wiki/api/v2/pages/${contentId}/properties/${propertyId}`,
      {
        method: "DELETE",
      },
    );

    if (!response.ok && response.status !== 404) {
      console.error(
        `[SEAL-PROPERTY] Failed to delete seal property: ${response.status}`,
      );
    }
  } catch (error) {
    console.error(`[SEAL-PROPERTY] Error deleting seal property:`, errText(error));
  }
}

/**
 * Does any OTHER attachment seal still target this page?
 *
 * The `protection-` content property is ONE per page (a mirror for CQL and the UI; the pipeline
 * finds a page's seals by its KVS marker, shared/guarded-page.js), and the inline panel is one per
 * page as well. One copy of this question, cursor-paginated (a single limit(100) misses the page's
 * seals once the site holds more than 100), and every remover asks it.
 * What counts is the pure rule in shared/live-seal.js (isOtherSealOnPage).
 *
 * Fails toward TRUE (keep the property / panel): a scan that throws, or one that hits the
 * iteration cap without finishing, has not proven the page is empty.
 */
export async function pageHasOtherLiveSeals(pageId, excludeAttachmentId) {
  if (!pageId) return false;
  try {
    let query = kvs.query().where("key", WhereConditions.beginsWith("protection-")).limit(100);
    for (let iters = 0; iters < 50; iters++) {
      const { results, nextCursor } = await query.getMany();
      if ((results || []).some((row) => isOtherSealOnPage(row, pageId, excludeAttachmentId))) return true;
      if (!nextCursor) return false;
      query = kvs.query().where("key", WhereConditions.beginsWith("protection-")).limit(100).cursor(nextCursor);
    }
  } catch (e) {
    console.warn(`[SEAL-PROPERTY] other-seal scan for page ${pageId} failed — keeping the property:`, errText(e));
  }
  return true;
}

/**
 * Remove the page's `protection-` content property ONLY when the seal on `excludeAttachmentId`
 * was the page's last one. The single door every seal remover goes through (releaseSeal,
 * purgeAllSealState, the permanent-delete handler). Best effort; never throws.
 * `hasOthers`: the caller's own answer from pageHasOtherLiveSeals for the same page and
 * exclusion (releaseSeal needs it for the panel too) — saves a second full scan.
 * @returns {Promise<boolean>} true when the property was removed
 */
export async function releaseSealContentPropIfLast(pageId, excludeAttachmentId, { hasOthers } = {}) {
  if (!pageId) return false;
  try {
    const others = typeof hasOthers === "boolean" ? hasOthers : await pageHasOtherLiveSeals(pageId, excludeAttachmentId);
    if (others) {
      console.warn(`[SEAL-PROPERTY] keeping the protection- property on ${pageId} — other seals still target this page`);
      return false;
    }
    await removeSealContentProp(pageId);
    return true;
  } catch (e) {
    console.warn(`[SEAL-PROPERTY] conditional removal on ${pageId} failed:`, errText(e));
    return false;
  }
}

/**
 * Whole-page attachment counts (tester report 2026-09-19: "AVAILABLE 11" was the number of cards
 * on screen — the real number was 13, one Show more away). The listers page 10 at a time and
 * enrich each card (labels, watches, previews), so the counts come from a separate cheap walk:
 * ids only, at most 4 × 250, one KVS get per id. Same seal test the cards use (a record with an
 * owner; trashed-only tracking records are not seals).
 */
export async function countPageAttachments(pageId, operatorAccountId, requestFn) {
  const counts = { total: 0, sealed: 0, sealedByMe: 0, available: 0, complete: true };
  let cursor = null;
  for (let page = 0; page < 4; page++) {
    const url = cursor
      ? route`/wiki/api/v2/pages/${pageId}/attachments?limit=250&cursor=${cursor}`
      : route`/wiki/api/v2/pages/${pageId}/attachments?limit=250`;
    const res = await requestFn(url);
    if (!res.ok) return { ...counts, complete: false };
    const data = await res.json();
    const ids = (data.results || []).map((a) => a.id).filter(Boolean);
    const seals = await Promise.all(ids.map((id) => kvs.get(`protection-${id}`).catch(() => null)));
    for (const seal of seals) {
      counts.total++;
      if (seal?.lockedBy && !seal.trashedOnly) { counts.sealed++; if (seal.lockedBy === operatorAccountId) counts.sealedByMe++; }
      else counts.available++;
    }
    const next = data._links?.next ? new URL(data._links.next, "https://x").searchParams.get("cursor") : null;
    if (!next) return counts;
    cursor = next;
  }
  return { ...counts, complete: false };
}
