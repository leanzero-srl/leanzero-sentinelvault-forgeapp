import { findSealedMediaSingle, findAllSealedMediaSingles, capturePresentation, presentationDiffers, applyPresentation } from "../src/server/infra/media-presentation.js";
import { eq, ok, report } from "./_assert.mjs";

const media = (id, attrs = {}) => ({ type: "media", attrs: { type: "file", id, collection: "c", ...attrs } });
const single = (id, wAttrs = {}, mAttrs = {}) => ({ type: "mediaSingle", attrs: wAttrs, content: [media(id, mAttrs)] });
const doc = (...n) => ({ type: "doc", content: n });

// --- findSealedMediaSingle ---
const topLevel = doc({ type: "paragraph", content: [] }, single("f-1", { layout: "center" }));
ok("finds a top-level mediaSingle by fileId", findSealedMediaSingle(topLevel, "f-1") === topLevel.content[1]);
const nested = doc({ type: "expand", content: [{ type: "layoutSection", content: [single("f-2", { layout: "wide" })] }] });
ok("finds a DEEPLY nested mediaSingle (moved into expand/layout)", !!findSealedMediaSingle(nested, "f-2"));
eq("absent fileId → null", findSealedMediaSingle(topLevel, "f-404"), null);
eq("null doc → null", findSealedMediaSingle(null, "f-1"), null);

// --- capturePresentation ---
eq("captures the protect-list, nulls for absent",
  capturePresentation(single("f-1", { layout: "center" }, {})),
  { layout: "center", width: null, widthType: null, mediaWidth: null, mediaHeight: null });
eq("captures explicit widths",
  capturePresentation(single("f-1", { layout: "wide", width: 340, widthType: "pixel" }, { width: 400, height: 400 })),
  { layout: "wide", width: 340, widthType: "pixel", mediaWidth: 400, mediaHeight: 400 });
eq("null node → null baseline", capturePresentation(null), null);

// --- presentationDiffers ---
const base = { layout: "center", width: null, widthType: null, mediaWidth: 820, mediaHeight: 820 };
eq("identical → no diff", presentationDiffers(base, { ...base }), false);
eq("layout change → diff", presentationDiffers(base, { ...base, layout: "wide" }), true);
eq("wrapper width appears → diff", presentationDiffers(base, { ...base, width: 340 }), true);
eq("media width change → diff", presentationDiffers(base, { ...base, mediaWidth: 100 }), true);
eq("no baseline (legacy seal) → NEVER a diff (attr protection skipped)", presentationDiffers(null, base), false);
eq("editor-noise attrs are invisible by construction (only the 5 fields compare)",
  presentationDiffers(base, { ...base, localId: "x", occurrenceKey: "y" }), false);

// --- applyPresentation ---
const tampered = single("f-1", { layout: "wide", width: 340, widthType: "pixel" }, { width: 400, height: 400 });
ok("apply reverts a tamper (returns changed=true)", applyPresentation(tampered, base) === true);
eq("wrapper restored (explicit width REMOVED to match baseline null)", tampered.attrs, { layout: "center" });
eq("media dims restored", tampered.content[0].attrs.width, 820);
const untouched = single("f-1", { layout: "center" }, { width: 820, height: 820 });
eq("apply on an already-conforming node → no change", applyPresentation(untouched, base), false);
ok("apply with no baseline is a no-op", applyPresentation(untouched, null) === false);

// --- findAllSealedMediaSingles (hunt F7: duplicate embeds of one fileId) ---
const dupDoc = doc(
  single("f-9", { layout: "center" }, { width: 820, height: 820 }),
  { type: "paragraph", content: [] },
  { type: "expand", content: [single("f-9", { layout: "wide", width: 340, widthType: "pixel" }, { width: 400, height: 400 })] },
  single("f-other", { layout: "center" }),
);
const allCopies = findAllSealedMediaSingles(dupDoc, "f-9");
eq("finds EVERY copy of the fileId (incl. a nested one)", allCopies.length, 2);
ok("copies are LIVE refs in document order",
  allCopies[0] === dupDoc.content[0] && allCopies[1] === dupDoc.content[2].content[0]);
eq("absent fileId → empty list", findAllSealedMediaSingles(dupDoc, "f-404"), []);
eq("null doc → empty list", findAllSealedMediaSingles(null, "f-9"), []);
eq("other fileIds are not swept up", findAllSealedMediaSingles(dupDoc, "f-other").length, 1);

// multi-copy apply: every differing copy is restorable against one baseline
const dupBase = { layout: "center", width: null, widthType: null, mediaWidth: 820, mediaHeight: 820 };
const diffCopies = allCopies.filter((n) => presentationDiffers(dupBase, capturePresentation(n)));
eq("only the tampered copy differs from the baseline", diffCopies.length, 1);
ok("applying the baseline restores the tampered copy in place", applyPresentation(diffCopies[0], dupBase) === true);
eq("restored copy's wrapper matches the baseline", dupDoc.content[2].content[0].attrs, { layout: "center" });
eq("restored copy's media dims match the baseline", dupDoc.content[2].content[0].content[0].attrs.width, 820);
eq("after restore, NO copy differs",
  findAllSealedMediaSingles(dupDoc, "f-9").filter((n) => presentationDiffers(dupBase, capturePresentation(n))).length, 0);

report("media-presentation");
