import { tokenizeMentions, injectMentions } from "../src/server/infra/mention-adf.js";
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
const { doc, placed } = injectMentions(adf, t.ids);
eq("placed both", placed, 2);
eq("first mention node", doc.content[0].content[0], { type: "mention", attrs: { id: "712020:abc" } });
eq("text after the mention kept", doc.content[0].content[1].text, " — x was released.");
eq("second mention", doc.content[1].content[1], { type: "mention", attrs: { id: "712020:d&e" } });
eq("marks kept on the split text", doc.content[1].content[2], { type: "text", text: ".", marks: [{ type: "strong" }] });
eq("input not mutated", adf.content[0].content.length, 1);
eq("a dropped token is visible to the caller", injectMentions({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "no token" }] }] }, ["a"]).placed, 0);

report("mention-adf");
