// A page the app cannot read is NOT a deleted page. Confluence answers 404 to the app both for a
// page purged from the trash and for a LIVE page whose view restriction leaves the app out
// (measured on wolfaenpak 2026-10-22), so "not found" can never license removing what the app
// holds about that page. Before the fix the hourly workflow sweep deleted such a page's workflow
// record, index row and whole workflow history, and the seal-expiry sweep released a lapsed seal on
// it at once with no reminder and the reason "page deleted". Now the page's workflow is held as it
// is (no enforcement, expiry or notice while the app cannot read it) and protection resumes when
// the app can read the page again; a lapsed seal's countdown waits (nothing counted, posted or
// released) until the app can read the page. Round 1 review (2026-10-22) added: the dashboard says
// how many pages it cannot read, and the hourly sweep resumes where it stopped, so rows kept for
// unreadable pages can never push live pages out of its 2,000-row window.
// Real modules, in-memory fake.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url"; // a path, not a %20-encoded URL: the checkout path has a space

const { resetFake, onConfluence, fake } = await import("./_forge-fake/state.mjs");
const { createWorld } = await import("./_forge-fake/confluence-world.mjs");
const triggers = await import("../src/server/triggers.js");
const logic = await import("../src/server/capsules/workflow/logic.js");
const { classifyPageStatuses } = await import("../src/server/shared/page-status.js");
const { decideLapseDelivery } = await import("../src/server/shared/lapse-policy.js");
const { getWorkflowDashboard } = await import("../src/server/capsules/workflow/actions.js");
const { kvs, WhereConditions } = await import("@forge/kvs");

const APP = "app-account";
const APPROVER = "acct-approver";
const PLAIN = "acct-plain-editor";
const ADMIN = "acct-site-admin";
const SPACE = "WF";
const PAGE = "701";
const SID = "sec-701-a";

const realLog = { info: console.info, warn: console.warn, error: console.error, log: console.log };
const quiet = () => { console.info = () => {}; console.warn = () => {}; console.error = () => {}; };
const loud = () => Object.assign(console, realLog);

// The app's view of the page: `hidden` = a view restriction leaves the app out. Every read the app
// makes of it answers as Confluence does for content the caller may not see (404; omitted from lists).
const hidden = new Set();
function hideFromApp() {
  onConfluence((method, rawPath) => {
    const path = decodeURIComponent(rawPath);
    const base = path.split("?")[0];
    const m = base.match(/^\/wiki\/(?:api\/v2\/(?:pages|blogposts)|rest\/api\/content)\/(\d+)(?:\/|$)/);
    if (m && hidden.has(m[1])) return { status: 404, body: { message: "Not found" } };
    return undefined;
  });
}

async function approvedPage() {
  resetFake();
  hidden.clear();
  const w = createWorld({ appAccountId: APP, spaceKey: SPACE });
  w.addUser(APP, { displayName: "Sentinel Vault" }).addUser(APPROVER, { displayName: "Ana Approver" }).addUser(PLAIN, { displayName: "Pat Plain" }).addUser(ADMIN, { displayName: "Sam Admin", siteAdmin: true })
    .addPage(PAGE, { versions: [{ authorId: PLAIN, text: "first draft" }, { authorId: PLAIN, text: "the text that was approved" }] });
  w.readers.add("*");
  // The batch lookup leaves out pages the app may not see (the world's own handler answers first
  // for everything else, so this wraps its list answer).
  onConfluence((method, rawPath) => {
    const path = decodeURIComponent(rawPath);
    const [base, qs = ""] = path.split("?");
    if (base !== "/wiki/api/v2/pages" || method !== "GET") return undefined;
    const q = Object.fromEntries(qs.split("&").filter(Boolean).map((kv) => { const i = kv.indexOf("="); return [kv.slice(0, i), kv.slice(i + 1)]; }));
    const ids = String(q.id || "").split(",").filter((id) => !hidden.has(id));
    const statuses = String(q.status || "current").split(",");
    const results = ids.map((id) => w.pages.get(id)).filter((p) => p && statuses.includes(p.status))
      .map((p) => ({ id: p.id, status: p.status, title: p.title, spaceId: p.spaceId, version: { number: p.versions.length } }));
    return { body: { results } };
  });
  hideFromApp();
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
  return w;
}
const keysWith = async (prefix) => {
  const { results } = await kvs.query().where("key", WhereConditions.beginsWith(prefix)).limit(100).getMany().catch(() => ({ results: [] }));
  return (results || []).map((r) => r.key);
};
const sweep = async () => JSON.parse((await triggers.workflowSweep()).body || "{}");

quiet();
try {
  // ── PURE: the batch lookup's "not in either list" is named for what it is ────────────────────
  {
    const m = classifyPageStatuses(["9"], [], []);
    eq("[pure] a page in neither list is 'unseen' (purged OR hidden from the app), never 'missing'", m.get("9")?.status, "unseen");
    eq("[pure] lapse delivery for an unseen page: the countdown holds", decideLapseDelivery("unseen"), "hold");
    eq("[pure] a trashed page: undeliverable (unchanged)", decideLapseDelivery("trashed"), "undeliverable");
    ok("[pure] no page status releases a seal silently", ["unseen", "missing", "trashed", "current", "archived", "unknown", null].every((s) => decideLapseDelivery(s) !== "release-silently"));
  }

  // ── 1. An Approved page the app cannot read: the sweep keeps everything ──────────────────────
  {
    await approvedPage();
    const logBefore = (await keysWith(`workflow-log-${PAGE}-`)).length;
    const idxBefore = await keysWith(`workflow-idx-`);
    ok("[1] bed: the page has a workflow history", logBefore >= 2);
    hidden.add(PAGE); // a view restriction now leaves the app out
    const s = await sweep();
    const rec = await logic.readPageWorkflow(PAGE);
    eq("[1] hidden Approved page: the workflow record stays, still Approved", rec?.stateId, "approved");
    eq("[1] hidden Approved page: the approved version stays", rec?.approvedVersion, 2);
    eq("[1] hidden Approved page: the whole workflow history stays", (await keysWith(`workflow-log-${PAGE}-`)).length, logBefore);
    eq("[1] hidden Approved page: the index row stays", await keysWith(`workflow-idx-`), idxBefore);
    ok("[1] the sweep purged nothing", !(s.purgedPages > 0));
    eq("[1] the sweep counts the page as unseen", s.skippedUnseen, 1);
    // A second and third run change nothing either (no countdown to a purge).
    await sweep(); await sweep();
    eq("[1] three runs later: still Approved", (await logic.readPageWorkflow(PAGE))?.stateId, "approved");
    eq("[1] three runs later: the history is whole", (await keysWith(`workflow-log-${PAGE}-`)).length, logBefore);
  }

  // ── 2. Protection resumes once the app can read the page again ───────────────────────────────
  {
    const w = await approvedPage();
    hidden.add(PAGE);
    await sweep();
    w.edit(PAGE, PLAIN, "an unapproved change made while the app could not see the page");
    hidden.delete(PAGE); // the restriction is lifted
    const s = await sweep();
    eq("[2] restriction lifted: the sweep reverts the unapproved change", s.reverted, 1);
    eq("[2] the live page carries the approved text again", JSON.stringify(w.live(PAGE).adf).includes("the text that was approved"), true);
    eq("[2] the page is still Approved", (await logic.readPageWorkflow(PAGE))?.stateId, "approved");
  }

  // ── 3. A lapsed section seal on a page the app cannot read: the countdown holds ─────────────
  {
    const w = await approvedPage();
    w.pages.get(PAGE).props.set("section-protection-", { id: "900", version: 1, value: { sections: [SID] } });
    const past = new Date(Date.now() - 2 * 864e5).toISOString();
    await kvs.set(`section-protection-${SID}`, { sectionId: SID, pageId: PAGE, spaceKey: SPACE, lockedBy: APPROVER, lockedByName: "Ana", sectionTitle: "Sealed", sealedVersion: 2, timestamp: new Date(Date.now() - 9 * 864e5).toISOString(), expiresAt: past });
    hidden.add(PAGE);
    for (let i = 0; i < 5; i++) await triggers.expirySweepTask();
    ok("[3] hidden page, lapsed seal, five runs: the seal is NOT released", !!(await kvs.get(`section-protection-${SID}`)));
    eq("[3] hidden page: no reminder is counted (nothing could be posted)", await kvs.get(`expiry-notified-${SID}`), undefined);
    eq("[3] hidden page: no comment was posted", w.comments.length, 0);
    const rows = [];
    for (const k of await keysWith("activity-")) { const v = await kvs.get(k); if (/released/.test(String(v?.type || "")) || v?.details?.reason === "page-deleted") rows.push(k); }
    eq("[3] no release row and no 'page deleted' row", rows.length, 0);
    const reads = () => fake.calls.filter((c) => /^\/wiki\/api\/v2\/(pages|blogposts)\/701(\?|$)/.test(decodeURIComponent(c.path))).length;
    const before = reads();
    await triggers.expirySweepTask();
    eq("[3] a page confirmed unseen is not read again for a day (no per-run page reads)", reads() - before, 0);
    hidden.delete(PAGE); // readable again: the countdown starts with reminder 1
    await triggers.expirySweepTask();
    const n = await kvs.get(`expiry-notified-${SID}`);
    eq("[3] readable again: reminder 1 is sent and counted", n ? Math.max(1, Number(n.count) || 0) : 0, 1);
    ok("[3] readable again: the seal is still held (reminders first)", !!(await kvs.get(`section-protection-${SID}`)));
  }

  // ── 4. ONE rule: nothing removes workflow state because a page could not be read ─────────────
  {
    const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
    const trig = read("../src/server/triggers.js");
    const lg = read("../src/server/capsules/workflow/logic.js");
    ok("[4] the sweep's purge of an unread page is gone (purgePageWorkflow)", !/purgePageWorkflow/.test(trig) && !/export async function purgePageWorkflow/.test(lg));
    ok("[4] the seal-expiry sweep has no silent release on an unread page", !/release-silently/.test(trig) && !/"page-deleted"/.test(trig));
    ok("[4] no consumer of page-status.js compares against the old 'missing' verdict", ["../src/server/triggers.js", "../src/server/capsules/workflow/actions.js", "../src/server/capsules/workflow/approvals.js", "../src/server/capsules/realms/actions.js", "../src/server/shared/lapse-policy.js"].every((f) => !/(?:===|!==|includes\()\s*\[?\s*["']missing["']|["']missing["']\s*(?:===|!==)|status:\s*"missing"/.test(read(f))));
  }
  // ── 5. The dashboard says how many pages it cannot read ───────────────────────────────────
  {
    await approvedPage();
    hidden.add(PAGE);
    const d = await getWorkflowDashboard({ payload: { spaceKey: SPACE }, context: { accountId: ADMIN } });
    eq("[5] dashboard: the unreadable page is counted", d?.unseen, 1);
    ok("[5] dashboard: …and not listed", !(d?.pages || []).some((p) => String(p.pageId) === PAGE));
    const ui = readFileSync(fileURLToPath(new URL("../src/ui/kit/WorkflowDashboard.jsx", import.meta.url)), "utf8");
    ok("[5] the dashboard UI shows the count (and does not hide itself when only unreadable pages exist)", /wf-dash-unseen/.test(ui) && /!data\.unseen/.test(ui));
  }

  // ── 3b. The halfway reminder holds too on an unseen page ───────────────────────────────────
  {
    const w = await approvedPage();
    w.pages.get(PAGE).props.set("section-protection-", { id: "900", version: 1, value: { sections: [SID] } });
    await kvs.set(`section-protection-${SID}`, { sectionId: SID, pageId: PAGE, spaceKey: SPACE, lockedBy: APPROVER, lockedByName: "Ana", sectionTitle: "Sealed", sealedVersion: 2, timestamp: new Date(Date.now() - 6 * 864e5).toISOString(), expiresAt: new Date(Date.now() + 4 * 864e5).toISOString() });
    hidden.add(PAGE);
    await triggers.expirySweepTask();
    eq("[3b] hidden page, past halfway: no halfway marker is written (held, asked again next run)", await kvs.get(`fifty-percent-reminder-sent-${SID}`), undefined);
    eq("[3b] hidden page: nothing posted", w.comments.length, 0);
    hidden.delete(PAGE);
    await triggers.expirySweepTask();
    ok("[3b] control: readable again, the halfway reminder goes out (so the hold above was real)", !!(await kvs.get(`fifty-percent-reminder-sent-${SID}`)));
  }

  // ── 6. The sweep resumes where it stopped: kept rows never starve later pages ────────────────
  {
    const RESUME = triggers.WORKFLOW_SWEEP_RESUME || "workflow-sweep-resume";
    const w = await approvedPage();
    // 2,050 rows of pages the app cannot read, sorting BEFORE the live page's row (space "AA" < "WF").
    for (let i = 0; i < 2050; i++) await kvs.set(`workflow-idx-AA-approved-${900000 + i}`, { pageId: String(900000 + i), spaceKey: "AA", stateId: "approved" });
    w.edit(PAGE, PLAIN, "an edit the event never delivered");
    const s1 = await sweep();
    eq("[6] run 1: the window (2,000 rows) ends before the live page", s1.reverted, 0);
    ok("[6] run 1: where it stopped is kept", !!(await kvs.get(RESUME)));
    const s2 = await sweep();
    eq("[6] run 2: resumes and reaches the live page, reverting the unapproved edit", s2.reverted, 1);
    eq("[6] run 2 reached the end: the resume point is cleared", await kvs.get(RESUME), undefined);
    // Storage refuses a stored cursor (expired / malformed): the run starts from the top.
    await kvs.set(RESUME, { cursor: "not-a-cursor" });
    const realQuery = kvs.query;
    kvs.query = () => { const q = realQuery(); const cur = q.cursor; let bad = false; q.cursor = (c) => { bad = c === "not-a-cursor"; return cur(c); }; const gm = q.getMany; q.getMany = async () => { if (bad) throw new Error("invalid cursor"); return gm(); }; return q; };
    let s3 = null;
    try { s3 = await sweep(); } catch (_) { s3 = null; } finally { kvs.query = realQuery; }
    ok("[6] a resume point storage no longer accepts: the run starts from the top instead of failing", !!s3 && typeof s3.skippedUnseen === "number");
  }

  // ── 6b. The walk's time budget, and a run stopped mid-walk ──────────────────────────────────
  {
    const RESUME = triggers.WORKFLOW_SWEEP_RESUME || "workflow-sweep-resume";
    const limits = triggers.WORKFLOW_SWEEP_LIMITS || { pages: 20, loopMs: 12000 };
    const w = await approvedPage();
    for (let i = 0; i < 350; i++) await kvs.set(`workflow-idx-AA-approved-${900000 + i}`, { pageId: String(900000 + i), spaceKey: "AA", stateId: "approved" });
    w.edit(PAGE, PLAIN, "an edit the event never delivered");
    const keep = limits.pages; limits.pages = 1; // one index page per run
    let reverted = 0, runs = 0;
    try { for (; runs < 6 && !reverted; runs++) reverted = (await sweep()).reverted || 0; } finally { limits.pages = keep; }
    eq("[6b] page cap reached after each page: the walk still reaches the live page, one page a run", [reverted, runs], [1, 4]);
    await kvs.delete(RESUME);
    const realQuery = kvs.query; let pagesServed = 0;
    kvs.query = (...a) => {
      const q = realQuery(...a); let idx = false;
      const wh = q.where; q.where = (f, c) => { idx = String(c?.beginsWith || "") === "workflow-idx-"; wh(f, c); return q; };
      const gm = q.getMany; q.getMany = async () => { if (idx && ++pagesServed === 2) throw new Error("function timed out"); return gm(); };
      return q;
    };
    try { await sweep(); } catch (_) { /* the stopped run */ } finally { kvs.query = realQuery; }
    eq("[6b] stopped on page 2: the place after page 1 is saved", (await kvs.get(RESUME))?.cursor, "100");
  }

  // ── 7. Steward changes are not held back by pages the app cannot read ──────────────────────
  {
    await approvedPage();
    const def = await logic.resolveWorkflowDef(SPACE);
    const without = { ...def, states: def.states.filter((st) => st.id !== "approved"), transitions: (def.transitions || []).filter((t) => t.from !== "approved" && t.to !== "approved") };
    const r1 = await logic.storeSpaceWorkflow(SPACE, { def: without });
    ok("[7] control: a readable page in the state still holds the removal back", r1?.success === false && /still has 1 page/.test(r1?.reason || ""));
    hidden.add(PAGE);
    const r2 = await logic.storeSpaceWorkflow(SPACE, { def: without });
    ok(`[7] only an unreadable page in the state: not held back by it (got ${JSON.stringify(r2?.reason || r2?.success)})`, !/still has/.test(r2?.reason || ""));
    eq("[7] …and that page keeps its record, enforced", (await logic.readPageWorkflow(PAGE))?.enforce ?? null, true);
  }
} finally {
  loud();
}
report("unseen-page");
