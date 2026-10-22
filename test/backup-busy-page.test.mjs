// The automatic backup must never create a SECOND backup page because Confluence was busy. It
// used to: a 429/5xx on the remembered page's read or on its restriction read made isBackupPage
// answer "not ours", and a failed label search (findBackupPages().catch(() => [])) read as "no
// backup page on this site", so ensureBackupPage created a new page and pointed the site at it.
// The old page, with its generations, was left behind. Busy is "could not tell": the run fails as
// an ordinary, retryable failure and creates nothing. Only a real 404 (or a page that is not ours)
// and a search Confluence answered may lead to a new page.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, onConfluence, fake } = await import("./_forge-fake/state.mjs");
const { runInvocation } = await import("../src/server/shared/confluence-call.js");
const { backupConsumer } = await import("../src/server/capsules/backup/worker.js");
const { STATUS_KEY, SETTINGS_KEY } = await import("../src/server/capsules/backup/engine.js");
const LOG = console.log;
console.error = () => {}; console.warn = () => {}; console.info = () => {}; console.log = () => {};

const APP = "app-account";
const TITLE = "Sentinel Vault backup (development)"; // the fake's environment is DEVELOPMENT
let world;
function site(w) {
  resetFake();
  world = { busy: new Set(), pages: new Map(), searchHits: [], ...w };
  world.pages.set("5000", { id: "5000", title: TITLE, spaceId: "11", props: [] });
  fake.kvs.set("admin-settings-global", { enabled: true });
  fake.kvs.set(SETTINGS_KEY, { pageId: "5000", spaceId: "11", spaceKey: "OPS", spaceName: "OPS", title: TITLE });
  onConfluence((method, rawPath, body) => {
    const path = decodeURIComponent(rawPath);
    const [base] = path.split("?");
    for (const [prefix, status] of world.busy) if (method === "GET" && base === prefix) return { status, body: { message: "busy" }, headers: { "Retry-After": "0" } };
    let m;
    if (base === "/wiki/rest/api/user/current") return { body: { accountId: APP } };
    if (base === "/wiki/rest/api/content/search") return { body: { results: world.searchHits } };
    if (base === "/wiki/api/v2/spaces") {
      const r = [{ id: "11", key: "OPS", name: "OPS", type: "global", status: "current" }];
      return { body: { results: r } };
    }
    if (method === "POST" && base === "/wiki/api/v2/pages") {
      const id = String(6000 + world.pages.size);
      world.pages.set(id, { id, title: body.title, spaceId: body.spaceId, props: [] });
      return { body: { id, title: body.title } };
    }
    if ((m = base.match(/^\/wiki\/api\/v2\/pages\/(\d+)$/))) {
      const p = world.pages.get(m[1]);
      return p ? { body: { id: p.id, title: p.title, spaceId: p.spaceId, authorId: APP, status: "current" } } : { status: 404, body: {} };
    }
    if ((m = base.match(/^\/wiki\/rest\/api\/content\/(\d+)\/restriction$/))) {
      if (method === "PUT") return { body: {} };
      if (!world.pages.has(m[1])) return { status: 404, body: {} };
      return { body: { results: [{ operation: "read", restrictions: { user: { results: [{ accountId: APP }] }, group: { results: [] } } }] } };
    }
    if (base.match(/^\/wiki\/rest\/api\/content\/\d+\/label$/)) return { body: {} };
    if (base.match(/^\/wiki\/api\/v2\/pages\/\d+\/attachments$/)) return { body: { results: [] } };
    if (base.match(/^\/wiki\/rest\/api\/content\/\d+\/child\/attachment$/)) return { body: { results: [{ id: `att${fake.calls.length}` }] } };
    if ((m = base.match(/^\/wiki\/api\/v2\/pages\/(\d+)\/properties$/))) {
      const p = world.pages.get(m[1]);
      if (method === "POST") { p.props = [{ id: "1", version: { number: 1 }, value: body.value }]; return { body: {} }; }
      return { body: { results: p?.props || [] } };
    }
    if (base.match(/^\/wiki\/api\/v2\/pages\/\d+\/properties\/\d+$/)) return { body: {} };
    return undefined;
  });
}
const run = () => runInvocation(() => backupConsumer({ body: { kind: "backup", reason: "schedule" } }));
const created = () => fake.calls.filter((c) => c.method === "POST" && c.path.startsWith("/wiki/api/v2/pages") && !c.path.includes("/properties")).length;
const status = () => fake.kvs.get(STATUS_KEY) || {};

for (const [label, prefix, code] of [
  ["remembered page read 503", "/wiki/api/v2/pages/5000", 503],
  ["remembered page read 429", "/wiki/api/v2/pages/5000", 429],
  ["remembered page restriction read 503", "/wiki/rest/api/content/5000/restriction", 503],
]) {
  site({ busy: new Map([[prefix, code]]) });
  await run();
  eq(`${label}: no new page`, created(), 0);
  eq(`${label}: the site still points at its page`, fake.kvs.get(SETTINGS_KEY)?.pageId, "5000");
  ok(`${label}: an ordinary failure is recorded`, !!status().lastError);
  eq(`${label}: not the paused state`, status().noSpace ?? null, null);
}

// The remembered page is really gone (404) but the label search is busy: could not tell whether
// another backup page exists (a reinstall finds its old page this way), so nothing is created.
for (const code of [503, 429]) {
  site({ busy: new Map([["/wiki/rest/api/content/search", code]]) });
  world.pages.delete("5000");
  await run();
  eq(`page gone, search ${code}: no new page`, created(), 0);
  ok(`page gone, search ${code}: an ordinary failure is recorded`, !!status().lastError);
}

// Positive controls: a calm Confluence still behaves as before.
site({});
await run();
eq("calm: the remembered page is used, nothing created", created(), 0);
ok("calm: a backup was recorded", !!status().lastBackup?.generationId);

site({});
world.pages.delete("5000");
await run();
eq("page really gone, search answered empty: a new page is created", created(), 1);
ok("page really gone: the site now points at the new page", fake.kvs.get(SETTINGS_KEY)?.pageId && fake.kvs.get(SETTINGS_KEY).pageId !== "5000");

site({});
world.pages.delete("5000");
world.pages.set("7000", { id: "7000", title: TITLE, spaceId: "11", props: [] });
world.searchHits = [{ id: "7000", title: TITLE, space: { key: "OPS", name: "OPS", id: 11 } }];
await run();
eq("page gone, search finds the earlier backup page: it is adopted, nothing created", [created(), fake.kvs.get(SETTINGS_KEY)?.pageId], [0, "7000"]);

console.log = LOG;
report("backup-busy-page");
