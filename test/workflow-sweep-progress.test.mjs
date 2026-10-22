// SVT-149: the hourly workflow sweep must always move forward, even when one index page of 100 rows
// takes longer than the function's limit (Forge stops the function at 25 s). Before the fix the
// budget was checked only between index pages and the resume point was saved only after a whole
// page, so a page that took longer than the limit was started again from its first row every hour
// and the rows after it (here: an Approved page with an unapproved edit) were never reached.
//
// The platform's stop is simulated: a fake clock advances while rows are judged, and once a run has
// used 25 s every storage and Confluence call it makes never answers (the run is abandoned, exactly
// as a stopped function writes nothing more). What a run saved before that is all the next run has.
// Real modules, in-memory fake.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, onConfluence } = await import("./_forge-fake/state.mjs");
const { createWorld } = await import("./_forge-fake/confluence-world.mjs");
const triggers = await import("../src/server/triggers.js");
const logic = await import("../src/server/capsules/workflow/logic.js");
const { kvs } = await import("@forge/kvs");

const APP = "app-account";
const APPROVER = "acct-approver";
const PLAIN = "acct-plain-editor";
const SPACE = "WF";
const PAGE = "701";
const RESUME = triggers.WORKFLOW_SWEEP_RESUME;
const LIMIT_MS = 25_000;

const realLog = { info: console.info, warn: console.warn, error: console.error, log: console.log };
const warnings = [];
const quiet = () => { console.info = () => {}; console.warn = (...a) => { warnings.push(a.join(" ")); }; console.error = () => {}; };
const loud = () => Object.assign(console, realLog);

// ── The fake clock and the platform's stop ─────────────────────────────────────────────────────
const realNow = Date.now;
let skew = 0;
Date.now = () => realNow() + skew;
let runStart = 0, stopped = false, onStop = null, inRun = false;
const never = () => new Promise(() => {});
const isStopped = () => {
  if (inRun && !stopped && Date.now() - runStart > LIMIT_MS) { stopped = true; onStop?.(); }
  return stopped;
};
// What judging a row costs: charged when the sweep reads that page's workflow record.
const cost = new Map(); // pageId -> ms
const reads = new Map(); // pageId -> how many times its record was read
const real = { get: kvs.get, set: kvs.set, delete: kvs.delete, query: kvs.query };
kvs.get = async (key) => {
  if (isStopped()) return never();
  const m = /^workflow-state-(\d+)$/.exec(String(key));
  if (m) {
    reads.set(m[1], (reads.get(m[1]) || 0) + 1);
    skew += cost.get(m[1]) || 0;
    if (isStopped()) return never();
  }
  return real.get(key);
};
kvs.set = async (key, value) => (isStopped() ? never() : real.set(key, value));
kvs.delete = async (key) => (isStopped() ? never() : real.delete(key));
let failIndexReads = 0;
kvs.query = (...a) => {
  const q = real.query(...a);
  let idx = false;
  const wh = q.where; q.where = (f, c) => { idx = String(c?.beginsWith || "") === "workflow-idx-"; wh(f, c); return q; };
  const gm = q.getMany;
  q.getMany = async () => {
    if (isStopped()) return never();
    if (idx && failIndexReads > 0) { failIndexReads--; throw new Error("storage unavailable"); }
    return gm();
  };
  return q;
};

/** One hourly run: its result, or { stopped: true } when the platform stopped it at 25 s. */
async function run() {
  runStart = Date.now(); stopped = false; inRun = true;
  const stop = new Promise((resolve) => { onStop = () => resolve({ stopped: true }); });
  try {
    return await Promise.race([triggers.workflowSweep().then((r) => JSON.parse(r.body || "{}")), stop]);
  } catch (e) { return { threw: String(e?.message || e) }; }
  finally { onStop = null; stopped = false; inRun = false; }
}

async function world({ filler = [] } = {}) {
  resetFake();
  cost.clear(); reads.clear(); warnings.length = 0; failIndexReads = 0;
  const w = createWorld({ appAccountId: APP, spaceKey: SPACE });
  w.addUser(APP, { displayName: "Sentinel Vault" }).addUser(APPROVER, { displayName: "Ana Approver" }).addUser(PLAIN, { displayName: "Pat Plain" })
    .addPage(PAGE, { versions: [{ authorId: PLAIN, text: "first draft" }, { authorId: PLAIN, text: "the text that was approved" }] });
  for (const { id } of filler) w.addPage(id, { versions: [{ authorId: PLAIN, text: "a page in a workflow" }] });
  w.readers.add("*");
  // The batch status lookup the sweep makes per index page.
  onConfluence((method, rawPath) => {
    const path = decodeURIComponent(rawPath);
    const [base, qs = ""] = path.split("?");
    if (base !== "/wiki/api/v2/pages" || method !== "GET") return undefined;
    const q = Object.fromEntries(qs.split("&").filter(Boolean).map((kv) => { const i = kv.indexOf("="); return [kv.slice(0, i), kv.slice(i + 1)]; }));
    const ids = String(q.id || "").split(",").filter(Boolean);
    const statuses = String(q.status || "current").split(",");
    const results = ids.map((id) => w.pages.get(id)).filter((p) => p && statuses.includes(p.status))
      .map((p) => ({ id: p.id, status: p.status, title: p.title, spaceId: p.spaceId, version: { number: p.versions.length } }));
    return { body: { results } };
  });
  // Last registered = asked first: a stopped run's Confluence calls never answer either.
  onConfluence(() => (isStopped() ? never() : undefined));
  await real.set("app-account-id", APP);
  await real.set("admin-settings-global", { enableContentProtection: true, enableEmailDispatches: true, notifyEditorOnRevert: true });
  await real.set(`workflow-settings-${SPACE}`, {
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
  // Index rows of other pages, sorting BEFORE the Approved page's row (space "AA"/"AB" < "WF").
  // They have no workflow record of their own: what they cost is the time to judge them.
  for (const { id, space = "AA", ms = 0 } of filler) {
    await real.set(`workflow-idx-${space}-approved-${id}`, { pageId: id, spaceKey: space, stateId: "approved" });
    cost.set(id, ms);
  }
  // An unapproved edit whose event never arrived: only the hourly sweep can catch it.
  w.edit(PAGE, PLAIN, "an edit the event never delivered");
  return w;
}
const fillers = (n, ms, from = 900000, space = "AA") => Array.from({ length: n }, (_, i) => ({ id: String(from + i), space, ms }));

quiet();
try {
  // ── 1. One index page takes longer than the limit: every run still moves forward ─────────────
  {
    // 150 rows at 300 ms: the first index page alone needs 30 s, more than the 25 s the function has.
    await world({ filler: fillers(150, 300) });
    const results = [];
    const points = [];
    for (let i = 0; i < 8 && !results.some((r) => r.reverted); i++) {
      results.push(await run());
      points.push(JSON.stringify((await real.get(RESUME)) ?? null));
    }
    const runs = results.length;
    ok(`[1] the Approved page's unapproved edit is reached and reverted within 8 runs (runs: ${JSON.stringify(results.map((r) => r.stopped ? "stopped" : r.reverted ?? r.threw))})`, results.some((r) => r.reverted === 1));
    ok("[1] no run was stopped by the platform: each stops itself inside the budget", results.every((r) => !r.stopped));
    ok("[1] every run leaves a different resume point (progress every hour)", new Set(points).size === points.length);
    ok(`[1] more than one run was needed (the case is real: ${runs} runs)`, runs > 1);
    eq("[1] the walk reached the end of the index: the resume point is cleared", await real.get(RESUME), undefined);
    eq("[1] every row was judged exactly once over the pass", [...reads.entries()].filter(([id]) => id !== PAGE).every(([, n]) => n === 1) && reads.size === 151, true);
  }

  // ── 2. One row alone takes longer than the limit: it is passed over, the rest go on ───────────
  {
    const poison = { id: "990000", space: "AB", ms: 30_000 };
    await world({ filler: [...fillers(10, 10), poison] });
    const results = [];
    for (let i = 0; i < 8 && !results.some((r) => r.reverted); i++) results.push(await run());
    const last = results[results.length - 1] || {};
    ok(`[2] the rows after the one that stops every run are still reached: the edit is reverted within 8 runs (runs: ${JSON.stringify(results.map((r) => r.stopped ? "stopped" : r.reverted ?? r.threw))})`, last.reverted === 1);
    eq("[2] exactly that row was passed over, once", last.skippedStuck, 1);
    ok("[2] the stops before it were real (the platform stopped earlier runs)", results.slice(0, -1).every((r) => r.stopped));
    ok("[2] the pass-over is logged with the page id", warnings.some((w) => /page=990000 passed over/.test(w)));
    ok("[2] the passed-over row keeps its index row (nothing deleted)", !!(await real.get("workflow-idx-AB-approved-990000")));
    eq("[2] the fast rows before it were each judged before it was passed over, none skipped",
      fillers(10, 10).every(({ id }) => (reads.get(id) || 0) >= 1), true);
    // The next pass judges it again (passed over for one pass only).
    cost.set("990000", 0);
    const before = reads.get("990000") || 0;
    const again = await run();
    ok("[2] next pass: the row is judged again", (reads.get("990000") || 0) > before && !again.stopped);
    eq("[2] next pass: nothing passed over", again.skippedStuck, 0);
  }

  // ── 3. A resume point written before this change (cursor only) still resumes ─────────────────
  {
    await world({ filler: fillers(150, 0) });
    await real.set(RESUME, { cursor: "100", at: new Date().toISOString() });
    const r = await run();
    eq("[3] a cursor-only resume point continues on the second index page: the edit there is reverted", r.reverted, 1);
    eq("[3] …without judging the first page again", reads.get("900000") || 0, 0);
  }

  // ── 4. A failed index read is not a stop: it never makes a row be passed over ────────────────
  {
    await world({ filler: fillers(5, 0) });
    failIndexReads = 2;
    const r1 = await run(); const r2 = await run(); const r3 = await run();
    ok("[4] the two runs whose index read failed end with the error", !!r1.threw && !!r2.threw);
    eq("[4] the next run judges every row: nothing is passed over", [r3.skippedStuck, r3.reverted], [0, 1]);
  }

  // ── 5. Small sites: one run walks everything, as before ───────────────────────────────────────
  {
    await world({ filler: fillers(20, 50) });
    const r = await run();
    eq("[5] a site that fits in one run: the edit is reverted in the first run", r.reverted, 1);
    eq("[5] …and the resume point is gone", await real.get(RESUME), undefined);
  }
} finally {
  loud();
  Object.assign(kvs, real);
  Date.now = realNow;
}
report("workflow-sweep-progress");
