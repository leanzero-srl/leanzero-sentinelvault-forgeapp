// Edit-request cooldown — the one rule behind "when may a declined person ask again?".
import { cooldownMsFrom, retryAtFor, isCoolingDown, EDIT_COOLDOWN_HOURS_DEFAULT, EDIT_COOLDOWN_HOURS_MAX } from "../src/server/shared/edit-cooldown.js";
import { POLICY_DEFAULTS } from "../src/server/shared/baseline.js";
import { readEffective, validatePolicyWrite, control } from "../src/server/capsules/policies/settings-schema.js";
import { primaryActionFor, menuActionsFor } from "../src/server/capsules/page-details/row-state.js";

let pass = 0, fail = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (ok) pass++; else { fail++; console.error(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); } };
const ok = (name, cond) => eq(name, !!cond, true);
const H = 3600 * 1000;

// ── the setting → ms ──
eq("never-saved site: the default", cooldownMsFrom(null), EDIT_COOLDOWN_HOURS_DEFAULT * H);
eq("never-saved key: the default", cooldownMsFrom({}), EDIT_COOLDOWN_HOURS_DEFAULT * H);
ok("the default is NOT the old 48h", EDIT_COOLDOWN_HOURS_DEFAULT < 48);
eq("saved 6h", cooldownMsFrom({ editRequestCooldownHours: 6 }), 6 * H);
eq("saved 0 = ask again at once (0 is a value, not 'unset')", cooldownMsFrom({ editRequestCooldownHours: 0 }), 0);
eq("a fractional save floors", cooldownMsFrom({ editRequestCooldownHours: 2.9 }), 2 * H);
for (const bad of [-1, "soon", NaN, EDIT_COOLDOWN_HOURS_MAX + 1, "", null]) {
  eq(`malformed ${JSON.stringify(bad)} → default (never 'no cooldown', never 48h)`, cooldownMsFrom({ editRequestCooldownHours: bad }), EDIT_COOLDOWN_HOURS_DEFAULT * H);
}
eq("the schema default IS the engine default", POLICY_DEFAULTS.editRequestCooldownHours, EDIT_COOLDOWN_HOURS_DEFAULT);
eq("readEffective agrees with the engine (saved 6)", readEffective("editRequestCooldownHours", 6) * H, cooldownMsFrom({ editRequestCooldownHours: 6 }));
eq("readEffective agrees with the engine (saved 0)", readEffective("editRequestCooldownHours", 0) * H, cooldownMsFrom({ editRequestCooldownHours: 0 }));
eq("readEffective agrees with the engine (malformed)", readEffective("editRequestCooldownHours", "soon") * H, cooldownMsFrom({ editRequestCooldownHours: "soon" }));
ok("the control exists in Protection", control("editRequestCooldownHours")?.group === "protection");
eq("write: 0 accepted", validatePolicyWrite("global", { editRequestCooldownHours: 0 }), { ok: true });
eq("write: 4 accepted", validatePolicyWrite("global", { editRequestCooldownHours: 4 }), { ok: true });
eq("write: -1 refused", validatePolicyWrite("global", { editRequestCooldownHours: -1 }).ok, false);
eq("write: 1.5 refused", validatePolicyWrite("global", { editRequestCooldownHours: 1.5 }).ok, false);
eq("write: over the week refused", validatePolicyWrite("global", { editRequestCooldownHours: EDIT_COOLDOWN_HOURS_MAX + 1 }).ok, false);
eq("write: notifyEditorOnRevert must be boolean", validatePolicyWrite("global", { notifyEditorOnRevert: "yes" }).ok, false);
eq("notifyEditorOnRevert defaults ON and is not opt-in", [readEffective("notifyEditorOnRevert", undefined), readEffective("notifyEditorOnRevert", false)], [true, false]);

// ── retryAt ──
const now = Date.parse("2026-09-17T12:00:00.000Z");
eq("declined 10 min ago, 1h cooldown → retry in 50 min", retryAtFor("2026-09-17T11:50:00.000Z", 1 * H, now), "2026-09-17T12:50:00.000Z");
eq("declined 61 min ago, 1h cooldown → may ask now", retryAtFor("2026-09-17T10:59:00.000Z", 1 * H, now), null);
eq("exactly at the boundary → may ask now", retryAtFor("2026-09-17T11:00:00.000Z", 1 * H, now), null);
eq("0h cooldown → may always ask now", retryAtFor("2026-09-17T11:59:59.000Z", 0, now), null);
eq("no deniedAt on the record → may ask now (a malformed record never locks someone out)", retryAtFor(null, 48 * H, now), null);
eq("unparseable deniedAt → may ask now", retryAtFor("yesterday", 48 * H, now), null);
eq("isCoolingDown mirrors retryAtFor", [isCoolingDown("2026-09-17T11:50:00.000Z", H, now), isCoolingDown("2026-09-17T10:00:00.000Z", H, now)], [true, false]);

// ── the row: a declined requester is told WHEN, never "48 hours" ──
const base = { kind: "attachment", sealed: true, isMine: false, isExpired: false, isTrashed: false, ownerName: "Mihai", expiresAt: null, pendingRequests: [] };
const denied = primaryActionFor({ ...base, myEditStatus: "denied", myRetryAt: "2026-09-17T12:50:00.000Z" });
eq("declined: Request edit, disabled, carries retryAt", [denied.kind, denied.disabled, denied.retryAt], ["request", true, "2026-09-17T12:50:00.000Z"]);
ok("declined hint no longer names 48 hours", !/48/.test(denied.hint));
ok("declined hint tells them the owner can grant directly", /owner can also give you access/.test(denied.hint));
ok("declined with no retryAt still renders a hint", /declined/.test(primaryActionFor({ ...base, myEditStatus: "denied" }).hint));

// ── the menu: Give edit access… ──
ok("owner of a live attachment seal can give access", menuActionsFor({ ...base, isMine: true }).includes("give-access"));
ok("owner of a live section seal can give access", menuActionsFor({ ...base, kind: "section", isMine: true }).includes("give-access"));
ok("NOT on an expired seal (the grant would be born dead)", !menuActionsFor({ ...base, isMine: true, isExpired: true }).includes("give-access"));
ok("NOT on a trashed file", !menuActionsFor({ ...base, isMine: true, isTrashed: true }).includes("give-access"));
ok("a plain requester never sees it", !menuActionsFor(base).includes("give-access"));
ok("a space admin on someone else's seal does", menuActionsFor(base, { isSpaceAdmin: true }).includes("give-access"));
ok("…but not on an expired one", !menuActionsFor({ ...base, isExpired: true }, { isSpaceAdmin: true }).includes("give-access"));
ok("an unsealed attachment never offers it", !menuActionsFor({ ...base, sealed: false, isMine: true }).includes("give-access"));

console.log(`edit-cooldown: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
