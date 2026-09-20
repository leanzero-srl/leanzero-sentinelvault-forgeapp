/**
 * Tear a SECTION seal down completely — the mirror of sealing/release.js releaseSeal.
 *
 * This used to live inline in unsealSection, which made it unavailable to anything that is not a
 * resolver — and the expiry sweep needs exactly this teardown to hand a lapsed section back
 * (SEC-7 (d), 2026-09-20: the sweep had never handled section seals; a section whose owner left
 * stayed sealed forever). One teardown, two callers, so they can never disagree about which
 * key families a section seal consists of:
 *
 *   section-protection-{id}                        the seal itself
 *   section-snapshot-{id}                          the frozen body the restore pass puts back
 *   space-section-protection-{spaceId}-{id}        the space index row the consoles list from
 *   section-edit-request-* / section-edit-grant-*  the seal's edit-access sidecars
 *   the `section-protection-` page content property (the macro badge / fast path)
 *   expiry-notified-{id} / fifty-percent-reminder-sent-{id}   the sweep's own bookkeeping
 *   the sealed-section WRAPPER on the page          unwrapped (body spliced back in place)
 *
 * `autoRelease` (set by the expiry sweep ONLY — `{ reason, noticeCount, noticeLimit }`) makes
 * this teardown record a `section.auto-released` activity entry with the app as the actor. A
 * resolver-driven release records its own entry (owner release vs. steward force are different
 * events, and only the resolver knows which), so it leaves this unset.
 *
 * @returns {{ success: boolean, unwrapped: boolean, reason?: string }}
 */
import { kvs } from "@forge/kvs";
import { readDocBody, writeDocBody, isSealedSectionKey, getSectionId } from "../../infra/doc-surgery.js";
import { refreshSectionContentProp } from "./logic.js";
import { sweepSectionEditAccess } from "../editreq/logic.js";
import { recordActivity } from "../../infra/activity-log.js";
import { touchSealTimestamp } from "../sealing/logic.js";
import { refreshByline } from "../page-details/byline.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Unwrap the wrapper carrying `sectionId` on `pageId` (body spliced back). True when the wrapper is gone. */
export async function unwrapSectionOnPage(pageId, sectionId, message = "(Sentinel Vault unsealed a section)") {
  if (!pageId) return false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { pageData, adfDoc } = await readDocBody(pageId);
    const content = adfDoc.content || [];
    const idx = content.findIndex(
      (b) => b.type === "bodiedExtension" && isSealedSectionKey(b.attrs?.extensionKey) && getSectionId(b) === sectionId,
    );
    if (idx === -1) return true; // wrapper already gone — just clean KVS
    const body = Array.isArray(content[idx].content) ? content[idx].content : [];
    content.splice(idx, 1, ...body);
    adfDoc.content = content;
    const putRes = await writeDocBody(pageId, pageData, adfDoc, message);
    if (putRes.ok) return true;
    if (putRes.status === 409) { await sleep(Math.pow(2, attempt) * 500); continue; }
    break;
  }
  return false;
}

export async function releaseSectionSeal(sectionId, record, { autoRelease = null } = {}) {
  if (!sectionId || !record) return { success: false, unwrapped: false, reason: "Nothing to release" };
  const pageId = record.pageId || null;
  let unwrapped = false;
  try { unwrapped = await unwrapSectionOnPage(pageId, sectionId); }
  catch (e) { console.warn(`[SECTION-RELEASE] unwrap of ${sectionId} failed:`, e?.message || e); }

  await kvs.delete(`section-protection-${sectionId}`);
  await kvs.delete(`section-snapshot-${sectionId}`).catch(() => {});
  if (autoRelease) {
    // The seal record is gone — the release is a fact from here on.
    await recordActivity({
      type: "section.auto-released",
      pageId,
      spaceKey: record.spaceKey || null,
      actor: null,
      target: { kind: "section", id: sectionId, name: record.sectionTitle || "Sealed section" },
      details: {
        reason: autoRelease.reason || "lapse-policy",
        noticeCount: autoRelease.noticeCount ?? null,
        noticeLimit: autoRelease.noticeLimit ?? null,
        expiredAt: record.expiresAt || null,
        ownerAccountId: record.lockedBy || null,
        ownerName: record.lockedByName || null,
        unwrapped,
      },
      version: null,
    }).catch((e) => console.warn("[SECTION-RELEASE] activity:", e?.message || e));
  }
  if (record.spaceId) await kvs.delete(`space-section-protection-${record.spaceId}-${sectionId}`).catch(() => {});
  await sweepSectionEditAccess(sectionId).catch(() => {});
  // The sweep's dedup/reminder bookkeeping is scoped to the seal that produced it — leaving it
  // behind would silence the FIRST lapse notice of the next seal on the same section id.
  await kvs.delete(`expiry-notified-${sectionId}`).catch(() => {});
  await kvs.delete(`fifty-percent-reminder-sent-${sectionId}`).catch(() => {});
  if (pageId) await refreshSectionContentProp(pageId).catch(() => {});
  await touchSealTimestamp().catch(() => {});
  if (pageId) await refreshByline(pageId).catch((e) => console.warn("[BYLINE] section release refresh failed:", e?.message || e));
  return { success: true, unwrapped };
}
