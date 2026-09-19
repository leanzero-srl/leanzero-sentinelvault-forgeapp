// 5.0 ribbon — the pure show rule (mockup §2 "Exceptions only" / §3 "Always show classification"),
// the one-state-pill choice and the steward-setting normalisation, branch by branch. Zero Forge
// imports: src/ui/kit/ribbon-rules.js loads in plain node like activity-format.js.
import {
  decideRibbon, pickUrgent, meetsThreshold, normalizeRibbonSettings, validateRibbonSettings, untilLabel,
  DEFAULT_RIBBON_MODE, DEFAULT_RIBBON_THRESHOLD_RANK, RIBBON_MODES,
} from "../src/ui/kit/ribbon-rules.js";
import { eq, ok, report } from "./_assert.mjs";

const lvl = (id, rank) => ({ id, name: id[0].toUpperCase() + id.slice(1), color: "#000000", rank });
const PUBLIC = { level: lvl("public", 1), source: "space" };
const INTERNAL = { level: lvl("internal", 2), source: "space" };
const RESTRICTED = { level: lvl("restricted", 4), source: "page" };
const NONE = { level: null, source: "none" };
const quiet = { requests: 0, approvals: 0, grantsActive: [] };
const T4 = { rank: 4 };
const locked = { name: "contract-v3.pdf", owner: "Mihai Perdum", until: "2026-09-21T09:00:00.000Z", kind: "attachment", id: "att1", myRequest: "none" };

// ── settings ────────────────────────────────────────────────────────────────────────────────
eq("defaults", [DEFAULT_RIBBON_MODE, DEFAULT_RIBBON_THRESHOLD_RANK, RIBBON_MODES], ["exceptions", 4, ["exceptions", "always"]]);
eq("no stored settings → defaults", normalizeRibbonSettings(null), { ribbonMode: "exceptions", ribbonThresholdRank: 4, ribbonThresholdLevel: null, thresholdFrom: "rank" });
eq("stored always + 3", normalizeRibbonSettings({ ribbonMode: "always", ribbonThresholdRank: 3 }), { ribbonMode: "always", ribbonThresholdRank: 3, ribbonThresholdLevel: null, thresholdFrom: "rank" });
// CLS-10: the threshold is a LEVEL; its rank is resolved against the scheme at read time.
const LV = [{ id: "public", rank: 1 }, { id: "internal", rank: 2 }, { id: "confidential", rank: 3 }, { id: "restricted", rank: 4 }];
eq("a known level wins over the stored rank", normalizeRibbonSettings({ ribbonThresholdRank: 4, ribbonThresholdLevel: "confidential" }, LV).ribbonThresholdRank, 3);
eq("…and says so", normalizeRibbonSettings({ ribbonThresholdLevel: "confidential" }, LV).thresholdFrom, "level");
eq("re-ranked level → the new rank, same level", normalizeRibbonSettings({ ribbonThresholdLevel: "confidential" }, [{ id: "confidential", rank: 2 }]).ribbonThresholdRank, 2);
eq("an unknown level → the stored rank", normalizeRibbonSettings({ ribbonThresholdRank: 2, ribbonThresholdLevel: "gone" }, LV).ribbonThresholdRank, 2);
eq("a level with no scheme handed in → the stored rank", normalizeRibbonSettings({ ribbonThresholdRank: 2, ribbonThresholdLevel: "confidential" }).ribbonThresholdRank, 2);
eq("level validation: a string id passes", validateRibbonSettings({ ribbonThresholdLevel: "confidential" }).ok, true);
eq("level validation: null clears", validateRibbonSettings({ ribbonThresholdLevel: null }).ok, true);
eq("level validation: a number is refused", validateRibbonSettings({ ribbonThresholdLevel: 3 }).ok, false);
eq("unknown mode → default", normalizeRibbonSettings({ ribbonMode: "sometimes" }).ribbonMode, "exceptions");
eq("rank as a numeric string", normalizeRibbonSettings({ ribbonThresholdRank: "2" }).ribbonThresholdRank, 2);
eq("rank 0 → default", normalizeRibbonSettings({ ribbonThresholdRank: 0 }).ribbonThresholdRank, 4);
eq("rank 100 → default", normalizeRibbonSettings({ ribbonThresholdRank: 100 }).ribbonThresholdRank, 4);
eq("rank 2.5 → default", normalizeRibbonSettings({ ribbonThresholdRank: 2.5 }).ribbonThresholdRank, 4);
eq("validate: omitted keys pass", validateRibbonSettings({ defaultLockDuration: 3600 }).ok, true);
eq("validate: undefined data passes", validateRibbonSettings(undefined).ok, true);
eq("validate: good pair", validateRibbonSettings({ ribbonMode: "always", ribbonThresholdRank: 1 }).ok, true);
eq("validate: bad mode refused", validateRibbonSettings({ ribbonMode: "never" }).ok, false);
eq("validate: rank 0 refused", validateRibbonSettings({ ribbonThresholdRank: 0 }).ok, false);
eq("validate: rank 99 ok", validateRibbonSettings({ ribbonThresholdRank: 99 }).ok, true);
eq("validate: rank 'abc' refused", validateRibbonSettings({ ribbonThresholdRank: "abc" }).ok, false);
eq("validate: null values are 'unset' and pass", validateRibbonSettings({ ribbonMode: null, ribbonThresholdRank: null }).ok, true);

// ── threshold ───────────────────────────────────────────────────────────────────────────────
eq("restricted(4) ≥ 4", meetsThreshold(RESTRICTED, T4), true);
eq("internal(2) < 4", meetsThreshold(INTERNAL, T4), false);
eq("no level never meets", meetsThreshold(NONE, T4), false);
eq("threshold as a bare number", meetsThreshold(RESTRICTED, 4), true);
eq("threshold 2 admits internal", meetsThreshold(INTERNAL, { rank: 2 }), true);
eq("missing threshold → false", meetsThreshold(RESTRICTED, undefined), false);

// ── the one pill ─────────────────────────────────────────────────────────────────────────────
eq("nothing → null", pickUrgent({ waitingOnMe: quiet, lockedFor: null, alerts: [] }), null);
eq("alert beats everything", pickUrgent({ waitingOnMe: { requests: 3, approvals: 0, grantsActive: [] }, lockedFor: locked, alerts: [{ id: "a1" }] }).kind, "restored");
eq("…and counts the alerts", pickUrgent({ alerts: [{ id: "a1" }, { id: "a2" }] }).count, 2);
eq("waiting-for-you = requests + approvals", pickUrgent({ waitingOnMe: { requests: 2, approvals: 1, grantsActive: [] } }), { kind: "waiting-for-you", count: 3, requests: 2, approvals: 1 });
eq("waiting beats a grant", pickUrgent({ waitingOnMe: { requests: 1, approvals: 0, grantsActive: [{ name: "x" }] } }).kind, "waiting-for-you");
eq("grant → edit-now", pickUrgent({ waitingOnMe: { requests: 0, approvals: 0, grantsActive: [{ name: "budget.xlsx", until: "2026-09-18T17:00:00.000Z" }] } }).kind, "edit-now");
eq("…carrying the first grant", pickUrgent({ waitingOnMe: { grantsActive: [{ name: "budget.xlsx" }] } }).grant.name, "budget.xlsx");
eq("grant beats locked", pickUrgent({ waitingOnMe: { grantsActive: [{ name: "b" }] }, lockedFor: locked }).kind, "edit-now");
eq("pending request → waiting-for-owner", pickUrgent({ waitingOnMe: quiet, lockedFor: { ...locked, myRequest: "pending" } }).kind, "waiting-for-owner");
eq("…naming the seal", pickUrgent({ lockedFor: { ...locked, myRequest: "pending" } }).seal.owner, "Mihai Perdum");
eq("foreign seal → locked", pickUrgent({ waitingOnMe: quiet, lockedFor: locked }).kind, "locked");
eq("string counts are tolerated", pickUrgent({ waitingOnMe: { requests: "2", approvals: "0" } }).count, 2);
eq("negative / NaN counts are zero", pickUrgent({ waitingOnMe: { requests: -1, approvals: NaN } }), null);
eq("null grants entries are ignored", pickUrgent({ waitingOnMe: { grantsActive: [null] } }), null);

// ── exceptions mode ─────────────────────────────────────────────────────────────────────────
const exc = (over) => decideRibbon({ mode: "exceptions", classification: INTERNAL, threshold: T4, waitingOnMe: quiet, lockedFor: null, alerts: [], workflow: null, validation: null, ...over });
eq("internal, nothing urgent → closed", exc({}).show, false);
eq("…reasons empty", exc({}).reasons, []);
eq("(a) restricted meets threshold → open", exc({ classification: RESTRICTED }).show, true);
eq("…reason threshold", exc({ classification: RESTRICTED }).reasons, ["threshold"]);
eq("…overThreshold flag", exc({ classification: RESTRICTED }).overThreshold, true);
eq("(a) threshold lowered to 2 opens an Internal page", exc({ threshold: { rank: 2 } }).show, true);
eq("(a) thresholdRank shorthand", decideRibbon({ mode: "exceptions", classification: INTERNAL, thresholdRank: 2 }).show, true);
eq("(b) requests waiting → open", exc({ waitingOnMe: { requests: 1, approvals: 0, grantsActive: [] } }).show, true);
eq("…urgent kind", exc({ waitingOnMe: { requests: 1, approvals: 0, grantsActive: [] } }).urgent.kind, "waiting-for-you");
eq("(b) approvals waiting → open", exc({ waitingOnMe: { requests: 0, approvals: 2, grantsActive: [] } }).show, true);
eq("(b) an active grant → open (Edit now)", exc({ waitingOnMe: { requests: 0, approvals: 0, grantsActive: [{ name: "b", until: null }] } }).urgent.kind, "edit-now");
eq("(b) a seal the viewer does not own → open (Locked)", exc({ lockedFor: locked }).urgent.kind, "locked");
eq("(b) own request pending → open (Waiting for owner)", exc({ lockedFor: { ...locked, myRequest: "pending" } }).urgent.kind, "waiting-for-owner");
eq("(c) an active alert → open (Restored)", exc({ alerts: [{ id: "a", type: "edit-reverted" }] }).urgent.kind, "restored");
eq("workflow keeps showing", exc({ workflow: { assigned: true, state: { id: "draft" } } }).show, true);
eq("…reason workflow", exc({ workflow: { assigned: true } }).reasons, ["workflow"]);
eq("validation keeps showing", exc({ validation: "failed" }).show, true);
eq("…reason validation", exc({ validation: "failed" }).reasons, ["validation"]);
eq("unclassified page, nothing urgent → closed", exc({ classification: NONE }).show, false);
eq("unclassified page, locked → open", exc({ classification: NONE, lockedFor: locked }).show, true);
eq("public page, nothing urgent → closed", exc({ classification: PUBLIC }).show, false);
eq("threshold + urgent: reasons list both, threshold first", exc({ classification: RESTRICTED, lockedFor: locked }).reasons, ["threshold", "locked"]);
eq("a viewer-OWNED seal with nothing waiting is not a trigger (no lockedFor, no waiting)", exc({}).show, false);
eq("mode defaults to exceptions", decideRibbon({ classification: INTERNAL, threshold: T4 }).mode, "exceptions");
eq("unknown mode → exceptions", decideRibbon({ mode: "sometimes", classification: RESTRICTED, threshold: T4 }).reasons, ["threshold"]);
eq("empty input → closed", decideRibbon().show, false);
eq("threshold defaults to 4 when absent", decideRibbon({ mode: "exceptions", classification: RESTRICTED }).show, true);

// ── always mode ─────────────────────────────────────────────────────────────────────────────
const alw = (over) => decideRibbon({ mode: "always", classification: INTERNAL, threshold: T4, waitingOnMe: quiet, lockedFor: null, alerts: [], workflow: null, validation: null, ...over });
eq("internal, nothing urgent → open", alw({}).show, true);
eq("…right half empty (urgent null)", alw({}).urgent, null);
eq("…reason always", alw({}).reasons, ["always"]);
eq("public → open", alw({ classification: PUBLIC }).show, true);
eq("unclassified → open as Unclassified", alw({ classification: NONE }).show, true);
eq("…reason always-unclassified", alw({ classification: NONE }).reasons, ["always-unclassified"]);
eq("always + waiting → the same urgent right half", alw({ waitingOnMe: { requests: 3, approvals: 0, grantsActive: [] } }).urgent, { kind: "waiting-for-you", count: 3, requests: 3, approvals: 0 });
eq("always + locked", alw({ lockedFor: locked }).urgent.kind, "locked");
eq("always + alert", alw({ alerts: [{ id: "a" }] }).urgent.kind, "restored");
eq("always + workflow reasons", alw({ workflow: { assigned: true } }).reasons, ["always", "workflow"]);
eq("always: overThreshold still reported (restricted)", alw({ classification: RESTRICTED }).overThreshold, true);
eq("always: overThreshold false for internal", alw({}).overThreshold, false);
eq("decision echoes the classification", alw({}).classification, INTERNAL);

// ── untilLabel ───────────────────────────────────────────────────────────────────────────────
const now = Date.UTC(2026, 8, 15, 12, 0, 0); // Tue 15 Sep 2026
eq("no expiry → empty", untilLabel(null, now), "");
eq("garbage → empty", untilLabel("nope", now), "");
ok("inside the week → weekday + time", /^[A-Za-z]{3} \d{2}:\d{2}$/.test(untilLabel("2026-09-18T17:00:00.000Z", now, "en-GB")));
ok("beyond the week → day month + time", /^\d{1,2} [A-Za-z]{3} \d{2}:\d{2}$/.test(untilLabel("2026-10-05T09:00:00.000Z", now, "en-GB")));

// ── CLS-1: classification off ───────────────────────────────────────────────────────────────
{
  const OFF = { level: null, source: "none", enabled: false };
  const off = (over) => decideRibbon({ mode: "always", classification: OFF, threshold: T4, waitingOnMe: quiet, lockedFor: null, alerts: [], workflow: null, validation: null, ...over });
  eq("off: 'always' no longer opens the row on its own", off({}).show, false);
  eq("off: the mode collapses to exceptions", off({}).mode, "exceptions");
  eq("off: no always-unclassified reason", off({}).reasons, []);
  eq("off: the decision carries enabled:false for the surface", off({}).classification, OFF);
  eq("off: a level sent anyway is ignored (never over threshold)", decideRibbon({ mode: "exceptions", classification: { ...RESTRICTED, enabled: false }, threshold: T4 }).show, false);
  eq("off: …and not echoed", decideRibbon({ mode: "exceptions", classification: { ...RESTRICTED, enabled: false }, threshold: T4 }).classification.level, null);
  eq("off: urgent still opens the row", off({ lockedFor: locked }).show, true);
  eq("off: workflow still opens the row", off({ workflow: { state: { id: "approved" } } }).reasons, ["workflow"]);
  eq("on (enabled:true) behaves as before", decideRibbon({ mode: "always", classification: { ...INTERNAL, enabled: true }, threshold: T4 }).reasons, ["always"]);
  eq("enabled undefined behaves as before", decideRibbon({ mode: "always", classification: NONE, threshold: T4 }).reasons, ["always-unclassified"]);
}

report("ribbon-rules");
