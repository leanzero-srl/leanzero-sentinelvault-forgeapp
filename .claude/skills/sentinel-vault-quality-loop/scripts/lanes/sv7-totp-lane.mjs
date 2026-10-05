// TOTP lane: reset Mihai's device, enrol through the real resolvers, then a signed approval
// (unsigned refused, signed verifies, marked signed, status enrolled, no plain secret, replay refused).
import { readFileSync } from "node:fs";
import { totp } from "/Users/mihaiperdum/Projects/Sentinel Vault/.claude/worktrees/sv-7-personal-data/src/server/shared/totp.js";
const env = Object.fromEntries(readFileSync(`${process.env.HOME}/Projects/forge-live-harness/.env`, "utf8")
  .split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; }));
const HOOK = env.SENTINEL_TESTHOOK_URL, SECRET = env.HARNESS_SECRET;
const SITE = env.JIRA_BASE_URL.replace(/\/$/, "");
const AUTH = "Basic " + Buffer.from(`${env.JIRA_ADMIN_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64");
const MIHAI = "712020:937bc860-eec2-4294-a65d-8e0fe7c45086";
const REQ = "sv-aql-sign-req";
const SPACE = "WFH";
const hook = async (params) => { const r = await fetch(`${HOOK}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${SECRET}` } }); return r.json(); };
const inv = (fn, p = {}) => hook({ what: "invoke", fn, ...p });
const getKvs = async (key) => (await hook({ what: "kvs", key })).value;
const results = [];
const check = (label, cond, extra) => { results.push(!!cond); console.log(`${cond ? "PASS" : "FAIL"} ${label}${extra !== undefined ? ` — ${JSON.stringify(extra).slice(0, 300)}` : ""}`); };
const code = (secret, off = 0) => totp(secret, Date.now() + off * 30000);
const nextStep = () => new Promise((r) => setTimeout(r, 30500 - (Date.now() % 30000)));

console.log("build:", JSON.stringify((await hook({ what: "version" })).build));
await inv("eraseSignature", { actor: MIHAI });
check("device reset: status not enrolled", (await inv("signatureStatus", { actor: MIHAI })).result?.enrolled === false);
const en = (await inv("enrollSignature", { actor: MIHAI })).result;
check("enrolment hands out a secret", en?.success && /^[A-Z2-7]{32}$/.test(en.secret || ""), { success: en?.success, reason: en?.reason });
const secret = en?.secret;
const ok = (await inv("confirmSignatureEnrollment", { actor: MIHAI, code: code(secret) })).result;
check("enrolment confirmed", ok?.success === true, ok);
check("no plain secret row in KVS (secret namespace)", (await getKvs(`sig-secret-${MIHAI}`)) == null);
const marker = await getKvs(`sig-device-${MIHAI}`);
check("plain marker carries only the enrolment date", marker && !("secret" in marker) && !!marker.enrolledAt, marker);
check("status says enrolled", (await inv("signatureStatus", { actor: MIHAI })).result?.enrolled === true);

const prior = await getKvs(`workflow-settings-${SPACE}`);
const page = await (await fetch(`${SITE}/wiki/api/v2/pages`, { method: "POST", headers: { Authorization: AUTH, "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({ spaceId: "851971", status: "current", title: `SV7 totp lane ${Date.now()}`, body: { representation: "storage", value: "<h2>Sign</h2><p>signed approval lane</p>" } }) })).json();
const pageId = String(page.id);
try {
  await hook({ what: "set", key: `workflow-settings-${SPACE}`, value: JSON.stringify({ ...(prior || { workflowId: "default", autoAssignNew: false }), enabled: true, requireSignature: true }) });
  await inv("assignWorkflow", { pageId, spaceKey: SPACE, workflowId: "default", actor: REQ });
  await inv("transitionWorkflow", { pageId, spaceKey: SPACE, to: "in_review", actor: REQ });
  const ra = (await inv("requestApproval", { pageId, spaceKey: SPACE, to: "approved", toName: "Approved", approvers: MIHAI, mode: "any", actor: REQ })).result;
  check("approval requested", ra?.pending === true, ra);
  const d0 = (await inv("decideApproval", { pageId, approver: MIHAI, decision: "approved" })).result;
  check("an unsigned decision is refused (space requires a signature)", d0?.success === false, d0?.reason);
  await nextStep();
  const signedCode = code(secret);
  const d1 = (await inv("decideApproval", { pageId, approver: MIHAI, decision: "approved", code: signedCode })).result;
  check("the SIGNED decision verifies", d1?.success === true && d1?.outcome === "approved", d1);
  const wf = (await inv("getWorkflow", { pageId, spaceKey: SPACE, actor: MIHAI })).result;
  check("the record marks the decision signed", wf?.record?.approvalRecord?.decisions?.[0]?.signed === true, wf?.record?.approvalRecord?.decisions?.[0]);
  check("status still enrolled", (await inv("signatureStatus", { actor: MIHAI })).result?.enrolled === true);
  await inv("transitionWorkflow", { pageId, spaceKey: SPACE, to: "draft", actor: MIHAI });
  await inv("transitionWorkflow", { pageId, spaceKey: SPACE, to: "in_review", actor: REQ });
  await inv("requestApproval", { pageId, spaceKey: SPACE, to: "approved", toName: "Approved", approvers: MIHAI, mode: "any", actor: REQ });
  const replay = (await inv("decideApproval", { pageId, approver: MIHAI, decision: "approved", code: signedCode })).result;
  check("the same code is refused a second time (replay guard intact)", replay?.success === false, replay?.reason);
} finally {
  if (prior) await hook({ what: "set", key: `workflow-settings-${SPACE}`, value: JSON.stringify(prior) }); else await hook({ what: "delete", key: `workflow-settings-${SPACE}` });
  for (const prefix of [`workflow-log-${pageId}-`, `workflow-approval-${pageId}-`, `activity-page-${pageId}-`, `workflow-idx-${SPACE}-`]) {
    const keys = (await hook({ what: "query", prefix })).keys || [];
    for (const k of keys) if (k.includes(pageId)) await hook({ what: "delete", key: k });
  }
  for (const k of [`workflow-state-${pageId}`, `workflow-pending-${pageId}`, `workflow-inbox-${MIHAI}-${pageId}`, `workflow-autoassigned-${pageId}`]) await hook({ what: "delete", key: k });
  await fetch(`${SITE}/wiki/api/v2/pages/${pageId}`, { method: "DELETE", headers: { Authorization: AUTH } });
}
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
