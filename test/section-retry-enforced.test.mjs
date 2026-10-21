// The hourly sealed-section restore retry on an Approved page.
//
// The page event leaves a `section-restore-pending-{pageId}` marker when its section restore could
// not be written, and the hourly expiry sweep re-runs the restore for those pages. On a page an
// enforced workflow holds, the retry stands down (the page event's Pass 0 and the workflow sweep
// deal with the whole change) and keeps its marker until the page is back at its approved baseline.
// The workflow sweep accepts an app-written version only when it equals the baseline or was made on
// top of versions that count (workflow/sanctioned.js). Real modules, in-memory Forge fake.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, fake } = await import("./_forge-fake/state.mjs");
const { createWorld } = await import("./_forge-fake/confluence-world.mjs");
const triggers = await import("../src/server/triggers.js");
const logic = await import("../src/server/capsules/workflow/logic.js");
const { kvs, WhereConditions } = await import("@forge/kvs");
const { hashAdf } = await import("../src/server/infra/doc-surgery.js");
const { sectionRetryKey } = await import("../src/server/shared/section-retry.js");

const APP = "app-account";
const APPROVER = "acct-approver";
const PLAIN = "acct-plain-editor";
const SPACE = "WF";
const PAGE = "901";
const SID = "sec-901";
const KEY = "app/env/static/sentinel-vault-sealed-section";

const para = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const wrapper = (body) => ({ type: "bodiedExtension", attrs: { extensionKey: KEY, extensionType: "com.atlassian.ecosystem", parameters: { guestParams: { sectionId: SID } } }, content: body });
const sealedDoc = (intro, inside, extra = null) => ({ version: 1, type: "doc", content: [para(intro), wrapper([para(inside)]), ...(extra ? [para(extra)] : [])] });
const text = (v) => JSON.stringify(v?.adf || v);

const realLog = { info: console.info, warn: console.warn, error: console.error, log: console.log };
const quiet = () => { console.info = () => {}; console.warn = () => {}; console.error = () => {}; console.log = () => {}; };
const loud = () => Object.assign(console, realLog);

/** An Approved page at v2 with a sealed section (owner: the approver). */
async function approvedPage({ mode = "revert" } = {}) {
  resetFake();
  const w = createWorld({ appAccountId: APP, spaceKey: SPACE });
  w.addUser(APP, { displayName: "Sentinel Vault" }).addUser(APPROVER, { displayName: "Ana Approver" }).addUser(PLAIN, { displayName: "Pat Plain" })
    .addPage(PAGE, { versions: [{ authorId: PLAIN, text: "first draft" }, { authorId: PLAIN, adf: sealedDoc("approved intro", "SEALED TEXT") }] });
  w.readers.add("*");
  await kvs.set("app-account-id", APP);
  await kvs.set("admin-settings-global", { enableContentProtection: true, autoUnlockEnabled: false });
  await kvs.set(`workflow-settings-${SPACE}`, {
    enabled: true, workflowId: "default", enforceMode: mode, demoteTo: "initial",
    approval: { approvers: [{ type: "user", id: APPROVER, name: "Ana Approver" }], mode: "any", min: 1 },
  });
  const body = [para("SEALED TEXT")];
  w.pages.get(PAGE).props.set("section-protection-", { id: "900", version: 1, value: { sections: [SID] } });
  await kvs.set(`section-protection-${SID}`, { sectionId: SID, pageId: PAGE, spaceKey: SPACE, lockedBy: APPROVER, lockedByName: "Ana", contentHash: hashAdf(body), sectionTitle: "Sealed", sealedVersion: 2, expiresAt: new Date(Date.now() + 864e5).toISOString() });
  await kvs.set(`section-snapshot-${SID}`, { wrapperNode: wrapper(body), bodyContent: body, hash: hashAdf(body), version: 2, originalIndex: 1 });
  await logic.assignPageWorkflow({ pageId: PAGE, spaceKey: SPACE, actorAccountId: PLAIN, actorName: "Pat Plain", workflowId: "default" });
  await logic.transitionPageWorkflow({ pageId: PAGE, spaceKey: SPACE, toStateId: "in_review", actorAccountId: PLAIN, actorName: "Pat Plain" });
  const appr = await logic.transitionPageWorkflow({
    pageId: PAGE, spaceKey: SPACE, toStateId: "approved", actorAccountId: APPROVER, actorName: "Ana Approver",
    approvers: [APPROVER], approvedVersion: 2,
    approvalRecord: { outcome: "approved", completedBy: APPROVER, completedByName: "Ana Approver", requestedBy: PLAIN, pinnedVersion: 2, decisions: [] },
  });
  if (!appr.success) throw new Error(`approve failed: ${appr.reason}`);
  const save = (author, adf) => { const p = w.pages.get(PAGE); p.versions.push({ number: p.versions.length + 1, authorId: author, adf }); return p.versions.length; };
  return { w, save };
}
const mark = () => kvs.set(sectionRetryKey(PAGE), { pageId: PAGE, since: new Date().toISOString(), attempts: 1 });
const marked = async () => !!(await kvs.get(sectionRetryKey(PAGE)));
const baseline = async () => (await logic.readPageWorkflow(PAGE))?.approvedVersion;
const enforcedRows = async () => {
  const { results } = await kvs.query().where("key", WhereConditions.beginsWith(`activity-page-${PAGE}-`)).limit(100).getMany();
  return (results || []).map((r) => r.value).filter((v) => v?.type === "workflow.enforced");
};

quiet();
try {
  // ── A. the retry on an Approved page ──────────────────────────────────────────────────────────
  {
    const { w, save } = await approvedPage();
    save(PLAIN, sealedDoc("PLAIN TAMPER", "TAMPERED SECTION")); // its event's write lost every 409 race
    await mark();
    await triggers.expirySweepTask();
    eq("[A] the retry stands down on an Approved page: nothing written", w.live(PAGE).authorId, PLAIN);
    eq("[A] ...and the marker is kept for after the workflow has dealt with the page", await marked(), true);
    await triggers.workflowSweep();
    const live = w.live(PAGE);
    ok("[A] the workflow sweep reverts the whole unapproved edit", live.authorId === APP && !text(live).includes("PLAIN TAMPER") && !text(live).includes("TAMPERED SECTION") && text(live).includes("approved intro"));
    eq("[A] the baseline is the app's revert (a copy of approved v2)", [await baseline(), (await logic.readPageWorkflow(PAGE))?.baselineSource?.contentOf], [w.live(PAGE).number, 2]);
    await triggers.expirySweepTask();
    eq("[A] the next retry finds the app's revert live and clears the marker", await marked(), false);
  }
  // ── B. the workflow sweep never takes an app version on trust ─────────────────────────────────
  {
    const { w, save } = await approvedPage();
    save(PLAIN, sealedDoc("PLAIN TAMPER", "TAMPERED SECTION"));
    save(APP, sealedDoc("PLAIN TAMPER", "SEALED TEXT")); // any app write made from the plain save (section restored, rest kept)
    await triggers.workflowSweep();
    const live = w.live(PAGE);
    ok("[B] an app version carrying a plain edit is reverted, not accepted", !text(live).includes("PLAIN TAMPER") && text(live).includes("approved intro"));
    ok("[B] ...and never became the baseline", (await baseline()) !== 4);
  }
  {
    // Demote mode: the page goes back for review, and the notice names the person, not the app.
    const { save } = await approvedPage({ mode: "demote" });
    save(PLAIN, sealedDoc("PLAIN TAMPER", "TAMPERED SECTION"));
    save(APP, sealedDoc("PLAIN TAMPER", "SEALED TEXT"));
    await triggers.workflowSweep();
    const rec = await logic.readPageWorkflow(PAGE);
    ok("[B demote] the page is sent back for review", rec?.stateId !== "approved");
    const row = (await enforcedRows()).find((r) => r?.details?.mode === "demote");
    eq("[B demote] the activity row names the plain editor, not Sentinel Vault", row?.details?.editor, PLAIN);
  }
  // ── C. what the sweep still accepts ───────────────────────────────────────────────────────────
  {
    // An app version made on top of the baseline (a seal's wrap whose re-stamp was missed).
    const { w, save } = await approvedPage();
    save(APP, sealedDoc("approved intro", "SEALED TEXT", "a second sealed area the app wrapped"));
    await triggers.workflowSweep();
    eq("[C] an app version on top of the baseline is accepted: nothing written, baseline moves", [w.live(PAGE).authorId, await baseline()], [APP, 3]);
  }
  {
    // The app's re-save of the baseline's own content after a plain save (equal to the baseline).
    const { w, save } = await approvedPage();
    save(PLAIN, sealedDoc("PLAIN TAMPER", "TAMPERED SECTION"));
    save(APP, sealedDoc("approved intro", "SEALED TEXT"));
    await triggers.workflowSweep();
    eq("[C] an app version equal to the baseline is accepted as unchanged", [w.live(PAGE).number, await baseline(), (await logic.readPageWorkflow(PAGE))?.baselineSource?.kind], [4, 4, "unchanged"]);
  }
  {
    // An approver's own save is accepted as before.
    const { save } = await approvedPage();
    save(APPROVER, sealedDoc("approver's new intro", "SEALED TEXT"));
    await triggers.workflowSweep();
    eq("[C] an approver's save moves the baseline", await baseline(), 3);
  }
  // ── D. the retry still works where no workflow holds the page ─────────────────────────────────
  {
    const { w, save } = await approvedPage();
    await logic.transitionPageWorkflow({ pageId: PAGE, spaceKey: SPACE, toStateId: "draft", actorAccountId: APPROVER, actorName: "Ana Approver" });
    save(PLAIN, sealedDoc("plain's intro", "TAMPERED SECTION"));
    await mark();
    await triggers.expirySweepTask();
    const live = w.live(PAGE);
    ok("[D] off Approved, the retry restores the sealed section", live.authorId === APP && text(live).includes("SEALED TEXT") && !text(live).includes("TAMPERED SECTION"));
    eq("[D] ...and clears the marker", await marked(), false);
  }
  {
    // An Approved page already at its baseline: nothing for the retry; the marker goes.
    const { w } = await approvedPage();
    await mark();
    await triggers.expirySweepTask();
    eq("[D] Approved and at the baseline: nothing written, marker cleared", [w.live(PAGE).number, await marked()], [2, false]);
  }
  void fake;
} finally {
  loud();
}
report("section-retry-enforced");
