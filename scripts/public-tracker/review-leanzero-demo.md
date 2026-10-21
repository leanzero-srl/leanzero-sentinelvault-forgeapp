# Sentinel Vault Public Tracker - verify file

Generated 2026-10-21T06:03:21.581Z by scripts/public-tracker/tracker.mjs verify.
Site https://leanzero-demo.atlassian.net. Project SVT (id 10278), permission scheme "Sentinel Vault Public Tracker permissions" (id 10265, used by: SVT), anonymous grants: BROWSE_PROJECTS.
Issues checked: 126 of 126. Verification failures: 0. Withheld release-note lines: 1.

## Counts

- status: Done 95; Backlog 31
- version: 6.4.0 5; 6.5.0 1; 6.6.0 6; 6.7.0 8; 6.9.0 4; 6.10.0 4; 6.11.0 1; 7.0.0 5; 7.1.0 8; 8.0.0 16; 8.1.0 1; 8.2.0 2; 8.3.0 1; 8.4.0 1; 8.5.0 1; 8.6.0 13; 8.7.0 1; 8.8.0 1; 8.9.0 5; 8.10.0 5; 8.11.0 3; 8.12.0 3; open, affects 7.1.0 6; open, affects 8.12.0 25
- component: Classification 4; Sealed files and sections 14; Edit requests and access 4; REST API 4; Backup and restore 13; Layout and accessibility 10; Privacy and personal data 8; Space and site settings 17; Workflow and approvals 18; App permissions and updates 4; Page banner and Sentinel Vault window 10; Activity report 2; Jira issue attachments 13; My work 5
- type: Improvement 47; Bug 79
- versions in Jira: 6.4.0 released 2026-09-30, 6.5.0 released 2026-09-30, 6.6.0 released 2026-10-02, 6.7.0 released 2026-10-04, 6.9.0 released 2026-10-04, 6.10.0 released 2026-10-04, 6.11.0 released 2026-10-04, 7.0.0 released 2026-10-05, 7.1.0 released 2026-10-09, 8.0.0 released 2026-10-14, 8.1.0 released 2026-10-14, 8.2.0 released 2026-10-14, 8.3.0 released 2026-10-14, 8.4.0 released 2026-10-14, 8.5.0 released 2026-10-14, 8.6.0 released 2026-10-17, 8.7.0 released 2026-10-17, 8.8.0 released 2026-10-17, 8.9.0 released 2026-10-18, 8.10.0 released 2026-10-18, 8.11.0 released 2026-10-18, 8.12.0 released 2026-10-18

## Issues

### SVT-1 - Pages show their classification level when Classification levels is on

- type: Improvement; status: Done (Done); fixVersion: 6.4.0; component: Classification

> When a site admin turns on Classification levels in Site settings (it is off unless turned on), every page shows its classification level, unless its space opts out. Raising a page's level is one action; lowering it asks for a reason.
> Added in Sentinel Vault 6.4.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-2 - Force release is offered only when a space admin may use it

- type: Improvement; status: Done (Done); fixVersion: 6.4.0; component: Sealed files and sections

> Force release is offered only to space admins when "Allow space admins to force-unseal" is on.
> Added in Sentinel Vault 6.4.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-3 - Sealed and Available files have separate paging, and the counts match the cards

- type: Improvement; status: Done (Done); fixVersion: 6.4.0; component: Sealed files and sections

> Sealed and Available files have separate paging, the counts match the cards, and a file you just sealed or released moves to the top of its group.
> Added in Sentinel Vault 6.4.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-4 - A declined edit request can be asked again after a cooldown

- type: Improvement; status: Done (Done); fixVersion: 6.4.0; component: Edit requests and access

> A declined edit request can be retried after a site-configurable cooldown (default 1 hour).
> Added in Sentinel Vault 6.4.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-5 - Seal actions can require an authenticator code

- type: Improvement; status: Done (Done); fixVersion: 6.4.0; component: Sealed files and sections

> Seal actions can require a 6-digit authenticator code (site setting).
> Added in Sentinel Vault 6.4.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-6 - REST API: giving, revoking and declining edit access failed in 6.4.0

- type: Bug; status: Done (Done); fixVersion: 6.5.0; component: REST API

> The REST operations that give, revoke and decline edit access to sealed files and sections now run. In 6.4.0 they were accepted but every job failed. Resubmit any failed job with a new Idempotency-Key.
> Fixed in Sentinel Vault 6.5.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-7 - Sentinel Vault backs up your setup automatically

- type: Improvement; status: Done (Done); fixVersion: 6.6.0; component: Backup and restore

> Site settings has a new Backup and restore section. Sentinel Vault backs up your settings, seals, sealed sections, workflows, validation rules, classification and history after each change in the app or REST API and once a day, to a Confluence page restricted to the app. After updating, open Site settings, Backup and restore, once and check that the first backup is there.
> Added in Sentinel Vault 6.6.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-8 - Restore your setup after a reinstall, with its automatic actions paused

- type: Improvement; status: Done (Done); fixVersion: 6.6.0; component: Backup and restore

> After a reinstall, or when the app comes back after a lapsed subscription, Site settings offer "Restore your setup from [date]" with a preview of what comes back. Things that act on their own (seals expiring, validation revert, AI review, workflow auto-assign and review timers) come back paused until you turn them on. REST API tokens and authenticator codes are never backed up: after a restore, create new tokens and ask people who sign actions to enroll again.
> Added in Sentinel Vault 6.6.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-9 - Download the whole setup as one file and import it back

- type: Improvement; status: Done (Done); fixVersion: 6.6.0; component: Backup and restore

> You can download the whole setup as one JSON file and import it back later.
> Added in Sentinel Vault 6.6.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-10 - REST API operations for backup, restore, export and import

- type: Improvement; status: Done (Done); fixVersion: 6.6.0; component: REST API

> REST operations backup, restore, export, import, rediscover, resume-automations and backup-location, for admin tokens.
> Added in Sentinel Vault 6.6.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-11 - Uninstalling no longer erases the app's stored data on the spot

- type: Improvement; status: Done (Done); fixVersion: 6.6.0; component: Backup and restore

> Uninstalling no longer erases the app's stored data on the spot. Atlassian keeps it for 28 days, so LeanZero can still ask Atlassian to re-link it within 21 days.
> Added in Sentinel Vault 6.6.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-12 - Dialogs opened low on a long page opened partly off screen

- type: Bug; status: Done (Done); fixVersion: 6.6.0; component: Layout and accessibility

> Dialogs opened from low on a long page (Site settings, space settings, page panels) now open fully on screen, with their buttons in view.
> Fixed in Sentinel Vault 6.6.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-13 - Optional keep period for activity history, workflow history and read confirmations

- type: Improvement; status: Done (Done); fixVersion: 6.7.0; component: Privacy and personal data

> Site settings has a new Privacy and retention section. Turn on "Delete old history" to have activity history, workflow history and read confirmations older than "Keep history for" (730 days unless you change it) deleted by a weekly check. It is off unless you turn it on, so nothing is deleted on upgrade. If your records policy sets a keep period for history, turn on Delete old history there and set the period.
> Added in Sentinel Vault 6.7.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-14 - Run the weekly personal-data check at once, in Site settings or over the REST API

- type: Improvement; status: Done (Done); fixVersion: 6.7.0; component: Privacy and personal data

> The weekly personal-data check can be run at once with Run the check now in Site settings, Privacy and retention, and over the REST API (operation privacy-sweep, admin tokens).
> Added in Sentinel Vault 6.7.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-15 - Sentinel Vault no longer stores the email address of the person who seals

- type: Improvement; status: Done (Done); fixVersion: 6.7.0; component: Privacy and personal data

> Sentinel Vault no longer stores the email address of the person who seals a file or section. Seal records saved before this version are cleaned by the weekly check.
> Added in Sentinel Vault 6.7.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-16 - Delete the backup deletes every backup file for good

- type: Improvement; status: Done (Done); fixVersion: 6.7.0; component: Backup and restore

> Delete the backup now deletes every backup file for good before the emptied page goes to the space trash, and says so when something could not be removed.
> Added in Sentinel Vault 6.7.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-17 - Documentation and Support links in Site settings

- type: Improvement; status: Done (Done); fixVersion: 6.7.0; component: Space and site settings

> Documentation and Support links at the top of Site settings.
> Added in Sentinel Vault 6.7.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-18 - Delete the backup reported success while the backup page stayed where it was

- type: Bug; status: Done (Done); fixVersion: 6.7.0; component: Backup and restore

> Delete the backup used to report success while the backup page stayed where it was.
> Fixed in Sentinel Vault 6.7.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-19 - Read confirmations and approvals that named a group did not reach its members

- type: Bug; status: Done (Done); fixVersion: 6.7.0; component: Workflow and approvals

> Read confirmations and approvals that name a group now reach the group's members.
> Fixed in Sentinel Vault 6.7.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-20 - A sealed file deleted for good kept its seal record

- type: Bug; status: Done (Done); fixVersion: 6.7.0; component: Sealed files and sections

> A sealed file deleted for good is now recognised as gone, so its seal record is cleaned up.
> Fixed in Sentinel Vault 6.7.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-21 - After Delete the backup, the hourly check no longer takes a new backup on its own

- type: Improvement; status: Done (Done); fixVersion: 6.9.0; component: Backup and restore

> After Delete the backup, the hourly check no longer takes a new backup on its own, and the Backup tab says when the backup was deleted. Opening a page, the weekly personal-data check and backups queued before the delete could still take one until 6.10.0.
> Added in Sentinel Vault 6.9.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-22 - Approver lists in workflow settings no longer store email addresses

- type: Improvement; status: Done (Done); fixVersion: 6.9.0; component: Privacy and personal data

> Approver lists in workflow settings no longer store the approver's email address. The people picker still shows it while you search. Lists saved earlier are cleaned by the weekly check.
> Added in Sentinel Vault 6.9.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-23 - A backup deleted before an uninstall could come back within the hour

- type: Bug; status: Done (Done); fixVersion: 6.9.0; component: Backup and restore

> Deleting the backup before an uninstall could be undone within the hour by an automatic backup on a new page.
> Fixed in Sentinel Vault 6.9.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-24 - The Delete the backup dialog said nothing could bring the setup back after an uninstall

- type: Bug; status: Done (Done); fixVersion: 6.9.0; component: Backup and restore

> The Delete the backup dialog said nothing could bring the setup back after an uninstall; an export you downloaded, or Atlassian re-linking the app within 21 days, still can.
> Fixed in Sentinel Vault 6.9.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-25 - Opening a page no longer schedules a backup

- type: Improvement; status: Done (Done); fixVersion: 6.10.0; component: Backup and restore

> Opening a page no longer schedules a backup. A backup is scheduled only after a change, or when the page check actually puts protected text back.
> Added in Sentinel Vault 6.10.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-26 - After Delete the backup, the weekly check and backups queued earlier take no new backup

- type: Improvement; status: Done (Done); fixVersion: 6.10.0; component: Backup and restore

> After Delete the backup, the weekly personal-data check and backups queued before the delete no longer take a new one. Only the next change in the app or over REST, or Back up now, does.
> Added in Sentinel Vault 6.10.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-27 - Delete the backup could be undone by someone opening a page

- type: Bug; status: Done (Done); fixVersion: 6.10.0; component: Backup and restore

> Delete the backup could be undone within minutes by someone opening a page.
> Fixed in Sentinel Vault 6.10.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-28 - A backup file counted as deleted while it was still in the trash

- type: Bug; status: Done (Done); fixVersion: 6.10.0; component: Backup and restore

> A backup file is counted as deleted only once it is purged from the trash, and a second Delete finishes files an interrupted delete left in the trash.
> Fixed in Sentinel Vault 6.10.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-29 - Email addresses brought back by a restore are cleaned every week

- type: Improvement; status: Done (Done); fixVersion: 6.11.0; component: Privacy and personal data

> The weekly personal-data check removes stored email addresses from seal records and approver lists every week, not only the first time, so addresses that a restore or import of an older backup brought back are cleaned too.
> Added in Sentinel Vault 6.11.0. A site still on version 5 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-30 - The 7.0.0 update asks for one new permission: reporting personal data to Atlassian

- type: Improvement; status: Done (Done); fixVersion: 7.0.0; component: App permissions and updates

> The 7.0.0 update asks a site admin to approve one new permission, reporting personal data to Atlassian. Until it is approved the site stays on the previous version. A site admin approves the update in Confluence administration, Apps, Manage apps.
> Added in Sentinel Vault 7.0.0.

### SVT-31 - Closed accounts are erased from Sentinel Vault's records, except mentions inside sealed content

- type: Improvement; status: Done (Done); fixVersion: 7.0.0; component: Privacy and personal data

> Once the 7.0.0 update is approved, the weekly personal-data check sends Atlassian the ids of the accounts Sentinel Vault stores, each at most once per Atlassian's reporting cycle (7 days unless Atlassian sets another period). When Atlassian answers that an account was closed, the app erases that person everywhere it keeps them, including the backup. When it answers that an account changed, the app refreshes the stored name. Sealed sections are the record of what was sealed and are never rewritten: a closed account mentioned inside sealed content stays mentioned there, as in Confluence's own page history. Everything else the app keeps about that person is erased once, and is erased again only if a restore brings it back.
> Added in Sentinel Vault 7.0.0. A site still on version 6 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-32 - The first personal-data check runs within a day of the update

- type: Improvement; status: Done (Done); fixVersion: 7.0.0; component: Privacy and personal data

> The first personal-data check runs within a day of the 7.0.0 update, and each account is then checked every 7 days on the day, or on the period Atlassian asks for. If Atlassian refuses a check, it is tried again the next day instead of a week later.
> Added in Sentinel Vault 7.0.0. A site still on version 6 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-33 - Sentinel Vault no longer asks for 12 permissions it did not use

- type: Improvement; status: Done (Done); fixVersion: 7.0.0; component: App permissions and updates

> Sentinel Vault asks for fewer permissions. It no longer requests 12 it held but did not use: read:confluence-space.summary, read:confluence-props, read:content:confluence, write:content:confluence, write:attachment:confluence, read:comment:confluence, read:content.property:confluence, write:content.property:confluence, read:content.restriction:confluence, write:content.restriction:confluence, read:content.metadata:confluence and read:content.permission:confluence. Everything the app did with them it already does through the permissions it keeps, so nothing it does changes. Two are kept on purpose: read:confluence-content.summary, because Confluence only tells the app about page and attachment changes with it, and read:label:confluence, which the page label check uses.
> Added in Sentinel Vault 7.0.0. A site still on version 6 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-34 - The weekly personal-data check could not ask Atlassian about closed or changed accounts

- type: Bug; status: Done (Done); fixVersion: 7.0.0; component: Privacy and personal data

> The weekly personal-data check could not ask Atlassian about closed or changed accounts, because the app did not hold the permission for it.
> Fixed in Sentinel Vault 7.0.0. A site still on version 6 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-35 - File cards no longer cut a file's name short to fit their buttons

- type: Improvement; status: Done (Done); fixVersion: 7.1.0; component: Sealed files and sections

> File cards in space settings, the attachments view and the page panel no longer cut a file's name short to fit their buttons, on phones, tablets and laptops. A card keeps its buttons on the same line as the name when both fit and moves them under the name when they do not. On wide screens the attachments view shows up to five columns instead of three stretched cards. The panel's Cards per row setting is now a maximum, because a card is never narrower than about 340 px, so a panel set to 3 per row shows 2 on a standard-width page.
> Added in Sentinel Vault 7.1.0. A site still on version 6 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-36 - The page banner fits a phone, with fewer chips on narrow screens

- type: Improvement; status: Done (Done); fixVersion: 7.1.0; component: Page banner and Sentinel Vault window

> The page banner fits a phone, and nothing overlaps its Open button. To make room, a banner narrower than about 860 px (phones, most tablets, narrow windows) no longer shows the Validation and AI check chips, and below about 720 px it also leaves out the approval and review-date chip. The review date and approval record are still in the window Open shows. Validation and AI check results are in the Sentinel Vault panel on pages that have one.
> Added in Sentinel Vault 7.1.0. A site still on version 6 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-37 - The Sentinel Vault window and Seal attachments lay out for a phone's width

- type: Improvement; status: Done (Done); fixVersion: 7.1.0; component: Page banner and Sentinel Vault window

> The Sentinel Vault window (Open on the banner, or Sentinel Vault under the page title) and Seal attachments lay out for a phone's width, their menus open where you can see them, and while you tick files the Seal button stays pinned in view without covering the file you just ticked. On a phone only Open on the banner fills the screen. Opened from under the page title or from Seal attachments… in the page menu, the window keeps a fixed height, and on a phone held sideways you scroll down to reach the Seal button.
> Added in Sentinel Vault 7.1.0. A site still on version 6 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-38 - Space and site settings fit tablets and narrow windows

- type: Improvement; status: Done (Done); fixVersion: 7.1.0; component: Space and site settings

> Space and site settings fit tablets and narrow windows. On a phone, Confluence still shows these pages wider than the screen, so you scroll sideways, but their dialogs and the Not applied yet reminder open in the part you can see. The tabs wrap into even rows instead of leaving one tab alone on a line, the Activity, API access and backup tables turn into stacked rows instead of scrolling sideways, the Workflow tab lists its first 20 pages and API access its newest 10 jobs with a Show all link, revoked API tokens are folded behind a link that shows them, and on wide screens the settings keep a readable width.
> Added in Sentinel Vault 7.1.0. A site still on version 6 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-39 - Bigger buttons and switches on phones and tablets, and more readable small labels

- type: Improvement; status: Done (Done); fixVersion: 7.1.0; component: Layout and accessibility

> Buttons, checkboxes, switches and chips are bigger on phones and tablets, most small labels and badges are now at least 11 px, and in dark mode the text on cyan and red buttons is readable.
> Added in Sentinel Vault 7.1.0. A site still on version 6 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-40 - API access and the Activity report showed some people as an account ID

- type: Bug; status: Done (Done); fixVersion: 7.1.0; component: Activity report

> API access and the Activity report showed some people as an account ID. They now show the person's name. When Atlassian returns no name for an account, the Activity report says Someone and API access leaves the name out.
> Fixed in Sentinel Vault 7.1.0. A site still on version 6 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-41 - The Not applied yet reminder could cover the setting you had just changed

- type: Bug; status: Done (Done); fixVersion: 7.1.0; component: Space and site settings

> The Not applied yet reminder could cover the setting you had just changed, such as a new validation rule's pickers. It now appears near that setting without covering any button or field, and nothing on the page moves when it appears.
> Fixed in Sentinel Vault 7.1.0. A site still on version 6 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-42 - A sealed section low on a page could say it could not display its text

- type: Bug; status: Done (Done); fixVersion: 7.1.0; component: Sealed files and sections

> A sealed section further down a page could show "could not display this section's text" if you reached it more than about 15 seconds after the page opened. It now waits until you reach it and shows its content.
> Fixed in Sentinel Vault 7.1.0. A site still on version 6 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-43 - On a phone, space settings and site settings are wider than the screen

- type: Bug; status: Backlog; affects: 7.1.0; component: Space and site settings

> What you see: On a phone, the space settings and site settings pages are wider than the screen, so you scroll sideways to reach their right-hand side. Dialogs and the Not applied yet reminder open in the part of the page you can see.
> Where: Space settings and Site settings, on a phone.
> Workaround: Scroll sideways, or use a tablet or a computer, where these pages fit the screen.
> Why: Confluence keeps these pages at least about 700 px wide on a phone, so Sentinel Vault cannot make them narrower.
> Confirmed on Sentinel Vault 7.1.0. Status: open.

### SVT-44 - On a phone, the Sentinel Vault window opened from under the page title or the page menu keeps a fixed height

- type: Bug; status: Backlog; affects: 7.1.0; component: Page banner and Sentinel Vault window

> What you see: Opened from Sentinel Vault under the page title, or from Seal attachments… in the page menu, the Sentinel Vault window keeps a fixed height. On a phone held sideways it runs past the bottom of the screen, so you scroll down to reach the Seal button. Held upright, it can leave empty space under its buttons.
> Where: The Sentinel Vault window and Seal attachments, on a phone.
> Workaround: For the Sentinel Vault window, use Open on the page's Sentinel Vault banner where the page shows one: on a phone it fills the screen. To seal files, open its Attachments tab and press Open the full attachments view, which also fills the screen and has a seal control on each file. Otherwise scroll down inside the window to reach its buttons.
> Why: Confluence sets the size of windows opened from these two places.
> Confirmed on Sentinel Vault 7.1.0. Status: open.

### SVT-45 - On a site with more than about 1,000 sealed files, your list of sealed files can leave some out

- type: Bug; status: Backlog; affects: 7.1.0; component: My work

> What you see: Files you hold sealed in My work, and the My Sealed Files tab in space settings, look through about the first 1,000 sealed files on the whole site. On a site with more than that, some of the files you sealed may not be listed.
> Where: My work, Files you hold sealed; space settings, My Sealed Files.
> Workaround: Open the page the file is attached to: its Sentinel Vault panel and the Sentinel Vault window list the seals on that page.
> Confirmed on Sentinel Vault 7.1.0. Status: open.

### SVT-46 - The banner's AI check chip still counts findings you dismissed

- type: Bug; status: Backlog; affects: 7.1.0; component: Page banner and Sentinel Vault window

> What you see: The AI check chip on the page banner counts every finding from the latest AI review, including the ones you dismissed or marked as a false positive.
> Where: The page banner, on pages that had an AI review, when the banner is about 860 px wide or wider (narrower banners do not show the chip).
> Workaround: The Sentinel Vault panel on the page lists open findings apart from the hidden ones. Re-running the AI review after the page is fixed refreshes the count.
> Confirmed on Sentinel Vault 7.1.0. Status: open.

### SVT-47 - The Top and Bottom choices for the panel's position show no keyboard focus

- type: Bug; status: Backlog; affects: 7.1.0; component: Layout and accessibility

> What you see: When you move through space settings with the keyboard, the Top and Bottom switches under Macro Position show no focus outline, so you cannot see when one of them has focus.
> Where: Space settings, Macro tab, Macro Position.
> Workaround: The switches still work from the keyboard: the arrow keys move between Top and Bottom and the chosen one turns on. Use the mouse or touch if you need to see where you are.
> Confirmed on Sentinel Vault 7.1.0. Status: open.

### SVT-48 - On a very narrow phone, the Not applied yet reminder can sit over the Enforcement heading

- type: Bug; status: Backlog; affects: 7.1.0; component: Space and site settings

> What you see: On a phone narrower than about 355 px, after you change a validation setting, the Not applied yet reminder can cover the Enforcement heading's text. It does not cover a button or a field.
> Where: Space settings or Site settings, Validations tab, on a phone narrower than about 355 px.
> Workaround: Scroll a little to read the heading. The reminder goes away once you press Apply or Discard.
> Confirmed on Sentinel Vault 7.1.0. Status: open.

### SVT-49 - Seal the files attached to Jira issues

- type: Improvement; status: Done (Done); fixVersion: 8.0.0; component: Jira issue attachments

> Sentinel Vault works on Jira issues. Once a site admin connects Jira (Atlassian Administration, Apps, Sites, your site, Connected apps, Sentinel Vault, then on the Connections tab connect Jira, listed as Jira Apps), every issue has a Sentinel Vault section in its right-hand column listing the issue's files. Anyone who can edit the issue can seal a file for a chosen time, with an optional note; the owner can extend or release it; while the site setting Allow space admins to force-unseal is on, a Jira or project admin can extend it or force-release it with a typed reason.
> Added in Sentinel Vault 8.0.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-50 - A sealed Jira file deleted by someone else is put back from Sentinel Vault's copy

- type: Improvement; status: Done (Done); fixVersion: 8.0.0; component: Jira issue attachments

> Sentinel Vault keeps a copy of every sealed Jira file (files up to 25 MB). If anyone but the owner deletes a file while its seal holds, the copy is uploaded back to the same issue under the same name, the seal moves to it, and a comment on the issue tells the person who deleted it (setting Tell editors when their change is undone, on by default; at most one comment per file every 10 minutes). Jira gives the put-back file a new attachment id, and its author is Sentinel Vault. It works once a site admin has connected Jira to Sentinel Vault in Atlassian Administration.
> Added in Sentinel Vault 8.0.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-51 - A sealed Jira file that could not be put back stays listed and is tried again

- type: Improvement; status: Done (Done); fixVersion: 8.0.0; component: Jira issue attachments

> If a sealed file cannot be put back (for example a temporary Jira error), the issue's Sentinel Vault section shows it as Not put back with a Put it back button, Sentinel Vault tries again on its own (after an hour, then less often, up to 10 times), and the expiry rules never delete that copy. If the same file keeps being deleted each time it is put back, for example by an automation rule, Sentinel Vault stops putting it back, keeps the copy, shows the file as Not put back and says so on the issue; anyone who can edit the issue puts it back with Put it back. It works once a site admin has connected Jira to Sentinel Vault in Atlassian Administration.
> Added in Sentinel Vault 8.0.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-52 - Deleting a Jira issue keeps its sealed files' copies for 30 days

- type: Improvement; status: Done (Done); fixVersion: 8.0.0; component: Jira issue attachments

> Deleting an issue cannot destroy a sealed file's copy. It is kept for 30 days and its owner can download it from My work in Confluence. It works once a site admin has connected Jira to Sentinel Vault in Atlassian Administration.
> Added in Sentinel Vault 8.0.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-53 - The site's seal settings apply to Jira too

- type: Improvement; status: Done (Done); fixVersion: 8.0.0; component: Jira issue attachments

> These site settings apply to Jira too: Default Seal Duration, Seals expire and the overdue reminders, Sign seal actions with an authenticator code, Allow space admins to force-unseal (on Jira it covers Jira and project admins), and the comment switches Page comments that mention people, Tell editors when their change is undone, and Expiry and release notices. Each issue's seal history is shown in its Sentinel Vault section and follows Delete old history. It works once a site admin has connected Jira to Sentinel Vault in Atlassian Administration.
> Added in Sentinel Vault 8.0.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-54 - REST API operations for Jira seals, and an issue property that lists them

- type: Improvement; status: Done (Done); fixVersion: 8.0.0; component: REST API

> Three REST content operations, seal-jira-attachment, extend-jira-attachment and release-jira-attachment, and an issue property, sentinel-vault-seals, that lists an issue's live seals without naming anyone. It works once a site admin has connected Jira to Sentinel Vault in Atlassian Administration.
> Added in Sentinel Vault 8.0.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-55 - The 8.0.0 update asks for three Jira permissions

- type: Improvement; status: Done (Done); fixVersion: 8.0.0; component: App permissions and updates

> The 8.0.0 update asks a site admin to approve three new permissions, read:jira-work, write:jira-work and read:jira-user, used only to read an issue's files, put a deleted sealed file back, comment on the issue, keep the sentinel-vault-seals issue property up to date, read people's names, and check Jira permissions. Until it is approved the site stays on the previous version, and nothing happens on Jira until Jira is connected. A site admin approves the update in Confluence administration, Apps, Manage apps.
> Added in Sentinel Vault 8.0.0.

### SVT-56 - Times read today, yesterday and tomorrow in words

- type: Improvement; status: Done (Done); fixVersion: 8.0.0; component: Layout and accessibility

> Times read today, yesterday and tomorrow in words instead of a weekday, and a time a full week away shows its date.
> Added in Sentinel Vault 8.0.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-60 - A new version uploaded by a seal's owner becomes the version the seal protects

- type: Bug; status: Done (Done); fixVersion: 8.0.0; component: Sealed files and sections

> A new version uploaded by a seal's owner is now the version the seal protects. Before, the next unauthorised change was undone back to the original file, losing the owner's update.
> Fixed in Sentinel Vault 8.0.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-62 - A lapsed seal on a deleted page was retried every hour and never released

- type: Bug; status: Done (Done); fixVersion: 8.0.0; component: Sealed files and sections

> A lapsed seal on a page that was deleted is now released. Before, its reminder could not be posted, so it was retried every hour and the seal was never released. On a site where Overdue reminders before release is 0 (seals are held, not released), the seal stays and its reminder is counted as given, so the hourly retries stop. On a page in the trash, the seal finishes its normal countdown.
> Fixed in Sentinel Vault 8.0.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-63 - A file deleted from the panel without a seal could not be sealed by someone else later

- type: Bug; status: Done (Done); fixVersion: 8.0.0; component: Sealed files and sections

> A file deleted from the panel without a seal no longer blocks someone else from sealing it later, and its permanent deletion no longer posts a violation notice.
> Fixed in Sentinel Vault 8.0.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-64 - Edit requests waiting on you were missing when Seals expire was off

- type: Bug; status: Done (Done); fixVersion: 8.0.0; component: Edit requests and access

> Edit requests waiting on you are listed even on sites where Seals expire is off, and space settings no longer show a file as sealed when it was only moved to the trash from the panel and never sealed.
> Fixed in Sentinel Vault 8.0.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-65 - A security update to a bundled library

- type: Improvement; status: Done (Done); fixVersion: 8.1.0; component: App permissions and updates

> The prosemirror-view library, which comes with Atlassian's own packages, is updated to 1.42.6 to close a published security advisory (GHSA-c8x8-7fp4-3x9w). Sentinel Vault's screens do not contain the affected code, so nothing about how the app works changes.
> Added in Sentinel Vault 8.1.0, which the Marketplace does not list; it comes with 8.5.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-66 - Stricter permission checks on purge, restore and force release

- type: Bug; status: Done (Done); fixVersion: 8.0.0; component: Sealed files and sections

> The permission checks on purging or restoring a deleted file, and on a space admin's force release, are stricter.
> Fixed in Sentinel Vault 8.0.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-67 - Clearing a lapsed seal from space settings cleans up everything it left behind

- type: Bug; status: Done (Done); fixVersion: 8.0.0; component: Space and site settings

> Clearing a lapsed seal from space settings now cleans up everything the seal left behind, and who may clear it is checked more strictly.
> Fixed in Sentinel Vault 8.0.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-68 - Each seal on a page stays in force until it is itself released

- type: Bug; status: Done (Done); fixVersion: 8.0.0; component: Sealed files and sections

> Each seal on a page keeps its own file protected until that seal is released or expires.
> Fixed in Sentinel Vault 8.0.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-69 - Seals held by an approval stay in force until the approval ends

- type: Bug; status: Done (Done); fixVersion: 8.0.0; component: Workflow and approvals

> While a page's approval holds its seals, they stay in force until the approval ends: a sealed file moved to the trash by anyone other than the page's approvers or a space admin is put back.
> Fixed in Sentinel Vault 8.0.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-70 - A copy of a sealed Jira file could be left behind when deleting it failed

- type: Bug; status: Done (Done); fixVersion: 8.2.0; component: Jira issue attachments

> If deleting the copy of a sealed Jira file failed, for example because of a temporary error, the copy was left behind. Sentinel Vault now tries again every hour until it is gone, and never deletes a copy a seal still uses.
> Fixed in Sentinel Vault 8.2.0, which the Marketplace does not list; it comes with 8.5.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-71 - On a site with thousands of sealed Jira files, some reminders, releases and clean-ups were never reached

- type: Bug; status: Done (Done); fixVersion: 8.2.0; component: Jira issue attachments

> On a site with thousands of sealed Jira files, the hourly check could stop before reaching every seal, so some reminders, releases and clean-ups of copies kept after an issue was deleted were never reached. Each check now continues from where the last one stopped.
> Fixed in Sentinel Vault 8.2.0, which the Marketplace does not list; it comes with 8.5.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-72 - A deleted issue's sealed file could not be downloaded if it was being put back at that moment

- type: Bug; status: Done (Done); fixVersion: 8.3.0; component: Jira issue attachments

> If a sealed Jira file was being put back at the moment its issue was deleted, its copy could not be downloaded from My work afterwards. Sentinel Vault now comes back for it once the put-back has finished, so its copy is kept for 30 days and its owner can download it from My work in Confluence, like the copies from any other deleted issue.
> Fixed in Sentinel Vault 8.3.0, which the Marketplace does not list; it comes with 8.5.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-73 - A sealed Jira file being put back showed as Not put back with a Put it back button

- type: Bug; status: Done (Done); fixVersion: 8.4.0; component: Jira issue attachments

> For the few seconds between someone deleting a sealed Jira file and Sentinel Vault putting it back, the issue's Sentinel Vault section showed the file as Not put back with a Put it back button. It now reads Being put back, offers no button, and refreshes on its own for up to a minute, so the file shows as back without reloading the page. Not put back is kept for a file that really could not be put back.
> Fixed in Sentinel Vault 8.4.0, which the Marketplace does not list; it comes with 8.5.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-74 - Sealing a Jira file again keeps the new seal's copy safe

- type: Bug; status: Done (Done); fixVersion: 8.5.0; component: Jira issue attachments

> When a Jira file is sealed again, Sentinel Vault first clears any clean-up still pending for an earlier seal's copy of that file, so the new seal's copy is never removed by it.
> Fixed in Sentinel Vault 8.5.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-75 - Let it go deletes a deleted issue's kept copy before the 30 days run out

- type: Improvement; status: Done (Done); fixVersion: 8.6.0; component: My work

> On My work, the person who sealed a file on a Jira issue that was later deleted can delete the kept copy themselves with Let it go, instead of waiting for the 30 days to run out. It works once a site admin has connected Jira to Sentinel Vault in Atlassian Administration.
> Added in Sentinel Vault 8.6.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-76 - Download the copy saves a deleted issue's file under its own name and type

- type: Improvement; status: Done (Done); fixVersion: 8.6.0; component: My work

> Download the copy on My work saves the file of a deleted Jira issue under its own name and file type. Sentinel Vault checks the copy against the file you sealed before saving it, and the row then says it was saved and that it is identical. It works once a site admin has connected Jira to Sentinel Vault in Atlassian Administration.
> Added in Sentinel Vault 8.6.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-77 - My work notices a Jira issue deleted after the page was opened

- type: Improvement; status: Done (Done); fixVersion: 8.6.0; component: My work

> My work reads its Jira list again when you come back to the tab and, for the first few minutes, every 15 seconds while it shows a live seal, so a file whose issue has just been deleted shows as Issue deleted without reloading the page. It works once a site admin has connected Jira to Sentinel Vault in Atlassian Administration.
> Added in Sentinel Vault 8.6.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-78 - The My work link and the space's Sentinel Vault page show the app's icon

- type: Improvement; status: Done (Done); fixVersion: 8.6.0; component: Layout and accessibility

> The Sentinel Vault — My work link in Confluence's Apps menu and the space's Sentinel Vault page now show the app's icon instead of a broken image.
> Added in Sentinel Vault 8.6.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-79 - Put it back keeps who really deleted a Jira file

- type: Bug; status: Done (Done); fixVersion: 8.6.0; component: Jira issue attachments

> When someone uses Put it back on a deleted Jira file, the seal's history says they asked for it to be put back, and neither the history nor the issue comment names them as the person who deleted it.
> Fixed in Sentinel Vault 8.6.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-80 - A sealed Jira file deleted a moment ago reads Being put back

- type: Bug; status: Done (Done); fixVersion: 8.6.0; component: Jira issue attachments

> For the first moment after a sealed Jira file is deleted, the issue's Sentinel Vault section shows it as Being put back, with no Put it back button. It shows Not put back only after a put-back has failed, or if the file is still not back after about a minute and a half.
> Fixed in Sentinel Vault 8.6.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-81 - Force-releasing a Jira file that was not put back says it deletes the last copy

- type: Bug; status: Done (Done); fixVersion: 8.6.0; component: Jira issue attachments

> When a Jira or project admin force-released a file that could not be put back, the dialog did not say that this deletes Sentinel Vault's last copy. It now says so, the button reads Delete the copy, and the seal's history records it.
> Fixed in Sentinel Vault 8.6.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-82 - Edits to Approved pages are undone as set, with or without named approvers

- type: Bug; status: Done (Done); fixVersion: 8.6.0; component: Workflow and approvals

> In a space set to undo edits to Approved pages, an edit by anyone who is not an approver or a space admin is undone, as the Workflow settings say, also when the space names no approvers.
> Fixed in Sentinel Vault 8.6.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-83 - A page approved right after its last edit stays Approved

- type: Bug; status: Done (Done); fixVersion: 8.6.0; component: Workflow and approvals

> An edit made before a page was approved no longer counts as a change to the approved page, so the page stays Approved and its author is not told that their edit moved it.
> Fixed in Sentinel Vault 8.6.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-84 - Edits to Approved pages are kept while Protect Sealed Attachments in Page Body is off

- type: Bug; status: Done (Done); fixVersion: 8.6.0; component: Workflow and approvals

> With Protect Sealed Attachments in Page Body turned off, Sentinel Vault no longer undoes edits to Approved pages or moves them back for review, and the Workflow settings, page banner, page details and approval dialog say Approved pages are not protected while it is off.
> Fixed in Sentinel Vault 8.6.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-85 - The page banner leaves Approved as soon as an edit moves the page back

- type: Bug; status: Done (Done); fixVersion: 8.6.0; component: Page banner and Sentinel Vault window

> After an edit moves an Approved page back for review, the page banner updates on its own instead of showing Approved until the page is reloaded.
> Fixed in Sentinel Vault 8.6.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-86 - The approver's page banner names the person who edited the page

- type: Bug; status: Done (Done); fixVersion: 8.6.0; component: Page banner and Sentinel Vault window

> The approver's page banner said an edit was made by someone outside the approvers. It now names the person.
> Fixed in Sentinel Vault 8.6.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-87 - Stricter checks on edits inside sealed sections

- type: Bug; status: Done (Done); fixVersion: 8.6.0; component: Sealed files and sections

> Stricter checks on edits inside sealed sections.
> Fixed in Sentinel Vault 8.6.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-88 - The page banner follows a workflow move made elsewhere, without a reload

- type: Bug; status: Done (Done); fixVersion: 8.10.0; component: Workflow and approvals

> A page's Sentinel Vault banner kept showing the workflow state it was opened with after the page was moved somewhere else, for example in another browser tab, and choosing a move from it only said Already in that state. The banner now follows a move made elsewhere within a few seconds, without a reload, and a move chosen from a banner that is out of date says which state the page is in and the banner then shows it.
> Fixed in Sentinel Vault 8.10.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-89 - Space admins are recognised from the space's own permissions

- type: Bug; status: Done (Done); fixVersion: 8.10.0; component: Space and site settings

> A space admin who was not also a site or Confluence admin, or listed under Space admins in Sentinel Vault, was treated as an ordinary user: the space's Sentinel Vault page asked them to request admin access, they could not approve as a space admin or use the other space admin actions, and an edit they made to an Approved page moved the page back out of Approved or was undone, as an ordinary editor's would be. Sentinel Vault now reads the space's own permissions, so a space admin is recognised whether the permission is given directly, through a group or through the space's Admin role. Space admins therefore now have Sentinel Vault's space admin actions in their spaces, as people listed under Space admins already did.
> Fixed in Sentinel Vault 8.10.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-90 - Stricter checks on who can see a space's scan status

- type: Bug; status: Done (Done); fixVersion: 8.7.0; component: Space and site settings

> Stricter checks on who can see a space's scan status.
> Fixed in Sentinel Vault 8.7.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-91 - Stricter checks on who can see Sentinel Vault's settings

- type: Bug; status: Done (Done); fixVersion: 8.8.0; component: Space and site settings

> Stricter checks on who can see Sentinel Vault's space and site settings, and on who can run an AI review of a page.
> Fixed in Sentinel Vault 8.8.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-92 - A page moved to another space after its workflow started holds still

- type: Improvement; status: Done (Done); fixVersion: 8.9.0; component: Workflow and approvals

> A page that was moved to another space after its workflow started now holds still: only an admin of both spaces or a site admin can change its state or approve an approval request opened before the move (anyone else can only decline or withdraw it), and an Approved page keeps its protection, with an unapproved edit undone. To hand the page to its new space, one of those admins starts its workflow again. Starting the workflow again starts the page from the first state of the new space's workflow.
> Added in Sentinel Vault 8.9.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-93 - Assigning a workflow again is refused while a page is Approved or awaiting approval

- type: Improvement; status: Done (Done); fixVersion: 8.9.0; component: Workflow and approvals

> Assigning a workflow to a page again is refused while the page is Approved or an approval request is open, as taking it out of the workflow already was.
> Added in Sentinel Vault 8.9.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-94 - Stricter checks on acting on a page after it moves to another space

- type: Bug; status: Done (Done); fixVersion: 8.9.0; component: Workflow and approvals

> Stricter checks on who can act on a page's seals, edit requests and workflow after the page moves to another space.
> Fixed in Sentinel Vault 8.9.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-95 - A file on a blog post is sealed on that blog post

- type: Bug; status: Done (Done); fixVersion: 8.9.0; component: Sealed files and sections

> A file on a blog post is now sealed on that blog post.
> Fixed in Sentinel Vault 8.9.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-96 - The Sentinel Vault panel always uses the app's own macro key

- type: Bug; status: Done (Done); fixVersion: 8.9.0; component: Page banner and Sentinel Vault window

> The Sentinel Vault panel always uses the app's own macro key when it is added to a page, and a page whose panel macro carried another key gets the Sentinel Vault panel back the next time the app adds its panel there.
> Fixed in Sentinel Vault 8.9.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-97 - The site's AI review settings apply to every space

- type: Improvement; status: Done (Done); fixVersion: 8.10.0; component: Space and site settings

> The site's AI review settings now apply to every space. While AI review is turned off in the site settings, it stays off in every space, whatever the space's own setting, and no space can have a bigger monthly AI budget than the site's. While AI is off for the site, a page in a space whose workflow requires an AI review before Approved cannot reach Approved, because the review cannot run; a space admin can turn that requirement off in the space's Workflow settings. A space's Validations and Workflow settings say when a site admin has turned AI off, and a save that asks for more AI than the site allows is recorded in the space's activity.
> Added in Sentinel Vault 8.10.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-98 - A declined admin access request can be sent again only after 48 hours

- type: Bug; status: Done (Done); fixVersion: 8.10.0; component: Edit requests and access

> A declined request for admin access to a space could be filed again before the 48 hours the space's Sentinel Vault page shows had passed (from a page opened before the decision). It can now be sent again only 48 hours after it was declined, the page says so if you try earlier, and a request has to name a space you can see.
> Fixed in Sentinel Vault 8.10.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-99 - AI review progress is shown only to the person who started it

- type: Bug; status: Done (Done); fixVersion: 8.10.0; component: Page banner and Sentinel Vault window

> The progress of an AI review of a page is now shown only to the person who started it.
> Fixed in Sentinel Vault 8.10.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-100 - The sentinel-vault-workflow page property adds reviewedVersion, the version that was approved

- type: Improvement; status: Done (Done); fixVersion: 8.11.0; component: REST API

> On an Approved page, the page property sentinel-vault-workflow (read with Confluence's REST API) now also says reviewedVersion, the version that was approved, and baselineVersion, the version later changes are checked against, with baselineKind and baselineContentOf saying why that version moved and which version's content it holds (empty where that was not recorded). A page approved before this update gets these fields the next time Sentinel Vault updates its workflow record, for example when the page is edited or moved. approvedVersion keeps the value it had, for scripts that already read it.
> Added in Sentinel Vault 8.11.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-101 - The Sentinel Vault status under the page title follows workflow moves made elsewhere

- type: Bug; status: Done (Done); fixVersion: 8.11.0; component: Workflow and approvals

> The Sentinel Vault status under the page title kept showing the workflow state the page was opened with after the page was moved to another workflow state somewhere else, for example in another browser tab, while the banner above it already followed the move. The status under the title now follows within a few seconds too, without a reload.
> Fixed in Sentinel Vault 8.11.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-102 - An Approved page whose unapproved edit was undone names the version that was approved

- type: Bug; status: Done (Done); fixVersion: 8.11.0; component: Workflow and approvals

> After Sentinel Vault restored an Approved page following an unapproved edit, the page's approval details said an approver or space admin had last updated the approved content in the restored version, and the page's activity, the comment to the editor, the banner and My work could name the restored copy as the approved version. They now name the version that was approved, and the approval details say the later version is Sentinel Vault's restored copy of it; when the version restored is one kept after the approval, such as an approver's or space admin's later change, they name that version and the approval it followed. Only a change an approver or space admin made is credited to them.
> Fixed in Sentinel Vault 8.11.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-103 - A permission change in Confluence reaches Sentinel Vault within a minute

- type: Improvement; status: Done (Done); fixVersion: 8.12.0; component: Space and site settings

> Sentinel Vault keeps what Confluence says about a space's admins and a person's groups for up to a minute, so a permission given or taken away in Confluence reaches Sentinel Vault within a minute.
> Added in Sentinel Vault 8.12.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-104 - A Confluence rate limit no longer makes space admins look like ordinary users

- type: Bug; status: Done (Done); fixVersion: 8.12.0; component: Workflow and approvals

> While Confluence was limiting requests from Sentinel Vault, space admins could be treated as ordinary users: Approve and Deny were hidden, space admin actions were refused, and an edit a space admin made to an Approved page could be undone or the page moved back out of Approved. The approver and group lists could also come back empty. Sentinel Vault now asks Confluence about permissions far less often, and the page banner, the approver and group pickers and most space admin actions now say when Confluence is busy and ask you to try again.
> Fixed in Sentinel Vault 8.12.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-105 - A page's activity names the person whose edit was undone, not an account ID

- type: Bug; status: Done (Done); fixVersion: 8.12.0; component: Activity report

> A page's Sentinel Vault activity could show the person whose edit was undone, or whose page was moved back out of Approved, as an account ID instead of their name. It now shows their name.
> Fixed in Sentinel Vault 8.12.0. A site still on version 7 or earlier gets it once a site admin approves the update in Confluence administration, Apps, Manage apps.

### SVT-106 - Turning off Page ribbon in Site settings does not hide the Sentinel Vault banner on pages

- type: Bug; status: Backlog; affects: 8.12.0; component: Space and site settings

> What you see: The Page ribbon switch says it controls the Sentinel Vault ribbon at the top of pages with sealed content. After you turn it off and apply, the banner still shows on pages with seals, a workflow or a classification level. On its own, the switch turns off only the recurring reminder banner for seals that do not expire. With Pop-up messages also off, the banner stops listing recent seal events.
> Where: Site settings, Settings tab, Alerts, Page ribbon.
> Workaround: None in Sentinel Vault. The banner shows only on pages that have something to show.
> Confirmed on Sentinel Vault 8.12.0. Status: open.

### SVT-107 - Turning off Allow space admins to force-unseal also takes away other admin actions

- type: Bug; status: Backlog; affects: 8.12.0; component: Space and site settings

> What you see: The switch's text says only that a space admin can release anyone's seal from the Sealed Files tab. While it is off, space admins and site admins also cannot open or change a space's workflow settings and workflows, see its Workflow status list, use Apply to existing pages, approve workflow pages as an admin, use Approve anyway on a failed content check, start an AI review, give or revoke edit access on other people's seals, or release other people's sealed sections. Space admins also cannot set their space's default classification level.
> Where: Site settings, Settings tab, Protection, Allow space admins to force-unseal.
> Workaround: Leave the switch on, or turn it on while you change these settings. Seal owners keep their own actions either way.
> Confirmed on Sentinel Vault 8.12.0. Status: open.

### SVT-108 - Turning off Protect Sealed Attachments in Page Body also turns off sealed section and Approved page protection

- type: Bug; status: Backlog; affects: 8.12.0; component: Space and site settings

> What you see: The switch's text describes only sealed images and files in the page body. While it is off, edits to sealed sections are not undone either, and Approved pages in a workflow are not protected from edits by people who are not approvers. The page banner and the space's Workflow tab say that Approved pages are not protected, but the switch itself mentions neither.
> Where: Site settings, Settings tab, Protection, Protect Sealed Attachments in Page Body.
> Workaround: Leave the switch on unless you mean to turn off all of these protections.
> Confirmed on Sentinel Vault 8.12.0. Status: open.

### SVT-109 - The Workflow tab can show the workflow as off, with default settings, when its settings could not be read

- type: Bug; status: Backlog; affects: 8.12.0; component: Workflow and approvals

> What you see: The space's Workflow tab can open with Enable document workflow off and no approvers although the workflow is on, with no message saying the settings could not be read. This always happens while Allow space admins to force-unseal is off in Site settings (Save workflow settings is then refused as well), and it can happen when loading fails for another reason; saving from that state would replace the real settings with the defaults shown. In Site settings, when the settings cannot be read, Unable to load preferences. Verify your access rights. appears above a form that shows default values.
> Where: Space settings, Workflow tab; Site settings, Settings tab.
> Workaround: If the tab looks reset, do not save: reload the page and check again. Keep Allow space admins to force-unseal on while you manage workflows.
> Confirmed on Sentinel Vault 8.12.0. Status: open.

### SVT-110 - With signed decisions required, Approve and Deny in the approvals list on My work always fail

- type: Bug; status: Backlog; affects: 8.12.0; component: Workflow and approvals

> What you see: In a space where Require a signed decision is on, pressing Approve or Deny under Approvals waiting on you answers Enter the current code from your authenticator to sign this decision (or, if you have no signature yet, asks you to set one up), and there is no place to type a code there.
> Where: My work, and the approvals list on the space's settings page, for pages in a space that requires signed decisions.
> Workaround: Open the page and decide from its banner, which asks you to Sign with your authenticator code.
> Confirmed on Sentinel Vault 8.12.0. Status: open.

### SVT-111 - The comment for an approved request leaves out the approver's reason

- type: Bug; status: Backlog; affects: 8.12.0; component: Workflow and approvals

> What you see: When an approver types a reason in Add a reason (optional) and approves, the page comment Sentinel Vault posts for the person who asked does not include the reason. A declined request's comment does include it.
> Where: The page comment posted when an approval request is approved, in a space that uses a Sentinel Vault workflow with page comments turned on.
> Workaround: The reason is shown in the page's Sentinel Vault activity, on the Approval given row.
> Confirmed on Sentinel Vault 8.12.0. Status: open.

### SVT-112 - Move to… in the Sentinel Vault window can keep offering moves from a state the page has already left

- type: Bug; status: Backlog; affects: 8.12.0; component: Workflow and approvals

> What you see: If the Sentinel Vault window stays open while the page is moved to another workflow state elsewhere, for example in another tab or by a colleague, Move to… still offers the moves from the state the window opened with. Picking the state the page is already in answers Already in that state, and a move you pick there is made from the state the page is in now, not the one the window shows. After any move you try, the window shows the page's current state.
> Where: The Sentinel Vault window opened from under the page title, Workflow section, Move to….
> Workaround: Close and reopen the window, or reload the page, before choosing a move. The workflow chip on the page banner follows moves made elsewhere.
> Confirmed on Sentinel Vault 8.12.0. Status: open.

### SVT-113 - Asking for approval again from a second tab sets approvers' decisions back to pending

- type: Bug; status: Backlog; affects: 8.12.0; component: Workflow and approvals

> What you see: If you ask for approval and then ask again from another tab or window that had not caught up with your first request, the request starts over: approvers who already approved are set back to pending and asked again.
> Where: The workflow chip on the page banner, or Move to… in the Sentinel Vault window, on a page waiting for approval.
> Workaround: Reload the page before asking again. If it already happened, the approvers need to approve again.
> Confirmed on Sentinel Vault 8.12.0. Status: open.

### SVT-114 - A page moved to another space can disappear from both spaces' Workflow status and Sealed Files lists

- type: Bug; status: Backlog; affects: 8.12.0; component: Space and site settings

> What you see: After a page with a Sentinel Vault workflow or sealed files is moved to another space, it no longer appears in the Workflow status list on either space's Workflow tab, and its sealed files can be missing from both spaces' Sealed Files tab.
> Where: Space settings, Workflow tab and Sealed Files tab, for pages moved between spaces.
> Workaround: The page's own banner and Sentinel Vault window still show its workflow state and seals, and each seal's owner still sees their files in My work.
> Confirmed on Sentinel Vault 8.12.0. Status: open.

### SVT-115 - A required heading rule's message reads Missing required a heading containing

- type: Bug; status: Backlog; affects: 8.12.0; component: Page banner and Sentinel Vault window

> What you see: When a page misses a required heading, the content check message reads, for example, Missing required a heading containing Security, Missing required an H2 heading., or Needs at least 2 of a heading containing Security (found 1). The rule itself works; only the wording is wrong.
> Where: The content check results on the page's Sentinel Vault panel, the page comment for a failed check, and the message when a workflow move is blocked by the content rules.
> Workaround: None needed: the message names the heading the page is missing.
> Confirmed on Sentinel Vault 8.12.0. Status: open.

### SVT-116 - While Confluence is limiting requests, some admin screens look empty or treat you as a non-admin instead of asking you to try again

- type: Bug; status: Backlog; affects: 8.12.0; component: Space and site settings

> What you see: When Confluence is limiting Sentinel Vault's requests, many space admin actions say Confluence is limiting requests right now and ask you to try again. Some screens still answer as if you were not an admin: Space settings can open with only My Sealed Files and a Request admin access button, the Sealed Files tab can say No sealed files discovered in the index., the Workflow tab can show the workflow as off with default settings, the Activity tab can say No activity recorded yet in this space for these filters., and the spaces list on the Classification tab in Site settings can say You do not administer any space.
> Where: Space settings (when it opens, and the Sealed Files, Workflow and Activity tabs); Site settings, Classification tab.
> Workaround: Wait a few minutes and reload. The screens show their content again once Confluence stops limiting requests.
> Why: Confluence limits how many requests an app may make in a period of time.
> Confirmed on Sentinel Vault 8.12.0. Status: open.

### SVT-117 - Unsaved changes on the Workflow and Validations tabs are lost without a warning

- type: Bug; status: Backlog; affects: 8.12.0; component: Space and site settings

> What you see: If you change workflow or validation settings and then switch tab, or press Edit the states, approvers and protection… or ← Back to workflow settings, your changes are gone without the Apply your changes first? question other settings tabs ask.
> Where: Space settings, Workflow and Validations tabs; Site settings, Validations tab.
> Workaround: Save before you leave the view: Save workflow settings, Save workflow, or Save validation rules.
> Confirmed on Sentinel Vault 8.12.0. Status: open.

### SVT-118 - Some drop-down lists in the settings cannot be used with the keyboard

- type: Bug; status: Backlog; affects: 8.12.0; component: Layout and accessibility

> What you see: You can reach these lists with Tab, but the keyboard either does not open them, or opens them without letting you pick an option.
> Where: Space settings, Workflow tab (Decision rule, what happens when an Approved page is edited by someone else, the state to move it back to, AI review strictness, a state's colour); the Validations tabs (rule type, severity, model, severity threshold); the Activity tab's Time range; the Sealed Files tab's sort order; panel setup (Items per page, Cards per row); Site settings, Classification tab (the space default level pickers and the level colour swatches).
> Workaround: Use a mouse or touch for these lists. For a level colour, open the swatch and type the colour's hex code in the field under the swatches.
> Confirmed on Sentinel Vault 8.12.0. Status: open.

### SVT-119 - The click to select link in the upload area cannot be reached with the keyboard

- type: Bug; status: Backlog; affects: 8.12.0; component: Layout and accessibility

> What you see: Tab skips click to select in the upload area (Drop files here or click to select on the panel, Drop a file here or click to select in the window), so someone using only the keyboard cannot pick a file to upload from Sentinel Vault.
> Where: The Sentinel Vault panel on the page, and the Sentinel Vault window.
> Workaround: Attach the file with Confluence's own attachment option; it then shows in Sentinel Vault.
> Confirmed on Sentinel Vault 8.12.0. Status: open.

### SVT-120 - The panel's collapse buttons have no readable name for screen readers

- type: Bug; status: Backlog; affects: 8.12.0; component: Layout and accessibility

> What you see: The buttons that open and close the AI Review, Validation, Sealed Sections and Activity groups are announced as a symbol, and do not name their group or say whether it is open.
> Where: The Sentinel Vault panel on the page.
> Workaround: None.
> Confirmed on Sentinel Vault 8.12.0. Status: open.

### SVT-121 - Dismissing an AI finding can look done when it was not saved

- type: Bug; status: Backlog; affects: 8.12.0; component: Page banner and Sentinel Vault window

> What you see: Dismiss or False positive hides the finding at once, but if you cannot edit the page, or the save fails, the finding comes back the next time the page loads. No message says it was not saved.
> Where: The Sentinel Vault panel on the page, AI Review group.
> Workaround: Ask someone who can edit the page to dismiss the finding.
> Confirmed on Sentinel Vault 8.12.0. Status: open.

### SVT-122 - The Seal expired warning in the full attachments view comes back after you close it

- type: Bug; status: Backlog; affects: 8.12.0; component: Sealed files and sections

> What you see: In the full attachments view, a Seal expired warning for each of your expired seals appears again whenever the file list refreshes, for example after you or someone else seals or releases a file, even after you close it.
> Where: The full attachments view: Open the full attachments view on the Attachments tab of the Sentinel Vault window.
> Workaround: Release or extend your expired seals; the warning stops once none of your seals on the page has expired.
> Confirmed on Sentinel Vault 8.12.0. Status: open.

### SVT-123 - On a phone, a drop-down list can open partly hidden at the top of the window

- type: Bug; status: Backlog; affects: 8.12.0; component: Layout and accessibility

> What you see: On a phone, a list opened near the bottom of the Sentinel Vault window can open with its top part hidden under the top edge of the window, and it does not move if you scroll while it is open.
> Where: The Sentinel Vault window and Seal attachments…, on a phone.
> Workaround: Scroll so the field sits in the middle of the screen, then open the list again.
> Confirmed on Sentinel Vault 8.12.0. Status: open.

### SVT-124 - A new page can miss its automatic workflow start if the first try fails

- type: Bug; status: Backlog; affects: 8.12.0; component: Workflow and approvals

> What you see: In a space with Auto-start workflow on new pages turned on, a page created while Confluence or Sentinel Vault had a passing error does not get the workflow, and Sentinel Vault does not try again or say so.
> Where: New pages in a space whose Workflow tab has Auto-start workflow on new pages turned on.
> Workaround: Press Apply to existing pages on the space's Workflow tab; it adds the workflow to pages that do not have it.
> Confirmed on Sentinel Vault 8.12.0. Status: open.

### SVT-125 - Access Control can leave out admin access requests in a space with many of them

- type: Bug; status: Backlog; affects: 8.12.0; component: Edit requests and access

> What you see: Access Control reads up to 50 admin access requests for a space, pending and declined together. In a space with more than that, some pending requests may not be listed.
> Where: Space settings, Access Control tab, Pending Access Requests.
> Workaround: Add the person directly as a space admin on the Access Control tab.
> Confirmed on Sentinel Vault 8.12.0. Status: open.

### SVT-126 - Some labels and buttons have white text on a light colour that is hard to read

- type: Bug; status: Backlog; affects: 8.12.0; component: Layout and accessibility

> What you see: Some labels and buttons put white text on cyan or amber, below the contrast normally needed for small text: the badge on a sealed section and the section dialog's buttons (light theme), the banner's read confirmation button, and the status pills and some counts on My work.
> Where: Sealed sections on pages, the page banner, and My work.
> Workaround: None.
> Confirmed on Sentinel Vault 8.12.0. Status: open.

### SVT-127 - Some colours offered for a classification level make the level name hard to read

- type: Bug; status: Backlog; affects: 8.12.0; component: Classification

> What you see: Light swatches such as orange, amber, yellow, green and cyan put white text on the level's chip and on the banner, which is hard to read.
> Where: Site settings, Classification tab, the levels list, colour of a level.
> Workaround: Pick a darker colour for the level, such as red, blue, purple, pink, slate or near-black.
> Confirmed on Sentinel Vault 8.12.0. Status: open.

### SVT-128 - Removing a classification level, or re-importing levels under new names, turns pages Unclassified without a warning

- type: Bug; status: Backlog; affects: 8.12.0; component: Classification

> What you see: Pages and spaces set to a level that is no longer in the list fall back to the space default or to Unclassified. Nothing warns you before you remove a level, and the import buttons do not say that pages set to a level that disappears will fall back.
> Where: Site settings, Classification tab: removing a level and pressing Save levels, or Levels from JSM Assets, Import or Re-import now.
> Workaround: Add the level back under the name it had when it was first created or imported. Pages that kept their setting then show the level again.
> Confirmed on Sentinel Vault 8.12.0. Status: open.

### SVT-129 - Linking classification levels to JSM Assets shows only an error code when Assets cannot be reached

- type: Bug; status: Backlog; affects: 8.12.0; component: Classification

> What you see: If Sentinel Vault cannot reach JSM Assets, the message is only a short status such as Assets workspace lookup answered 401, with no next step.
> Where: Site settings, Classification tab, Levels from JSM Assets.
> Workaround: Check that the site has Jira Service Management with Assets and that you can open Assets yourself, then try again.
> Confirmed on Sentinel Vault 8.12.0. Status: open.

### SVT-130 - Some lists say there is nothing to show when they could not load, or before they have loaded

- type: Bug; status: Backlog; affects: 8.12.0; component: My work

> What you see: My work can say Nothing is waiting on your approval. when the approvals list failed to load, and its approval signature card can say Not set up when the status could not be read. The space's Sealed Files tab shows No sealed files discovered in the index. until its list arrives, and Access Control can say No pending requests. when that list failed to load.
> Where: My work; Space settings, Sealed Files and Access Control tabs.
> Workaround: Wait a moment and reload the page before you rely on an empty list.
> Confirmed on Sentinel Vault 8.12.0. Status: open.

