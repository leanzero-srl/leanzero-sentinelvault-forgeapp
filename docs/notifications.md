# Notifications

Sentinel Vault uses four independent notification channels. Each can be enabled or disabled through the steward console (global settings).

## Channels

| Channel | Delivery | When It Fires |
|---|---|---|
| **Toast** | In-app popup via `showFlag` API | Seal/unseal actions, immediate feedback, violation alerts |
| **Page banner** | Persistent bar on the Confluence page | Seal violations, expiry warnings, status changes, seal counts |
| **Confluence comment** | Footer comment with `@mention` of the recipient | Lifecycle events (seal/violation/expiry/release) — Confluence's notification engine emails the mentioned user |
| **Watch** | Comment with `@mention` of each watcher | Seal released (manual, expiry, or steward override) |

Toast and page banner notifications are handled in the frontend. Confluence comments and watch notifications are dispatched from the server.

There is no external email egress. The app qualifies for the **"Runs on Atlassian"** badge: every notification is either rendered in-product or routed through Confluence's own notification engine via comment mentions.

## Feature Flags

All notification toggles are managed through the steward console UI (Alerts tab). When no configuration exists, defaults from `src/server/shared/baseline.js` apply (all enabled).

At runtime, `src/server/shared/bulletin-flags.js` resolves the active configuration by reading the global settings from Forge KVS and falling back to defaults on error.

### Flag Reference

| UI Setting | Code Constant | Default | Scope |
|---|---|---|---|
| Enable Pop-up Notifications | `ENABLE_TOAST_DISPATCHES` | On | All toast messages |
| Enable Page Status Banners | `ENABLE_PAGE_BANNERS` | On | All page banner alerts |
| Enable Page Comments | `ENABLE_CONFLUENCE_BULLETINS` | On | Footer comments authored by the app |
| Enable Native Notifications | `ENABLE_NATIVE_NOTIFICATIONS` | On | Master toggle for comment-with-mention notices |
| Seal Confirmation & Halfway Reminder Notices | `ENABLE_HALFWAY_REMINDER_NOTICE` | On | Seal-created comment, 50% reminder comment |
| Seal Expiry Notices | `ENABLE_EXPIRY_NOTICE` | On | Auto-release / expiry comment |
| Recurring Reminder Banners | `ENABLE_PERIODIC_REMINDER_BANNER` | On | Periodic banner for long-held seals (banner-only, no comment) |

The native-notifications master toggle (`ENABLE_NATIVE_NOTIFICATIONS`) must be on for any individual comment-mention notice to be posted. Individual flags only apply when the master toggle is enabled.

### Settings-to-Code Mapping

The steward console stores settings with camelCase keys under `admin-settings-global` in KVS. The KVS key names are unchanged from earlier versions (when the channel was email) so existing installations keep their values; `bulletin-flags.js` maps them to the current code constants:

| KVS Setting Key | Code Constant |
|---|---|
| `enableFlashMessages` | `ENABLE_TOAST_DISPATCHES` |
| `enableDocRibbons` | `ENABLE_PAGE_BANNERS` |
| `enableConfluenceDispatches` | `ENABLE_CONFLUENCE_BULLETINS` |
| `enableEmailDispatches` | `ENABLE_NATIVE_NOTIFICATIONS` |
| `enableSealExpiryReminderEmail` | `ENABLE_HALFWAY_REMINDER_NOTICE` |
| `enableAutoUnsealDispatchEmail` | `ENABLE_EXPIRY_NOTICE` |
| `enablePeriodicReminderEmail` | `ENABLE_PERIODIC_REMINDER_BANNER` |

## Comment-with-Mention Notifications

### Types

All comments are posted through the centralized `dispatchNotice()` function in `src/server/infra/notice-composer.js`, which selects a body builder from `notice-blueprints.js` based on the alert category.

| Notice Type | Category Constant | Trigger | Recipients |
|---|---|---|---|
| **Seal confirmation** | `SEAL_CREATED` | User seals an attachment | Seal owner |
| **Violation alert** | `SEAL_VIOLATION` | Unauthorized edit/trash/deletion detected and reverted | Seal owner (and editor mentioned) |
| **Halfway reminder** | `FIFTY_PERCENT_REMINDER` | Seal reaches 50% of its duration | Seal owner |
| **Expiry notification** | `EXPIRY_NOTIFICATION` | Seal has expired, action required | Seal owner |
| **Auto-release notice** | `AUTO_RELEASE` | Seal expired and was automatically released | Seal owner |
| **Release notification** | `RELEASE_NOTIFICATION` | Seal manually released by owner | Watchers |
| **Steward override** | `STEWARD_OVERRIDE_RELEASE` | Steward force-unseals another user's attachment | Seal owner (steward also mentioned) |

`PERIODIC_REMINDER` exists as a category but is not used as a comment — periodic reminders are delivered via the page banner only (see `recurringNudgeTask` in `triggers.js`).

### How Mentions Trigger Emails

The body builders emit Confluence storage XML containing `<ac:link><ri:user ri:account-id="..."/></ac:link>` mention tags. When Confluence receives the comment, its built-in notification engine emails the mentioned user — subject to the user's personal notification preferences (Confluence settings → Personal settings → Email notifications). This means:

- Users who have disabled mention emails won't receive an email. The app's page banner still surfaces the alert in-product.
- A watcher who lacks read access to the page won't receive the mention email (Confluence enforces page-level visibility on notifications).

### Module Layout

The notification system lives in `src/server/infra/`:
- **notice-composer.js** -- Centralized orchestration. `dispatchNotice(type, data)` resolves the recipient's display name, builds a storage-format comment body, and posts it.
- **notice-blueprints.js** -- Storage XML body builders, one per notification type.
- **outbound-notify.js** -- POSTs the comment to `/wiki/api/v2/footer-comments` via `asApp().requestConfluence()`. Includes retry/backoff for 429 / 5xx responses.

### Retry Behavior

The `postCommentWithMention()` function in `outbound-notify.js` retries on 429 and 5xx responses:
- Maximum 3 retries
- Exponential backoff: 600ms → 1.2s → 2.4s (capped at 5s)

## Watch Notifications

Users can watch attachments sealed by other users to be notified when the seal is released.

### How It Works

1. User clicks **Watch** on a sealed attachment (available in inline panel, overlay, and realm console)
2. A watch request is stored in KVS as `notify-request-{artifactId}-{accountId}`
3. When the seal is released (manually, by expiry, or by steward override):
   - The `notifyWatchers()` function in `bulletins/logic.js` queries all `notify-request-{artifactId}-*` keys
   - Posts a release-notice comment that mentions each watcher
   - Cleans up the watch request keys
4. User can click **Watching** to unwatch and remove their notification request

## Scheduled Tasks

Three scheduled tasks generate notifications:

| Task | Interval | Notifications Sent |
|---|---|---|
| **Expiry sweep** | Hourly | Expiry comments, halfway reminder comments, page banners |
| **Recurring nudge** | Daily | Periodic reminder banners (no comment) — fires only when auto-unseal is disabled |
| **Seal index cron** | Hourly | None directly (indexes seals for realm console queries) |

The expiry sweep scans all active seals, posts expiry comments for expired seals, and posts halfway reminders for seals past 50% of their duration.

### Deduplication

To prevent duplicate notifications across scheduled task runs, the following KVS keys are used:

| Key Pattern | Purpose | Set By |
|---|---|---|
| `expiry-notified-{artifactId}` | Prevents duplicate expiry comments | Expiry sweep |
| `fifty-percent-reminder-sent-{artifactId}` | Prevents duplicate halfway reminder comments | Expiry sweep |
| `reminder-sent-{artifactId}` | Tracks periodic nudge schedule (stores timestamp) | Recurring nudge |

The recurring nudge checks the `reminder-sent-*` timestamp against the configured `reminderIntervalDays` (default 7) to determine if enough time has passed since the last reminder.

## Notification Flow by Event

### Attachment Sealed
1. Toast notification (immediate, frontend)
2. Seal confirmation comment with `@owner` mention

### Unauthorized Edit Detected
1. Automatic reversion of the file
2. Footer comment with `@owner` and `@editor` mentions (Confluence emails the owner)
3. Page banner alert stored for next page view

### Sealed Attachment Trashed
1. Automatic restoration from trash
2. Footer comment with mentions
3. Page banner alert stored

### Sealed Attachment Permanently Deleted
1. Seal records cleaned up (KVS, content property, realm index)
2. Footer comment with mentions

### Sealed Media Embed Removed from Page
1. Surgical re-insertion of the embed at its original position
2. Footer comment with mentions

### Seal Expired
1. Expiry comment with `@owner` mention
2. If auto-unseal enabled: seal released, banner updated

### Seal Approaching Expiry
1. Halfway reminder comment with `@owner` mention at 50% of seal duration

### Seal Manually Released
1. Release notification comment with `@watcher` mention(s)
2. Toast notification (immediate, frontend)
3. Page banner updated

### Steward Force-Unseal
1. Steward override comment mentioning both the original owner and the steward
2. Release notification comment to watchers
3. Page banner updated

## Notification Storage Keys

Dispatch events for page banners and toasts use short-lived KVS keys:

| Key Pattern | TTL | Purpose |
|---|---|---|
| `notification-{timestamp}-{random}` | 5 minutes | Individual toast dispatch events |
| `recent-notifications` | 1 hour | Aggregated dispatch events for page banner display |
| `violation-alert-{ownerAccountId}-{artifactId}-{timestamp}` | 1 hour | Violation toast notifications for seal owners |
