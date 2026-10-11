import { isLiveAttachmentSeal, isOtherSealOnPage, advancesSealedVersion } from "../src/server/shared/live-seal.js";
import { eq, report } from "./_assert.mjs";

const past = new Date(Date.now() - 3600_000).toISOString();
const future = new Date(Date.now() + 3600_000).toISOString();
const seal = (id, page, extra = {}) => ({ key: `protection-${id}`, value: { lockedBy: "u1", contentId: page, attachmentId: id, expiresAt: future, ...extra } });

// isLiveAttachmentSeal — the one "is this sealed?" test for write decisions
eq("a seal with an owner is live", isLiveAttachmentSeal({ lockedBy: "u1" }), true);
eq("a trashedOnly tracking record is NOT a seal", isLiveAttachmentSeal({ lockedBy: "u1", trashedOnly: true }), false);
eq("an ownerless record is NOT a seal", isLiveAttachmentSeal({ contentId: "1" }), false);
eq("null is not a seal", isLiveAttachmentSeal(null), false);
eq("a string is not a seal", isLiveAttachmentSeal("x"), false);
eq("an expired seal is still a seal (the sweep releases it; the owner may extend it)", isLiveAttachmentSeal({ lockedBy: "u1", expiresAt: past }), true);
eq("a workflow-held seal (no expiry) is live", isLiveAttachmentSeal({ lockedBy: "u1", expiresAt: null, workflowHeld: { stateId: "a" } }), true);

// isOtherSealOnPage — keeps the page property / panel while another seal targets the page
eq("another seal on the same page counts", isOtherSealOnPage(seal("2", "100"), "100", "1"), true);
eq("page ids compare as strings", isOtherSealOnPage(seal("2", 100), "100", "1"), true);
eq("a seal on a different page does not count", isOtherSealOnPage(seal("2", "200"), "100", "1"), false);
eq("the released record itself (still returned by an eventually-consistent query) does not count", isOtherSealOnPage(seal("1", "100"), "100", "1"), false);
eq("excluded by KEY even when the record lacks attachmentId", isOtherSealOnPage({ key: "protection-1", value: { lockedBy: "u", contentId: "100" } }, "100", "1"), false);
eq("excluded by attachmentId even under another key", isOtherSealOnPage({ key: "protection-x", value: { lockedBy: "u", contentId: "100", attachmentId: "1" } }, "100", "1"), false);
eq("a trashedOnly tracking record does not keep the property", isOtherSealOnPage(seal("2", "100", { trashedOnly: true }), "100", "1"), false);
eq("an ownerless record does not keep the property", isOtherSealOnPage({ key: "protection-2", value: { contentId: "100" } }, "100", "1"), false);
eq("an EXPIRED seal still keeps it (the workflow can hold it again without rewriting the property)", isOtherSealOnPage(seal("2", "100", { expiresAt: past }), "100", "1"), true);
eq("a held seal keeps it", isOtherSealOnPage(seal("2", "100", { expiresAt: null, workflowHeld: {} }), "100", "1"), true);
eq("no exclusion → every live seal on the page counts", isOtherSealOnPage(seal("1", "100"), "100", null), true);
eq("no page id → nothing counts", isOtherSealOnPage(seal("2", "100"), null, "1"), false);
eq("a malformed row is not a seal", isOtherSealOnPage(null, "100", "1"), false);

// advancesSealedVersion — a sanctioned upload re-baselines only forward (unordered, at-least-once trigger)
eq("owner uploads v4 over sealed v3 → advance", advancesSealedVersion(3, 4), true);
eq("a redelivered v3 after v4 was baselined → no regression", advancesSealedVersion(4, 3), false);
eq("the same version redelivered → no-op", advancesSealedVersion(4, 4), false);
eq("legacy seal with no sealedVersion → advance", advancesSealedVersion(null, 2), true);
eq("undefined sealedVersion → advance", advancesSealedVersion(undefined, 2), true);
eq("unknown new version → refresh allowed (number kept by the caller)", advancesSealedVersion(3, null), true);
eq("numeric strings compare as numbers", advancesSealedVersion("9", "10"), true);

report("live-seal");
