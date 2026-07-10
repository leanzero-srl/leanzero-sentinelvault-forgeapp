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

report("doc-surgery");
