// Locks on Forge KVS (shared/kvs-lock.js), driven by a FAKE KVS with latency, failed reads and an
// atomic FAIL_IF_EXISTS (the review's sv-break2/lock.mjs): B1 a failed read must mean HELD; B2 two
// takers over one stale row must never BOTH win. Both were RED on aeb6c49 (the live lease stolen;
// 33/200 double wins). Plus the measured trap behind the takeover: an expired ttl row lingers.
import { readFileSync } from "node:fs";
import { eq, ok, report } from "./_assert.mjs";
import { lockIsStale, makeLocks, takeoverKey, CLAIM_MS } from "../src/server/shared/kvs-lock.js";

function fakeKvs() {
  const store = new Map();
  const ctl = { latency: () => 1, failGet: 0 };
  const wait = () => new Promise((r) => setTimeout(r, ctl.latency()));
  const kvs = {
    async get(k) { await wait(); if (ctl.failGet > 0) { ctl.failGet--; const e = new Error("429"); e.status = 429; throw e; } return store.get(k); },
    async set(k, v, o) { await wait(); if (o?.keyPolicy === "FAIL_IF_EXISTS" && store.has(k)) throw new Error("KEY_EXISTS"); store.set(k, structuredClone(v)); },
    async delete(k) { await wait(); store.delete(k); },
  };
  return { store, ctl, kvs };
}
const HOLD = 16 * 60000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const quiet = console.warn; console.warn = () => {};

// pure
const t = Date.parse("2026-10-05T14:52:00Z"), M = 60000;
eq("a lock taken 2 h ago with a 16 min hold is stale", lockIsStale({ at: "2026-10-05T12:24:41Z", token: "x" }, t, 16 * M), true);
eq("a lock taken 5 min ago is live", lockIsStale({ at: new Date(t - 5 * M).toISOString() }, t, 16 * M), false);
eq("exactly at the hold time it is stale", lockIsStale({ at: new Date(t - 16 * M).toISOString() }, t, 16 * M), true);
eq("no row is not stale (free, not taken over)", lockIsStale(null, t, 16 * M), false);
eq("an unreadable time → stale", lockIsStale({ at: "?" }, t, 16 * M), true);
eq("takeover key embeds the dead token", takeoverKey("backup-lease", "DEAD"), "backup-lease:takeover:DEAD");

{ // the plain path
  const { store, kvs } = fakeKvs(); const L = makeLocks(kvs);
  eq("free → acquired", await L.acquireLock("k", HOLD, "A"), true);
  eq("held by a live A → B refused", await L.acquireLock("k", HOLD, "B"), false);
  await L.releaseLock("k", "B");
  eq("B cannot release A's lock", store.get("k")?.token, "A");
  await L.releaseLock("k", "A");
  eq("A releases its own", store.has("k"), false);
}
{ // B1: a live holder and a failed read
  const { store, ctl, kvs } = fakeKvs(); const L = makeLocks(kvs);
  store.set("backup-lease", { token: "LIVE", at: ago(30000) });
  ctl.failGet = 1;
  eq("B1: live lease + one failed read → NOT acquired", await L.acquireLock("backup-lease", HOLD, "TAKER"), false);
  eq("B1: the live lease is untouched", store.get("backup-lease")?.token, "LIVE");
  store.set("backup-lease", { token: "DEAD", at: ago(20 * M) });
  ctl.failGet = 1;
  eq("B1: even a STALE lease is not taken when it cannot be read", await L.acquireLock("backup-lease", HOLD, "TAKER"), false);
  eq("a stale lease that can be read IS taken over", await L.acquireLock("backup-lease", HOLD, "TAKER"), true);
  eq("… and holds the taker's token", store.get("backup-lease")?.token, "TAKER");
  ok("… and the claim row is cleaned up", ![...store.keys()].some((k) => k.includes(":takeover:")));
}
{ // B2: two takers racing over one stale row, varied latency
  let both = 0, none = 0;
  const trials = 150;
  for (let i = 0; i < trials; i++) {
    const { store, ctl, kvs } = fakeKvs(); const L = makeLocks(kvs);
    store.set("k", { token: "DEAD", at: ago(20 * M) });
    let n = 0; ctl.latency = () => (n++ % 7 === 3 ? 30 + Math.random() * 30 : Math.random() * 6);
    const [a, b] = await Promise.all([L.acquireLock("k", HOLD, "A"), L.acquireLock("k", HOLD, "B")]);
    if (a && b) both++;
    if (!a && !b) none++;
    const holder = store.get("k")?.token;
    if ((a && holder !== "A") || (b && holder !== "B")) both++; // a "winner" that does not hold it is a defect too
  }
  eq(`B2: two takers never both win (${trials} races)`, both, 0);
  ok(`B2: the stale row is taken over in most races (none won in ${none}/${trials})`, none < trials / 2);
}
{ // a taker that died mid-takeover leaves a claim row; it goes stale and is claimed past
  const { store, kvs } = fakeKvs(); const L = makeLocks(kvs);
  store.set("k", { token: "DEAD", at: ago(20 * M) });
  store.set(takeoverKey("k", "DEAD"), { token: "GONE", at: ago(10 * M) });
  eq("a dead claim (older than CLAIM_MS) does not block the takeover forever", await L.acquireLock("k", HOLD, "C"), true);
  store.set("j", { token: "DEAD", at: ago(20 * M) });
  store.set(takeoverKey("j", "DEAD"), { token: "BUSY", at: ago(1000) });
  eq("a fresh claim (a takeover in progress) is respected", await L.acquireLock("j", HOLD, "C"), false);
}
{ // L2: the winner's delete throws → acquireLock returns false, the claim row is released
  const { store, kvs } = fakeKvs();
  const k8 = { get: kvs.get, set: kvs.set, delete: async (k) => { if (k === "k") throw new Error("500 on delete"); return kvs.delete(k); } };
  store.set("k", { token: "DEAD", at: ago(20 * M) });
  let threw = false; let r = null;
  try { r = await makeLocks(k8).acquireLock("k", HOLD, "A"); } catch (_) { threw = true; }
  eq("L2: a throwing delete does not escape acquireLock", [threw, r], [false, false]);
  eq("L2: the claim row is released", store.has(takeoverKey("k", "DEAD")), false);
  eq("L2: the next healthy taker gets it", await makeLocks(kvs).acquireLock("k", HOLD, "B"), true);
}
{ // L4: a 3-deep chain of dead claims no longer wedges once it is 3× CLAIM_MS old
  const { store, kvs } = fakeKvs(); const L = makeLocks(kvs);
  const build = (age) => { store.clear(); store.set("k", { token: "DEAD", at: ago(20 * M) }); let ck = "k", tok = "DEAD"; for (let d = 0; d < 3; d++) { const c = takeoverKey(ck, tok); store.set(c, { token: `DT${d}`, at: ago(age) }); ck = c; tok = `DT${d}`; } };
  build(CLAIM_MS + 1000);
  eq("L4: 3 dead claims, only just stale → still refused (atomic levels only)", await L.acquireLock("k", HOLD, "A"), false);
  build(3 * CLAIM_MS + 1000);
  eq("L4: 3 dead claims older than 3× CLAIM_MS → taken over", await L.acquireLock("k", HOLD, "A"), true);
  eq("L4: … and held by the taker", store.get("k")?.token, "A");
}
{ // L4: a ghost row (reads absent, FAIL_IF_EXISTS still refuses) is cleared after 3 sightings spanning the hold
  const { store, kvs } = fakeKvs();
  const ghostKeys = new Set(["g"]);
  const k7 = {
    get: async (k) => (ghostKeys.has(k) ? undefined : kvs.get(k)),
    set: async (k, v, o) => { if (ghostKeys.has(k) && o?.keyPolicy === "FAIL_IF_EXISTS") throw new Error("KEY_EXISTS"); return kvs.set(k, v, o); },
    delete: async (k) => { ghostKeys.delete(k); return kvs.delete(k); },
  };
  const L = makeLocks(k7);
  const SHORT = 50; // a 50 ms hold so "spanning the hold" fits in a unit test
  const r1 = await L.acquireLock("g", SHORT, "A");
  const r2 = await L.acquireLock("g", SHORT, "A");
  eq("L4 ghost: refused while the sightings are fewer than 3 or younger than the hold", [r1, r2], [false, false]);
  await new Promise((r) => setTimeout(r, SHORT + 20));
  eq("L4 ghost: third sighting after the hold → deleted and acquired", await L.acquireLock("g", SHORT, "A"), true);
  eq("L4 ghost: the sighting row is cleaned up", store.has("g:ghost"), false);
}
{ // L3: withLock waits longer than the hold by default, so a crashed holder is outlived
  const { store, kvs } = fakeKvs(); const L = makeLocks(kvs);
  store.set("p", { token: "CRASHED", at: ago(0) });
  const t0 = Date.now();
  const r = await L.withLock("p", 300, async () => "ran", { stepMs: 20 }); // default waitMs = hold + 5 s
  eq("L3: a crashed holder's fresh lock is outlived and taken over (no 'busy')", r, "ran");
  ok(`L3: … after about the hold (${Date.now() - t0} ms)`, Date.now() - t0 >= 280);
}
{ // withLock
  const { store, kvs } = fakeKvs(); const L = makeLocks(kvs);
  const r = await L.withLock("w", 60000, async () => { ok("withLock: held inside", !!store.get("w")); return 7; });
  eq("withLock: returns the result and releases", [r, store.has("w")], [7, false]);
  store.set("w", { token: "OTHER", at: ago(0) });
  let threw = false; try { await L.withLock("w", 60000, async () => 1, { waitMs: 50, stepMs: 10 }); } catch (_) { threw = true; }
  eq("withLock: a busy lock throws after waitMs", threw, true);
}

const src = (p) => readFileSync(new URL(`../src/server/${p}`, import.meta.url), "utf8");
ok("the backup lease goes through acquireLock", /acquireLock\(LEASE_KEY, LEASE_MS, token\)/.test(src("capsules/backup/worker.js")) && !/keyPolicy: "FAIL_IF_EXISTS"/.test(src("capsules/backup/worker.js")));
ok("the privacy lock goes through acquireLock", /acquireLock\(LOCK_KEY, LOCK_MS, token\)/.test(src("capsules/privacy/worker.js")));
ok("the hold outlives the 900 s consumer (a live run is never taken over)", /LEASE_MS = 16 \* 60000/.test(src("capsules/backup/worker.js")) && /LOCK_MS = 16 \* 60000/.test(src("capsules/privacy/worker.js")));
console.warn = quiet;
report("kvs-lock");
