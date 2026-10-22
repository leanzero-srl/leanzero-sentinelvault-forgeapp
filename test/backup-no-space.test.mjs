// A site where the app has no space to keep its backup page in (no global space it can see, or
// none it may add a page to) must not fail every hour. It used to: the automatic run threw "No
// space found where the app can keep its backup page.", logged an ERROR, wrote a "backup failed"
// row to the site history, and left no check time behind, so the hourly sweep queued the same
// failing run again an hour later, forever. Now the site enters ONE stored state the Backup tab
// shows ("Backups are paused ..."), announced once, checked again once a day, after a change and
// on Back up now / Move; a backup that succeeds ends it. A list Confluence could not answer
// (429/5xx) is "could not tell", never "no space": it stays an ordinary failure.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, onConfluence, fake } = await import("./_forge-fake/state.mjs");
const { runInvocation } = await import("../src/server/shared/confluence-call.js");
const { backupConsumer, sweepReason } = await import("../src/server/capsules/backup/worker.js");
const { STATUS_KEY, SETTINGS_KEY } = await import("../src/server/capsules/backup/engine.js");

const lines = { error: [], warn: [] };
console.error = (...a) => lines.error.push(a.join(" "));
console.warn = (...a) => lines.warn.push(a.join(" "));
const LOG = console.log;
console.info = () => {}; console.log = () => {};
const clear = () => { lines.error = []; lines.warn = []; };

const APP = "app-account";
// world: { spaces: [{id,key}], listStatus, createStatus }
let world;
function site(w) {
  resetFake();
  world = { spaces: [], listStatus: 200, createStatus: 200, pages: new Map(), ...w };
  fake.kvs.set("admin-settings-global", { enabled: true }); // something worth backing up
  onConfluence((method, rawPath, body) => {
    const path = decodeURIComponent(rawPath);
    const [base, query = ""] = path.split("?");
    const qs = new URLSearchParams(query);
    let m;
    if (base === "/wiki/rest/api/user/current") return { body: { accountId: APP } };
    if (base === "/wiki/rest/api/content/search") return { body: { results: [] } };
    if (base === "/wiki/api/v2/spaces" && qs.get("keys")) {
      const s = world.spaces.find((x) => x.key === qs.get("keys"));
      return { body: { results: s ? [{ id: s.id, key: s.key, name: s.key, type: "global", status: "current" }] : [] } };
    }
    if (base === "/wiki/api/v2/spaces") {
      if (world.listStatus !== 200) return { status: world.listStatus, body: { message: "busy" } };
      return { body: { results: world.spaces.map((s) => ({ id: s.id, key: s.key, name: s.key })) } };
    }
    if (method === "POST" && base === "/wiki/api/v2/pages") {
      if (world.createStatus !== 200) return { status: world.createStatus, body: { message: "not permitted" } };
      const id = String(5000 + world.pages.size);
      world.pages.set(id, { id, title: body.title, spaceId: body.spaceId, props: [] });
      return { body: { id, title: body.title } };
    }
    if ((m = base.match(/^\/wiki\/api\/v2\/pages\/(\d+)$/))) {
      const p = world.pages.get(m[1]);
      return p ? { body: { id: p.id, title: p.title, spaceId: p.spaceId, authorId: APP, status: "current" } } : { status: 404, body: {} };
    }
    if ((m = base.match(/^\/wiki\/rest\/api\/content\/(\d+)\/restriction$/))) {
      if (method === "PUT") return { body: {} };
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
const run = (reason = "schedule") => runInvocation(() => backupConsumer({ body: { kind: "backup", reason } }));
const status = () => fake.kvs.get(STATUS_KEY) || {};
const auditRows = () => [...fake.kvs.keys()].filter((k) => k.startsWith("activity-site-")).length;
const creates = () => fake.calls.filter((c) => c.method === "POST" && c.path.startsWith("/wiki/api/v2/pages")).length;

// 1. No global space the app can see, nothing remembered.
site({});
clear();
await run();
let st = status();
eq("no space: no ERROR line", lines.error.filter((l) => l.includes("[BACKUP]")), []);
eq("no space: one plain line says backups are paused", lines.warn.filter((l) => l.includes("[BACKUP]") && /paused/.test(l)).length, 1);
eq("no space: the stored state names the cause", st.noSpace?.cause, "none-visible");
ok("no space: the state records when it began", !!st.noSpace?.since);
eq("no space: no raw error row for the tab to print", st.lastError ?? null, null);
ok("no space: a check time is kept", !!st.lastCheckAt);
eq("no space: one history row", auditRows(), 1);
const since = st.noSpace?.since;

// 2. The hourly sweep does not queue it again within the day; a day later, or after a change, it does.
const at = Date.parse(st.lastCheckAt);
eq("sweep 1 h later: nothing queued", sweepReason(st, false, at + 3600000), null);
eq("sweep 23 h later: nothing queued", sweepReason(st, false, at + 23 * 3600000), null);
eq("sweep 25 h later: the daily check", sweepReason(st, false, at + 25 * 3600000), "schedule");
eq("a change: checked at once", sweepReason(st, true, at + 60000), "save");

// 3. Checking again while nothing changed: silent, no new history row, same start.
clear();
await run();
st = status();
eq("again: no ERROR line", lines.error.filter((l) => l.includes("[BACKUP]")), []);
eq("again: no new line at all", lines.warn.filter((l) => l.includes("[BACKUP]")), []);
eq("again: no new history row", auditRows(), 1);
eq("again: the state keeps its start", st.noSpace?.since, since);

// 4. Spaces exist but the app may add a page in none of them.
site({ spaces: [{ id: "11", key: "ONE" }, { id: "22", key: "TWO" }], createStatus: 403 });
clear();
await run();
st = status();
eq("not allowed: no ERROR line", lines.error.filter((l) => l.includes("[BACKUP]") && !l.includes("page in")), []);
eq("not allowed: the state names the cause", st.noSpace?.cause, "not-allowed");
eq("not allowed: tried each space once", creates(), 2);

// 5. The space list could not be read (busy Confluence): could not tell, never "no space".
site({ listStatus: 503 });
clear();
await run();
st = status();
eq("busy list: no paused state", st.noSpace ?? null, null);
ok("busy list: an ordinary failure is recorded", !!st.lastError);
eq("busy list: and logged once as a failure", lines.error.filter((l) => l.includes("[BACKUP] failed")).length, 1);

// 5b. A remembered space is still used when the list is busy (and a refusal there is not "no space").
site({ spaces: [{ id: "44", key: "KEPT" }], listStatus: 503 });
fake.kvs.set(SETTINGS_KEY, { spaceKey: "KEPT" });
clear();
await run();
st = status();
ok("busy list, remembered space: the backup is kept there", fake.kvs.get(SETTINGS_KEY)?.pageId && !!st.lastBackup?.generationId);
site({ spaces: [{ id: "44", key: "KEPT" }], listStatus: 503, createStatus: 403 });
fake.kvs.set(SETTINGS_KEY, { spaceKey: "KEPT" });
await run();
st = status();
eq("busy list, remembered space refused: not paused (the list was not read)", st.noSpace ?? null, null);
ok("busy list, remembered space refused: an ordinary failure", !!st.lastError);

// 6. A busy list on a site already paused keeps the paused state (it was not disproved).
site({});
await run();
world.listStatus = 503;
clear();
await run();
st = status();
eq("paused, then busy: still paused", st.noSpace?.cause, "none-visible");

// 7. A space becomes usable: the next run backs up and the paused state ends.
site({});
await run();
world.spaces = [{ id: "33", key: "OPS" }];
clear();
await run("save");
st = status();
eq("space found: no paused state", st.noSpace ?? null, null);
eq("space found: no error", st.lastError ?? null, null);
ok("space found: the backup page is remembered", !!fake.kvs.get(SETTINGS_KEY)?.pageId);
ok("space found: a backup was recorded", !!st.lastBackup?.generationId);

// 8. The Backup tab shows the state in place of "No backup yet", with the way out.
{
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const tab = readFileSync(fileURLToPath(new URL("../src/ui/kit/BackupTab.jsx", import.meta.url)), "utf8");
  ok("tab: the paused state has its own notice", /st\.noSpace && \(\s*<div[^>]*data-testid="bk-no-space"/.test(tab));
  ok("tab: it names both causes and the way out", tab.includes("not-allowed") && tab.includes("Move to another space. The app also checks again once a day"));
  ok("tab: \"No backup yet\" is not shown while paused", /!st\.noSpace && <p className="api-empty" data-testid="bk-none">No backup yet/.test(tab));
}

console.log = LOG;
report("backup-no-space");
