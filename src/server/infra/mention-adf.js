// Real @mentions in app comments (owner, 2026-09-24).
//
// Every notice named people with the storage-format user link `<ac:link><ri:user …/></ac:link>`.
// On the tenant that renders as a profile link — an avatar chip with no "@" — and did not reach
// the mentioned person's notification bell, so a notice was only seen by someone on the page.
// Confluence's own editor stores a mention as an ADF `mention` node. So the comment is posted in
// ADF: the storage body is converted by Confluence, and every user link becomes a `mention` node.
//
// The two helpers here are PURE (test/mention-adf.test.mjs). The user links are swapped for inert
// text tokens BEFORE the conversion, so the result does not depend on how Confluence's converter
// chooses to render a user link.

const USER_LINK = /<ac:link>\s*<ri:user\s+ri:account-id="([^"]+)"\s*\/>\s*<\/ac:link>/g;
const token = (i) => `SVMENTION${i}SVEND`;
const TOKEN_RE = /SVMENTION(\d+)SVEND/g;

const unescapeXml = (v) => String(v)
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** PURE. Replace each storage user link with a text token; returns the account ids in order. */
export function tokenizeMentions(storage) {
  const ids = [];
  const out = String(storage || "").replace(USER_LINK, (_, id) => { ids.push(unescapeXml(id)); return token(ids.length - 1); });
  return { storage: out, ids };
}

/**
 * PURE. Replace the tokens in an ADF document's text nodes with `mention` nodes. A text node is
 * split around its tokens and keeps its marks on the text either side. Returns
 * { doc, placed } — `placed` counts the mentions put back, so a caller can tell a conversion that
 * dropped one (and fall back) from one that kept them all.
 */
export function injectMentions(doc, ids) {
  let placed = 0;
  const walk = (node) => {
    if (!node || typeof node !== "object") return node;
    if (!Array.isArray(node.content)) return node;
    const next = [];
    for (const child of node.content) {
      if (child && child.type === "text" && typeof child.text === "string" && TOKEN_RE.test(child.text)) {
        TOKEN_RE.lastIndex = 0;
        let last = 0;
        let m;
        while ((m = TOKEN_RE.exec(child.text)) !== null) {
          if (m.index > last) next.push({ ...child, text: child.text.slice(last, m.index) });
          const id = ids[Number(m[1])];
          if (id) { next.push({ type: "mention", attrs: { id } }); placed++; }
          last = m.index + m[0].length;
        }
        if (last < child.text.length) next.push({ ...child, text: child.text.slice(last) });
        TOKEN_RE.lastIndex = 0;
      } else {
        next.push(walk(child));
      }
    }
    return { ...node, content: next };
  };
  return { doc: walk(doc), placed };
}
