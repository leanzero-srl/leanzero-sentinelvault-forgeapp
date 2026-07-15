import { sanitizeHoldDuration, BASELINE_HOLD_SPAN, MAX_HOLD_SECONDS, withinHoldBounds } from "../src/server/shared/baseline.js";
import { eq, ok, report } from "./_assert.mjs";

// it55: sanitizeHoldDuration hardens the API-only lockDuration payload. The seal UI never sends it,
// but a direct seal-artifact invocation could pass a value that produces a PAST expiresAt (a "sealed"
// but unprotected record returned as success) or crashes new Date(...).toISOString() (500).
const B = BASELINE_HOLD_SPAN;
const MAX = 100 * 365 * 24 * 60 * 60;

// valid positive durations pass through (floored to whole seconds)
eq("valid duration passes through", sanitizeHoldDuration(3600, B), 3600);
eq("fractional duration is floored", sanitizeHoldDuration(3600.7, B), 3600);
eq("exactly MAX is allowed", sanitizeHoldDuration(MAX, B), MAX);
eq("1 second is allowed (positive)", sanitizeHoldDuration(1, B), 1);

// the bug vectors all fall back to the baseline (a safe FUTURE span), never a past/invalid date
eq("negative → baseline (was: past expiresAt, sealed-but-unprotected)", sanitizeHoldDuration(-3600, B), B);
eq("zero → baseline", sanitizeHoldDuration(0, B), B);
eq("NaN → baseline", sanitizeHoldDuration(NaN, B), B);
eq("Infinity → baseline", sanitizeHoldDuration(Infinity, B), B);
eq("numeric string → baseline (was: NaN*1000 → Date crash)", sanitizeHoldDuration("3600", B), B);
eq("non-numeric string → baseline (was: 'abc'*1000 → Date crash)", sanitizeHoldDuration("abc", B), B);
eq("absurd huge value → baseline (was: Date range overflow → crash)", sanitizeHoldDuration(1e13, B), B);
eq("just over MAX → baseline", sanitizeHoldDuration(MAX + 1, B), B);
eq("undefined (the UI case) → baseline", sanitizeHoldDuration(undefined, B), B);
eq("null → baseline", sanitizeHoldDuration(null, B), B);

// the returned duration always yields a FUTURE expiresAt (the core guarantee the fix restores)
const future = Date.now() + sanitizeHoldDuration(-3600, B) * 1000;
ok("sanitized negative duration still yields a FUTURE expiresAt", future > Date.now());
// default baseline arg works
eq("default baseline arg used when omitted", sanitizeHoldDuration(-1), B);

// B14: withinHoldBounds — the store-policy WRITE-boundary validator (immediate admin feedback), and
// the shared predicate sanitizeHoldDuration now delegates to. Same accept/reject envelope.
eq("MAX_HOLD_SECONDS is 100 years", MAX_HOLD_SECONDS, MAX);
ok("withinHoldBounds accepts a positive in-range value", withinHoldBounds(3600));
ok("withinHoldBounds accepts exactly MAX", withinHoldBounds(MAX));
ok("withinHoldBounds accepts 1s", withinHoldBounds(1));
ok("withinHoldBounds rejects zero", !withinHoldBounds(0));
ok("withinHoldBounds rejects negative", !withinHoldBounds(-1));
ok("withinHoldBounds rejects NaN", !withinHoldBounds(NaN));
ok("withinHoldBounds rejects Infinity", !withinHoldBounds(Infinity));
ok("withinHoldBounds rejects a numeric string", !withinHoldBounds("3600"));
ok("withinHoldBounds rejects just over MAX", !withinHoldBounds(MAX + 1));
ok("withinHoldBounds rejects undefined", !withinHoldBounds(undefined));
ok("withinHoldBounds rejects null", !withinHoldBounds(null));
// the store-policy semantics: autoUnlockTimeoutHours is HOURS → checked as hours*3600 seconds
ok("24h (86400s) is a valid auto-unseal timeout", withinHoldBounds(24 * 3600));
ok("a negative hours value is rejected", !withinHoldBounds(-5 * 3600));

report("sealing-logic");
