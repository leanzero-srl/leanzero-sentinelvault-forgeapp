// An open page banner re-reads the page when the page's banner stamp moves (doc-ribbon polls
// check-seal-stamp). Every alert recorded for a page moves that stamp AFTER the alert is stored, so
// a banner that re-read the page on an earlier stamp change (the workflow moving back to Draft,
// written before the alert) reads it again and shows the alert. Real modules, in-memory Forge fake.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake } = await import("./_forge-fake/state.mjs");
const { createWorld } = await import("./_forge-fake/confluence-world.mjs");
const triggers = await import("../src/server/triggers.js");
const logic = await import("../src/server/capsules/workflow/logic.js");
const { recordDispatch } = await import("../src/server/capsules/bulletins/logic.js");
const sealing = new Map((await import("../src/server/capsules/sealing/actions.js")).actions);
const { kvs } = await import("@forge/kvs");
console.warn = () => {}; console.error = () => {}; console.info = () => {};
console.log = ((log) => (...a) => { if (String(a[0] || "").match(/passed|FAIL/)) log(...a); })(console.log);

const APP = "app-account", APPROVER = "acct-approver", PLAIN = "acct-plain", SPACE = "WF", PAGE = "801";
const STAMP = `protections-last-workflow-${PAGE}`;

// Every KVS write in order, so "the stamp moved after the alert was stored" is an ordering fact.
const writes = [];
const realSet = kvs.set.bind(kvs);
kvs.set = async (key, value, ...rest) => { writes.push(key); return realSet(key, value, ...rest); };
const lastIndex = (key) => writes.lastIndexOf(key);

// 1. Any alert recorded for a page moves that page's banner stamp, after the alert is stored.
resetFake(); writes.length = 0;
await kvs.set("admin-settings-global", { enableDocRibbons: true, enableFlashMessages: true });
await recordDispatch({ type: "edit-reverted", pageId: PAGE, ownerAccountId: APPROVER, editorAccountId: PLAIN });
ok("an alert for a page moves the page's banner stamp", lastIndex(STAMP) >= 0);
ok("…after the alert is stored", lastIndex(STAMP) > lastIndex("recent-notifications"));
const { workflowStamp } = await sealing.get("check-seal-stamp")({ payload: { pageId: PAGE }, context: { accountId: APPROVER, extension: { content: { id: PAGE } } } });
ok("check-seal-stamp reports the moved stamp", Number(workflowStamp) > 0);
// An alert without a page moves no page stamp.
writes.length = 0;
await recordDispatch({ type: "reservation-expired", ownerAccountId: APPROVER });
eq("an alert without a page moves no page stamp", writes.filter((k) => String(k).startsWith("protections-last-workflow-")).length, 0);

// 2. The flow: an edit demotes an Approved page. The state is written (the stamp moves), then the
// alert; the stamp moves again after the alert, so an open banner reads the alert.
resetFake(); writes.length = 0;
const w = createWorld({ appAccountId: APP, spaceKey: SPACE });
w.addUser(APP, { displayName: "Sentinel Vault" }).addUser(APPROVER, { displayName: "Ana Approver" }).addUser(PLAIN, { displayName: "Pat Plain" })
  .addPage(PAGE, { versions: [{ authorId: APPROVER, text: "approved text" }] });
w.readers.add("*");
await kvs.set("app-account-id", APP);
await kvs.set("admin-settings-global", { enableContentProtection: true, enableDocRibbons: true, enableFlashMessages: true });
await kvs.set(`workflow-settings-${SPACE}`, { enabled: true, workflowId: "default", enforceMode: "demote", approval: { approvers: [{ type: "user", id: APPROVER, name: "Ana Approver" }], mode: "any", min: 1 } });
await logic.assignPageWorkflow({ pageId: PAGE, spaceKey: SPACE, actorAccountId: APPROVER, actorName: "Ana", workflowId: "default" });
await logic.transitionPageWorkflow({ pageId: PAGE, spaceKey: SPACE, toStateId: "in_review", actorAccountId: PLAIN, actorName: "Pat" });
await logic.transitionPageWorkflow({ pageId: PAGE, spaceKey: SPACE, toStateId: "approved", actorAccountId: APPROVER, actorName: "Ana Approver", approvers: [APPROVER], approvedVersion: 1 });
writes.length = 0;
const v2 = w.edit(PAGE, PLAIN, "unapproved");
const run = await triggers.pageContentTrigger({ eventType: "avi:confluence:updated:page", atlassianId: PLAIN, content: { id: PAGE, version: { number: v2 } }, space: { key: SPACE } });
eq("the edit demotes the page", [run?.demoted, (await logic.readPageWorkflow(PAGE))?.stateId], [true, "draft"]);
const alert = ((await kvs.get("recent-notifications"))?.events || []).find((e) => e.type === "workflow-demoted" && e.pageId === PAGE);
ok("the approver's alert is stored", alert?.ownerAccountId === APPROVER);
ok("the banner stamp moves after the alert is stored (a banner that re-read on the state change reads again)", lastIndex(STAMP) > lastIndex("recent-notifications"));

report("banner-alert-refresh");
