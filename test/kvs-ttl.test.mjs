import { ttlOption } from "../src/server/shared/kvs-ttl.js";
import { eq, report } from "./_assert.mjs";

// ttlOption is the pure core of the shared TTL helper (stabilization-hunt F3/H1-F1: the app
// passed `{ expiresAt }` — not a @forge/kvs SetOption — so every "TTL'd" key was permanent).
// These pin the ONE correct shape: `{ ttl: { value: <seconds>, unit: "SECONDS" } }`.

// --- shape + seconds conversion ---
eq("ms → whole seconds, documented shape",
  ttlOption(90000), { ttl: { value: 90, unit: "SECONDS" } });
eq("24h dedup window (the Fix-3 marker TTL)",
  ttlOption(24 * 3600 * 1000), { ttl: { value: 86400, unit: "SECONDS" } });
eq("fractional seconds round UP (never expire early)",
  ttlOption(90500), { ttl: { value: 91, unit: "SECONDS" } });

// --- floor: 60s minimum ---
eq("sub-minute TTL clamps up to 60s", ttlOption(1000), { ttl: { value: 60, unit: "SECONDS" } });
eq("zero clamps to 60s", ttlOption(0), { ttl: { value: 60, unit: "SECONDS" } });
eq("negative (setUntil past an already-passed instant) clamps to 60s",
  ttlOption(-5000), { ttl: { value: 60, unit: "SECONDS" } });

// --- ceiling: stay under the platform's 1-year cap ---
const MAX = 364 * 24 * 3600;
eq("365d+7d nudge case clamps to the 364d ceiling",
  ttlOption((365 + 7) * 86400000), { ttl: { value: MAX, unit: "SECONDS" } });
eq("exactly the ceiling passes through", ttlOption(MAX * 1000), { ttl: { value: MAX, unit: "SECONDS" } });
eq("one second under the ceiling passes through",
  ttlOption((MAX - 1) * 1000), { ttl: { value: MAX - 1, unit: "SECONDS" } });

report("kvs-ttl");
