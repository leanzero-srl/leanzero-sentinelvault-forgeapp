// Live E2E for multi-approver transitions (#43, iteration 5). Drives the real
// approval engine via the dev hook: assign a workflow, move to In Review, open an
// approval for In Review→Approved with two approvers, and verify the page transitions
// only when the decision mode's threshold is met (and is cleared on denial).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { get, post, del } from "../lib/confluence.mjs";

const HARNESS_ROOT = "/Users/mihaiperdum/Projects/Sentinel Vault/test-harness";
let total = 0, passed = 0;
const check = (label, cond) => { total++; if (cond) { passed++; console.log(`ok   ${label}`); } else { console.log(`FAIL ${label}`); } };
function parseEnv(t){const o={};for(const l of t.split(/\r?\n/)){const s=l.trim();if(!s||s.startsWith("#"))continue;const i=s.indexOf("=");if(i>0)o[s.slice(0,i).trim()]=s.slice(i+1).trim();}return o;}
const env = { ...process.env };
for (const p of [join(HARNESS_ROOT, ".env"), join(homedir(), "Projects/forge-live-harness/.env")]) if (existsSync(p)) for (const [k,v] of Object.entries(parseEnv(readFileSync(p,"utf8")))) if(!env[k]) env[k]=v;
if (!env.SENTINEL_TESTHOOK_URL || !env.HARNESS_SECRET) { console.log("FAIL missing hook config"); process.exit(1); }
const HOOK = { url: env.SENTINEL_TESTHOOK_URL, secret: env.HARNESS_SECRET };
async function hook(params){const r=await fetch(`${HOOK.url}?${new URLSearchParams(params)}`,{headers:{Authorization:`Bearer ${HOOK.secret}`}});const t=await r.text();if(!r.ok)throw new Error(`hook ${params.fn||params.what} → ${r.status}: ${t.slice(0,200)}`);return JSON.parse(t);}
const kvsGet = async (key) => (await hook({ what: "kvs", key })).value;
const spaceKey = env.SV_SPACE_KEY || "WFH";
const space = (await get(`/api/v2/spaces?keys=${spaceKey}`))?.results?.[0];
if (!space) { console.log(`FAIL space ${spaceKey} not found`); process.exit(1); }

const stateOf = async (id) => (await kvsGet(`workflow-state-${id}`))?.stateId;
const cleanKeys = async (id) => { for (const k of [`workflow-state-${id}`, `workflow-idx-${spaceKey}-draft-${id}`, `workflow-idx-${spaceKey}-in_review-${id}`, `workflow-idx-${spaceKey}-approved-${id}`, `workflow-autoassigned-${id}`, `workflow-pending-${id}`]) await hook({ what: "delete", key: k }).catch(()=>{}); };

const pages = [];
async function newInReviewPage(title) {
  const p = await post(`/api/v2/pages`, { spaceId: space.id, status: "current", title: `${title} ${Date.now()}`, body: { representation: "storage", value: "<p>approval e2e</p>" } });
  pages.push(p.id);
  await hook({ what: "invoke", fn: "assignWorkflow", pageId: p.id, spaceKey });
  await hook({ what: "invoke", fn: "transitionWorkflow", pageId: p.id, spaceKey, to: "in_review" });
  return p;
}

try {
  // --- APPROVE path: mode=all, two approvers ---
  const p1 = await newInReviewPage("HARNESS approval-all");
  check("p1 starts In Review", (await stateOf(p1.id)) === "in_review");
  await hook({ what: "invoke", fn: "requestApproval", pageId: p1.id, spaceKey, to: "approved", approvers: "acc-A,acc-B", mode: "all" });
  check("approval opened — page NOT yet transitioned", (await stateOf(p1.id)) === "in_review");
  const st1 = (await hook({ what: "invoke", fn: "pageApprovals", pageId: p1.id })).result;
  check("two pending approvers recorded", st1?.pending === true && st1.approvers?.length === 2);

  const d1 = (await hook({ what: "invoke", fn: "decideApproval", pageId: p1.id, approver: "acc-A", decision: "approved" })).result;
  check("first approval (mode all) keeps it pending", d1?.outcome === "pending" && (await stateOf(p1.id)) === "in_review");
  const d2 = (await hook({ what: "invoke", fn: "decideApproval", pageId: p1.id, approver: "acc-B", decision: "approved" })).result;
  check("second approval completes the transition", d2?.outcome === "approved" && (await stateOf(p1.id)) === "approved");
  check("pending marker cleared after approval", (await kvsGet(`workflow-pending-${p1.id}`)) == null);

  // --- DENY path: mode=all, a denial rejects and clears ---
  const p2 = await newInReviewPage("HARNESS approval-deny");
  await hook({ what: "invoke", fn: "requestApproval", pageId: p2.id, spaceKey, to: "approved", approvers: "acc-A,acc-B", mode: "all" });
  const d3 = (await hook({ what: "invoke", fn: "decideApproval", pageId: p2.id, approver: "acc-A", decision: "denied", reason: "not ready" })).result;
  check("a denial (mode all) rejects the transition", d3?.outcome === "denied");
  check("page stays In Review after denial", (await stateOf(p2.id)) === "in_review");
  check("pending cleared after denial", (await kvsGet(`workflow-pending-${p2.id}`)) == null);

  // --- non-approver cannot decide ---
  const p3 = await newInReviewPage("HARNESS approval-authz");
  await hook({ what: "invoke", fn: "requestApproval", pageId: p3.id, spaceKey, to: "approved", approvers: "acc-A", mode: "any" });
  const d4 = (await hook({ what: "invoke", fn: "decideApproval", pageId: p3.id, approver: "acc-STRANGER", decision: "approved" })).result;
  check("a non-approver cannot decide", d4?.success === false);
  check("page still In Review (stranger rejected)", (await stateOf(p3.id)) === "in_review");
} finally {
  for (const id of pages) { await del(`/api/v2/pages/${id}`).catch(()=>{}); await cleanKeys(id); }
  console.log(`     cleaned up ${pages.length} pages`);
}

console.log(`\nworkflow-approval-e2e: ${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
