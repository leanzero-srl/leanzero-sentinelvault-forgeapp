// What an Approved page's record says after Sentinel Vault reverts an unapproved edit (2026-10-18,
// content pilot B2). Two numbers, two meanings:
//   reviewedVersion  the version the approvers approved (v2 here; the TRUTH for "who approved what")
//   baselineVersion  record.approvedVersion, the ENFORCEMENT baseline: after a revert it moves to the
//                    app's own write (v4), or that write's version event would look like a new edit.
// Before this, every surface that showed the moved baseline said "Approved content was last updated
// by an approver or space admin in v4" — for a change the app made — and the second revert's activity
// row, comment and banner pill said "restored the approved version (v4)". Each surface now names both
// values and never credits an approver with the app's own revert. Real modules, in-memory fake.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";
import { fileURLToPath } from "node:url"; // a path, not a %20-encoded URL: the checkout path has a space

const { resetFake, onConfluence } = await import("./_forge-fake/state.mjs");
const { createWorld } = await import("./_forge-fake/confluence-world.mjs");
const triggers = await import("../src/server/triggers.js");
const logic = await import("../src/server/capsules/workflow/logic.js");
const { kvs, WhereConditions } = await import("@forge/kvs");
const wfActions = new Map((await import("../src/server/capsules/workflow/actions.js")).actions);
const { pageDetailsSummary } = await import("../src/server/capsules/page-details/actions.js");
const { formatActivity } = await import("../src/ui/kit/activity-format.js");
const { classifyMyApprovalRequest } = await import("../src/server/capsules/workflow/my-requests.js");
// Missing before the fix: the red run reports every assertion instead of one import error.
const { describeBaseline } = await import("../src/server/capsules/workflow/baseline.js").catch(() => ({ describeBaseline: () => ({}) }));

const APP = "app-account";
const APPROVER = "acct-approver";
const PLAIN = "acct-plain-editor";
const SPACE = "WF";
const PAGE = "701";
const APPROVER_CLAIM = /approver or space admin/;

const realLog = { info: console.info, warn: console.warn, error: console.error, log: console.log };
const quiet = () => { console.info = () => {}; console.warn = () => {}; console.error = () => {}; };
const loud = () => Object.assign(console, realLog);

async function approvedPage() {
  resetFake();
  const w = createWorld({ appAccountId: APP, spaceKey: SPACE });
  w.addUser(APP, { displayName: "Sentinel Vault" }).addUser(APPROVER, { displayName: "Ana Approver" }).addUser(PLAIN, { displayName: "Pat Plain" })
    .addPage(PAGE, { versions: [{ authorId: PLAIN, text: "first draft" }, { authorId: PLAIN, text: "the text that was approved" }] });
  w.readers.add("*");
  await kvs.set("app-account-id", APP);
  await kvs.set("admin-settings-global", { enableContentProtection: true, enableEmailDispatches: true, notifyEditorOnRevert: true });
  await kvs.set(`workflow-settings-${SPACE}`, {
    enabled: true, workflowId: "default", enforceMode: "revert",
    approval: { approvers: [{ type: "user", id: APPROVER, name: "Ana Approver" }], mode: "any", min: 1 },
  });
  await logic.assignPageWorkflow({ pageId: PAGE, spaceKey: SPACE, actorAccountId: PLAIN, actorName: "Pat Plain", workflowId: "default" });
  await logic.transitionPageWorkflow({ pageId: PAGE, spaceKey: SPACE, toStateId: "in_review", actorAccountId: PLAIN, actorName: "Pat Plain" });
  const appr = await logic.transitionPageWorkflow({
    pageId: PAGE, spaceKey: SPACE, toStateId: "approved", actorAccountId: APPROVER, actorName: "Ana Approver",
    approvers: [APPROVER], approvedVersion: 2,
    approvalRecord: { outcome: "approved", completedBy: APPROVER, completedByName: "Ana Approver", requestedBy: PLAIN, pinnedVersion: 2, decisions: [{ accountId: APPROVER, name: "Ana Approver", decision: "approved" }] },
  });
  if (!appr.success) throw new Error(`approve failed: ${appr.reason}`);
  await kvs.delete("recent-notifications");
  w.comments.length = 0;
  return w;
}
const event = (actor, version) => ({ eventType: "avi:confluence:updated:page", atlassianId: actor, content: { id: PAGE, version: { number: version } } });
const ctx = (accountId) => ({ accountId, extension: { content: { id: PAGE, space: { key: SPACE } } } });
const getWf = (accountId = PLAIN) => wfActions.get("get-page-workflow")({ payload: { pageId: PAGE }, context: ctx(accountId) });
const details = async (accountId = PLAIN) => (await pageDetailsSummary({ payload: { pageId: PAGE }, context: ctx(accountId) }))?.workflow;
const enforcedRows = async () => {
  const { results } = await kvs.query().where("key", WhereConditions.beginsWith(`activity-page-${PAGE}-`)).limit(100).getMany().catch(() => ({ results: [] }));
  return (results || []).map((r) => r.value).filter((v) => v?.type === "workflow.enforced").sort((a, b) => (a.version || 0) - (b.version || 0));
};
const commentsText = (w) => w.comments.map((c) => JSON.stringify(c.body || "")).join("\n");
const lastDispatch = async () => ((await kvs.get("recent-notifications"))?.events || []).filter((d) => d.type === "workflow-reverted")[0]; // newest first

quiet();
try {
  // 1. An unapproved edit is reverted: the baseline moves to the app's write, the approval stays v2.
  {
    const w = await approvedPage();
    const v3 = w.edit(PAGE, PLAIN, "unapproved change");
    await triggers.pageContentTrigger(event(PLAIN, v3));
    eq("[1] bed: the app wrote v4 with the approved text", [w.live(PAGE).number, w.live(PAGE).authorId], [4, APP]);
    eq("[1] the enforcement baseline moved to the app's write (unchanged rule)", (await logic.readPageWorkflow(PAGE)).approvedVersion, 4);
    const wf = await getWf();
    eq("[1] get-page-workflow names both values", [wf?.baseline?.reviewedVersion, wf?.baseline?.baselineVersion], [2, 4]);
    eq("[1] get-page-workflow: the baseline is a restored copy of approved v2", [wf?.baseline?.kind, wf?.baseline?.contentOf], ["restored", 2]);
    ok("[1] the banner's sentence says it is the app's restored copy of approved v2", /v4 is a copy of approved v2 that Sentinel Vault restored/.test(wf?.baseline?.sentence || ""));
    ok("[1] the banner's sentence never credits an approver", !APPROVER_CLAIM.test(wf?.baseline?.sentence || "x approver or space admin"));
    const d = await details();
    ok("[1] the details modal's line: v4 is the restored copy of v2", /v4.*restored copy of v2/.test(d?.baseline?.short || ""));
    ok("[1] the details modal never credits an approver", !APPROVER_CLAIM.test(d?.baseline?.short || "x approver or space admin"));
    const prop = w.prop(PAGE, "sentinel-vault-workflow");
    eq("[1] content property (REST): reviewedVersion 2, baselineVersion 4, restored copy of v2", [prop?.reviewedVersion, prop?.baselineVersion, prop?.baselineKind, prop?.baselineContentOf], [2, 4, "restored", 2]);
    const rows = await enforcedRows();
    ok("[1] the activity row says the approved version v2 was restored", rows.length === 1 && /restored the approved version \(v2\)/.test(formatActivity(rows[0]).sentence || ""));

    // 2. A second unapproved edit: the app restores the copy (v4) — the approved content is still v2.
    w.comments.length = 0;
    const v5 = w.edit(PAGE, PLAIN, "second unapproved change");
    await triggers.pageContentTrigger(event(PLAIN, v5));
    eq("[2] bed: the app wrote v6", [w.live(PAGE).number, w.live(PAGE).authorId], [6, APP]);
    const wf2 = await getWf();
    eq("[2] after a second revert the approved content is still v2 (baseline v6)", [wf2?.baseline?.reviewedVersion, wf2?.baseline?.baselineVersion, wf2?.baseline?.contentOf], [2, 6, 2]);
    const rows2 = await enforcedRows();
    ok("[2] the second activity row says v2, not v4", rows2.length === 2 && /\(v2\)/.test(formatActivity(rows2[1]).sentence || "") && !/\(v4\)/.test(formatActivity(rows2[1]).sentence || ""));
    const ct = commentsText(w);
    ok("[2] the editor's comment names approved v2, not the copy v4", /approved version \(v2\)/.test(ct) && !/approved version \(v4\)/.test(ct));
    eq("[2] the banner pill (dispatch) names approved v2", (await lastDispatch())?.approvedVersion, 2);
    // My work, the requester's row: the version that was approved.
    const mine = classifyMyApprovalRequest({ row: { pageId: PAGE, requesterAccountId: PLAIN, requestedAt: new Date(Date.now() - 60000).toISOString() }, pending: null, record: await logic.readPageWorkflow(PAGE), lastDecision: null });
    eq("[2] My work: the approved row names v2", [mine.status, mine.approvedVersion], ["approved", 2]);
  }

  // 3. An approver's own edit moves the baseline and IS credited to an approver; a revert after it
  //    restores that edit and says so.
  {
    const w = await approvedPage();
    const v3 = w.edit(PAGE, APPROVER, "approver fix");
    await triggers.pageContentTrigger(event(APPROVER, v3));
    const wf = await getWf();
    eq("[3] an approver's edit: baseline v3, kind edit", [wf?.baseline?.baselineVersion, wf?.baseline?.kind], [3, "edit"]);
    ok("[3] an approver's edit is credited to an approver or space admin", /updated by an approver or space admin in v3/.test(wf?.baseline?.sentence || ""));
    const v4 = w.edit(PAGE, PLAIN, "unapproved change");
    await triggers.pageContentTrigger(event(PLAIN, v4));
    const wf2 = await getWf();
    eq("[3] the revert restores the approver's v3", [wf2?.baseline?.baselineVersion, wf2?.baseline?.kind, wf2?.baseline?.contentOf], [5, "restored", 3]);
    ok("[3] sentence: v5 is a copy of v3, which an approver or space admin saved", /v5 is a copy of v3 that Sentinel Vault restored.*v3 was saved by an approver or space admin/.test(wf2?.baseline?.sentence || ""));
    // Review 2026-10-18 #1: the editor's comment and the banner pill called v3 "the approved version".
    const ct = commentsText(w);
    ok("[3] the editor's comment: v3, the last version kept after approval v2", /reverted to v3, the last version kept after approval v2/.test(ct) && !/approved version \(v3\)/.test(ct));
    const d = await lastDispatch();
    eq("[3] the banner pill carries both: restored v3, approved v2", [d?.approvedVersion, d?.reviewedVersion], [3, 2]);
  }
  // 9. Review #2: the sweep finds an app-authored version with the baseline's content (a re-save) — the
  //    baseline moves to it and still says whose content it holds.
  {
    const w = await approvedPage();
    const v3 = w.edit(PAGE, PLAIN, "unapproved change");
    await triggers.pageContentTrigger(event(PLAIN, v3)); // v4 = copy of approved v2
    const p = w.pages.get(PAGE);
    p.versions.push({ number: 5, authorId: APP, adf: JSON.parse(JSON.stringify(w.live(PAGE).adf)) }); // the app re-saves the same body
    await triggers.workflowSweep();
    const wf = await getWf();
    eq("[9] sweep: the app's same-content v5 keeps the history", [wf?.baseline?.baselineVersion, wf?.baseline?.kind, wf?.baseline?.contentOf], [5, "unchanged", 2]);
  }

  // 4. The hourly sweep's revert records the same truth.
  {
    const w = await approvedPage();
    w.edit(PAGE, PLAIN, "an edit the event never delivered");
    await triggers.workflowSweep();
    const wf = await getWf();
    eq("[4] sweep revert: restored copy of approved v2", [wf?.baseline?.reviewedVersion, wf?.baseline?.baselineVersion, wf?.baseline?.kind, wf?.baseline?.contentOf], [2, 4, "restored", 2]);
  }
  // 6. An approval recorded without an approval record (a space admin's direct move, or an older
  //    path): the version it entered Approved at is still the reviewed one after a revert.
  {
    const w = await approvedPage();
    const rec = await logic.readPageWorkflow(PAGE);
    await logic.transitionPageWorkflow({ pageId: PAGE, spaceKey: SPACE, toStateId: "draft", actorAccountId: APPROVER, actorName: "Ana Approver" });
    await logic.transitionPageWorkflow({ pageId: PAGE, spaceKey: SPACE, toStateId: "in_review", actorAccountId: PLAIN, actorName: "Pat Plain" });
    const bare = await logic.transitionPageWorkflow({ pageId: PAGE, spaceKey: SPACE, toStateId: "approved", actorAccountId: APPROVER, actorName: "Ana Approver", approvers: rec.approvers, approvedVersion: 2 });
    eq("[6] bed: approved with no approval record", [bare.success, (await logic.readPageWorkflow(PAGE)).approvalRecord ?? null], [true, null]);
    const v3 = w.edit(PAGE, PLAIN, "unapproved change");
    await triggers.pageContentTrigger(event(PLAIN, v3));
    const wf = await getWf();
    eq("[6] no approval record: the reviewed version is still the one it was approved at", [wf?.baseline?.reviewedVersion, wf?.baseline?.baselineVersion, wf?.baseline?.kind], [2, 4, "restored"]);
  }
  // 8. A sanctioned save lands WHILE the app is reverting (seen live 2026-10-18: a site admin's save of v4 and the
  //    unapproved edit's revert to v5 in two concurrent runs). The revert restored the copy it READ (here v4, a
  //    copy of approved v2), so its write v6 holds approved v2 — never "a copy of v4, saved by an approver"
  //    because the baseline moved under the revert.
  {
    const w = await approvedPage();
    const v3 = w.edit(PAGE, PLAIN, "unapproved change");
    await triggers.pageContentTrigger(event(PLAIN, v3)); // app writes v4 = copy of approved v2
    const v5 = w.edit(PAGE, PLAIN, "second unapproved change");
    let raced = false;
    onConfluence((method, path) => {
      if (!raced && method === "PUT" && new RegExp(`/wiki/api/v2/pages/${PAGE}(\\?|$)`).test(decodeURIComponent(path))) {
        raced = true; // the concurrent run: an approver's save re-stamps the baseline to v5 before ours lands
        return logic.restampApprovedVersion(PAGE, v5, { kind: "edit" }).then(() => undefined);
      }
      return undefined;
    });
    await triggers.pageContentTrigger(event(PLAIN, v5)); // app writes v6 from what it read: v4's content
    const wf = await getWf();
    eq("[8] bed: the race happened and the app wrote v6", [raced, w.live(PAGE).number], [true, 6]);
    eq("[8] the revert's copy holds approved v2, whatever moved meanwhile", [wf?.baseline?.baselineVersion, wf?.baseline?.kind, wf?.baseline?.contentOf], [6, "restored", 2]);
    ok("[8] ...and nobody is credited with it", !APPROVER_CLAIM.test(wf?.baseline?.sentence || "x approver or space admin"));
    const rows = await enforcedRows();
    eq("[8] the second revert's row names approved v2 as what came back", rows.map((r) => r.details?.restoredContent), [2, 2]);
  }
  // 10. Review round 2 D1: a page whose first revert happened on 8.10.0 (no baselineSource on the record; the
  //     revert's activity row says restoredTo) is reverted again on 8.11.0: every surface still names approved v2.
  {
    const w = await approvedPage();
    const v3 = w.edit(PAGE, PLAIN, "unapproved change");
    await triggers.pageContentTrigger(event(PLAIN, v3)); // v4 = copy of approved v2
    const rec = await logic.readPageWorkflow(PAGE);
    delete rec.baselineSource; delete rec.reviewedVersion; // as 8.10.0 left it
    await kvs.set(`workflow-state-${PAGE}`, rec);
    for (const r of await enforcedRows()) { const k = (await kvs.query().where("key", WhereConditions.beginsWith(`activity-page-${PAGE}-`)).limit(100).getMany()).results.find((x) => x.value.id === r.id)?.key; if (k) { const v = { ...r, details: { ...r.details } }; delete v.details.restoredContent; delete v.details.reviewedVersion; await kvs.set(k, v); } }
    w.comments.length = 0;
    const v5 = w.edit(PAGE, PLAIN, "second unapproved change");
    await triggers.pageContentTrigger(event(PLAIN, v5)); // v6
    const wf = await getWf();
    eq("[10] legacy page, second revert on 8.11.0: still a copy of approved v2", [wf?.baseline?.baselineVersion, wf?.baseline?.kind, wf?.baseline?.contentOf], [6, "restored", 2]);
    const ct = commentsText(w);
    ok("[10] the editor's comment names approved v2", /approved version \(v2\)/.test(ct) && !/v4, the last version kept/.test(ct));
    eq("[10] the banner pill names approved v2", (await lastDispatch())?.approvedVersion, 2);
    const rows = await enforcedRows();
    eq("[10] the new activity row names approved v2", rows[rows.length - 1]?.details?.restoredContent, 2);
  }
} finally {
  loud();
}

// 5. Records written before this release (no baselineSource): the activity row of the revert at the
//    baseline names what was restored; with no such row the sentence names nobody.
{
  const legacy = { enforce: true, approvedVersion: 9, approvalRecord: { pinnedVersion: 7 } };
  const fromLog = describeBaseline(legacy, { activity: [{ type: "workflow.enforced", version: 9, details: { mode: "revert", restoredTo: 7 } }] });
  eq("[5] legacy record + the revert's activity row: restored copy of approved v7", [fromLog.kind, fromLog.contentOf, fromLog.reviewedVersion, fromLog.baselineVersion], ["restored", 7, 7, 9]);
  const unknown = describeBaseline(legacy, { activity: [] });
  ok("[5] legacy record, no row: a neutral sentence that credits nobody", /checked against v9/.test(unknown.sentence) && !APPROVER_CLAIM.test(unknown.sentence));
  // Review #3: an earlier approval cycle's revert row must not carry the walk past this approval.
  const cycle = describeBaseline({ enforce: true, approvedVersion: 6, approvalRecord: { pinnedVersion: 4 } }, { activity: [
    { type: "workflow.enforced", version: 6, details: { mode: "revert", restoredTo: 4 } },
    { type: "workflow.enforced", version: 4, details: { mode: "revert", restoredTo: 2 } },
  ] });
  eq("[5] the legacy walk stops at the reviewed version", [cycle.kind, cycle.contentOf], ["restored", 4]);
  // Review #4: a privileged edit saved again by the app (seals restored) credits the edit's version, not the app's.
  const { nextBaselineSource } = await import("../src/server/capsules/workflow/baseline.js");
  const src = nextBaselineSource({ approvedVersion: 2 }, 4, { kind: "edit", editedIn: 3 });
  eq("[5] a privileged edit re-saved by the app: content v4, edited in v3", [src?.contentOf, src?.editedIn], [4, 3]);
  const eSentence = describeBaseline({ enforce: true, approvedVersion: 4, approvalRecord: { pinnedVersion: 2 }, baselineSource: src }).sentence;
  ok("[5] ...the sentence credits v3 to the approver, v4 to Sentinel Vault", /updated by an approver or space admin in v3/.test(eSentence) && /v4/.test(eSentence) && !/approver or space admin in v4/.test(eSentence));
  const after = describeBaseline({ enforce: true, approvedVersion: 6, approvalRecord: { pinnedVersion: 2 }, baselineSource: nextBaselineSource({ approvedVersion: 4, baselineSource: src }, 6, { kind: "restored", from: 4 }) }).sentence;
  ok("[5] ...and a later revert never says the app's v4 was saved by an approver", !/v4 was saved by an approver/.test(after));
  const same = describeBaseline({ enforce: true, approvedVersion: 7, approvalRecord: { pinnedVersion: 7 } });
  eq("[5] baseline not moved: no sentence", [same.moved, same.sentence], [false, null]);
}
// 7. One home: no surface rebuilds "the reviewed version" from the pin and the baseline itself, and
//    no surface but baseline.js words the baseline line (the defect was a hard-coded sentence).
{
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(fileURLToPath(new URL(import.meta.url))), "..");
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(js|jsx)$/.test(e.name)) files.push(p); } };
  walk(path.join(root, "src"));
  const offenders = files.filter((f) => !f.endsWith("baseline.js") && /pinnedVersion\s*:\s*null\)\s*\?\?\s*\w*\.?approvedVersion/.test(fs.readFileSync(f, "utf8")));
  eq("[7] the reviewed-version rule lives only in baseline.js", offenders.map((f) => path.relative(root, f)), []);
  const worded = files.filter((f) => !f.endsWith("baseline.js") && /last updated by an approver or space admin/.test(fs.readFileSync(f, "utf8")));
  eq("[7] the baseline sentence is worded only in baseline.js", worded.map((f) => path.relative(root, f)), []);
}
report("baseline-truth");
