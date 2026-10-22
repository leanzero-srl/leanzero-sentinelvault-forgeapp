// 8.20.0: a classification read Confluence could not answer (429, 5xx) is "could not tell", never
// "no level" / "no default". Before, a busy read was taken for an empty answer: chips were written as
// Unclassified, a lowering went through without its reason, and exports saved "no default". Since the
// site's scheme is now read per request (it used to be kept for the whole process, across sites), a
// busy read can happen on any request, so every path here must hold.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, onConfluence } = await import("./_forge-fake/state.mjs");
const { kvs } = await import("@forge/kvs");
const { runInvocation } = await import("../src/server/shared/confluence-call.js");
const actions = new Map((await import("../src/server/capsules/classification/actions.js")).actions);
const { exportSpaceConfig } = await import("../src/server/capsules/config-api/export.js");
console.warn = () => {}; console.error = () => {}; console.info = () => {};

const ADMIN = "acct-site-admin";
// Confluence's order: 1 = the most sensitive.
const LEVELS = [{ id: "L1", name: "Low", order: 2, status: "PUBLISHED" }, { id: "L2", name: "High", order: 1, status: "PUBLISHED" }];
let busy = new Set(); // path prefixes answered 429
let spaceDefault = "L2";
let pageLevel = "L2";

function world() {
  resetFake();
  busy = new Set(); spaceDefault = "L2"; pageLevel = "L2";
  onConfluence((method, rawPath) => {
    const path = decodeURIComponent(rawPath);
    const [base] = path.split("?");
    if ([...busy].some((p) => base.startsWith(p))) return { status: 429, body: "busy", headers: { "Retry-After": "0" } };
    if (base === "/wiki/rest/api/user" && path.includes(ADMIN)) return { body: { accountId: ADMIN, operations: [{ operation: "administer", targetType: "application" }] } };
    if (base === "/wiki/api/v2/classification-levels") return { body: { results: LEVELS } };
    if (base === "/wiki/api/v2/spaces/11/classification-level/default") {
      if (method === "GET") return spaceDefault ? { body: { id: spaceDefault } } : { status: 404, body: {} };
      return { status: 204, body: "" };
    }
    if (base === "/wiki/api/v2/pages/900/classification-level") {
      if (method === "GET") return pageLevel ? { body: { id: pageLevel } } : { status: 404, body: {} };
      return { status: 204, body: "" };
    }
    if (base === "/wiki/api/v2/pages/900/classification-level/reset") return { status: 204, body: "" };
    if (base === "/wiki/api/v2/spaces/11") return { body: { id: "11", key: "KEY", name: "Key space" } };
    if (base === "/wiki/api/v2/spaces" && path.includes("keys=KEY")) return { body: { results: [{ id: "11", key: "KEY" }] } };
    if (base === "/wiki/api/v2/spaces") return { body: { results: [{ id: "11", key: "KEY", name: "Key space", type: "global" }], _links: {} } };
    if (base === "/wiki/api/v2/pages/900") return { body: { id: "900", spaceId: "11", title: "P", status: "current" } };
    if (base === "/wiki/rest/api/content/900/permission/check") return { body: { hasPermission: true } };
    return undefined;
  });
}
const call = (key, payload) => runInvocation(() => actions.get(key)({ context: { accountId: ADMIN }, payload }));
const setup = async () => { world(); await kvs.set("admin-settings-global", { classificationEnabled: true }); };

{
  await setup();
  busy.add("/wiki/api/v2/spaces/11/classification-level/default");
  const r = await call("classification-set-space-default", { spaceId: "11", levelId: "L1" });
  eq("lowering a space default whose current value Confluence could not read is refused (not a lowering without a reason)", [r.results?.[0]?.ok, r.results?.[0]?.busy], [false, true]);
}
{
  await setup();
  busy.add("/wiki/api/v2/spaces/11/classification-level/default");
  const r = await call("classification-list-spaces", {});
  eq("the spaces list says Confluence is busy instead of 'no default'", [r.busy, r.spaces?.length], [true, 0]);
  const d = await call("classification-space-default", { spaceId: "11" });
  eq("a space's default read says busy instead of 'none'", d.busy, true);
}
{
  await setup();
  busy.add("/wiki/api/v2/pages/900/classification-level");
  const r = await call("classification-set-page", { pageId: "900", levelId: "L1", reason: "x" });
  eq("a page change whose current level cannot be read is refused as busy", [r.ok, r.busy], [false, true]);
}
{
  await setup();
  spaceDefault = "L1"; // Confluence refuses a page level below the space default: lower to the default itself
  // The write lands; only the read of the new effective level after it is busy.
  let writes = 0;
  onConfluence((method, rawPath) => {
    const base = decodeURIComponent(rawPath).split("?")[0];
    if (base === "/wiki/api/v2/pages/900/classification-level" && method === "PUT") { writes++; pageLevel = "L1"; busy.add("/wiki/api/v2/pages/900/classification-level"); return { status: 204, body: "" }; }
    return undefined;
  });
  const r = await call("classification-set-page", { pageId: "900", levelId: "L1", reason: "lowering it" });
  eq("a change that landed is reported as done even if the read after it is busy", [writes, r.ok, r.effectiveUnknown], [1, true, true]);
}
{
  await setup();
  busy.add("/wiki/api/v2/spaces/11/classification-level/default");
  let msg = null;
  try { await runInvocation(() => exportSpaceConfig("KEY", ADMIN)); } catch (e) { msg = e.message; }
  ok("a space export fails instead of saving 'no default'", /could not be read/.test(String(msg)));
  busy.clear();
  const okExport = await runInvocation(() => exportSpaceConfig("KEY", ADMIN));
  eq("... and exports the default when Confluence answers", okExport.classificationDefault, "L2");
}

report("classification-busy");
