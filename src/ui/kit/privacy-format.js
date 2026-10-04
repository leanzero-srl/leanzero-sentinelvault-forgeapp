/*
 * PURE. The sentences Site settings → Privacy and retention shows for the last privacy sweep
 * (kit/PrivacyStatus.jsx). No imports, so test/privacy-retention.test.mjs runs it in plain node.
 */
export const whenText = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
};
const n = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const plural = (k, word) => `${k} ${word}${k === 1 ? "" : "s"}`;

/** One sentence for the last sweep. */
export function describeSweep(last) {
  if (!last) return "No check has run yet. The first one runs within a day of this version, then every week.";
  if (last.ok === false) return `The last check failed: ${last.error || "unknown error"}. It is tried again the next day.`;
  const r = last.retention || {};
  const removed = n(r.activity) + n(r.workflowLog) + n(r.readAck);
  const parts = [removed ? `removed ${plural(removed, "history record")} older than ${last.retentionDays} days` : `nothing was older than ${last.retentionDays} days`];
  if (last.accounts) {
    const a = last.accounts;
    parts.push(`checked ${plural(n(a.reported), "account")} with Atlassian`);
    if (n(a.closed)) parts.push(`erased ${plural(n(a.closed), "closed account")}`);
    if (n(a.updated)) parts.push(`refreshed ${plural(n(a.updated), "changed name")}`);
  }
  return `Last check ${whenText(last.finishedAt)}: ${parts.join(", ")}.`;
}
