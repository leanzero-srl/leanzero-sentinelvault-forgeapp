import {
  shouldPostComment,
  normalizeNotificationsMode,
  NOTIFICATIONS_MODES,
  NOTICE_EDITOR_REVERT,
} from "../src/server/shared/notice-policy.js";
import { DISPATCH_DEFAULTS } from "../src/server/shared/baseline.js";
import { eq, report } from "./_assert.mjs";

// P1-4 (UX review 2026-09-14 §4.2): the pure decision behind every comment (+ @mention) the app
// posts. This is the whole of the notification-noise contract, so every branch is asserted.

// --- normalizeNotificationsMode: anything but "quiet" is "normal" (fail open) ---
eq("quiet stays quiet", normalizeNotificationsMode("quiet"), "quiet");
eq("normal stays normal", normalizeNotificationsMode("normal"), "normal");
eq("absent → normal", normalizeNotificationsMode(undefined), "normal");
eq("null → normal", normalizeNotificationsMode(null), "normal");
eq("typo → normal (never silently quiet)", normalizeNotificationsMode("Quiet"), "normal");
eq("legacy 'silent' → normal (not a mode we ship)", normalizeNotificationsMode("silent"), "normal");
eq("the two modes", NOTIFICATIONS_MODES, ["normal", "quiet"]);

const on = { ENABLE_NATIVE_NOTIFICATIONS: true, ENABLE_CONFLUENCE_BULLETINS: true };

// --- quiet blocks ALL notice types, whatever the flags say ---
for (const noticeType of [
  "seal_violation", "seal_created", "release_notification", "steward_override_release",
  "edit_access_request", "edit_access_approved", "approval", "validation", undefined,
]) {
  eq(`quiet blocks ${noticeType ?? "an untyped notice"} even with every flag on`,
    shouldPostComment({ mode: "quiet", flags: on, noticeType }), { post: false, reason: "quiet-mode" });
}

// --- normal respects the flags ---
eq("normal + master on → posts",
  shouldPostComment({ mode: "normal", flags: on, noticeType: "seal_created" }), { post: true, reason: null });
eq("normal + master off → mentions-off",
  shouldPostComment({ mode: "normal", flags: { ...on, ENABLE_NATIVE_NOTIFICATIONS: false } }),
  { post: false, reason: "mentions-off" });
eq("mode absent behaves as normal",
  shouldPostComment({ flags: on }), { post: true, reason: null });
eq("unknown mode behaves as normal",
  shouldPostComment({ mode: "loud", flags: on }), { post: true, reason: null });

// --- defaults are OFF for the comment channel (opt-in) ---
eq("DISPATCH_DEFAULTS: mentions off", DISPATCH_DEFAULTS.ENABLE_NATIVE_NOTIFICATIONS, false);
eq("DISPATCH_DEFAULTS: violation comment off", DISPATCH_DEFAULTS.ENABLE_CONFLUENCE_BULLETINS, false);
eq("DISPATCH_DEFAULTS: toasts stay on (in-app)", DISPATCH_DEFAULTS.ENABLE_TOAST_DISPATCHES, true);
eq("DISPATCH_DEFAULTS: ribbons stay on (in-app)", DISPATCH_DEFAULTS.ENABLE_PAGE_BANNERS, true);
eq("defaults do not post", shouldPostComment({ mode: "normal", flags: DISPATCH_DEFAULTS }), { post: false, reason: "mentions-off" });
eq("no flags at all do not post", shouldPostComment({ mode: "normal" }), { post: false, reason: "mentions-off" });
eq("empty flags do not post", shouldPostComment({ mode: "normal", flags: {} }), { post: false, reason: "mentions-off" });
eq("no args at all do not post", shouldPostComment(), { post: false, reason: "mentions-off" });

// --- an explicit true is honoured; only a real boolean true counts ---
eq("explicit true posts", shouldPostComment({ mode: "normal", flags: { ENABLE_NATIVE_NOTIFICATIONS: true } }), { post: true, reason: null });
eq("string 'true' does not post (no coercion)",
  shouldPostComment({ mode: "normal", flags: { ENABLE_NATIVE_NOTIFICATIONS: "true" } }), { post: false, reason: "mentions-off" });
eq("1 does not post (no coercion)",
  shouldPostComment({ mode: "normal", flags: { ENABLE_NATIVE_NOTIFICATIONS: 1 } }), { post: false, reason: "mentions-off" });

// --- the violation-only gate is NOT the master: a tenant that saved it off keeps its other notices ---
eq("bulletins off + master on still posts (the violation gate lives at its own callers)",
  shouldPostComment({ mode: "normal", flags: { ENABLE_NATIVE_NOTIFICATIONS: true, ENABLE_CONFLUENCE_BULLETINS: false } }),
  { post: true, reason: null });


// --- The ONE carve-out (2026-09-17): the editor whose published change was undone is told, even
// on a site that never opted into comments. Its own switch; a quiet space still wins. ---
const OFF = { ENABLE_NATIVE_NOTIFICATIONS: false, ENABLE_CONFLUENCE_BULLETINS: false };
eq("editor-revert: default profile (master OFF, its switch ON) → posts",
  shouldPostComment({ mode: "normal", flags: { ...DISPATCH_DEFAULTS }, noticeType: NOTICE_EDITOR_REVERT }), { post: true, reason: null });
eq("editor-revert: its switch OFF → not posted, with its own reason",
  shouldPostComment({ mode: "normal", flags: { ...OFF, NOTIFY_EDITOR_ON_REVERT: false }, noticeType: NOTICE_EDITOR_REVERT }), { post: false, reason: "editor-revert-off" });
eq("editor-revert: the master being ON does not override its own switch OFF",
  shouldPostComment({ mode: "normal", flags: { ENABLE_NATIVE_NOTIFICATIONS: true, NOTIFY_EDITOR_ON_REVERT: false }, noticeType: NOTICE_EDITOR_REVERT }), { post: false, reason: "editor-revert-off" });
eq("editor-revert: a quiet space stays quiet",
  shouldPostComment({ mode: "quiet", flags: { ...DISPATCH_DEFAULTS }, noticeType: NOTICE_EDITOR_REVERT }), { post: false, reason: "quiet-mode" });
eq("editor-revert: absent flags → not posted (fail closed on a malformed flags object)",
  shouldPostComment({ mode: "normal", flags: undefined, noticeType: NOTICE_EDITOR_REVERT }), { post: false, reason: "editor-revert-off" });
eq("the carve-out is for THAT type only: a violation notice still needs the master",
  shouldPostComment({ mode: "normal", flags: { ...DISPATCH_DEFAULTS }, noticeType: "seal_violation" }), { post: false, reason: "mentions-off" });
eq("the default profile has the editor notice ON", DISPATCH_DEFAULTS.NOTIFY_EDITOR_ON_REVERT, true);

report("notice-policy");
