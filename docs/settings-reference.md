# Settings Reference

Complete reference for all configurable settings in Sentinel Vault. Settings are managed through two admin interfaces: the **Site settings** (global) and the **Space console** (per-space).

## Site settings (global)

Accessible at **Confluence administration > Apps > Sentinel Vault Admin**. Changes here apply site-wide.

Stored in Forge KVS under key: `admin-settings-global`

### General Tab

| Setting | Code Key | Type | Default | Description |
|---------|----------|------|---------|-------------|
| Default Seal Duration | `defaultSealDuration` | Integer (seconds, displayed as hours) | 24 hours | How long attachments stay sealed. Minimum 1 hour. Individual spaces can override this. |
| Allow space admins to force-unseal | `allowStewardOverride` | Boolean | Off | Allow space admins to unseal attachments sealed by other users. |
| Enable Seal Expiry Notifications | `autoUnsealEnabled` | Boolean | On | When on: users get expiry notifications and seals are released automatically. When off: seals persist past expiry (show "Overdue"), periodic reminders sent instead. |
| Allow Attachment Removal from Page | `allowArtifactDelete` | Boolean | Off | Users can delete unsealed attachments from the panel (moves to trash). Sealed attachments cannot be deleted. |
| Allow Attachment Restore from Page | `allowSealRestore` | Boolean | Off | Users and space admins can restore trashed attachments that still have seal data. |
| Allow Seal Cleanup from Page | `allowSealPurge` | Boolean | Off | Users and space admins can purge leftover seal entries for permanently deleted attachments. |
| Protect Sealed Attachments in Page Body | `enableContentProtection` | Boolean | On | Automatically undo page edits that remove sealed media embeds (images, file previews) from page content. |
| Auto-Insert Macro on Seal | `globalAutoInsertMacro` | Boolean | Off | Automatically insert the Sentinel Vault panel macro into the page when an attachment is sealed. Individual spaces can disable this. |
| Replace Attachments Macro | `replaceAttachmentsMacro` | Boolean | Off | When inserting the panel, replace the built-in Confluence Attachments macro. Only visible when auto-insert is enabled. |
| Reminder Frequency | `reminderIntervalDays` | Integer (days) | 7 | How often to record a periodic reminder banner. Only visible when expiry notifications are disabled. |

### Alerts Tab

| Setting | Code Key | Type | Default | Description |
|---------|----------|------|---------|-------------|
| Enable Pop-up Notifications | `enableFlashMessages` | Boolean | On | Show brief in-app popup notifications for seal/unseal actions and unauthorized access attempts. |
| Enable Page Status Banners | `enableDocRibbons` | Boolean | On | Display a status banner at the top of pages showing sealed attachment info and expiry countdowns. |
| Enable Page Comments | `enableConfluenceDispatches` | Boolean | On | Post Confluence comments when attachments are sealed, unsealed, or when unauthorized access is attempted. |
| Tell editors when their change is undone | `notifyEditorOnRevert` | Boolean | On | When Sentinel Vault reverts someone's edit to sealed content, that person gets a page comment addressed to them, with a link to the page version that still holds their text. Independent of the comments master switch; a space in quiet mode stays quiet. |
| Sign seal actions with an authenticator code | `signSealActions` | Boolean | Off | With this on, releasing or extending a seal and approving, declining, giving or revoking edit access all ask for the current code from the authenticator device set up on My work. A person without a device is refused until they set one up. The same registry gate covers every one of those actions. |
| Hours before a declined edit request can be repeated | `editRequestCooldownHours` | Integer 0–168 | 1 | After an owner declines an edit request, the same person waits this long before asking again (0 = no wait). The seal owner or a space admin can give edit access directly at any time ("Give edit access…" under the row's ⋯ menu). |

### Classification group (CLS-1, 2026-09-20)

| Setting | Code Key | Type | Default | Description |
|---------|----------|------|---------|-------------|
| Classification levels | `classificationEnabled` | Boolean (opt-in: only `true` is on) | **Off** | The master switch for classification. On: pages carry a level in the byline chip, the ribbon's left block and the page-details modal; a space can set a default level; `classify-page` works. Off (the never-saved default): no surface mentions classification — the chip reads the seal count or "Sentinel Vault", the ribbon's left block is the app's name, the modal has no Classification section, `classification-set-page` / `classification-set-space-default` answer `Classification is off on this site`, the Ribbon / Ribbon threshold controls are hidden, and the Classification tab dims its sections behind an "off" banner. Stored levels, space defaults and page overrides are **kept** and show again unchanged when turned on. Existing installs that never saved the key are OFF after the upgrade (owner decision 2026-09-19). Confluence's own classification, where the site has it, is untouched either way. Setup question 3 writes this key. |
| Enable Native Notifications | `enableEmailDispatches` | Boolean | On | Master toggle for all comment-with-mention notices. Confluence's notification engine emails the mentioned user according to their personal preferences. The KVS key is preserved from the previous email-based release for backwards compatibility. Must be on for any sub-option below to work. |
| Seal Confirmation & Halfway Reminder Notices | `enableSealExpiryReminderEmail` | Boolean | On | Post a comment that mentions the seal owner when a seal is created and at the seal's midpoint. KVS key preserved for backwards compatibility. Nested under master toggle. |
| Seal Expiry Notices | `enableAutoUnsealDispatchEmail` | Boolean | On | Post a comment that mentions the seal owner when a seal has expired. KVS key preserved for backwards compatibility. Nested under master toggle. |
| Recurring Reminder Banners | `enablePeriodicReminderEmail` | Boolean | On | Show recurring banners for long-held seals when auto-unseal is disabled. Banner-only — no comment is posted, to avoid page clutter. Frequency set by Reminder Frequency in General tab. KVS key preserved for backwards compatibility. Nested under master toggle. |

## Space console (space settings)

Accessible at **Space settings > Apps > Sentinel Vault**. Changes apply to the specific space only. Space admin-only tabs require space admin role (space admin, delegated space admin, or group member).

Stored in Forge KVS under key: `admin-settings-space-{sanitizedRealmKey}`

### Access Control Tab (space admins only)

| Setting | Code Key | Type | Default | Description |
|---------|----------|------|---------|-------------|
| Space Activation | `activation` | String | `"use-system-default"` | Toggle between "Active" and "Disabled". When disabled, Sentinel Vault features are inactive for the space. |
| Admin users | `adminUsers` | Array | `[]` | Individual user accounts granted space admin privileges in this space. |
| Admin groups | `adminGroups` | Array | `[]` | Confluence groups whose members receive space admin privileges in this space. |

| Classification in this space | `classification` | `"inherit"` \| `"off"` | `"inherit"` | `off` hides every classification level on this space's pages (chip, ribbon, modal) and refuses `classify-page` with `Classification is off in this space`; stored levels are kept. A space cannot turn classification ON while the site has `classificationEnabled` off — the card is locked with "Off site-wide by a site admin (Classification levels)." (the same AND rule as the auto-insert macro). |

Pending space admin access requests are managed through the Access Control tab UI but are not stored as policy settings.

### Seal Duration Tab (space admins only)

| Setting | Code Key | Type | Default | Description |
|---------|----------|------|---------|-------------|
| Seal Duration Override | `autoUnlockTimeoutHours` | Integer (hours) or null | `null` (use system default) | Custom seal duration for this space. When null, inherits the global default from the site settings console. |

### Macro Tab (space admins only)

| Setting | Code Key | Type | Default | Description |
|---------|----------|------|---------|-------------|
| Auto-Insert Macro | `autoInsertMacro` | Boolean | Inherits global | Enable auto-insertion of the Sentinel Vault panel macro when sealing. Only effective when the global `globalAutoInsertMacro` setting is also enabled. |
| Macro Position | `macroInsertPosition` | String | `"bottom"` | Where to insert the macro: `"top"` or `"bottom"` of the page. |

## Setting Inheritance

Settings follow a cascade from global to space level:

```
Baseline defaults (src/server/shared/baseline.js)
  → Global settings (site settings console)
    → Space settings (space console, where applicable)
```

**What can be overridden at space level:**
- Classification: a space can opt OUT (`classification: "off"`), never opt in while the site is off (Access Control tab)
- Seal duration (Seal Duration tab)
- Auto-insert macro behavior (Macro tab)
- Macro insert position (Macro tab)
- Space activation state (Access Control tab)
- Admin delegation (Access Control tab)

**What cannot be overridden at space level (global only):**
- All notification toggles (toast, banner, comment, native notifications)
- Content protection toggle
- Delete/restore/purge permissions
- Space admin force-unseal permission
- Replace Attachments Macro setting
- Reminder frequency

### Seal Duration Resolution

When determining effective seal duration, the system checks in order:
1. Space policy `autoUnlockTimeoutHours` (if set and not null)
2. Global policy `defaultSealDuration`
3. Baseline constant `BASELINE_HOLD_SPAN` (48 hours / 172800 seconds)

### Auto-Insert Macro Resolution

Auto-insertion only occurs when **both** conditions are met:
1. Global `globalAutoInsertMacro` is enabled
2. Space `autoInsertMacro` is not explicitly disabled

If the global toggle is off, no auto-insertion happens regardless of space settings.

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
