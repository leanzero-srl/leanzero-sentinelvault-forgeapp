# Notifications

Sentinel Vault uses five independent notification channels. Each can be enabled or disabled through the steward console (global settings).

## Channels

| Channel | Delivery | When It Fires |
|---|---|---|
| **Toast** | In-app popup via `showFlag` API | Seal/unseal actions, immediate feedback, violation alerts |
| **Page banner** | Persistent bar on the Confluence page | Seal violations, expiry warnings, status changes, seal counts |
| **Confluence comment** | Footer comment with user @mentions | Unauthorized edit detected, seal state changes |
| **Email** | External email via Resend API | Configurable per event type (8 email types, see below) |
| **Watch** | Email to watchers | Seal released (manual, expiry, or steward override) |

Toast and page banner notifications are handled in the frontend. Confluence comments, emails, and watch notifications are dispatched from the server.

## Feature Flags

All notification toggles are managed through the steward console UI (Alerts tab). When no configuration exists, defaults from `src/server/shared/baseline.js` apply (all enabled).

At runtime, `src/server/shared/bulletin-flags.js` resolves the active configuration by reading the global settings from Forge KVS and falling back to defaults on error.

### Flag Reference

| UI Setting | Code Constant | Default | Scope |
|---|---|---|---|
| Enable Pop-up Notifications | `ENABLE_TOAST_DISPATCHES` | On | All toast messages |
| Enable Page Status Banners | `ENABLE_PAGE_BANNERS` | On | All page banner alerts |
| Enable Page Comments | `ENABLE_CONFLUENCE_BULLETINS` | On | All Confluence comments |
| Enable Email Notifications | `ENABLE_EMAIL_BULLETINS` | On | Master toggle for all email types |
| Seal Confirmation Emails | `ENABLE_SEAL_EXPIRY_REMINDER_EMAIL` | On | Seal confirmation and halfway reminder emails |
| Seal Expiry Reminder Emails | `ENABLE_AUTO_UNSEAL_BULLETIN_EMAIL` | On | Auto-unseal and expiry notification emails |
| Recurring Reminder Emails | `ENABLE_PERIODIC_REMINDER_EMAIL` | On | Periodic reminder emails |

The email master toggle (`ENABLE_EMAIL_BULLETINS`) must be on for any individual email type to send. Individual email flags only apply when the master toggle is enabled.

### Settings-to-Code Mapping

The steward console stores settings with camelCase keys. `bulletin-flags.js` maps them to SCREAMING_SNAKE_CASE constants:

| Setting Key | Code Constant |
|---|---|
| `enableFlashMessages` | `ENABLE_TOAST_DISPATCHES` |
| `enableDocRibbons` | `ENABLE_PAGE_BANNERS` |
| `enableConfluenceDispatches` | `ENABLE_CONFLUENCE_BULLETINS` |
| `enableEmailDispatches` | `ENABLE_EMAIL_BULLETINS` |
| `enableSealExpiryReminderEmail` | `ENABLE_SEAL_EXPIRY_REMINDER_EMAIL` |
| `enableAutoUnsealDispatchEmail` | `ENABLE_AUTO_UNSEAL_BULLETIN_EMAIL` |
| `enablePeriodicReminderEmail` | `ENABLE_PERIODIC_REMINDER_EMAIL` |

## Email Notifications

### Types

All emails are sent through the centralized `composeMail()` function in `src/server/infra/mail-composer.js`, which selects a template from `mail-blueprints.js` based on the alert category.

| Email Type | Category Constant | Trigger | Recipients |
|---|---|---|---|
| **Seal confirmation** | `SEAL_CREATED` | User seals an attachment | Seal owner |
| **Violation alert** | `SEAL_VIOLATION` | Unauthorized edit/trash/deletion detected and reverted | Seal owner (and editor info included) |
| **Halfway reminder** | `FIFTY_PERCENT_REMINDER` | Seal reaches 50% of its duration | Seal owner |
| **Expiry notification** | `EXPIRY_NOTIFICATION` | Seal has expired, action required | Seal owner |
| **Auto-release notice** | `AUTO_RELEASE` | Seal expired and was automatically released | Seal owner |
| **Periodic reminder** | `PERIODIC_REMINDER` | Daily check when expiry notifications are disabled | Seal owner |
| **Release notification** | `RELEASE_NOTIFICATION` | Seal manually released by owner | Watchers |
| **Steward override** | `STEWARD_OVERRIDE_RELEASE` | Steward force-unseals another user's attachment | Seal owner |

### Resend Integration

Email delivery uses the [Resend](https://resend.com) API. Configuration:

1. Create a Resend account and obtain an API key
2. Set the key as a Forge environment variable:
   ```bash
   forge variables set RESEND_API_KEY <your-api-key>
   ```
3. Configure a verified sender domain in Resend

Emails are sent from `noreply@leanzero.atlascrafted.com`.

The mail system is implemented across three files in `src/server/infra/`:
- **mail-composer.js** -- Orchestrates email construction (fetches user profiles and artifact URLs in parallel, selects template, dispatches)
- **mail-blueprints.js** -- HTML email templates as functions returning markup
- **outbound-mail.js** -- Resend API client with retry logic

### Retry Behavior

The `transmitMail()` function in `outbound-mail.js` retries on rate limit errors:
- Maximum 3 retries
- Exponential backoff: 600ms → 1.2s → 2.4s (capped at 5s)
- Rate limit errors are detected by inspecting the error message

### Email Template Design

All email templates share a consistent design:
- Dark hero header with LeanZero branding
- Color-coded status banners (teal for success, red for violations)
- Timeline layout with event details
- Action pills with links to the affected page and attachment
- Responsive HTML layout

If the Resend API key is not set or email sending fails, the error is logged but does not affect other notification channels or core functionality. If a user has no email address on file, the fallback sender address is used as recipient.

## Watch Notifications

Users can watch attachments sealed by other users to be notified when the seal is released.

### How It Works

1. User clicks **Watch** on a sealed attachment (available in inline panel, overlay, and realm console)
2. A watch request is stored in KVS as `notify-request-{artifactId}-{accountId}`
3. When the seal is released (manually, by expiry, or by steward override):
   - The `notifyWatchers()` function in `bulletins/logic.js` queries all `notify-request-{artifactId}-*` keys
   - Sends a release notification email to each watcher
   - Cleans up the watch request keys
4. User can click **Watching** to unwatch and remove their notification request

## Scheduled Tasks

Three scheduled tasks generate notifications:

| Task | Interval | Notifications Sent |
|---|---|---|
| **Expiry sweep** | Hourly | Expiry notification emails, auto-release emails, halfway reminder emails |
| **Recurring nudge** | Daily | Periodic reminder emails (only when expiry notifications are disabled) |
| **Seal index cron** | Hourly | None directly (indexes seals for realm console queries) |

The expiry sweep scans all active seals, sends expiry emails for expired seals, releases expired ones (when expiry notifications enabled), and sends halfway reminders for seals past 50% of their duration.

### Deduplication

To prevent duplicate emails across scheduled task runs, the following KVS keys are used:

| Key Pattern | Purpose | Set By |
|---|---|---|
| `expiry-notified-{artifactId}` | Prevents duplicate expiry/auto-release emails | Expiry sweep |
| `fifty-percent-reminder-sent-{artifactId}` | Prevents duplicate halfway reminder emails | Expiry sweep |
| `reminder-sent-{artifactId}` | Tracks periodic nudge schedule (stores timestamp) | Recurring nudge |

The recurring nudge checks the `reminder-sent-*` timestamp against the configured `reminderIntervalDays` (default 7) to determine if enough time has passed since the last reminder.

## Notification Flow by Event

### Attachment Sealed
1. Toast notification (immediate, frontend)
2. Seal confirmation email (if enabled)

### Unauthorized Edit Detected
1. Automatic reversion of the file
2. Confluence comment with @mentions (seal owner + editor)
3. Violation alert email (seal owner)
4. Page banner alert stored for next page view

### Sealed Attachment Trashed
1. Automatic restoration from trash
2. Confluence comment with @mentions
3. Violation alert email (seal owner)
4. Page banner alert stored

### Sealed Attachment Permanently Deleted
1. Seal records cleaned up (KVS, content property, realm index)
2. Violation alert email (seal owner)

### Sealed Media Embed Removed from Page
1. Surgical re-insertion of the embed at its original position
2. Violation alert email (seal owner)

### Seal Expired
1. Expiry notification email (seal owner)
2. If expiry notifications enabled: auto-release email, seal released
3. Page banner updated

### Seal Approaching Expiry
1. Halfway reminder email at 50% of seal duration (seal owner)

### Seal Manually Released
1. Release notification email (watchers)
2. Toast notification (immediate, frontend)
3. Page banner updated

### Steward Force-Unseal
1. Steward override email (seal owner)
2. Release notification email (watchers)
3. Page banner updated

## Notification Storage Keys

Dispatch events for page banners and toasts use short-lived KVS keys:

| Key Pattern | TTL | Purpose |
|---|---|---|
| `notification-{timestamp}-{random}` | 5 minutes | Individual toast dispatch events |
| `recent-notifications` | 1 hour | Aggregated dispatch events for page banner display |
| `violation-alert-{ownerAccountId}-{artifactId}-{timestamp}` | 1 hour | Violation toast notifications for seal owners |
