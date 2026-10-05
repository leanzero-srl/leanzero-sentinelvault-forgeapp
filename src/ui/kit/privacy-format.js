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
  const parts = [!(n(last.retentionDays) > 0)
    ? "history deletion is off, nothing was deleted for age"
    : removed ? `removed ${plural(removed, "history record")} older than ${last.retentionDays} days` : `nothing was older than ${last.retentionDays} days`];
  if (last.accounts) {
    const a = last.accounts;
    // 7.0.0 holds report:personal-data, so "not-permitted" means Atlassian refused this run, not
    // that the version lacks the permission (6.x said so; that sentence is gone with the scope).
    if (a.reporting === "not-permitted") parts.push("Atlassian refused the account check this time, it is tried again the next day");
    else if (!n(a.reported) && !n(a.due)) parts.push("no account was due for a check with Atlassian (each is checked once a week)");
    else parts.push(`checked ${plural(n(a.reported), "account")} with Atlassian`);
    if (n(a.closed)) parts.push(`erased ${plural(n(a.closed), "closed account")}`);
    if (n(a.updated)) parts.push(`refreshed ${plural(n(a.updated), "changed name")}`);
  }
  return `Last check ${whenText(last.finishedAt)}: ${parts.join(", ")}.`;
}
