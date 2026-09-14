import {
  canonicalizeAdf,
  hashAdf,
  buildSealedSectionNode,
  nonEmptySectionBody,
  isSealedSectionKey,
  getSectionId,
  locateBodiedSectionNodes,
  replaceSectionBody,
  spliceSectionWrapper,
  extractPlainText,
  collectHeadings,
  countNodes,
  extractMediaSingleNodes,
  spliceMediaNodes,
  collectMediaFileIds,
  adoptOrphanWrappers,
  summarizeAdfDiff,
  ADF_DIFF_SAMPLE_MAX,
} from "../src/server/infra/doc-surgery.js";
import { eq, ok, report } from "./_assert.mjs";

const EXT_KEY = "app123/env456/static/sentinel-vault-sealed-section";

const heading = (level, text) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const para = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });

// canonicalizeAdf strips localId and is key-order independent
const a = { type: "paragraph", attrs: { localId: "x1", color: "red" }, content: [{ type: "text", text: "hi" }] };
const b = { content: [{ text: "hi", type: "text" }], attrs: { color: "red", localId: "DIFFERENT" }, type: "paragraph" };
eq("canonical equal despite localId + key order", JSON.stringify(canonicalizeAdf(a)), JSON.stringify(canonicalizeAdf(b)));
eq("hash equal for equivalent nodes", hashAdf(a), hashAdf(b));

const c = { type: "paragraph", attrs: { localId: "x1" }, content: [{ type: "text", text: "changed" }] };
ok("hash differs when text changes", hashAdf(a) !== hashAdf(c));

// Sealed section node round-trip
const wrapper = buildSealedSectionNode({ sectionId: "sec-1", extensionKey: EXT_KEY, bodyContent: [heading(2, "Locked"), para("body")] });
eq("wrapper is bodiedExtension", wrapper.type, "bodiedExtension");
ok("isSealedSectionKey true", isSealedSectionKey(wrapper.attrs.extensionKey));
eq("getSectionId reads guestParams", getSectionId(wrapper), "sec-1");

// locate in a doc
const docWith = { type: "doc", content: [para("intro"), wrapper, para("after")] };
const located = locateBodiedSectionNodes(docWith);
eq("located one wrapper", located.length, 1);
eq("located sectionId", located[0].sectionId, "sec-1");
eq("located originalIndex", located[0].originalIndex, 1);

// replaceSectionBody
const docCopy = JSON.parse(JSON.stringify(docWith));
const replaced = replaceSectionBody(docCopy, "sec-1", [para("restored")]);
ok("replaceSectionBody found", replaced === true);
eq("body replaced", docCopy.content[1].content[0].content[0].text, "restored");
eq("replace unknown id returns false", replaceSectionBody(docCopy, "nope", []), false);

// spliceSectionWrapper re-inserts at index
const docNoWrap = { type: "doc", content: [para("intro"), para("after")] };
spliceSectionWrapper(docNoWrap, [{ node: wrapper, originalIndex: 1 }]);
eq("spliced length", docNoWrap.content.length, 3);
ok("spliced wrapper present", isSealedSectionKey(docNoWrap.content[1].attrs?.extensionKey));

// extractPlainText
const pt = extractPlainText({ type: "doc", content: [heading(1, "Title"), para("Hello world")] });
ok("extractPlainText includes text", pt.text.includes("Title") && pt.text.includes("Hello world"));
ok("charCount positive", pt.charCount > 0);

// collectHeadings
const hs = collectHeadings({ type: "doc", content: [heading(1, "A"), heading(2, "B")] });
eq("collectHeadings count", hs.length, 2);
eq("collectHeadings level/text", hs[1], { level: 2, text: "B" });

// countNodes
eq("countNodes tables", countNodes({ type: "doc", content: [{ type: "table" }, para("x"), { type: "table" }] }, (n) => n.type === "table"), 2);

// --- audit A4: sealed-media restore must NOT duplicate a containing block ---
const mediaNode = (id) => ({ type: "media", attrs: { type: "file", id } });
const mediaSingle = (id) => ({ type: "mediaSingle", attrs: { layout: "center" }, content: [mediaNode(id)] });
const cell = (content) => ({ type: "tableCell", content });
const tableWithMedia = (id) => ({
  type: "table",
  content: [{ type: "tableRow", content: [cell([mediaSingle(id)]), cell([para("keep-this-cell")])] }],
});

// (1) bare top-level mediaSingle → extracted node is the mediaSingle itself
{
  const doc = { type: "doc", content: [para("intro"), mediaSingle("fileA")] };
  const got = extractMediaSingleNodes(doc, new Set(["fileA"]));
  eq("A4 bare: one match", got.length, 1);
  eq("A4 bare: node is a mediaSingle", got[0].node.type, "mediaSingle");
  ok("A4 bare: media id preserved", collectMediaFileIds(got[0].node).has("fileA"));
}

// (2) media nested in a TABLE → extract the mediaSingle, NOT the whole table
{
  const doc = { type: "doc", content: [tableWithMedia("fileB")] };
  const got = extractMediaSingleNodes(doc, new Set(["fileB"]));
  eq("A4 nested: one match", got.length, 1);
  eq("A4 nested: extracts a mediaSingle (not the table)", got[0].node.type, "mediaSingle");
  eq("A4 nested: result contains NO table nodes", countNodes(got[0].node, (n) => n.type === "table"), 0);
  eq("A4 nested: does NOT drag the other cell's text", extractPlainText(got[0].node).text.includes("keep-this-cell"), false);
}

// (3) splicing the restore into the current doc must NOT duplicate the surviving table
{
  const older = { type: "doc", content: [tableWithMedia("fileC")] };
  const restore = extractMediaSingleNodes(older, new Set(["fileC"]));
  // current doc: the user kept the (edited) table but removed the sealed image from it
  const current = { type: "doc", content: [{ type: "table", content: [{ type: "tableRow", content: [cell([para("edited")]), cell([para("keep-this-cell")])] }] }] };
  spliceMediaNodes(current, restore);
  eq("A4 splice: still exactly ONE table (no duplication)", countNodes(current, (n) => n.type === "table"), 1);
  ok("A4 splice: the sealed media is restored", collectMediaFileIds(current).has("fileC"));
  eq("A4 splice: exactly one mediaSingle added", countNodes(current, (n) => n.type === "mediaSingle"), 1);
}

// (4) it23: multi-version media restore must ACCUMULATE across versions, not stop at the first.
// Two sealed files last existed in DIFFERENT older versions (B deleted earlier than A); the
// walk-back in restoreMediaPass must restore BOTH — the old `break`-on-first-non-empty dropped B.
{
  const vNewer = { type: "doc", content: [mediaSingle("fileA"), para("text")] }; // A present, B already gone
  const vOlder = { type: "doc", content: [mediaSingle("fileA"), mediaSingle("fileB")] }; // both present
  const stillNeeded = new Set(["fileA", "fileB"]);
  const restored = [];
  for (const doc of [vNewer, vOlder]) { // newest → oldest, mirroring the pass
    if (stillNeeded.size === 0) break;
    for (const entry of extractMediaSingleNodes(doc, stillNeeded)) {
      restored.push(entry);
      for (const fid of collectMediaFileIds(entry.node)) stillNeeded.delete(fid);
    }
  }
  eq("it23: both sealed media restored across versions", restored.length, 2);
  const ids = new Set(restored.flatMap((e) => [...collectMediaFileIds(e.node)]));
  ok("it23: fileA restored (from the newer version)", ids.has("fileA"));
  ok("it23: fileB restored (from the OLDER version — not dropped)", ids.has("fileB"));
  eq("it23: still-needed set emptied", stillNeeded.size, 0);
  // demonstrate why the old break was a bypass: the newest version alone yields only fileA.
  eq("it23: newest version alone yields only fileA", extractMediaSingleNodes(vNewer, new Set(["fileA", "fileB"])).length, 1);
}

// (5) it24: hashAdf must not throw on undefined content (a malformed/empty sealed wrapper) —
// that would abort the whole enforcement pass and skip every remaining seal on the page.
{
  eq("it24: hashAdf(undefined) → sentinel, no throw", hashAdf(undefined), "00000000");
  ok("it24: a real body never collides with the nullish sentinel", hashAdf({ type: "doc", content: [para("x")] }) !== "00000000");
  ok("it24: different sealed bodies → different hashes (both detectable as tampered)", hashAdf([para("A")]) !== hashAdf([para("B")]));
}

// (6) it25 (R3-F2): a sealed section MOVED into a container (expand/layout/table cell) must
// still be LOCATED (deep scan) — else it reads as "removed" → a phantom top-level clone is
// spliced in and the nested copy becomes a permanent tamper blind spot. The located node is a
// LIVE reference, so the restore pass body-checks + restores it in place (no deep-remove).
{
  const nestedWrapper = buildSealedSectionNode({ sectionId: "sec-nested", extensionKey: EXT_KEY, bodyContent: [para("nested body")] });
  const nestedDoc = { type: "doc", content: [para("top"), { type: "expand", attrs: { title: "More" }, content: [nestedWrapper] }] };
  const deep = locateBodiedSectionNodes(nestedDoc);
  eq("it25: nested sealed section IS located (not treated as removed)", deep.length, 1);
  eq("it25: nested section keeps its sectionId", deep[0].sectionId, "sec-nested");
  eq("it25: nested originalIndex = top-level ancestor index", deep[0].originalIndex, 1);
  // the located node is a live reference — mutating it restores IN PLACE (how the pass works).
  deep[0].node.content = [para("restored-in-place")];
  eq("it25: mutating the located node restores in place", nestedDoc.content[1].content[0].content[0].content[0].text, "restored-in-place");
  // a genuinely-removed section is still NOT found (→ the removed branch re-inserts it).
  eq("it25: a doc without the section locates nothing", locateBodiedSectionNodes({ type: "doc", content: [para("only text")] }).length, 0);

  // it40 (R3-F5): a bodiedExtension must never get content:[] (invalid ADF → whole-page PUT 400s).
  eq("it40: empty [] body → one empty paragraph (not invalid empty content)", JSON.stringify(nonEmptySectionBody([])), JSON.stringify([{ type: "paragraph", content: [] }]));
  eq("it40: null/undefined body → one empty paragraph", JSON.stringify(nonEmptySectionBody(null)), JSON.stringify([{ type: "paragraph", content: [] }]));
  eq("it40: non-empty body is returned unchanged", JSON.stringify(nonEmptySectionBody([para("keep me")])), JSON.stringify([para("keep me")]));
  eq("it40: buildSealedSectionNode never emits empty content (empty body → paragraph guard)", buildSealedSectionNode({ sectionId: "s", extensionKey: "a/b/static/sentinel-vault-sealed-section", bodyContent: [] }).content.length, 1);
}

// (7) Requirement 2.3 GAP 1: an orphaned wrapper (guestParams.sectionId stripped by copy/paste
// or REST) must be ADOPTED back under its seal, never left behind as an unprotected duplicate.
{
  const body = [heading(2, "Quarterly numbers"), para("sealed body")];
  const snapshotHash = hashAdf(body);
  const orphan = () => {
    const w = buildSealedSectionNode({ sectionId: "IGNORED", extensionKey: EXT_KEY, bodyContent: JSON.parse(JSON.stringify(body)) });
    delete w.attrs.parameters.guestParams.sectionId; // what the editor hands back
    return w;
  };
  const opts = { sectionId: "sec-A", sectionTitle: "Quarterly numbers", snapshotHash, knownSectionIds: ["sec-A", "sec-B"] };

  // adopt by title (body tampered → hash differs, title still matches)
  {
    const w = orphan(); w.content[1] = para("TAMPERED");
    const doc = { type: "doc", content: [para("intro"), w] };
    const r = adoptOrphanWrappers(doc, opts);
    eq("gap1: adopt by title → adopted 1", r, { adopted: 1, removed: 0 });
    eq("gap1: adopted wrapper carries the seal id", getSectionId(doc.content[1]), "sec-A");
    eq("gap1: adopted wrapper keeps its (tampered) body for the compare/restore step", doc.content[1].content[1].content[0].text, "TAMPERED");
    eq("gap1: adopted wrapper is now located under the seal", locateBodiedSectionNodes(doc).filter((x) => x.sectionId === "sec-A").length, 1);
  }
  // adopt by hash (heading retitled → title differs, body hash equals the snapshot)
  {
    const w = orphan(); w.content[0] = heading(2, "Renamed");
    const hashOnly = { ...opts, snapshotHash: hashAdf(w.content) };
    const doc = { type: "doc", content: [{ type: "expand", attrs: { title: "x" }, content: [w] }] };
    const r = adoptOrphanWrappers(doc, hashOnly);
    eq("gap1: adopt by hash (nested) → adopted 1", r, { adopted: 1, removed: 0 });
    eq("gap1: nested adopted wrapper stamped", getSectionId(doc.content[0].content[0]), "sec-A");
  }
  // localId fallback: a wrapper whose only id is a platform localId is an orphan too, and the
  // localId is re-stamped so getSectionId's fallback agrees with guestParams.
  {
    const w = orphan(); w.attrs.localId = "editor-generated-uuid";
    const doc = { type: "doc", content: [w] };
    adoptOrphanWrappers(doc, opts);
    eq("gap1: localId re-stamped on adoption", doc.content[0].attrs.localId, "sec-A");
    eq("gap1: guestParams re-stamped on adoption", doc.content[0].attrs.parameters.guestParams.sectionId, "sec-A");
  }
  // ambiguous (two candidates) → both removed, nothing adopted; other blocks untouched
  {
    const doc = { type: "doc", content: [para("intro"), orphan(), para("mid"), orphan(), para("end")] };
    const r = adoptOrphanWrappers(doc, opts);
    eq("gap1: two candidates → removed 2, adopted 0", r, { adopted: 0, removed: 2 });
    eq("gap1: ambiguous removal leaves the plain blocks", doc.content.map((b) => b.type), ["paragraph", "paragraph", "paragraph"]);
    eq("gap1: no wrapper remains", locateBodiedSectionNodes(doc).length, 0);
  }
  // no candidates → no-op (an orphan with a different title AND a different body is not ours)
  {
    const w = orphan(); w.content = [heading(2, "Something else"), para("other")];
    const doc = { type: "doc", content: [w] };
    const before = JSON.stringify(doc);
    eq("gap1: no candidates → no-op", adoptOrphanWrappers(doc, opts), { adopted: 0, removed: 0 });
    eq("gap1: no-op leaves the doc byte-identical", JSON.stringify(doc), before);
  }
  // never touches a wrapper whose id IS a known seal (sec-B with the same title/body)
  {
    const known = buildSealedSectionNode({ sectionId: "sec-B", extensionKey: EXT_KEY, bodyContent: JSON.parse(JSON.stringify(body)) });
    const doc = { type: "doc", content: [known] };
    eq("gap1: a known seal's wrapper is never a candidate", adoptOrphanWrappers(doc, opts), { adopted: 0, removed: 0 });
    eq("gap1: known wrapper keeps its own id", getSectionId(doc.content[0]), "sec-B");
    // ...and the seal's OWN id is known too: a wrapper already carrying it is not "adopted" again
    const own = buildSealedSectionNode({ sectionId: "sec-A", extensionKey: EXT_KEY, bodyContent: JSON.parse(JSON.stringify(body)) });
    eq("gap1: the seal's own wrapper is not a candidate", adoptOrphanWrappers({ type: "doc", content: [own] }, opts), { adopted: 0, removed: 0 });
  }
  // a foreign macro (different extension key) is never a candidate
  {
    const w = orphan(); w.attrs.extensionKey = "other/app/static/some-other-macro";
    eq("gap1: foreign extension key is never a candidate", adoptOrphanWrappers({ type: "doc", content: [w] }, opts), { adopted: 0, removed: 0 });
  }
  // a generic "Sealed section" title with no heading in the body must not match by title
  {
    const w = orphan(); w.content = [para("no heading here")];
    eq("gap1: title match requires a leading heading", adoptOrphanWrappers({ type: "doc", content: [w] }, { ...opts, sectionTitle: "Sealed section", snapshotHash: "ffffffff" }), { adopted: 0, removed: 0 });
  }
}

// (8) Part 3.5: compact re-baseline diff for the activity trail.
{
  const base = [heading(2, "Title"), para("first"), para("second")];
  const clone = () => JSON.parse(JSON.stringify(base));
  eq("p35 diff: no change → zeros, empty sample", summarizeAdfDiff(base, clone()), { removed: 0, added: 0, changedBlocks: 0, sample: "" });
  const withId = clone(); withId[1].attrs = { localId: "id-1" };
  const volatile = clone(); volatile[1].attrs = { localId: "editor-regenerated" };
  eq("p35 diff: editor-volatile attrs are not a change", summarizeAdfDiff(withId, volatile).changedBlocks, 0);
  const edited = clone(); edited[1] = para("first, now edited");
  eq("p35 diff: one paragraph edited → changedBlocks 1 with the new text", summarizeAdfDiff(base, edited), { removed: 0, added: 0, changedBlocks: 1, sample: "first, now edited" });
  const added = clone(); added.push(para("a new block"));
  eq("p35 diff: block added", summarizeAdfDiff(base, added), { removed: 0, added: 1, changedBlocks: 0, sample: "a new block" });
  const removed = clone(); removed.splice(2, 1);
  eq("p35 diff: block removed (sample falls back to the removed text)", summarizeAdfDiff(base, removed), { removed: 1, added: 0, changedBlocks: 0, sample: "second" });
  const both = clone(); both[1] = para("changed"); both.push(para("extra"));
  eq("p35 diff: one edited + one added", summarizeAdfDiff(base, both), { removed: 0, added: 1, changedBlocks: 1, sample: "changed" });
  const moved = [base[0], base[2], base[1]];
  eq("p35 diff: reordering identical blocks is not a change", summarizeAdfDiff(base, moved).changedBlocks, 0);
  const long = clone(); long[1] = para("y".repeat(500));
  const ld = summarizeAdfDiff(base, long);
  eq("p35 diff: sample is bounded", ld.sample.length, ADF_DIFF_SAMPLE_MAX);
  ok("p35 diff: whole object stays well under the 400-byte budget", JSON.stringify(ld).length <= 400);
  eq("p35 diff: nullish inputs → count as empty", summarizeAdfDiff(undefined, [para("x")]), { removed: 0, added: 1, changedBlocks: 0, sample: "x" });
}

report("doc-surgery");
