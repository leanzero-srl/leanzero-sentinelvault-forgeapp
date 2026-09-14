// Part 3.5 (owner decision): a break-glass release — releasing a seal you do NOT own, whether
// as a steward or because the seal lapsed — needs a TYPED reason, and that reason is always
// visible in the activity trail (details.forced:true, details.reason). Owner self-release stays
// reason-optional. ONE rule, used by unseal-section, unseal-artifact and steward-unseal, so the
// three paths can never drift on what counts as a reason.
//
// PURE — zero imports, unit-tested in test/release-reason.test.mjs.

export const RELEASE_REASON_MIN = 3;
export const RELEASE_REASON_MAX = 300;
export const RELEASE_REASON_REQUIRED = "A reason is required to release a seal you do not own";

/**
 * @returns {{ ok: true, reason: string } | { ok: false, error: string }}
 * ok:true carries the TRIMMED reason to store. Anything not a string, blank, or under the
 * minimum is refused; an over-long one is refused rather than silently cut, so what the trail
 * shows is exactly what the steward typed.
 */
export function validateReleaseReason(raw) {
  if (typeof raw !== "string") return { ok: false, error: RELEASE_REASON_REQUIRED };
  const reason = raw.trim();
  if (reason.length < RELEASE_REASON_MIN) return { ok: false, error: RELEASE_REASON_REQUIRED };
  if (reason.length > RELEASE_REASON_MAX) return { ok: false, error: `Reason must be at most ${RELEASE_REASON_MAX} characters` };
  return { ok: true, reason };
}
