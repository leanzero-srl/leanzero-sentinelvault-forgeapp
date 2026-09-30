// 5.0 ribbon — the pure show rule, the one-state-pill choice and the write-gate validation, branch
// by branch. Zero Forge imports: src/ui/kit/ribbon-rules.js loads in plain node like activity-format.js.
//
// 2026-09-30 (classification review): with classification ACTIVE the row shows on every page and
// the level block cannot be dismissed; with it OFF only seal / workflow / validation / alert states
// open it. The old ribbonMode / threshold settings are accepted by the write gate and read by nothing.
import {
  decideRibbon, pickUrgent, validateRibbonSettings, untilLabel,
  DEFAULT_RIBBON_MODE, DEFAULT_RIBBON_THRESHOLD_RANK, RIBBON_MODES,
} from "../src/ui/kit/ribbon-rules.js";
import * as ribbonRules from "../src/ui/kit/ribbon-rules.js";
import { eq, ok, report } from "./_assert.mjs";

const lvl = (id, rank) => ({ id, name: id[0].toUpperCase() + id.slice(1), color: "#000000", rank });
const ON = (level, source = "space") => ({ level, source: level ? source : "none", enabled: true });
const PUBLIC = ON(lvl("public", 1));
const INTERNAL = ON(lvl("internal", 2));
const RESTRICTED = ON(lvl("restricted", 4), "page");
const UNCLASSIFIED = ON(null);
const OFF = { level: null, source: "none", enabled: false };
const quiet = { requests: 0, approvals: 0, grantsActive: [] };
const locked = { name: "contract-v3.pdf", owner: "Mihai Perdum", until: "2026-09-21T09:00:00.000Z", kind: "attachment", id: "att1", myRequest: "none" };

// ── the old settings: accepted when well-formed, read by nothing ─────────────────────────────
eq("constants kept for the write gate", [DEFAULT_RIBBON_MODE, DEFAULT_RIBBON_THRESHOLD_RANK, RIBBON_MODES], ["exceptions", 4, ["exceptions", "always"]]);
eq("normalizeRibbonSettings is gone (nothing reads the settings)", typeof ribbonRules.normalizeRibbonSettings, "undefined");
eq("meetsThreshold is gone (no threshold opens the row)", typeof ribbonRules.meetsThreshold, "undefined");
eq("level validation: a string id passes", validateRibbonSettings({ ribbonThresholdLevel: "confidential" }).ok, true);
eq("level validation: null clears", validateRibbonSettings({ ribbonThresholdLevel: null }).ok, true);
eq("level validation: a number is refused", validateRibbonSettings({ ribbonThresholdLevel: 3 }).ok, false);
eq("validate: omitted keys pass", validateRibbonSettings({ defaultLockDuration: 3600 }).ok, true);
eq("validate: undefined data passes", validateRibbonSettings(undefined).ok, true);
eq("validate: good pair", validateRibbonSettings({ ribbonMode: "always", ribbonThresholdRank: 1 }).ok, true);
eq("validate: bad mode refused", validateRibbonSettings({ ribbonMode: "never" }).ok, false);
eq("validate: rank 0 refused", validateRibbonSettings({ ribbonThresholdRank: 0 }).ok, false);
eq("validate: rank 99 ok", validateRibbonSettings({ ribbonThresholdRank: 99 }).ok, true);
eq("validate: rank 'abc' refused", validateRibbonSettings({ ribbonThresholdRank: "abc" }).ok, false);
eq("validate: null values are 'unset' and pass", validateRibbonSettings({ ribbonMode: null, ribbonThresholdRank: null }).ok, true);

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

// ── P1: classification ACTIVE → the row shows on every page, whatever else is going on ───────
const on = (over) => decideRibbon({ classification: INTERNAL, waitingOnMe: quiet, lockedFor: null, alerts: [], workflow: null, validation: null, ...over });
eq("active + nothing else (no attachment, no seal, no workflow) → open", on({}).show, true);
eq("…active flag", on({}).active, true);
eq("…reason classification", on({}).reasons, ["classification"]);
eq("…right half empty (urgent null)", on({}).urgent, null);
eq("…and nothing to dismiss (the marking is not dismissable)", on({}).dismissable, false);
eq("public → open", on({ classification: PUBLIC }).show, true);
eq("restricted → open", on({ classification: RESTRICTED }).show, true);
eq("unclassified page in an active space → open as Unclassified", on({ classification: UNCLASSIFIED }).show, true);
eq("…reason unclassified", on({ classification: UNCLASSIFIED }).reasons, ["unclassified"]);
eq("…level null, source none", [on({ classification: UNCLASSIFIED }).classification.level, on({ classification: UNCLASSIFIED }).classification.source], [null, "none"]);
eq("the decision echoes the level and where it comes from", on({}).classification, { level: INTERNAL.level, source: "space", enabled: true });
eq("a page override keeps source page", on({ classification: RESTRICTED }).classification.source, "page");
eq("active + waiting → the same urgent right half", on({ waitingOnMe: { requests: 3, approvals: 0, grantsActive: [] } }).urgent, { kind: "waiting-for-you", count: 3, requests: 3, approvals: 0 });
eq("…and it is dismissable (the right half, not the level)", on({ waitingOnMe: { requests: 3, approvals: 0, grantsActive: [] } }).dismissable, true);
eq("active + locked", on({ lockedFor: locked }).urgent.kind, "locked");
eq("active + alert", on({ alerts: [{ id: "a" }] }).urgent.kind, "restored");
eq("active + workflow reasons, classification first", on({ workflow: { assigned: true } }).reasons, ["classification", "workflow"]);
eq("active + validation dismissable", on({ validation: "failed" }).dismissable, true);
eq("threshold / mode inputs are ignored (old callers)", decideRibbon({ mode: "exceptions", threshold: { rank: 4 }, classification: PUBLIC }).show, true);

// ── classification OFF → only seal / workflow / validation / alert states open the row ────────
const off = (over) => decideRibbon({ classification: OFF, waitingOnMe: quiet, lockedFor: null, alerts: [], workflow: null, validation: null, ...over });
eq("off, nothing → closed", off({}).show, false);
eq("off: reasons empty", off({}).reasons, []);
eq("off: active false", off({}).active, false);
eq("off: the decision carries enabled:false for the surface", off({}).classification, OFF);
eq("off: a level sent anyway is ignored and not echoed", decideRibbon({ classification: { ...RESTRICTED, enabled: false } }).classification.level, null);
eq("off: …and does not open the row", decideRibbon({ classification: { ...RESTRICTED, enabled: false } }).show, false);
eq("off: requests waiting → open", off({ waitingOnMe: { requests: 1, approvals: 0, grantsActive: [] } }).show, true);
eq("off: an active grant → open (Edit now)", off({ waitingOnMe: { requests: 0, approvals: 0, grantsActive: [{ name: "b", until: null }] } }).urgent.kind, "edit-now");
eq("off: a seal the viewer does not own → open (Locked)", off({ lockedFor: locked }).urgent.kind, "locked");
eq("off: own request pending → open (Waiting for owner)", off({ lockedFor: { ...locked, myRequest: "pending" } }).urgent.kind, "waiting-for-owner");
eq("off: an active alert → open (Restored)", off({ alerts: [{ id: "a", type: "edit-reverted" }] }).urgent.kind, "restored");
eq("off: workflow keeps showing", off({ workflow: { assigned: true, state: { id: "draft" } } }).reasons, ["workflow"]);
eq("off: validation keeps showing", off({ validation: "failed" }).reasons, ["validation"]);
eq("off: the row is dismissable when open", off({ lockedFor: locked }).dismissable, true);
eq("enabled undefined (no summary) reads as off", decideRibbon({ classification: { level: INTERNAL.level, source: "space" } }).active, false);
eq("empty input → closed", decideRibbon().show, false);

// ── untilLabel ───────────────────────────────────────────────────────────────────────────────
const now = Date.UTC(2026, 8, 15, 12, 0, 0); // Tue 15 Sep 2026
eq("no expiry → empty", untilLabel(null, now), "");
eq("garbage → empty", untilLabel("nope", now), "");
ok("inside the week → weekday + time", /^[A-Za-z]{3} \d{2}:\d{2}$/.test(untilLabel("2026-09-18T17:00:00.000Z", now, "en-GB")));
ok("beyond the week → day month + time", /^\d{1,2} [A-Za-z]{3} \d{2}:\d{2}$/.test(untilLabel("2026-10-05T09:00:00.000Z", now, "en-GB")));

report("ribbon-rules");
