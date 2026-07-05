// Live E2E for bulk workflow assignment (#42, iteration 4). Runs in a DEDICATED
// throwaway space so it never touches real content: creates the space + a couple of
// pages, enables workflow with auto-assign OFF (so the pages start with no workflow),
// drives the real bulk-assign path via the dev hook, asserts the pages get workflows,
// then deletes the space.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { get, post, request } from "../lib/confluence.mjs";

const HARNESS_ROOT = "/Users/mihaiperdum/Projects/Sentinel Vault/test-harness";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0, passed = 0;
const check = (label, cond) => { total++; if (cond) { passed++; console.log(`ok   ${label}`); } else { console.log(`FAIL ${label}`); } };

function parseEnv(t){const o={};for(const l of t.split(/\r?\n/)){const s=l.trim();if(!s||s.startsWith("#"))continue;const i=s.indexOf("=");if(i>0)o[s.slice(0,i).trim()]=s.slice(i+1).trim();}return o;}
const env = { ...process.env };
for (const p of [join(HARNESS_ROOT, ".env"), join(homedir(), "Projects/forge-live-harness/.env")]) if (existsSync(p)) for (const [k,v] of Object.entries(parseEnv(readFileSync(p,"utf8")))) if(!env[k]) env[k]=v;
if (!env.SENTINEL_TESTHOOK_URL || !env.HARNESS_SECRET) { console.log("FAIL missing hook config"); process.exit(1); }
const HOOK = { url: env.SENTINEL_TESTHOOK_URL, secret: env.HARNESS_SECRET };
async function hook(params){const r=await fetch(`${HOOK.url}?${new URLSearchParams(params)}`,{headers:{Authorization:`Bearer ${HOOK.secret}`}});const t=await r.text();if(!r.ok)throw new Error(`hook ${params.fn||params.what} → ${r.status}: ${t.slice(0,200)}`);return JSON.parse(t);}
const kvsGet = async (key) => (await hook({ what: "kvs", key })).value;

const spaceKey = "SVWFB" + Date.now().toString().slice(-7);
let space = null;
const pages = [];
const allPageIds = [];
try {
  space = await request("POST", "/rest/api/space", { body: { key: spaceKey, name: "SV Workflow Bulk Test " + spaceKey } });
  const spaceId = space.id;
  console.log(`     created throwaway space ${spaceKey} (${spaceId})`);
  // capture the auto-created Home page so we clean its keys too
  const initial = await get(`/api/v2/spaces/${spaceId}/pages?limit=25`);
  for (const p of initial?.results || []) allPageIds.push(p.id);

  for (let i = 0; i < 2; i++) {
    const p = await post(`/api/v2/pages`, { spaceId, status: "current", title: `bulk page ${i}`, body: { representation: "storage", value: `<p>bulk ${i}</p>` } });
    pages.push(p); allPageIds.push(p.id);
  }

  // enable workflow, auto-assign OFF → the pages start with NO workflow
  await hook({ what: "invoke", fn: "setSpaceWorkflowSettings", spaceKey, enabled: "1", autoAssignNew: "0" });
  await sleep(1500);
  const pre = await Promise.all(pages.map((p) => kvsGet(`workflow-state-${p.id}`)));
  check("test pages start with no workflow (auto-assign off)", pre.every((r) => r == null));

  // drive the real bulk-assign path (scans only this small space)
  const bulk = await hook({ what: "invoke", fn: "bulkAssignWorkflow", spaceKey, spaceId });
  check("bulk-assign reports success", bulk.result?.success === true);
  check("bulk-assign assigned our pages", (bulk.result?.assigned || 0) >= pages.length);

  const post2 = await Promise.all(pages.map((p) => kvsGet(`workflow-state-${p.id}`)));
  check("both test pages now have a draft workflow", post2.every((r) => r?.stateId === "draft" && r?.workflowId === "default"));

  // idempotent second run — no re-assign, one log entry each, reason "bulk-assigned"
  await hook({ what: "invoke", fn: "bulkAssignWorkflow", spaceKey, spaceId });
  const logs = await Promise.all(pages.map((p) => hook({ what: "invoke", fn: "getWorkflow", pageId: p.id, spaceKey, withLog: "1" })));
  check("idempotent — one log entry per page after a second bulk run", logs.every((w) => (w.result?.log || []).length === 1));
  check("bulk log reason is 'bulk-assigned'", logs.every((w) => w.result?.log?.[0]?.reason === "bulk-assigned"));
} finally {
  // delete the throwaway space (removes all pages) + the KVS records for known pages
  if (space) await request("DELETE", `/rest/api/space/${spaceKey}`, { raw: true }).catch(() => {});
  await hook({ what: "delete", key: `workflow-settings-${spaceKey}` }).catch(() => {});
  for (const id of allPageIds) {
    await hook({ what: "delete", key: `workflow-state-${id}` }).catch(() => {});
    await hook({ what: "delete", key: `workflow-idx-${spaceKey}-draft-${id}` }).catch(() => {});
    await hook({ what: "delete", key: `workflow-autoassigned-${id}` }).catch(() => {});
  }
  console.log(`     deleted space ${spaceKey} + cleaned ${allPageIds.length} pages' keys`);
}

console.log(`\nworkflow-bulk-e2e: ${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
