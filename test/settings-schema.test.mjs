import {
  CONTROLS, GROUPS, control, readEffective, readAllEffective, formatValue, formatDefault,
  dependencyTable, dependencyState, alertProfileToFlags, flagsToAlertProfile, buildSetupPayload,
  needsSetup, validatePolicyWrite, stripDeadKeys, SEAL_DURATION_PRESETS, controlVisible,
} from "../src/server/capsules/policies/settings-schema.js";
import { POLICY_DEFAULTS, BASELINE_HOLD_SPAN } from "../src/server/shared/baseline.js";
import { resolveLapsePolicy } from "../src/server/shared/lapse-policy.js";
import { eq, ok, report } from "./_assert.mjs";

// P2 (UX review 2026-09-14 §3): the consoles render FROM this table. Three pure pieces are
// asserted — the effective-default resolver mirrors the engine readers, the dependency table
// names exactly the pairs the engine enforces, and the alert profiles map to the flags.

// --- the table itself ---
eq("five groups, in outcome order (CLS-1 added Classification)", GROUPS.map((g) => g.id), ["protection", "expiry", "alerts", "classification", "advanced"]);
for (const c of CONTROLS) {
  ok(`${c.key} has a label`, typeof c.label === "string" && c.label.length > 0);
  ok(`${c.key} has a one-line description`, typeof c.text === "string" && c.text.length > 0 && !c.text.includes("\n"));
  ok(`${c.key} belongs to a known group`, GROUPS.some((g) => g.id === c.group));
  ok(`${c.key} default is defined`, "default" in c);
  if (c.parent) ok(`${c.key}'s parent ${c.parent} exists`, !!control(c.parent));
}
ok("keys are unique", new Set(CONTROLS.map((c) => c.key)).size === CONTROLS.length);

// --- the four contradictions the review found, now read from the engine's own defaults ---
eq("G1: default seal duration is the engine's 48 h, not the old 24 h UI seed", control("defaultLockDuration").default, BASELINE_HOLD_SPAN);
eq("G1: …formatted", formatDefault("defaultLockDuration"), "48 hours (2 days)");
eq("G2: force-unseal defaults ON (steward-checks.js reads !== false)", control("allowAdminOverride").default, true);
eq("G2: an absent key reads ON", readEffective("allowAdminOverride", undefined), true);
eq("A7: the recurring banner nests under 'Seals expire' = OFF, not under the comment master",
  dependencyTable().find((d) => d.child === "enablePeriodicReminderEmail"), { child: "enablePeriodicReminderEmail", parent: "autoUnlockEnabled", parentValue: false });
ok("AC1: 'activation' is not a control any more", !control("activation"));
eq("AC1: the write path drops activation + overrideGlobalSettings on the space scope",
  stripDeadKeys("space", { activation: "enabled", overrideGlobalSettings: true, autoInsertMacro: false }), { autoInsertMacro: false });
eq("…and leaves global writes alone", stripDeadKeys("global", { activation: "x" }), { activation: "x" });
eq("M1: the space auto-insert depends on the GLOBAL master",
  dependencyTable("space").find((d) => d.child === "autoInsertMacro"), { child: "autoInsertMacro", parent: "globalAutoInsertMacro", parentValue: true });
eq("M1: …and the reason names the site admin when the site has it off",
  dependencyState("autoInsertMacro", { autoInsertMacro: true }, { globalAutoInsertMacro: false }),
  { enabled: false, reason: "Off site-wide by a site admin (Auto-Insert Macro on Seal)." });
eq("M1: …and is usable when the site has it on",
  dependencyState("autoInsertMacro", { autoInsertMacro: true }, { globalAutoInsertMacro: true }), { enabled: true, reason: null });

// --- readEffective mirrors the engine's coercion, key by key ---
for (const [key, want] of Object.entries(POLICY_DEFAULTS)) {
  eq(`absent ${key} → engine default`, readEffective(key, undefined), want);
}
eq("opt-in toggle: only === true is on", readEffective("allowArtifactDelete", "yes"), false);
eq("opt-in toggle: true is on", readEffective("allowArtifactDelete", true), true);
eq("opt-out toggle: only === false is off", readEffective("enableContentProtection", 0), true);
eq("opt-out toggle: false is off", readEffective("enableContentProtection", false), false);
eq("seconds-as-hours: a malformed duration falls back", readEffective("defaultLockDuration", -5), BASELINE_HOLD_SPAN);
eq("seconds-as-hours: a sane duration is kept", readEffective("defaultLockDuration", 7200), 7200);
eq("count: below min falls back", readEffective("lapseNoticeLimit", -1), 3);
eq("count: 0 is a legal lapse limit (remind once and hold)", readEffective("lapseNoticeLimit", 0), 0);
eq("count: lapse limit agrees with resolveLapsePolicy", readEffective("lapseNoticeLimit", 5), resolveLapsePolicy({ lapseNoticeLimit: 5 }).limit);
eq("hours: lapse interval agrees with resolveLapsePolicy", readEffective("lapseNoticeIntervalHours", 12) * 3600000, resolveLapsePolicy({ lapseNoticeIntervalHours: 12 }).intervalMs);
eq("hours: a malformed lapse interval falls back like the engine", readEffective("lapseNoticeIntervalHours", "soon") * 3600000, resolveLapsePolicy({ lapseNoticeIntervalHours: "soon" }).intervalMs);
eq("days: reminder frequency floor", readEffective("reminderIntervalDays", 0), 7);
eq("choice: ribbonMode coerces", readEffective("ribbonMode", "bogus"), "exceptions");
eq("choice: macroInsertPosition coerces like doc-surgery (=== 'top')", readEffective("macroInsertPosition", "TOP"), "bottom");
eq("choice: notificationsMode coerces like notice-policy", readEffective("notificationsMode", "Quiet"), "normal");
eq("nullable hours: null stays null (site default)", readEffective("autoUnlockTimeoutHours", null), null);
eq("nullable hours: a value is kept", readEffective("autoUnlockTimeoutHours", 48), 48);
eq("unknown key → undefined", readEffective("nope", 1), undefined);
eq("readAllEffective covers every global key", Object.keys(readAllEffective("global", {})).sort(), CONTROLS.filter((c) => c.scope === "global").map((c) => c.key).sort());

// --- formatting ---
eq("toggle on", formatValue("allowAdminOverride", true), "On");
eq("toggle off", formatValue("allowAdminOverride", false), "Off");
eq("hours < a day", formatValue("autoUnlockTimeoutHours", 6), "6 hours");
eq("hours = a week", formatValue("autoUnlockTimeoutHours", 168), "168 hours (7 days)");
eq("hours null → Site default", formatValue("autoUnlockTimeoutHours", null), "Site default");
eq("days singular", formatValue("reminderIntervalDays", 1), "1 day");
eq("ribbon default", formatDefault("ribbonMode"), "Exceptions only");
eq("position default", formatDefault("macroInsertPosition"), "Bottom of the page");

// --- the dependency table, whole ---
eq("global dependency table", dependencyTable("global").sort((a, b) => a.child.localeCompare(b.child)), [
  { child: "enableAutoUnsealDispatchEmail", parent: "enableEmailDispatches", parentValue: true },
  { child: "enableConfluenceDispatches", parent: "enableEmailDispatches", parentValue: true },
  { child: "enablePeriodicReminderEmail", parent: "autoUnlockEnabled", parentValue: false },
  { child: "enableSealExpiryReminderEmail", parent: "enableEmailDispatches", parentValue: true },
  { child: "lapseNoticeIntervalHours", parent: "autoUnlockEnabled", parentValue: true },
  { child: "lapseNoticeLimit", parent: "autoUnlockEnabled", parentValue: true },
  { child: "reminderIntervalDays", parent: "enablePeriodicReminderEmail", parentValue: true },
  { child: "replaceAttachmentsMacro", parent: "globalAutoInsertMacro", parentValue: true },
  { child: "ribbonMode", parent: "enableDocRibbons", parentValue: true },
  { child: "ribbonThresholdLevel", parent: "enableDocRibbons", parentValue: true },
  { child: "ribbonThresholdRank", parent: "enableDocRibbons", parentValue: true },
]);
eq("space dependency table", dependencyTable("space").sort((a, b) => a.child.localeCompare(b.child)), [
  { child: "autoInsertMacro", parent: "globalAutoInsertMacro", parentValue: true },
  { child: "classification", parent: "classificationEnabled", parentValue: true },
  { child: "macroInsertPosition", parent: "autoInsertMacro", parentValue: true },
]);
eq("a child under an OFF parent is disabled with the reason",
  dependencyState("enableSealExpiryReminderEmail", { enableEmailDispatches: false }), { enabled: false, reason: "Turn on Page comments that mention people first" });
eq("…and enabled once the parent is on",
  dependencyState("enableSealExpiryReminderEmail", { enableEmailDispatches: true }), { enabled: true, reason: null });
eq("a parent that must be OFF says 'Turn off'",
  dependencyState("enablePeriodicReminderEmail", { autoUnlockEnabled: true }), { enabled: false, reason: "Turn off Seals expire first" });
eq("a root control is always enabled", dependencyState("autoUnlockEnabled", {}), { enabled: true, reason: null });

// --- alert profiles ---
eq("quiet: comment channels off, in-app on", alertProfileToFlags("quiet"),
  { enableFlashMessages: true, enableDocRibbons: true, enableEmailDispatches: false, enableConfluenceDispatches: false });
eq("standard: master + violations on, seal-lifecycle notices off", alertProfileToFlags("standard"),
  { enableFlashMessages: true, enableDocRibbons: true, enableEmailDispatches: true, enableConfluenceDispatches: true, enableSealExpiryReminderEmail: false, enableAutoUnsealDispatchEmail: false });
eq("loud: everything on", alertProfileToFlags("loud"),
  { enableFlashMessages: true, enableDocRibbons: true, enableEmailDispatches: true, enableConfluenceDispatches: true, enableSealExpiryReminderEmail: true, enableAutoUnsealDispatchEmail: true });
eq("unknown profile → quiet", alertProfileToFlags("shout"), alertProfileToFlags("quiet"));
for (const id of ["quiet", "standard", "loud"]) eq(`profile ${id} round-trips`, flagsToAlertProfile(alertProfileToFlags(id)), id);
eq("a never-saved site reads as quiet (the opt-in default)", flagsToAlertProfile({}), "quiet");
eq("a hand-mixed record reads as custom", flagsToAlertProfile({ enableEmailDispatches: true, enableConfluenceDispatches: true, enableSealExpiryReminderEmail: true, enableAutoUnsealDispatchEmail: false }), "custom");

// --- first-run payload ---
eq("presets carry the six choices", SEAL_DURATION_PRESETS.map((p) => p.id), ["1d", "3d", "1w", "2w", "30d", "custom"]);
const wk = buildSetupPayload({ hours: 168, profile: "standard", completedAt: "2026-09-15T10:00:00.000Z" });
eq("1 week + standard → the mapped keys + classification OFF + setupCompletedAt", wk, { ok: true, data: { defaultLockDuration: 604800, ...alertProfileToFlags("standard"), classificationEnabled: false, setupCompletedAt: "2026-09-15T10:00:00.000Z" } });
eq("setup question 3 answered yes → classification ON", buildSetupPayload({ hours: 24, profile: "quiet", classification: true }).data.classificationEnabled, true);
eq("…anything but an explicit true stays OFF", buildSetupPayload({ hours: 24, profile: "quiet", classification: "on" }).data.classificationEnabled, false);
eq("a bad duration is refused, not defaulted", buildSetupPayload({ hours: 0, profile: "quiet" }), { ok: false, reason: "Seal duration must be at least 1 hour." });
eq("a non-numeric duration is refused", buildSetupPayload({ hours: "week", profile: "quiet" }).ok, false);
ok("completedAt defaults to now (ISO)", Number.isFinite(Date.parse(buildSetupPayload({ hours: 24, profile: "quiet" }).data.setupCompletedAt)));
eq("needsSetup: no record", needsSetup(null), true);
eq("needsSetup: record without the stamp", needsSetup({ defaultLockDuration: 1 }), true);
eq("needsSetup: stamped", needsSetup({ setupCompletedAt: "2026-09-15T10:00:00.000Z" }), false);

// --- write validation ---
eq("valid global write", validatePolicyWrite("global", { lapseNoticeLimit: 0, lapseNoticeIntervalHours: 6, reminderIntervalDays: 3, setupCompletedAt: "2026-09-15T10:00:00.000Z", allowAdminOverride: false }), { ok: true });
eq("lapse limit must be a whole number", validatePolicyWrite("global", { lapseNoticeLimit: 1.5 }).ok, false);
eq("lapse limit may not be negative", validatePolicyWrite("global", { lapseNoticeLimit: -1 }).ok, false);
eq("lapse interval floor 1", validatePolicyWrite("global", { lapseNoticeIntervalHours: 0 }).ok, false);
eq("reminder days floor 1", validatePolicyWrite("global", { reminderIntervalDays: 0 }).ok, false);
eq("setupCompletedAt must parse", validatePolicyWrite("global", { setupCompletedAt: "yesterday" }).ok, false);
eq("setupCompletedAt must be a string", validatePolicyWrite("global", { setupCompletedAt: 1 }).ok, false);
eq("a toggle must be boolean", validatePolicyWrite("global", { enableDocRibbons: "on" }).ok, false);
eq("null means untouched", validatePolicyWrite("global", { lapseNoticeLimit: null, setupCompletedAt: null }), { ok: true });
eq("space: notificationsMode is checked", validatePolicyWrite("space", { notificationsMode: "silent" }).ok, false);
eq("space: macro position is checked", validatePolicyWrite("space", { macroInsertPosition: "middle" }).ok, false);
eq("space: valid", validatePolicyWrite("space", { notificationsMode: "quiet", macroInsertPosition: "top", autoInsertMacro: false }), { ok: true });
eq("no data is fine", validatePolicyWrite("global", undefined), { ok: true });

// --- CLS-1: the classification switch and the per-space opt-out ---
eq("CLS-1: classificationEnabled is an opt-in global toggle, default OFF", [control("classificationEnabled").optIn, control("classificationEnabled").default, control("classificationEnabled").group], [true, false, "classification"]);
eq("CLS-1: an absent key reads OFF", readEffective("classificationEnabled", undefined), false);
eq("CLS-1: only an explicit true reads ON", [readEffective("classificationEnabled", true), readEffective("classificationEnabled", "true"), readEffective("classificationEnabled", 1)], [true, false, false]);
eq("CLS-1: the space choice reads inherit unless exactly off", [readEffective("classification", undefined), readEffective("classification", "off"), readEffective("classification", "on"), readEffective("classification", "OFF")], ["inherit", "off", "inherit", "inherit"]);
eq("CLS-1: the space choice is locked with the site-admin reason while the site is off",
  dependencyState("classification", { classification: "inherit" }, { classificationEnabled: false }), { enabled: false, reason: "Off site-wide by a site admin (Classification levels)." });
eq("CLS-1: …and free when the site is on", dependencyState("classification", { classification: "inherit" }, { classificationEnabled: true }).enabled, true);
eq("CLS-1: the two ribbon controls are HIDDEN while classification is off", [controlVisible("ribbonMode", { classificationEnabled: false }), controlVisible("ribbonThresholdLevel", {}), controlVisible("ribbonMode", { classificationEnabled: true })], [false, false, true]);
eq("CLS-10: the rank fallback never has a row of its own", controlVisible("ribbonThresholdRank", { classificationEnabled: true }), false);
eq("CLS-10: the level control reads a trimmed id or null", [readEffective("ribbonThresholdLevel", " confidential "), readEffective("ribbonThresholdLevel", ""), readEffective("ribbonThresholdLevel", 4)], ["confidential", null, null]);
eq("CLS-1: a control without hiddenUnless is always visible", controlVisible("enableDocRibbons", { classificationEnabled: false }), true);
eq("CLS-1: space write refuses a bad mode", validatePolicyWrite("space", { classification: "on" }).ok, false);
eq("CLS-1: space write accepts off / inherit / null", [validatePolicyWrite("space", { classification: "off" }).ok, validatePolicyWrite("space", { classification: "inherit" }).ok, validatePolicyWrite("space", { classification: null }).ok], [true, true, true]);
eq("CLS-1: global write refuses a non-boolean switch", validatePolicyWrite("global", { classificationEnabled: "yes" }).ok, false);
eq("CLS-1: formatted", [formatValue("classification", "off"), formatValue("classification", "inherit"), formatDefault("classificationEnabled")], ["Off in this space", "As the site", "Off"]);

report("settings-schema");
