# Notifications

Sentinel Vault uses four independent notification channels. Each can be enabled or disabled through the steward console (global settings).

## Channels

| Channel | Delivery | When It Fires |
|---|---|---|
| **Toast** | In-app popup (showFlag API) | Seal/unseal actions, immediate feedback |
| **Page banner** | Persistent bar on the Confluence page | Seal violations, expiry warnings, status changes |
| **Confluence comment** | Footer comment with user @mentions | Unauthorized edit detected, seal state changes |
| **Email** | External email via Resend API | Configurable per event type (see below) |

Toast and page banner notifications are handled entirely in the frontend. Confluence comments and emails are dispatched from the server.

## Feature Flags

All notification toggles are managed through the steward console UI. When no configuration exists, defaults from `src/server/shared/baseline.js` apply (all enabled).

At runtime, `src/server/shared/bulletin-flags.js` resolves the active configuration by reading the global settings from Forge KVS and falling back to defaults on error.

### Flag Reference

| Flag | Default | Scope |
|---|---|---|
| `enableToastNotifications` | on | All toast messages |
| `enablePageBanners` | on | All page banner alerts |
| `enableConfluenceNotifications` | on | All Confluence comments |
| `enableEmailNotifications` | on | Master toggle for all email types |
| `enableLockExpiryReminderEmail` | on | Halfway expiry reminder emails |
| `enableAutoUnlockNotificationEmail` | on | Auto-unseal notification emails |
| `enablePeriodicReminderEmail` | on | Periodic reminder emails |

The email master toggle (`enableEmailNotifications`) must be on for any individual email type to send. Individual email flags only apply when the master toggle is enabled.

## Email Notifications

### Types

| Email Type | Trigger | Recipients |
|---|---|---|
| **Seal confirmation** | User seals an attachment | Seal owner |
| **Violation alert** | Unauthorized edit detected and reverted | Seal owner and the editor |
| **Halfway reminder** | Seal reaches 50% of its duration | Seal owner |
| **Auto-unseal notice** | Seal expired and was automatically released | Seal owner |
| **Periodic reminder** | Daily check when auto-unseal is disabled | Seal owner |

### Resend Integration

Email delivery uses the [Resend](https://resend.com) API. Configuration:

1. Create a Resend account and obtain an API key
2. Set the key as a Forge environment variable:
   ```bash
   forge variables set RESEND_API_KEY <your-api-key>
   ```
3. Configure a verified sender domain in Resend

The mail system is implemented across three files in `src/server/infra/`:
- `mail-composer.js` -- Orchestrates email construction (fetches user profiles, selects template)
- `mail-blueprints.js` -- HTML email templates as functions
- `outbound-mail.js` -- Resend API client

If the API key is not set or email sending fails, the error is logged but does not affect other notification channels or core functionality.

## Scheduled Tasks

Three scheduled tasks generate notifications:

| Task | Interval | Notifications Sent |
|---|---|---|
| **Expiry sweep** | Hourly | Auto-unseal emails, halfway reminder emails |
| **Recurring nudge** | Daily | Periodic reminder emails (only when auto-unseal is disabled) |
| **Seal index cron** | Hourly | None directly (indexes seals for realm console queries) |

The expiry sweep scans all active seals, releases expired ones, and sends halfway reminders for seals past 50% of their duration. Deduplication keys in Forge KVS (`reminder-sent-*`, `fifty-percent-reminder-sent-*`) prevent duplicate emails.

## Notification Flow by Event

### Attachment Sealed
1. Toast notification (immediate, frontend)
2. Seal confirmation email (if enabled)

### Unauthorized Edit Detected
1. Automatic reversion of the file
2. Confluence comment with @mentions (seal owner + editor)
3. Violation alert email (seal owner + editor)
4. Page banner alert stored for next page view

### Seal Expired
1. Auto-unseal email (if auto-unseal enabled)
2. Page banner updated

### Seal Approaching Expiry
1. Halfway reminder email (at 50% of seal duration)
