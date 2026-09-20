/**
 * PURE. What the expiry sweep should do with a seal that has already lapsed.
 *
 * Zero imports on purpose (the shared/baseline.js pattern): the rule is time-based, so the
 * only honest way to test "the third reminder is followed by a release, and a fourth reminder
 * never happens" is to hand it clocks rather than to wait three days for a live sweep.
 *
 * The rule (F5, owner feedback 2026-08-27 — "if a sealed image is overdue a notice message must
 * be sent to the owner and after 3 notifications/days if the user doesn't extend the period the
 * image must became available"):
 *
 *   - up to `limit` reminders, at most one per `intervalMs`
 *   - then the seal is released and the file becomes available again
 *   - `limit: 0` disables the release: one reminder, and the seal is held indefinitely
 *     (the behaviour before F5, kept for installs that want it)
 *
 * The counter is what the release is counted off, so it advances only when a reminder actually
 * posted — that discipline lives at the call site, which is why this returns a decision rather
 * than performing one.
 *
 * @param {object} state
 * @param {number} state.priorCount   reminders already sent (0 if none)
 * @param {number} state.lastSentMs   epoch ms of the last reminder (0 if none)
 * @param {number} state.nowMs        epoch ms now
 * @param {number} state.limit        reminders before release; 0 = never release
 * @param {number} state.intervalMs   minimum gap between reminders
 * @returns {{action: "release"|"notify"|"wait", noticeNumber?: number, noticeLimit?: number, releaseAtMs?: number}}
 */
export function decideLapseAction({ priorCount = 0, lastSentMs = 0, nowMs, limit, intervalMs }) {
  const releaseEnabled = limit > 0;
  const maxNotices = releaseEnabled ? limit : 1;

  if (releaseEnabled && priorCount >= limit) {
    return { action: "release" };
  }
  // Reminders spent with no release configured — hold, and say nothing further.
  if (priorCount >= maxNotices) {
    return { action: "wait" };
  }
  // One reminder per interval. A sweep runs hourly, so without this an overdue seal would
  // comment every hour.
  if (lastSentMs && nowMs - lastSentMs < intervalMs) {
    return { action: "wait" };
  }

  const noticeNumber = priorCount + 1;
  return {
    action: "notify",
    noticeNumber,
    noticeLimit: limit,
    // When the file is actually handed back: the reminders still to come, plus the interval
    // that has to elapse after the last one before the release pass fires. Every reminder in
    // a run therefore names the same date instead of a receding one.
    releaseAtMs: releaseEnabled
      ? nowMs + (limit - noticeNumber + 1) * intervalMs
      : null,
  };
}

/** Reminders an overdue seal gets before its file is handed back. */
export const LAPSE_NOTICE_LIMIT_DEFAULT = 3;
/** Gap between those reminders. */
export const LAPSE_NOTICE_INTERVAL_MS_DEFAULT = 24 * 3600 * 1000;

/**
 * PURE. Read the two lapse settings off a global policy record, falling back to the defaults.
 * Separated from the decision so a malformed stored value can be proved to fall back rather
 * than to reach the arithmetic — store-policy persists these RAW.
 */
export function resolveLapsePolicy(systemPolicy) {
  const rawLimit = Number(systemPolicy?.lapseNoticeLimit);
  const limit = Number.isFinite(rawLimit) && rawLimit >= 0
    ? Math.floor(rawLimit)
    : LAPSE_NOTICE_LIMIT_DEFAULT;

  const rawHours = Number(systemPolicy?.lapseNoticeIntervalHours);
  const intervalMs = Number.isFinite(rawHours) && rawHours > 0
    ? Math.floor(rawHours) * 3600 * 1000
    : LAPSE_NOTICE_INTERVAL_MS_DEFAULT;

  return { limit, intervalMs };
}

/**
 * PURE. Reminders already sent, from the sweep's bookkeeping record.
 *
 * Records written before F5 carry no `count` — they stood for exactly one notice, which is what
 * the pre-F5 sweep sent. Reading them as 1 means an upgraded install continues an owner's
 * countdown instead of restarting it and telling them the same thing again.
 */
export function priorNoticeCount(record) {
  const n = Number(record?.count);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return record ? 1 : 0;
}

/**
 * SEC-7 (d) (2026-09-20): the expiry sweep judges SECTION seals with the same clock as
 * attachment seals. The two records name their things differently; this is the ONE mapping the
 * sweep reads, so the reminder / lapse / auto-release code runs once for both kinds.
 * PURE. Returns null for a record the sweep must skip (a released tracking record, a seal with
 * no timestamp or expiry — including a workflow-HELD seal, whose expiry is paused: SEC-2).
 * @param {"attachment"|"section"} kind
 * @param {string} key   the KVS key (protection-{att} | section-protection-{sec})
 * @param {object} value the record
 */
export function lapseSubject(kind, key, value) {
  if (!key || !value || typeof value !== "object") return null;
  if (!value.timestamp || !value.expiresAt || !value.lockedBy) return null;
  if (kind === "section") {
    const id = String(key).replace(/^section-protection-/, "");
    if (!id || !value.sectionId) return null;
    return {
      kind, id, name: value.sectionTitle || "Sealed section", pageId: value.pageId || null,
      spaceKey: value.spaceKey || null, ownerAccountId: value.lockedBy,
      dedupKey: `expiry-notified-${id}`, halfwayKey: `fifty-percent-reminder-sent-${id}`,
    };
  }
  if (value.trashedOnly) return null; // S7: a trashedOnly tracking record is not a seal
  const id = String(key).replace(/^protection-/, "");
  if (!id) return null;
  return {
    kind: "attachment", id, name: value.attachmentName || "Unknown Attachment", pageId: value.contentId || null,
    spaceKey: value.spaceKey || null, ownerAccountId: value.lockedBy,
    dedupKey: `expiry-notified-${id}`, halfwayKey: `fifty-percent-reminder-sent-${id}`,
  };
}
