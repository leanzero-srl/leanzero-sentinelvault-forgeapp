// The one-time repair of activity rows that 8.9.0-8.19.0 may have filed under another site's space key
// (src/server/infra/activity-refile.js). A row moves only when it is PROVEN foreign: written since the
// memo shipped, its key no space of this site (Confluence said so, and the same lookup finds the page's
// own space), and the page's current space found. Everything else stays exactly as it was.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, onConfluence, fake } = await import("./_forge-fake/state.mjs");
const { kvs } = await import("@forge/kvs");
const { buildActivityKeys } = await import("../src/server/infra/activity-log.js");
const { refileForeignActivity, refileVerdict, REFILE_STATE_KEY, REFILE_SINCE, REFILE_TRIES_PER_PAGE } = await import("../src/server/infra/activity-refile.js");
console.warn = () => {}; console.error = () => {}; console.info = () => {};

const SINCE = Date.parse(REFILE_SINCE);
const AFTER = SINCE + 86_400_000;   // a day after the memo shipped
const BEFORE = SINCE - 86_400_000;  // before it
// This site: BRAVO (22) and CHARLIE (33) are current spaces, ARCH (44) is archived, ~pers (55) personal.
const SPACES = { BRAVO: "22", CHARLIE: "33", ARCH: "44", "~pers": "55" };
const PAGES = { 9001: "22", 9003: "33" }; // 9002 is gone (404)
let spacesStatus = 200;
let brokenLookup = false; // the keys= lookup answers [] for everything (positive control must catch it)

function world() {
  resetFake();
  spacesStatus = 200; brokenLookup = false;
  onConfluence((method, rawPath) => {
    const path = decodeURIComponent(rawPath);
    const [base, query = ""] = path.split("?");
    const qs = new URLSearchParams(query);
    let m;
    if (base === "/wiki/api/v2/spaces" && qs.has("keys")) {
      if (spacesStatus !== 200) return { status: spacesStatus, body: "busy", headers: { "Retry-After": "0" } };
      const key = qs.get("keys");
      return { body: { results: !brokenLookup && SPACES[key] ? [{ id: SPACES[key], key }] : [] } };
    }
    if ((m = base.match(/^\/wiki\/api\/v2\/pages\/(\d+)$/))) return PAGES[m[1]] ? { body: { id: m[1], spaceId: PAGES[m[1]] } } : { status: 404, body: {} };
    if (base.match(/^\/wiki\/api\/v2\/blogposts\/\d+$/)) return { status: 404, body: {} };
    if ((m = base.match(/^\/wiki\/api\/v2\/spaces\/(\d+)$/))) {
      const key = Object.keys(SPACES).find((k) => SPACES[k] === m[1]);
      return key ? { body: { id: m[1], key } } : { status: 404, body: {} };
    }
    return undefined;
  });
}

let seq = 0;
async function row({ pageId = "9001", spaceKey, ts = AFTER, type = "seal.created" }) {
  const rand = String(++seq).padStart(6, "0");
  const { id, pageKey, spaceKey: spaceStoreKey } = buildActivityKeys({ pageId, spaceKey, tsMs: ts, rand });
  const value = { id, ts: new Date(ts).toISOString(), type, pageId, spaceKey, actor: { accountId: "acct-1", name: "Ann" }, target: { kind: "page", id: pageId, name: null }, details: {}, version: null };
  if (pageKey) await kvs.set(pageKey, value);
  if (spaceStoreKey) await kvs.set(spaceStoreKey, value);
  return { id, pageKey, spaceStoreKey, value };
}
const keysUnder = (prefix) => [...fake.kvs.keys()].filter((k) => k.startsWith(prefix)).sort();
const lookups = () => fake.calls.filter((c) => c.path.includes("/wiki/api/v2/spaces?keys="));
async function runToEnd(max = 50) {
  let r;
  for (let i = 0; i < max; i++) { r = await refileForeignActivity({ budgetMs: 60_000 }); if (r.skipped || r.done) break; }
  return r;
}

// ── the pure verdict ───────────────────────────────────────────────────────────────────────────
{
  const base = { id: "x", ts: new Date(AFTER).toISOString(), pageId: "9001", spaceKey: "ALPHA" };
  const key = "activity-space-ALPHA-x";
  const v = (o, r = base, k = key) => refileVerdict(r, k, { sinceMs: SINCE, ...o }).verdict;
  eq("a space of this site is local", v({ exists: true }), "local");
  eq("an unanswered space lookup is unknown", v({ exists: null }), "unknown");
  eq("a foreign key whose page cannot be read now stays", v({ exists: false, live: { status: "gone" } }), "kept");
  eq("a foreign key with an unanswered page read is unknown", v({ exists: false, live: { status: "error" } }), "unknown");
  eq("the positive control unanswered is unknown", v({ exists: false, live: { status: "found", spaceKey: "BRAVO" }, control: null }), "unknown");
  eq("the positive control not finding the page's own space keeps the row", v({ exists: false, live: { status: "found", spaceKey: "BRAVO" }, control: false }), "kept");
  eq("proven foreign moves to the page's space", refileVerdict(base, key, { sinceMs: SINCE, exists: false, live: { status: "found", spaceKey: "BRAVO" }, control: true }), { verdict: "foreign", to: "BRAVO" });
  eq("a key this site named before the memo is local, whatever the lookup says", v({ exists: false, known: true, live: { status: "found", spaceKey: "BRAVO" }, control: true }), "local");
  eq("a key that also holds another page's rows here is kept", v({ exists: false, known: false, otherPages: true, live: { status: "found", spaceKey: "BRAVO" }, control: true }), "kept");
  eq("could not tell whether this site named the key: unknown", v({ exists: false, known: null, live: { status: "found", spaceKey: "BRAVO" }, control: true }), "unknown");
  eq("a row from before the memo is never looked at", v({ exists: false }, { ...base, ts: new Date(BEFORE).toISOString() }), "skip");
  eq("a row naming no page is never looked at", v({ exists: false }, { ...base, pageId: null }), "skip");
  eq("a row stored under a key that does not match its own space key is left alone", v({ exists: false }, base, "activity-space-OTHER-x"), "skip");
}

// ── 1. the walk: moves exactly the proven foreign rows ─────────────────────────────────────────
{
  world();
  const foreign = await row({ spaceKey: "ALPHA" });
  const local = await row({ spaceKey: "BRAVO" });
  const archived = await row({ pageId: "9003", spaceKey: "ARCH" });
  const personal = await row({ pageId: "9003", spaceKey: "~pers" });
  const gone = await row({ pageId: "9002", spaceKey: "DELTA" });
  const old = await row({ spaceKey: "ECHO", ts: BEFORE });
  const spaceOnly = await row({ pageId: null, spaceKey: "FOXTROT", type: "classification.space-default-set" });
  const r = await runToEnd();
  eq("the walk finishes", !!r.done, true);
  eq("one row re-filed", r.refiled, 1);
  ok("the foreign row left the foreign key", !fake.kvs.has(foreign.spaceStoreKey));
  const moved = fake.kvs.get(`activity-space-BRAVO-${foreign.id}`);
  eq("... and is now under the page's space, same id and content", moved && { ...moved, spaceKey: "ALPHA" }, foreign.value);
  eq("its page-feed twin names this site's space", fake.kvs.get(foreign.pageKey)?.spaceKey, "BRAVO");
  eq("a local row is untouched", fake.kvs.get(local.spaceStoreKey), local.value);
  eq("an archived space is a space of this site: untouched", fake.kvs.get(archived.spaceStoreKey), archived.value);
  eq("a personal space is a space of this site: untouched", fake.kvs.get(personal.spaceStoreKey), personal.value);
  eq("a page the app cannot read now: untouched and counted", [fake.kvs.get(gone.spaceStoreKey), r.kept], [gone.value, 1]);
  eq("a row from before 8.9.0: untouched", fake.kvs.get(old.spaceStoreKey), old.value);
  eq("a row naming no page: untouched", fake.kvs.get(spaceOnly.spaceStoreKey), spaceOnly.value);
  const asked = lookups().map((c) => decodeURIComponent(c.path).match(/keys=([^&]*)/)[1]).sort();
  eq("one space lookup per distinct key in a run (ALPHA, ARCH, BRAVO as the control, DELTA, ~pers; never ECHO from before 8.9.0)", asked, ["ALPHA", "ARCH", "BRAVO", "DELTA", "~pers"]);
  const writes = [];
  const realSet = kvs.set;
  kvs.set = async (k, v, o) => { writes.push(k); return realSet(k, v, o); };
  const again = await refileForeignActivity();
  kvs.set = realSet;
  eq("once done it never walks again", [again.skipped, fake.kvs.get(REFILE_STATE_KEY)?.done], [true, true]);
  eq("... and writes nothing, not even its lock", writes, []);
}

// ── 1b. a space the app cannot see (lookup answers []) that THIS site used before the memo: never moved ──
{
  world();
  PAGES[9004] = "22"; // the page moved from HIDDEN to BRAVO after its event
  await row({ pageId: "9005", spaceKey: "HIDDEN", ts: BEFORE }); // HIDDEN's own history from before 8.9.0
  const hidden = await row({ pageId: "9004", spaceKey: "HIDDEN" });
  const configured = await row({ pageId: "9004", spaceKey: "CONF" });
  await kvs.set("admin-settings-space-CONF", { adminUsers: [] }); // a space this site configured
  const r = await runToEnd();
  eq("a hidden space with history here keeps its row", [r.done, r.refiled, fake.kvs.get(hidden.spaceStoreKey)], [true, 0, hidden.value]);
  eq("a space with Sentinel Vault settings here keeps its row", fake.kvs.get(configured.spaceStoreKey), configured.value);
  delete PAGES[9004];
}

// ── 1c. the memo misfiled one page id at a time: a key holding rows of two pages is a real space ──
{
  world();
  PAGES[9006] = "22";
  const a = await row({ pageId: "9001", spaceKey: "GONE" });
  const b = await row({ pageId: "9006", spaceKey: "GONE" });
  const r = await runToEnd();
  eq("rows of two pages under one unknown key both stay", [r.done, r.refiled, r.kept, fake.kvs.get(a.spaceStoreKey), fake.kvs.get(b.spaceStoreKey)], [true, 0, 2, a.value, b.value]);
  delete PAGES[9006];
}

{
  // A space-level event (no page) under a key is this site's own space event: the key is a real space.
  world();
  const foreign = await row({ spaceKey: "GOLF" });
  await row({ pageId: null, spaceKey: "GOLF", type: "classification.space-default-set" });
  const r = await runToEnd();
  eq("a key with a space-level event here is never moved", [r.refiled, fake.kvs.get(foreign.spaceStoreKey)], [0, foreign.value]);
}

// ── 2. many rows across KVS pages, deletions in the middle (the fake's cursor counts positions) ──
{
  world();
  const made = [];
  for (let i = 0; i < 260; i++) made.push(await row({ spaceKey: i % 2 ? "ALPHA" : "BRAVO" }));
  const r = await runToEnd();
  eq("every foreign row of 260 re-filed, none skipped by the shifting cursor", [r.done, r.refiled], [true, 130]);
  eq("nothing is left under the foreign key", keysUnder("activity-space-ALPHA-").length, 0);
  eq("all 260 rows are under this site's space", keysUnder("activity-space-BRAVO-").length, 260);
  eq("every page-feed twin names this site's space", made.filter((m) => fake.kvs.get(m.pageKey)?.spaceKey !== "BRAVO").length, 0);
}

// ── 3. Confluence busy: nothing moves, the same rows are asked again, then passed over ──────────
{
  world();
  const foreign = await row({ spaceKey: "ALPHA" });
  spacesStatus = 429;
  const r1 = await refileForeignActivity({ budgetMs: 60_000 });
  eq("a 429 stops the run with nothing changed", [!!r1.stopped, fake.kvs.get(foreign.spaceStoreKey)], [true, foreign.value]);
  spacesStatus = 200;
  const r2 = await runToEnd();
  eq("the next run re-files it", [r2.done, r2.refiled, fake.kvs.has(foreign.spaceStoreKey)], [true, 1, false]);
}
{
  world();
  const foreign = await row({ spaceKey: "ALPHA" });
  spacesStatus = 503;
  let r;
  for (let i = 0; i < REFILE_TRIES_PER_PAGE + 2; i++) r = await refileForeignActivity({ budgetMs: 60_000 });
  eq("stops in quick succession count as one try: nothing is passed over", [!!r.done, fake.kvs.get(REFILE_STATE_KEY)?.tries], [false, 1]);
  let t = Date.now();
  t += 11 * 60000; await refileForeignActivity({ budgetMs: 60_000, now: () => t }); // counted try 2
  const t5 = t + 5 * 60000;
  await refileForeignActivity({ budgetMs: 60_000, now: () => t5 }); // five minutes later: not the passing-over try yet
  eq("the passing-over try waits ten minutes too", [fake.kvs.get(REFILE_STATE_KEY)?.done, fake.kvs.get(REFILE_STATE_KEY)?.passedOver], [undefined, 0]);
  for (let i = 0; i < REFILE_TRIES_PER_PAGE; i++) { t += 11 * 60000; const at = t; r = await refileForeignActivity({ budgetMs: 60_000, now: () => at }); }
  const st = fake.kvs.get(REFILE_STATE_KEY);
  eq(`after ${REFILE_TRIES_PER_PAGE} tries ten minutes apart the unanswered rows are passed over, untouched`, [st?.done, st?.passedOver, fake.kvs.get(foreign.spaceStoreKey)], [true, 1, foreign.value]);
}
{
  // One step at a time per site.
  world();
  const foreign = await row({ spaceKey: "ALPHA" });
  await kvs.set("activity-refile-lock", { token: "other", at: new Date().toISOString() });
  // The shared fake ignores keyPolicy; honour FAIL_IF_EXISTS here as Forge KVS does.
  const realSet = kvs.set;
  kvs.set = async (k, v, o) => { if (o?.keyPolicy === "FAIL_IF_EXISTS" && fake.kvs.has(k)) throw new Error("key exists"); return realSet(k, v, o); };
  const r = await refileForeignActivity({ budgetMs: 60_000 });
  kvs.set = realSet;
  eq("a step another run holds the lock for waits and changes nothing", [!!r.waiting, fake.kvs.get(foreign.spaceStoreKey)], [true, foreign.value]);
}

// ── 4. the positive control: a lookup that finds nothing at all proves nothing ─────────────────
{
  world();
  const foreign = await row({ spaceKey: "ALPHA" });
  brokenLookup = true;
  const r = await runToEnd();
  eq("an empty answer for the page's own space keeps the row", [r.done, r.refiled, fake.kvs.get(foreign.spaceStoreKey)], [true, 0, foreign.value]);
}

// ── 5. a backup restored or imported since 8.9.0: its rows may be another site's, left alone ───
{
  world();
  const foreign = await row({ spaceKey: "ALPHA" });
  const { siteKey } = buildActivityKeys({ tsMs: AFTER + 1000, rand: "zzzzzz", site: true });
  await kvs.set(siteKey, { id: "s", ts: new Date(AFTER + 1000).toISOString(), type: "backup.imported", pageId: null, spaceKey: null });
  const r = await refileForeignActivity({ budgetMs: 60_000 });
  eq("an import since 8.9.0 leaves every row alone", [fake.kvs.get(REFILE_STATE_KEY)?.reason, r.refiled || 0, fake.kvs.get(foreign.spaceStoreKey)], ["restored", 0, foreign.value]);
}
{
  world();
  const foreign = await row({ spaceKey: "ALPHA" });
  const { siteKey } = buildActivityKeys({ tsMs: BEFORE, rand: "yyyyyy", site: true });
  await kvs.set(siteKey, { id: "s", ts: new Date(BEFORE).toISOString(), type: "backup.restored", pageId: null, spaceKey: null });
  const r = await runToEnd();
  eq("a restore before 8.9.0 does not stop the repair", [r.done, r.refiled, fake.kvs.has(foreign.spaceStoreKey)], [true, 1, false]);
}

{
  world();
  const foreign = await row({ spaceKey: "ALPHA" });
  const { siteKey } = buildActivityKeys({ tsMs: AFTER + 1000, rand: "xxxxxx", site: true });
  await kvs.set(siteKey, { id: "s", ts: new Date(AFTER + 1000).toISOString(), type: "backup.restore-failed", pageId: null, spaceKey: null });
  await refileForeignActivity({ budgetMs: 60_000 });
  eq("a restore that failed half way also leaves every row alone", [fake.kvs.get(REFILE_STATE_KEY)?.reason, fake.kvs.get(foreign.spaceStoreKey)], ["restored", foreign.value]);
}
{
  world();
  const foreign = await row({ spaceKey: "ALPHA" });
  await kvs.set("backup-lease", { token: "t", at: new Date().toISOString() });
  const r = await refileForeignActivity({ budgetMs: 60_000 });
  eq("while a backup, restore or import runs the step waits and changes nothing", [!!r.waiting, fake.kvs.get(foreign.spaceStoreKey), fake.kvs.get(REFILE_STATE_KEY)], [true, foreign.value, undefined]);
  await kvs.set("backup-lease", { token: "t", at: new Date(Date.now() - 17 * 60000).toISOString() });
  const r2 = await runToEnd();
  eq("a stale lease (a killed run) does not hold it back", [r2.done, r2.refiled], [true, 1]);
}

// ── 6. the privacy sweep rewrote the row while it moved: the latest value is kept ──────────────
{
  world();
  const foreign = await row({ spaceKey: "ALPHA" });
  const realGet = kvs.get;
  let reads = 0;
  kvs.get = async (k) => {
    if (k === foreign.spaceStoreKey && ++reads === 1) {
      const v = await realGet(k);
      await kvs.set(k, { ...v, actor: { accountId: "acct-1", name: null } }); // erased mid-move
      return realGet(k);
    }
    return realGet(k);
  };
  await runToEnd();
  kvs.get = realGet;
  eq("the re-filed row carries the erased name", fake.kvs.get(`activity-space-BRAVO-${foreign.id}`)?.actor?.name, null);
}

// ── 7. retention or erasure removed the row while it moved: nothing comes back ──────────────────
{
  world();
  const foreign = await row({ spaceKey: "ALPHA" });
  const realGet = kvs.get;
  let reads = 0;
  kvs.get = async (k) => {
    if (k === foreign.spaceStoreKey && ++reads === 2) { await kvs.delete(k); await kvs.delete(foreign.pageKey); } // removed between the move's two reads
    return realGet(k);
  };
  await runToEnd();
  kvs.get = realGet;
  eq("no copy of a removed row is left anywhere", [keysUnder("activity-space-").length, keysUnder("activity-page-").length], [0, 0]);
}
{
  world();
  const foreign = await row({ spaceKey: "ALPHA" });
  const realGet = kvs.get;
  kvs.get = async (k) => { if (k === foreign.spaceStoreKey) await kvs.delete(k); return realGet(k); }; // already gone when the move starts
  const r = await runToEnd();
  kvs.get = realGet;
  eq("a row gone before the move is not written anywhere", [r.refiled, keysUnder("activity-space-BRAVO-").length], [0, 0]);
}

// ── 8. a cursor KVS keeps refusing: the walk starts over after three failures ───────────────────
{
  world();
  await row({ spaceKey: "BRAVO" });
  await kvs.set(REFILE_STATE_KEY, { cursor: "dead", checked: 0, refiled: 0, kept: 0, passedOver: 0, tries: 0, failures: 0 });
  const realQuery = kvs.query;
  kvs.query = () => { const q = realQuery(); const cursor = q.cursor; q.cursor = (c) => { if (c === "dead") throw new Error("bad cursor"); return cursor(c); }; return q; };
  for (let i = 0; i < 3; i++) await refileForeignActivity({ budgetMs: 60_000 });
  eq("after three failures at one cursor the walk starts over", fake.kvs.get(REFILE_STATE_KEY)?.cursor, null);
  const r = await runToEnd();
  kvs.query = realQuery;
  eq("... and finishes", !!r.done, true);
}

report("activity-refile");
