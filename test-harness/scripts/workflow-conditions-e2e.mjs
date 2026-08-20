// Live E2E for #46 transition conditions + AI gate.
// Part A (content conditions) is driven end-to-end through the gated resolver (deterministic).
// Part B (the async AI gate) is verified by SIMULATING the worker's verdict via the aiVerdict
// hook (the real LLM verdict is non-deterministic) — this exercises the compound completion,
// version-pin, CAS, and reaper wiring against real KVS + real transitions.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { get, post, put, del } from "../lib/confluence.mjs";

const HR = "/Users/mihaiperdum/Projects/Sentinel Vault/test-harness";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0, passed = 0;
const check = (l, c) => { total++; if (c) { passed++; console.log(`ok   ${l}`); } else { console.log(`FAIL ${l}`); } };
function parseEnv(t){const o={};for(const l of t.split(/\r?\n/)){const s=l.trim();if(!s||s.startsWith("#"))continue;const i=s.indexOf("=");if(i>0)o[s.slice(0,i).trim()]=s.slice(i+1).trim();}return o;}
const env = { ...process.env };
for (const p of [join(HR, ".env"), join(homedir(), "Projects/forge-live-harness/.env")]) if (existsSync(p)) for (const [k,v] of Object.entries(parseEnv(readFileSync(p,"utf8")))) if(!env[k]) env[k]=v;
const HOOK = { url: env.SENTINEL_TESTHOOK_URL, secret: env.HARNESS_SECRET };
const hook = async (params) => { const r = await fetch(`${HOOK.url}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${HOOK.secret}` } }); const t = await r.text(); if (!r.ok) throw new Error(`hook ${params.fn} ${r.status}: ${t.slice(0,200)}`); return JSON.parse(t); };
const kvsGet = async (key) => (await hook({ what: "kvs", key })).value;
const kvsSet = (key, value) => hook({ what: "set", key, value: JSON.stringify(value) });
const kvsDel = (key) => hook({ what: "delete", key }).catch(() => {});
const rec = async (id) => kvsGet(`workflow-state-${id}`);
const pend = async (id) => kvsGet(`workflow-pending-${id}`);
const verOf = async (id) => (await get(`/api/v2/pages/${id}`))?.version?.number;

// SV-SEC-1: request-transition now requires the CALLER's own edit rights on the page (moving a
// page's governance state is changing the page), so the actor has to be a real account. A
// synthetic id is correctly refused, which is the gate working — see authz-content-gate.spec.ts.
const { currentUser } = await import("../lib/confluence.mjs");
const me = await currentUser();
const spaceKey = env.SV_SPACE_KEY || "WFH";
const space = (await get(`/api/v2/spaces?keys=${spaceKey}`))?.results?.[0];
const pages = [];
const priorWfSettings = await kvsGet(`workflow-settings-${spaceKey}`);
const priorValCfg = await kvsGet(`validation-config-space-${spaceKey}`);
const priorValGlobal = await kvsGet("validation-config-global");

const mkPage = async (title, html) => {
  const p = await post(`/api/v2/pages`, { spaceId: space.id, status: "current", title: `${title} ${Date.now()}`, body: { representation: "storage", value: html } });
  pages.push(p.id);
  await hook({ what: "invoke", fn: "assignWorkflow", pageId: p.id, spaceKey });
  await hook({ what: "invoke", fn: "transitionWorkflow", pageId: p.id, spaceKey, to: "in_review" });
  return p;
};
const setWf = (ec) => kvsSet(`workflow-settings-${spaceKey}`, { enabled: true, autoAssignNew: false, workflowId: "default", entryConditions: ec });

try {
  // === Part A — content conditions (end-to-end, deterministic) ===
  // Space validation rule: a "Rollback plan" heading is REQUIRED (block severity).
  // Global validation is OFF — the transition condition must still enforce (it uses the
  // enabled-INDEPENDENT rule resolver; the fix for the "fails open when the master switch is
  // off" defect the adversarial review caught).
  await kvsSet("validation-config-global", { ...(priorValGlobal || {}), enabled: false });
  await kvsSet(`validation-config-space-${spaceKey}`, {
    rules: [{ id: "r-rollback", type: "required-heading", label: "Rollback plan heading", severity: "block", config: { text: "Rollback plan" } }],
    modes: { advisory: true }, ai: null,
  });
  // Gate the NON-enforce draft→in_review transition, so the content condition is the ONLY
  // gate (approved would also hit the steward/approval gate, muddying the test).
  await setWf({ in_review: { requireRules: true } });

  // A page in Draft (assign only — don't advance to in_review yet).
  const pA = await post(`/api/v2/pages`, { spaceId: space.id, status: "current", title: `HARNESS cond-rules ${Date.now()}`, body: { representation: "storage", value: "<p>no rollback heading here</p>" } });
  pages.push(pA.id);
  await hook({ what: "invoke", fn: "assignWorkflow", pageId: pA.id, spaceKey });
  const blocked = (await hook({ what: "invoke", fn: "reqTransition", pageId: pA.id, to: "in_review", actor: me.accountId })).result;
  check("transition BLOCKED when required content missing", blocked?.success === false && blocked?.blocked === true);
  check("block result carries the violation", (blocked?.violations || []).some((v) => v.ruleId === "r-rollback"));
  // Add the required heading → the transition is allowed and completes.
  await put(`/api/v2/pages/${pA.id}`, { id: pA.id, status: "current", title: pA.title, body: { representation: "storage", value: "<h2>Rollback plan</h2><p>steps…</p>" }, version: { number: (await verOf(pA.id)) + 1 } });
  await sleep(1500);
  const allowed = (await hook({ what: "invoke", fn: "reqTransition", pageId: pA.id, to: "in_review", actor: me.accountId })).result;
  check("transition ALLOWED once required content is present", allowed?.blocked !== true && (await rec(pA.id))?.stateId === "in_review");

  // Authority: an AI-only enforce gate must NOT downgrade the steward requirement (a
  // non-steward can't drive an enforce transition just because AI review is required).
  await setWf({ approved: { requireAi: true } });
  const pAuth = await mkPage("HARNESS cond-authz", "<p>authz body</p>");
  // The actor is REAL (so it clears the SV-SEC-1 edit gate and the steward requirement is what
  // is actually under test) but is not a steward here: in a webtrigger asUser() has no context,
  // so isOperatorSteward can only answer from the explicit adminUsers list, and this space has
  // none. That is precisely the authority the enforce transition must still demand.
  const authz = (await hook({ what: "invoke", fn: "reqTransition", pageId: pAuth.id, to: "approved", actor: me.accountId })).result;
  check("AI-only enforce gate still requires a steward requester (no authority downgrade)", authz?.success === false && /steward/i.test(authz?.reason || ""));
  check("blocked non-steward request did NOT transition", (await rec(pAuth.id))?.stateId === "in_review");

  // === Part B — the AI gate wiring (simulated verdicts) ===
  await setWf({}); // clear content gate; drive the pending directly
  const seedPending = async (pageId, { approvers = [], aiStatus = "pending", pinnedVersion }) => {
    const pv = pinnedVersion ?? await verOf(pageId);
    await kvsSet(`workflow-pending-${pageId}`, {
      toStateId: "approved", toStateName: "Approved", approvalId: "approval", requestedBy: "requester", requestedByName: "Requester",
      requestedAt: new Date().toISOString(), pinnedVersion: pv, approvers, mode: "any", min: 1, spaceKey,
      aiGate: { required: true, status: aiStatus, threshold: "medium", reviewedVersion: null, reason: null, enqueuedAt: Date.now() },
    });
    return pv;
  };

  // B1: AI-only gate — verdict PASSED → the transition completes.
  const pB = await mkPage("HARNESS cond-ai-pass", "<p>ai gate pass</p>");
  const pvB = await seedPending(pB.id, { approvers: [] });
  const rB = (await hook({ what: "invoke", fn: "aiVerdict", pageId: pB.id, status: "passed", version: String(pvB) })).result;
  check("AI-only gate: passed verdict is applied", rB?.applied === true && rB?.status === "passed");
  await sleep(1200);
  check("AI-only gate: passed → page transitioned to Approved", (await rec(pB.id))?.stateId === "approved");
  check("AI-only gate: pending cleared after completion", !(await pend(pB.id)));

  // B2: AI verdict FAILED → transition blocked, pending stays.
  const pC = await mkPage("HARNESS cond-ai-fail", "<p>ai gate fail</p>");
  await seedPending(pC.id, { approvers: [] });
  const rC = (await hook({ what: "invoke", fn: "aiVerdict", pageId: pC.id, status: "failed", reason: "2 issues" })).result;
  check("AI gate: failed verdict recorded", rC?.applied === true && rC?.status === "failed");
  check("AI gate: failed → NOT transitioned (still in_review)", (await rec(pC.id))?.stateId === "in_review");
  check("AI gate: failed → pending retained (requester re-requests)", (await pend(pC.id))?.aiGate?.status === "failed");

  // B3: version-pin — AI scored a DIFFERENT version than pinned → stale → failed.
  const pD = await mkPage("HARNESS cond-ai-stale", "<p>ai gate stale</p>");
  const pvD = await seedPending(pD.id, { approvers: [] });
  const rD = (await hook({ what: "invoke", fn: "aiVerdict", pageId: pD.id, status: "passed", version: String(pvD + 5) })).result;
  check("AI gate: verdict on a different version is treated as stale/failed", rD?.status === "failed");
  check("AI gate: stale verdict does NOT transition", (await rec(pD.id))?.stateId === "in_review");

  // B4: CAS — a duplicate verdict delivery is a no-op.
  const pE = await mkPage("HARNESS cond-ai-cas", "<p>ai gate cas</p>");
  const pvE = await seedPending(pE.id, { approvers: [] });
  await hook({ what: "invoke", fn: "aiVerdict", pageId: pE.id, status: "passed", version: String(pvE) });
  const dup = (await hook({ what: "invoke", fn: "aiVerdict", pageId: pE.id, status: "failed", version: String(pvE) })).result;
  check("AI gate: duplicate verdict is a no-op (CAS on the pending record)", dup?.applied === false);

  // B5: compound — AI passes first, then a human approval completes it.
  const pF = await mkPage("HARNESS cond-ai-human", "<p>ai+human</p>");
  const pvF = await seedPending(pF.id, { approvers: ["acc-A"] });
  await kvsSet(`workflow-approval-${pF.id}-approved-approval-acc-A`, { pageId: pF.id, stateId: "approved", approverAccountId: "acc-A", status: "pending", requestedAt: new Date().toISOString(), pinnedVersion: pvF });
  const rF1 = (await hook({ what: "invoke", fn: "aiVerdict", pageId: pF.id, status: "passed", version: String(pvF) })).result;
  check("compound: AI passes but waits for the human quorum", rF1?.status === "passed" && rF1?.waiting === "humans" && (await rec(pF.id))?.stateId === "in_review");
  const rF2 = (await hook({ what: "invoke", fn: "decideApproval", pageId: pF.id, approver: "acc-A", decision: "approved" })).result;
  check("compound: the human vote (AI already passed) completes the transition", (await rec(pF.id))?.stateId === "approved");

  // B6: reaper — a stuck (stale-enqueued) AI gate is failed by the sweep.
  const pG = await mkPage("HARNESS cond-ai-reaper", "<p>ai reaper</p>");
  const pvG = await seedPending(pG.id, { approvers: [] });
  const stuck = await pend(pG.id); stuck.aiGate.enqueuedAt = Date.now() - 20 * 60 * 1000; // 20 min ago
  await kvsSet(`workflow-pending-${pG.id}`, stuck);
  const sweep = (await hook({ what: "invoke", fn: "workflowSweep" })).result;
  check("reaper: sweep reports an AI timeout", (sweep?.aiTimedOut || 0) >= 1);
  check("reaper: stuck AI gate flipped to failed", (await pend(pG.id))?.aiGate?.status === "failed");
} finally {
  if (priorWfSettings) await kvsSet(`workflow-settings-${spaceKey}`, priorWfSettings).catch(() => {}); else await kvsDel(`workflow-settings-${spaceKey}`);
  if (priorValCfg) await kvsSet(`validation-config-space-${spaceKey}`, priorValCfg).catch(() => {}); else await kvsDel(`validation-config-space-${spaceKey}`);
  if (priorValGlobal) await kvsSet("validation-config-global", priorValGlobal).catch(() => {}); else await kvsDel("validation-config-global");
  for (const id of pages) {
    await del(`/api/v2/pages/${id}`).catch(() => {});
    for (const st of ["draft", "in_review", "approved", "expired"]) await kvsDel(`workflow-idx-${spaceKey}-${st}-${id}`);
    for (const k of [`workflow-state-${id}`, `workflow-autoassigned-${id}`, `workflow-pending-${id}`, `workflow-approval-${id}-approved-approval-acc-A`]) await kvsDel(k);
  }
  console.log(`     cleaned up ${pages.length} pages + settings`);
}

console.log(`\nworkflow-conditions-e2e: ${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
