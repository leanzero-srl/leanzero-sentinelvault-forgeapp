// The enforcement baseline of an Approved page moves only to versions that count.
//
// The baseline (record.approvedVersion) is what the page event, the five-minute guard and the hourly
// sweep compare against: a version at or below it predates the approval, and a live version equal to
// it has nothing to enforce. A version counts when an approver (record snapshot AND the live list) or
// a steward of the record's spaces saved it, or the app saved it on top of a version that counts.
// Covered: the re-stamp after a seal is created, Pass 0 when the approved body cannot be read (no
// pass writes that run), an event for a version the approval covers met with a newer save, the live
// version as a candidate (kept when it counts, else the page goes back to the highest version below
// it that counts), and one home for the privileged-author rule. Real modules, in-memory Forge fake.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, onConfluence } = await import("./_forge-fake/state.mjs");
const { createWorld } = await import("./_forge-fake/confluence-world.mjs");
const triggers = await import("../src/server/triggers.js");
const logic = await import("../src/server/capsules/workflow/logic.js");
const { sealSection } = await import("../src/server/capsules/section-seals/actions.js");
const { kvs } = await import("@forge/kvs");
const { hashAdf } = await import("../src/server/infra/doc-surgery.js");

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

quiet();
try {
  // ── 1. A seal created while an unapproved save is waiting for its event ─────────────────────────
  {
    // Control: no seal step — the plain editor's v3 is reverted.
    const { w, save } = await approvedPage();
    const v3 = save(PLAIN, plainDoc("UNAPPROVED INTRO", "approved scope"));
    await triggers.pageContentTrigger(event(PLAIN, v3));
    ok("[1 control] without a seal the unapproved edit is reverted", w.live(PAGE).authorId === APP && !text(w.live(PAGE)).includes("UNAPPROVED"));
  }
  {
    // An attachment seal (no page write) after a plain save: the re-stamp stops below it.
    const { w, save } = await approvedPage();
    const v3 = save(PLAIN, plainDoc("UNAPPROVED INTRO", "approved scope"));
    await logic.restampIfEnforced(PAGE);
    eq("[1] a seal never moves the baseline over a plain editor's version", await baseline(), 2);
    await triggers.pageContentTrigger(event(PLAIN, v3)); // the late event
    await triggers.workflowSweep();
    const live = w.live(PAGE);
    ok("[1] the unapproved edit is reverted after the seal (event + sweep)", live.authorId === APP && !text(live).includes("UNAPPROVED"));
    ok("[1] ...and it never became the baseline", (await baseline()) !== 3);
  }
  {
    // The section seal writes its own version ON TOP of the plain save: that app version carries
    // the unapproved text and is no more sanctioned than the version it was made from.
    const { w, save } = await approvedPage();
    const v3 = save(PLAIN, plainDoc("UNAPPROVED INTRO", "approved scope"));
    save(APP, sealedDoc("UNAPPROVED INTRO", "approved scope")); // v4: the app's wrap of the live body
    await logic.restampIfEnforced(PAGE);
    eq("[1] an app version made on top of a plain save does not count either", await baseline(), 2);
    await triggers.pageContentTrigger(event(PLAIN, v3));
    const live = w.live(PAGE);
    ok("[1] the plain edit is reverted to the approved v2", live.authorId === APP && !text(live).includes("UNAPPROVED") && text(live).includes("approved intro"));
  }
  {
    // The real seal-section action: an approver seals while a plain save is still waiting for its
    // event. Sealing would freeze the unapproved text into the seal's snapshot: refused.
    const { w, save } = await approvedPage();
    save(PLAIN, plainDoc("approved intro", "UNAPPROVED SCOPE"));
    const r = await sealSection(sealReq(APPROVER));
    eq("[1] seal-section on an Approved page with an unapproved save pending is refused", r?.success, false);
    eq("[1] ...nothing was written", w.live(PAGE).authorId, PLAIN);
    eq("[1] ...no seal record", (await kvs.query().where("key", { beginsWith: "section-protection-" }).getMany()).results.length, 0);
  }
  {
    // Demote mode: the late event of the plain save must still demote the page.
    const { save } = await approvedPage({ mode: "demote" });
    const v3 = save(PLAIN, plainDoc("UNAPPROVED INTRO", "approved scope"));
    await logic.restampIfEnforced(PAGE);
    await triggers.pageContentTrigger(event(PLAIN, v3));
    ok("[1 demote] the plain edit still sends the page back for review", (await stateId()) !== "approved");
  }

  // ── 2. What a seal may still do: a clean page keeps its seal inside the baseline ────────────────
  {
    const { w, save } = await approvedPage();
    const r = await sealSection(sealReq(APPROVER));
    eq("[2] seal-section on a clean Approved page succeeds", r?.success, true);
    eq("[2] the app's wrap (v3) becomes the baseline: the seal is inside it", [w.live(PAGE).authorId, await baseline()], [APP, 3]);
    const v4 = save(PLAIN, plainDoc("UNAPPROVED INTRO", "approved scope"));
    await triggers.pageContentTrigger(event(PLAIN, v4));
    const live = w.live(PAGE);
    ok("[2] a later plain edit is reverted and the sealed wrapper survives", live.authorId === APP && !text(live).includes("UNAPPROVED") && text(live).includes(KEY));
  }
  {
    // An approver's save whose event has not landed yet is sanctioned: the seal may re-stamp to it.
    const { save } = await approvedPage();
    save(APPROVER, plainDoc("approver's new intro", "approved scope"));
    await logic.restampIfEnforced(PAGE);
    eq("[2] an approver's version counts: the baseline moves to it", await baseline(), 3);
  }
  {
    // A space admin's save then a plain one: the baseline stops at the admin's version.
    const { w, save } = await approvedPage();
    save(ADMIN, plainDoc("admin's intro", "approved scope"));
    const v4 = save(PLAIN, plainDoc("admin's intro", "UNAPPROVED SCOPE"));
    await logic.restampIfEnforced(PAGE);
    eq("[2] the baseline moves to the last sanctioned version below the first plain one", await baseline(), 3);
    await triggers.pageContentTrigger(event(PLAIN, v4));
    const live = w.live(PAGE);
    ok("[2] ...and the plain edit is reverted to the admin's version", live.authorId === APP && text(live).includes("admin's intro") && !text(live).includes("UNAPPROVED"));
  }
  {
    // Who wrote what could not be read (Confluence 429): no re-stamp at all.
    const { save } = await approvedPage();
    save(APPROVER, plainDoc("approver's new intro", "approved scope"));
    versionsLimited = true;
    await logic.restampIfEnforced(PAGE);
    eq("[2] versions unreadable: the baseline does not move", await baseline(), 2);
  }

  // ── 3. Pass 0 cannot read the baseline: nothing else writes either ─────────────────────────────
  {
    const { w, save } = await approvedPage({ sealed: true });
    const v3 = save(PLAIN, sealedDoc("PLAIN TAMPER", "TAMPERED SECTION"));
    unreadableVersion = 2;
    await triggers.pageContentTrigger(event(PLAIN, v3));
    eq("[3] baseline unreadable: no pass writes this run", w.live(PAGE).authorId, PLAIN);
    eq("[3] ...and the baseline stays", await baseline(), 2);
    unreadableVersion = null;
    await triggers.workflowSweep();
    const live = w.live(PAGE);
    ok("[3] once the baseline reads again the sweep reverts the tamper", live.authorId === APP && !text(live).includes("PLAIN TAMPER") && text(live).includes("SEALED TEXT"));
  }

  // ── 4. A late event for an approved version, with a newer save by the same person ──────────────
  {
    const { w, save } = await approvedPage({ sealed: true });
    const v3 = save(PLAIN, sealedDoc("PLAIN TAMPER", "TAMPERED SECTION"));
    await triggers.pageContentTrigger(event(PLAIN, 2)); // the requester's own pre-approval save, delivered late
    eq("[4] a restore written into a newer plain save never becomes the baseline", await baseline(), 2);
    await triggers.pageContentTrigger(event(PLAIN, v3));
    const live = w.live(PAGE);
    ok("[4] the newer save's own event then reverts it to the approved text", live.authorId === APP && !text(live).includes("PLAIN TAMPER") && text(live).includes("approved intro"));
  }

  // ── 6. The live version is itself a candidate: a counting live version is never reverted ───────
  {
    // A plain save (v3), then an approver's save on top (v4); the plain save's event arrives first.
    const { w, save } = await approvedPage();
    const v3 = save(PLAIN, plainDoc("PLAIN INTRO", "approved scope"));
    save(APPROVER, plainDoc("PLAIN INTRO, reviewed and kept by the approver", "approved scope"));
    await triggers.pageContentTrigger(event(PLAIN, v3));
    const live = w.live(PAGE);
    eq("[6] the approver's live v4 is kept (no revert past it)", [live.number, live.authorId], [4, APPROVER]);
    eq("[6] ...and the baseline moves to it", await baseline(), 4);
  }
  {
    // The same with the app's write on top of the approver's (a seal's wrap): still counts.
    const { w, save } = await approvedPage();
    const v3 = save(PLAIN, plainDoc("PLAIN INTRO", "approved scope"));
    save(APPROVER, plainDoc("approver kept it", "approved scope"));
    save(APP, sealedDoc("approver kept it", "approved scope"));
    await triggers.pageContentTrigger(event(PLAIN, v3));
    eq("[6] an app version on top of the approver's is kept", [w.live(PAGE).number, w.live(PAGE).authorId], [5, APP]);
    eq("[6] ...and the baseline moves to it", await baseline(), 5);
  }
  {
    // The live version does not count: reverted to the highest counting version below it.
    const { w, save } = await approvedPage();
    save(PLAIN, plainDoc("PLAIN INTRO", "approved scope"));
    save(APPROVER, plainDoc("approver kept it", "approved scope"));
    const v5 = save(PLAIN, plainDoc("approver kept it", "SECOND PLAIN EDIT"));
    await triggers.pageContentTrigger(event(PLAIN, v5));
    const live = w.live(PAGE);
    ok("[6] a plain live version is reverted to the approver's v4", live.authorId === APP && text(live).includes("approver kept it") && !text(live).includes("SECOND PLAIN EDIT"));
  }
  {
    // The hourly sweep, same order of saves and no event at all.
    const { w, save } = await approvedPage();
    save(PLAIN, plainDoc("PLAIN INTRO", "approved scope"));
    save(APPROVER, plainDoc("approver kept it", "approved scope"));
    await triggers.workflowSweep();
    eq("[6] sweep: the approver's live version is kept and becomes the baseline", [w.live(PAGE).number, await baseline()], [4, 4]);
  }
} finally {
  loud();
}

// ── 5. One home for "who may edit an Approved page" ─────────────────────────────────────────────
{
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/server/triggers.js", import.meta.url), "utf8") + fs.readFileSync(new URL("../src/server/capsules/workflow/privilege.js", import.meta.url), "utf8");
  eq("[5] triggers.js and privilege.js no longer carry their own approver-snapshot test", (src.match(/record\.approvers\.includes\(/g) || []).length, 0);
}
report("baseline-sanction");
