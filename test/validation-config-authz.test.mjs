// load-validation-config: the stored validation config (rule text, AI prompts) is read only by
// the people who may change it. Space scope: an admin of THAT space (site admins included).
// Site scope: a site admin; a space admin standing in their own space sees the site's rules (the
// space editor shows them beside its own), never the site's AI settings.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, onConfluence } = await import("./_forge-fake/state.mjs");
const { kvs } = await import("@forge/kvs");
const validations = await import("../src/server/capsules/validations/actions.js");
const load = new Map(validations.actions).get("load-validation-config");
console.warn = () => {}; console.error = () => {};

const SITE_ADMIN = "acct-site-admin";
const ADMIN_A = "acct-admin-of-A";
const ADMIN_B = "acct-admin-of-B";
const PLAIN = "acct-plain-user";
const A = "AAA";
const B = "BBB";

const SITE_RULE = { id: "g1", type: "required-heading", label: "Site rule", severity: "block", config: { text: "Scope" } };
const GLOBAL = {
  enabled: true,
  modes: { advisory: true, gate: false, revert: false },
  rules: [SITE_RULE],
  ai: { enabled: true, styleGuide: "SITE-STYLE-SECRET", tone: "SITE-TONE-SECRET", compliance: "SITE-COMPLIANCE-SECRET", rules: "SITE-AI-RULES-SECRET", monthlyTokenBudget: 1000 },
};
const spaceCfg = (k) => ({
  enabled: true,
  modes: { advisory: true, gate: true, revert: false },
  rules: [{ id: `${k}1`, type: "required-heading", label: `${k} rule`, severity: "warn", config: { text: `${k}-RULE-TEXT` } }],
  ai: { enabled: true, styleGuide: `${k}-STYLE-SECRET`, compliance: `${k}-COMPLIANCE-SECRET` },
});

async function world() {
  resetFake();
  onConfluence((method, rawPath) => {
    const path = decodeURIComponent(rawPath);
    const [base, query = ""] = path.split("?");
    const acct = new URLSearchParams(query).get("accountId");
    if (base === "/wiki/rest/api/user") {
      const operations = acct === SITE_ADMIN ? [{ operation: "administer", targetType: "application" }] : [];
      return { body: { accountId: acct, groups: { results: [] }, operations } };
    }
    if (base === "/wiki/rest/api/user/memberof") return { body: { results: [] } };
    // Confluence has no such endpoint (405 on every method): nobody is a space admin through it.
    if (/^\/wiki\/rest\/api\/space\/[^/]+\/permission\/check$/.test(base)) return { status: 405, body: {} };
    return undefined;
  });
  await kvs.set(`admin-settings-space-${A}`, { adminUsers: [{ accountId: ADMIN_A }] });
  await kvs.set(`admin-settings-space-${B}`, { adminUsers: [{ accountId: ADMIN_B }] });
  await kvs.set("validation-config-global", GLOBAL);
  await kvs.set(`validation-config-space-${A}`, spaceCfg(A));
  await kvs.set(`validation-config-space-${B}`, spaceCfg(B));
}

const call = (accountId, payload, extension = {}) => load({ payload, context: { accountId, extension } });
const leaks = (r, ...needles) => needles.some((n) => JSON.stringify(r ?? null).includes(n));
const refused = (r) => r?.success === false && !leaks(r, "SECRET", "RULE-TEXT", "Site rule");
const inSpace = (key) => ({ space: { key } });

await world();

// An ordinary user reads nothing, whatever they ask for.
ok("plain user: space B refused", refused(await call(PLAIN, { scope: "space", key: B })));
ok("plain user: site refused", refused(await call(PLAIN, { scope: "global" })));
ok("plain user: no scope (site) refused", refused(await call(PLAIN, {})));
ok("plain user: space scope without a key (fell through to the site) refused", refused(await call(PLAIN, { scope: "space" })));
ok("plain user: unknown scope refused", refused(await call(PLAIN, { scope: "bogus", key: B })));
ok("plain user standing in space B: site refused", refused(await call(PLAIN, { scope: "global" }, inSpace(B))));
ok("no account: refused", refused(await call(undefined, { scope: "space", key: B })));

// A space admin reads their own space, not another one.
ok("admin of A: space B refused", refused(await call(ADMIN_A, { scope: "space", key: B })));
ok("admin of A standing in A: space B refused", refused(await call(ADMIN_A, { scope: "space", key: B }, inSpace(A))));
const ownA = await call(ADMIN_A, { scope: "space", key: A });
eq("admin of A: own space rules", ownA?.rules?.[0]?.config?.text, `${A}-RULE-TEXT`);
eq("admin of A: own space AI prompt", ownA?.ai?.styleGuide, `${A}-STYLE-SECRET`);

// The site's settings: a space admin in their own space sees the site rules only.
const siteForA = await call(ADMIN_A, { scope: "global" }, inSpace(A));
eq("admin of A in A: site rules (for the override note)", siteForA?.rules?.map((r) => r.id), ["g1"]);
ok("admin of A in A: no site AI settings", !leaks(siteForA, "SITE-STYLE-SECRET", "SITE-TONE-SECRET", "SITE-COMPLIANCE-SECRET", "SITE-AI-RULES-SECRET") && !siteForA?.ai);
ok("admin of A standing in B: site refused", refused(await call(ADMIN_A, { scope: "global" }, inSpace(B))));
ok("admin of A, no space context: site refused", refused(await call(ADMIN_A, { scope: "global" })));
const siteForAByKey = await call(ADMIN_A, { scope: "global", key: A });
eq("admin of A naming A (the space editor's call): site rules", siteForAByKey?.rules?.map((r) => r.id), ["g1"]);
ok("admin of A naming A: no site AI settings", !leaks(siteForAByKey, "SECRET") && !siteForAByKey?.ai);
ok("admin of A naming B: site refused", refused(await call(ADMIN_A, { scope: "global", key: B })));
ok("plain user naming A: site refused", refused(await call(PLAIN, { scope: "global", key: A })));

// A site admin reads everything.
const siteFull = await call(SITE_ADMIN, { scope: "global" });
eq("site admin: site AI prompt", siteFull?.ai?.styleGuide, "SITE-STYLE-SECRET");
eq("site admin: site rules", siteFull?.rules?.map((r) => r.id), ["g1"]);
eq("site admin: any space", (await call(SITE_ADMIN, { scope: "space", key: B }))?.ai?.compliance, `${B}-COMPLIANCE-SECRET`);

// Unconfigured space: the admin still gets the empty shape the editor expects.
await kvs.delete(`validation-config-space-${A}`);
const unconfigured = await call(ADMIN_A, { scope: "space", key: A });
eq("admin of A: unconfigured space", { rules: unconfigured?.rules, modes: unconfigured?.modes, ai: unconfigured?.ai }, { rules: [], modes: null, ai: null });

// Never written back: a refusal or the rules-only view handed in as settings is refused.
await world();
const store = new Map(validations.actions).get("store-validation-config");
const refusedStore = await store({ payload: { scope: "global", data: { success: false, reason: "Not authorized", modes: { revert: true } } }, context: { accountId: SITE_ADMIN, extension: {} } });
eq("store: a refusal is not settings", refusedStore?.success, false);
eq("store: the site config is untouched", (await kvs.get("validation-config-global"))?.rules?.map((r) => r.id), ["g1"]);
const rulesOnlyStore = await store({ payload: { scope: "space", key: A, data: { rules: [], siteRulesOnly: true } }, context: { accountId: ADMIN_A, extension: {} } });
eq("store: the rules-only view is not settings", rulesOnlyStore?.success, false);

// The config API merges a bundle into the CURRENT settings. When that read is refused (here: the
// site-admin lookup fails twice, then answers), the step is refused and nothing is stored.
await world();
let flaky = 2;
onConfluence((method, rawPath) => {
  const base = decodeURIComponent(rawPath).split("?")[0];
  if (base === "/wiki/rest/api/user" && flaky > 0) { flaky--; return { status: 500, body: {} }; }
  return undefined;
});
const { runJob } = await import("../src/server/capsules/config-api/consumer.js");
await kvs.set("api-job-flaky1", { id: "flaky1", op: "apply", status: "queued", submittedBy: SITE_ADMIN, role: "admin", submittedAt: new Date().toISOString(), bundle: { version: 1, site: { validation: { modes: { revert: true } } } } });
await runJob("flaky1");
const afterJob = await kvs.get("validation-config-global");
ok("config API: a refused read is never stored as the settings", afterJob?.success !== false && !("reason" in (afterJob || {})));
eq("config API: the site rules survive", afterJob?.rules?.map((r) => r.id), ["g1"]);
const receipt = await kvs.get("api-job-flaky1");
eq("config API: the step is reported refused", receipt?.results?.find((x) => x.path === "site.validation")?.status, "refused");

report("validation-config-authz");
