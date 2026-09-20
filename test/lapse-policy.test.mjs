import {
  decideLapseAction,
  resolveLapsePolicy,
  priorNoticeCount,
  LAPSE_NOTICE_LIMIT_DEFAULT,
  LAPSE_NOTICE_INTERVAL_MS_DEFAULT,
  lapseSubject,
} from "../src/server/shared/lapse-policy.js";
import { eq, ok, report } from "./_assert.mjs";

// F5 (owner feedback 2026-08-27): "if a sealed image is overdue a notice message must be sent to
// the owner and after 3 notifications/days if the user doesn't extend the period the image must
// became available (there are situation when a user is leaving the company and if he is sealing
// a section/image this remain as unavailable)".
//
// The rule is a clock, and the sweep runs hourly, so the only way to prove "the third reminder is
// followed by a release and there is never a fourth" without waiting three real days is to hand
// the decision synthetic times. That is what this file does.

const DAY = 24 * 3600 * 1000;
const T0 = 1_700_000_000_000; // an arbitrary fixed epoch — never Date.now(), so runs are identical

const decide = (over) => decideLapseAction({
  priorCount: 0, lastSentMs: 0, nowMs: T0, limit: 3, intervalMs: DAY, ...over,
});

// --- The whole three-day run, one step at a time -----------------------------------------

const first = decide({ priorCount: 0, lastSentMs: 0 });
eq("a freshly lapsed seal notifies immediately", first.action, "notify");
eq("...and it is reminder 1", first.noticeNumber, 1);
eq("...naming a limit of 3", first.noticeLimit, 3);
eq("...and a release date 3 days out (this reminder plus the two to come)",
  first.releaseAtMs, T0 + 3 * DAY);

eq("an hour later, nothing — the sweep runs hourly and must not comment hourly",
  decide({ priorCount: 1, lastSentMs: T0, nowMs: T0 + 3600 * 1000 }).action, "wait");
eq("23h59m later, still nothing",
  decide({ priorCount: 1, lastSentMs: T0, nowMs: T0 + DAY - 60_000 }).action, "wait");

const second = decide({ priorCount: 1, lastSentMs: T0, nowMs: T0 + DAY });
eq("a day later, reminder 2", second.action, "notify");
eq("...numbered 2", second.noticeNumber, 2);
eq("reminder 2 names the SAME release date as reminder 1 — a receding deadline is not a deadline",
  second.releaseAtMs, T0 + 3 * DAY);

const third = decide({ priorCount: 2, lastSentMs: T0 + DAY, nowMs: T0 + 2 * DAY });
eq("two days later, reminder 3", third.action, "notify");
eq("...numbered 3", third.noticeNumber, 3);
eq("reminder 3 still names the same release date", third.releaseAtMs, T0 + 3 * DAY);

eq("with all three reminders sent, the seal is RELEASED — this is the departed-owner case",
  decide({ priorCount: 3, lastSentMs: T0 + 2 * DAY, nowMs: T0 + 3 * DAY }).action, "release");

// The release must not be gated behind the reminder interval: once the reminders are spent the
// file is handed back on the next sweep, not a day after it.
eq("release is not held back by the interval guard",
  decide({ priorCount: 3, lastSentMs: T0 + 2 * DAY, nowMs: T0 + 2 * DAY + 60_000 }).action, "release");

eq("a count past the limit still releases rather than falling through to a 4th reminder",
  decide({ priorCount: 9, lastSentMs: T0, nowMs: T0 + 99 * DAY }).action, "release");

// --- Auto-release turned off (limit 0) ---------------------------------------------------

const offFirst = decide({ limit: 0, priorCount: 0, lastSentMs: 0 });
eq("limit 0 still sends the first reminder", offFirst.action, "notify");
eq("...and names no release date, because there will not be one", offFirst.releaseAtMs, null);
eq("limit 0 never releases — the seal is held indefinitely on purpose",
  decide({ limit: 0, priorCount: 1, lastSentMs: T0, nowMs: T0 + 365 * DAY }).action, "wait");
eq("limit 0 does not repeat the reminder either (the pre-F5 behaviour was exactly one)",
  decide({ limit: 0, priorCount: 1, lastSentMs: 0, nowMs: T0 + 365 * DAY }).action, "wait");

// --- A single-reminder policy ------------------------------------------------------------

eq("limit 1 notifies once", decide({ limit: 1, priorCount: 0 }).action, "notify");
eq("limit 1 then releases", decide({ limit: 1, priorCount: 1, lastSentMs: T0, nowMs: T0 + DAY }).action, "release");

// --- resolveLapsePolicy: stored values are RAW and must not reach the arithmetic ---------

eq("no policy → default limit", resolveLapsePolicy(undefined).limit, LAPSE_NOTICE_LIMIT_DEFAULT);
eq("no policy → default interval", resolveLapsePolicy(undefined).intervalMs, LAPSE_NOTICE_INTERVAL_MS_DEFAULT);
eq("empty policy → default limit", resolveLapsePolicy({}).limit, LAPSE_NOTICE_LIMIT_DEFAULT);
eq("a steward's 5 is honoured", resolveLapsePolicy({ lapseNoticeLimit: 5 }).limit, 5);
eq("0 is honoured — it is the documented way to disable the release",
  resolveLapsePolicy({ lapseNoticeLimit: 0 }).limit, 0);
eq("a negative limit falls back rather than releasing on the first sweep",
  resolveLapsePolicy({ lapseNoticeLimit: -3 }).limit, LAPSE_NOTICE_LIMIT_DEFAULT);
eq("a non-numeric limit falls back",
  resolveLapsePolicy({ lapseNoticeLimit: "three" }).limit, LAPSE_NOTICE_LIMIT_DEFAULT);
eq("NaN falls back", resolveLapsePolicy({ lapseNoticeLimit: NaN }).limit, LAPSE_NOTICE_LIMIT_DEFAULT);
eq("a fractional limit is floored", resolveLapsePolicy({ lapseNoticeLimit: 3.9 }).limit, 3);

eq("6-hour interval honoured",
  resolveLapsePolicy({ lapseNoticeIntervalHours: 6 }).intervalMs, 6 * 3600 * 1000);
eq("a zero interval falls back — it would comment on every hourly sweep",
  resolveLapsePolicy({ lapseNoticeIntervalHours: 0 }).intervalMs, LAPSE_NOTICE_INTERVAL_MS_DEFAULT);
eq("a negative interval falls back",
  resolveLapsePolicy({ lapseNoticeIntervalHours: -1 }).intervalMs, LAPSE_NOTICE_INTERVAL_MS_DEFAULT);
eq("a non-numeric interval falls back",
  resolveLapsePolicy({ lapseNoticeIntervalHours: "daily" }).intervalMs, LAPSE_NOTICE_INTERVAL_MS_DEFAULT);

// --- priorNoticeCount: the upgrade path --------------------------------------------------

eq("no record → nothing sent yet", priorNoticeCount(null), 0);
eq("undefined record → nothing sent yet", priorNoticeCount(undefined), 0);
eq("a counted record reads its count", priorNoticeCount({ count: 2 }), 2);
// The important one: an install upgrading to F5 holds pre-F5 markers with no count. They stood
// for exactly one notice. Reading them as 0 would tell the owner the same thing a second time.
eq("a pre-F5 record with no count counts as the one notice it was",
  priorNoticeCount({ sentAt: "2026-08-20T00:00:00.000Z" }), 1);
eq("a garbage count is treated as that one legacy notice, never as zero",
  priorNoticeCount({ count: "many" }), 1);
eq("count 0 on an existing record still means the record itself stood for a notice",
  priorNoticeCount({ count: 0 }), 1);

// A pre-F5 marker must not cause an immediate release either: it counts as 1 of 3, so the
// upgraded install continues the countdown rather than handing the file back on the next sweep.
eq("an upgraded install continues the countdown instead of releasing at once",
  decideLapseAction({
    priorCount: priorNoticeCount({ sentAt: "2026-08-20T00:00:00.000Z" }),
    lastSentMs: T0 - 2 * DAY, nowMs: T0, limit: 3, intervalMs: DAY,
  }).noticeNumber, 2);

// --- SEC-7 (d): section seals ride the same sweep — the one mapping between the two records ----
const att = { attachmentId: "a1", attachmentName: "plan.docx", contentId: "77", spaceKey: "WFH", lockedBy: "acc-O", timestamp: "2026-09-01T00:00:00Z", expiresAt: "2026-09-04T00:00:00Z" };
const sec = { sectionId: "s1", sectionTitle: "Risks", pageId: "77", spaceKey: "WFH", lockedBy: "acc-O", timestamp: "2026-09-01T00:00:00Z", expiresAt: "2026-09-04T00:00:00Z" };
const A = lapseSubject("attachment", "protection-a1", att);
const S = lapseSubject("section", "section-protection-s1", sec);
eq("attachment subject: id from the key, name, page, owner", [A.kind, A.id, A.name, A.pageId, A.ownerAccountId], ["attachment", "a1", "plan.docx", "77", "acc-O"]);
eq("section subject: id from the key, TITLE as the name, pageId (not contentId)", [S.kind, S.id, S.name, S.pageId, S.ownerAccountId], ["section", "s1", "Risks", "77", "acc-O"]);
eq("both keep their own dedup keys", [A.dedupKey, A.halfwayKey, S.dedupKey, S.halfwayKey], ["expiry-notified-a1", "fifty-percent-reminder-sent-a1", "expiry-notified-s1", "fifty-percent-reminder-sent-s1"]);
ok("a workflow-HELD seal (expiry paused: SEC-2) is skipped", lapseSubject("section", "section-protection-s1", { ...sec, expiresAt: null, workflowHeld: { remainingMs: 5 } }) === null);
ok("a trashedOnly tracking record is not a seal", lapseSubject("attachment", "protection-a1", { ...att, trashedOnly: true }) === null);
ok("no timestamp → skipped", lapseSubject("section", "section-protection-s1", { ...sec, timestamp: null }) === null);
ok("no owner → skipped", lapseSubject("section", "section-protection-s1", { ...sec, lockedBy: null }) === null);
ok("a section record without a sectionId is not a seal", lapseSubject("section", "section-protection-s1", { ...sec, sectionId: undefined }) === null);
ok("null → null", lapseSubject("section", "k", null) === null);
eq("a section without a title still has a name", lapseSubject("section", "section-protection-s2", { ...sec, sectionId: "s2", sectionTitle: "" }).name, "Sealed section");

report("lapse-policy");
