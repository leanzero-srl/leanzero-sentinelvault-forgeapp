// Requirement 2.3 GAP 2 — retry marker for a sealed-section restore that could not be written.
//
// The page-content trigger does ONE write per event inside a 3-attempt 409-backoff loop. When
// every attempt loses the version race (a busy page, a stale editor draft re-publishing) the
// tamper stays on the page and, until now, nothing came back for it: the next save might be
// hours away. The trigger records a `section-restore-pending-{pageId}` marker (TTL one day) and
// the hourly expiry sweep re-runs the section restore for those pages, deleting the marker on a
// confirmed clean pass. The marker is only ever a HINT to retry — the sweep re-reads the page and
// re-decides from the seal records, so a stale marker costs one read, never a wrong write.
//
// PURE — zero imports, unit-tested in test/section-retry.test.mjs.

export const SECTION_RETRY_PREFIX = "section-restore-pending-";
export const SECTION_RETRY_TTL_MS = 24 * 3600 * 1000;
export const SECTION_RETRY_SWEEP_CAP = 100; // markers re-tried per sweep run

export const sectionRetryKey = (pageId) => `${SECTION_RETRY_PREFIX}${pageId}`;

/**
 * Should the trigger leave a retry marker behind?
 *   sectionChanged — the section pass wanted a write on the last attempt (a restore is pending)
 *   anyChange      — a write was CONFIRMED (2xx) this run
 * A confirmed write means the page now carries the restore: nothing pending. No section change
 * means nothing to retry — including the media-only case, which is not this marker's business.
 */
export function decideSectionRetry({ sectionChanged, anyChange }) {
  return !!sectionChanged && !anyChange;
}

/** The marker value to write, carrying the first-seen time and the attempt count forward. */
export function nextRetryMarker(prev, pageId, nowIso) {
  const since = typeof prev?.since === "string" && prev.since ? prev.since : nowIso;
  const attempts = (Number.isInteger(prev?.attempts) && prev.attempts >= 0 ? prev.attempts : 0) + 1;
  return { pageId: String(pageId), since, attempts };
}
