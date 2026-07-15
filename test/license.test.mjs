import { shouldShowLicenseBanner } from "../src/ui/kit/license.js";
import { eq, ok, report } from "./_assert.mjs";

// Licensing soft-degrade: the unlicensed nag banner shows ONLY on an explicit unlicensed state,
// never in dev / for free apps (fail-open), and never before the check resolves.
eq("null (not yet loaded) → no banner", shouldShowLicenseBanner(null), false);
eq("undefined → no banner", shouldShowLicenseBanner(undefined), false);
eq("licensed (active) → no banner", shouldShowLicenseBanner({ isLicensed: true, active: true }), false);
eq("dev/free (license undefined → fail-open) → no banner", shouldShowLicenseBanner({ isLicensed: true, active: null }), false);
eq("explicitly unlicensed → banner", shouldShowLicenseBanner({ isLicensed: false, active: false, unlicensedButAllowed: true }), true);
ok("a truthy isLicensed value that is not exactly false never shows the banner", !shouldShowLicenseBanner({ isLicensed: undefined }));

report("license");
