import { kvs } from "@forge/kvs";

/**
 * TTL'd KVS writes — the ONE correct shape (stabilization-hunt finding, 2026-08-14).
 *
 * The app passed `{ expiresAt: <epoch ms> }` as the kvs.set options at ~15 call sites.
 * @forge/kvs SetOptions (v1.5.0 types + the platform docs) define ONLY
 * `{ ttl: { value, unit } }` — the unknown `expiresAt` option is ignored, not rejected,
 * so every "TTL'd" key (24h comment-dedup markers, 1h toast keys, 5-min dispatch keys,
 * die-with-the-seal expiry/halfway flags) was written PERMANENT: dedup windows never
 * reopened and keys accumulated unboundedly. All TTL writes now go through here.
 */

const MAX_TTL_SECONDS = 364 * 24 * 3600; // stay under the platform's 1-year cap

/** Pure: milliseconds-from-now → the documented SetOptions ttl shape. */
export function ttlOption(ttlMs) {
  const seconds = Math.min(MAX_TTL_SECONDS, Math.max(60, Math.ceil(ttlMs / 1000)));
  return { ttl: { value: seconds, unit: "SECONDS" } };
}

/** kvs.set with a real TTL (ttlMs from now). */
export async function setWithTtl(key, value, ttlMs) {
  return kvs.set(key, value, ttlOption(ttlMs));
}

/** kvs.set that expires AT an absolute epoch-ms timestamp (converts to a relative ttl). */
export async function setUntil(key, value, expiresAtMs) {
  return setWithTtl(key, value, expiresAtMs - Date.now());
}
