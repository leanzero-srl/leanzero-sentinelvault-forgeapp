# User Guide

Applies to production **6.4.0**.

## What is Sentinel Vault?

Sentinel Vault is a Confluence app that protects attachments and page sections. When you seal a file or a section, no one else can change it until you release it or the seal expires. If someone does change it, the change is undone automatically and the people involved are told.

On top of sealing it offers edit requests, a page approval workflow, content validations, optional AI review, page classification levels, optional authenticator-code signing, an activity log and a REST configuration API.

---

## For Users

### Where Sentinel Vault appears

- **Page chip (byline)** -- A chip under the page title. Clicking it opens the **page-details modal**, the page's hub: its classification level, the seals on the page (files and sections), requests and actions.
- **Seal attachments… (page ⋯ menu)** -- Opens the same modal on the sealing view: every attachment as a row with a checkbox, one duration picker, an optional note, and an upload drop zone (4 MB per file).
- **Page banner** -- A ribbon at the top of the page with the page's seals, requests waiting for you, workflow state, alerts and (when classification is on) the page's level.
- **Inline panel** -- An optional macro placed in the page body, showing every attachment grouped as **Sealed** and **Available**, with Seal / Release / Request edit actions.
- **Attachments overlay** -- A full-screen attachment view, opened from the page-details modal, with search, sort and a column picker.
- **My work** -- A Confluence app page listing what Sentinel Vault is waiting on you for across all spaces (see below).

### Sealing an attachment

1. Open the page's ⋯ menu and choose **Seal attachments…** (or click **Seal** on a row in the inline panel)
2. Pick the file(s), the duration and, optionally, a note
3. The attachment is now sealed under your account, with a countdown to its expiry

While sealed, only you (and anyone you give edit access to) can change the file. The default seal duration is **48 hours**; your administrator may set a different duration for the site or for a space.

If the site's **Auto-Insert Macro on Seal** setting is on (it is off by default) and the space allows it, the first seal on a page adds the Sentinel Vault panel to that page.

### Releasing a seal

Click **Release** on a file you have sealed. The file is immediately available to others. If comment notifications are on, people watching the file are @mentioned in a page comment.

### What happens when someone edits a sealed file

If another user uploads a new version of your sealed file:

1. Sentinel Vault puts the sealed version back
2. The editor is told with a page comment addressed to them (the "Tell editors when their change is undone" setting, on by default)
3. An alert is recorded for the page banner and pop-ups
4. If the site has turned on comment notifications and violation comments (both off by default), a comment on the page @mentions the people involved

The editor's upload is not lost -- it stays in the attachment's version history.

### Sealing a section of a page

Click the Sentinel Vault chip under the page title to open the page's details, then **Seal a section…** in "Seals on this page": pick the heading (each row says what the seal will freeze — the heading and everything under it, up to the next heading of the same level), choose how long it holds and, optionally, a note. The sealed section shows a badge on the page ("Sealed by you · until …"); the inline panel's Sealed Sections group offers the same picker. Edits inside a sealed section by anyone but the owner (and the people the owner approves) are undone automatically.

### Asking to edit someone else's sealed content

On a file or section someone else holds sealed, the row (page-details modal, inline panel) and the page ribbon offer **Request edit**. The owner sees the request on the row, on the ribbon ("Waiting for you") and on My work, and answers **Approve** or **Decline** — Decline can carry a short word for you (optional; from the page-details modal). What you see afterwards uses one set of words everywhere: **Waiting for {owner}** while it is open, **Edit now · until {time}** once approved, **Declined · ask again {time}** when it was declined, and your own **My work → Your edit requests** card lists every request you made with the same states. The owner (or a space admin) can also give you edit access directly at any time with **Give edit access…** under the row's ⋯ menu.

**Cooldown after a decline.** After a decline, you wait before you can ask again for the same item. The wait is the site setting **Hours before a declined edit request can be repeated** — **1 hour** by default, 0 means you can ask again at once, the maximum is 168 hours (a week). A direct grant from the owner does not wait for the cooldown.

### What happens when someone trashes a sealed file

If another user moves your sealed attachment to the trash, Sentinel Vault restores it from the trash and the seal stays in force. If the attachment is permanently deleted, Sentinel Vault cleans up its seal records.

### What happens when someone removes a sealed image from the page

If a sealed attachment is embedded in the page body (for example an inline image) and someone edits the page to remove it, Sentinel Vault re-inserts the embed at its original position and keeps the other changes of that edit. This is **content protection**; a site administrator can turn it off (**Protect Sealed Attachments in Page Body**, on by default).

### Watching an attachment

Click **Watch** on a file someone else has sealed. When the seal is released -- manually, by expiry or by a space admin's Force release -- watchers are @mentioned in a page comment, and Confluence notifies them according to their own preferences. Watch notices are comments, so they only go out when the site's **Page comments that mention people** switch is on (off by default).

### Managing attachments

Depending on site settings:

- **Upload** -- Drop files onto the upload zone (panel or Seal attachments…). Maximum size is 4 MB per file.
- **Labels** -- Add or remove labels on an attachment.
- **Delete** -- Send an unsealed attachment to the trash. Needs **Allow Attachment Removal from Page** (off by default).
- **Restore** -- Restore a trashed attachment that still carries a seal. Needs **Allow Attachment Restore from Page** (off by default).
- **Cleanup** -- Remove seal records left behind by permanently deleted attachments. Needs **Allow Seal Cleanup from Page** (off by default).

### The inline panel

- Files are grouped as **Sealed** and **Available**. Each group pages on its own: it shows a window of cards, then **Show N more files** / **Show fewer**, with "Showing N of M" beside it.
- The macro's settings (gear) let you choose the columns, the items per group page (5 by default; 5, 10, 15 or 25), the cards per row (1, 2 or 3) and whether to show the upload zone.

### Classification

When a site administrator turns classification on, every page shows a classification level under its title and in the page banner — **Unclassified** when neither the page nor its space sets one. Classification is **off** until a site admin turns it on.

- **Levels.** The built-in levels are **Public** (rank 1), **Internal** (2), **Confidential** (3) and **Restricted** (4); rank 1 is the least sensitive. Site admins can rename, recolour, add or remove levels, or import them from a Jira Service Management Assets object type.
- **Where a level comes from.** The page's own level wins, then the space's default level, then none. Every surface says which: "set on this page" or "from space default".
- **Changing a page's level.** Open the page-details modal (the chip under the title) and pick a level in its Classification section. You need edit permission on the page.
- **Lowering asks for a reason.** Raising a level is one pick. Lowering it, clearing it, or switching to a space default that is lower needs a reason (up to 300 characters); the change is refused without one. The change and the reason are recorded in the activity log (`classification.page-set`, `classification.space-default-set`).

### Signing actions with an authenticator code

A site or a space can require a 6-digit code from an authenticator app before certain actions run. The **Sign this action** dialog asks for the current code.

- **Seal actions (site setting, off by default).** With **Sign seal actions with an authenticator code** on, these ask for a code: sealing a file or section, releasing, Force release, extending, approving or declining an edit request, and giving or revoking edit access. Someone who has not set up an authenticator is refused until they do.
- **Approvals (per space).** A space's workflow can require signed decisions: each approver signs their own decision; a space admin's direct approval is signed too; when a workflow has no named approvers, the requester signs the request.
- Each code works once. After 5 wrong codes, signatures for that account are refused for 15 minutes.

To set up your authenticator, open **My work → Your approval signature**, scan the QR code (or type the key) into any authenticator app and confirm with the first code. Replacing a device asks for the current device's code.

### My work

A Confluence app page ("Sentinel Vault — My work") with, across every space:

- Edit requests on your sealed files, and on your sealed sections
- Requests to become a space admin (for spaces you administer)
- Your edit requests and their states
- Approvals you asked for
- Files you hold sealed
- Your approval signature (authenticator set-up)

---

## For Space Administrators

### Space console

Open the space and choose **Sentinel Vault** among the space's apps (it is a Confluence space page, "Sentinel Vault"). The tabs depend on your role.

#### My Sealed Files (users who are not space admins)

The attachments you have sealed in this space, and your edit requests. A banner offers **Request admin access**.

#### Sealed Files (space admins)

Every sealed attachment in the space, with a column picker, sort, Watch and, when allowed, **Force release**.

**Force release** releases someone else's seal and requires a typed reason, which is recorded. It is offered only to space admins, and only while the site setting **Allow space admins to force-unseal** is on (it is on by default). When that setting is off, the action is not shown at all.

#### Access Control (space admins)

- **Space admins** -- add or remove individual users as Sentinel Vault space admins for this space
- **Groups** -- add Confluence groups; every member gets space admin rights here
- **Pending requests** -- approve or deny requests for space admin access (a badge shows the count). A denied user can ask again after **48 hours**.
- **Notifications** -- Normal, or **Quiet**: the space posts no comments and mentions nobody; pop-ups, the ribbon and the activity trail still work
- **Classification in this space** -- leave it on (inherit the site) or turn it off for this space; a space cannot turn classification on while the site has it off
- **Default level for this space** -- shown while classification is on; lowering it asks for a reason

#### Seal Duration (space admins)

Use the site default, or set a custom duration in hours for seals in this space.

#### Macro (space admins)

- **Auto-Insert Macro** -- the first seal on a page in this space adds the panel (only when the site's Auto-Insert Macro on Seal is on)
- **Macro Position** -- top or bottom of the page body

#### Validations (space admins)

The space's content-validation rules.

#### Workflow (space admins)

The page approval workflow: states (built-in: Draft, In Review, Approved, Needs re-review), who approves, whether approvals must be signed with an authenticator code, and re-review timing. The tab opens with the effective rule as one sentence.

#### Activity (space admins)

The space's activity log, filterable by period (7, 30, 90 days or all time) and by category (Seals, Sections, Edit access, Workflow, Validation, Classification), with **Load more** and CSV export.

### Requesting admin access

1. Open the space's Sentinel Vault page
2. In **My Sealed Files**, click **Request admin access**
3. A space admin approves or denies it
4. If denied, you may submit a new request after 48 hours

---

## For Site Administrators

### Site settings

Open **Confluence administration → Apps → Sentinel Vault — Site settings**. Tabs:

- **Settings** -- grouped as Protection, Expiry, Alerts, Classification and Advanced. Changes take effect only after **Apply**; see the [Settings Reference](settings-reference.md) for every key and default.
- **Validations** -- content rules and the optional AI review.
- **Classification** -- one on/off switch (on saves at once, off asks once and keeps every stored level, default and override), the levels, the JSM Assets import, and a default level per space.
- **API access** -- the REST endpoint, its tokens, and recent jobs.

Key defaults: seal duration 48 hours; force-unseal on; comment notifications off; classification off; signing seal actions off; edit-request cooldown 1 hour.

### Classification levels from JSM Assets

On a site with a Jira Service Management Assets workspace, the Classification tab can import levels from an Assets object type. The Assets calls run as the signed-in admin, and nothing is written back to Assets.

### REST API tokens

Site admins mint tokens on the **API access** tab. A token looks like `svt_` followed by 48 hex characters and is shown **once**; only its SHA-256 hash is stored. Each token has a role:

| Role | May do |
|------|--------|
| Viewer | Nothing that writes |
| Editor | Content operations (sealing, edit access, classification, workflow, validation re-checks) |
| Admin | Everything, including site and space configuration |

Every operation runs as the admin who minted the token, through the same permission checks as the UI. Full reference: [REST-CONFIG-API.md](REST-CONFIG-API.md).

---

## FAQ

**My seal disappeared before I expected it to.**
Seals expire after the configured duration (48 hours unless your administrator changed it for the site or space). When seals expire, the owner gets overdue reminders (3 by default, 24 hours apart) before the file is released. A space admin may also have used Force release.

**I need to edit a file sealed by a colleague who is unavailable.**
Send a **Request edit**; the owner or a space admin can approve it or give you access directly. Otherwise a space admin can **Force release** the seal from the space console's Sealed Files tab, if the site allows it.

**Force release is not in the menu.**
You are not a space admin in that space, or the site setting **Allow space admins to force-unseal** is off.

**I was declined and cannot ask again yet.**
The site's edit-request cooldown is running (1 hour by default). The row shows when you can ask again.

**My edit was reverted unexpectedly.**
You changed a file or section someone else had sealed. Your version is kept in the version history; you are told with a comment that links to it.

**My page edit was partially undone.**
You removed a sealed attachment embed from the page body; Sentinel Vault put it back and kept your other changes.

**Can I seal a file indefinitely?**
Only if a site admin has turned **Seals expire** off. Owners of such seals then see a recurring reminder banner (every 7 days by default).

**Why did nobody get a comment or notification?**
Comments that mention people are off by default; a site admin turns them on under Settings → Alerts. A space in Quiet mode never posts them.

**Why does it ask me for a code?**
Your site signs seal actions, or your space signs approvals. Set up your authenticator once on My work.

**The delete/restore/cleanup buttons are not visible.**
They are off by default. A site admin turns them on individually under Settings → Protection.

**How do I request space admin access?**
In the space's Sentinel Vault page, My Sealed Files tab, click **Request admin access**. If denied, you can ask again after 48 hours.
