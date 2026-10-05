// Group expansion (fetchGroupMembers → /group/{id}/membersByGroupId) on dev, via read confirmations
// whose audience is a GROUP: by id (the picker's UUID) and by name only (older configs).
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(`${process.env.HOME}/Projects/forge-live-harness/.env`, "utf8")
  .split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; }));
const HOOK = env.SENTINEL_TESTHOOK_URL, SECRET = env.HARNESS_SECRET;
const SITE = env.JIRA_BASE_URL.replace(/\/$/, "");
const AUTH = "Basic " + Buffer.from(`${env.JIRA_ADMIN_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64");
const MIHAI = "712020:937bc860-eec2-4294-a65d-8e0fe7c45086";
const PLAIN = "712020:6c8dccca-a6b1-4c6f-903c-329094a1bac1"; // member of confluence-users-wolfaenpak only
const SPACE = "SVPLAIN", SPACE_ID = "344162767";
const GROUP = { id: "9b1bd7bc-281a-4bb5-8ba2-335f9c725833", name: "confluence-users-wolfaenpak" };
const hook = async (p) => (await fetch(`${HOOK}?${new URLSearchParams(p)}`, { headers: { Authorization: `Bearer ${SECRET}` } })).json();
const inv = (fn, p = {}) => hook({ what: "invoke", fn, ...p });
const results = [];
const check = (l, c, x) => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"} ${l}${x !== undefined ? ` — ${JSON.stringify(x).slice(0, 300)}` : ""}`); };
const prior = (await hook({ what: "kvs", key: `workflow-settings-${SPACE}` })).value;
const page = await (await fetch(`${SITE}/wiki/api/v2/pages`, { method: "POST", headers: { Authorization: AUTH, "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({ spaceId: SPACE_ID, status: "current", title: `SV group audience ${Date.now()}`, body: { representation: "storage", value: "<p>read me</p>" } }) })).json();
const pageId = String(page.id);
try {
  for (const [label, member] of [["by group id", { type: "group", id: GROUP.id, name: GROUP.name }], ["by name only", { type: "group", id: GROUP.name, name: GROUP.name }]]) {
    await hook({ what: "set", key: `workflow-settings-${SPACE}`, value: JSON.stringify({ ...(prior || { workflowId: "default", autoAssignNew: false }), enabled: true, readConfirmation: { enabled: true, audience: [member] } }) });
    if (label === "by group id") {
      await inv("assignWorkflow", { pageId, spaceKey: SPACE, workflowId: "default", actor: MIHAI });
      await inv("transitionWorkflow", { pageId, spaceKey: SPACE, to: "in_review", actor: MIHAI });
      await inv("transitionWorkflow", { pageId, spaceKey: SPACE, to: "approved", toName: "Approved", approvers: MIHAI, approvedVersion: "1", actor: MIHAI });
    }
    const st = (await inv("getReadStatus", { pageId, actor: PLAIN })).result;
    check(`${label}: the group expands (not unresolved)`, st?.required === true && st?.unresolved === false, st);
    check(`${label}: members found`, st?.audienceCount > 0, { audienceCount: st?.audienceCount });
    check(`${label}: a real member is in the audience`, st?.inAudience === true, { inAudience: st?.inAudience });
  }
} finally {
  if (prior) await hook({ what: "set", key: `workflow-settings-${SPACE}`, value: JSON.stringify(prior) }); else await hook({ what: "delete", key: `workflow-settings-${SPACE}` });
  for (const k of [`workflow-state-${pageId}`, `workflow-pending-${pageId}`, `workflow-autoassigned-${pageId}`, `workflow-label-${pageId}`]) await hook({ what: "delete", key: k });
  for (const prefix of [`workflow-log-${pageId}-`, `activity-page-${pageId}-`]) for (const k of (await hook({ what: "query", prefix })).keys || []) await hook({ what: "delete", key: k });
  for (const k of (await hook({ what: "query", prefix: `workflow-idx-${SPACE}-` })).keys || []) if (k.endsWith(pageId)) await hook({ what: "delete", key: k });
  await fetch(`${SITE}/wiki/api/v2/pages/${pageId}`, { method: "DELETE", headers: { Authorization: AUTH } });
}
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
