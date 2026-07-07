// Live E2E for #44 enforced Approved state. The harness user is a site admin (steward),
// so a REAL edit is always "privileged" and won't trigger a revert — instead we drive the
// enforcement DECISION with SYNTHETIC actors (enforceDecision hook) and the revert MECHANISM
// directly (sweepRevert hook), and seed drift via the dev KVS hook. Asserts on real page
// bodies + workflow-state records.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { get, post, put, del, currentUser } from "../lib/confluence.mjs";

const HARNESS_ROOT = "/Users/mihaiperdum/Projects/Sentinel Vault/test-harness";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0, passed = 0;
const check = (l, c) => { total++; if (c) { passed++; console.log(`ok   ${l}`); } else { console.log(`FAIL ${l}`); } };
function parseEnv(t){const o={};for(const l of t.split(/\r?\n/)){const s=l.trim();if(!s||s.startsWith("#"))continue;const i=s.indexOf("=");if(i>0)o[s.slice(0,i).trim()]=s.slice(i+1).trim();}return o;}
const env = { ...process.env };
for (const p of [join(HARNESS_ROOT, ".env"), join(homedir(), "Projects/forge-live-harness/.env")]) if (existsSync(p)) for (const [k,v] of Object.entries(parseEnv(readFileSync(p,"utf8")))) if(!env[k]) env[k]=v;
if (!env.SENTINEL_TESTHOOK_URL || !env.HARNESS_SECRET) { console.log("FAIL missing hook config"); process.exit(1); }
const HOOK = { url: env.SENTINEL_TESTHOOK_URL, secret: env.HARNESS_SECRET };
async function hook(params){const r=await fetch(`${HOOK.url}?${new URLSearchParams(params)}`,{headers:{Authorization:`Bearer ${HOOK.secret}`}});const t=await r.text();if(!r.ok)throw new Error(`hook ${params.fn||params.what} → ${r.status}: ${t.slice(0,200)}`);return JSON.parse(t);}
const kvsGet = async (key) => (await hook({ what: "kvs", key })).value;
const kvsSet = (key, value) => hook({ what: "set", key, value: JSON.stringify(value) });
const rec = async (id) => kvsGet(`workflow-state-${id}`);
// Seed the content-property probe (the enforcement probe's fast path reads this first).
const setEnforceProp = async (id, approvedVersion) => {
  const props = await get(`/api/v2/pages/${id}/properties?key=sentinel-vault-workflow`);
  const ex = props?.results?.[0];
  const value = { workflowId: "default", stateId: "approved", enteredAt: new Date().toISOString(), enforce: true, approvedVersion };
  if (ex) await put(`/api/v2/pages/${id}/properties/${ex.id}`, { key: "sentinel-vault-workflow", value, version: { number: (ex.version?.number || 1) + 1 } });
  else await post(`/api/v2/pages/${id}/properties`, { key: "sentinel-vault-workflow", value });
};
const bodyOf = async (id) => (await get(`/api/v2/pages/${id}?body-format=storage`))?.body?.storage?.value || "";
const verOf = async (id) => (await get(`/api/v2/pages/${id}`))?.version?.number;

const spaceKey = env.SV_SPACE_KEY || "WFH";
const space = (await get(`/api/v2/spaces?keys=${spaceKey}`))?.results?.[0];
if (!space) { console.log(`FAIL space ${spaceKey}`); process.exit(1); }
const me = await currentUser();
// Register the harness user as a space steward via the app's adminUsers list (the
// reliable trigger-safe steward signal). Preserve + restore any existing config.
const stewardKey = `admin-settings-space-${spaceKey}`;
const priorStewardCfg = await kvsGet(stewardKey);
await kvsSet(stewardKey, { ...(priorStewardCfg || {}), adminUsers: [...new Set([...(priorStewardCfg?.adminUsers || []).map((u) => (typeof u === "string" ? u : u?.accountId)), me.accountId])] });
const pages = [];
const mkPage = async (title, html) => {
  const p = await post(`/api/v2/pages`, { spaceId: space.id, status: "current", title: `${title} ${Date.now()}`, body: { representation: "storage", value: html } });
  pages.push(p.id);
  await hook({ what: "invoke", fn: "assignWorkflow", pageId: p.id, spaceKey });
  await hook({ what: "invoke", fn: "transitionWorkflow", pageId: p.id, spaceKey, to: "in_review" });
  return p;
};
const setEnforceMode = (mode) => hook({ what: "invoke", fn: "setSpaceWorkflowSettings", spaceKey, enabled: "1", autoAssignNew: "0" })
  .then(() => hook({ what: "set", key: `workflow-settings-${spaceKey}`, value: JSON.stringify({ enabled: true, autoAssignNew: false, workflowId: "default", enforceMode: mode }) }));

try {
  // --- A. enforce capture on transition to Approved ---
  const pA = await mkPage("HARNESS enforce-capture", "<p>v1 approved body</p>");
  const vA = await verOf(pA.id);
  await hook({ what: "invoke", fn: "transitionWorkflow", pageId: pA.id, spaceKey, to: "approved", toName: "Approved", approvers: "acc-A,acc-B", approvedVersion: String(vA) });
  const rA = await rec(pA.id);
  check("enforce transition sets enforce:true", rA?.enforce === true);
  check("captures approvedVersion", rA?.approvedVersion === vA);
  check("captures approver snapshot", JSON.stringify(rA?.approvers) === JSON.stringify(["acc-A", "acc-B"]));

  // --- B. leaving Approved clears enforcement ---
  await hook({ what: "invoke", fn: "transitionWorkflow", pageId: pA.id, spaceKey, to: "draft" });
  const rB = await rec(pA.id);
  check("leaving Approved clears enforce", rB?.enforce === false && rB?.approvedVersion == null && (rB?.approvers || []).length === 0);

  // --- C. decision logic via synthetic actors (who-wins) ---
  // Seed a clean enforced record with approvers=[acc-A]; live config also = acc-A.
  await setEnforceMode("demote");
  await kvsSet(`workflow-settings-${spaceKey}`, { enabled: true, autoAssignNew: false, workflowId: "default", enforceMode: "demote", approval: { approvers: [{ type: "user", id: "acc-A" }], mode: "any", min: 1 } });
  const pC = await mkPage("HARNESS enforce-decision", "<p>decision body</p>");
  const seedApproved = async (mode, approvers) => {
    const v = await verOf(pC.id);
    await kvsSet(`workflow-settings-${spaceKey}`, { enabled: true, autoAssignNew: false, workflowId: "default", enforceMode: mode, approval: { approvers: [{ type: "user", id: "acc-A" }], mode: "any", min: 1 } });
    await kvsSet(`workflow-state-${pC.id}`, { workflowId: "default", stateId: "approved", enteredAt: new Date().toISOString(), enforce: true, approvedVersion: v, approvers, spaceKey });
    await kvsSet(`workflow-idx-${spaceKey}-approved-${pC.id}`, { pageId: pC.id, stateId: "approved", enteredAt: new Date().toISOString() });
    await setEnforceProp(pC.id, v); // the probe fast-path reads the content property
  };
  await seedApproved("revert", ["acc-A"]);
  check("non-approver + revert mode → action=revert", (await hook({ what: "invoke", fn: "enforceDecision", pageId: pC.id, actor: "acc-STRANGER" })).result?.action === "revert");
  check("configured approver (snapshot ∩ live) → privileged", (await hook({ what: "invoke", fn: "enforceDecision", pageId: pC.id, actor: "acc-A" })).result?.action === "privileged");
  check("real steward → privileged", (await hook({ what: "invoke", fn: "enforceDecision", pageId: pC.id, actor: me.accountId })).result?.action === "privileged");
  // Revocation (Gap E): record still lists acc-A but live config no longer does.
  await kvsSet(`workflow-settings-${spaceKey}`, { enabled: true, autoAssignNew: false, workflowId: "default", enforceMode: "revert", approval: { approvers: [{ type: "user", id: "acc-B" }], mode: "any", min: 1 } });
  check("revoked approver loses privilege (snapshot ∩ live fails)", (await hook({ what: "invoke", fn: "enforceDecision", pageId: pC.id, actor: "acc-A" })).result?.action === "revert");
  // Empty approver set + revert → engine downgrades to demote (CL-5).
  await seedApproved("revert", []);
  check("empty approver set + revert → downgraded to demote", (await hook({ what: "invoke", fn: "enforceDecision", pageId: pC.id, actor: "acc-STRANGER" })).result?.action === "demote");
  check("demote actually dropped the page to Draft", (await rec(pC.id))?.stateId === "draft");

  // --- D. revert MECHANISM (sweepRevert) reverts body to approvedVersion ---
  const pD = await mkPage("HARNESS enforce-revert", "<p>ORIGINAL-APPROVED</p>");
  const vD1 = await verOf(pD.id);
  await put(`/api/v2/pages/${pD.id}`, { id: pD.id, status: "current", title: pD.title, body: { representation: "storage", value: "<p>TAMPERED-CONTENT</p>" }, version: { number: vD1 + 1 } });
  await sleep(3500); // let the tamper PUT's trigger fully settle (longer under full-suite load)
  // seed the record: approvedVersion pinned to the ORIGINAL version while the page now shows tampered
  await kvsSet(`workflow-state-${pD.id}`, { workflowId: "default", stateId: "approved", enteredAt: new Date().toISOString(), enforce: true, approvedVersion: vD1, approvers: ["acc-A"], spaceKey });
  // Retry the revert — its write can 409 against trailing trigger activity; the drift persists so a retry succeeds.
  let rev;
  for (let i = 0; i < 4; i++) { rev = await hook({ what: "invoke", fn: "sweepRevert", pageId: pD.id }); if (rev.result?.reverted) break; await sleep(2500); }
  check("sweepRevert reports success", rev.result?.reverted === true);
  let bodyD = "";
  for (let i = 0; i < 4; i++) { bodyD = await bodyOf(pD.id); if (bodyD.includes("ORIGINAL-APPROVED")) break; await sleep(1500); }
  check("body reverted to the approved version", bodyD.includes("ORIGINAL-APPROVED") && !bodyD.includes("TAMPERED"));
  check("approvedVersion re-stamped forward after revert", (await rec(pD.id))?.approvedVersion > vD1);

  // --- E. CL-1: empty/unreadable baseline never blanks the page ---
  const pE = await mkPage("HARNESS enforce-noblank", "<p>KEEP-ME-SAFE</p>");
  await kvsSet(`workflow-state-${pE.id}`, { workflowId: "default", stateId: "approved", enteredAt: new Date().toISOString(), enforce: true, approvedVersion: 99999, approvers: ["acc-A"], spaceKey });
  const noblank = await hook({ what: "invoke", fn: "sweepRevert", pageId: pE.id });
  check("revert aborts on unreadable baseline (no success)", noblank.result?.reverted === false);
  check("page NOT blanked — content preserved", (await bodyOf(pE.id)).includes("KEEP-ME-SAFE"));
  // A failed revert must NOT launder the tamper into the baseline (review fix #1 principle).
  check("aborted revert does NOT advance approvedVersion", (await rec(pE.id))?.approvedVersion === 99999);

  // --- F. sweep self-heals a null baseline ---
  const pF = await mkPage("HARNESS enforce-heal", "<p>heal me</p>");
  await kvsSet(`workflow-state-${pF.id}`, { workflowId: "default", stateId: "approved", enteredAt: new Date().toISOString(), enforce: true, approvedVersion: null, approvers: ["acc-A"], spaceKey });
  await kvsSet(`workflow-idx-${spaceKey}-approved-${pF.id}`, { pageId: pF.id, stateId: "approved", enteredAt: new Date().toISOString() });
  await hook({ what: "invoke", fn: "workflowSweep" });
  check("sweep self-heals a null approvedVersion", (await rec(pF.id))?.approvedVersion != null);

  // --- G. sweep adopts an authorized (steward-authored) drift instead of reverting ---
  const pG = await mkPage("HARNESS enforce-adopt", "<p>authored by steward</p>");
  const vG = await verOf(pG.id);
  await put(`/api/v2/pages/${pG.id}`, { id: pG.id, status: "current", title: pG.title, body: { representation: "storage", value: "<p>steward legit edit</p>" }, version: { number: vG + 1 } });
  await sleep(1200);
  await kvsSet(`workflow-state-${pG.id}`, { workflowId: "default", stateId: "approved", enteredAt: new Date().toISOString(), enforce: true, approvedVersion: vG, approvers: ["acc-A"], spaceKey });
  await kvsSet(`workflow-idx-${spaceKey}-approved-${pG.id}`, { pageId: pG.id, stateId: "approved", enteredAt: new Date().toISOString() });
  await hook({ what: "invoke", fn: "workflowSweep" });
  check("sweep adopts a steward-authored drift (re-stamps, no revert)", (await rec(pG.id))?.approvedVersion > vG);
  check("steward-authored content preserved by the sweep", (await bodyOf(pG.id)).includes("steward legit edit"));
} finally {
  // restore the steward config + reset space settings so nothing leaks into other suites
  if (priorStewardCfg) await kvsSet(stewardKey, priorStewardCfg).catch(() => {});
  else await hook({ what: "delete", key: stewardKey }).catch(() => {});
  await hook({ what: "delete", key: `workflow-settings-${spaceKey}` }).catch(() => {});
  for (const id of pages) {
    await del(`/api/v2/pages/${id}`).catch(() => {});
    for (const st of ["draft", "in_review", "approved", "expired"]) await hook({ what: "delete", key: `workflow-idx-${spaceKey}-${st}-${id}` }).catch(() => {});
    for (const k of [`workflow-state-${id}`, `workflow-autoassigned-${id}`, `workflow-pending-${id}`, `workflow-integrity-notified-${id}`]) await hook({ what: "delete", key: k }).catch(() => {});
  }
  console.log(`     cleaned up ${pages.length} pages + settings`);
}

console.log(`\nworkflow-enforce-e2e: ${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
