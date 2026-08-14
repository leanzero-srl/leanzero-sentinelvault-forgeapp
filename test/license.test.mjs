import { shouldShowLicenseBanner } from "../src/ui/kit/license.js";
import { checkLicense } from "../src/server/capsules/entitlements/actions.js";
import { eq, ok, report } from "./_assert.mjs";

// SERVER-side checkLicense — the fail-open decision line itself (previously untested).
eq("server: no context at all → licensed (fail-open)",
  await checkLicense(undefined), { isLicensed: true, active: null, unlicensedButAllowed: false });
eq("server: dev/free (license undefined) → licensed",
  await checkLicense({ context: {} }), { isLicensed: true, active: null, unlicensedButAllowed: false });
eq("server: active license → licensed",
  await checkLicense({ context: { license: { active: true } } }), { isLicensed: true, active: true, unlicensedButAllowed: false });
eq("server: explicit inactive → UNlicensed + soft-degrade flag",
  await checkLicense({ context: { license: { active: false } } }), { isLicensed: false, active: false, unlicensedButAllowed: true });
ok("server: a garbage active value that is not exactly false stays licensed (never lock out on noise)",
  (await checkLicense({ context: { license: { active: "??" } } })).isLicensed === true);

// Licensing soft-degrade: the unlicensed nag banner shows ONLY on an explicit unlicensed state,
// never in dev / for free apps (fail-open), and never before the check resolves.
eq("null (not yet loaded) → no banner", shouldShowLicenseBanner(null), false);
eq("undefined → no banner", shouldShowLicenseBanner(undefined), false);
eq("licensed (active) → no banner", shouldShowLicenseBanner({ isLicensed: true, active: true }), false);
eq("dev/free (license undefined → fail-open) → no banner", shouldShowLicenseBanner({ isLicensed: true, active: null }), false);
eq("explicitly unlicensed → banner", shouldShowLicenseBanner({ isLicensed: false, active: false, unlicensedButAllowed: true }), true);
ok("a truthy isLicensed value that is not exactly false never shows the banner", !shouldShowLicenseBanner({ isLicensed: undefined }));

report("license");
