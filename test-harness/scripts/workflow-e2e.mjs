// Live E2E for the workflow state engine (#42). Drives the REAL deployed backend:
// creates a page, then uses the dev-gated test hook (harness-test-state, invoke=…)
// to assign the default workflow, transition it, and read state/log back — asserting
// on the KVS record, the sentinel-vault-workflow content property, and the log.
// Black-box otherwise (REST for page CRUD + property read; never imports the app).
//
// Env: SV_* (test-harness/.env) + SENTINEL_TESTHOOK_URL + HARNESS_SECRET
//      (test-harness/.env or ~/Projects/forge-live-harness/.env — same fallback as ensure-fixture).
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { cfg } from "../lib/env.mjs";
import { get, post, del } from "../lib/confluence.mjs";

const C = cfg();
const HARNESS_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
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
    console.log("FAIL SENTINEL_TESTHOOK_URL / HARNESS_SECRET not found (test-harness/.env or ~/Projects/forge-live-harness/.env)");
    process.exit(1);
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
const readProp = async (pageId, key) => {
  const props = await get(`/api/v2/pages/${pageId}/properties?key=${key}`);
  return props?.results?.[0]?.value || null;
};

// --- fixture page ---
const spaceKey = C.spaceKey || "WFH";
const space = (await get(`/api/v2/spaces?keys=${encodeURIComponent(spaceKey)}`))?.results?.[0];
if (!space) { console.log(`FAIL space ${spaceKey} not found`); process.exit(1); }
const page = await post(`/api/v2/pages`, {
  spaceId: space.id, status: "current", title: `HARNESS workflow-e2e ${Date.now()}`,
  body: { representation: "storage", value: "<p>workflow engine e2e</p>" },
});
console.log(`     page ${page.id} in ${spaceKey}`);

try {
  // 1. assign default workflow → initial state = draft
  const assigned = await hook({ what: "invoke", fn: "assignWorkflow", pageId: page.id, spaceKey });
  check("assign succeeded", assigned.result?.success === true);
  check("initial state is draft", assigned.result?.record?.stateId === "draft");

  // 2. KVS record written
  const rec = await kvsGet(`workflow-state-${page.id}`);
  check("KVS workflow-state record present", rec?.stateId === "draft" && rec?.workflowId === "default");

  // 3. by-state index written
  const idx = await kvsGet(`workflow-idx-${spaceKey}-draft-${page.id}`);
  check("by-state index entry present", idx?.pageId === page.id && idx?.stateId === "draft");

  // 4. content property mirror
  const prop = await readProp(page.id, "sentinel-vault-workflow");
  check("content property mirrors state", prop?.stateId === "draft" && prop?.workflowId === "default");

  // 5. legal transition draft → in_review
  const t1 = await hook({ what: "invoke", fn: "transitionWorkflow", pageId: page.id, spaceKey, to: "in_review" });
  check("draft → in_review succeeded", t1.result?.success === true && t1.result?.record?.stateId === "in_review");

  // 6. index moved (old gone, new present)
  const oldIdx = await kvsGet(`workflow-idx-${spaceKey}-draft-${page.id}`);
  const newIdx = await kvsGet(`workflow-idx-${spaceKey}-in_review-${page.id}`);
  check("stale draft index removed", oldIdx == null);
  check("in_review index present", newIdx?.stateId === "in_review");

  // 7. illegal transition in_review → expired (no edge) rejected, state unchanged
  const bad = await hook({ what: "invoke", fn: "transitionWorkflow", pageId: page.id, spaceKey, to: "expired" });
  check("illegal in_review → expired rejected", bad.result?.success === false);
  const still = await kvsGet(`workflow-state-${page.id}`);
  check("state unchanged after illegal transition", still?.stateId === "in_review");

  // 8. log has assign + one transition, in order, no TTL surprises
  const wf = await hook({ what: "invoke", fn: "getWorkflow", pageId: page.id, spaceKey, withLog: "1" });
  const log = wf.result?.log || [];
  check("log has 2 entries (assign + transition)", log.length === 2);
  check("log ordered: assign then draft→in_review", log[0]?.to === "draft" && log[1]?.from === "draft" && log[1]?.to === "in_review");

  // 9. read model exposes available transitions from in_review
  const avail = (wf.result?.available || []).map((s) => s.id).sort();
  check("available from in_review = [approved, draft]", JSON.stringify(avail) === JSON.stringify(["approved", "draft"]));
} finally {
  // cleanup: delete page + workflow KVS keys we seeded
  await del(`/api/v2/pages/${page.id}`).catch(() => {});
  await hook({ what: "delete", key: `workflow-state-${page.id}` }).catch(() => {});
  await hook({ what: "delete", key: `workflow-idx-${spaceKey}-in_review-${page.id}` }).catch(() => {});
  await hook({ what: "delete", key: `workflow-idx-${spaceKey}-draft-${page.id}` }).catch(() => {});
  console.log(`     cleaned up page ${page.id}`);
}

console.log(`\nworkflow-e2e: ${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
