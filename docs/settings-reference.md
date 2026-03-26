# Settings Reference

Complete reference for all configurable settings in Sentinel Vault. Settings are managed through two admin interfaces: the **Steward Console** (global) and the **Realm Console** (per-space).

## Steward Console (Global Settings)

Accessible at **Confluence administration > Apps > Sentinel Vault Admin**. Changes here apply site-wide.

Stored in Forge KVS under key: `admin-settings-global`

### General Tab

| Setting | Code Key | Type | Default | Description |
|---------|----------|------|---------|-------------|
| Default Seal Duration | `defaultSealDuration` | Integer (seconds, displayed as hours) | 24 hours | How long attachments stay sealed. Minimum 1 hour. Individual realms can override this. |
| Allow Steward Force-Unseal | `allowStewardOverride` | Boolean | Off | Allow stewards to unseal attachments sealed by other users. |
| Enable Seal Expiry Notifications | `autoUnsealEnabled` | Boolean | On | When on: users get expiry notifications and seals are released automatically. When off: seals persist past expiry (show "Overdue"), periodic reminders sent instead. |
| Allow Attachment Removal from Page | `allowArtifactDelete` | Boolean | Off | Users can delete unsealed attachments from the panel (moves to trash). Sealed attachments cannot be deleted. |
| Allow Attachment Restore from Page | `allowSealRestore` | Boolean | Off | Users and stewards can restore trashed attachments that still have seal data. |
| Allow Seal Cleanup from Page | `allowSealPurge` | Boolean | Off | Users and stewards can purge leftover seal entries for permanently deleted attachments. |
| Protect Sealed Attachments in Page Body | `enableContentProtection` | Boolean | On | Automatically undo page edits that remove sealed media embeds (images, file previews) from page content. |
| Auto-Insert Macro on Seal | `globalAutoInsertMacro` | Boolean | Off | Automatically insert the Sentinel Vault panel macro into the page when an attachment is sealed. Individual realms can disable this. |
| Replace Attachments Macro | `replaceAttachmentsMacro` | Boolean | Off | When inserting the panel, replace the built-in Confluence Attachments macro. Only visible when auto-insert is enabled. |
| Reminder Frequency | `reminderIntervalDays` | Integer (days) | 7 | How often to send periodic reminder emails. Only visible when expiry notifications are disabled. |

### Alerts Tab

| Setting | Code Key | Type | Default | Description |
|---------|----------|------|---------|-------------|
| Enable Pop-up Notifications | `enableFlashMessages` | Boolean | On | Show brief in-app popup notifications for seal/unseal actions and unauthorized access attempts. |
| Enable Page Status Banners | `enableDocRibbons` | Boolean | On | Display a status banner at the top of pages showing sealed attachment info and expiry countdowns. |
| Enable Page Comments | `enableConfluenceDispatches` | Boolean | On | Post Confluence comments when attachments are sealed, unsealed, or when unauthorized access is attempted. |
| Enable Email Notifications | `enableEmailDispatches` | Boolean | On | Master toggle for all email types. Must be on for any email sub-option to work. |
| Seal Confirmation Emails | `enableSealExpiryReminderEmail` | Boolean | On | Send confirmation email after sealing with duration and expiry details. Nested under email master toggle. |
| Seal Expiry Reminder Emails | `enableAutoUnsealDispatchEmail` | Boolean | On | Send reminder when a seal has expired. Nested under email master toggle. |
| Recurring Reminder Emails | `enablePeriodicReminderEmail` | Boolean | On | Send periodic reminders when expiry notifications are off. Frequency set by Reminder Frequency in General tab. Nested under email master toggle. |

## Realm Console (Space Settings)

Accessible at **Space settings > Apps > Sentinel Vault**. Changes apply to the specific space only. Steward-only tabs require steward role (space admin, delegated steward, or guild member).

Stored in Forge KVS under key: `admin-settings-space-{sanitizedRealmKey}`

### Access Control Tab (stewards only)

| Setting | Code Key | Type | Default | Description |
|---------|----------|------|---------|-------------|
| Realm Activation | `activation` | String | `"use-system-default"` | Toggle between "Active" and "Disabled". When disabled, Sentinel Vault features are inactive for the space. |
| Steward Users | `adminUsers` | Array | `[]` | Individual user accounts granted steward privileges in this space. |
| Steward Guilds | `adminGroups` | Array | `[]` | Confluence groups whose members receive steward privileges in this space. |

Pending steward access requests are managed through the Access Control tab UI but are not stored as policy settings.

### Reservation Duration Tab (stewards only)

| Setting | Code Key | Type | Default | Description |
|---------|----------|------|---------|-------------|
| Seal Duration Override | `autoUnlockTimeoutHours` | Integer (hours) or null | `null` (use system default) | Custom seal duration for this space. When null, inherits the global default from the steward console. |

### Macro Tab (stewards only)

| Setting | Code Key | Type | Default | Description |
|---------|----------|------|---------|-------------|
| Auto-Insert Macro | `autoInsertMacro` | Boolean | Inherits global | Enable auto-insertion of the Sentinel Vault panel macro when sealing. Only effective when the global `globalAutoInsertMacro` setting is also enabled. |
| Macro Position | `macroInsertPosition` | String | `"bottom"` | Where to insert the macro: `"top"` or `"bottom"` of the page. |

## Setting Inheritance

Settings follow a cascade from global to space level:

```
Baseline defaults (src/server/shared/baseline.js)
  → Global settings (steward console)
    → Realm settings (realm console, where applicable)
```

**What can be overridden at realm level:**
- Seal duration (Reservation Duration tab)
- Auto-insert macro behavior (Macro tab)
- Macro insert position (Macro tab)
- Realm activation state (Access Control tab)
- Steward delegation (Access Control tab)

**What cannot be overridden at realm level (global only):**
- All notification toggles (toast, banner, comment, email)
- Content protection toggle
- Delete/restore/purge permissions
- Steward force-unseal permission
- Replace Attachments Macro setting
- Reminder frequency

### Seal Duration Resolution

When determining effective seal duration, the system checks in order:
1. Realm policy `autoUnlockTimeoutHours` (if set and not null)
2. Global policy `defaultSealDuration`
3. Baseline constant `BASELINE_HOLD_SPAN` (48 hours / 172800 seconds)

### Auto-Insert Macro Resolution

Auto-insertion only occurs when **both** conditions are met:
1. Global `globalAutoInsertMacro` is enabled
2. Realm `autoInsertMacro` is not explicitly disabled

If the global toggle is off, no auto-insertion happens regardless of realm settings.

## Inline Panel Configuration

The macro configuration (panel-setup surface) stores settings in the Forge macro extension config, not in KVS. These are per-macro-instance settings:

| Setting | Type | Default | Options |
|---------|------|---------|---------|
| Column Visibility | Object | All visible | `name`, `status`, `sealOwner`, `labels`, `comment`, `actions`, `fileSize`, `fileType`, `expiresAt` |
| Rows Per Page | Integer | 15 | 5, 10, 15, 25 |
| Cards Per Row | Integer | 2 | 1, 2, 3 |
| Show Upload Zone | Boolean | On | Show/hide the file upload area |

## Overlay Column Preferences

The overlay stores column visibility preferences in the browser's `localStorage`, not in KVS. These persist per-browser and are independent of the inline panel macro configuration.
