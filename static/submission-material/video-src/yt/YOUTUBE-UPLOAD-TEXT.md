# Sentinel Vault YouTube uploads: titles, descriptions, chapters, tags

Built to the 2026 YouTube guidance (same rules as the CogniRunner uploads): titles 40 to 60 characters with the keyword first; the first 150 characters of each description carry the hook (all that shows before "Show more"); 200 to 350 words; Marketplace link right after the hook, then what you will learn, chapters from 00:00, watch next, resources, and three hashtags; 8 to 12 tags per video.

Watch-next links: replace `<url:key>` with the real YouTube URL once each video is uploaded (upload the ten tutorials first, then the compilation). Thumbnails are in `thumbnails/` with the same file stems.

Main link (all videos): https://marketplace.atlassian.com/apps/1034857304/sentinel-vault?hosting=cloud
Docs: https://leanzero.net/portfolio/sentinel-vault  ·  Source: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp

**Published 2026-09-30 (public, Leanzero SRL):** seal-file `BFDpA4Y1Tgk` · approval `SoYsOGB3J5Q` · edit-requests `TyW_js0qXbs` · auto-restore `8YFcmh_-MJg` · sealed-sections `I7VR1Cih9rg` · validations `aBFt6A9_8Oo` · site-protection `XYvwHigjkFg` · authenticator `-eUE8Hsdiik` · expiry-alerts `qHFShA4mu3E` · classification `taEynzBs3ew` · compilation `IGCvPP9RxZo`

## sentinel-vault-seal-file.mp4 (00:51)

Title (52 chars): Confluence Attachment Lock: Seal a File in One Click

Thumbnail: thumbnails/sentinel-vault-thumb-seal-file.png

Description (244 words, hook 133 chars):

```
Lock a Confluence attachment in one click: add the Sentinel Vault panel to a page, seal a file, and your colleagues see it as sealed.

Get Sentinel Vault on the Atlassian Marketplace: https://marketplace.atlassian.com/apps/1034857304/sentinel-vault?hosting=cloud

Confluence tracks who changed a file; it does not stop the change. In this tutorial two people work on the same page side by side. Gabriela edits the page, types /senti and inserts the Sentinel Vault panel under a heading. After publishing, the panel lists every attachment on the page, grouped into sealed and available files, with sealed sections and an activity log underneath. She clicks Seal on image (4).png and the card flips to Sealed by you. On Mihai's screen the same file now sits under Sealed by others with a Request edit button instead of an edit path.

What you will learn
- How to add the Sentinel Vault panel to a Confluence page
- How to seal an attachment from its card
- What a colleague sees on a file you have sealed

Chapters
00:00 Intro
00:19 Publish the page
00:31 Click Seal on image (4).png

Watch next
- Confluence Edit Requests: Approve or Decline Sealed Files: https://youtu.be/TyW_js0qXbs
- Confluence Attachment Overwritten? Sealed Files Revert: https://youtu.be/8YFcmh_-MJg
- Sentinel Vault for Confluence: 8 Features in 5 Minutes: https://youtu.be/IGCvPP9RxZo

Resources
Product page and documentation: https://leanzero.net/portfolio/sentinel-vault
User guide: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp/blob/main/docs/user-guide.md
Source code: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp

Sentinel Vault runs entirely on Atlassian Forge, so your content never leaves Atlassian. Built by LeanZero.

#Confluence #Atlassian #DocumentControl
```

Tags (10): Confluence attachment lock, lock file Confluence, Confluence file protection, Confluence attachments, Confluence Cloud, Atlassian Forge app, Sentinel Vault, Confluence admin tutorial, document control Confluence, Atlassian Marketplace

## sentinel-vault-edit-requests.mp4 (01:59)

Title (57 chars): Confluence Edit Requests: Approve or Decline Sealed Files

Thumbnail: thumbnails/sentinel-vault-thumb-edit-requests.png

Description (289 words, hook 135 chars):

```
Ask the owner of a sealed Confluence file for edit access, then approve, decline with a reason, or watch the file until it is released.

Get Sentinel Vault on the Atlassian Marketplace: https://marketplace.atlassian.com/apps/1034857304/sentinel-vault?hosting=cloud

A seal should not be a dead end. In this tutorial Mihai finds two files sealed by Gabriela and uses Request edit on both, with a short reason. Gabriela gets a comment and a toast, and each card shows Approve and Decline. She approves image (4).png, so Mihai is listed under Editors with access and his panel says Edit now with the time it lasts. She declines the other file with the word "No", and Mihai sees Declined, ask again at a set time, with her reason next to it. Then the roles flip: Mihai seals a file, Gabriela chooses Watch for release, and when Mihai releases it she gets a File Now Accessible notice.

What you will learn
- Requesting edit access to a sealed file, with a reason
- Approving, declining and revoking access as the owner
- Watching a sealed file so you know the moment it is free

Chapters
00:00 Intro
00:15 The owner is notified
00:27 Approve image (4).png
00:39 The requester can edit now
00:59 Declined · ask again later
01:11 Mihai seals image (3).png
01:31 Watch for release
01:47 Released: File Now Accessible

Watch next
- Confluence Attachment Lock: Seal a File in One Click: https://youtu.be/BFDpA4Y1Tgk
- Confluence Section Lock: Seal One Heading, Edit the Rest: https://youtu.be/I7VR1Cih9rg
- Sentinel Vault for Confluence: 8 Features in 5 Minutes: https://youtu.be/IGCvPP9RxZo

Resources
Product page and documentation: https://leanzero.net/portfolio/sentinel-vault
User guide: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp/blob/main/docs/user-guide.md
Source code: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp

Sentinel Vault runs entirely on Atlassian Forge, so your content never leaves Atlassian. Built by LeanZero.

#Confluence #Atlassian #Collaboration
```

Tags (10): Confluence edit request, Confluence permissions, Confluence file locking, Confluence approval, Confluence collaboration, Confluence Cloud, Atlassian Forge, Sentinel Vault, Confluence attachments, document control

## sentinel-vault-auto-restore.mp4 (00:59)

Title (54 chars): Confluence Attachment Overwritten? Sealed Files Revert

Thumbnail: thumbnails/sentinel-vault-thumb-auto-restore.png

Description (254 words, hook 134 chars):

```
A colleague uploads a new version over a sealed Confluence attachment. Sentinel Vault reverts it on its own and tells both people why.

Get Sentinel Vault on the Atlassian Marketplace: https://marketplace.atlassian.com/apps/1034857304/sentinel-vault?hosting=cloud

This is what a seal is for. Mihai opens the page's Attachments list and uploads a new version of Regim caini.pdf, a file Gabriela has sealed. For a moment the row shows him as the creator. Then Sentinel Vault puts the sealed version back: the top version is now created by Sentinel Vault with the comment "automatically reversed modifications", Mihai's ribbon says his change was reverted because the attachment is sealed by its owner, and a Seal Violation notification names both the owner and the editor. The comment on the page also says the editor's version is kept in the page history, so nothing is thrown away.

What you will learn
- What happens when someone overwrites a sealed attachment
- How the owner and the editor are both told
- Where the overwritten version still lives

Chapters
00:00 Intro
00:11 Upload a new version of the file
00:27 Sentinel Vault reverts it
00:47 The violation comment

Watch next
- Confluence Attachment Lock: Seal a File in One Click: https://youtu.be/BFDpA4Y1Tgk
- Confluence Section Lock: Seal One Heading, Edit the Rest: https://youtu.be/I7VR1Cih9rg
- Sentinel Vault for Confluence: 8 Features in 5 Minutes: https://youtu.be/IGCvPP9RxZo

Resources
Product page and documentation: https://leanzero.net/portfolio/sentinel-vault
User guide: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp/blob/main/docs/user-guide.md
Source code: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp

Sentinel Vault runs entirely on Atlassian Forge, so your content never leaves Atlassian. Built by LeanZero.

#Confluence #Atlassian #DocumentControl
```

Tags (10): Confluence attachment overwrite, Confluence file versioning, Confluence revert attachment, Confluence file protection, Confluence Cloud, Atlassian Forge, Sentinel Vault, document control Confluence, Confluence governance, Confluence admin

## sentinel-vault-sealed-sections.mp4 (02:05)

Title (56 chars): Confluence Section Lock: Seal One Heading, Edit the Rest

Thumbnail: thumbnails/sentinel-vault-thumb-sealed-sections.png

Description (274 words, hook 123 chars):

```
Lock one section of a Confluence page and keep the rest editable. Edits by others are undone until the owner approves them.

Get Sentinel Vault on the Atlassian Marketplace: https://marketplace.atlassian.com/apps/1034857304/sentinel-vault?hosting=cloud

Sometimes only part of a page must not change. Gabriela opens Seal a section in the Sentinel Vault panel, picks the heading 1. Introduction and seals it for one day. The seal covers the heading and the blocks under it; the rest of the page stays open. Mihai then edits that section and publishes. Sentinel Vault reverts the page to the sealed version, Gabriela's ribbon says an edit to her section was reverted automatically, and Mihai is told his text is kept in the page history. He uses Request edit on the section instead, Gabriela approves, and his next edit under the seal is kept.

What you will learn
- Sealing a heading and everything under it, with a duration
- What an unapproved edit to a sealed section looks like on both sides
- Requesting and granting edit access to a section

Chapters
00:00 Intro
00:15 Click Seal a section
00:27 Section sealed until tomorrow
00:55 The edit is reverted
01:09 Request edit on the section
01:25 The owner approves
01:37 Edit under the seal
01:58 The approved edit stays

Watch next
- Confluence Edit Requests: Approve or Decline Sealed Files: https://youtu.be/TyW_js0qXbs
- Confluence Page Approval: Draft to Approved, Enforced: https://youtu.be/SoYsOGB3J5Q
- Sentinel Vault for Confluence: 8 Features in 5 Minutes: https://youtu.be/IGCvPP9RxZo

Resources
Product page and documentation: https://leanzero.net/portfolio/sentinel-vault
User guide: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp/blob/main/docs/user-guide.md
Source code: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp

Sentinel Vault runs entirely on Atlassian Forge, so your content never leaves Atlassian. Built by LeanZero.

#Confluence #Atlassian #DocumentControl
```

Tags (10): Confluence section lock, Confluence page protection, lock part of Confluence page, Confluence restrictions, Confluence Cloud, Atlassian Forge, Sentinel Vault, Confluence governance, Confluence admin tutorial, document control

## sentinel-vault-validations.mp4 (02:15)

Title (53 chars): Confluence Content Rules: Require Headings and Labels

Thumbnail: thumbnails/sentinel-vault-thumb-validations.png

Description (277 words, hook 133 chars):

```
Require a heading or a label on Confluence pages. Sentinel Vault checks the page, lists what is missing, and passes once it is fixed.

Get Sentinel Vault on the Atlassian Marketplace: https://marketplace.atlassian.com/apps/1034857304/sentinel-vault?hosting=cloud

Content standards are easy to write down and hard to keep. In the space settings Validations tab we pick the enforcement (flag with a comment, mark pass or fail status, or revert non-compliant edits) and add a Require a heading rule named Demo. The panel re-checks the page and reports Issues found: a heading containing Demo is missing. After adding that heading in the editor and re-checking, the result is Passed. Then the same thing at site level: a Require labels rule for the label test. The page fails with Missing required label, the label is added through Confluence's Add labels dialog, and the re-check passes.

What you will learn
- Space and site validation rules and the three enforcement modes
- Reading Issues found on the page
- Fixing the page and re-checking until all checks pass

Chapters
00:00 Intro
00:11 Add a Require a heading rule
00:31 The page is checked
00:43 Add the heading in the editor
01:03 Re-check the page
01:19 Site settings: a site-wide rule
01:31 Label test is required
01:47 Add the label
02:03 Re-check: passed

Watch next
- Confluence Page Approval: Draft to Approved, Enforced: https://youtu.be/SoYsOGB3J5Q
- Confluence Admin: Force Release, Trash and Restore Settings: https://youtu.be/XYvwHigjkFg
- Sentinel Vault for Confluence: 8 Features in 5 Minutes: https://youtu.be/IGCvPP9RxZo

Resources
Product page and documentation: https://leanzero.net/portfolio/sentinel-vault
User guide: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp/blob/main/docs/user-guide.md
Source code: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp

Sentinel Vault runs entirely on Atlassian Forge, so your content never leaves Atlassian. Built by LeanZero.

#Confluence #Atlassian #Governance
```

Tags (10): Confluence content validation, Confluence page template rules, Confluence required labels, Confluence governance, Confluence quality, Confluence Cloud, Atlassian Forge, Sentinel Vault, Confluence admin, documentation standards

## sentinel-vault-approval.mp4 (02:12)

Title (53 chars): Confluence Page Approval: Draft to Approved, Enforced

Thumbnail: thumbnails/sentinel-vault-thumb-approval.png

Description (291 words, hook 128 chars):

```
Move a Confluence page from Draft to In Review to Approved. Once Approved, its sealed files and sections belong to the approval.

Get Sentinel Vault on the Atlassian Marketplace: https://marketplace.atlassian.com/apps/1034857304/sentinel-vault?hosting=cloud

Here is a document approval workflow from start to finish. From the page details, Gabriela moves the page from Draft to In Review, with validation already passed, and requests approval. Mihai gets an Approval requested comment and a toast, and decides right in the ribbon: any one approver can approve, and his approval is the deciding one. The page becomes Approved v50 with a review date. The sealed section now reads "Locked by the approval of this page, expiry paused", and the activity log explains that its sealed section and sealed file now belong to the approval. Unsealed text can still be edited normally. For a sealed file, Release is replaced by Propose a change, and the proposal waits for the approvers.

What you will learn
- Moving a page through Draft, In Review and Approved
- Approving from the page ribbon
- What happens to seals once a page is Approved

Chapters
00:00 Intro
00:11 Move to In Review
00:28 The approver is notified
00:40 Approve
00:56 Seals now belong to the approval
01:16 The activity explains it
01:32 Unsealed text stays editable
01:52 Propose a change to a sealed file
02:04 Waiting for the approvers

Watch next
- Confluence Content Rules: Require Headings and Labels: https://youtu.be/aBFt6A9_8Oo
- Confluence Section Lock: Seal One Heading, Edit the Rest: https://youtu.be/I7VR1Cih9rg
- Sentinel Vault for Confluence: 8 Features in 5 Minutes: https://youtu.be/IGCvPP9RxZo

Resources
Product page and documentation: https://leanzero.net/portfolio/sentinel-vault
User guide: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp/blob/main/docs/user-guide.md
Source code: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp

Sentinel Vault runs entirely on Atlassian Forge, so your content never leaves Atlassian. Built by LeanZero.

#Confluence #Atlassian #Compliance
```

Tags (10): Confluence approval workflow, Confluence page approval, Confluence document approval, Confluence review workflow, Confluence governance, Confluence Cloud, Atlassian Forge, Sentinel Vault, document control, Confluence compliance

## sentinel-vault-site-protection.mp4 (02:15)

Title (59 chars): Confluence Admin: Force Release, Trash and Restore Settings

Thumbnail: thumbnails/sentinel-vault-thumb-site-protection.png

Description (258 words, hook 130 chars):

```
Sentinel Vault site settings for Confluence admins: force-unseal, protecting sealed files in the page body, and trash and restore.

Get Sentinel Vault on the Atlassian Marketplace: https://marketplace.atlassian.com/apps/1034857304/sentinel-vault?hosting=cloud

A tour of the Protection section in Sentinel Vault's site settings, with the effect of each switch shown on a real page. Allow space admins to force-unseal adds Force release to the menu of a file sealed by someone else. Protect Sealed Attachments in Page Body is switched on next. With Allow attachment removal on, an unsealed file can be sent to the trash from its card; it then shows under Missing as In the trash, with who deleted it and when. With Allow attachment restore on, it can be restored straight from the panel. Allow seal cleanup completes the set.

What you will learn
- Where Sentinel Vault's site settings live in Confluence administration
- What force-unseal adds for space admins
- Deleting and restoring attachments from the panel

Chapters
00:00 Intro
00:31 Allow space admins to force-unseal
00:51 Force release in the card menu
01:07 Allow attachment removal
01:31 Delete an available file
01:47 The file shows as missing
01:59 Restore it from the panel

Watch next
- Confluence Seal Expiry, Reminders and Alerts: Set Up: https://youtu.be/qHFShA4mu3E
- Confluence Seal Actions Signed With an Authenticator Code: https://youtu.be/-eUE8Hsdiik
- Sentinel Vault for Confluence: 8 Features in 5 Minutes: https://youtu.be/IGCvPP9RxZo

Resources
Product page and documentation: https://leanzero.net/portfolio/sentinel-vault
User guide: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp/blob/main/docs/user-guide.md
Source code: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp

Sentinel Vault runs entirely on Atlassian Forge, so your content never leaves Atlassian. Built by LeanZero.

#Confluence #Atlassian #ConfluenceAdmin
```

Tags (10): Confluence admin settings, Confluence attachment restore, Confluence trash, Confluence space admin, Confluence administration, Confluence Cloud, Atlassian Forge, Sentinel Vault, Confluence governance, Confluence file protection

## sentinel-vault-authenticator.mp4 (00:37)

Title (57 chars): Confluence Seal Actions Signed With an Authenticator Code

Thumbnail: thumbnails/sentinel-vault-thumb-authenticator.png

Description (214 words, hook 117 chars):

```
Require a 6-digit authenticator code before a Confluence seal action goes through. One site switch in Sentinel Vault.

Get Sentinel Vault on the Atlassian Marketplace: https://marketplace.atlassian.com/apps/1034857304/sentinel-vault?hosting=cloud

For content where who did what matters, a click is not enough. With "Sign seal actions with an authenticator code" switched on in Sentinel Vault's site settings, a seal action on the page opens a Sign this action dialog. The user enters the current 6-digit code from their authenticator app, Sign and continue unlocks, the code is accepted and the panel refreshes with the action done. The last shot shows the site switch that turns this on, next to the other Protection settings.

What you will learn
- What the Sign this action dialog looks like
- Entering the authenticator code to complete a seal action
- Where the site switch lives

Chapters
00:00 Intro
00:11 The action asks for a code
00:25 Code accepted

Watch next
- Confluence Admin: Force Release, Trash and Restore Settings: https://youtu.be/XYvwHigjkFg
- Confluence Classification Levels: Set a Space Default: https://youtu.be/taEynzBs3ew
- Sentinel Vault for Confluence: 8 Features in 5 Minutes: https://youtu.be/IGCvPP9RxZo

Resources
Product page and documentation: https://leanzero.net/portfolio/sentinel-vault
User guide: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp/blob/main/docs/user-guide.md
Source code: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp

Sentinel Vault runs entirely on Atlassian Forge, so your content never leaves Atlassian. Built by LeanZero.

#Confluence #Atlassian #Security
```

Tags (10): Confluence authenticator, Confluence two-step verification, Confluence e-signature, Confluence audit, Confluence compliance, Confluence Cloud, Atlassian Forge, Sentinel Vault, document control, Confluence security

## sentinel-vault-expiry-alerts.mp4 (01:15)

Title (52 chars): Confluence Seal Expiry, Reminders and Alerts: Set Up

Thumbnail: thumbnails/sentinel-vault-thumb-expiry-alerts.png

Description (253 words, hook 133 chars):

```
Set how long Confluence seals last, when overdue reminders go out, and who is told what, then apply it all at once in Sentinel Vault.

Get Sentinel Vault on the Atlassian Marketplace: https://marketplace.atlassian.com/apps/1034857304/sentinel-vault?hosting=cloud

The Expiry and Alerts sections of Sentinel Vault's site settings, in one pass. First the cooldown before a declined edit request can be repeated, then the default seal duration, set to 24 hours (shown as 1 day). Changes collect in a Not applied yet bar, so nothing takes effect until you press Apply. Seals expire is switched on, which enables overdue reminders (set to 3) and the hours between them. Under Alerts, pop-up messages and the page ribbon go on, then Tell editors when their change is undone, then Page comments that mention people, which unlocks the violation, confirmation and expiry notices. One Apply and all changes are applied.

What you will learn
- Default seal duration and expiry
- Overdue reminders and the decline cooldown
- Which alerts reach owners and editors

Chapters
00:00 Intro
00:19 Changes wait for Apply
00:31 Turn on Seals expire
00:47 Alerts
00:59 Tell editors when a change is undone

Watch next
- Confluence Admin: Force Release, Trash and Restore Settings: https://youtu.be/XYvwHigjkFg
- Confluence Seal Actions Signed With an Authenticator Code: https://youtu.be/-eUE8Hsdiik
- Sentinel Vault for Confluence: 8 Features in 5 Minutes: https://youtu.be/IGCvPP9RxZo

Resources
Product page and documentation: https://leanzero.net/portfolio/sentinel-vault
User guide: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp/blob/main/docs/user-guide.md
Source code: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp

Sentinel Vault runs entirely on Atlassian Forge, so your content never leaves Atlassian. Built by LeanZero.

#Confluence #Atlassian #ConfluenceAdmin
```

Tags (10): Confluence notifications, Confluence reminders, Confluence admin settings, Confluence expiry, Confluence administration, Confluence Cloud, Atlassian Forge, Sentinel Vault, Confluence governance, document control

## sentinel-vault-classification.mp4 (01:28)

Title (53 chars): Confluence Classification Levels: Set a Space Default

Thumbnail: thumbnails/sentinel-vault-thumb-classification.png

Description (236 words, hook 129 chars):

```
Turn on classification levels in Confluence, give a space a default, and every page shows it. Lowering a level asks for a reason.

Get Sentinel Vault on the Atlassian Marketplace: https://marketplace.atlassian.com/apps/1034857304/sentinel-vault?hosting=cloud

Sentinel Vault's Classification tab ships four levels: Public, Internal, Confidential and Restricted. Switch classification on and every page shows its level under the title and in the ribbon. In Space defaults, WORK FOR HIRE is set to Confidential, and the page ribbon shows Confidential, from space default. Raising the default to Restricted is one action. Lowering it back to Internal asks why the content is less sensitive now, and the reason is kept in the activity log. After that, the page follows: Internal, from space default.

What you will learn
- Turning classification on for the site
- Setting a default level per space
- Why lowering a level needs a reason

Chapters
00:00 Intro
00:11 Every page shows its level
00:23 Pick a default for a space
00:47 The page shows it
01:04 Lowering needs a reason
01:20 The page follows

Watch next
- Confluence Seal Actions Signed With an Authenticator Code: https://youtu.be/-eUE8Hsdiik
- Confluence Page Approval: Draft to Approved, Enforced: https://youtu.be/SoYsOGB3J5Q
- Sentinel Vault for Confluence: 8 Features in 5 Minutes: https://youtu.be/IGCvPP9RxZo

Resources
Product page and documentation: https://leanzero.net/portfolio/sentinel-vault
User guide: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp/blob/main/docs/user-guide.md
Source code: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp

Sentinel Vault runs entirely on Atlassian Forge, so your content never leaves Atlassian. Built by LeanZero.

#Confluence #Atlassian #DataClassification
```

Tags (10): Confluence classification, Confluence data classification, Confluence confidential, Confluence sensitivity labels, Confluence compliance, Confluence Cloud, Atlassian Forge, Sentinel Vault, Confluence governance, information security

## sentinel-vault-compilation.mp4 (04:34)

Title (54 chars): Sentinel Vault for Confluence: 8 Features in 5 Minutes

Thumbnail: thumbnails/sentinel-vault-thumb-compilation.png

Description (272 words, hook 139 chars):

```
Seal files and sections, answer edit requests, auto-revert overwrites, enforce approvals and classification in Confluence. Real recordings.

Get Sentinel Vault on the Atlassian Marketplace: https://marketplace.atlassian.com/apps/1034857304/sentinel-vault?hosting=cloud

Sentinel Vault is document control for Confluence. This compilation walks through eight features in short chapters, each cut from the same real recordings as the full tutorials: sealing an attachment from the page panel, approving and declining edit requests, an overwritten file reverted automatically, sealing one section of a page, content rules that check headings, a page moving from In Review to Approved, seal actions signed with an authenticator code, and classification levels with a space default. Each chapter links to its full tutorial below.

What you will learn
- What each Sentinel Vault feature does on a real page
- How owners, editors and approvers each see it
- Where admins switch features on

Chapters
00:00 Sealed files
00:26 Edit requests
01:09 Auto-restore
01:46 Sealed sections
02:27 Content validation
02:53 Approval workflow
03:27 Authenticator
03:49 Classification

Watch next
- Confluence Attachment Lock: Seal a File in One Click: https://youtu.be/BFDpA4Y1Tgk
- Confluence Edit Requests: Approve or Decline Sealed Files: https://youtu.be/TyW_js0qXbs
- Confluence Attachment Overwritten? Sealed Files Revert: https://youtu.be/8YFcmh_-MJg
- Confluence Section Lock: Seal One Heading, Edit the Rest: https://youtu.be/I7VR1Cih9rg
- Confluence Content Rules: Require Headings and Labels: https://youtu.be/aBFt6A9_8Oo
- Confluence Page Approval: Draft to Approved, Enforced: https://youtu.be/SoYsOGB3J5Q
- Confluence Seal Actions Signed With an Authenticator Code: https://youtu.be/-eUE8Hsdiik
- Confluence Classification Levels: Set a Space Default: https://youtu.be/taEynzBs3ew

Resources
Product page and documentation: https://leanzero.net/portfolio/sentinel-vault
User guide: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp/blob/main/docs/user-guide.md
Source code: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp

Sentinel Vault runs entirely on Atlassian Forge, so your content never leaves Atlassian. Built by LeanZero.

#Confluence #Atlassian #DocumentControl
```

Tags (11): Confluence document control, Confluence file lock, Confluence approval workflow, Confluence classification, Confluence governance, Confluence Cloud, Atlassian Marketplace app, Atlassian Forge, Sentinel Vault, LeanZero, Confluence compliance
