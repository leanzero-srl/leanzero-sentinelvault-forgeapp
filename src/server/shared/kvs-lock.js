/*
 * One-at-a-time locks on Forge KVS (the backup lease, the privacy sweep lock).
 *
 * MEASURED 2026-10-05 on wolfaenpak dev: a lock row written with a 16-minute ttl was still
 * readable — and still made `keyPolicy: "FAIL_IF_EXISTS"` refuse — more than two hours after its
 * expireTime (a run killed during an A/B left it). So the ttl is NOT a liveness guarantee: every
 * backup, restore and privacy erasure job failed with "Another backup or restore is running" until
 * the row was cleaned up. A lock older than its hold time therefore belongs to a dead run (every
 * holder runs in a 900 s consumer, shorter than the hold) and is taken over: delete, write ours,
 * then re-read after a short settle so two takers racing over the same stale row cannot both win.
 */
import { kvs } from "@forge/kvs";

/** PURE. Is this lock row stale at `nowMs` (missing, unreadable time, or older than `holdMs`)? */
export function lockIsStale(row, nowMs, holdMs) {
  const at = Date.parse(row?.at || "");
  return !row || !Number.isFinite(at) || nowMs - at >= holdMs;
}

const write = (key, token, holdMs) => kvs.set(key, { token, at: new Date().toISOString() }, { ttl: { value: Math.ceil(holdMs / 1000), unit: "SECONDS" }, keyPolicy: "FAIL_IF_EXISTS" });

/** Try once to take `key` for `holdMs`. Resolves true when this caller holds it (with `token`). */
export async function acquireLock(key, holdMs, token, { settleMs = 400 } = {}) {
  try { await write(key, token, holdMs); return true; } catch (_) { /* held, or a stale row */ }
  const cur = await kvs.get(key).catch(() => null);
  if (!lockIsStale(cur, Date.now(), holdMs)) return false;
  console.warn(`[LOCK] ${key}: taking over a stale lock from ${cur?.at || "unknown"} (token ${cur?.token || "?"})`);
  await kvs.delete(key).catch(() => {});
  try { await write(key, token, holdMs); } catch (_) { return false; }
  await new Promise((r) => setTimeout(r, settleMs));
  const mine = await kvs.get(key).catch(() => null);
  return mine?.token === token;
}

/** Release `key` only if this caller still holds it. */
export async function releaseLock(key, token) {
  const cur = await kvs.get(key).catch(() => null);
  if (cur?.token === token) await kvs.delete(key).catch(() => {});
}
