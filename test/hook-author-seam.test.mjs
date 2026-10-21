// The dev test hook's `pageEvent` seam names the author of the version it runs the pipeline for.
//
// The live harness writes every page version with one privileged token, then runs the page pipeline
// "as" a real non-privileged account through the dev hook. The enforcement rules read who wrote each
// version, so the hook names that version's author for its own call (shared/hook-author.js). This
// proves: (1) the shape the live specs hit (event actor plain, live version written by a steward):
// the steward's live version counts and is kept; (2) through the hook the actor is the author, so the
// edit is reverted; (3) the seam is inert outside the hook — no scope, no override, the real author
// stands — and only src/test-hook.js enters it; (4) the hook answers 404 without HARNESS_SECRET and is
// removed from the production manifest. Real modules, in-memory Forge fake.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake } = await import("./_forge-fake/state.mjs");
const { createWorld } = await import("./_forge-fake/confluence-world.mjs");
const triggers = await import("../src/server/triggers.js");
const logic = await import("../src/server/capsules/workflow/logic.js");
const { kvs } = await import("@forge/kvs");
const seam = await import("../src/server/shared/hook-author.js").catch(() => ({}));
const hook = await import("../src/test-hook.js");

const APP = "app-account", STEWARD = "acct-harness-site-admin", PLAIN = "acct-plain-editor", APPROVER = "acct-approver";
const SPACE = "WF", PAGE = "871";
const para = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const doc = (t) => ({ version: 1, type: "doc", content: [para("THE APPROVED POLICY TEXT."), ...(t ? [para(t)] : [])] });
const text = (v) => JSON.stringify(v?.adf || v);

async function bed() {
  resetFake();
  const w = createWorld({ appAccountId: APP, spaceKey: SPACE });
  w.addUser(APP).addUser(STEWARD, { displayName: "Harness", siteAdmin: true }).addUser(PLAIN, { displayName: "Pat" }).addUser(APPROVER, { displayName: "Ana" })
    .addPage(PAGE, { versions: [{ authorId: STEWARD, adf: doc(null) }] });
  w.readers.add("*");
  await kvs.set("app-account-id", APP);
  await kvs.set("admin-settings-global", { enableContentProtection: true });
  await kvs.set(`workflow-settings-${SPACE}`, { enabled: true, workflowId: "default", enforceMode: "revert", approval: { approvers: [{ type: "user", id: APPROVER, name: "Ana" }], mode: "any", min: 1 } });
  await logic.assignPageWorkflow({ pageId: PAGE, spaceKey: SPACE, actorAccountId: PLAIN, actorName: "Pat", workflowId: "default" });
  await logic.transitionPageWorkflow({ pageId: PAGE, spaceKey: SPACE, toStateId: "in_review", actorAccountId: PLAIN, actorName: "Pat" });
  const t = await logic.transitionPageWorkflow({ pageId: PAGE, spaceKey: SPACE, toStateId: "approved", actorAccountId: APPROVER, actorName: "Ana", approvers: [APPROVER], approvedVersion: 1 });
  if (!t.success) throw new Error(t.reason);
  // The harness token (a steward) writes v2 holding the "plain editor's" change.
  const p = w.pages.get(PAGE);
  p.versions.push({ number: 2, authorId: STEWARD, adf: doc("UNAPPROVED CHANGE BY A PLAIN EDITOR") });
  return w;
}
const event = (actor, version) => ({ eventType: "avi:confluence:updated:page", atlassianId: actor, content: { id: PAGE, version: { number: version } }, space: { key: SPACE } });
const hookReq = (params, secret = "s3cret") => ({ headers: { authorization: [`Bearer ${secret}`] }, queryParameters: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, [v]])) });

const log = { info: console.info, warn: console.warn, error: console.error, log: console.log };
console.info = console.warn = console.error = console.log = () => {};
try {
  // 1. The live specs' shape without the seam: the steward's live version counts and is kept.
  {
    const w = await bed();
    await triggers.pageContentTrigger(event(PLAIN, 2));
    eq("[1] event actor plain, live v2 written by a steward: the steward's version is kept", [w.live(PAGE).number, w.live(PAGE).authorId], [2, STEWARD]);
  }
  // 2. Through the hook, the actor is v2's author: the edit is reverted.
  {
    const w = await bed();
    process.env.HARNESS_SECRET = "s3cret";
    const r = await hook.testStateTrigger(hookReq({ what: "invoke", fn: "pageEvent", pageId: PAGE, actor: PLAIN, version: "2" }));
    eq("[2] the hook answered", r?.statusCode, 200);
    const live = w.live(PAGE);
    ok("[2] through the hook, the plain editor's edit is reverted (v3 by the app, approved text)", live.number === 3 && live.authorId === APP && !text(live).includes("UNAPPROVED"));
    eq("[2] ...and the page stays Approved", (await logic.readPageWorkflow(PAGE))?.stateId, "approved");
  }
  {
    // realAuthor=1 keeps Confluence's author.
    const w = await bed();
    process.env.HARNESS_SECRET = "s3cret";
    await hook.testStateTrigger(hookReq({ what: "invoke", fn: "pageEvent", pageId: PAGE, actor: PLAIN, version: "2", realAuthor: "1" }));
    eq("[2] realAuthor=1: Confluence's author stands (kept)", w.live(PAGE).number, 2);
  }
  // 3. Inert outside the hook.
  {
    eq("[3] no scope: no override", (seam.hookVersionAuthor ? seam.hookVersionAuthor(PAGE, 2) : "missing"), null);
    const inside = await seam.withHookVersionAuthor?.({ pageId: PAGE, version: 2, accountId: PLAIN }, async () => [seam.hookVersionAuthor(PAGE, 2), seam.hookVersionAuthor(PAGE, 3), seam.hookVersionAuthor("other", 2)]);
    eq("[3] inside: only that page and version are named", inside, [PLAIN, null, null]);
    eq("[3] after the scope: nothing leaks", (seam.hookVersionAuthor ? seam.hookVersionAuthor(PAGE, 2) : "missing"), null);
    const w = await bed();
    await triggers.pageContentTrigger(event(PLAIN, 2)); // a later, unscoped run on a warm module
    eq("[3] an unscoped run after the hook sees the real author", [w.live(PAGE).number, w.live(PAGE).authorId], [2, STEWARD]);
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "src");
    const files = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(m?js|jsx)$/.test(e.name)) files.push(p); } };
    walk(root);
    const callers = files.filter((f) => !f.endsWith(path.join("shared", "hook-author.js")) && /withHookVersionAuthor\s*\(/.test(fs.readFileSync(f, "utf8")));
    eq("[3] only src/test-hook.js enters the seam", callers.map((f) => path.relative(root, f)), ["test-hook.js"]);
  }
  // 4. The hook is closed without the secret and absent from the production manifest.
  {
    delete process.env.HARNESS_SECRET;
    const w = await bed();
    const r = await hook.testStateTrigger(hookReq({ what: "invoke", fn: "pageEvent", pageId: PAGE, actor: PLAIN, version: "2" }));
    eq("[4] no HARNESS_SECRET: 404 and nothing runs", [r?.statusCode, w.live(PAGE).number], [404, 2]);
    const { execFileSync } = await import("node:child_process");
    const os = await import("node:os");
    const path = await import("node:path");
    const fs = await import("node:fs");
    const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sv-strip-")), "manifest.prod.yml");
    execFileSync(process.execPath, [path.join(repo, "scripts/strip-dev-modules.mjs"), path.join(repo, "manifest.yml"), out], { stdio: "ignore" });
    const prod = fs.readFileSync(out, "utf8");
    ok("[4] the production manifest has no harness hook", !/harness-test-state|testStateTrigger/.test(prod));
  }
} finally { Object.assign(console, log); delete process.env.HARNESS_SECRET; }
report("hook-author-seam");
