// Sealing on an Approved page while a change by someone outside its approvers is still on it.
//
// The seal records the live body (a section's snapshot, a file's on-page layout), so it waits until
// that change has been dealt with. "Try again in a few minutes" is said only where something will
// deal with it: the page event, the five-minute guard or the hourly sweep reverting or demoting it.
// Where nothing will — Approved-page protection ("Protect Sealed Attachments in Page Body") switched
// off, or an approved version that cannot be read — the refusal says what blocks the seal and how to
// clear it (the sealer, an approver or space admin by construction, publishes the page to accept its
// current content). Also checked: demote mode, a page whose state the workflow no longer has, and a
// page that moved spaces. Real modules, in-memory Forge fake.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, onConfluence } = await import("./_forge-fake/state.mjs");
const { createWorld } = await import("./_forge-fake/confluence-world.mjs");
const triggers = await import("../src/server/triggers.js");
const logic = await import("../src/server/capsules/workflow/logic.js");
const { sealSection } = await import("../src/server/capsules/section-seals/actions.js");
const { kvs } = await import("@forge/kvs");

const APP = "app-account", APPROVER = "acct-approver", SITEADMIN = "acct-site-admin", PLAIN = "acct-plain-editor";
const SPACE = "WF", PAGE = "861", KEY = "app/env/static/sentinel-vault-sealed-section";
const para = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const heading = (t) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: t }] });
const doc = (intro, scope) => ({ version: 1, type: "doc", content: [para(intro), heading("Scope"), para(scope)] });
const TRY_LATER = /Try again in a few minutes/;

let unreadable = null; // { version, status }
async function approvedPage({ mode = "revert", protection = true } = {}) {
  resetFake();
  unreadable = null;
  const w = createWorld({ appAccountId: APP, spaceKey: SPACE });
  w.addUser(APP).addUser(APPROVER, { displayName: "Ana" }).addUser(PLAIN, { displayName: "Pat" }).addUser(SITEADMIN, { displayName: "Sia", siteAdmin: true })
    .addPage(PAGE, { versions: [{ authorId: PLAIN, text: "draft" }, { authorId: PLAIN, adf: doc("approved intro", "approved scope") }] });
  w.readers.add("*");
  onConfluence((method, rawPath) => {
    const path = decodeURIComponent(rawPath);
    if (unreadable && method === "GET" && path.includes(`/wiki/api/v2/pages/${PAGE}?`) && path.includes(`version=${unreadable.version}`)) return { status: unreadable.status, body: "x", headers: unreadable.status === 429 ? { "Retry-After": "1800" } : {} };
    return undefined;
  });
  await kvs.set("app-account-id", APP);
  await kvs.set("section-macro-extension-key", KEY);
  await kvs.set("admin-settings-global", { enableContentProtection: protection });
  await kvs.set(`workflow-settings-${SPACE}`, {
    enabled: true, workflowId: "default", enforceMode: mode, demoteTo: "initial",
    approval: { approvers: [{ type: "user", id: APPROVER, name: "Ana" }], mode: "any", min: 1 },
  });
  await logic.assignPageWorkflow({ pageId: PAGE, spaceKey: SPACE, actorAccountId: PLAIN, actorName: "Pat", workflowId: "default" });
  await logic.transitionPageWorkflow({ pageId: PAGE, spaceKey: SPACE, toStateId: "in_review", actorAccountId: PLAIN, actorName: "Pat" });
  const appr = await logic.transitionPageWorkflow({ pageId: PAGE, spaceKey: SPACE, toStateId: "approved", actorAccountId: APPROVER, actorName: "Ana", approvers: [APPROVER], approvedVersion: 2,
    approvalRecord: { outcome: "approved", completedBy: APPROVER, completedByName: "Ana", requestedBy: PLAIN, pinnedVersion: 2, decisions: [] } });
  if (!appr.success) throw new Error(`approve failed: ${appr.reason}`);
  const save = (author, adf) => { const p = w.pages.get(PAGE); p.versions.push({ number: p.versions.length + 1, authorId: author, adf }); return p.versions.length; };
  return { w, save };
}
const seal = (accountId) => sealSection({ payload: { pageId: PAGE, headingIndex: 1, headingText: "Scope" }, context: { accountId, extension: { content: { id: PAGE, type: "page", space: { key: SPACE } }, space: { key: SPACE } } } });
const event = (actor, version) => ({ eventType: "avi:confluence:updated:page", atlassianId: actor, content: { id: PAGE, version: { number: version } }, space: { key: SPACE } });

const log = { info: console.info, warn: console.warn, error: console.error, log: console.log };
console.info = console.warn = console.error = console.log = () => {};
try {
  // 1. Protection switched off: nothing will ever deal with the change.
  {
    const { save } = await approvedPage({ protection: false });
    save(PLAIN, doc("UNAPPROVED", "approved scope"));
    const r = await seal(APPROVER);
    eq("[1] protection off: the seal is refused (a seal records only content that counts)", r?.success, false);
    ok("[1] ...never with 'try again in a few minutes' (nothing will deal with it)", !TRY_LATER.test(r?.reason || "try again in a few minutes"));
    ok("[1] ...the reason names the switch and the way out", /Protect Sealed Attachments in Page Body/.test(r?.reason || "") && /publish/i.test(r?.reason || ""));
    save(APPROVER, doc("UNAPPROVED, reviewed by Ana", "approved scope"));
    eq("[1] once an approver has published the page, the seal goes ahead", (await seal(APPROVER))?.success, true);
  }
  // 2. The approved version cannot be read: no revert will ever happen.
  {
    const { save } = await approvedPage();
    save(PLAIN, doc("UNAPPROVED", "approved scope"));
    unreadable = { version: 2, status: 404 };
    const r = await seal(APPROVER);
    eq("[2] approved version unreadable: refused", r?.success, false);
    ok("[2] ...never with 'try again in a few minutes'", !TRY_LATER.test(r?.reason || "try again in a few minutes"));
    ok("[2] ...the reason says the approved version could not be read, and how to clear it", /approved version could not be read/.test(r?.reason || "") && /publish/i.test(r?.reason || ""));
    save(APPROVER, doc("UNAPPROVED, reviewed by Ana", "approved scope"));
    eq("[2] once an approver has published the page, the seal goes ahead", (await seal(APPROVER))?.success, true);
  }
  {
    // A 429 on that read is passing: "try again in a minute", flagged busy.
    const { save } = await approvedPage();
    save(PLAIN, doc("UNAPPROVED", "approved scope"));
    unreadable = { version: 2, status: 429 };
    const r = await seal(APPROVER);
    eq("[2b] Confluence limiting: refused as busy", [r?.success, r?.busy], [false, true]);
  }
  // 3. Revert mode, protection on: the page event deals with it — "try again" is true.
  {
    const { save } = await approvedPage();
    const v3 = save(PLAIN, doc("UNAPPROVED", "approved scope"));
    const r = await seal(APPROVER);
    ok("[3] revert mode: refused with 'try again in a few minutes'", r?.success === false && TRY_LATER.test(r?.reason || ""));
    await triggers.pageContentTrigger(event(PLAIN, v3));
    eq("[3] ...and after the revert the seal goes ahead", (await seal(APPROVER))?.success, true);
  }
  // 4. Demote mode: the page goes back for review, and then nothing blocks the seal.
  {
    const { save } = await approvedPage({ mode: "demote" });
    const v3 = save(PLAIN, doc("UNAPPROVED", "approved scope"));
    ok("[4] demote mode: refused with 'try again in a few minutes'", TRY_LATER.test((await seal(APPROVER))?.reason || ""));
    await triggers.pageContentTrigger(event(PLAIN, v3));
    ok("[4] the page left Approved", (await logic.readPageWorkflow(PAGE))?.stateId !== "approved");
    eq("[4] ...and the seal goes ahead", (await seal(APPROVER))?.success, true);
  }
  // 5. A state the workflow no longer has: still enforced (the engine's rule), still dealt with.
  {
    const { save } = await approvedPage();
    const rec = await logic.readPageWorkflow(PAGE);
    await kvs.set(`workflow-state-${PAGE}`, { ...rec, stateId: "retired-state" });
    eq("[5] a plain editor cannot seal on it (it is judged enforced, as the page event judges it)", (await seal(PLAIN))?.success, false);
    const v3 = save(PLAIN, doc("UNAPPROVED", "approved scope"));
    ok("[5] an approver waits for the revert", TRY_LATER.test((await seal(APPROVER))?.reason || ""));
    await triggers.pageContentTrigger(event(PLAIN, v3));
    eq("[5] ...which happens, and then the seal goes ahead", (await seal(APPROVER))?.success, true);
  }
  // 6. A page that moved spaces (its workflow holds still; edits are reverted).
  {
    const { save } = await approvedPage();
    const rec = await logic.readPageWorkflow(PAGE);
    await kvs.set(`workflow-state-${PAGE}`, { ...rec, spaceKey: "OLDSPACE" });
    const v3 = save(PLAIN, doc("UNAPPROVED", "approved scope"));
    ok("[6] moved page: the site admin waits for the revert", TRY_LATER.test((await seal(SITEADMIN))?.reason || ""));
    await triggers.pageContentTrigger(event(PLAIN, v3));
    eq("[6] ...which happens, and then the seal goes ahead", (await seal(SITEADMIN))?.success, true);
  }
} finally { Object.assign(console, log); }
report("seal-pending-change");
