import { kvs, WhereConditions } from "@forge/kvs";

import { removeSealContentProp, touchSealTimestamp } from "./logic.js";
import { notifyWatchers, sweepWatchers } from "../bulletins/logic.js";
import { sweepEditAccess } from "../editreq/logic.js";
import { triggerPanelEmbed, removePanelNode } from "../../infra/doc-surgery.js";
import { recordActivity } from "../../infra/activity-log.js";

/**
 * Tear a seal down completely.
 *
 * This used to live inline in unsealArtifact, which made it unavailable to anything
 * that is not a resolver — and the expiry sweep needs exactly this teardown to hand a
 * lapsed file back (F5). A second copy would be the usual way to end up with two
 * teardowns that disagree about which of the six key families they clean, so there is
 * one and both callers use it.
 *
 * What a seal actually consists of, all of which has to go:
 *   protection-{id}                          the seal itself
 *   space-protection-{spaceId}-{id}          the space index row the consoles list from
 *   the `protection-` page content property   the CQL/fast-path marker
 *   notify-request-{id}-*                     watchers waiting for the release
 *   edit-request-* / edit-grant-*             the seal's edit-access sidecars
 *   the inline panel node                     removed when the page has no seals left
 *
 * Best-effort by design: a failure to notify or to tidy the panel must not leave the
 * seal record half-deleted. The one hard failure is the seal record itself.
 *
 * `autoRelease` (A1): set by the expiry sweep ONLY — `{ reason, noticeCount, noticeLimit }` —
 * and it makes this teardown record a `seal.auto-released` activity entry with the app as the
 * actor. A resolver-driven release records its own entry (owner release vs. steward force are
 * different events, and only the resolver knows which), so it leaves this unset.
 *
 * @returns {{ success: boolean, reason?: string }}
 */
export async function releaseSeal(attachmentId, sealRecord, { fallbackSpaceKey = null, notify = true, autoRelease = null } = {}) {
  if (!attachmentId || !sealRecord) return { success: false, reason: "Nothing to release" };

  await kvs.delete(`protection-${attachmentId}`);

  // Re-verify the seal was actually removed before proceeding.
  const verifyDeleted = await kvs.get(`protection-${attachmentId}`);
  if (verifyDeleted) {
    return { success: false, reason: "Seal removal could not be confirmed" };
  }

  await touchSealTimestamp();

  if (autoRelease) {
    // The seal is confirmed gone (read-back above) — the release is a fact from here on.
    await recordActivity({
      type: "seal.auto-released",
      pageId: sealRecord.contentId || null,
      spaceKey: sealRecord.spaceKey || fallbackSpaceKey || null,
      actor: null,
      target: { kind: "attachment", id: attachmentId, name: sealRecord.attachmentName || null },
      details: {
        reason: autoRelease.reason || "lapse-policy",
        noticeCount: autoRelease.noticeCount ?? null,
        noticeLimit: autoRelease.noticeLimit ?? null,
        expiredAt: sealRecord.expiresAt || null,
        ownerAccountId: sealRecord.lockedBy || null,
        ownerName: sealRecord.lockedByName || null,
      },
      version: null,
    });
  }

  if (sealRecord.contentId) {
    await removeSealContentProp(sealRecord.contentId).catch((e) =>
      console.warn("[RELEASE] content property removal failed:", e));
  }

  if (sealRecord.spaceId) {
    await kvs.delete(`space-protection-${sealRecord.spaceId}-${attachmentId}`).catch((indexError) =>
      console.warn("[RELEASE] Failed to delete space-seal index:", indexError));
  }

  // Clear any Edit Requests / grants tied to this seal.
  await sweepEditAccess(attachmentId).catch((e) =>
    console.warn("[RELEASE] edit-access sweep failed:", e));

  // The expiry sweep's dedup/reminder bookkeeping is scoped to the seal that produced
  // it. Leaving it behind would silence the FIRST lapse notice of the next seal on the
  // same file, which is the bug the TTLs were added to avoid in the first place.
  await kvs.delete(`expiry-notified-${attachmentId}`).catch(() => {});
  await kvs.delete(`fifty-percent-reminder-sent-${attachmentId}`).catch(() => {});
  await kvs.delete(`reminder-sent-${attachmentId}`).catch(() => {});

  if (notify) {
    await notifyWatchers(attachmentId, {
      attachmentName: sealRecord.attachmentName,
      contentId: sealRecord.contentId,
    }).catch((e) => console.warn("[RELEASE] watcher notify failed:", e));
  }
  // Only after the notices: what is left are watches whose notice failed, and they must
  // not outlive the seal they were about (see sweepWatchers).
  await sweepWatchers(attachmentId);

  // Manage inline panel: keep it if other seals remain on the page, remove it if not.
  if (sealRecord.contentId) {
    try {
      const spaceKeyForPanel = sealRecord.spaceKey || fallbackSpaceKey;
      const { results: remainingSeals } = await kvs
        .query()
        .where("key", WhereConditions.beginsWith("protection-"))
        .limit(100)
        .getMany();
      // Mirrors pageHasOtherLiveSeals in triggers.js: exclude the record we just deleted
      // (kvs.query is eventually consistent and will happily still return it), skip S7
      // trashedOnly tracking records, and require a real owner.
      const pageHasSeals = (remainingSeals || []).some(
        ({ value }) => value
          && value.contentId === sealRecord.contentId
          && value.lockedBy
          && !value.trashedOnly
          && value.attachmentId !== attachmentId,
      );

      if (pageHasSeals && spaceKeyForPanel) {
        await triggerPanelEmbed(sealRecord.contentId, spaceKeyForPanel);
      } else if (!pageHasSeals) {
        await removePanelNode(sealRecord.contentId);
      }
    } catch (panelErr) {
      console.warn("[RELEASE] Panel management failed:", panelErr);
    }
  }

  return { success: true };
}
