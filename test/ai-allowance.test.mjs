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
  eq("failed read uses a 10-day-old count", (await b.al.licensedUsers()), { users: 77, source: "stale-cache" });
  b.store.set(COUNT_KEY, { count: 77, at: new Date(T0 - 36 * 86400000).toISOString() });
  eq("count older than 35 days -> 10 users", (await b.al.licensedUsers()), { users: 10, source: "fallback" });
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

report();
