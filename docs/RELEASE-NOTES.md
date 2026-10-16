# Sentinel Vault — release notes

GENERATED from `src/server/shared/release-notes.js` by `scripts/render-release-notes.mjs`. Do not edit.

## 8.6.0 — 2026-10-16

**A deleted Jira issue's sealed file downloads under its own name, and Approved pages are protected exactly as the settings say**

- New: on My work, the person who sealed a file on a Jira issue that was later deleted can now delete the kept copy themselves with Let it go, instead of waiting for the 30 days to run out.
- Changed: Download the copy on My work now saves the file of a deleted Jira issue under its own name and file type. Before, it arrived without a name or extension. Sentinel Vault checks the copy against the file you sealed before saving it, and the row then says it was saved and that it is identical.
- Changed: My work notices a Jira issue deleted after the page was opened. Before, a sealed file whose issue had just been deleted stayed listed as Sealed, with a link to the missing issue, until the page was reloaded. The list now reads itself again when you come back to the tab and, for the first few minutes, every 15 seconds while it shows a live seal.
- Changed: the Sentinel Vault — My work link in Confluence's Apps menu and the space's Sentinel Vault page now show the app's icon instead of a broken image.

Fixed:
- Put it back on a Jira file recorded the person who clicked it as the person who deleted the file. The history and the issue comment now keep who really deleted it, and the history says who asked for it to be put back.
- For the first moment after a sealed Jira file was deleted, the issue's Sentinel Vault section could still show it as Not put back with a Put it back button. It now reads Being put back while Sentinel Vault puts it back, and Not put back only if that fails or the file is still not back after about a minute and a half.
- When a Jira or project admin force-released a file that could not be put back, the dialog did not say that this deletes Sentinel Vault's last copy. It now says so, the button reads Delete the copy, and the seal's history records it.
- In a space set to undo edits to Approved pages but with no approvers named, an edit to an Approved page moved it back to Draft instead of being undone, although the Workflow settings said it would be undone. It is now undone.
- A page approved right after its last edit could move back to Draft on its own a few minutes later, and its author was told their edit had moved it. An edit made before the approval no longer counts as a change to the approved page.
- With Protect Sealed Attachments in Page Body turned off, the hourly check still moved Approved pages back or undid edits. It now leaves them alone, and the Workflow settings, page banner, page details and approval dialog say Approved pages are not protected while it is off.
- After an edit moved an Approved page back for review, the page banner kept showing Approved until the page was reloaded. It now updates on its own.
- The approver's page banner said an edit was made by someone outside the approvers. It now names the person.
- Stricter checks on edits inside sealed sections.

**Do this:** Nothing to do if your site already runs 8.0.0. A site on an earlier version gets this update after a site admin approves the 8.0.0 update in Confluence administration, Apps, Manage apps.

## 8.5.0 — 2026-10-11

**A sealed Jira file's copy is safe when the file is sealed again**


Fixed:
- In a rare case, the hourly retry of a failed copy delete could remove the copy belonging to a later seal on the same file. Sealing a file now clears any such retry first, and the two can no longer overlap.

**Do this:** Nothing to do if your site already runs 8.0.0. A site on an earlier version gets this update after a site admin approves the 8.0.0 update in Confluence administration, Apps, Manage apps.

## 8.4.0 — 2026-10-11

**A Jira file being put back says so**


Fixed:
- For the few seconds between someone deleting a sealed Jira file and Sentinel Vault putting it back, the issue's Sentinel Vault section showed the file as Not put back with a Put it back button. It now reads Being put back, offers no button, and refreshes on its own until the file is back. Not put back is kept for a file that really could not be put back.

**Do this:** Nothing to do if your site already runs 8.0.0. A site on an earlier version gets this update after a site admin approves the 8.0.0 update in Confluence administration, Apps, Manage apps.

## 8.3.0 — 2026-10-11

**A deleted issue's sealed files can always be downloaded**


Fixed:
- If a sealed Jira file was being put back at the moment its issue was deleted, its copy could not be downloaded from My work afterwards. Sentinel Vault now comes back for it once the put-back has finished.

**Do this:** Nothing to do if your site already runs 8.0.0. A site on an earlier version gets this update after a site admin approves the 8.0.0 update in Confluence administration, Apps, Manage apps.

## 8.2.0 — 2026-10-11

**Copies of sealed Jira files are always cleaned up**


Fixed:
- If deleting the copy of a sealed Jira file failed, for example because of a temporary error, the copy was left behind. Sentinel Vault now tries again every hour until it is gone, and never deletes a copy a seal still uses.
- On a site with thousands of sealed Jira files, the hourly check could stop before reaching every seal, so some reminders, releases and clean-ups of copies kept after an issue was deleted were never reached. Each check now continues from where the last one stopped.
- The 8.0.0 note gave a shortened path for connecting Jira. It now reads: Atlassian Administration, Apps, Sites, your site, Connected apps, Sentinel Vault, and on the Connections tab connect Jira (listed as Jira Apps).

**Do this:** Nothing to do if your site already runs 8.0.0. A site on an earlier version gets this update after a site admin approves the 8.0.0 update in Confluence administration, Apps, Manage apps.

## 8.1.0 — 2026-10-11

**A security update to a bundled library**

- Changed: prosemirror-view, a library that comes with Atlassian's own packages, is updated to 1.42.6 to close a published security advisory (GHSA-c8x8-7fp4-3x9w). Sentinel Vault's screens do not contain the affected code, so nothing about how the app works changes.

**Do this:** Nothing to do if your site already runs 8.0.0. A site on an earlier version gets this update after a site admin approves the 8.0.0 update in Confluence administration, Apps, Manage apps.

## 8.0.0 — 2026-10-11

**Seal Jira attachments: a sealed file on a Jira issue is put back if anyone else deletes it**

- New: Sentinel Vault works on Jira issues. Once a site admin connects Jira (Atlassian Administration, Apps, Sites, your site, Connected apps, Sentinel Vault, then on the Connections tab connect Jira, listed as Jira Apps), every issue has a Sentinel Vault section in its right-hand column listing the issue's files. Anyone who can edit the issue can seal a file for a chosen time, with an optional note; the owner can extend or release it; a Jira or project admin can extend it or force-release it with a typed reason.
- New: Sentinel Vault keeps a copy of every sealed Jira file (files up to 25 MB). If anyone but the owner deletes a file while its seal holds, the copy is uploaded back to the same issue under the same name, the seal moves to it, and a comment on the issue tells the person who deleted it (setting Tell editors when their change is undone, on by default; at most one comment per file every 10 minutes). Jira gives the put-back file a new attachment id, and its author is Sentinel Vault.
- New: if a sealed file cannot be put back (for example a temporary Jira error), the issue's section shows it as Not put back with a Put it back button, Sentinel Vault retries on its own (after an hour, then less often, up to 10 times), and the expiry rules never delete that copy. If something deletes the same file again each time it is put back, Sentinel Vault stops after three times within an hour and says so on the issue.
- New: deleting an issue cannot destroy a sealed file's copy. It is kept for 30 days and its owner can download it from My work in Confluence.
- New: these site settings apply to Jira too: Default Seal Duration, Seals expire and the overdue reminders, Sign seal actions with an authenticator code, Allow space admins to force-unseal (on Jira it covers Jira and project admins), and the comment switches Page comments that mention people, Tell editors when their change is undone, and Expiry and release notices. Each issue's seal history is shown in its section and follows Delete old history.
- New: three REST content operations, seal-jira-attachment, extend-jira-attachment and release-jira-attachment, and an issue property, sentinel-vault-seals, that lists an issue's live seals without naming anyone.
- New permissions: this update asks a site admin to approve read:jira-work, write:jira-work and read:jira-user, used only to read an issue's files, put a deleted sealed file back, comment on the issue, keep the sentinel-vault-seals issue property up to date, read people's names, and check Jira permissions. Nothing happens on Jira until Jira is connected.
- Changed: times read today, yesterday and tomorrow in words instead of a weekday, and a time a full week away shows its date.

Fixed:
- The permission checks on purging or restoring a deleted file, and on a space admin's force release, are stricter.
- Clearing a lapsed seal from space settings now cleans up everything the seal left behind, and who may clear it is checked more strictly.
- Each seal on a page now stays in force until that seal itself is released or expires.
- A new version uploaded by a seal's owner is now the version the seal protects. Before, the next unauthorised change was undone back to the original file, losing the owner's update.
- While a page's approval holds its seals, they stay in force until the approval ends: a sealed file moved to the trash by anyone other than the page's approvers or a space admin is put back.
- A lapsed seal on a page that was deleted is now released, unless Overdue reminders before release is set to 0, which keeps seals. Before, its reminder could not be posted, so it was retried every hour and the seal was never released. On a page in the trash, the seal now finishes its normal countdown.
- A file deleted from the panel without a seal no longer blocks someone else from sealing it later, and its permanent deletion no longer posts a violation notice.
- Edit requests waiting on you are listed even on sites where Seals expire is off, and space settings no longer show a file as sealed when it was only moved to the trash from the panel and never sealed.

**Do this:** A site admin approves the update in Confluence administration, Apps, Manage apps. To use it on Jira, connect it in Atlassian Administration: Apps, Sites, your site, Connected apps, Sentinel Vault, and on the Connections tab connect Jira (listed as Jira Apps).

## 7.1.0 — 2026-10-07

**Sentinel Vault works better on phones, tablets and smaller laptop screens**

- Changed: file cards in space settings, the attachments view and the page panel no longer cut a file's name short to fit their buttons, on phones, tablets and laptops. A card keeps its buttons on the same line as the name when both fit and moves them under the name when they do not. On wide screens the attachments view shows up to five columns instead of three stretched cards. The panel's Cards per row setting is now a maximum, because a card is never narrower than about 340 px, so a panel set to 3 per row shows 2 on a standard-width page.
- Changed: the page banner fits a phone, and nothing overlaps its Open button. To make room, a banner narrower than about 860 px (phones, most tablets, narrow windows) no longer shows the Validation and AI check chips, and below about 720 px it also leaves out the approval and review-date chip. The review date and approval record are still in the window Open shows. Validation and AI check results are in the Sentinel Vault panel on pages that have one.
- Changed: the Sentinel Vault window (Open on the banner, or Sentinel Vault under the page title) and Seal attachments lay out for a phone's width, their menus open where you can see them, and while you tick files the Seal button stays pinned in view without covering the file you just ticked. On a phone only Open on the banner fills the screen. Opened from under the page title or from Seal attachments… in the page menu, the window keeps a fixed height, and on a phone held sideways you scroll down to reach the Seal button.
- Changed: space and site settings fit tablets and narrow windows. On a phone, Confluence still shows these pages wider than the screen, so you scroll sideways, but their dialogs and the Not applied yet reminder open in the part you can see. The tabs wrap into even rows instead of leaving one tab alone on a line, the Activity, API access and backup tables turn into stacked rows instead of scrolling sideways, the Workflow tab lists its first 20 pages and API access its newest 10 jobs with a Show all link, revoked API tokens are folded behind a link that shows them, and on wide screens the settings keep a readable width.
- Changed: buttons, checkboxes, switches and chips are bigger on phones and tablets, most small labels and badges are now at least 11 px, and in dark mode the text on cyan and red buttons is readable.

Fixed:
- API access and the Activity report showed some people as an account ID. They now show the person's name. When Atlassian returns no name for an account, the Activity report says Someone and API access leaves the name out.
- The Not applied yet reminder could cover the setting you had just changed, such as a new validation rule's pickers. It now appears near that setting without covering any button or field, and nothing on the page moves when it appears.
- A sealed section further down a page could show "could not display this section's text" if you reached it more than about 15 seconds after the page opened. It now waits until you reach it and shows its content.

**Do this:** Nothing to do if your site already runs 7.0.0. A site still on an earlier version gets this update after a site admin approves the 7.0.0 update in Confluence administration, Apps, Manage apps.

## 7.0.0 — 2026-10-05

**The weekly personal-data check now asks Atlassian about closed accounts, and the app asks for fewer permissions**

- New permission: this update asks a site admin to approve one new permission, reporting personal data to Atlassian. Until it is approved the site stays on the previous version.
- Changed: once approved, the weekly personal-data check sends Atlassian the ids of the accounts Sentinel Vault stores, each at most once per Atlassian's reporting cycle (7 days unless Atlassian sets another period). When Atlassian answers that an account was closed, the app erases that person everywhere it keeps them, including the backup. When it answers that an account changed, the app refreshes the stored name.
- Changed: the first check runs within a day of the update, and each account is then checked every 7 days on the day, or on the period Atlassian asks for. If Atlassian refuses a check, it is tried again the next day instead of a week later.
- Note: sealed sections are the record of what was sealed and are never rewritten. A closed account mentioned inside sealed content stays mentioned there, as in Confluence's own page history; everything else the app keeps about that person is erased once, and is erased again only if a restore brings it back.
- Changed: Sentinel Vault asks for fewer permissions. It no longer requests 12 it held but did not use: read:confluence-space.summary, read:confluence-props, read:content:confluence, write:content:confluence, write:attachment:confluence, read:comment:confluence, read:content.property:confluence, write:content.property:confluence, read:content.restriction:confluence, write:content.restriction:confluence, read:content.metadata:confluence and read:content.permission:confluence. Everything the app did with them it already does through the permissions it keeps, so nothing it does changes.
- Kept on purpose: read:confluence-content.summary, because Confluence only tells the app about page and attachment changes with it, and read:label:confluence, which the page label check uses.

Fixed:
- The weekly check could not ask Atlassian about closed or changed accounts, because the app did not hold the permission for it.

**Do this:** A site admin approves the update in Confluence administration, Apps, Manage apps. Nothing else to do.

## 6.11.0 — 2026-10-04

**Email addresses brought back by a restore are cleaned again**

- Changed: the weekly personal-data check removes stored email addresses from seal records and approver lists every week, not only the first time, so addresses that a restore or import of an older backup brought back are cleaned too.

**Do this:** Nothing to do.

## 6.10.0 — 2026-10-04

**Viewing a page no longer triggers a backup, so a deleted backup stays deleted**

- Changed: opening a page no longer schedules a backup. A backup is scheduled only after a change, or when the page check actually puts protected text back.
- Changed: after Delete the backup, the weekly personal-data check and backups queued before the delete no longer take a new one. Only the next change in the app or over REST, or Back up now, does.

Fixed:
- Delete the backup could be undone within minutes by someone opening a page.
- A backup file is counted as deleted only once it is purged from the trash, and a second Delete finishes files an interrupted delete left in the trash.

**Do this:** Nothing to do.

## 6.9.0 — 2026-10-04

**Delete the backup stays deleted, and approver lists no longer keep email addresses**

- Changed: after Delete the backup, the hourly check no longer takes a new backup on its own. A new one is taken only after your next change, or when you press Back up now, and the Backup tab says when the backup was deleted.
- Changed: approver lists in workflow settings no longer store the approver's email address. The people picker still shows it while you search. Lists saved earlier are cleaned by the weekly check.

Fixed:
- Deleting the backup before an uninstall could be undone within the hour by an automatic backup on a new page.
- The Delete the backup dialog said nothing could bring the setup back after an uninstall; an export you downloaded, or Atlassian re-linking the app within 21 days, still can.

**Do this:** Nothing to do.

## 6.7.0 — 2026-10-04

**Privacy and retention: an optional keep period for history, and less personal data stored**

- New: Site settings, Privacy and retention. Turn on "Delete old history" to have activity history, workflow history and read confirmations older than "Keep history for" (730 days unless you change it) deleted by a weekly check. It is off unless you turn it on, so nothing is deleted on upgrade.
- New: the weekly check can be run at once from the same place, and over the REST API (operation privacy-sweep, admin tokens).
- Changed: authenticator codes for signed actions are now stored as encrypted secrets. Nobody has to set them up again; each moves across the first time it is used.
- Changed: Sentinel Vault no longer stores the email address of the person who seals a file or section, and the seal marker on a page now carries only who sealed it and when. Older markers are rewritten by the weekly check.
- Changed: Delete the backup now deletes every backup file for good before the emptied page goes to the space trash, and says so when something could not be removed.
- New: Documentation and Support links at the top of Site settings.

Fixed:
- Delete the backup used to report success while the backup page stayed where it was.
- Read confirmations and approvals that name a group now reach the group's members.
- A sealed file deleted for good is now recognised as gone, so its seal record is cleaned up.

**Do this:** If your records policy sets a keep period for history, turn on Delete old history in Site settings, Privacy and retention and set it there.

## 6.6.0 — 2026-10-02

**Your setup survives an uninstall: automatic backup, restore, export and import**

- New: Backup and restore in Site settings. Sentinel Vault backs up your settings, seals, sealed sections, workflows, validation rules, classification and history after each change in the app or REST API and once a day, to a Confluence page restricted to the app.
- New: after a reinstall, or when the app comes back after a lapsed subscription, Site settings offer "Restore your setup from [date]" with a preview of what comes back. Things that act on their own (seals expiring, validation revert, AI review, workflow auto-assign and review timers) come back paused until you turn them on.
- New: download the whole setup as one JSON file and import it back later.
- New: REST operations backup, restore, export, import, rediscover, resume-automations and backup-location, for admin tokens.
- Changed: uninstalling no longer erases the app's stored data on the spot. Atlassian keeps it for 28 days, so LeanZero can still ask Atlassian to re-link it within 21 days.

Fixed:
- Dialogs opened from low on a long page (Site settings, space settings, page panels) now open fully on screen, with their buttons in view.

**Do this:** Open Site settings, Backup and restore, once after the update and check that the first backup is there. REST API tokens and authenticator codes are never backed up; after a restore, create new tokens and ask people who sign actions to enroll again.

## 6.5.0 — 2026-09-30

**REST API: give, revoke and decline edit access now work**


Fixed:
- The REST operations that give, revoke and decline edit access to sealed files and sections now run. In 6.4.0 they were accepted but every job failed with "No resolver". Resubmit any failed job with a new Idempotency-Key.

_Written after the release, from the Marketplace listing text._

## 6.4.0 — 2026-09-30

**Always-visible classification, honest Force release, clearer sealed-files panel**

- New: every page shows its classification level. Raising it is one action; lowering it asks for a reason.
- Improved: Force release is offered only to space admins when "Allow space admins to force-unseal" is on.
- Improved: Sealed and Available files page separately, counts match the cards, and a file you just sealed or released moves to the top of its group.
- A declined edit request can be retried after a site-configurable cooldown (default 1 hour).
- Seal actions can require a 6-digit authenticator code (site setting).

_Written after the release, from the Marketplace listing text._
