// "Move it back to an earlier state (keeps their edit)" — the demote enforcement mode — in a custom
// workflow the move cannot be made: (a) there is no transition from the Approved (enforced) state to
// the state the space moves pages back to, or (b) the workflow's first state is itself enforced, so
// "back to the first state" is no move at all. The rule, on the page event AND in the hourly sweep:
//   RUN time   a demote that cannot be made falls back to the revert (the approved / last sanctioned
//              version is restored, the existing revert path), the activity row on the page and space
//              reports says why, and the editor's notice says a space admin should fix the settings.
//   SAVE time  validateDefinition refuses a first state that is also enforced; the settings save, the
//              definition save and the one-Save bundle refuse a demote configuration that cannot run;
//              the Workflow tab shows an already-saved bad configuration.
// Real modules, in-memory Forge fake.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake } = await import("./_forge-fake/state.mjs");
const { createWorld } = await import("./_forge-fake/confluence-world.mjs");
const triggers = await import("../src/server/triggers.js");
const logic = await import("../src/server/capsules/workflow/logic.js");
const { kvs, WhereConditions } = await import("@forge/kvs");
const wfActions = new Map((await import("../src/server/capsules/workflow/actions.js")).actions);
const { formatActivity } = await import("../src/ui/kit/activity-format.js");
const { workflowRuleSentence } = await import("../src/ui/kit/workflow-rule.js");
const { enforceCommentBody } = await import("../src/server/infra/approval-blueprints.js");
// Loaded softly so a missing module reports every assertion instead of one import error.
const sm = await import("../src/server/capsules/workflow/state-machine.js").catch(() => ({}));
const rules = await import("../src/server/capsules/workflow/enforce-rules.js");

const APP = "app-account";
const APPROVER = "acct-approver";
const PLAIN = "acct-plain-editor";
const ADMIN = "acct-space-admin";
const SPACE = "WF";
const PAGE = "801";

const realLog = { info: console.info, warn: console.warn, error: console.error, log: console.log };
const quiet = () => { console.info = () => {}; console.warn = () => {}; console.error = () => {}; };
const loud = () => Object.assign(console, realLog);

// (a) Approved can only go back to review: no Approved -> Draft edge, and Draft is the first state.
const NO_EDGE = {
  id: "default", name: "Review only",
  states: [
    { id: "draft", name: "Draft", color: "neutral", initial: true },
    { id: "in_review", name: "In Review", color: "info" },
    { id: "approved", name: "Approved", color: "success", enforce: true },
  ],
  transitions: [{ from: "draft", to: "in_review" }, { from: "in_review", to: "approved" }, { from: "approved", to: "in_review" }],
};
// (b) The first state is itself enforced (validateDefinition refuses it).
const INITIAL_ENFORCED = {
  id: "default", name: "Starts locked",
  states: [
    { id: "locked", name: "Locked", color: "success", initial: true, enforce: true },
    { id: "draft", name: "Draft", color: "neutral" },
  ],
  transitions: [{ from: "locked", to: "draft" }, { from: "draft", to: "locked" }],
};

const approval = { approvers: [{ type: "user", id: APPROVER, name: "Ana Approver" }], mode: "any", min: 1 };

/** A page Approved (entered `enforceState` at v2) under `def`, in a space whose settings are `settings` — written straight to KVS, as an existing saved configuration would be. */
async function approvedPage(def, settings, { path }) {
  resetFake();
  const w = createWorld({ appAccountId: APP, spaceKey: SPACE });
  w.addUser(APP, { displayName: "Sentinel Vault" }).addUser(APPROVER, { displayName: "Ana Approver" })
    .addUser(PLAIN, { displayName: "Pat Plain" }).addUser(ADMIN, { displayName: "Sam Admin" })
    .addPage(PAGE, { versions: [{ authorId: PLAIN, text: "first draft" }, { authorId: PLAIN, text: "the text that was approved" }] });
  w.readers.add("*");
  w.spaceAdmins.add(ADMIN);
  await kvs.set("app-account-id", APP);
  await kvs.set("admin-settings-global", { enableContentProtection: true, enableEmailDispatches: true, notifyEditorOnRevert: true });
  if (def) await kvs.set(`workflow-def-space-${SPACE}`, def);
  await kvs.set(`workflow-settings-${SPACE}`, { enabled: true, workflowId: "default", approval, ...settings });
  await logic.assignPageWorkflow({ pageId: PAGE, spaceKey: SPACE, actorAccountId: PLAIN, actorName: "Pat Plain", workflowId: "default" });
  for (const to of path.slice(0, -1)) {
    const r = await logic.transitionPageWorkflow({ pageId: PAGE, spaceKey: SPACE, toStateId: to, actorAccountId: ADMIN, actorName: "Sam Admin" });
    if (!r.success) throw new Error(`bed: move to ${to} failed: ${r.reason}`);
  }
  const appr = await logic.transitionPageWorkflow({
    pageId: PAGE, spaceKey: SPACE, toStateId: path[path.length - 1], actorAccountId: APPROVER, actorName: "Ana Approver",
    approvers: [APPROVER], approvedVersion: 2,
    approvalRecord: { outcome: "approved", completedBy: APPROVER, completedByName: "Ana Approver", requestedBy: PLAIN, pinnedVersion: 2, decisions: [{ accountId: APPROVER, name: "Ana Approver", decision: "approved" }] },
  });
  if (!appr.success) throw new Error(`bed: approve failed: ${appr.reason}`);
  if (!(await logic.readPageWorkflow(PAGE))?.enforce) throw new Error("bed: the page is not enforced");
  await kvs.delete("recent-notifications");
  w.comments.length = 0;
  return w;
}
const event = (actor, version) => ({ eventType: "avi:confluence:updated:page", atlassianId: actor, content: { id: PAGE, version: { number: version } }, space: { key: SPACE } });
const liveText = (w) => JSON.stringify(w.live(PAGE).adf);
const enforcedRows = async () => {
  const { results } = await kvs.query().where("key", WhereConditions.beginsWith(`activity-page-${PAGE}-`)).limit(100).getMany().catch(() => ({ results: [] }));
  return (results || []).map((r) => r.value).filter((v) => v?.type === "workflow.enforced");
};
const spaceRows = async () => {
  const { results } = await kvs.query().where("key", WhereConditions.beginsWith(`activity-space-${SPACE}-`)).limit(100).getMany().catch(() => ({ results: [] }));
  return (results || []).map((r) => r.value).filter((v) => v?.type === "workflow.enforced");
};
const commentsText = (w) => w.comments.map((c) => JSON.stringify(c.body || "")).join("\n");
const adminCtx = { accountId: ADMIN, extension: { space: { key: SPACE } } };

/** The run-time outcome every unsafe configuration must reach: reverted, recorded, told. */
async function expectRevertFallback(tag, w, editedVersion, stateId) {
  eq(`${tag} the unapproved edit does not stand: the app wrote the approved text back`, [w.live(PAGE).authorId, /the text that was approved/.test(liveText(w))], [APP, true]);
  eq(`${tag} …as a new version after the edit`, w.live(PAGE).number, editedVersion + 1);
  const rec = await logic.readPageWorkflow(PAGE);
  eq(`${tag} the page keeps its approved state and stays enforced`, [rec?.stateId, rec?.enforce], [stateId, true]);
  const rows = await enforcedRows();
  eq(`${tag} one workflow.enforced row, mode revert`, rows.map((r) => r.details?.mode), ["revert"]);
  ok(`${tag} the row says the move back could not be made (demoteFallback)`, !!rows[0]?.details?.demoteFallback);
  ok(`${tag} the row reaches the space report the space admins read`, (await spaceRows()).length === 1);
  const f = rows[0] ? formatActivity(rows[0]) : {};
  ok(`${tag} the row's sentence says it was restored because moving back is not possible`, /restored/.test(f.sentence || "") && /could not be moved back/i.test(`${f.sentence || ""} ${f.detail || ""}`));
  const ct = commentsText(w);
  ok(`${tag} the editor is told the change was reverted`, /reverted/.test(ct));
  ok(`${tag} …and that a space admin should fix the Workflow settings`, /space admin/.test(ct) && /Workflow settings/.test(ct));
}

quiet();
try {
  // 0. Positive control: the built-in workflow in demote mode still demotes and keeps the edit.
  {
    const w = await approvedPage(null, { enforceMode: "demote", demoteTo: "initial" }, { path: ["in_review", "approved"] });
    const v3 = w.edit(PAGE, PLAIN, "unapproved change");
    await triggers.pageContentTrigger(event(PLAIN, v3));
    const rec = await logic.readPageWorkflow(PAGE);
    eq("[0] control: built-in workflow demotes to Draft", [rec?.stateId, rec?.enforce], ["draft", false]);
    eq("[0] control: the editor's change stays on the page", [w.live(PAGE).number, /unapproved change/.test(liveText(w))], [3, true]);
    eq("[0] control: one demote row", (await enforcedRows()).map((r) => r.details?.mode), ["demote"]);
  }

  // 1. (a) event path: no Approved -> Draft edge, demote to "the first state".
  {
    const w = await approvedPage(NO_EDGE, { enforceMode: "demote", demoteTo: "initial" }, { path: ["in_review", "approved"] });
    const v3 = w.edit(PAGE, PLAIN, "unapproved change");
    const run = await triggers.pageContentTrigger(event(PLAIN, v3));
    await expectRevertFallback("[1 event, no edge]", w, v3, "approved");
    eq("[1] the pipeline reports a revert, not a demote", [run?.workflowAction, run?.demoted], ["revert", false]);
    // The next event (the app's own write) is a no-op: no ping-pong.
    const before = w.live(PAGE).number;
    await triggers.pageContentTrigger(event(APP, before));
    eq("[1] the app's own write is not judged again", w.live(PAGE).number, before);
  }

  // 2. (b) event path: the first state is itself enforced.
  {
    const w = await approvedPage(INITIAL_ENFORCED, { enforceMode: "demote", demoteTo: "initial" }, { path: ["draft", "locked"] });
    const v3 = w.edit(PAGE, PLAIN, "unapproved change");
    await triggers.pageContentTrigger(event(PLAIN, v3));
    await expectRevertFallback("[2 event, initial enforced]", w, v3, "locked");
  }

  // 3. (a) hourly sweep: the event was dropped.
  {
    const w = await approvedPage(NO_EDGE, { enforceMode: "demote", demoteTo: "initial" }, { path: ["in_review", "approved"] });
    const v3 = w.edit(PAGE, PLAIN, "unapproved change"); // no event
    const out = JSON.parse((await triggers.workflowSweep())?.body || "{}");
    await expectRevertFallback("[3 sweep, no edge]", w, v3, "approved");
    eq("[3] the sweep counts a revert, not a demote", [out.reverted, out.demoted], [1, 0]);
    // A second sweep finds nothing to do.
    w.comments.length = 0;
    await triggers.workflowSweep();
    eq("[3] a second sweep writes nothing and posts nothing", [w.live(PAGE).number, w.comments.length], [v3 + 1, 0]);
  }

  // 4. (b) hourly sweep: initial enforced.
  {
    const w = await approvedPage(INITIAL_ENFORCED, { enforceMode: "demote", demoteTo: "initial" }, { path: ["draft", "locked"] });
    const v3 = w.edit(PAGE, PLAIN, "unapproved change");
    await triggers.workflowSweep();
    await expectRevertFallback("[4 sweep, initial enforced]", w, v3, "locked");
  }

  // 5. A custom demote target whose edge was removed after the setting was saved, AND the first state
  //    unreachable too: the fallback chain ends at the revert, not at a no-op.
  {
    const w = await approvedPage(NO_EDGE, { enforceMode: "demote", demoteTo: "ghost_state" }, { path: ["in_review", "approved"] });
    const v3 = w.edit(PAGE, PLAIN, "unapproved change");
    await triggers.pageContentTrigger(event(PLAIN, v3));
    await expectRevertFallback("[5 event, vanished target]", w, v3, "approved");
  }

  // 6. The words follow the engine: the ribbon and the Workflow tab say "revert" for a configuration
  //    that cannot move pages back, and the tab names the problem.
  {
    await approvedPage(NO_EDGE, { enforceMode: "demote", demoteTo: "initial" }, { path: ["in_review", "approved"] });
    const wf = await wfActions.get("get-page-workflow")({ payload: { pageId: PAGE }, context: { accountId: PLAIN, extension: { content: { id: PAGE, space: { key: SPACE } } } } });
    eq("[6] the ribbon's enforce mode is what the engine does: revert", wf?.enforceMode, "revert");
    const tab = await wfActions.get("get-space-workflow-settings")({ payload: { spaceKey: SPACE }, context: adminCtx });
    ok("[6] the Workflow tab carries the problem for the saved configuration", typeof tab?.demoteProblem === "string" && /Draft/.test(tab.demoteProblem));
    const sentence = workflowRuleSentence(tab?.settings || {}, tab?.def || null, { demoteProblem: tab?.demoteProblem || null });
    ok("[6] the rule sentence says the edit is undone, not moved back", /undone/.test(sentence) && !/moves the page back/.test(sentence));
  }

  // 7. SAVE time.
  {
    await approvedPage(null, {}, { path: ["in_review", "approved"] });
    const v = logic.validateDefinition(INITIAL_ENFORCED);
    ok("[7] validateDefinition refuses a first state that is also enforced", !v.ok && /first state/i.test(v.reason || ""));
    ok("[7] validateDefinition still accepts the built-in workflow", logic.validateDefinition(logic.DEFAULT_WORKFLOW).ok);
    // The space's default definition has no Approved -> Draft edge (an existing save).
    await kvs.set(`workflow-def-space-${SPACE}`, NO_EDGE);
    // From revert: the save MAKES the demote configuration (one left untouched is case 11).
    await kvs.set(`workflow-settings-${SPACE}`, { enabled: true, enforceMode: "revert" });
    const s1 = await logic.setSpaceWorkflowSettings(SPACE, { enabled: true, enforceMode: "demote", demoteTo: "initial" });
    ok("[7] settings: demote to the first state with no edge to it is refused", s1.success === false && /Draft/.test(s1.reason || "") && /transition/i.test(s1.reason || ""));
    const s2 = await logic.setSpaceWorkflowSettings(SPACE, { enabled: true, enforceMode: "demote", demoteTo: "in_review" });
    ok("[7] settings: demote to a reachable state is accepted", s2.success === true);
    const s3 = await logic.setSpaceWorkflowSettings(SPACE, { enabled: true, enforceMode: "revert", demoteTo: "initial" });
    ok("[7] settings: revert mode does not depend on the edge", s3.success === true);
    // A label-scoped workflow follows the same space settings: refused when IT cannot move pages back.
    await kvs.set(`workflow-def-space-${SPACE}`, logic.DEFAULT_WORKFLOW);
    await kvs.set(`workflow-def-space-${SPACE}-fast`, { ...NO_EDGE, id: "fast", name: "Fast track" });
    await kvs.set(`workflow-settings-${SPACE}`, { enabled: true, enforceMode: "revert", labelWorkflows: [{ workflowId: "fast", name: "Fast track", labels: ["fast"], priority: 1 }] });
    const s4 = await logic.setSpaceWorkflowSettings(SPACE, { enabled: true, enforceMode: "demote", demoteTo: "initial" });
    ok("[7] settings: a label workflow that cannot move pages back is refused too, and named", s4.success === false && /Fast track/.test(s4.reason || ""));
    await kvs.delete(`workflow-def-space-${SPACE}-fast`);
    await kvs.set(`workflow-settings-${SPACE}`, { enabled: true, enforceMode: "demote", demoteTo: "initial" });
    // Definition save in a demote-mode space.
    const d1 = await logic.storeSpaceWorkflow(SPACE, { workflowId: "default", def: NO_EDGE });
    ok("[7] definition: a demote-mode space cannot save a workflow with no way back", d1.success === false && /Draft/.test(d1.reason || ""));
    eq("[7] …and the stored definition is unchanged", (await kvs.get(`workflow-def-space-${SPACE}`))?.name, "Document Approval");
    const d2 = await logic.storeSpaceWorkflow(SPACE, { workflowId: "default", def: INITIAL_ENFORCED });
    ok("[7] definition: an enforced first state is refused", d2.success === false && /first state/i.test(d2.reason || ""));
    // The one-Save bundle: the same definition WITH revert settings is coherent and saves.
    const b1 = await wfActions.get("save-workflow-bundle")({ payload: { spaceKey: SPACE, def: NO_EDGE, settings: { enabled: true, enforceMode: "revert", demoteTo: "initial", approval } }, context: adminCtx });
    ok("[7] bundle: no-way-back definition + revert settings saves", b1?.success === true);
    const b2 = await wfActions.get("save-workflow-bundle")({ payload: { spaceKey: SPACE, def: NO_EDGE, settings: { enabled: true, enforceMode: "demote", demoteTo: "initial", approval } }, context: adminCtx });
    ok("[7] bundle: the same definition + demote settings is refused with the reason", b2?.success === false && /Draft/.test(b2?.reason || ""));
    eq("[7] …and the settings stay revert", (await kvs.get(`workflow-settings-${SPACE}`))?.enforceMode, "revert");
    // The resolver behind the bare definition store validates too.
    const r1 = await wfActions.get("store-workflow-config")({ payload: { scope: "space", key: SPACE, def: INITIAL_ENFORCED }, context: adminCtx });
    ok("[7] store-workflow-config refuses an enforced first state", r1?.success === false);
  }

  // 9. Review 2026-10-21 #1: the page's state is gone from the definition (a definition written past
  //    the "state still has pages" check, or a backup). It was enforced: it is judged as enforced and
  //    reverted — on the event path and in the sweep, in demote and in revert mode.
  for (const mode of ["demote", "revert"]) {
    for (const via of ["event", "sweep"]) {
      const w = await approvedPage(null, { enforceMode: mode, demoteTo: "initial" }, { path: ["in_review", "approved"] });
      await kvs.set(`workflow-def-space-${SPACE}`, { id: "default", name: "Renamed", states: [{ id: "draft", name: "Draft", initial: true }, { id: "signed_off", name: "Signed off", enforce: true }], transitions: [{ from: "draft", to: "signed_off" }, { from: "signed_off", to: "draft" }] });
      const v3 = w.edit(PAGE, PLAIN, "unapproved change");
      if (via === "event") await triggers.pageContentTrigger(event(PLAIN, v3)); else await triggers.workflowSweep();
      eq(`[9 ${mode}/${via}] a page whose state vanished from the definition is still restored`, [w.live(PAGE).authorId, /the text that was approved/.test(liveText(w))], [APP, true]);
    }
  }
  // …and the bare definition door now runs the editor's checks, the page count included.
  {
    await approvedPage(null, { enforceMode: "revert" }, { path: ["in_review", "approved"] });
    const r = await wfActions.get("store-workflow-config")({ payload: { scope: "space", key: SPACE, def: { id: "default", name: "No approved", states: [{ id: "draft", name: "Draft", initial: true }, { id: "done", name: "Done", enforce: true }], transitions: [{ from: "draft", to: "done" }] } }, context: adminCtx });
    ok("[9] store-workflow-config refuses removing a state that still holds pages", r?.success === false && /still has/.test(r?.reason || ""));
  }

  // 10. Review #2: a config import that switches the space to revert AND carries a workflow with no
  //     way back is judged against its own settings (workflows are applied before workflowSettings).
  {
    await approvedPage(null, {}, { path: ["in_review", "approved"] });
    await kvs.delete(`workflow-settings-${SPACE}`); // a fresh space: defaults mean demote
    const { planBundle } = await import("../src/server/capsules/config-api/bundle.js");
    const plan = planBundle({ spaces: { [SPACE]: { workflows: [{ workflowId: "default", def: NO_EDGE }], workflowSettings: { enforceMode: "revert" } } } });
    const wfStep = plan.find((st) => st.resolverKey === "store-space-workflow");
    eq("[10] the import's workflow step carries the bundle's settings", wfStep?.payload?.settings?.enforceMode, "revert");
    const r = await wfActions.get("store-space-workflow")({ payload: wfStep.payload, context: adminCtx });
    ok("[10] …and the definition is accepted (revert needs no way back)", r?.success === true);
    const r2 = await wfActions.get("store-space-workflow")({ payload: { ...wfStep.payload, settings: undefined }, context: adminCtx });
    ok("[10] without the settings (demote by default) the same definition is refused", r2?.success === false);
  }

  // 11. Review #3: a bad configuration saved BEFORE the check does not block unrelated saves; it is
  //     saved with a warning. Changing the mode or the target into a bad configuration is refused.
  {
    await approvedPage(NO_EDGE, { enforceMode: "demote", demoteTo: "initial" }, { path: ["in_review", "approved"] });
    const off = await logic.setSpaceWorkflowSettings(SPACE, { enabled: false, enforceMode: "demote", demoteTo: "initial", approval });
    ok("[11] turning the workflow off on a stored bad configuration is saved", off.success === true);
    ok("[11] …with the problem said", /reverted, not moved back/.test(off.warning || ""));
    await kvs.set(`workflow-settings-${SPACE}`, { enabled: true, enforceMode: "revert" });
    const sw = await logic.setSpaceWorkflowSettings(SPACE, { enabled: true, enforceMode: "demote", demoteTo: "initial" });
    ok("[11] switching revert -> demote into a configuration that cannot run is refused", sw.success === false);
  }

  // 12. Review #4: the space moves pages back to In Review; a definition save that drops the
  //     Approved -> In Review edge (keeping Approved -> Draft) used to pass, the engine then quietly
  //     sent pages to Draft and the tab still said In Review.
  {
    await approvedPage(null, { enforceMode: "demote", demoteTo: "in_review" }, { path: ["in_review", "approved"] });
    const dropped = { ...logic.DEFAULT_WORKFLOW, transitions: logic.DEFAULT_WORKFLOW.transitions.filter((t) => !(t.from === "approved" && t.to === "in_review")) };
    const r = await logic.storeSpaceWorkflow(SPACE, { workflowId: "default", def: dropped });
    ok("[12] a definition that drops the edge to the chosen state is refused, naming it", r.success === false && /In Review/.test(r.reason || ""));
    const sentence = workflowRuleSentence({ enabled: true, enforceMode: "demote", demoteTo: "in_review", approval }, dropped);
    ok("[12] the rule sentence names where the engine really sends the page (Draft)", /moves the page back to Draft/.test(sentence));
  }

  // 8. The shared pure rule (one home for the engine, the save paths and the UI).
  {
    ok("[8] planDemote exists", typeof sm.planDemote === "function");
    if (typeof sm.planDemote === "function") {
      eq("[8] built-in: approved -> draft", sm.planDemote(logic.DEFAULT_WORKFLOW, { demoteTo: "initial" }, "approved").target?.id, "draft");
      const a = sm.planDemote(NO_EDGE, { demoteTo: "initial" }, "approved");
      eq("[8] no edge: refused with code", [a.ok, a.code], [false, "no-transition"]);
      const b = sm.planDemote(INITIAL_ENFORCED, { demoteTo: "initial" }, "locked");
      eq("[8] enforced first state: refused with code", [b.ok, b.code], [false, "approved-target"]);
      eq("[8] enforcementPlan: demote mode that cannot run is a revert with the reason", rules.enforcementPlan?.({ enforceMode: "demote" }, { def: NO_EDGE, stateId: "approved" })?.mode, "revert");
      eq("[8] enforceModeOf with the definition says revert", rules.enforceModeOf({ enforceMode: "demote" }, { def: NO_EDGE, stateId: "approved" }), "revert");
      eq("[8] enforceModeOf without a definition keeps the chosen mode (callers that cannot know)", rules.enforceModeOf({ enforceMode: "demote" }), "demote");
    }
    const body = enforceCommentBody(PAGE, PLAIN, "revert", { approvedVersion: 2, reviewedVersion: 2, revertedVersion: 3, demoteFallback: true });
    ok("[8] the revert notice with demoteFallback names the fix", /Workflow settings/.test(body));
  }
} finally { loud(); }
report("workflow-demote-fallback");
