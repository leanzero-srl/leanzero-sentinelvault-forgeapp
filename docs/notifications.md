# Notifications

Current as of production 6.4.0.

Sentinel Vault tells people what happened in three ways: in-app pop-ups, the page ribbon (banner) and Confluence page comments that @mention the people involved. The app sends no email of its own and has no egress; when a comment mentions someone, Confluence's own notification engine may email them according to their personal preferences. That keeps the app eligible for **Runs on Atlassian**.

## Defaults at a glance

Page comments are **opt-in**. On a site that never saved its settings, pop-ups and the ribbon work, the editor whose change was undone is told, and no other comment is posted until a site admin turns on **Page comments that mention people**.

| Site setting (Settings tab → Alerts) | KVS key (`admin-settings-global`) | Code flag (`bulletin-flags.js`) | Default |
|---|---|---|---|
| Pop-up messages | `enableFlashMessages` | `ENABLE_TOAST_DISPATCHES` | On |
| Page ribbon | `enableDocRibbons` | `ENABLE_PAGE_BANNERS` | On |
| Tell editors when their change is undone | `notifyEditorOnRevert` | `NOTIFY_EDITOR_ON_REVERT` | On (independent of the master switch) |
| Page comments that mention people (master) | `enableEmailDispatches` | `ENABLE_NATIVE_NOTIFICATIONS` | **Off** |
| Violation comments (under the master) | `enableConfluenceDispatches` | `ENABLE_CONFLUENCE_BULLETINS` | **Off** |
| Seal confirmation and halfway notice (under the master) | `enableSealExpiryReminderEmail` | `ENABLE_HALFWAY_REMINDER_NOTICE` | On |
| Expiry and release notices (under the master) | `enableAutoUnsealDispatchEmail` | `ENABLE_EXPIRY_NOTICE` | On |
| Recurring reminder banner (Expiry group; only when seals never expire) | `enablePeriodicReminderEmail` | `ENABLE_PERIODIC_REMINDER_BANNER` | On |

Defaults live once in `DISPATCH_DEFAULTS` / `POLICY_DEFAULTS` (`src/server/shared/baseline.js`); labels in `src/server/capsules/policies/settings-schema.js`. The word "email" in some KVS keys is historical — the keys were kept so existing installs keep their values.

### One choke point for every comment

`shouldPostComment` in `src/server/shared/notice-policy.js` decides every comment:

1. A space in **Quiet** mode (space console → Access Control → Notifications, `notificationsMode: "quiet"`) posts no comment and mentions nobody — any type, including the editor notice. Pop-ups, the ribbon and the activity trail still work.
2. The editor-revert notice follows `notifyEditorOnRevert` only.
3. Every other comment needs the master switch `enableEmailDispatches` to be on.

## Comment types

Built in `src/server/infra/notice-composer.js` (`ALERT_CATEGORIES`) and posted by `outbound-notify.js` to `/wiki/api/v2/footer-comments` as the app.

| Notice | Fires when | Mentions | Needs |
|---|---|---|---|
| Seal confirmation | A seal is created | Owner | Master + confirmation/halfway |
| Halfway notice | A seal reaches 50% of its duration | Owner | Master + confirmation/halfway |
| Expiry / overdue reminder | A seal lapses, then each overdue reminder | Owner | Master + expiry/release |
| Auto-release notice | The seal is released after the last overdue reminder | Owner | Master + expiry/release |
| Violation comment | Someone tampers with a sealed attachment or section and it is undone (deduped per page and target) | Owner and editor | Master + violation comments |
| Your change was undone | Same event, when the violation comment is not posted | The editor (with a link to the version holding their change) | `notifyEditorOnRevert` |
| Release notice | A seal is released (by owner, expiry or force release) | Everyone watching it | Master |
| Force release notice | A space admin force-releases someone's seal | Owner and the space admin | Master |
| Edit request / approved / declined | Edit-request lifecycle on a sealed file or section | Owner or requester | Master |
| Approval requested / resolved | Page workflow approvals | Approvers / requester | Master |
| Validation advisory | A page fails a validation rule in advisory mode | Page author | Master (see validations) |

`PERIODIC_REMINDER` is a banner, never a comment (`recurringNudgeTask`).

### Retry behaviour

`postCommentWithMention()` retries on 429, 5xx and network errors: at most 3 attempts in total (so up to 2 retries), exponential backoff from 600 ms, capped at 5 s.

## Watching a seal

1. **Watch** on a file sealed by someone else stores `notify-request-{attachmentId}-{accountId}` in KVS (7-day TTL).
2. When the seal is released, `notifyWatchers()` (`bulletins/logic.js`) posts one release comment mentioning the watchers, then the watch keys are swept.
3. Watch notices are comments, so they need the master switch; with it off, nothing is posted.

## Seal expiry, reminders and release

The hourly expiry sweep (`expirySweepTask`) handles attachment seals and section seals alike:

- At 50% of the duration: the halfway notice.
- When "Seals expire" (`autoUnlockEnabled`, default on) is on and a seal lapses: an overdue reminder, repeated every **Hours between overdue reminders** (default 24) up to **Overdue reminders before release** (default 3), then the seal is released and the owner gets the auto-release notice. 0 reminders reminds once and holds the seal.
- When "Seals expire" is off: seals never expire, and the daily recurring nudge shows the owner a ribbon banner every **Reminder Frequency** days (default 7). No comment.

Dedup keys: `expiry-notified-{id}` and `fifty-percent-reminder-sent-{id}` (expiry sweep), `reminder-sent-{id}` (recurring nudge).

## Short-lived dispatch keys (pop-ups and ribbon)

| Key | TTL | Purpose |
|---|---|---|
| `notification-{timestamp}-{random}` | 5 minutes | One pop-up dispatch |
| `recent-notifications` | 1 hour | Recent dispatches for the ribbon |
| `violation-alert-{ownerAccountId}-{attachmentId}-{timestamp}` | 1 hour | Violation pop-up for the seal owner |
