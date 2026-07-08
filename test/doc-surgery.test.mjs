import {
  canonicalizeAdf,
  hashAdf,
  buildSealedSectionNode,
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

report("doc-surgery");
