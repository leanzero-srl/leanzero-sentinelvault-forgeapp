// One rule for "is this page under an enforced (Approved) state right now" (enforce-rules.js
// isEnforcedNow): a record whose state is gone from its workflow counts as enforced, for the page
// trigger, the hourly sweep, the seal gate (workflow/privilege.js) and the section-restore retry
// alike. The seal gate refuses when that check cannot be made. A demote-mode space whose FIRST state
// has an entry condition keeps moving pages back (pages start there ungated). Real modules,
// in-memory fake.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, onConfluence } = await import("./_forge-fake/state.mjs");
const { createWorld } = await import("./_forge-fake/confluence-world.mjs");
const triggers = await import("../src/server/triggers.js");
const logic = await import("../src/server/capsules/workflow/logic.js");
const { sealSection } = await import("../src/server/capsules/section-seals/actions.js");
const { workflowPrivilegeForPage } = await import("../src/server/capsules/workflow/privilege.js");
const { kvs } = await import("@forge/kvs");
const { hashAdf } = await import("../src/server/infra/doc-surgery.js");
const sm = await import("../src/server/capsules/workflow/state-machine.js");

const APP = "app-account";
const APPROVER = "acct-approver";
const ADMIN = "acct-space-admin";
const PLAIN = "acct-plain-editor";
const SPACE = "WF";
const PAGE = "801";
const SID = "sec-801";
const KEY = "app/env/static/sentinel-vault-sealed-section";

const para = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const heading = (t) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: t }] });
const wrapper = (body) => ({ type: "bodiedExtension", attrs: { extensionKey: KEY, extensionType: "com.atlassian.ecosystem", parameters: { guestParams: { sectionId: SID } } }, content: body });
const plainDoc = (intro, scope) => ({ version: 1, type: "doc", content: [para(intro), heading("Scope"), para(scope)] });
const sealedDoc = (intro, inside) => ({ version: 1, type: "doc", content: [para(intro), wrapper([para(inside)])] });
const text = (v) => JSON.stringify(v?.adf || v);

const realLog = { info: console.info, warn: console.warn, error: console.error, log: console.log };
const quiet = () => { console.info = () => {}; console.warn = () => {}; console.error = () => {}; console.log = () => {}; };
const loud = () => Object.assign(console, realLog);

let versionsLimited = false;
let unreadableVersion = null;

/** An Approved page at v2. `sealed`: v2 carries a sealed section (record + snapshot). */
async function approvedPage({ mode = "revert", sealed = false } = {}) {
  resetFake();
  versionsLimited = false;
  unreadableVersion = null;
  const w = createWorld({ appAccountId: APP, spaceKey: SPACE });
  w.addUser(APP, { displayName: "Sentinel Vault" }).addUser(APPROVER, { displayName: "Ana Approver" })
    .addUser(ADMIN, { displayName: "Sam Admin" }).addUser(PLAIN, { displayName: "Pat Plain" })
    .addPage(PAGE, { versions: [{ authorId: PLAIN, text: "first draft" }, { authorId: PLAIN, adf: sealed ? sealedDoc("approved intro", "SEALED TEXT") : plainDoc("approved intro", "approved scope") }] });
  w.spaceAdmins.add(ADMIN);
  w.readers.add("*");
  onConfluence((method, rawPath) => {
    const path = decodeURIComponent(rawPath);
    if (versionsLimited && method === "GET" && new RegExp(`^/wiki/api/v2/pages/${PAGE}/versions`).test(path)) {
      return { status: 429, body: "Too Many Requests", headers: { "Retry-After": "1800" } };
    }
    if (unreadableVersion != null && method === "GET" && path.includes(`/wiki/api/v2/pages/${PAGE}?`) && path.includes(`version=${unreadableVersion}`)) {
      return { status: 500, body: "boom" };
    }
    return undefined;
  });
  await kvs.set("app-account-id", APP);
  await kvs.set("section-macro-extension-key", KEY);
  await kvs.set("admin-settings-global", { enableContentProtection: true });
  await kvs.set(`workflow-settings-${SPACE}`, {
    enabled: true, workflowId: "default", enforceMode: mode, demoteTo: "initial",
    approval: { approvers: [{ type: "user", id: APPROVER, name: "Ana Approver" }], mode: "any", min: 1 },
  });
  if (sealed) {
    const body = [para("SEALED TEXT")];
    w.pages.get(PAGE).props.set("section-protection-", { id: "900", version: 1, value: { sections: [SID] } });
    await kvs.set(`section-protection-${SID}`, { sectionId: SID, pageId: PAGE, spaceKey: SPACE, lockedBy: APPROVER, lockedByName: "Ana", contentHash: hashAdf(body), sectionTitle: "Sealed", sealedVersion: 2, expiresAt: new Date(Date.now() + 864e5).toISOString() });
    await kvs.set(`section-snapshot-${SID}`, { wrapperNode: wrapper(body), bodyContent: body, hash: hashAdf(body), version: 2, originalIndex: 1 });
  }
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
const event = (actor, version) => ({ eventType: "avi:confluence:updated:page", atlassianId: actor, content: { id: PAGE, version: { number: version } }, space: { key: SPACE } });
const baseline = async () => (await logic.readPageWorkflow(PAGE))?.approvedVersion;
const stateId = async () => (await logic.readPageWorkflow(PAGE))?.stateId;
const sealReq = (accountId, headingIndex = 1) => ({
  payload: { pageId: PAGE, headingIndex, headingText: "Scope" },
  context: { accountId, extension: { content: { id: PAGE, type: "page", space: { key: SPACE } }, space: { key: SPACE } } },
});


// The page's state leaves the workflow (a definition written past the page-count check, or a backup).
const VANISHED = { id: "default", name: "Renamed", states: [{ id: "draft", name: "Draft", initial: true }, { id: "signed_off", name: "Signed off", enforce: true }], transitions: [{ from: "draft", to: "signed_off" }, { from: "signed_off", to: "draft" }] };
const vanish = () => kvs.set(`workflow-def-space-${SPACE}`, VANISHED);

quiet();
try {
  // 1. The seal gate: a plain editor may not seal on such a page.
  {
    await approvedPage();
    await vanish();
    const p = await workflowPrivilegeForPage(PAGE, PLAIN);
    eq("[1] privilege: a page whose state left the workflow is still enforced", [p.enforced, p.privileged], [true, false]);
    const r = await sealSection(sealReq(PLAIN));
    eq("[1] seal-section by a plain editor on it is refused", r?.success, false);
    const a = await sealSection(sealReq(APPROVER));
    eq("[1] control: its approver may still seal there", a?.success, true);
  }
  // 2. The section retry stands down on it (the workflow owns the page) instead of writing a partial restore.
  {
    const { w, save } = await approvedPage({ sealed: true });
    await vanish();
    save(PLAIN, sealedDoc("PLAIN INTRO EDIT", "PLAIN INSIDE EDIT"));
    const before = w.live(PAGE).number;
    const r = await triggers.runSectionRestoreForPage(PAGE);
    eq("[2] section retry writes nothing on an enforced page whose state left the workflow", w.live(PAGE).number, before);
    eq("[2] …and reports it as held by the workflow", r?.clean, false);
  }
  // 3. An exception in the check refuses the seal (fail closed), with a try-again reason.
  {
    await approvedPage();
    const realGet = kvs.get.bind(kvs);
    kvs.get = async (key) => { if (String(key) === `workflow-state-${PAGE}`) throw new Error("storage down"); return realGet(key); };
    let r;
    try { r = await sealSection(sealReq(PLAIN)); } finally { kvs.get = realGet; }
    eq("[3] seal-section when the approval state cannot be read is refused", r?.success, false);
    ok("[3] …saying nothing changed and to try again", /Nothing was changed/.test(r?.reason || "") && /[Tt]ry again/.test(r?.reason || ""));
  }
  // 4. A demote-mode space whose first state carries an entry condition still moves pages back to it.
  {
    const { w, save } = await approvedPage({ mode: "demote" });
    const s = await kvs.get(`workflow-settings-${SPACE}`);
    await kvs.set(`workflow-settings-${SPACE}`, { ...s, entryConditions: { draft: { requireRules: true, requireAi: false, aiThreshold: "medium", onBudgetExhausted: "block" } } });
    const v3 = save(PLAIN, plainDoc("PLAIN EDIT", "approved scope"));
    await triggers.pageContentTrigger(event(PLAIN, v3));
    eq("[4] moved back to the first state, the edit kept", [await stateId(), w.live(PAGE).number], ["draft", v3]);
    const plan = sm.planDemote(logic.DEFAULT_WORKFLOW, { demoteTo: "initial", entryConditions: { draft: { requireRules: true } } }, "approved");
    eq("[4] planDemote: the first state's entry condition does not block the move back", plan.ok, true);
    const custom = sm.planDemote(logic.DEFAULT_WORKFLOW, { demoteTo: "in_review", entryConditions: { in_review: { requireRules: true }, draft: { requireRules: true } } }, "approved");
    eq("[4] a chosen state with an entry condition still falls back to the first state", custom.target?.id, "draft");
    const saved = await logic.setSpaceWorkflowSettings(SPACE, { enabled: true, enforceMode: "demote", demoteTo: "in_review", entryConditions: { in_review: { requireRules: true } } });
    ok("[4] saving a chosen state with an entry condition is refused, saying what to change", saved.success === false && /remove the condition/i.test(saved.reason || "") && /another state|Revert/.test(saved.reason || ""));
  }
} finally { loud(); }

// 5. One home for the rule, and no seal gate that fails open.
{
  const fs = await import("node:fs");
  const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
  const src = read("../src/server/triggers.js") + read("../src/server/capsules/workflow/privilege.js");
  eq("[5] no local copy of the enforced-now rule in triggers.js / privilege.js", (src.match(/findState\(def, record\.stateId\)\?\.enforce/g) || []).length, 0);
  const seals = read("../src/server/capsules/sealing/actions.js") + read("../src/server/capsules/section-seals/actions.js");
  eq("[5] no seal call site turns a failed check into 'not enforced'", (seals.match(/enforced: false/g) || []).length, 0);
}
report("workflow-enforced-now");
