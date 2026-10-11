/**
 * What counts as an attachment seal, and whether one still holds a page (PURE, zero imports —
 * unit-tested in test/live-seal.test.mjs).
 *
 * A `protection-{attachmentId}` KVS row is not always a seal. Two shapes are not:
 *   - an S7 `trashedOnly` TRACKING record: written when a file is deleted (the panel's delete, or
 *     the owner trashing their own sealed file) so the trashed item stays discoverable. Its
 *     `lockedBy` is the person who TRASHED it, it has no expiry, and it protects nothing.
 *   - an ownerless record (no `lockedBy`): half-written or legacy; nothing enforces it.
 *
 * Every reader that decides "is this sealed?" has to agree on that, or one surface says sealed
 * while another lets the file be changed. The trigger, the counters and the cards already test
 * `lockedBy && !trashedOnly`; this is the one named copy for the code that decides WRITES
 * (re-seal guard, delete guard, the page's content property, the panel).
 */

/** PURE. Is this `protection-` record a real seal (an owner, and not a trashed-file stub)? */
export function isLiveAttachmentSeal(value) {
  return !!(value && typeof value === "object" && value.lockedBy && !value.trashedOnly);
}

/**
 * PURE. Does this KVS row keep `pageId` "carrying a seal" once `excludeAttachmentId` is gone?
 *
 * The `protection-` page content property is ONE per page and gates the media fast path
 * (triggers.js collectMediaSealsForPage reads only its presence), and the inline panel is one
 * per page too. Releasing one seal must therefore leave both in place while any OTHER seal still
 * targets the page.
 *
 * - The record being released is excluded by its key AND by its attachmentId: kvs.query is
 *   eventually consistent and will happily still return a row we just deleted, and an old record
 *   may not carry `attachmentId` at all.
 * - EXPIRED seals still count. The media pass ignores an expired seal, but a lapsed seal is not
 *   dead: an owner can extend it (extendSeal rewrites the property) and, more to the point, the
 *   workflow can HOLD it (seal-custody.js holdSeal clears `expiresAt`), which makes it enforced
 *   again without anything rewriting the property. Removing the property on "only an expired
 *   seal is left" would therefore leave a held seal unprotected. Keeping it costs one KVS scan
 *   per save on that page until the sweep releases the lapsed seal — the safe direction.
 *
 * @param {{ key?: string, value?: object }} row   a kvs.query() result row
 * @param {string|number} pageId
 * @param {string|number|null} excludeAttachmentId
 */
export function isOtherSealOnPage(row, pageId, excludeAttachmentId) {
  const v = row?.value;
  if (!isLiveAttachmentSeal(v)) return false;
  if (pageId == null || String(v.contentId) !== String(pageId)) return false;
  if (excludeAttachmentId != null && excludeAttachmentId !== "") {
    const ex = String(excludeAttachmentId);
    if (row?.key === `protection-${ex}`) return false;
    if (v.attachmentId != null && String(v.attachmentId) === ex) return false;
  }
  return true;
}
