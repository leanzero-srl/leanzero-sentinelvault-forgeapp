# User Guide

## What is Sentinel Vault?

Sentinel Vault is a Confluence app that protects attachments from accidental overwrites. When you seal (lock) a file, no one else can modify it until you unseal it or the seal expires. If someone does edit a sealed file, the change is automatically reverted and notifications are sent.

## For Users

### Accessing Sentinel Vault

Sentinel Vault appears on Confluence pages in two ways:

- **Inline panel** -- A macro block inserted into page content showing the seal status of every attachment on that page
- **Page banner** -- A notification bar at the top of the page displaying seal alerts and a quick-access button

### Sealing an Attachment

1. Open a Confluence page that has attachments
2. In the Sentinel Vault panel, find the attachment you want to protect
3. Click **Seal** next to the file name
4. The attachment is now locked under your account with a countdown showing when the seal expires

While sealed, only you can edit the file. The default seal duration is 48 hours, though your administrator may have configured a different duration.

### Unsealing an Attachment

Click **Unseal** next to any attachment you have sealed. The file is immediately available for anyone to edit.

### What Happens When Someone Edits a Sealed File

If another user uploads a new version of your sealed file:

1. Sentinel Vault automatically reverts the file to the version before the unauthorized edit
2. A Confluence comment is posted tagging both you and the editor
3. A notification banner appears on the page
4. If email notifications are enabled, both parties receive an alert

The unauthorized editor's changes are not lost permanently -- they exist as a version in the attachment history -- but the active version is restored to what it was before their edit.

### Overlay View

Click **Manage Artifacts** in the page banner or inline panel to open the full overlay. The overlay provides:

- Search and filter across all attachments on the page
- Sort by name, status, seal owner, or expiry time
- Seal or unseal multiple files
- Upload new attachments
- Add or remove labels
- Watch attachments sealed by others to receive notifications

## For Space Administrators

Space administrators have access to the **Realm Console** under space settings.

### Realm Console

Navigate to **Space settings > Apps > Sentinel Vault** to access:

- **Sealed artifacts list** -- View all currently sealed attachments in this space
- **Force-release** -- Unseal any attachment regardless of who sealed it
- **Background scan** -- Trigger an audit of all sealed artifacts in the space
- **Permission delegation** -- Grant Sentinel Vault admin rights to specific users or groups within the space

## For Site Administrators

Site administrators have access to the **Steward Console** under global Confluence settings.

### Steward Console

Navigate to **Confluence administration > Apps > Sentinel Vault Admin** to configure:

- **Seal duration** -- Set the default seal expiry time for all spaces
- **Auto-unseal** -- Toggle whether seals are automatically released on expiry (when disabled, seals persist and periodic reminders are sent instead)
- **Steward override** -- Allow site admins to force-release seals across all spaces
- **Notification preferences** -- Enable or disable each notification channel:
  - Toast messages (in-app popups)
  - Page banners
  - Confluence comments
  - Email notifications (requires Resend configuration)
- **Email service** -- Configure the Resend API integration for outbound emails

## FAQ

**My seal disappeared before I expected it to.**
Seals expire automatically after the configured duration (default 48 hours). Check with your administrator if a different duration is set. An administrator may also have force-released your seal.

**I need to edit a file sealed by a colleague who is unavailable.**
Ask a space administrator to force-release the seal from the realm console, or a site administrator to use steward override.

**My edit was reverted unexpectedly.**
You edited a file that was sealed by another user. Check the Confluence comments on the page for details about who sealed it and when. Your changes are preserved in the attachment version history.

**How do I know which files are sealed across the site?**
Space administrators can view sealed files per space in the realm console. There is no single cross-site view; check each space individually.

**Can I seal a file indefinitely?**
Only if your administrator has disabled auto-unseal. In that case, seals persist until manually released, and periodic reminder emails are sent to the seal owner.

**How do I stop receiving email notifications?**
Email notifications are controlled at the site level by administrators. Contact your Confluence administrator to adjust notification preferences in the steward console.
