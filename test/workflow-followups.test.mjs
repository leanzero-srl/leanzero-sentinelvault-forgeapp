// The four LOW follow-ups from the 8.10.0 live-fix review (content/episodes/confluence-lock-page-after-
// approval/fix-review-2026-10-18.md), each red first:
//   1. the page-details window's Move sent no fromStateId, so a window left open could still move a
//      page from a state it had left (and got the engine's raw reason);
//   2. "Sign & move" retried with the banner's CURRENT state, not the state the move was picked from;
//      the 5 s poll can refresh the banner while the signing dialog is open;
//   3. the inline panel and the overlay call check-seal-stamp too and paid a KVS read for the
//      per-page workflow stamp they never use;
//   4. protections-last-workflow-<pageId> rows were never deleted.
import "./_forge-fake/install.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, ok, report } from "./_assert.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const { resetFake } = await import("./_forge-fake/state.mjs");
const { createWorld } = await import("./_forge-fake/confluence-world.mjs");
const logic = await import("../src/server/capsules/workflow/logic.js");
const { kvs } = await import("@forge/kvs");
const wfActions = new Map((await import("../src/server/capsules/workflow/actions.js")).actions);
const sealing = new Map((await import("../src/server/capsules/sealing/actions.js")).actions);

const PLAIN = "acct-plain";
const SPACE = "WF";
const PAGE = "901";
const STAMP = `protections-last-workflow-${PAGE}`;
const realLog = { info: console.info, warn: console.warn, error: console.error, log: console.log };
const quiet = () => { console.info = () => {}; console.warn = () => {}; console.error = () => {}; };
const loud = () => Object.assign(console, realLog);

// Watch the KVS calls the app makes (the fake's own functions do the work).
const seen = { gets: [], sets: [] };
const realGet = kvs.get; const realSet = kvs.set;
kvs.get = async (key, ...rest) => { seen.gets.push(key); return realGet(key, ...rest); };
kvs.set = async (key, value, opts) => { seen.sets.push({ key, opts }); return realSet(key, value, opts); };

quiet();
try {
  resetFake();
  createWorld({ spaceKey: SPACE }).addUser(PLAIN).addPage(PAGE, { versions: [{ authorId: PLAIN }] }).readers.add("*");
  await kvs.set(`workflow-settings-${SPACE}`, { enabled: true, workflowId: "default" });
  await logic.assignPageWorkflow({ pageId: PAGE, spaceKey: SPACE, actorAccountId: PLAIN, workflowId: "default" });
  seen.sets.length = 0;
  const moved = await wfActions.get("request-transition")({ payload: { pageId: PAGE, toStateId: "in_review", fromStateId: "draft" }, context: { accountId: PLAIN } });
  eq("bed: the page moved", moved?.success, true);

  // 3. check-seal-stamp: the banner asks for the workflow stamp; a caller that says it does not need it
  //    pays no read for it.
  const ctx = { extension: { content: { id: PAGE } } };
  seen.gets.length = 0;
  const banner = await sealing.get("check-seal-stamp")({ payload: {}, context: ctx });
  ok("[3] the banner (no flag) still gets the page's workflow stamp", banner?.workflowStamp > 0 && seen.gets.includes(STAMP));
  seen.gets.length = 0;
  const panel = await sealing.get("check-seal-stamp")({ payload: { workflow: false }, context: ctx });
  ok("[3] workflow:false: no read of the workflow stamp", !seen.gets.includes(STAMP));
  ok("[3] workflow:false: the seal stamp is still answered", typeof panel?.stamp === "number" && panel.workflowStamp === undefined);
  for (const [file, label] of [["src/ui/surfaces/inline-panel/index.jsx", "inline panel"], ["src/ui/surfaces/overlay/index.jsx", "overlay"]]) {
    ok(`[3] the ${label} polls with workflow:false`, /invoke\("check-seal-stamp",\s*\{\s*workflow:\s*false\s*\}\)/.test(read(file)));
  }
  ok("[3] the banner polls without the flag", /invoke\("check-seal-stamp"\)/.test(read("src/ui/surfaces/doc-ribbon/index.jsx")));

  // 4. The per-page stamp expires on its own and goes with the page.
  const w = seen.sets.find((s) => s.key === STAMP);
  ok("[4] the move wrote the page's workflow stamp", !!w);
  ok("[4] ...with a TTL, so it does not stay forever", Number(w?.opts?.ttl?.value) > 0 && w?.opts?.ttl?.unit === "SECONDS");
  await kvs.set(`byline-stamp-${PAGE}`, { stamp: "x" });
  // As the hourly sweep calls it (triggers.js): the approvals teardown runs too — and it touches the byline,
  // which used to write the stamp back after it was deleted (seen live on 0b4508e).
  const { clearPageApprovals } = await import("../src/server/capsules/workflow/approvals.js");
  await logic.purgePageWorkflow(PAGE, { clearApprovals: clearPageApprovals });
  eq("[4] a purged page's workflow stamp is deleted", await realGet(STAMP), undefined);
  eq("[4] ...and its byline stamp", await realGet(`byline-stamp-${PAGE}`), undefined);
} finally {
  loud();
  kvs.get = realGet; kvs.set = realSet;
}

// 1. The page-details window sends the state it shows, and re-reads on a stale answer.
{
  const pd = read("src/ui/surfaces/page-details/index.jsx");
  const call = (pd.match(/invoke\("request-transition",\s*\{[^}]*\}\)/) || [""])[0];
  ok("[1] page details: Move sends fromStateId = the state the window shows", /fromStateId:\s*wf\.state\?\.id/.test(call));
}
// 2. "Sign & move" keeps the state the move was picked from.
{
  const rb = read("src/ui/surfaces/doc-ribbon/index.jsx");
  ok("[2] the signing dialog remembers the state the move was picked from", /setSignMove\(\{\s*toStateId,\s*fromStateId[^}]*\}\)/.test(rb));
  ok("[2] Sign & move retries from that state", /doTransition\(signMove\.toStateId,\s*signMove\.fromStateId\)/.test(rb));
  ok("[2] doTransition takes the from-state", /const doTransition = useCallback\(async \(toStateId, fromStateId = workflow\.state\?\.id\)/.test(rb));
}
report("workflow-followups");
