# Sentinel Vault Public Tracker - verify file

Generated 2026-10-09T14:04:06.168Z by scripts/public-tracker/tracker.mjs verify.
Site https://leanzero-demo.atlassian.net. Project SVT (id 10278), permission scheme "Sentinel Vault Public Tracker permissions" (id 10265, used by: SVT), anonymous grants: BROWSE_PROJECTS.
Issues checked: 48 of 48. Verification failures: 0. Withheld release-note lines: 1.

## Counts

- status: Done 42; Backlog 6
- version: 6.4.0 5; 6.5.0 1; 6.6.0 6; 6.7.0 8; 6.9.0 4; 6.10.0 4; 6.11.0 1; 7.0.0 5; 7.1.0 8; open, affects 7.1.0 6
- component: Classification 1; Sealed files and sections 6; Edit requests and access 1; REST API 2; Backup and restore 13; Layout and accessibility 3; Privacy and personal data 8; Space and site settings 5; Workflow and approvals 1; App permissions and updates 2; Page banner and Sentinel Vault window 4; Activity report 1; My work 1
- type: Improvement 29; Bug 19
- versions in Jira: 6.4.0 released 2026-09-30, 6.5.0 released 2026-09-30, 6.6.0 released 2026-10-02, 6.7.0 released 2026-10-04, 6.9.0 released 2026-10-04, 6.10.0 released 2026-10-04, 6.11.0 released 2026-10-04, 7.0.0 released 2026-10-05, 7.1.0 released 2026-10-07

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

