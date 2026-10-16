/*
 * 8.6 — when My work's Jira card reads itself again.
 *
 * Measured on wolfaenpak 2026-10-16: Jira's issue-deleted event reached Sentinel Vault within about a
 * minute, but My work had loaded before it and never read again, so a file whose issue had just been
 * deleted stayed "Sealed · until …" with a link to an issue that no longer exists. The card now reads
 * again when the person comes back to the tab, and every POLL_MS while it lists a live seal, for
 * POLL_FOR_MS after the page opened. Pure, so test/my-work-refresh.test.mjs pins it.
 */
export const POLL_MS = 15000;
export const POLL_FOR_MS = 5 * 60 * 1000;

/** True while the card should poll: it lists at least one seal whose issue still stands, and the page is fresh. */
export function shouldPoll(items, openedAtMs, nowMs) {
  if (!Array.isArray(items) || items.length === 0) return false;
  if (!(nowMs - openedAtMs < POLL_FOR_MS)) return false;
  return items.some((s) => s && !s.issueDeletedAt);
}
