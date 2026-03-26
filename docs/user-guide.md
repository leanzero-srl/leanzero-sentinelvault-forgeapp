# User Guide

## What is Sentinel Vault?

Sentinel Vault is a Confluence app that protects attachments from accidental overwrites. When you seal (lock) a file, no one else can modify it until you unseal it or the seal expires. If someone does edit a sealed file, the change is automatically reverted and notifications are sent.

Beyond locking, Sentinel Vault provides full attachment management -- upload, label, delete, restore -- and multi-channel notifications that keep everyone informed about file status changes.

---

## For Users

### Accessing Sentinel Vault

Sentinel Vault appears on Confluence pages in three ways:

- **Inline panel** -- A macro block inserted into page content showing the seal status of every attachment on that page. Includes seal/unseal controls, upload zone, labels, and expandable card rows with thumbnail previews.
- **Page banner** -- A persistent notification bar at the top of the page displaying a summary of sealed attachments, conflict alerts, expiry warnings, and a **Manage Attachments** button that opens the overlay.
- **Overlay** -- A full-screen modal for comprehensive attachment management with search, sort, column customization, and pagination.

### Sealing an Attachment

1. Open a Confluence page that has attachments
2. In the Sentinel Vault panel (or overlay), find the attachment you want to protect
3. Click **Seal** next to the file name
4. The attachment is now locked under your account with a countdown showing when the seal expires

While sealed, only you can edit the file. The default seal duration is 24 hours, though your administrator may have configured a different duration at the global or space level.

If the **auto-insert macro** setting is enabled, sealing an attachment on a page that doesn't already have the Sentinel Vault panel will automatically insert the panel macro into the page content.

### Unsealing an Attachment

Click **Unseal** (or **Relinquish** in the realm console) next to any attachment you have sealed. The file is immediately available for anyone to edit. All users who were watching the attachment receive a release notification.

### What Happens When Someone Edits a Sealed File

If another user uploads a new version of your sealed file:

1. Sentinel Vault automatically reverts the file to the version before the unauthorized edit
2. A Confluence comment is posted tagging both you and the editor
3. A notification banner appears on the page
4. If email notifications are enabled, both parties receive a violation alert email

The unauthorized editor's changes are not lost permanently -- they exist as a version in the attachment history -- but the active version is restored to what it was before their edit.

### What Happens When Someone Deletes a Sealed File

If another user moves your sealed attachment to the trash:

1. Sentinel Vault automatically restores the attachment from the trash
2. The seal remains active and the file continues to be protected
3. Notifications are sent to the seal owner

If the attachment is permanently deleted (bypassing trash), Sentinel Vault cleans up all seal records, content properties, and realm indexes associated with the file.

### What Happens When Someone Removes a Sealed Image from the Page

If a sealed attachment is embedded in the page body (e.g., as an inline image) and someone edits the page to remove that embed:

1. Sentinel Vault detects that the sealed media reference was removed from the page content
2. The system retrieves the media block from the previous page version
3. The sealed embed is surgically re-inserted at its original position in the page
4. Other page changes made in the same edit are preserved -- only the sealed embed is restored

This feature is called **content protection** and can be toggled on or off by a site administrator.

### Watching Attachments

When a file is sealed by another user and you need to edit it next:

1. Click **Watch** on the sealed attachment (available in the inline panel, overlay, and realm console)
2. When the seal is released -- whether manually, by expiry, or by steward override -- you receive an email notification
3. Click **Watching** to stop watching the attachment

This eliminates the need to repeatedly check whether a file has become available.

### Managing Attachments

Depending on administrator settings, additional management actions may be available:

- **Upload** -- Drag and drop files onto the upload zone in the inline panel, or click to browse. Maximum file size is 4 MB.
- **Labels** -- Click the label area on any attachment to add or remove labels for organization.
- **Delete** -- Remove unsealed attachments from the page (moves to Confluence trash). Sealed attachments cannot be deleted. Requires the "Allow Attachment Removal" setting to be enabled.
- **Restore** -- Recover trashed attachments that still have seal data in Sentinel Vault. Requires the "Allow Attachment Restore" setting to be enabled.
- **Purge** -- Clean up leftover seal records for attachments that have been permanently deleted from Confluence. Requires the "Allow Seal Cleanup" setting to be enabled.

### Overlay View

Click **Manage Attachments** in the page banner or inline panel to open the full overlay. The overlay provides:

- **Search and filter** across all attachments on the page
- **Sort** by name, status, lapses (time remaining), or creation date -- ascending or descending
- **Column picker** -- Toggle which columns are visible. Your preferences are saved in your browser's localStorage and persist across sessions.
- **Pagination** -- Load more attachments with the "Show more files" button
- **Panel visibility toggle** -- Show or hide the inline panel macro on the page
- **Full actions** -- Seal, unseal, upload, label, watch, delete, restore, and purge

Attachments are grouped into sections: **Sealed**, **Trash** (if any), and **Available**.

### Inline Panel Features

The inline panel embedded in page content provides:

- **Expandable card rows** -- Click the expand arrow on any attachment to reveal a thumbnail preview (for images), a download link, and a properties link
- **Grouped sections** -- Attachments are organized into Sealed, Missing (trashed), and Available groups
- **Two-phase loading** -- The panel loads instantly with seal data from KVS, then enriches with full attachment metadata from the Confluence API for a fast initial render
- **Configurable via macro settings** -- Click the macro config icon to customize:
  - Which columns to show (name, status, seal owner, labels, comment, actions, file size, file type, expiry)
  - Items per page (5, 10, 15, or 25)
  - Cards per row (1, 2, or 3)
  - Whether to show the upload zone

---

## For Space Administrators

Space administrators have access to the **Realm Console** under space settings.

### Realm Console

Navigate to **Space settings > Apps > Sentinel Vault** to access the realm console. The tabs you see depend on your role:

#### My Sealed Files (all users)

View all attachments you have sealed in this space. Each card shows the file name, page location, space name, seal date, and time remaining. Click **Relinquish** to release any of your seals.

If you are not a steward, a banner offers the option to **Request Steward Access** to gain elevated permissions in this space.

#### Realm Sealed Files (stewards only)

View all sealed attachments across the entire space. Features include:

- **Column picker** -- Toggle visibility of: Name, Status, Sealed by, Location, File Size, Sealed on, Lapses, Actions
- **Sort** -- By name, sealed by, location, sealed on, or lapses
- **Force Unseal** -- Override any user's seal (requires the "Allow Steward Force-Unseal" global setting to be enabled)
- **Watch** -- Watch any sealed attachment to be notified when it is released
- **Expandable cards** -- Click to reveal thumbnails, download links, and properties links
- **Pagination** -- Load more sealed files with "Show more"

#### Access Control (stewards only)

Manage who has steward privileges in this space:

- **Realm Activation** -- Toggle the space between "Active" and "Disabled" states. When disabled, Sentinel Vault features are inactive for the space.
- **Stewards** -- Search for and add individual users as stewards. Remove existing stewards.
- **Guilds** -- Add Confluence groups as steward teams. All members of a guild automatically receive steward privileges.
- **Pending Requests** -- Review steward access requests from regular users. Approve to grant steward status, or deny (the user can re-request after 48 hours). A badge on the tab shows the count of pending requests.

#### Reservation Duration (stewards only)

Configure how long seals last in this space:

- **Use system default** -- Inherit the global seal duration set in the steward console
- **Custom duration** -- Set a space-specific seal duration (in hours) that overrides the global default

#### Macro (stewards only)

Configure macro auto-insertion behavior for this space:

- **Auto-insert macro** -- When enabled and the global auto-insert setting is also enabled, the Sentinel Vault panel macro is automatically inserted into pages when an attachment is sealed
- **Macro position** -- Choose whether the macro is inserted at the top or bottom of the page

### Requesting Steward Access

If you are a regular user and need elevated permissions:

1. Open the Realm Console from space settings
2. In the **My Sealed Files** tab, click **Request Steward Access**
3. Your request is submitted to the space stewards for review
4. You'll see a confirmation banner while your request is pending
5. If denied, you may submit a new request after 48 hours

---

## For Site Administrators

Site administrators have access to the **Steward Console** under global Confluence settings.

### Steward Console

Navigate to **Confluence administration > Apps > Sentinel Vault Admin** to configure global settings across two tabs:

#### General Tab

| Setting | Description | Default |
|---------|-------------|---------|
| **Default Seal Duration** | How long attachments stay sealed (hours, minimum 1). Individual spaces can override this. | 24 hours |
| **Allow Steward Force-Unseal** | Allow stewards to unseal attachments sealed by other users | Off |
| **Enable Seal Expiry Notifications** | When on, users receive notifications when seals expire and seals are released automatically. When off, seals persist past expiry (showing "Overdue") and periodic reminders are sent instead. | On |
| **Allow Attachment Removal from Page** | Users can delete unsealed attachments from the panel. Deleted attachments go to trash. Sealed attachments cannot be deleted. | Off |
| **Allow Attachment Restore from Page** | Users and stewards can restore trashed attachments that still have seal data. | Off |
| **Allow Seal Cleanup from Page** | Users and stewards can purge leftover seal entries for permanently deleted attachments. | Off |
| **Protect Sealed Attachments in Page Body** | Automatically undo page edits that remove sealed attachments embedded in page content (images, file previews). | On |
| **Auto-Insert Macro on Seal** | Automatically insert the Sentinel Vault panel macro into the page when an attachment is sealed. Individual spaces can still disable this. | Off |
| **Replace Attachments Macro** | When inserting the panel, replace the built-in Confluence Attachments macro instead of adding alongside it. If no Attachments macro exists, the panel is inserted at the realm-configured position. Only appears when auto-insert is enabled. | Off |
| **Reminder Frequency** | How often to send reminder emails about sealed attachments (days). Only appears when seal expiry notifications are disabled. | 7 days |

#### Alerts Tab

| Setting | Description | Default |
|---------|-------------|---------|
| **Enable Pop-up Notifications** | Show brief pop-up notifications when attachments are sealed, unsealed, or when unauthorized access is attempted | On |
| **Enable Page Status Banners** | Display a status banner at the top of pages showing sealed attachment information and expiry countdowns | On |
| **Enable Page Comments** | Post Confluence comments when attachments are sealed, unsealed, or when unauthorized access is attempted | On |
| **Enable Email Notifications** | Master toggle for all email notifications. Must be on for any email sub-options to work. | On |
| **Seal Confirmation Emails** | Send confirmation email after sealing, with seal duration and expiry details | On |
| **Seal Expiry Reminder Emails** | Send reminder when a seal has expired, prompting the user to unseal | On |
| **Recurring Reminder Emails** | Send periodic reminders about sealed attachments when expiry notifications are off. Frequency controlled by Reminder Frequency in General tab. | On |

---

## FAQ

**My seal disappeared before I expected it to.**
Seals expire automatically after the configured duration (default 24 hours). Check with your administrator if a different duration is set. An administrator may also have force-released your seal.

**I need to edit a file sealed by a colleague who is unavailable.**
Ask a space steward to force-release the seal from the realm console (Realm Sealed Files tab). This requires the "Allow Steward Force-Unseal" setting to be enabled globally.

**My edit was reverted unexpectedly.**
You edited a file that was sealed by another user. Check the Confluence comments on the page for details about who sealed it and when. Your changes are preserved in the attachment version history.

**My page edit was partially undone.**
You removed a sealed attachment embed (such as an inline image) from the page body. Sentinel Vault's content protection feature detected the removal and re-inserted the embed at its original position. Your other page changes were preserved.

**How do I know which files are sealed across the site?**
Space stewards can view sealed files per space in the realm console (Realm Sealed Files tab). There is no single cross-site view; check each space individually.

**Can I seal a file indefinitely?**
Only if your administrator has disabled seal expiry notifications. In that case, seals persist until manually released, showing "Overdue" after the configured duration, and periodic reminder emails are sent to the seal owner.

**How do I stop receiving email notifications?**
Email notifications are controlled at the site level by administrators. Contact your Confluence administrator to adjust notification preferences in the steward console Alerts tab.

**How do I watch a sealed attachment?**
Click **Watch** on any attachment sealed by another user (in the inline panel, overlay, or realm console). You'll receive an email when the seal is released. Click **Watching** to stop.

**Can I customize which columns appear in the panel?**
Yes. In the inline panel, click the macro config icon (gear) to choose which columns are visible, how many items per page, and how many cards per row. In the overlay, use the column picker in the toolbar -- your overlay preferences are saved in your browser.

**What are guilds?**
Guilds are Confluence groups assigned as steward teams in a space's Access Control settings. All members of a guild automatically have steward privileges in that space.

**How do I request steward access?**
Open the Realm Console from space settings. In the My Sealed Files tab, click "Request Steward Access." A steward will review your request. If denied, you can re-request after 48 hours.

**The delete/restore/purge buttons are not visible.**
These actions are disabled by default. A site administrator must enable them individually in the steward console General tab (Allow Attachment Removal, Allow Attachment Restore, Allow Seal Cleanup).
