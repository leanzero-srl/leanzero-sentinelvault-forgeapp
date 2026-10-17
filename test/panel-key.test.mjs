// The site-wide panel key (the macro key the app writes into page bodies when it inserts its panel)
// is the app's own, built from its runtime context. It is never taken from page content, and a
// different key already stored is replaced by the app's own.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, onConfluence } = await import("./_forge-fake/state.mjs");
const { kvs } = await import("@forge/kvs");
const panels = new Map((await import("../src/server/capsules/panels/actions.js")).actions);
const surgery = await import("../src/server/infra/doc-surgery.js");
const { resolveExtensionKey, deriveExtensionKeyFromContext, insertPanelNode } = surgery;
const healForeignPanels = surgery.healForeignPanels || (() => "no repair helper");
console.warn = () => {}; console.error = () => {}; console.info = () => {};
console.log = ((log) => (...a) => { if (String(a[0] || "").match(/passed|FAIL/)) log(...a); })(console.log);

const OWN = deriveExtensionKeyFromContext();
const FOREIGN = "other-app-id/other-env-id/static/sentinel-vault-panel";
const READER = "acct-reader";
const node = (extensionKey) => ({ type: "extension", attrs: { extensionKey, extensionType: "com.atlassian.ecosystem", parameters: {} } });
const adf = (key) => ({ version: 1, type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }, node(key)] });

let puts = [];
function world(pageKey) {
  resetFake(); puts = [];
  onConfluence((method, rawPath, body) => {
    const [base] = decodeURIComponent(rawPath).split("?");
    if (base === "/wiki/api/v2/pages/42" && method === "PUT") { puts.push(body); return { body: { id: "42", version: { number: 3 } } }; }
    if (/^\/wiki\/rest\/api\/content\/[^/]+\/permission\/check$/.test(base)) return { body: { hasPermission: true } };
    if (base === "/wiki/api/v2/pages/42") return { body: { id: "42", title: "A page", spaceId: "101", version: { number: 2 }, body: { atlas_doc_format: { value: JSON.stringify(adf(pageKey)) } } } };
    return undefined;
  });
}

ok("the app's own key is derivable (test context)", typeof OWN === "string" && OWN.endsWith("/static/sentinel-vault-panel"));

// Nothing stored yet; a page carries a panel node with another app's key.
world(FOREIGN);
const r1 = await panels.get("discover-panel-key")({ payload: { pageId: "42" }, context: { accountId: READER, extension: {} } });
eq("discover-panel-key, page with a foreign panel key: stores the app's own key", await kvs.get("macro-extension-key"), OWN);
ok("discover-panel-key, page with a foreign panel key: never the page's key", (await kvs.get("macro-extension-key")) !== FOREIGN && r1?.extensionKey !== FOREIGN);

// A page with the real panel: same answer (control).
world(OWN);
await panels.get("discover-panel-key")({ payload: { pageId: "42" }, context: { accountId: READER, extension: {} } });
eq("discover-panel-key, page with the app's own panel: the app's own key", await kvs.get("macro-extension-key"), OWN);

// A foreign key stored by an earlier version is replaced the next time the key is used.
world(OWN);
await kvs.set("macro-extension-key", FOREIGN);
eq("resolveExtensionKey, a foreign key stored: answers the app's own", await resolveExtensionKey(), OWN);
eq("resolveExtensionKey, a foreign key stored: the stored key is replaced", await kvs.get("macro-extension-key"), OWN);
world(OWN);
await kvs.set("macro-extension-key", FOREIGN);
await panels.get("discover-panel-key")({ payload: { pageId: "42" }, context: { accountId: READER, extension: {} } });
eq("discover-panel-key, a foreign key stored: replaced by the app's own", await kvs.get("macro-extension-key"), OWN);

// The read gate is unchanged: a page the caller cannot read is refused.
world(OWN);
onConfluence((method, rawPath) => (/permission\/check$/.test(decodeURIComponent(rawPath).split("?")[0]) ? { body: { hasPermission: false } } : undefined));
const denied = await panels.get("discover-panel-key")({ payload: { pageId: "42" }, context: { accountId: READER, extension: {} } });
eq("discover-panel-key, unreadable page: refused", denied?.success, false);

// A page that already got a foreign panel macro (inserted by an earlier version from a planted key)
// is repaired the next time the app adds its panel there, instead of counting as "panel present".
world(FOREIGN);
const healedIns = await insertPanelNode("42", OWN);
eq("page with a foreign panel macro: repaired", healedIns?.healed, 1);
const written = JSON.stringify(puts[0] || {});
ok("page with a foreign panel macro: the written body carries the app's own key", written.includes(OWN) && !written.includes(FOREIGN));
world(OWN);
eq("page with the app's own panel: left alone (control)", (await insertPanelNode("42", OWN))?.skipped, true);
eq("page with the app's own panel: nothing written (control)", puts.length, 0);
eq("healForeignPanels: never rewrites to a key that is not a panel key", healForeignPanels(adf(FOREIGN), "not-a-panel-key"), 0);

report("panel-key");
