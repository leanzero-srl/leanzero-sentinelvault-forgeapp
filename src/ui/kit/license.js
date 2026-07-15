// Licensing (Paid via Atlassian). The app SOFT-DEGRADES when unlicensed — it shows a nag banner but
// NEVER blocks, because a content-protection app must keep protecting sealed content even if a license
// lapses. Atlassian's Marketplace billing does the real "you must pay" enforcement; this is only the
// graceful in-app signal.
//
// check-license (server) returns { isLicensed, active, unlicensedButAllowed } and is biased fail-open:
// context.license is undefined in dev/custom envs (and for free/unlisted apps) → isLicensed true → no
// banner. Only an explicit unlicensed state in the production Marketplace listing (active === false)
// shows the banner. `null` = the check hasn't resolved yet → show nothing.
export function shouldShowLicenseBanner(result) {
  return !!result && result.isLicensed === false;
}
