// One Forge process serves several sites: a warm container that ran an invocation for site A runs
// the next one for site B with the same module state. Anything the app remembers in module scope is
// therefore shared between customers, so a memo keyed by a page id, an account id or nothing at all
// can hand site A's answer to site B (page ids repeat across sites). Every answer that depends on the
// site is remembered for ONE invocation only (shared/confluence-call.js invocationMemo).
//
// This file plays two sites in one process: each site has its own Confluence and its own KVS, and
// each call runs as its own invocation, the way registry.js and boot.js run them in production.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, onConfluence, fake } = await import("./_forge-fake/state.mjs");
const { kvs } = await import("@forge/kvs");
const { runInvocation } = await import("../src/server/shared/confluence-call.js");
const { recordActivity, resolveActorName } = await import("../src/server/infra/activity-log.js");
const classification = new Map((await import("../src/server/capsules/classification/actions.js")).actions);
const { getClassificationProvider, resetProviderCache } = await import("../src/server/capsules/classification/provider.js");
const { appAccountId } = await import("../src/server/capsules/backup/store.js");
console.warn = () => {}; console.error = () => {}; console.info = () => {};

const PAGE = "9001"; // the same page id on both sites
const ACCOUNT = "acct-shared";
const SITES = {
  A: {
    pages: { [PAGE]: "11" }, spaces: { 11: "ALPHA" }, appAccount: "app-site-a", names: { [ACCOUNT]: "Ann on A" },
    nativeLevels: [{ id: "a-secret", name: "Alpha Secret", order: 1, status: "PUBLISHED", description: "Site A's own scheme" }],
  },
  B: {
    pages: { [PAGE]: "22" }, spaces: { 22: "BRAVO", 33: "CHARLIE" }, appAccount: "app-site-b", names: { [ACCOUNT]: "Ann on B" },
    nativeLevels: null, // no native classification on B: the app's own levels
  },
};
const store = { A: new Map(), B: new Map() };
let site = "A";
const failing = { A: new Set(), B: new Set() }; // paths a site answers 429 for

function world() {
  resetFake();
  store.A = new Map(); store.B = new Map();
  failing.A = new Set(); failing.B = new Set();
  onConfluence((method, rawPath) => {
    const s = SITES[site];
    const path = decodeURIComponent(rawPath);
    const [base, query = ""] = path.split("?");
    const qs = new URLSearchParams(query);
    if ([...failing[site]].some((p) => base.startsWith(p))) return { status: 429, body: "slow down", headers: { "Retry-After": "0" } };
    let m;
    if ((m = base.match(/^\/wiki\/api\/v2\/pages\/(\d+)$/))) {
      const spaceId = s.pages[m[1]];
      return spaceId ? { body: { id: m[1], spaceId, title: `Page on ${site}`, status: "current" } } : { status: 404, body: {} };
    }
    if (base.match(/^\/wiki\/api\/v2\/blogposts\/\d+$/)) return { status: 404, body: {} };
    if ((m = base.match(/^\/wiki\/api\/v2\/spaces\/(\d+)$/))) {
      const key = s.spaces[m[1]];
      return key ? { body: { id: m[1], key } } : { status: 404, body: {} };
    }
    if (base === "/wiki/rest/api/user/current") return { body: { accountId: s.appAccount } };
    if (base === "/wiki/rest/api/user") {
      const name = s.names[qs.get("accountId")];
      return name ? { body: { accountId: qs.get("accountId"), displayName: name } } : { status: 404, body: {} };
    }
    if (base === "/wiki/api/v2/classification-levels") return s.nativeLevels ? { body: { results: s.nativeLevels } } : { status: 404, body: {} };
    return undefined;
  });
}

// One invocation for one site: its own KVS, its own Confluence answers, its own invocation scope.
async function on(name, fn, { scoped = true } = {}) {
  site = name;
  fake.kvs = store[name];
  const before = fake.calls.length;
  const value = scoped ? await runInvocation(fn) : await fn();
  return { value, calls: fake.calls.slice(before).map((c) => `${c.method} ${decodeURIComponent(c.path)}`) };
}

const rowsUnder = (name, prefix) => [...store[name].entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
const event = (spaceKey) => ({ type: "seal.created", pageId: PAGE, spaceKey, actor: { accountId: ACCOUNT, name: null }, target: { kind: "attachment", id: "att-1", name: "file.pdf" } });

// ── 1. The space key an activity row is filed under (the reported case) ───────────────────────────
{
  world();
  await on("A", () => recordActivity(event("ALPHA")));
  eq("site A files its page under its own space", rowsUnder("A", "activity-space-").map((r) => r.spaceKey), ["ALPHA"]);
  const b = await on("B", () => recordActivity(event("BRAVO")));
  eq("site B: no row is filed under site A's space key", rowsUnder("B", "activity-space-ALPHA-").length, 0);
  eq("site B: the row is filed under B's own space", rowsUnder("B", "activity-space-").map((r) => r.spaceKey), ["BRAVO"]);
  eq("site B: the page feed row names B's space, never A's", rowsUnder("B", "activity-page-").map((r) => r.spaceKey), ["BRAVO"]);
  ok("site B asked its own Confluence where the page is", b.calls.includes(`GET /wiki/api/v2/pages/${PAGE}`));
}
{
  // The page moved on B (it is in CHARLIE now): B's row follows B's page, not A's answer.
  world();
  SITES.B.pages[PAGE] = "33";
  await on("A", () => recordActivity(event("ALPHA")));
  await on("B", () => recordActivity(event("BRAVO")));
  eq("site B: a page that moved on B is filed under B's current space", rowsUnder("B", "activity-space-").map((r) => r.spaceKey), ["CHARLIE"]);
  SITES.B.pages[PAGE] = "22";
}
{
  // A product trigger outside any invocation scope: nothing is remembered at all.
  world();
  await on("A", () => recordActivity(event("ALPHA")), { scoped: false });
  await on("B", () => recordActivity(event("BRAVO")), { scoped: false });
  eq("unscoped: site B's row is filed under B's space", rowsUnder("B", "activity-space-").map((r) => r.spaceKey), ["BRAVO"]);
}
{
  // Within ONE invocation the lookup is still asked once (a sweep records several events per page).
  world();
  const one = await on("B", async () => { await recordActivity(event("BRAVO")); await recordActivity(event("BRAVO")); });
  eq("one invocation asks where the page is once", one.calls.filter((c) => c === `GET /wiki/api/v2/pages/${PAGE}`).length, 1);
}

// ── 2. The display name written onto an activity row and shown in the reports ──────────────────────
{
  world();
  const a = await on("A", () => resolveActorName(ACCOUNT));
  eq("site A resolves the name on A", a.value, "Ann on A");
  const b = await on("B", () => resolveActorName(ACCOUNT));
  eq("site B resolves the name on B, not A's answer", b.value, "Ann on B");
  ok("site B asked its own Confluence", b.calls.some((c) => c.startsWith("GET /wiki/rest/api/user?accountId=")));
}
{
  // A failed lookup on A (429) is not kept for anyone: B, and A's next invocation, ask again.
  world();
  failing.A.add("/wiki/rest/api/user");
  const a = await on("A", () => resolveActorName(ACCOUNT));
  eq("a 429 on A gives no name", a.value, null);
  const b = await on("B", () => resolveActorName(ACCOUNT));
  eq("B is not handed A's failed lookup", b.value, "Ann on B");
  failing.A.clear();
  const a2 = await on("A", () => resolveActorName(ACCOUNT));
  eq("A's next invocation asks again", a2.value, "Ann on A");
}
{
  world();
  const one = await on("B", async () => [await resolveActorName(ACCOUNT), await resolveActorName(ACCOUNT)]);
  eq("one invocation asks for a name once", one.calls.filter((c) => c.startsWith("GET /wiki/rest/api/user?accountId=")).length, 1);
}

// ── 3. The classification scheme (provider + level list) ──────────────────────────────────────────
{
  world();
  const req = { context: { accountId: "acct-viewer" }, payload: {} };
  const a = await on("A", () => classification.get("classification-provider")(req));
  eq("site A uses its native levels", [a.value.name, a.value.levels.map((l) => l.name)], ["native", ["Alpha Secret"]]);
  const b = await on("B", () => classification.get("classification-provider")(req));
  eq("site B is not answered with site A's provider", b.value.name, "app");
  ok("site B never sees site A's level names", !JSON.stringify(b.value).includes("Alpha Secret"));
  eq("site B gets its own (default) levels", b.value.levels.map((l) => l.id), ["public", "internal", "confidential", "restricted"]);
  ok("site B asked its own Confluence for native levels", b.calls.includes("GET /wiki/api/v2/classification-levels"));
}
{
  // The provider is still asked once per invocation, and a level edit is seen at once.
  world();
  const one = await on("B", async () => { await getClassificationProvider(); await getClassificationProvider(); });
  eq("one invocation selects the provider once", one.calls.filter((c) => c === "GET /wiki/api/v2/classification-levels").length, 1);
  const edited = await on("B", async () => {
    const first = (await getClassificationProvider()).levels.map((l) => l.id);
    await kvs.set("classification-levels", { levels: [{ id: "only", name: "Only", color: "#15803D", rank: 1, description: "" }] });
    resetProviderCache();
    const second = (await getClassificationProvider()).levels.map((l) => l.id);
    return [first.includes("only"), second];
  });
  eq("resetProviderCache: the same invocation reads the edited levels", edited.value, [false, ["only"]]);
}

{
  // A 429 on the levels call is "could not tell": the call fails, the app's levels are never used on
  // a site with Confluence's own levels, and nothing is kept for the next request.
  world();
  failing.A.add("/wiki/api/v2/classification-levels");
  let threw = null;
  await on("A", async () => { try { await getClassificationProvider(); } catch (e) { threw = e.code; } });
  eq("a rate-limited levels call fails instead of falling back to the app's levels", threw, "RATE_LIMITED");
  eq("... and nothing is stored for the site", store.A.has("classification-scheme-cache"), false);
  failing.A.clear();
  const a = await on("A", () => getClassificationProvider());
  eq("the next request reads Confluence's levels", a.value.provider.name, "native");
  // Kept a minute in the SITE's own storage: the next request on A asks Confluence nothing, B still asks.
  const a2 = await on("A", () => getClassificationProvider());
  eq("A's next request reuses A's stored scheme", [a2.value.provider.name, a2.calls.filter((c) => c === "GET /wiki/api/v2/classification-levels").length], ["native", 0]);
  const b = await on("B", () => getClassificationProvider());
  eq("B never reads A's stored scheme", [b.value.provider.name, b.calls.includes("GET /wiki/api/v2/classification-levels")], ["app", true]);
}

{
  // Confluence busy on a later request: the site's last stored choice (up to a day old) is used.
  world();
  await on("A", () => getClassificationProvider());
  const row = store.A.get("classification-scheme-cache");
  store.A.set("classification-scheme-cache", { ...row, at: row.at - 3_600_000 }); // an hour old: past the minute
  failing.A.add("/wiki/api/v2/classification-levels");
  const a = await on("A", () => getClassificationProvider());
  eq("a 429 with a stored choice from today uses that choice", [a.value.provider.name, a.value.levels.map((l) => l.name)], ["native", ["Alpha Secret"]]);
  // A classified page's chip is never rewritten as "Unclassified" because the read failed.
  store.A.delete("classification-scheme-cache");
  store.A.set("admin-settings-global", { classificationEnabled: true });
  const { refreshByline } = await import("../src/server/capsules/page-details/byline.js");
  const r = await on("A", () => refreshByline(PAGE));
  eq("the byline is not written when the classification cannot be read", [r.value.wrote, r.value.reason], [false, "classification unreadable"]);
  ok("... and no page property is written", !r.calls.some((c) => /^(PUT|POST) .*propert/.test(c)));
  // The config export never writes "off, no levels" for a scheme it could not read.
  const { exportSiteConfig } = await import("../src/server/capsules/config-api/export.js");
  let exportErr = null;
  await on("A", async () => { try { await exportSiteConfig("acct-viewer"); } catch (e) { exportErr = e.message; } });
  ok("the site config export fails while the scheme cannot be read", /limiting requests/.test(String(exportErr)));
  failing.A.clear();
}

{
  // A busy answer inside a level read is "could not tell", never "no level" (both schemes).
  const { createNativeProvider, resolveSpaceId } = await import("../src/server/capsules/classification/logic.js");
  const scripted = (map) => async (path) => { const st = map[path] ?? 404; return { ok: st >= 200 && st < 300, status: st, json: async () => ({ id: "L1", spaceId: "5", results: [{ id: "L1", name: "One", order: 1 }] }) }; };
  const code = async (p) => { try { await p; return "ok"; } catch (e) { return e.code; } };
  const native = createNativeProvider({ request: scripted({ "/wiki/api/v2/classification-levels": 200, "/wiki/api/v2/pages/900/classification-level": 429 }) });
  eq("native: a 429 on the page level throws, not 'no level'", await code(native.effectiveLevel("900")), "CLASSIFICATION_UNREADABLE");
  const nativeBusyLevels = createNativeProvider({ request: scripted({ "/wiki/api/v2/classification-levels": 503 }) });
  eq("native: a 5xx on the levels inside a level read throws", await code(nativeBusyLevels.effectiveLevel("900")), "CLASSIFICATION_UNREADABLE");
  eq("the page's space: a 503 throws", await code(resolveSpaceId(scripted({ "/wiki/api/v2/pages/900": 503 }), "900")), "CLASSIFICATION_UNREADABLE");
  eq("the page's space: a 404 is still null", await resolveSpaceId(scripted({}), "900"), null);
}

// ── 4. The app's own account id (backup pages are recognised by their author) ─────────────────────
{
  world();
  const a = await on("A", () => appAccountId());
  eq("site A: the app account on A", a.value, "app-site-a");
  const b = await on("B", () => appAccountId());
  eq("site B: the app account on B, not A's", b.value, "app-site-b");
}

report("tenant-isolation");
