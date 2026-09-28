import { tokenizeMentions, injectMentions, mentionNode } from "../src/server/infra/mention-adf.js";
import { eq, report } from "./_assert.mjs";

const s = '<p><ac:link><ri:user ri:account-id="712020:abc" /></ac:link> — "x" was released.</p><p>Also <ac:link><ri:user ri:account-id="712020:d&amp;e"/></ac:link>.</p>';
const t = tokenizeMentions(s);
eq("two ids, in order, unescaped", t.ids, ["712020:abc", "712020:d&e"]);
eq("links replaced by tokens", /ri:user/.test(t.storage), false);
eq("no mentions → untouched", tokenizeMentions("<p>plain</p>"), { storage: "<p>plain</p>", ids: [] });

const adf = { type: "doc", version: 1, content: [
  { type: "paragraph", content: [{ type: "text", text: "SVMENTION0SVEND — x was released." }] },
  { type: "paragraph", content: [{ type: "text", text: "Also " }, { type: "text", text: "SVMENTION1SVEND.", marks: [{ type: "strong" }] }] },
] };
const { doc, placed } = injectMentions(adf, t.ids, { "712020:abc": "Gabriela Perdum" });
eq("placed both", placed, 2);
eq("first mention node — the ADF spec shape", doc.content[0].content[0], { type: "mention", attrs: { id: "712020:abc", text: "@Gabriela Perdum", accessLevel: "" } });
eq("text after the mention kept", doc.content[0].content[1].text, " — x was released.");
eq("second mention, name unknown", doc.content[1].content[1], { type: "mention", attrs: { id: "712020:d&e", text: "@user", accessLevel: "" } });
eq("mentionNode shape", mentionNode("x", "A B"), { type: "mention", attrs: { id: "x", text: "@A B", accessLevel: "" } });
eq("marks kept on the split text", doc.content[1].content[2], { type: "text", text: ".", marks: [{ type: "strong" }] });
eq("input not mutated", adf.content[0].content.length, 1);
eq("a dropped token is visible to the caller", injectMentions({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "no token" }] }] }, ["a"]).placed, 0);

report("mention-adf");
