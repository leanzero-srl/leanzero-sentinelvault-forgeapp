// A lock older than its hold time is a dead run's (measured 2026-10-05: an expired ttl row lingered
// 2 h+ and kept refusing FAIL_IF_EXISTS, so every backup job failed "Another backup … is running").
import { readFileSync } from "node:fs";
import { eq, ok, report } from "./_assert.mjs";
import { lockIsStale } from "../src/server/shared/kvs-lock.js";
const t = Date.parse("2026-10-05T14:52:00Z"), M = 60000;
eq("a lock taken 2 h ago with a 16 min hold is stale", lockIsStale({ at: "2026-10-05T12:24:41Z", token: "x" }, t, 16 * M), true);
eq("a lock taken 5 min ago is live", lockIsStale({ at: new Date(t - 5 * M).toISOString() }, t, 16 * M), false);
eq("exactly at the hold time it is stale", lockIsStale({ at: new Date(t - 16 * M).toISOString() }, t, 16 * M), true);
eq("no row → stale (free)", lockIsStale(null, t, 16 * M), true);
eq("an unreadable time → stale", lockIsStale({ at: "?" }, t, 16 * M), true);
const src = (p) => readFileSync(new URL(`../src/server/${p}`, import.meta.url), "utf8");
ok("the backup lease goes through acquireLock", /acquireLock\(LEASE_KEY, LEASE_MS, token\)/.test(src("capsules/backup/worker.js")) && !/keyPolicy: "FAIL_IF_EXISTS"/.test(src("capsules/backup/worker.js")));
ok("the privacy lock goes through acquireLock", /acquireLock\(LOCK_KEY, LOCK_MS, token\)/.test(src("capsules/privacy/worker.js")));
ok("the hold outlives the 900 s consumer (a live run is never taken over)", /LEASE_MS = 16 \* 60000/.test(src("capsules/backup/worker.js")) && /LOCK_MS = 16 \* 60000/.test(src("capsules/privacy/worker.js")));
report("kvs-lock");
