// SEC-3 (UX critique 2026-09-19) — the ONE status vocabulary and the ONE clock every surface
// composes from: badge, rows, ribbon, byline, My work, refusals. Pins the words so a surface can
// never drift back to "Overdue" / "unlock" / "Restored" / a 12-hour clock on its own.
import { eq, ok, report } from "./_assert.mjs";
import { when, whenDay, WORDS, holderLabel, sealSentence, stateText, alertWord, sealCountLabel, attachmentChip, refusalText, DECLINED_REASON } from "../src/ui/kit/status-language.js";
import { untilLabel, pickUrgent } from "../src/ui/kit/ribbon-rules.js";
import { when as rowWhen, statusChip, rowActions } from "../src/ui/kit/seal-row.js";
import { primaryActionFor, HELD_LABEL } from "../src/server/capsules/page-details/row-state.js";
import { HELD_ROW_LABEL, HELD_REASON } from "../src/server/shared/seal-authority.js";

const now = new Date("2026-09-20T10:00:00.000Z").getTime();
const L = "en-GB";

// ── the clock ────────────────────────────────────────────────────────────────────────────────
eq("nothing → empty", when(null, now, L), "");
eq("garbage → empty", when("nope", now, L), "");
ok("inside the week → weekday + 24-h time", /^[A-Za-z]{3} \d{2}:\d{2}$/.test(when("2026-09-22T20:57:00.000Z", now, L)));
ok("beyond the week, same year → day month + time", /^\d{1,2} [A-Za-z]{3} \d{2}:\d{2}$/.test(when("2026-10-05T09:00:00.000Z", now, L)));
ok("another year → day month year + time", /^\d{1,2} [A-Za-z]{3} 2027 \d{2}:\d{2}$/.test(when("2027-02-16T09:00:00.000Z", now, L)));
ok("never a 12-hour clock", !/AM|PM|am|pm/.test(when("2026-09-22T20:57:00.000Z", now, "en-US")));
eq("ribbon-rules.untilLabel IS the shared clock", untilLabel, when);
eq("seal-row.when IS the shared clock", rowWhen, when);
ok("whenDay is a calendar day, no clock", /^\d{1,2} [A-Za-z]{3,4} 2026$/.test(whenDay("2026-09-22T20:57:00.000Z", L)) && !/:/.test(whenDay("2026-09-22T20:57:00.000Z", L)));
eq("whenDay utc pins the day", whenDay("2026-09-22T23:30:00.000Z", L, { utc: true }), "22 Sept 2026");

// ── the words ────────────────────────────────────────────────────────────────────────────────
eq("held label is the server's sentence", WORDS.held, HELD_ROW_LABEL);
eq("held reason is the server's sentence", WORDS.heldReason, HELD_REASON);
eq("row-state's HELD_LABEL is the shared word", HELD_LABEL, WORDS.held);
eq("owner → Sealed by you", holderLabel({ isMine: true, ownerName: "Mihai" }), "Sealed by you");
eq("stranger → Locked by {name}", holderLabel({ isMine: false, ownerName: "Gabriela Perdum" }), "Locked by Gabriela Perdum");
eq("no name → Locked by another user", holderLabel({ isMine: false }), "Locked by another user");
eq("held beats the person", holderLabel({ isMine: true, workflowHeld: true }), WORDS.held);

// ── the sentence ─────────────────────────────────────────────────────────────────────────────
const w = when("2026-09-22T20:57:00.000Z", now, L);
eq("owner, live", sealSentence({ isMine: true, expiresAt: "2026-09-22T20:57:00.000Z" }, now, L), `Sealed by you · until ${w}`);
eq("stranger, live", sealSentence({ isMine: false, ownerName: "Gabriela Perdum", expiresAt: "2026-09-22T20:57:00.000Z" }, now, L), `Locked by Gabriela Perdum · until ${w}`);
eq("expired", sealSentence({ isMine: true, isExpired: true, expiresAt: "2026-09-22T20:57:00.000Z" }, now, L), `Sealed by you · expired ${w}`);
eq("held → expiry paused", sealSentence({ isMine: false, ownerName: "G", workflowHeld: true, expiresAt: null }, now, L), `${WORDS.held} · expiry paused`);
eq("no expiry", sealSentence({ isMine: true, expiresAt: null }, now, L), "Sealed by you · no expiry");
eq("trashed", sealSentence({ isMine: true, isTrashed: true, expiresAt: "2026-09-22T20:57:00.000Z" }, now, L), "Sealed by you · in the trash");

// ── state spans ──────────────────────────────────────────────────────────────────────────────
eq("waiting", stateText({ kind: "waiting", owner: "Gabriela Perdum" }), "Waiting for Gabriela Perdum");
eq("edit now · until", stateText({ kind: "editnow", until: "2026-09-22T20:57:00.000Z" }, now, L), `Edit now · until ${w}`);
eq("declined · ask again", stateText({ kind: "declined", retryAt: "2026-09-22T20:57:00.000Z" }, now, L), `Declined · ask again ${w}`);
eq("expired", stateText({ kind: "expired" }), "Expired");
eq("held", stateText({ kind: "held", label: WORDS.held }), WORDS.held);
eq("trashed", stateText({ kind: "trashed" }), "In the trash");

// ── SEC-8: the declined state is a state, not a disabled button ─────────────────────────────
const base = { kind: "section", isMine: false, isExpired: false, isTrashed: false, ownerName: "Gabriela Perdum", expiresAt: "2026-10-01T09:00:00.000Z", myEditStatus: "denied", myRetryAt: "2026-09-20T11:00:00.000Z", pendingRequests: [] };
eq("denied inside the cooldown → declined", primaryActionFor(base, {}, now).kind, "declined");
eq("…carrying retryAt", primaryActionFor(base, {}, now).retryAt, base.myRetryAt);
eq("…never disabled", primaryActionFor(base, {}, now).disabled, undefined);
eq("…with the owner's reason when given", primaryActionFor({ ...base, myDeniedReason: "not now" }, {}, now).reason, "not now");
eq("denied after the cooldown → Request edit again", primaryActionFor(base, {}, now + 2 * 3600 * 1000).kind, "request");
eq("denied with no retryAt → Request edit", primaryActionFor({ ...base, myRetryAt: null }, {}, now).kind, "request");
eq("ribbon: a declined request is urgent as 'declined'", pickUrgent({ lockedFor: { name: "Decisions", owner: "G", myRequest: "denied", retryAt: base.myRetryAt } }).kind, "declined");
eq("ribbon: declined without retryAt is just locked", pickUrgent({ lockedFor: { name: "Decisions", owner: "G", myRequest: "denied" } }).kind, "locked");
eq("ribbon: pending still wins", pickUrgent({ lockedFor: { name: "D", owner: "G", myRequest: "pending", retryAt: base.myRetryAt } }).kind, "waiting-for-owner");
eq("server refusal carries no clock", DECLINED_REASON.includes("UTC"), false);
ok("the surface composes the retry clock", refusalText({ reason: DECLINED_REASON, retryAt: "2026-09-22T20:57:00.000Z" }, now, L).endsWith(`You can ask again ${w}.`));
eq("a refusal without retryAt is the reason alone", refusalText({ reason: "No." }), "No.");

// ── SEC-10: Release on your own seal is not a danger item ───────────────────────────────────
const mine = { kind: "attachment", id: "a", name: "f", sealed: true, isMine: true, isExpired: false, isTrashed: false, myEditStatus: "none", pendingRequests: [{ requesterAccountId: "x", requesterName: "X" }] };
const menu = rowActions(mine, {}).menu;
eq("Release under ⋯ is not danger", menu.find((m) => m.id === "release")?.danger, false);
eq("Force release stays danger", rowActions({ ...mine, isMine: false }, { isSpaceAdmin: true }).menu.find((m) => m.id === "force-release")?.danger, true);

// ── words on chips / alerts / byline ─────────────────────────────────────────────────────────
eq("alert: revert → Undone", alertWord("section-reverted"), "Undone");
eq("alert: demote → Moved back", alertWord("workflow-demoted"), "Moved back");
eq("Sealed (2)", sealCountLabel(2), "Sealed (2)");
eq("no seals → empty", sealCountLabel(0), "");
eq("expired chip says Expired, never Overdue", attachmentChip({ title: "f", lockStatus: "HELD", isExpired: true }).text, "Expired");
eq("own chip says Sealed by you", attachmentChip({ title: "f", lockStatus: "HELD_BY_ACTOR" }).text, "Sealed by you");
eq("seal-row.statusChip is the shared chip", statusChip({ title: "f", lockStatus: "HELD", isExpired: true }).text, "Expired");
ok("the chip aria uses the shared clock", statusChip({ title: "f", lockStatus: "HELD", expiresAt: "2026-09-22T20:57:00.000Z" }).aria.includes("until "));

report("status-language");
