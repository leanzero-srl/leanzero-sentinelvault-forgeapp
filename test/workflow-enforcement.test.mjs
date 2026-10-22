// Workflow enforcement, end to end through the REAL server modules (triggers.js, workflow logic,
// the dispatch resolver) on the in-memory Forge fake (test/_forge-fake). Each scenario builds an
// Approved page the way the app does (assign → transition with approvers + approvedVersion), then
// drives the page event, the guard or the hourly sweep and asserts what a person would see: the
// page's state, its live version and author, the dispatch the banner reads.
//
// Fixes covered (2026-10-16, fix/workflow-86):
//   1. revert mode with no named approvers reverts (it silently demoted while the UI said "reverted")
//   2. a late event for a version at or below the approved baseline enforces nothing
//   3. the guard reports a demote so the banner can refresh without a reload
//   4. the hourly sweep honours "Protect Sealed Attachments in Page Body" (off = no enforcement)
//   5. the enforcement dispatch reaches the banner with the editor's display name
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, fake } = await import("./_forge-fake/state.mjs");
const { createWorld } = await import("./_forge-fake/confluence-world.mjs");
const triggers = await import("../src/server/triggers.js");
const logic = await import("../src/server/capsules/workflow/logic.js");
const { kvs } = await import("@forge/kvs");
const { recentDispatches } = await import("../src/server/capsules/bulletins/actions.js");
const wfActions = new Map((await import("../src/server/capsules/workflow/actions.js")).actions);
const sealing = new Map((await import("../src/server/capsules/sealing/actions.js")).actions);
const { pageDetailsSummary } = await import("../src/server/capsules/page-details/actions.js");
const { getSpaceActivity } = await import("../src/server/capsules/activity/actions.js");
const { pageTitleOf, activityToCsv } = await import("../src/ui/kit/activity-format.js");

const APP = "app-account";
const APPROVER = "acct-approver";
const ADMIN = "acct-space-admin";
const PLAIN = "acct-plain-editor";
const SPACE = "WF";
const PAGE = "501";

// Quiet the app's own console noise; keep failures visible through report().
const realLog = { info: console.info, warn: console.warn, error: console.error, log: console.log };
const quiet = () => { console.info = () => {}; console.warn = () => {}; console.error = () => {}; };
const loud = () => Object.assign(console, realLog);

/**
 * An Approved page: v1 + v2 authored by PLAIN (the requester), approved at v2.
 * @param {{ enforceMode?: "demote"|"revert", namedApprovers?: boolean, contentProtection?: boolean }} o
 */
async function approvedPage({ enforceMode = "demote", namedApprovers = true, contentProtection = true } = {}) {
  resetFake();
  const w = createWorld({ appAccountId: APP, spaceKey: SPACE });
  w.addUser(APP, { displayName: "Sentinel Vault" })
    .addUser(APPROVER, { displayName: "Ana Approver" })
    .addUser(ADMIN, { displayName: "Sam Admin" })
    .addUser(PLAIN, { displayName: "Pat Plain" })
    .addPage(PAGE, { title: "Travel policy", versions: [{ authorId: PLAIN, text: "first draft" }, { authorId: PLAIN, text: "the text that was approved" }] });
  w.spaceAdmins.add(ADMIN);
  w.readers.add("*");
  await kvs.set("app-account-id", APP);
  await kvs.set("admin-settings-global", { enableContentProtection: contentProtection });
  await kvs.set(`workflow-settings-${SPACE}`, {
    enabled: true, autoAssignNew: false, workflowId: "default", demoteTo: "initial", enforceMode,
    approval: namedApprovers ? { approvers: [{ type: "user", id: APPROVER, name: "Ana Approver" }], mode: "any", min: 1 } : null,
    reviewAfterDaysByState: {}, syncLabels: false, labelWorkflows: [],
  });
  const asg = await logic.assignPageWorkflow({ pageId: PAGE, spaceKey: SPACE, actorAccountId: PLAIN, actorName: "Pat Plain", workflowId: "default" });
  if (!asg.success) throw new Error(`assign failed: ${asg.reason}`);
  const toReview = await logic.transitionPageWorkflow({ pageId: PAGE, spaceKey: SPACE, toStateId: "in_review", actorAccountId: PLAIN, actorName: "Pat Plain" });
  if (!toReview.success) throw new Error(`in_review failed: ${toReview.reason}`);
  const decider = namedApprovers ? APPROVER : ADMIN;
  const appr = await logic.transitionPageWorkflow({
    pageId: PAGE, spaceKey: SPACE, toStateId: "approved", actorAccountId: decider, actorName: namedApprovers ? "Ana Approver" : "Sam Admin",
    approvers: namedApprovers ? [APPROVER] : [], approvedVersion: 2,
    approvalRecord: { outcome: "approved", completedBy: decider, completedByName: namedApprovers ? "Ana Approver" : "Sam Admin", pinnedVersion: 2, decisions: [] },
  });
  if (!appr.success) throw new Error(`approve failed: ${appr.reason}`);
  await kvs.delete("recent-notifications");
  w.comments.length = 0;
  return w;
}

const stateOf = async () => (await logic.readPageWorkflow(PAGE))?.stateId;
const event = (actor, version) => ({ eventType: "avi:confluence:updated:page", atlassianId: actor, content: { id: PAGE, version: { number: version } } });
const dispatches = async () => (await kvs.get("recent-notifications"))?.events || [];

quiet();
try {
  // ---------------------------------------------------------------------------------------------
  // 2. A late event for the requester's own pre-approval version must not demote the page.
  {
    const w = await approvedPage({ enforceMode: "demote" });
    eq("[2] bed: Approved at v2", [await stateOf(), (await logic.readPageWorkflow(PAGE)).approvedVersion], ["approved", 2]);
    await triggers.pageContentTrigger(event(PLAIN, 2)); // the v2 event arrives ~10 min after the approval
    eq("[2] late event for v2 (= approvedVersion): page stays Approved", await stateOf(), "approved");
    eq("[2] late event for v2: no enforcement comment to the requester", w.comments.length, 0);
    eq("[2] late event for v2: no enforcement dispatch", (await dispatches()).filter((d) => String(d.type).startsWith("workflow-")).length, 0);
    await triggers.pageContentTrigger(event(PLAIN, 1)); // an even older one
    eq("[2] late event for v1 (< approvedVersion): page stays Approved", await stateOf(), "approved");
    const r = await triggers.collectWorkflowEnforcementForPage(PAGE, PLAIN, 2, APP);
    eq("[2] probe answers predates-approval (no enforcement) for a version at the baseline", r?.action, "predates-approval");
    const ra = await triggers.collectWorkflowEnforcementForPage(PAGE, APPROVER, 2, APP);
    eq("[2] an approver's late event stays privileged (seal passes unchanged)", ra?.action, "privileged");
    // Control: a REAL post-approval edit by the same non-approver still demotes.
    const v3 = w.edit(PAGE, PLAIN, "changed after approval");
    await triggers.pageContentTrigger(event(PLAIN, v3));
    eq("[2] control: an edit AFTER approval (v3) by a non-approver demotes", await stateOf(), "draft");
  }
  // Revert mode was already protected (Pass 0 compares the live version) — keep it so.
  {
    const w = await approvedPage({ enforceMode: "revert" });
    await triggers.pageContentTrigger(event(PLAIN, 2));
    eq("[2] revert mode: late event for v2 writes nothing", w.live(PAGE).number, 2);
    eq("[2] revert mode: page stays Approved", await stateOf(), "approved");
  }

  // ---------------------------------------------------------------------------------------------
  // 1. Revert mode with NO named approvers: the space admin's direct approval pinned v2, so the
  //    page has a sanctioned baseline — an edit by anyone else is undone, not demoted.
  {
    const w = await approvedPage({ enforceMode: "revert", namedApprovers: false });
    eq("[1] bed: approver snapshot is empty", (await logic.readPageWorkflow(PAGE)).approvers, []);
    const v3 = w.edit(PAGE, PLAIN, "unapproved change");
    await triggers.pageContentTrigger(event(PLAIN, v3));
    const live = w.live(PAGE);
    eq("[1] event: page stays Approved", await stateOf(), "approved");
    eq("[1] event: the app wrote v4", [live.number, live.authorId], [4, APP]);
    eq("[1] event: v4 carries the approved text", JSON.stringify(live.adf).includes("the text that was approved"), true);
    eq("[1] event: baseline advanced to the app's own write", (await logic.readPageWorkflow(PAGE)).approvedVersion, 4);
    const d = (await dispatches()).find((x) => String(x.type).startsWith("workflow-"));
    eq("[1] event: the dispatch says reverted", d?.type, "workflow-reverted");
    // A space admin's own edit stays (privileged), with no approvers named.
    const v5 = w.edit(PAGE, ADMIN, "admin fix");
    await triggers.pageContentTrigger(event(ADMIN, v5));
    eq("[1] event: a space admin's edit is kept", [w.live(PAGE).number, w.live(PAGE).authorId, await stateOf()], [5, ADMIN, "approved"]);
  }
  {
    const w = await approvedPage({ enforceMode: "revert", namedApprovers: false });
    w.edit(PAGE, PLAIN, "unapproved change the event never delivered");
    const res = JSON.parse((await triggers.workflowSweep()).body);
    eq("[1] sweep: reverted, not demoted", [res.reverted, res.demoted], [1, 0]);
    eq("[1] sweep: page stays Approved", await stateOf(), "approved");
    eq("[1] sweep: the app restored the approved text", [w.live(PAGE).authorId, JSON.stringify(w.live(PAGE).adf).includes("the text that was approved")], [APP, true]);
  }
  // Control: named approvers + revert (unchanged behaviour).
  {
    const w = await approvedPage({ enforceMode: "revert", namedApprovers: true });
    const v3 = w.edit(PAGE, PLAIN, "unapproved change");
    await triggers.pageContentTrigger(event(PLAIN, v3));
    eq("[1] control: named approvers + revert reverts", [w.live(PAGE).authorId, await stateOf()], [APP, "approved"]);
  }

  // ---------------------------------------------------------------------------------------------
  // 4. "Protect Sealed Attachments in Page Body" OFF switches workflow enforcement off — the
  //    event path always honoured it; the hourly sweep must too.
  {
    const w = await approvedPage({ enforceMode: "demote", contentProtection: false });
    w.edit(PAGE, PLAIN, "edit while protection is off");
    const res = JSON.parse((await triggers.workflowSweep()).body);
    eq("[4] sweep with protection off: nothing enforced", [res.demoted, res.reverted], [0, 0]);
    eq("[4] sweep with protection off: page stays Approved", await stateOf(), "approved");
    eq("[4] sweep with protection off: no comment", w.comments.length, 0);
  }
  {
    const w = await approvedPage({ enforceMode: "revert", contentProtection: false });
    w.edit(PAGE, PLAIN, "edit while protection is off");
    await triggers.workflowSweep();
    eq("[4] revert mode, protection off: sweep writes nothing", w.live(PAGE).authorId, PLAIN);
  }
  {
    const w = await approvedPage({ enforceMode: "demote", contentProtection: true });
    w.edit(PAGE, PLAIN, "edit with protection on");
    const res = JSON.parse((await triggers.workflowSweep()).body);
    eq("[4] control: protection on, the sweep demotes", [res.demoted, await stateOf()], [1, "draft"]);
  }

  // ---------------------------------------------------------------------------------------------
  // 3. The guard (run when someone views the page) demotes ahead of the late event — and must SAY
  //    so, or the banner keeps showing "Approved v2" until a reload.
  {
    const w = await approvedPage({ enforceMode: "demote" });
    w.edit(PAGE, PLAIN, "edit seen first by the viewer");
    const g = await triggers.guardPageNow(PAGE, "view");
    eq("[3] guard demoted the page", await stateOf(), "draft");
    eq("[3] guard reports the workflow change", g.workflowChanged, true);
    eq("[3] guard wrote nothing to the body (demote mode)", g.restored, false);
    // The banner and a section macro race for the first call: the loser is told too (echo window).
    const again = await triggers.guardPageNow(PAGE, "view");
    eq("[3] a concurrent caller on the same version gets the echo", [again.checked, again.workflowChanged], [false, true]);
    const claim = await kvs.get(`page-guard-${PAGE}`);
    await kvs.set(`page-guard-${PAGE}`, { ...claim, workflowChanged: { at: new Date(Date.now() - 10 * 60 * 1000).toISOString() } });
    const later = await triggers.guardPageNow(PAGE, "view");
    eq("[3] after the echo window a view of the same version reports nothing new", later.workflowChanged ?? false, false);
    eq("[3] the demote was announced once", w.comments.length, 1);
  }
  {
    const w = await approvedPage({ enforceMode: "demote" });
    w.edit(PAGE, APPROVER, "approver's own edit");
    const g = await triggers.guardPageNow(PAGE, "view");
    eq("[3] control: an approver's edit changes no state and reports none", [await stateOf(), g.workflowChanged ?? false], ["approved", false]);
  }

  // ---------------------------------------------------------------------------------------------
  // 5. The approver's banner names the editor (display name looked up when the banner reads it).
  {
    const w = await approvedPage({ enforceMode: "demote" });
    const v3 = w.edit(PAGE, PLAIN, "edit");
    await triggers.pageContentTrigger(event(PLAIN, v3));
    const r = await recentDispatches({ payload: { pageId: PAGE }, context: { accountId: APPROVER } });
    const d = (r.notifications || []).find((x) => x.type === "workflow-demoted");
    ok("[5] the approver's banner gets the demote dispatch", !!d);
    eq("[5] it names the editor", d?.editorDisplayName, "Pat Plain");
    eq("[5] the stored dispatch keeps no name (looked up at read time)", (await dispatches()).find((x) => x.type === "workflow-demoted")?.editorDisplayName, undefined);
  }
  {
    const w = await approvedPage({ enforceMode: "revert" });
    const v3 = w.edit(PAGE, PLAIN, "edit");
    await triggers.pageContentTrigger(event(PLAIN, v3));
    const r = await recentDispatches({ payload: { pageId: PAGE }, context: { accountId: APPROVER } });
    eq("[5] the revert dispatch names the editor too", (r.notifications || []).find((x) => x.type === "workflow-reverted")?.editorDisplayName, "Pat Plain");
    // A reader the page refuses gets nothing, names included.
    w.readers.clear(); w.readers.add(APPROVER);
    const refused = await recentDispatches({ payload: { pageId: PAGE }, context: { accountId: "acct-stranger" } });
    eq("[5] a caller who cannot read the page gets no dispatches", refused.notifications, []);
  }

  // ---------------------------------------------------------------------------------------------
  // 4 (the words): while protection is off, the banner, the page details and the Workflow tab must
  // not promise a revert / move-back the engine will not do.
  {
    await approvedPage({ enforceMode: "revert", contentProtection: false });
    const ctx = { accountId: ADMIN, extension: { content: { id: PAGE } } };
    const wf = await wfActions.get("get-page-workflow")({ payload: { pageId: PAGE }, context: ctx });
    eq("[4w] banner: enforceMode reads off", wf.enforceMode, "off");
    const pd = await pageDetailsSummary({ payload: { pageId: PAGE }, context: ctx });
    eq("[4w] page details: enforceMode reads off", pd?.workflow?.enforceMode, "off");
    const tab = await wfActions.get("get-space-workflow-settings")({ payload: { spaceKey: SPACE }, context: { accountId: ADMIN, extension: { space: { key: SPACE } } } });
    eq("[4w] Workflow tab: protectionOff", tab.protectionOff, true);
    await kvs.set("admin-settings-global", { enableContentProtection: true });
    const wfOn = await wfActions.get("get-page-workflow")({ payload: { pageId: PAGE }, context: ctx });
    eq("[4w] control: protection on → the chosen mode", wfOn.enforceMode, "revert");
    const fzOn = await wfActions.get("workflow-seals-to-freeze")({ payload: { pageId: PAGE }, context: ctx });
    eq("[4w] approval dialog freeze answer: protection on", fzOn.protectionOff, false);
    await kvs.set("admin-settings-global", { enableContentProtection: false });
    const fzOff = await wfActions.get("workflow-seals-to-freeze")({ payload: { pageId: PAGE }, context: ctx });
    eq("[4w] approval dialog freeze answer: protection off", fzOff.protectionOff, true);
  }

  // ---------------------------------------------------------------------------------------------
  // 6. One Draft page open in two tabs. Tab A moves it to In Review: tab B's banner must hear
  // about it, and the move tab B picks from its old Draft chip must name the page's real state.
  {
    resetFake();
    createWorld({ spaceKey: SPACE }).addUser(PLAIN).addPage(PAGE, { versions: [{ authorId: PLAIN }] }).readers.add("*");
    await kvs.set(`workflow-settings-${SPACE}`, { enabled: true, workflowId: "default" });
    await logic.assignPageWorkflow({ pageId: PAGE, spaceKey: SPACE, actorAccountId: PLAIN, workflowId: "default" });
    await new Promise((r) => setTimeout(r, 5)); // the move below stamps a later millisecond
    const move = (fromStateId) => wfActions.get("request-transition")({ payload: { pageId: PAGE, toStateId: "in_review", fromStateId }, context: { accountId: PLAIN } });
    const stamp = async () => (await sealing.get("check-seal-stamp")({ payload: {}, context: { extension: { content: { id: PAGE } } } })).workflowStamp;
    const before = await stamp();
    eq("[6] tab A moves the page from Draft to In Review", (await move("draft")).success, true);
    ok("[6] the stamp the page's open banners poll has changed", (await stamp()) !== before);
    const stale = await move("draft"); // tab B still shows Draft
    eq("[6] tab B's move is refused", stale.success, false);
    eq("[6] tab B is told the page's real state", stale.reason, "This page is already In Review.");
  }

  // ---------------------------------------------------------------------------------------------
  // 7. An Approved page is deleted from the trash for good: the space's Activity report and its
  // CSV export must still name the page for a space admin.
  {
    const world = await approvedPage();
    const report = async (accountId) => (await getSpaceActivity({ payload: { spaceKey: SPACE }, context: { accountId } })).entries;
    world.pages.get(PAGE).spaceId = "7777"; // now in another space: not this space's title to show any more
    eq("[7] a page moved away is not named", [...new Set((await report(ADMIN)).map(pageTitleOf))], [`Page ${PAGE}`]);
    world.pages.delete(PAGE); // purged: Confluence answers 404 from now on
    const entries = await report(ADMIN);
    ok("[7] the report still has the page's history", entries.length > 0);
    eq("[7] every row names the purged page", [...new Set(entries.map(pageTitleOf))], ["Travel policy"]);
    eq("[7] so does the CSV's title column", [...new Set(activityToCsv(entries).split("\r\n").slice(1).map((r) => r.split(",")[4]))], ['"Travel policy"']);
    await kvs.set(`admin-settings-space-${SPACE}`, { adminUsers: [PLAIN] }); // a steward the app names, not a space admin
    eq("[7] that steward sees only the page's id", [...new Set((await report(PLAIN)).map(pageTitleOf))], [`Page ${PAGE}`]);
  }
} finally {
  loud();
}
if (fake.unhandled.length) console.log(`(fake: ${[...new Set(fake.unhandled)].length} unhandled routes answered 404: ${[...new Set(fake.unhandled)].slice(0, 8).join(" | ")})`);
report("workflow-enforcement");
