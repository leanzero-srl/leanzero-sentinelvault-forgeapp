// Live E2E for at-scale workflow assignment (#42, iteration 3). Drives the REAL
// deployed trigger: enables a space's workflow auto-assign via the dev hook, creates
// a real page, and asserts the created:page trigger auto-assigns the default workflow.
// Cleanup ALWAYS disables the space setting so it can't leak into other suites.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { cfg } from "../lib/env.mjs";
import { get, post, put, del } from "../lib/confluence.mjs";

const C = cfg();
const HARNESS_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0, passed = 0;
const check = (label, cond) => { total++; if (cond) { passed++; console.log(`ok   ${label}`); } else { console.log(`FAIL ${label}`); } };

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}
function hookConfig() {
  const env = { ...process.env };
  for (const p of [join(HARNESS_ROOT, ".env"), join(homedir(), "Projects/forge-live-harness/.env")]) {
    if (existsSync(p)) for (const [k, v] of Object.entries(parseEnv(readFileSync(p, "utf8")))) if (!env[k]) env[k] = v;
  }
  if (!env.SENTINEL_TESTHOOK_URL || !env.HARNESS_SECRET) {
    console.log("FAIL SENTINEL_TESTHOOK_URL / HARNESS_SECRET not found"); process.exit(1);
  }
  return { url: env.SENTINEL_TESTHOOK_URL, secret: env.HARNESS_SECRET };
}
const HOOK = hookConfig();
async function hook(params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${HOOK.url}?${qs}`, { headers: { Authorization: `Bearer ${HOOK.secret}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(`hook ${params.what}/${params.fn || ""} → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}
const kvsGet = async (key) => (await hook({ what: "kvs", key })).value;

const spaceKey = C.spaceKey || "WFH";
const space = (await get(`/api/v2/spaces?keys=${encodeURIComponent(spaceKey)}`))?.results?.[0];
if (!space) { console.log(`FAIL space ${spaceKey} not found`); process.exit(1); }

let page = null;
try {
  // 1. enable auto-assign for the space
  const en = await hook({ what: "invoke", fn: "setSpaceWorkflowSettings", spaceKey, enabled: "1", autoAssignNew: "1" });
  check("space settings enabled", en.result?.success === true && en.result?.settings?.autoAssignNew === true);
  const readSettings = await hook({ what: "invoke", fn: "getSpaceWorkflowSettings", spaceKey });
  check("settings read back enabled", readSettings.result?.enabled === true);

  // 2. create a real page → fires created:page → trigger auto-assigns
  page = await post(`/api/v2/pages`, {
    spaceId: space.id, status: "current", title: `HARNESS wf-autoassign ${Date.now()}`,
    body: { representation: "storage", value: "<p>auto-assign e2e</p>" },
  });
  console.log(`     page ${page.id} created in ${spaceKey}`);

  // 3. poll for the trigger to auto-assign (async event; give it up to ~45s)
  let rec = null;
  for (let i = 0; i < 15; i++) {
    await sleep(3000);
    rec = await kvsGet(`workflow-state-${page.id}`);
    if (rec) break;
  }
  check("page auto-assigned a workflow by the trigger", rec?.workflowId === "default");
  check("auto-assigned to initial state (draft)", rec?.stateId === "draft");

  // 4. content property mirror written by the trigger path
  let prop = null;
  for (let i = 0; i < 4; i++) { // best-effort property write can lag under full-suite load
    const props = await get(`/api/v2/pages/${page.id}/properties?key=sentinel-vault-workflow`);
    prop = props?.results?.[0]?.value;
    if (prop?.stateId === "draft") break;
    await sleep(1500);
  }
  check("content property present", prop?.stateId === "draft");

  // 5. log records the auto-assign with its reason (the log query is eventually consistent → poll)
  let log = [];
  for (let i = 0; i < 4; i++) {
    const wf = await hook({ what: "invoke", fn: "getWorkflow", pageId: page.id, spaceKey, withLog: "1" });
    log = wf.result?.log || [];
    if (log.length === 1 && log[0]?.reason === "auto-assigned on create") break;
    await sleep(1500);
  }
  check("log shows auto-assign", log.length === 1 && log[0]?.reason === "auto-assigned on create");

  // 6. idempotency: a second page event must NOT create a duplicate/second assignment.
  // Read the live version (the #47 native-state mirror bumps it on assign) and increment.
  const curVer = (await get(`/api/v2/pages/${page.id}`))?.version?.number || 1;
  await put(`/api/v2/pages/${page.id}`, {
    id: page.id, status: "current", title: page.title,
    body: { representation: "storage", value: "<p>auto-assign e2e edited</p>" },
    version: { number: curVer + 1 },
  });
  await sleep(8000);
  const wf2 = await hook({ what: "invoke", fn: "getWorkflow", pageId: page.id, spaceKey, withLog: "1" });
  check("idempotent — still one log entry after an update", (wf2.result?.log || []).length === 1);
  check("still in draft (update did not re-assign)", wf2.result?.record?.stateId === "draft");
} finally {
  // cleanup: ALWAYS disable the space setting (must not leak into other suites) + remove test state
  await hook({ what: "delete", key: `workflow-settings-${spaceKey}` }).catch(() => {});
  if (page) {
    await del(`/api/v2/pages/${page.id}`).catch(() => {});
    await hook({ what: "delete", key: `workflow-state-${page.id}` }).catch(() => {});
    await hook({ what: "delete", key: `workflow-idx-${spaceKey}-draft-${page.id}` }).catch(() => {});
    await hook({ what: "delete", key: `workflow-autoassigned-${page.id}` }).catch(() => {});
    console.log(`     cleaned up page ${page.id} + space settings`);
  }
}

console.log(`\nworkflow-autoassign-e2e: ${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
