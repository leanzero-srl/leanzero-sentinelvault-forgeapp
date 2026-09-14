import { validateReleaseReason, RELEASE_REASON_REQUIRED, RELEASE_REASON_MAX } from "../src/server/shared/release-reason.js";
import { eq, report } from "./_assert.mjs";

eq("p35: undefined → required", validateReleaseReason(undefined), { ok: false, error: RELEASE_REASON_REQUIRED });
eq("p35: non-string → required", validateReleaseReason(42), { ok: false, error: RELEASE_REASON_REQUIRED });
eq("p35: blank → required", validateReleaseReason("   "), { ok: false, error: RELEASE_REASON_REQUIRED });
eq("p35: two chars → required (min 3)", validateReleaseReason(" ab "), { ok: false, error: RELEASE_REASON_REQUIRED });
eq("p35: three chars → ok, trimmed", validateReleaseReason("  abc "), { ok: true, reason: "abc" });
eq("p35: 300 chars → ok", validateReleaseReason("x".repeat(RELEASE_REASON_MAX)).ok, true);
eq("p35: 301 chars → refused, not cut", validateReleaseReason("x".repeat(RELEASE_REASON_MAX + 1)).ok, false);
eq("p35: a real sentence survives intact", validateReleaseReason("Owner left the company, HR ticket 4412").reason, "Owner left the company, HR ticket 4412");

report("release-reason");
