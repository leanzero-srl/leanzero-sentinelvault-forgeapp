// Siblings of load-validation-config: every resolver that hands back configuration, a roster or a
// directory search answers only someone who may administer it, and a page action that reads the
// page asks whether the caller may read that page.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, onConfluence, fake } = await import("./_forge-fake/state.mjs");
const { kvs } = await import("@forge/kvs");
const byKey = (list) => new Map(list);
const policies = byKey((await import("../src/server/capsules/policies/actions.js")).actions);
const workflow = byKey((await import("../src/server/capsules/workflow/actions.js")).actions);
const validations = byKey((await import("../src/server/capsules/validations/actions.js")).actions);
const { DEFAULT_WORKFLOW } = await import("../src/server/capsules/workflow/logic.js");
const { scopeOfConfigWrite } = await import("../src/server/capsules/config-api/mirror.js");
console.warn = () => {}; console.error = () => {}; console.log = ((log) => (...a) => { if (String(a[0] || "").match(/passed|FAIL/)) log(...a); })(console.log);

const SITE_ADMIN = "acct-site-admin";
const ADMIN_A = "acct-admin-of-A";
const PLAIN = "acct-plain-user";
const SPACES = { AAA: "101", BBB: "202" };
const PAGES = { P1: { space: "101" }, R1: { space: "101" } }; // R1 is restricted: only SITE_ADMIN reads it
const readers = { P1: [SITE_ADMIN, ADMIN_A, PLAIN], R1: [SITE_ADMIN] };

async function world() {
  resetFake();
  fake.queued = [];
  onConfluence((method, rawPath, body) => {
    const path = decodeURIComponent(rawPath);
    const [base, query = ""] = path.split("?");
    const qs = new URLSearchParams(query);
    let m;
    if (base === "/wiki/rest/api/user") {
      const acct = qs.get("accountId");
      return { body: { accountId: acct, groups: { results: [] }, operations: acct === SITE_ADMIN ? [{ operation: "administer", targetType: "application" }] : [] } };
    }
    if (/^\/wiki\/rest\/api\/space\/[^/]+\/permission\/check$/.test(base)) return { status: 405, body: {} };
    if ((m = base.match(/^\/wiki\/rest\/api\/content\/([^/]+)\/permission\/check$/))) {
      const who = body?.subject?.identifier;
      return { body: { hasPermission: (readers[m[1]] || []).includes(who) } };
    }
    if ((m = base.match(/^\/wiki\/api\/v2\/pages\/([^/]+)$/))) return PAGES[m[1]] ? { body: { id: m[1], spaceId: PAGES[m[1]].space, version: { number: 1 } } } : { status: 404 };
    if ((m = base.match(/^\/wiki\/api\/v2\/spaces\/(\d+)$/))) { const key = Object.keys(SPACES).find((k) => SPACES[k] === m[1]); return key ? { body: { id: m[1], key } } : { status: 404 }; }
    if (base === "/wiki/rest/api/search/user") return { body: { results: [{ user: { accountId: "acct-x", displayName: "Directory Person", email: "person@example.com" } }] } };
    if (base === "/wiki/rest/api/group/picker") return { body: { results: [{ id: "g-1", name: "secret-group" }] } };
    return undefined;
  });
  await kvs.set("admin-settings-space-AAA", { adminUsers: [{ accountId: ADMIN_A }] });
  await kvs.set("admin-settings-global", { ribbonMode: "always", adminUsers: [{ accountId: "acct-global-steward", displayName: "Global Steward" }], adminGroups: ["sv-global-stewards"] });
  await kvs.set("workflow-def-space-AAA", { ...DEFAULT_WORKFLOW, name: "A flow" });
  await kvs.set("workflow-def-space-BBB", { ...DEFAULT_WORKFLOW, name: "B-SECRET-FLOW" });
  await kvs.set("workflow-def-global", { ...DEFAULT_WORKFLOW, name: "SITE-SECRET-FLOW" });
  await kvs.set("workflow-state-P1", { pageId: "P1", spaceKey: "AAA", stateId: DEFAULT_WORKFLOW.states[0].id });
  await kvs.set("validation-config-space-AAA", { enabled: true, rules: [], ai: { enabled: true, monthlyTokenBudget: 0 } });
  // From 8.10.0 the site AI switch is a ceiling over every space: on here, so the read check is what decides.
  await kvs.set("validation-config-global", { enabled: true, rules: [], ai: { enabled: true, monthlyTokenBudget: 0 } });
}
const as = (fn, accountId, payload, extension = {}) => fn({ payload, context: { accountId, extension } });
const has = (r, s) => JSON.stringify(r ?? null).includes(s);
const inSpace = (key) => ({ space: { key } });

await world();

// load-policy, site scope: the site-wide fallback admin roster is for site admins only.
const polPlain = await as(policies.get("load-policy"), PLAIN, { scope: "global" });
ok("load-policy site, plain user: no roster", !has(polPlain, "acct-global-steward") && !has(polPlain, "sv-global-stewards"));
eq("load-policy site, plain user: settings still there", polPlain?.ribbonMode, "always");
const polAdmin = await as(policies.get("load-policy"), SITE_ADMIN, { scope: "global" });
eq("load-policy site, site admin: roster", polAdmin?.adminGroups, ["sv-global-stewards"]);

// load-workflow-config: a definition is read by whoever may change it.
const lwc = workflow.get("load-workflow-config");
ok("load-workflow-config: plain user, space B refused", !has(await as(lwc, PLAIN, { scope: "space", key: "BBB" }), "B-SECRET-FLOW"));
ok("load-workflow-config: plain user, site refused", !has(await as(lwc, PLAIN, { scope: "global" }), "SITE-SECRET-FLOW"));
ok("load-workflow-config: plain user, no scope refused", !has(await as(lwc, PLAIN, {}), "SITE-SECRET-FLOW"));
ok("load-workflow-config: admin of A, space B refused", !has(await as(lwc, ADMIN_A, { scope: "space", key: "BBB" }), "B-SECRET-FLOW"));
eq("load-workflow-config: admin of A, own space", (await as(lwc, ADMIN_A, { scope: "space", key: "AAA" }))?.name, "A flow");
eq("load-workflow-config: site admin, site", (await as(lwc, SITE_ADMIN, { scope: "global" }))?.name, "SITE-SECRET-FLOW");

// get-page-workflow: the definition is the PAGE's space's, never a space named in the request.
const gpw = workflow.get("get-page-workflow");
const viaPayload = await as(gpw, PLAIN, { pageId: "P1", spaceKey: "BBB" });
ok("get-page-workflow, payload space B: not B's definition", !has(viaPayload, "B-SECRET-FLOW"));
eq("get-page-workflow, payload space B: the page's own definition", viaPayload?.def?.name, "A flow");
const viaCtx = await as(gpw, PLAIN, { pageId: "P1", spaceKey: "BBB" }, { content: { id: "P1", space: { key: "AAA" } } });
eq("get-page-workflow, in the page, payload space B: the page's own definition", viaCtx?.def?.name, "A flow");
eq("get-page-workflow, ribbon call: unchanged", (await as(gpw, PLAIN, { pageId: "P1", spaceKey: "AAA" }, { content: { id: "P1", space: { key: "AAA" } } }))?.def?.name, "A flow");

// The approver pickers' directory searches (run as the app): space admins and site admins only.
const su = workflow.get("search-workflow-users");
const sg = workflow.get("search-workflow-groups");
ok("search-workflow-users: plain user refused", !has(await as(su, PLAIN, { query: "Dir" }), "person@example.com"));
ok("search-workflow-users: plain user standing in A refused", !has(await as(su, PLAIN, { query: "Dir" }, inSpace("AAA")), "acct-x"));
ok("search-workflow-groups: plain user refused", !has(await as(sg, PLAIN, { query: "sec" }), "secret-group"));
eq("search-workflow-users: admin of A in A", (await as(su, ADMIN_A, { query: "Dir" }, inSpace("AAA")))?.users?.[0]?.accountId, "acct-x");
eq("search-workflow-groups: admin of A in A", (await as(sg, ADMIN_A, { query: "sec" }, inSpace("AAA")))?.groups?.[0]?.name, "secret-group");
eq("search-workflow-users: site admin", (await as(su, SITE_ADMIN, { query: "Dir" }))?.users?.length, 1);
ok("search-workflow-users: admin of A standing in B refused", !has(await as(su, ADMIN_A, { query: "Dir" }, inSpace("BBB")), "acct-x"));

// enqueue-page-validation: a space admin may only AI-review a page they can read.
const enq = validations.get("enqueue-page-validation");
fake.queued = [];
const refusedR = await as(enq, ADMIN_A, { pageId: "R1" });
ok("AI review of a page the space admin cannot read: refused", refusedR?.success === false && (fake.queued || []).length === 0);
const okP = await as(enq, ADMIN_A, { pageId: "P1" });
ok("AI review of a page the space admin can read: queued", okP?.success === true && (fake.queued || []).length === 1);

// The config mirror after a space-default write refreshes only the spaces that write changed.
eq("mirror: refused spaces are not refreshed", scopeOfConfigWrite("classification-set-space-default", { spaceIds: [101, 202] }, { results: [{ spaceId: "101", ok: false }, { spaceId: "202", ok: false }] }), null);
eq("mirror: only the allowed space", scopeOfConfigWrite("classification-set-space-default", { spaceIds: [101, 202] }, { results: [{ spaceId: "101", ok: true }, { spaceId: "202", ok: false }] })?.spaceIds, ["101"]);

report("config-read-authz");
