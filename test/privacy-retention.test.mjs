// History retention (2026-10-04): activity history, workflow history and read confirmations are
// deleted once older than the site's "Keep history for" (default 730 days) by the weekly sweep.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, ok, report } from "./_assert.mjs";
import { recordTimeMs, isPastRetention, retainedFamily, RETAINED_FAMILIES, effectiveRetentionDays } from "../src/server/capsules/privacy/retention.js";
import { invertedTs, buildActivityKeys } from "../src/server/infra/activity-log.js";
import { readEffective, validatePolicyWrite, control } from "../src/server/capsules/policies/settings-schema.js";
import { POLICY_DEFAULTS } from "../src/server/shared/baseline.js";
import { describeSweep } from "../src/ui/kit/privacy-format.js";

const DAY = 86400000;
const now = Date.parse("2026-10-04T12:00:00.000Z");
const old = now - 800 * DAY;
const recent = now - 10 * DAY;

// Keys built by the app's own key builder, so the parse cannot drift from the writer.
const k = buildActivityKeys({ pageId: "123", spaceKey: "SV", tsMs: old, rand: "abc123", site: true });
eq("activity page key time round-trips", recordTimeMs(k.pageKey, {}), old);
eq("activity space key time round-trips", recordTimeMs(k.spaceKey, {}), old);
eq("activity site key time round-trips", recordTimeMs(k.siteKey, {}), old);
eq("invertedTs agrees", recordTimeMs(`activity-page-1-${invertedTs(recent)}-zzzzzz`, {}), recent);
eq("workflow log key time", recordTimeMs(`workflow-log-123-${old}`, {}), old);
eq("read ack time from its value", recordTimeMs("read-ack-123-712020:x", { at: new Date(old).toISOString() }), old);
eq("unparseable time → null", recordTimeMs("read-ack-1-a", { at: "nope" }), null);

eq("old activity past 730 days", isPastRetention(k.pageKey, {}, now, 730), true);
eq("recent activity kept", isPastRetention(`activity-page-1-${invertedTs(recent)}-zzzzzz`, {}, now, 730), false);
eq("old workflow log past", isPastRetention(`workflow-log-9-${old}`, {}, now, 730), true);
eq("old read ack past", isPastRetention("read-ack-9-712020:y", { at: new Date(old).toISOString() }, now, 730), true);
eq("a read ack with no time is KEPT", isPastRetention("read-ack-9-712020:y", {}, now, 730), false);
eq("an unrelated family is never touched", isPastRetention(`protection-${old}`, { at: new Date(old).toISOString() }, now, 30), false);
eq("activity-site is retained but 'activity-xyz' is not", retainedFamily("activity-xyz-1"), null);
eq("days 0 keeps everything", isPastRetention(k.pageKey, {}, now, 0), false);
eq("days NaN keeps everything", isPastRetention(k.pageKey, {}, now, "x"), false);
eq("the edge: exactly at the cutoff is kept", isPastRetention(`workflow-log-9-${now - 730 * DAY}`, {}, now, 730), false);
eq("families", RETAINED_FAMILIES.length, 5);

// The setting.
eq("default 730", POLICY_DEFAULTS.historyRetentionDays, 730);
eq("effective default", readEffective("historyRetentionDays", undefined), 730);
eq("below the floor → default", readEffective("historyRetentionDays", 5), 730);
eq("in range", readEffective("historyRetentionDays", 90), 90);
eq("group", control("historyRetentionDays").group, "privacy");
// Retention is OFF by default: the customer controls deletion of its own audit history.
eq("retention off by default", POLICY_DEFAULTS.historyRetentionEnabled, false);
eq("unset → off", readEffective("historyRetentionEnabled", undefined), false);
eq("off → window 0", effectiveRetentionDays(false, 730), 0);
eq("unset → window 0", effectiveRetentionDays(undefined, 730), 0);
eq("on → the days", effectiveRetentionDays(true, 365), 365);
eq("days depend on the toggle", control("historyRetentionDays").parent, "historyRetentionEnabled");
ok("off sentence", /deletion is off/.test(describeSweep({ ok: true, retentionDays: 0, retention: {}, finishedAt: "2026-10-04T12:00:00Z" })));
eq("write: 29 refused", validatePolicyWrite("global", { historyRetentionDays: 29 }).ok, false);
eq("write: 3651 refused", validatePolicyWrite("global", { historyRetentionDays: 3651 }).ok, false);
eq("write: 1.5 refused", validatePolicyWrite("global", { historyRetentionDays: 1.5 }).ok, false);
eq("write: 365 accepted", validatePolicyWrite("global", { historyRetentionDays: 365 }).ok, true);

// The status sentence.
ok("no run yet", /No check has run yet/.test(describeSweep(null)));
ok("failed run names the error", /failed: boom/.test(describeSweep({ ok: false, error: "boom" })));
ok("counts summed", /removed 3 history records older than 730 days/.test(describeSweep({ ok: true, retentionDays: 730, retention: { activity: 1, workflowLog: 1, readAck: 1 }, finishedAt: "2026-10-04T12:00:00Z" })));
ok("singular", /removed 1 history record older/.test(describeSweep({ ok: true, retentionDays: 30, retention: { activity: 1 }, finishedAt: "2026-10-04T12:00:00Z" })));

// Wiring: the sweep rides the daily trigger, only in the Confluence installation, and the
// worker deletes only what isPastRetention allows.
const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(resolve(here, "..", p), "utf8");
ok("boot wraps the daily recurring-nudge task with the privacy check", /recurringNudgeTaskCore\(event, context\); \} finally \{ await privacySweepCheck\(context \|\| event\?\.context\)/.test(src("src/boot.js")));
ok("the check refuses a non-Confluence installation", /if \(!isConfluenceInstall\(context\)\) return;/.test(src("src/server/capsules/privacy/worker.js")));
ok("the worker deletes only past-retention rows", /if \(isPastRetention\(key, value, nowMs, days\)\) \{\s*await withBackoff\(\(\) => kvs\.delete\(key\)\);/.test(src("src/server/capsules/privacy/worker.js")));
const manifest = src("manifest.yml");
ok("manifest: privacy consumer with 900 s", /- key: privacy-fn\s+handler: boot\.privacyConsumer\s+timeoutSeconds: 900/.test(manifest));
ok("manifest: privacy queue", /- key: privacy-queue\s+queue: privacy-queue\s+function: privacy-fn/.test(manifest));
ok("manifest: still 5 scheduled triggers", (manifest.split("scheduledTrigger:")[1].split("\n  # ")[0].match(/- key:/g) || []).length === 5);
report("privacy-retention");
