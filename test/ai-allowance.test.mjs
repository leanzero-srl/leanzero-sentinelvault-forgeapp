// The site-wide monthly AI allowance (capsules/validations/allowance.js, owner decision 2026-10-26).
// The concurrency case uses the LOCK TEST's fake KVS (latency + an atomic FAIL_IF_EXISTS, as in
// test/kvs-lock.test.mjs): the shared _forge-fake KVS ignores keyPolicy, so a lock there always wins
// and a race could never show.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const A = await import("../src/server/capsules/validations/allowance.js");
const { makeLocks } = await import("../src/server/shared/kvs-lock.js");
const {
  makeAllowance, defaultAllowanceMicro, effectiveLimitMicro, costMicro, estimateMicro, monthKeyOf,
  licenceForcesFreeTier, PER_USER_MICRO, OUTPUT_RESERVE_MICRO, RESERVATION_MAX_MS, rowKey, COUNT_KEY,
} = A;

function fakeKvs() {
  const store = new Map();
  const ctl = { latency: () => 1, failGet: 0 };
  const wait = () => new Promise((r) => setTimeout(r, ctl.latency()));
  const kvs = {
    async get(k) { await wait(); if (ctl.failGet > 0) { ctl.failGet--; throw new Error("429"); } return structuredClone(store.get(k)); },
    async set(k, v, o) { await wait(); if (o?.keyPolicy === "FAIL_IF_EXISTS" && store.has(k)) throw new Error("KEY_EXISTS"); store.set(k, structuredClone(v)); },
    async delete(k) { await wait(); store.delete(k); },
  };
  return { store, ctl, kvs };
}
const T0 = Date.parse("2026-10-20T10:00:00Z");
function bed({ users = 50, ctx = { environmentType: "DEVELOPMENT" }, clock = { t: T0 }, fetchCount } = {}) {
  const f = fakeKvs();
  const al = makeAllowance({
    kvs: f.kvs, locks: makeLocks(f.kvs), now: () => clock.t,
    fetchCount: fetchCount || (async () => users), appContext: () => ctx, lockWaitMs: 20000,
  });
  return { ...f, al, clock };
}

// --- pure ---
eq("per-user worst case is 30,480 micro-dollars", PER_USER_MICRO, 30480);
eq("default = users x 30,480", defaultAllowanceMicro(150), 150 * 30480);
eq("10-user floor", defaultAllowanceMicro(3), 10 * 30480);
eq("admin can lower", effectiveLimitMicro(1000000, 50000), 50000);
eq("admin cannot raise", effectiveLimitMicro(1000000, 9e9), 1000000);
eq("0 / absent = default", effectiveLimitMicro(1000000, 0), 1000000);
eq("garbage = default", effectiveLimitMicro(1000000, "x"), 1000000);
eq("cost = in x1 + out x5", costMicro({ inputTokens: 10000, outputTokens: 4096 }), 30480);
eq("estimate covers the full output (a number = ASCII chars, 2 a token)", estimateMicro(300), 150 + OUTPUT_RESERVE_MICRO);
// review finding 6: CJK text runs ~1-2 tokens a character; the old chars/3 reserved a third of a token.
eq("finding 6: CJK counts its full UTF-8 size (3 a character)", estimateMicro("\u6587".repeat(3000)), 9000 + OUTPUT_RESERVE_MICRO);
ok("finding 6: a CJK prompt reserves at least 1.5 tokens a character", estimateMicro("\u6587\u66f8".repeat(5000)) - OUTPUT_RESERVE_MICRO >= 1.5 * 10000);
eq("finding 6: ASCII text, 2 characters a token", estimateMicro("ab".repeat(500)), 500 + OUTPUT_RESERVE_MICRO);
eq("UTC month key", monthKeyOf(Date.parse("2026-10-31T23:59:59Z")), "202610");
eq("trial -> 10 users", licenceForcesFreeTier({ license: { isEvaluation: true, active: true } }), "trial");
eq("inactive -> 10 users", licenceForcesFreeTier({ license: { active: false } }), "unlicensed");
// review finding 4: the runtime licence object may carry isActive instead of active.
eq("finding 4: isActive false -> 10 users", licenceForcesFreeTier({ license: { isActive: false } }), "unlicensed");
eq("finding 4: isActive true -> the count", licenceForcesFreeTier({ license: { isActive: true, isEvaluation: false } }), null);
eq("paid licence -> count", licenceForcesFreeTier({ license: { active: true, isEvaluation: false } }), null);
eq("production without a licence -> 10 users", licenceForcesFreeTier({ environmentType: "PRODUCTION" }), "unlicensed");
eq("development -> count", licenceForcesFreeTier({ environmentType: "DEVELOPMENT" }), null);

// --- the user count ---
{
  const b = bed({ users: 42 });
  eq("count read as the app", (await b.al.licensedUsers()).users, 42);
  eq("count cached", b.store.get(COUNT_KEY)?.count, 42);
}
{
  const b = bed({ fetchCount: async () => null });
  b.store.set(COUNT_KEY, { count: 77, at: new Date(T0 - 10 * 86400000).toISOString() });
  eq("failed read uses a 10-day-old count", (await b.al.licensedUsers()), { users: 77, source: "stale-cache", counted: 77 });
  b.store.set(COUNT_KEY, { count: 77, at: new Date(T0 - 36 * 86400000).toISOString() });
  eq("count older than 35 days -> 10 users", (await b.al.licensedUsers()), { users: 10, source: "fallback", counted: null });
  b.store.delete(COUNT_KEY);
  eq("never read -> 10 users", (await b.al.licensedUsers()).users, 10);
}
{
  const b = bed({ fetchCount: async () => { throw new Error("404"); } });
  eq("a throwing read -> 10 users", (await b.al.licensedUsers()).source, "fallback");
  const v = await b.al.view({});
  ok("the view says so", /10-user allowance/.test(v.note || ""));
}
{
  const b = bed({ users: 5000, ctx: { license: { active: true, isEvaluation: true } } });
  eq("a trial never reads the count", (await b.al.limits({})).limitMicro, 10 * 30480);
}

// --- reserve / settle ---
{
  const b = bed({ users: 10 }); // 304,800
  const r = await b.al.reserve("a", 40000, {});
  ok("reserve ok", r.ok);
  eq("reservation counted", b.store.get(rowKey("202610")).reservedMicro, 40000);
  await b.al.settle(r, { inputTokens: 3000, outputTokens: 500 });
  const row = b.store.get(rowKey("202610"));
  eq("settled to the actual cost", [row.spentMicro, row.reservedMicro, row.runs], [5500, 0, 1]);
  const failed = await b.al.reserve("b", 40000, {});
  await b.al.settle(failed, { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  eq("a failed call settles at 0", b.store.get(rowKey("202610")).spentMicro, 5500);
}
{ // admin lowered below what is spent -> refused; the message names the month and the reset
  const b = bed({ users: 10 });
  const r = await b.al.reserve("a", 30000, {});
  await b.al.settle(r, { inputTokens: 10000, outputTokens: 2000 }); // 20,000
  const lowered = { monthlyAllowanceMicro: 21000 };
  const p = await b.al.precheck(lowered);
  eq("precheck refuses when spent", p.why, "allowance");
  ok("message names month + reset", /October 2026.*1 November 2026.*keep working/.test(p.reason));
  const no = await b.al.reserve("b", 25000, lowered);
  eq("reserve refuses", [no.ok, no.why, no.firstTrip], [false, "allowance", true]);
  const again = await b.al.reserve("c", 25000, lowered);
  eq("only the first refusal is a trip", again.firstTrip, false);
  ok("back at the default it runs again", (await b.al.precheck({})).ok);
}
{ // a crashed run: the reservation is charged at its full size once it expires
  const b = bed({ users: 10 });
  await b.al.reserve("dead", 50000, {});
  b.clock.t = T0 + RESERVATION_MAX_MS + 1000;
  const v = await b.al.view({});
  eq("expired reservation is spent at its reserved size", [v.spentMicro, v.reservedMicro], [50000, 0]);
}
{ // a late settle after the reservation expired does not bill twice
  const b = bed({ users: 10 });
  const r = await b.al.reserve("late", 50000, {});
  b.clock.t = T0 + RESERVATION_MAX_MS + 1000;
  await b.al.reserve("x", 1000, {}); // expires "late" into spent
  await b.al.settle(r, { inputTokens: 1000, outputTokens: 100 });
  eq("charged once (reserved size)", b.store.get(rowKey("202610")).spentMicro, 50000);
}
{ // rollover: last month spent in full does not touch this month; settle goes to the reserving month
  const b = bed({ users: 10 });
  b.store.set(rowKey("202609"), { spentMicro: 10 * 30480, reservedMicro: 0, runs: 9, reservations: {}, reachedAt: "2026-09-30T00:00:00Z" });
  ok("a new month starts fresh", (await b.al.precheck({})).ok);
  b.clock.t = Date.parse("2026-10-31T23:59:59Z");
  const r = await b.al.reserve("edge", 40000, {});
  b.clock.t = Date.parse("2026-11-01T00:00:05Z");
  await b.al.settle(r, { inputTokens: 1000, outputTokens: 1000 });
  eq("settled in October, the month it was reserved", b.store.get(rowKey("202610")).spentMicro, 6000);
  ok("November untouched", !b.store.has(rowKey("202611")));
  eq("November view is empty", (await b.al.view({})).spentMicro, 0);
}
{ // a meter that cannot be read refuses (busy), never runs blind
  const b = bed({ users: 10 });
  await b.al.licensedUsers(); // cache the count so the failure lands on the meter row
  b.ctl.failGet = 2; // the cached-count read, then the meter row
  eq("unreadable meter -> busy", (await b.al.precheck({})).why, "busy");
}
{ // CONCURRENCY: 25 reservers at once against a 4-review allowance, random latency
  let worst = 0;
  for (let trial = 0; trial < 4; trial++) {
    const b = bed({ users: 10 });
    b.ctl.latency = () => Math.floor(Math.random() * 4);
    const limit = 4 * 30480;
    const res = await Promise.all(Array.from({ length: 25 }, (_, i) => b.al.reserve(`r${i}`, 30480, { monthlyAllowanceMicro: limit })));
    const granted = res.filter((r) => r.ok).length;
    const row = b.store.get(rowKey("202610"));
    worst = Math.max(worst, granted);
    if (row.reservedMicro > limit || granted > 4) { worst = 99; break; }
    if (Object.keys(row.reservations).length !== granted) { worst = 98; break; }
  }
  eq("25 concurrent reservations never exceed the allowance (granted <= 4)", worst <= 4, true);
}
{ // a held lock past the wait refuses as busy
  const f = fakeKvs();
  const al = makeAllowance({ kvs: f.kvs, locks: makeLocks(f.kvs), now: () => T0, fetchCount: async () => 10, appContext: () => ({}), lockWaitMs: 300 });
  f.store.set("ai-allowance-lock", { token: "LIVE", at: new Date().toISOString() });
  const r = await al.reserve("x", 1000, {});
  eq("busy lock -> refused busy", [r.ok, r.why], [false, "busy"]);
}

{ // review finding 5: a lock row left by a DEAD holder (fresh, so it is not stale yet) must not
  // refuse the review: the default wait outlasts the 15 s hold, so the row is taken over.
  const f = fakeKvs();
  const al = makeAllowance({ kvs: f.kvs, locks: makeLocks(f.kvs), now: () => T0, fetchCount: async () => 10, appContext: () => ({}) });
  f.store.set("ai-allowance-lock", { token: "DEAD", at: new Date().toISOString() });
  const t = Date.now();
  const r = await al.reserve("after-dead", 1000, {});
  eq("finding 5: default wait outlasts the hold -> reserved, not busy", [r.ok, r.why], [true, undefined]);
  ok("finding 5: it waited for the hold to lapse (>= 14 s)", Date.now() - t >= 14000);
}
{ // review finding 5: a settle whose first attempt fails (the meter write throws a 429) is retried
  // once (else the run is charged at its full reservation when it expires).
  const b = bed({ users: 10 });
  const r = await b.al.reserve("s1", 30000, {});
  const realSet = b.kvs.set;
  let failed = 0;
  b.kvs.set = async (k, v, o) => { if (k === rowKey("202610") && failed === 0) { failed++; throw new Error("429"); } return realSet(k, v, o); };
  const s = await b.al.settle(r, { inputTokens: 1000, outputTokens: 100 });
  eq("finding 5: settle retried after a failed meter write", [s.settled, b.store.get(rowKey("202610")).spentMicro], [true, 1500]);
}

// --- 8.22.1: the user count the app CAN read, and a paid site is never strangled ---
// Measured live 2026-10-26 on wolfaenpak as the app: licence userCount 401; the default group
// confluence-users-wolfaenpak answers (50 members, 9 people = the admin view's 9 licensed users).
{
  const PAID = { license: { active: true, isEvaluation: false } };
  const b = bed({ ctx: PAID, fetchCount: async () => null });
  eq("8.22.1: paid licence, no count -> the 250-user floor, not 10", await b.al.licensedUsers(), { users: 250, source: "paid-floor", counted: null });
  const v = await b.al.view({});
  eq("8.22.1: paid floor limit = 250 x 30,480", v.limitMicro, 250 * 30480);
  ok("8.22.1: the view names the floor", /250-user/.test(v.note || ""));
  const g = bed({ ctx: PAID, fetchCount: async () => ({ count: 9, kind: "group" }) });
  eq("8.22.1: paid + group count 9 (a lower bound) -> floor, count kept", await g.al.licensedUsers(), { users: 250, source: "paid-floor", counted: 9 });
  const big = bed({ ctx: PAID, fetchCount: async () => ({ count: 512, kind: "group" }) });
  eq("8.22.1: paid + group count 512 -> 512", (await big.al.licensedUsers()).users, 512);
  eq("8.22.1: the group count is cached with its kind", big.store.get(COUNT_KEY)?.kind, "group");
  const lic = bed({ ctx: PAID, fetchCount: async () => 40 });
  eq("8.22.1: the licence count itself is authoritative (no floor)", (await lic.al.licensedUsers()).users, 40);
  const trial = bed({ ctx: { license: { active: true, isEvaluation: true } }, fetchCount: async () => ({ count: 900, kind: "group" }) });
  eq("8.22.1: a trial stays at 10", (await trial.al.licensedUsers()).users, 10);
  const none = bed({ ctx: { environmentType: "PRODUCTION" }, fetchCount: async () => null });
  eq("8.22.1: production without a licence stays at 10", (await none.al.licensedUsers()).users, 10);
  const dev = bed({ fetchCount: async () => ({ count: 9, kind: "group" }) });
  eq("8.22.1: development (no licence) uses the group count as is", await dev.al.licensedUsers(), { users: 9, source: "group", counted: 9 });
  const old = bed({ ctx: PAID, fetchCount: async () => null });
  old.store.set(COUNT_KEY, { count: 12, at: new Date(T0 - 3600000).toISOString() });
  eq("8.22.1: an old cache row without a kind is a lower bound (paid floor)", (await old.al.licensedUsers()).users, 250);
}
{ // readDefaultGroupCount through a fake Confluence: paging, people only, the site's own group first
  const { readDefaultGroupCount, defaultGroupNames, peopleIn } = A;
  eq("8.22.1: group names from the base URL", defaultGroupNames("https://wolfaenpak.atlassian.net/wiki"), ["confluence-users-wolfaenpak", "confluence-users"]);
  eq("8.22.1: unknown host -> legacy name only", defaultGroupNames("https://wiki.example.com"), ["confluence-users"]);
  eq("8.22.1: apps are not people", peopleIn([{ accountType: "atlassian" }, { accountType: "app" }, { accountType: "customer" }]), 1);
  const groups = [{ id: "g-other", name: "confluence-users" }, { id: "g1", name: "confluence-users-acme" }];
  for (let i = 0; i < 230; i++) groups.unshift({ id: `x${i}`, name: `team-${i}` });
  const members = Array.from({ length: 450 }, (_, i) => ({ accountType: i % 10 === 0 ? "app" : "atlassian" }));
  const calls = [];
  const res = (body) => ({ ok: true, status: 200, json: async () => body });
  const call = async (path) => {
    calls.push(path);
    const u = new URL(path, "https://x");
    const start = Number(u.searchParams.get("start")), limit = Number(u.searchParams.get("limit"));
    const nx = (all, path) => (start + limit < all.length ? { next: `${path}?limit=${limit}&start=${start + limit}` } : {});
    if (u.pathname === "/wiki/rest/api/group") return res({ results: groups.slice(start, start + limit), _links: { base: "https://acme.atlassian.net/wiki", ...nx(groups, u.pathname) } });
    if (u.pathname === "/wiki/rest/api/group/g1/membersByGroupId") return res({ results: members.slice(start, start + limit), _links: nx(members, u.pathname) });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  eq("8.22.1: people in the site's own default group, across pages", await readDefaultGroupCount(call), { status: "done", count: 405 });
  ok("8.22.1: never read the other site's legacy group", !calls.some((c) => c.includes("g-other")));
  eq("8.22.1: a refused group list -> fail", await readDefaultGroupCount(async () => ({ ok: false, status: 401, json: async () => ({}) })), { status: "fail" });
}
{ // the admin card after a trip (8.22.0 live observation): remaining 20,821 > the 20,480 output reserve,
  // every review refused at reservation, yet the card said "not used up".
  const { viewExhausted } = A;
  eq("card: plain arithmetic still open", viewExhausted(23104, { spentMicro: 2283, reservedMicro: 0 }), false);
  eq("card: after a refusal of 22,000 with 20,821 left -> used up", viewExhausted(23104, { spentMicro: 2283, reservedMicro: 0, reachedAt: "x", refusedNeedMicro: 22000 }), true);
  eq("card: raising the limit clears it", viewExhausted(304800, { spentMicro: 2283, reservedMicro: 0, reachedAt: "x", refusedNeedMicro: 22000 }), false);
  const b = bed({ users: 10 });
  const lim = 10 * 30480;
  const r1 = await b.al.reserve("big", lim - 20000, {});
  await b.al.settle(r1, { inputTokens: lim - 20000, outputTokens: 0 }); // 20,000 left: below one reserve already
  const b2 = bed({ users: 10 });
  const r2 = await b2.al.reserve("a", lim - 21000, {}); // 21,000 left > 20,480 reserve
  await b2.al.settle(r2, { inputTokens: lim - 21000, outputTokens: 0 });
  eq("card: before any refusal the view is open", (await b2.al.view({})).exhausted, false);
  const refused = await b2.al.reserve("b", 22000, {});
  ok("card: the 22,000 review is refused", !refused.ok && refused.why === "allowance");
  eq("card: the view now says used up", (await b2.al.view({})).exhausted, true);
  // 8.22.1 review H1: the precheck is the plain arithmetic; one refused review must not block smaller ones.
  eq("H1: a smaller review still passes the precheck after a refusal", (await b2.al.precheck({})).ok, true);
}

{ // H1 (review of e2dc58f): 150k refused with 120k left; a 30k review must still pass precheck AND reserve.
  const b = bed({ users: 10 });
  const lim = 10 * 30480;
  const r = await b.al.reserve("spend", lim - 120000, {});
  await b.al.settle(r, { inputTokens: lim - 120000, outputTokens: 0 });
  const big = await b.al.reserve("big", 150000, {});
  ok("H1: the 150k review is refused", !big.ok && big.why === "allowance");
  eq("H1: the card says used up only while the left is below the smallest refused", (await b.al.view({})).exhausted, true);
  eq("H1: the precheck still lets a 30k review through", (await b.al.precheck({})).ok, true);
  eq("H1: and the 30k reservation is accepted", (await b.al.reserve("small", 30000, {})).ok, true);
}
// --- M2: a failed count is remembered; retried after COUNT_RETRY_MS, not on every call ---
{
  let n = 0;
  const clock = { t: T0 };
  const b = bed({ clock, fetchCount: async () => { n++; return null; } });
  await b.al.licensedUsers(); await b.al.licensedUsers(); await b.al.view({}); await b.al.precheck({});
  eq("M2: four calls after a failure read the count once", n, 1);
  ok("M2: the failure is in the count row", Boolean(b.store.get(COUNT_KEY)?.failedAt));
  clock.t += A.COUNT_RETRY_MS + 1;
  await b.al.licensedUsers();
  eq("M2: after the retry interval it reads again", n, 2);
  const g = bed({ clock: { t: T0 }, fetchCount: async () => null });
  g.store.set(COUNT_KEY, { count: 77, kind: "group", at: new Date(T0 - 2 * 86400000).toISOString() });
  await g.al.licensedUsers();
  eq("M2: a failure keeps the last good count in the row", g.store.get(COUNT_KEY)?.count, 77);
  eq("M2: and still serves it as stale", (await g.al.licensedUsers()).source, "stale-cache");
}
// --- M3 / M4 / M5: the bounded, resumable group scan through a fake Confluence ---
function fakeConf({ groups, members = {}, base = "https://acme.atlassian.net/wiki", cap = 200, total = true, clock = null, msPerCall = 0 }) {
  const calls = [];
  const res = (body) => ({ ok: true, status: 200, json: async () => body });
  const call = async (path) => {
    calls.push(path);
    if (clock) clock.t += msPerCall;
    const u = new URL(path, "https://x");
    const start = Number(u.searchParams.get("start")) || 0, limit = Math.min(cap, Number(u.searchParams.get("limit")) || 25);
    const page = (all, extra) => res({ results: all.slice(start, start + limit), ...extra, _links: { base, ...(start + limit < all.length ? { next: `${u.pathname}?limit=${limit}&start=${start + limit}` } : {}) } });
    if (u.pathname === "/wiki/rest/api/group") return page(groups, {});
    const m = /^\/wiki\/rest\/api\/group\/([^/]+)\/membersByGroupId$/.exec(u.pathname);
    if (m && members[m[1]]) return page(members[m[1]], total ? { totalSize: members[m[1]].length } : {});
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { call, calls };
}
const people = (n) => Array.from({ length: n }, () => ({ accountType: "atlassian" }));
{
  const { readDefaultGroupCount } = A;
  // M4: the server caps limit at 50 (a 50-row page is "short" vs the asked 200): page on the next link.
  const f = fakeConf({ groups: [{ id: "g1", name: "confluence-users-acme" }], members: { g1: people(430) }, cap: 50 });
  eq("M4: a server cap of 50 still counts all 430", await readDefaultGroupCount(f.call), { status: "done", count: 430 });
  const g = fakeConf({ groups: [...Array.from({ length: 120 }, (_, i) => ({ id: `t${i}`, name: `team-${i}` })), { id: "g1", name: "confluence-users-acme" }], members: { g1: people(3) }, cap: 50 });
  eq("M4: the site's group on the 3rd capped page of groups is found", (await readDefaultGroupCount(g.call)).count, 3);
  // M5: renamed site (base acme, its own group still named after the old name) + a legacy group.
  const ren = fakeConf({ groups: [{ id: "old", name: "confluence-users-oldacme" }, { id: "leg", name: "confluence-users" }], members: { old: people(40), leg: people(900) } });
  eq("M5: legacy group not taken when a confluence-users-* group exists", await readDefaultGroupCount(ren.call), { status: "fail" });
  ok("M5: and its members were never read", !ren.calls.some((c) => c.includes("/leg/")));
  const multi = fakeConf({ groups: [{ id: "leg", name: "confluence-users" }, { id: "o", name: "confluence-users-othersite" }], members: { leg: people(900) }, base: "https://wiki.custom-domain.com/wiki" });
  eq("M5: custom domain in a multi-site org -> nothing picked", (await readDefaultGroupCount(multi.call)).status, "fail");
  const old = fakeConf({ groups: [{ id: "leg", name: "confluence-users" }, { id: "x", name: "site-admins" }], members: { leg: people(12) } });
  eq("M5: a site with only the legacy group still counts it", await readDefaultGroupCount(old.call), { status: "done", count: 12 });
  const own = fakeConf({ groups: [{ id: "leg", name: "confluence-users" }, { id: "g1", name: "confluence-users-acme" }], members: { g1: people(7), leg: people(900) } });
  eq("M5: the site's own group wins over the legacy one", (await readDefaultGroupCount(own.call)).count, 7);
  // M3: every call costs 1 s; an 8 s budget per call; 40 member pages. It resumes and finishes.
  const clock = { t: T0 };
  const big = fakeConf({ groups: [{ id: "g1", name: "confluence-users-acme" }], members: { g1: people(8000) }, clock, msPerCall: 1000 });
  let r = await readDefaultGroupCount(big.call, { deadline: clock.t + 8000, now: () => clock.t });
  eq("M3: the first call stops at its budget", r.status, "partial");
  ok("M3: within the budget (<= 9 calls)", big.calls.length <= 9);
  let rounds = 1;
  while (r.status === "partial" && rounds < 20) { r = await readDefaultGroupCount(big.call, { deadline: clock.t + 8000, now: () => clock.t, state: r.state }); rounds++; }
  eq("M3: resumed to the full count", r, { status: "done", count: 8000 });
  eq("M3: no page read twice", big.calls.length, 41);
}
{ // M3 through the allowance: a big site's count builds up across calls, each call bounded.
  const clock = { t: T0 };
  const big = fakeConf({ groups: [{ id: "g1", name: "confluence-users-acme" }], members: { g1: people(8000) }, clock, msPerCall: 1000 });
  const fetchCount = async (o) => {
    const g = await A.readDefaultGroupCount(big.call, o);
    if (g.status === "done") return { count: g.count, kind: "group" };
    if (g.status === "partial") return { partial: g.state, count: g.state.people || 0 };
    return null;
  };
  const b = bed({ clock, fetchCount });
  const first = await b.al.licensedUsers();
  ok("M3: first call is a lower bound, not the 10 fallback", first.users > 10 && first.users < 8000);
  ok("M3: its place is kept in the count row", Boolean(b.store.get(COUNT_KEY)?.scan));
  let u = first; for (let i = 0; i < 10 && u.users < 8000; i++) u = await b.al.licensedUsers();
  eq("M3: later calls finish the count", u.users, 8000);
  eq("M3: the finished row has no scan left", b.store.get(COUNT_KEY)?.scan, undefined);
}

report();
