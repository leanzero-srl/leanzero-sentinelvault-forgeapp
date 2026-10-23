# Sentinel Vault — release notes

GENERATED from `src/server/shared/release-notes.js` by `scripts/render-release-notes.mjs`. Do not edit.

## 8.21.0 — 2026-10-23

**A deleted page keeps its name in the Activity history for admins, and page classification works with Confluence's own levels**


Fixed:
- When a page has been deleted for good, the Activity tab of its space still shows the title the page had when each event was recorded, to Confluence site admins and admins of that space. Events recorded before this version still show the page's ID. Fixes SVT-148.
- On sites that use Confluence's own classification levels, choosing a level for a page, or choosing to follow the space default, works again. Raising a level no longer asks for the reason meant for lowering one, levels take their colour from the level's colour in Confluence, and a page that follows its space default says so. Levels below the space default, which Confluence does not allow on a page, are no longer offered (a level a page already holds stays shown), and when Confluence does not accept a change, Sentinel Vault says so and that nothing was changed. Fixes SVT-152.
- When Confluence confirms that Sentinel Vault has no space it can keep its backup page in (it sees no space, or refuses a page in every space it sees), automatic backups pause instead of failing every hour, and Backup and restore says why and how to choose a space. Fixes SVT-151.
- When Confluence is busy, a backup no longer starts a second backup page; it fails and tries again later. Fixes SVT-153.

## 8.20.0 — 2026-10-23

**Classification settings and the Activity history always use your own site's data**


Fixed:
- Sentinel Vault could answer a request with a result it had looked up for another Confluence site shortly before: the classification scheme and its levels, the space an activity event is filed under, or a person's display name in the Activity history. Each of these is now looked up for your own site and never reused from another site's request.
- Activity events recorded since 8.9.0 under a space key that is not a space on your site are moved in the background to the space their page is in now. Events that cannot be shown to be misfiled, including those under a key that holds events of several pages, are left as they are.
- When Confluence is limiting requests, the banner says Classification unavailable instead of Unclassified, a page's classification chip is left as it is, classification changes and lists say to try again instead of acting on an empty answer, and a configuration export fails instead of saving the classification as switched off or a space as having no default.

## 8.19.0 — 2026-10-22

**Your sealed files stay listed after their page is deleted, and the hourly workflow check always moves on**


Fixed:
- If the page a sealed file is on is deleted permanently from the space's trash, the file now stays listed under Files you hold sealed in My work and under My Sealed Files in space settings, marked unavailable or missing, and you can release its seal from My Sealed Files as before. Fixes SVT-150.
- On sites with very many pages in workflows, the hourly workflow check could fail to finish and start again at the same place every hour, so pages later in the list could miss their review-date expiry and state-label updates. It now continues from the last page it checked and always moves on. Fixes SVT-149.

## 8.18.0 — 2026-10-22

**A page Sentinel Vault cannot read keeps its workflow and its history**


Fixed:
- When Sentinel Vault could not read a page, its hourly check removed the page's workflow state and its whole workflow history, as if the page had been deleted for good. A page Sentinel Vault cannot read now keeps its workflow state and history and stays off the workflow dashboard and the approvals list. Sentinel Vault cannot check a page while it cannot read it; once it can, the page is checked again, and an edit made in the meantime by someone other than an approver or space admin is undone or sent back for review.
- A seal whose time ran out on a page Sentinel Vault could not read was released at once, without the reminders. Its reminders and release now wait until Sentinel Vault can read the page again; a lapsed seal on a page deleted for good stays listed until its owner or a space admin releases it.
- The workflow dashboard says how many pages Sentinel Vault cannot read right now. Removing a workflow state or a label workflow is no longer held back by pages Sentinel Vault cannot read.
- On sites with more than 2,000 pages under workflow, the hourly check now works through all of them in turn, continuing where the previous check stopped; before, pages after the first 2,000 were never checked.

## 8.17.0 — 2026-10-22

**Approval requests finish once enough approvers decided, and the waiting counts match the lists**


Fixed:
- An approval request could stay open although enough approvers had decided, when Confluence was limiting Sentinel Vault's requests or answering with errors at the moment of the deciding approval, or when two approvers decided at the same time. Sentinel Vault now finishes such a request at one of its hourly checks once Confluence answers again. Fixes SVT-146.
- The total at the top of My work and the page banner's Waiting for you count now count exactly what the lists show: approval requests on pages you can't view or that are in the trash, proposed changes on pages you can't view, and approval requests whose AI review did not pass are no longer counted. The approvals list says how many wait in all when there are more than it shows, the total updates after you decide from that list, and when Confluence could not check some of them right now, My work says so. Fixes SVT-147.

## 8.16.0 — 2026-10-22

**Approval decisions count only from people who hold the right now and can view the page**

- Changed: a space admin's approval counts only while that person is still an admin of the page's space and the space still lets admins decide. When an approval from someone who is no longer a space admin is what would complete a request, the request says so, and the person who asked or a space admin can request it again.
- Changed: approving or declining an approval request, deciding a proposed change and Approve anyway on a page's validation status need permission to view the page. Approval requests and proposed changes on pages you can't view are no longer listed for you in My work. A new request, or a request asked again, that could never be completed because approvers can't view the page is refused, and the message says which approvers, or how many, can't view it.

Fixed:
- When a request's AI review passed while the approvers' rights could not be checked, the request could stay open for good. Sentinel Vault now completes it at the next hourly check after the rights can be checked, if its approvals still meet what it needs.

**Do this:** If an open approval request says an approval came from someone who is no longer a space admin, request it again so the current approvers can decide.

## 8.15.0 — 2026-10-21

**Validation statuses saved on pages before 8.14.0 no longer name anyone**


Fixed:
- A page's validation status saved before 8.14.0 still named, in the page's sentinel-vault-validation property, who had checked the page and who had approved it anyway. A one-time background job now removes those names from every page Sentinel Vault can read, including trashed pages and pages in archived spaces, and keeps the verdict. Confluence does not allow changes to an archived page, so an archived page is cleaned when it is restored from the archive, and the weekly privacy sweep checks those pages again. It works through about 3,000 pages an hour, so a large site can take a day or more. A page it cannot change is tried again a few times over the following hours, then skipped and counted in the app's logs. What the Sentinel Vault panel shows does not change. Erasing the data of a closed Atlassian account is not counted as finished until that job has finished.

**Do this:** Nothing to do.

## 8.14.0 — 2026-10-21

**Stricter protection for Approved pages and sealed sections, approvals decided by the current approvers, and trash actions that follow your Confluence permissions**

- Changed: restoring a file from the trash and deleting a file permanently from the Sentinel Vault panel now follow your own Confluence permissions, so you can only restore or permanently delete what Confluence itself lets you. The first time you do either, Atlassian may ask you to allow Sentinel Vault to act on your behalf. The Allow Attachment Restore from Page and Allow Seal Cleanup from Page settings now say clearly that Seal Cleanup deletes a file from the trash for good, and Seal Cleanup removes a file's records only once Confluence confirms the file is gone from its page. Restoring a file when a newer file with the same name is on the page now says to rename or remove that file first.
- Changed: only a space's current approvers can decide its open approval requests, and only their decisions count. When approvers are removed, the number of approvals a request needs can drop by up to the number removed; if that changes the outcome, the AI review alone does not complete the request. A request whose approvers changed says so and can be requested again with the current approvers, which starts its decisions afresh. The approval record shows which decisions counted, and a refusal names an approver group that could not be read.
- Changed: adding a seal to an Approved page is refused while a change to the page is being checked. The message says when to try again, or what to do when nothing will check the change. An approver or space admin who publishes an Approved page accepts what is on the page at that point.
- Changed: workflow settings that would move edited Approved pages back to a state the workflow cannot reach, or to a chosen state that is itself Approved or has an entry condition, or whose first state is itself Approved, are refused when you save them, with a message saying what to change.
- Changed: Sentinel Vault's own log lines no longer contain account IDs, personal space keys or error message text, only the kind of error and where in the app it happened.

Fixed:
- Only versions saved by a page's approvers or space admins, or by Sentinel Vault on top of those, can become an Approved page's approved version. Other edits are reverted or sent back for review unless an approver or space admin publishes the page after them, and an approver's later save is never undone by the review of an earlier edit.
- Sealed sections and Approved pages compare every part of their content, and a sealed section recovers a missing saved copy from the page history, or tells the seal's owner when it cannot.
- When a space set to move edited Approved pages back cannot make that move, the approved version is restored instead, the person who edited is told, and the page's activity records it.
- A configuration REST API job is shown as done only once its receipt is also on the space's page.
- Deleting or changing Sentinel Vault's page properties no longer switches off protection for sealed sections, sealed files on the page or Approved pages, or changes the validation status shown for a page. A page's validation status from before this update is checked again the first time someone opens the page's panel.

**Do this:** If your site turned on Allow Attachment Restore from Page or Allow Seal Cleanup from Page, people whom Confluence does not allow to restore or permanently delete a file are now refused. If an open approval request names someone who is no longer an approver, re-request it so the current approvers can decide. The sentinel-vault-validation page property no longer says who approved or checked a page, only that it was approved; a page keeps the old values until its status is next stored. A space admin's Approve anyway given before this update is not carried over, so approve those pages again if they still need it. Nothing else to do.

## 8.13.0 — 2026-10-21

**Sentinel Vault's logs say which action ran, and never hold your data**

- Changed: each action in Sentinel Vault, such as a button that seals, approves or saves, a REST API call or a background job someone started, now writes one line to the app's logs on the Atlassian platform: which action it was, from which screen, how it ended and how long it took, with the buttons pressed just before it. A line never holds names, account IDs, page or space names or keys, file names, page content or anything typed. Sites share an app's logs with its developer unless a site admin turns Logs access off for the app in Atlassian Administration, so when you report a problem we can see which action failed and where.

**Do this:** Nothing to do.

## 8.12.0 — 2026-10-18

**Space admins keep their rights while Confluence is limiting requests**

- Changed: Sentinel Vault keeps what Confluence says about a space's admins and a person's groups for up to a minute, so a permission given or taken away in Confluence reaches Sentinel Vault within a minute.

Fixed:
- While Confluence was limiting requests from Sentinel Vault, space admins could be treated as ordinary users: Approve and Deny were hidden, space admin actions were refused, and the approver and group lists came back empty. Sentinel Vault now asks Confluence far less often for each page view, and when Confluence is busy it says so and asks you to try again instead.
- A page's Sentinel Vault activity could show the person whose edit was undone or moved back for review as an account ID instead of their name. It now shows their name.

**Do this:** Nothing to do.

## 8.11.0 — 2026-10-18

**The status under the page title follows workflow moves, and a restored Approved page names the version that was approved**

- Changed: on an Approved page, the page property sentinel-vault-workflow (read with Confluence's REST API) now also says reviewedVersion, the version that was approved, and baselineVersion, the version later changes are checked against, with baselineKind and baselineContentOf saying why that version moved and whose content it holds (empty where that was not recorded). A page approved before this update gets these fields the next time Sentinel Vault updates its workflow record, for example when the page is edited or moved. approvedVersion keeps the value it had, for scripts that already read it.

Fixed:
- The Sentinel Vault status under the page title kept showing the workflow state the page was opened with after the page was moved somewhere else, while the banner above it already followed the move. The status under the title now follows within a few seconds too, without a reload.
- After Sentinel Vault restored an Approved page following an unapproved edit, the page's approval details said an approver or space admin had last updated the approved content in the restored version, and the page's activity, the comment to the editor, the banner and My work could name the restored copy as the approved version. They now name the version that was approved, and the approval details say the later version is Sentinel Vault's restored copy of it; when the version restored is one kept after the approval, such as an approver's or space admin's later change, they name that version and the approval it followed. Only a change an approver or space admin made is credited to them.

**Do this:** Nothing to do.

## 8.10.0 — 2026-10-18

**Space admins are recognised from the space's own permissions**

- Changed: the site's AI review settings now apply to every space. While AI review is turned off in the site settings, it stays off in every space, whatever the space's own setting, and no space can have a bigger monthly AI budget than the site's. While AI is off for the site, a page in a space whose workflow requires an AI review before Approved cannot reach Approved, because the review cannot run; a space admin can turn that requirement off in the space's Workflow settings. A space's Validations and Workflow settings say when a site admin has turned AI off, and a save that asks for more AI than the site allows is recorded in the space's activity.

Fixed:
- A space admin who was not also a site or Confluence admin, or listed under Space admins in Sentinel Vault, was treated as an ordinary user: the space's Sentinel Vault page asked them to request admin access, they could not approve as a space admin or use the other space admin actions, and an edit they made to an Approved page moved the page back out of Approved or was undone, as an ordinary editor's would be. Sentinel Vault now reads the space's own permissions, so a space admin is recognised whether the permission is given directly, through a group or through the space's Admin role. Space admins therefore now have Sentinel Vault's space admin actions in their spaces, as people listed under Space admins already did.
- A declined request for admin access to a space could be filed again before the 48 hours the space's Sentinel Vault page shows had passed (from a page opened before the decision). It can now be sent again only 48 hours after it was declined, the page says so if you try earlier, and a request has to name a space you can see.
- The progress of an AI review of a page is now shown only to the person who started it.
- A page's Sentinel Vault banner kept showing the workflow state it was opened with after the page was moved somewhere else, for example in another browser tab, and choosing a move from it only said Already in that state. The banner now follows a move made elsewhere within a few seconds, without a reload, and a move chosen from a banner that is out of date says which state the page is in and the banner then shows it.

**Do this:** If a space uses AI review while AI review is off in the site settings, AI review stops in that space with this update, and pages in a space whose workflow requires an AI review cannot reach Approved. To keep AI review, a site admin turns it on in Sentinel Vault's site settings, Validations.

## 8.9.0 — 2026-10-18

**Stricter checks on who can act on a page's seals and workflow after it moves**

- Changed: a page that was moved to another space after its workflow started now holds still: only an admin of both spaces or a site admin can change its state or approve an approval request opened before the move (anyone else can only decline or withdraw it), and an Approved page keeps its protection, with an unapproved edit undone. To hand the page to its new space, one of those admins starts its workflow again. Starting the workflow again starts the page from the first state of the new space's workflow.
- Changed: assigning a workflow to a page again is refused while the page is Approved or an approval request is open, as taking it out of the workflow already was.

Fixed:
- Stricter checks on who can act on a page's seals, edit requests and workflow after the page moves to another space.
- A file on a blog post is now sealed on that blog post.
- The Sentinel Vault panel always uses the app's own macro key when it is added to a page, and a page whose panel macro carried another key gets the Sentinel Vault panel back the next time the app adds its panel there.

**Do this:** Nothing to do if your site already runs 8.0.0. A site on an earlier version gets this update after a site admin approves the 8.0.0 update in Confluence administration, Apps, Manage apps. To hand a page that was moved to another space to its new space, an admin of both spaces or a site admin takes it out of the workflow in the page's Sentinel Vault details and starts it again there (an Approved page is first moved out of Approved, and an open approval request is decided or withdrawn first), or assigns its workflow again with the configuration REST API.

## 8.8.0 — 2026-10-17

**Stricter checks on who can see Sentinel Vault's settings**


Fixed:
- Stricter checks on who can see Sentinel Vault's space and site settings, and on who can run an AI review of a page.

**Do this:** Nothing to do if your site already runs 8.0.0. A site on an earlier version gets this update after a site admin approves the 8.0.0 update in Confluence administration, Apps, Manage apps.

## 8.7.0 — 2026-10-17

**Stricter checks on who can see a space's scan status**


Fixed:
- Stricter checks on who can see a space's scan status.

**Do this:** Nothing to do if your site already runs 8.0.0. A site on an earlier version gets this update after a site admin approves the 8.0.0 update in Confluence administration, Apps, Manage apps.

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
