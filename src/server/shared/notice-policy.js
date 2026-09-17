/**
 * Notice policy — the PURE decision behind "does this notice become a page comment?".
 *
 * No Forge imports on purpose: `test/notice-policy.test.mjs` runs this in plain node. The
 * KVS-reading wrappers live in `bulletin-flags.js`; the single enforcement point is
 * `postCommentWithMention` in `infra/outbound-notify.js`.
 *
 * Vocabulary (UX review 2026-09-14 §4): the app has NO egress and no email service. A "comment"
 * is a Confluence footer comment; the "@mention" inside it is what makes Confluence itself
 * notify (and, per the recipient's own preferences, email) the person. Nothing else leaves the
 * site. The comment channel has one global MASTER gate, OPT-IN since 4.7:
 *   - ENABLE_NATIVE_NOTIFICATIONS  — post comments that @mention people (every notice this app
 *                                     posts mentions someone, so this is the master for all of them)
 * a second, narrower global gate that only the violation footnote honours on top of the master
 * (ENABLE_CONFLUENCE_BULLETINS, checked by its own callers — unchanged here so a tenant that
 * saved it off but the master on keeps its approval / edit-request comments),
 * plus one per-space switch, `notificationsMode`, whose "quiet" value stops every comment in
 * that space regardless of the global flags. Toasts, ribbons and the activity trail are in-app
 * and are NOT governed here — quiet mode never touches them.
 */

// The ONE per-type carve-out (tester report 2026-09-17: "you save, 20 minutes later Sentinel
// deletes it and you never knew it would"). A person whose own published work was undone is
// told so even on a site that never opted into the comment channel — losing work silently is
// the worst outcome this app can produce. It has its own switch (`notifyEditorOnRevert`,
// ON by default) and still yields to a quiet space.
export const NOTICE_EDITOR_REVERT = "editor_revert";

export const NOTIFICATIONS_MODE_NORMAL = "normal";
export const NOTIFICATIONS_MODE_QUIET = "quiet";
export const NOTIFICATIONS_MODES = [NOTIFICATIONS_MODE_NORMAL, NOTIFICATIONS_MODE_QUIET];

/**
 * Coerce a stored / payload value to a valid mode. Anything unrecognised (absent, a typo, a
 * legacy value) is "normal": the default profile is loud-in-app, opt-in for comments, and an
 * unreadable or malformed setting must never silently swallow a genuine notice.
 */
export function normalizeNotificationsMode(raw) {
  return raw === NOTIFICATIONS_MODE_QUIET ? NOTIFICATIONS_MODE_QUIET : NOTIFICATIONS_MODE_NORMAL;
}

/**
 * Decide whether a notice of `noticeType` may be posted as a comment (+ @mention).
 *
 * @param {Object} args
 * @param {string} [args.mode]        - the space's notificationsMode ("normal" | "quiet"); anything else → normal
 * @param {Object} [args.flags]       - the resolved global toggles (resolveBulletinToggles output)
 * @param {string} [args.noticeType]  - informational; quiet blocks EVERY type, normal defers to the flags
 * @returns {{ post: boolean, reason: string|null }}
 *   `reason` is null when posting, otherwise a short machine-readable cause:
 *   "quiet-mode" | "mentions-off" | "editor-revert-off".
 */
export function shouldPostComment({ mode, flags, noticeType } = {}) {
  if (normalizeNotificationsMode(mode) === NOTIFICATIONS_MODE_QUIET) {
    return { post: false, reason: "quiet-mode" };
  }
  if (noticeType === NOTICE_EDITOR_REVERT) {
    return flags?.NOTIFY_EDITOR_ON_REVERT === true ? { post: true, reason: null } : { post: false, reason: "editor-revert-off" };
  }
  // Opt-in: only an explicit `true` opens the comment channel. `flags` comes from
  // resolveBulletinToggles, which already turns the persisted `enable*` keys into booleans, so an
  // absent or malformed flags object reads as "never opted in".
  if (flags?.ENABLE_NATIVE_NOTIFICATIONS !== true) {
    return { post: false, reason: "mentions-off" };
  }
  return { post: true, reason: null };
}
