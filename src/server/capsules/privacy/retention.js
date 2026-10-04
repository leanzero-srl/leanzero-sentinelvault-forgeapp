/*
 * History retention (PURE, no imports) — Marketplace data-privacy guideline "get rid of data when
 * it is no longer needed … by developing and enforcing reasonable data retention schedules".
 *
 * Three families name people and had no end: the activity history (`activity-page-`,
 * `activity-space-`, `activity-site-`), the workflow history (`workflow-log-`) and the read
 * confirmations (`read-ack-`). The site setting `historyRetentionDays` (Site settings → Privacy
 * and retention; OFF by default, 730 days once on) bounds all three. The weekly privacy sweep deletes every record
 * older than the window. A KVS ttl at write time cannot do this job: the platform caps it near a
 * year, and a window the admin changes later would not reach rows already written.
 *
 * A record's time comes from its key where the key carries it (both history families sort by
 * time) and from its value otherwise; a record whose time cannot be read is KEPT.
 */
/** PURE. The window the sweep enforces: 0 (keep everything) unless retention is switched on. */
export function effectiveRetentionDays(enabled, days) {
  if (enabled !== true) return 0;
  const d = Number(days);
  return d > 0 ? d : 0;
}

export const RETAINED_FAMILIES = Object.freeze(["activity-page-", "activity-space-", "activity-site-", "workflow-log-", "read-ack-"]);
const DAY_MS = 86400000;
const TS_CEILING = 9999999999999; // activity-log.js invertedTs

const finite = (n) => (Number.isFinite(n) ? n : null);

/** PURE. The record's time in ms, or null when it cannot be read. */
export function recordTimeMs(key, value) {
  const k = String(key || "");
  if (k.startsWith("activity-")) {
    const m = /-(\d{13})-[a-z0-9]{6}$/i.exec(k);
    if (m) return TS_CEILING - Number(m[1]);
    return finite(Date.parse(value?.ts));
  }
  if (k.startsWith("workflow-log-")) {
    const m = /-(\d{12,14})$/.exec(k);
    if (m) return Number(m[1]);
    return finite(Number(value?.ts));
  }
  if (k.startsWith("read-ack-")) return finite(Date.parse(value?.at));
  return null;
}

/** PURE. Which retained family a key belongs to (a label for the sweep's counts), or null. */
export function retainedFamily(key) {
  const k = String(key || "");
  if (k.startsWith("activity-")) return RETAINED_FAMILIES.some((p) => k.startsWith(p)) ? "activity" : null;
  if (k.startsWith("workflow-log-")) return "workflowLog";
  if (k.startsWith("read-ack-")) return "readAck";
  return null;
}

/** PURE. Is this record past the retention window? `days` ≤ 0 or not a number keeps everything. */
export function isPastRetention(key, value, nowMs, days) {
  const d = Number(days);
  if (!(d > 0)) return false;
  if (!retainedFamily(key)) return false;
  const t = recordTimeMs(key, value);
  if (t == null) return false;
  return t < nowMs - d * DAY_MS;
}
