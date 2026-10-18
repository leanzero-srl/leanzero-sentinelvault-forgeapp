// The page's byline item (the small status under the title) follows a workflow move made elsewhere,
// without a reload (2026-10-18, content pilot take live-fix-ship-1 at 774-777 s: the approver's banner
// read "In Review" while the byline item under the title still read "Draft").
//
// Confluence renders the byline item from the `sentinel-byline` content property ONCE, when the page
// loads; the app rewrites the property on every move, but an open page never re-reads it. The only way
// to change an open page's byline is the Confluence bridge's updateBylineProperties, called from
// another module on the same page — the banner. So: ribbon-summary (which the banner re-reads when the
// per-page workflow stamp changes, 8.10.0) answers the byline the page should show, and the banner
// hands a CHANGED byline to Confluence. The first answer after the page loads is only remembered (it is
// what Confluence just rendered from the property), so nothing flickers on load.
import "./_forge-fake/install.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, ok, report } from "./_assert.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { resetFake } = await import("./_forge-fake/state.mjs");
const { createWorld } = await import("./_forge-fake/confluence-world.mjs");
const logic = await import("../src/server/capsules/workflow/logic.js");
const { kvs } = await import("@forge/kvs");
const wfActions = new Map((await import("../src/server/capsules/workflow/actions.js")).actions);
const sealing = new Map((await import("../src/server/capsules/sealing/actions.js")).actions);
const { BYLINE_PROPERTY_KEY } = await import("../src/server/capsules/page-details/byline.js");
// Missing before the fix: the red run reports every assertion instead of one import error.
const { bylineSyncStep } = await import("../src/ui/kit/byline-sync.js").catch(() => ({ bylineSyncStep: () => ({}) }));

const PLAIN = "acct-plain";
const SPACE = "WF";
const PAGE = "801";
const realLog = { info: console.info, warn: console.warn, error: console.error, log: console.log };
const quiet = () => { console.info = () => {}; console.warn = () => {}; console.error = () => {}; };
const loud = () => Object.assign(console, realLog);

quiet();
try {
  resetFake();
  createWorld({ spaceKey: SPACE }).addUser(PLAIN).addPage(PAGE, { versions: [{ authorId: PLAIN }] }).readers.add("*");
  await kvs.set(`workflow-settings-${SPACE}`, { enabled: true, workflowId: "default" });
  await logic.assignPageWorkflow({ pageId: PAGE, spaceKey: SPACE, actorAccountId: PLAIN, workflowId: "default" });
  const summary = () => sealing.get("ribbon-summary")({ payload: {}, context: { accountId: PLAIN, extension: { content: { id: PAGE, type: "page" } } } });
  const s1 = await summary();
  ok("[1] ribbon-summary answers the byline the page should show: Draft", /Draft/.test(s1?.byline?.title || ""));
  ok("[1] the byline answer carries an icon and a tooltip", !!s1?.byline?.icon && !!s1?.byline?.tooltip);
  const moved = await wfActions.get("request-transition")({ payload: { pageId: PAGE, toStateId: "in_review", fromStateId: "draft" }, context: { accountId: PLAIN } });
  eq("[1] bed: the page moved to In Review", moved?.success, true);
  const s2 = await summary();
  ok("[1] after the move ribbon-summary answers In Review", /In Review/.test(s2?.byline?.title || "") && !/Draft/.test(s2?.byline?.title || ""));
  // Review 2026-10-18 #5: the byline answer must not hold the banner past its 1.5 s bound — a slow
  // workflow read (a long log) now delays the summary only up to that bound.
  const realQuery = kvs.query;
  kvs.query = () => {
    const api = realQuery();
    let prefix = "";
    const where = api.where; api.where = (f, c) => { prefix = c?.beginsWith || ""; return where(f, c); };
    const getMany = api.getMany; api.getMany = async () => { if (prefix.startsWith("workflow-log-")) await new Promise((r) => setTimeout(r, 4000)); return getMany(); };
    return api;
  };
  try {
    const t0 = Date.now();
    const slow = await summary();
    const ms = Date.now() - t0;
    ok(`[1] a slow workflow read holds the summary at most ~1.5 s (took ${ms} ms)`, ms < 3000);
    eq("[1] ...and the summary still answers", slow?.ok === true || slow?.reason === "none", true);
  } finally { kvs.query = realQuery; }
} finally {
  loud();
}

// 2. The banner's decision (pure): remember the first answer for a page, hand on every change.
{
  const a = { title: "Draft", icon: "i1", tooltip: "t1" };
  const b = { title: "In Review", icon: "i2", tooltip: "t2" };
  let st = null;
  let r = bylineSyncStep(st, "1", a); st = r.state;
  eq("[2] the first answer after load is remembered, not pushed (Confluence just rendered it)", r.push, null);
  r = bylineSyncStep(st, "1", a); st = r.state;
  eq("[2] the same byline again: nothing to push", r.push, null);
  r = bylineSyncStep(st, "1", b); st = r.state;
  eq("[2] a changed byline is pushed: title, icon and tooltip", r.push, { title: "In Review", icon: "i2", tooltip: "t2" });
  r = bylineSyncStep(st, "1", b); st = r.state;
  eq("[2] pushed once, not on every poll", r.push, null);
  r = bylineSyncStep(st, "2", a); st = r.state;
  eq("[2] another page (SPA navigation): remembered again, not pushed", r.push, null);
  r = bylineSyncStep(st, "2", null); st = r.state;
  eq("[2] no byline in the answer (a failed read): nothing pushed, nothing forgotten", [r.push, st?.pageId], [null, "2"]);
  r = bylineSyncStep(st, "2", b);
  eq("[2] ...and the next change is still pushed", r.push?.title, "In Review");
}

// 3. The banner calls Confluence's bridge with the key the byline module renders from.
{
  const manifest = fs.readFileSync(path.join(ROOT, "manifest.yml"), "utf8");
  const key = (manifest.match(/confluence:contentBylineItem:[\s\S]*?contentPropertyKey:\s*(\S+)/) || [])[1];
  eq("[3] the manifest's byline key is the property the app writes", key, BYLINE_PROPERTY_KEY);
  const ribbon = fs.readFileSync(path.join(ROOT, "src/ui/surfaces/doc-ribbon/index.jsx"), "utf8");
  ok("[3] the banner imports updateBylineProperties from @forge/confluence-bridge", /import\s*\{[^}]*updateBylineProperties[^}]*\}\s*from\s*"@forge\/confluence-bridge"/.test(ribbon));
  ok("[3] the banner hands the byline to Confluence under that key", /updateBylineProperties\(\{\s*propertyKey:\s*BYLINE_KEY/.test(ribbon) && new RegExp(`BYLINE_KEY\\s*=\\s*"${BYLINE_PROPERTY_KEY}"`).test(ribbon));
  ok("[3] the banner decides through bylineSyncStep", /bylineSyncStep\(/.test(ribbon));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  ok("[3] @forge/confluence-bridge is a dependency", !!pkg.dependencies?.["@forge/confluence-bridge"]);
}
report("byline-sync");
