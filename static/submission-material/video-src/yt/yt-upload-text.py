#!/usr/bin/env python3
# Generates UPLOAD-TEXT.md (titles, descriptions, chapters, tags) for the Sentinel Vault YouTube tutorials,
# from chapters.json (output-time chapters computed by remotion/chapters.mts replaying the real time-remap).
# Rules (2026 YouTube guidance, same as CogniRunner's pipeline), enforced by asserts:
#   title 40-60 chars, keyword first; hook <=150 chars (all that shows before "Show more"); 200-350 words;
#   order = hook -> Marketplace link -> what you will learn -> chapters from 00:00 (>=3, >=10 s apart)
#   -> watch next -> resources -> exactly 3 hashtags; 8-12 tags.
# Copy claims ONLY what is visible in the owner's 2026-09-30 recordings.
#   python3 yt-upload-text.py   ->  UPLOAD-TEXT.md here + ~/Downloads/SentinelVault-YouTube/UPLOAD-TEXT.md
import json, os, re
here = os.path.dirname(os.path.abspath(__file__))
CH = json.load(open(os.path.join(here, "chapters.json")))
# compilation: the title card and the first chapter are 6 s apart, so they merge into one 00:00 chapter
c = CH["compilation"]["chapters"]
CH["compilation"]["chapters"] = [["00:00", c[1][1]]] + c[2:]
MK = "https://marketplace.atlassian.com/apps/1034857304/sentinel-vault?hosting=cloud"
DOCS = "https://leanzero.net/portfolio/sentinel-vault"
GH = "https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp"
GUIDE = GH + "/blob/main/docs/user-guide.md"
FORGE = "Sentinel Vault runs entirely on Atlassian Forge, so your content never leaves Atlassian. Built by LeanZero."
V = {}
V["seal-file"] = dict(title="Confluence Attachment Lock: Seal a File in One Click",
 hook="Lock a Confluence attachment in one click: add the Sentinel Vault panel to a page, seal a file, and your colleagues see it as sealed.",
 body="""Confluence tracks who changed a file; it does not stop the change. In this tutorial two people work on the same page side by side. Gabriela edits the page, types /senti and inserts the Sentinel Vault panel under a heading. After publishing, the panel lists every attachment on the page, grouped into sealed and available files, with sealed sections and an activity log underneath. She clicks Seal on image (4).png and the card flips to Sealed by you. On Mihai's screen the same file now sits under Sealed by others with a Request edit button instead of an edit path.

What you will learn
- How to add the Sentinel Vault panel to a Confluence page
- How to seal an attachment from its card
- What a colleague sees on a file you have sealed""",
 watch=["edit-requests", "auto-restore", "compilation"],
 tags=["Confluence attachment lock", "lock file Confluence", "Confluence file protection", "Confluence attachments", "Confluence Cloud", "Atlassian Forge app", "Sentinel Vault", "Confluence admin tutorial", "document control Confluence", "Atlassian Marketplace"],
 hashtags="#Confluence #Atlassian #DocumentControl")
V["edit-requests"] = dict(title="Confluence Edit Requests: Approve or Decline Sealed Files",
 hook="Ask the owner of a sealed Confluence file for edit access, then approve, decline with a reason, or watch the file until it is released.",
 body="""A seal should not be a dead end. In this tutorial Mihai finds two files sealed by Gabriela and uses Request edit on both, with a short reason. Gabriela gets a comment and a toast, and each card shows Approve and Decline. She approves image (4).png, so Mihai is listed under Editors with access and his panel says Edit now with the time it lasts. She declines the other file with the word "No", and Mihai sees Declined, ask again at a set time, with her reason next to it. Then the roles flip: Mihai seals a file, Gabriela chooses Watch for release, and when Mihai releases it she gets a File Now Accessible notice.

What you will learn
- Requesting edit access to a sealed file, with a reason
- Approving, declining and revoking access as the owner
- Watching a sealed file so you know the moment it is free""",
 watch=["seal-file", "sealed-sections", "compilation"],
 tags=["Confluence edit request", "Confluence permissions", "Confluence file locking", "Confluence approval", "Confluence collaboration", "Confluence Cloud", "Atlassian Forge", "Sentinel Vault", "Confluence attachments", "document control"],
 hashtags="#Confluence #Atlassian #Collaboration")
V["auto-restore"] = dict(title="Confluence Attachment Overwritten? Sealed Files Revert",
 hook="A colleague uploads a new version over a sealed Confluence attachment. Sentinel Vault reverts it on its own and tells both people why.",
 body="""This is what a seal is for. Mihai opens the page's Attachments list and uploads a new version of Regim caini.pdf, a file Gabriela has sealed. For a moment the row shows him as the creator. Then Sentinel Vault puts the sealed version back: the top version is now created by Sentinel Vault with the comment "automatically reversed modifications", Mihai's ribbon says his change was reverted because the attachment is sealed by its owner, and a Seal Violation notification names both the owner and the editor. The comment on the page also says the editor's version is kept in the page history, so nothing is thrown away.

What you will learn
- What happens when someone overwrites a sealed attachment
- How the owner and the editor are both told
- Where the overwritten version still lives""",
 watch=["seal-file", "sealed-sections", "compilation"],
 tags=["Confluence attachment overwrite", "Confluence file versioning", "Confluence revert attachment", "Confluence file protection", "Confluence Cloud", "Atlassian Forge", "Sentinel Vault", "document control Confluence", "Confluence governance", "Confluence admin"],
 hashtags="#Confluence #Atlassian #DocumentControl")
V["sealed-sections"] = dict(title="Confluence Section Lock: Seal One Heading, Edit the Rest",
 hook="Lock one section of a Confluence page and keep the rest editable. Edits by others are undone until the owner approves them.",
 body="""Sometimes only part of a page must not change. Gabriela opens Seal a section in the Sentinel Vault panel, picks the heading 1. Introduction and seals it for one day. The seal covers the heading and the blocks under it; the rest of the page stays open. Mihai then edits that section and publishes. Sentinel Vault reverts the page to the sealed version, Gabriela's ribbon says an edit to her section was reverted automatically, and Mihai is told his text is kept in the page history. He uses Request edit on the section instead, Gabriela approves, and his next edit under the seal is kept.

What you will learn
- Sealing a heading and everything under it, with a duration
- What an unapproved edit to a sealed section looks like on both sides
- Requesting and granting edit access to a section""",
 watch=["edit-requests", "approval", "compilation"],
 tags=["Confluence section lock", "Confluence page protection", "lock part of Confluence page", "Confluence restrictions", "Confluence Cloud", "Atlassian Forge", "Sentinel Vault", "Confluence governance", "Confluence admin tutorial", "document control"],
 hashtags="#Confluence #Atlassian #DocumentControl")
V["validations"] = dict(title="Confluence Content Rules: Require Headings and Labels",
 hook="Require a heading or a label on Confluence pages. Sentinel Vault checks the page, lists what is missing, and passes once it is fixed.",
 body="""Content standards are easy to write down and hard to keep. In the space settings Validations tab we pick the enforcement (flag with a comment, mark pass or fail status, or revert non-compliant edits) and add a Require a heading rule named Demo. The panel re-checks the page and reports Issues found: a heading containing Demo is missing. After adding that heading in the editor and re-checking, the result is Passed. Then the same thing at site level: a Require labels rule for the label test. The page fails with Missing required label, the label is added through Confluence's Add labels dialog, and the re-check passes.

What you will learn
- Space and site validation rules and the three enforcement modes
- Reading Issues found on the page
- Fixing the page and re-checking until all checks pass""",
 watch=["approval", "site-protection", "compilation"],
 tags=["Confluence content validation", "Confluence page template rules", "Confluence required labels", "Confluence governance", "Confluence quality", "Confluence Cloud", "Atlassian Forge", "Sentinel Vault", "Confluence admin", "documentation standards"],
 hashtags="#Confluence #Atlassian #Governance")
V["approval"] = dict(title="Confluence Page Approval: Draft to Approved, Enforced",
 hook="Move a Confluence page from Draft to In Review to Approved. Once Approved, its sealed files and sections belong to the approval.",
 body="""Here is a document approval workflow from start to finish. From the page details, Gabriela moves the page from Draft to In Review, with validation already passed, and requests approval. Mihai gets an Approval requested comment and a toast, and decides right in the ribbon: any one approver can approve, and his approval is the deciding one. The page becomes Approved v50 with a review date. The sealed section now reads "Locked by the approval of this page, expiry paused", and the activity log explains that its sealed section and sealed file now belong to the approval. Unsealed text can still be edited normally. For a sealed file, Release is replaced by Propose a change, and the proposal waits for the approvers.

What you will learn
- Moving a page through Draft, In Review and Approved
- Approving from the page ribbon
- What happens to seals once a page is Approved""",
 watch=["validations", "sealed-sections", "compilation"],
 tags=["Confluence approval workflow", "Confluence page approval", "Confluence document approval", "Confluence review workflow", "Confluence governance", "Confluence Cloud", "Atlassian Forge", "Sentinel Vault", "document control", "Confluence compliance"],
 hashtags="#Confluence #Atlassian #Compliance")
V["site-protection"] = dict(title="Confluence Admin: Force Release, Trash and Restore Settings",
 hook="Sentinel Vault site settings for Confluence admins: force-unseal, protecting sealed files in the page body, and trash and restore.",
 body="""A tour of the Protection section in Sentinel Vault's site settings, with the effect of each switch shown on a real page. Allow space admins to force-unseal adds Force release to the menu of a file sealed by someone else. Protect Sealed Attachments in Page Body is switched on next. With Allow attachment removal on, an unsealed file can be sent to the trash from its card; it then shows under Missing as In the trash, with who deleted it and when. With Allow attachment restore on, it can be restored straight from the panel. Allow seal cleanup completes the set.

What you will learn
- Where Sentinel Vault's site settings live in Confluence administration
- What force-unseal adds for space admins
- Deleting and restoring attachments from the panel""",
 watch=["expiry-alerts", "authenticator", "compilation"],
 tags=["Confluence admin settings", "Confluence attachment restore", "Confluence trash", "Confluence space admin", "Confluence administration", "Confluence Cloud", "Atlassian Forge", "Sentinel Vault", "Confluence governance", "Confluence file protection"],
 hashtags="#Confluence #Atlassian #ConfluenceAdmin")
V["authenticator"] = dict(title="Confluence Seal Actions Signed With an Authenticator Code",
 hook="Require a 6-digit authenticator code before a Confluence seal action goes through. One site switch in Sentinel Vault.",
 body="""For content where who did what matters, a click is not enough. With "Sign seal actions with an authenticator code" switched on in Sentinel Vault's site settings, a seal action on the page opens a Sign this action dialog. The user enters the current 6-digit code from their authenticator app, Sign and continue unlocks, the code is accepted and the panel refreshes with the action done. The last shot shows the site switch that turns this on, next to the other Protection settings.

What you will learn
- What the Sign this action dialog looks like
- Entering the authenticator code to complete a seal action
- Where the site switch lives""",
 watch=["site-protection", "classification", "compilation"],
 tags=["Confluence authenticator", "Confluence two-step verification", "Confluence e-signature", "Confluence audit", "Confluence compliance", "Confluence Cloud", "Atlassian Forge", "Sentinel Vault", "document control", "Confluence security"],
 hashtags="#Confluence #Atlassian #Security")
V["expiry-alerts"] = dict(title="Confluence Seal Expiry, Reminders and Alerts: Set Up",
 hook="Set how long Confluence seals last, when overdue reminders go out, and who is told what, then apply it all at once in Sentinel Vault.",
 body="""The Expiry and Alerts sections of Sentinel Vault's site settings, in one pass. First the cooldown before a declined edit request can be repeated, then the default seal duration, set to 24 hours (shown as 1 day). Changes collect in a Not applied yet bar, so nothing takes effect until you press Apply. Seals expire is switched on, which enables overdue reminders (set to 3) and the hours between them. Under Alerts, pop-up messages and the page ribbon go on, then Tell editors when their change is undone, then Page comments that mention people, which unlocks the violation, confirmation and expiry notices. One Apply and all changes are applied.

What you will learn
- Default seal duration and expiry
- Overdue reminders and the decline cooldown
- Which alerts reach owners and editors""",
 watch=["site-protection", "authenticator", "compilation"],
 tags=["Confluence notifications", "Confluence reminders", "Confluence admin settings", "Confluence expiry", "Confluence administration", "Confluence Cloud", "Atlassian Forge", "Sentinel Vault", "Confluence governance", "document control"],
 hashtags="#Confluence #Atlassian #ConfluenceAdmin")
V["classification"] = dict(title="Confluence Classification Levels: Set a Space Default",
 hook="Turn on classification levels in Confluence, give a space a default, and every page shows it. Lowering a level asks for a reason.",
 body="""Sentinel Vault's Classification tab ships four levels: Public, Internal, Confidential and Restricted. Switch classification on and every page shows its level under the title and in the ribbon. In Space defaults, WORK FOR HIRE is set to Confidential, and the page ribbon shows Confidential, from space default. Raising the default to Restricted is one action. Lowering it back to Internal asks why the content is less sensitive now, and the reason is kept in the activity log. After that, the page follows: Internal, from space default.

What you will learn
- Turning classification on for the site
- Setting a default level per space
- Why lowering a level needs a reason""",
 watch=["authenticator", "approval", "compilation"],
 tags=["Confluence classification", "Confluence data classification", "Confluence confidential", "Confluence sensitivity labels", "Confluence compliance", "Confluence Cloud", "Atlassian Forge", "Sentinel Vault", "Confluence governance", "information security"],
 hashtags="#Confluence #Atlassian #DataClassification")
V["compilation"] = dict(title="Sentinel Vault for Confluence: 8 Features in 5 Minutes",
 hook="Seal files and sections, answer edit requests, auto-revert overwrites, enforce approvals and classification in Confluence. Real recordings.",
 body="""Sentinel Vault is document control for Confluence. This compilation walks through eight features in short chapters, each cut from the same real recordings as the full tutorials: sealing an attachment from the page panel, approving and declining edit requests, an overwritten file reverted automatically, sealing one section of a page, content rules that check headings, a page moving from In Review to Approved, seal actions signed with an authenticator code, and classification levels with a space default. Each chapter links to its full tutorial below.

What you will learn
- What each Sentinel Vault feature does on a real page
- How owners, editors and approvers each see it
- Where admins switch features on""",
 watch=["seal-file", "edit-requests", "auto-restore", "sealed-sections", "validations", "approval", "authenticator", "classification"],
 tags=["Confluence document control", "Confluence file lock", "Confluence approval workflow", "Confluence classification", "Confluence governance", "Confluence Cloud", "Atlassian Marketplace app", "Atlassian Forge", "Sentinel Vault", "LeanZero", "Confluence compliance"],
 hashtags="#Confluence #Atlassian #DocumentControl")
ORDER = ["seal-file", "edit-requests", "auto-restore", "sealed-sections", "validations", "approval", "site-protection", "authenticator", "expiry-alerts", "classification", "compilation"]
secs = lambda m: int(m[:2]) * 60 + int(m[3:])
out = ["# Sentinel Vault YouTube uploads: titles, descriptions, chapters, tags", "",
 "Built to the 2026 YouTube guidance (same rules as the CogniRunner uploads): titles 40 to 60 characters with the keyword first; the first 150 characters of each description carry the hook (all that shows before \"Show more\"); 200 to 350 words; Marketplace link right after the hook, then what you will learn, chapters from 00:00, watch next, resources, and three hashtags; 8 to 12 tags per video.", "",
 "Watch-next links: replace `<url:key>` with the real YouTube URL once each video is uploaded (upload the ten tutorials first, then the compilation). Thumbnails are in `thumbnails/` with the same file stems.", "",
 f"Main link (all videos): {MK}", f"Docs: {DOCS}  ·  Source: {GH}", ""]
for k in ORDER:
    v = V[k]; ch = CH[k]; t = v["title"]
    assert 40 <= len(t) <= 60, (k, "title", len(t))
    assert len(v["hook"]) <= 150, (k, "hook", len(v["hook"]))
    assert 8 <= len(v["tags"]) <= 12, (k, "tags")
    assert len(v["hashtags"].split()) == 3, (k, "hashtags")
    cs = ch["chapters"]
    assert cs[0][0] == "00:00" and len(cs) >= 3, (k, "chapters")
    assert all(secs(b[0]) - secs(a[0]) >= 10 for a, b in zip(cs, cs[1:])), (k, "chapter gap")
    chapters = "\n".join(f"{a} {b}" for a, b in cs)
    watch = "\n".join(f"- {V[w]['title']}: <url:{w}>" for w in v["watch"])
    desc = f"{v['hook']}\n\nGet Sentinel Vault on the Atlassian Marketplace: {MK}\n\n{v['body']}\n\nChapters\n{chapters}\n\nWatch next\n{watch}\n\nResources\nProduct page and documentation: {DOCS}\nUser guide: {GUIDE}\nSource code: {GH}\n\n{FORGE}\n\n{v['hashtags']}"
    words = len(desc.split()); assert 200 <= words <= 350, (k, "words", words)
    f = f"sentinel-vault-{k}.mp4"
    out += [f"## {f} ({ch['duration']})", "", f"Title ({len(t)} chars): {t}", "", f"Thumbnail: thumbnails/sentinel-vault-thumb-{k}.png", "", f"Description ({words} words, hook {len(v['hook'])} chars):", "", "```", desc, "```", "", f"Tags ({len(v['tags'])}): {', '.join(v['tags'])}", ""]
txt = "\n".join(out)
open(os.path.join(here, "YOUTUBE-UPLOAD-TEXT.md"), "w").write(txt)
dl = os.path.expanduser("~/Downloads/SentinelVault-YouTube"); os.makedirs(dl, exist_ok=True)
open(os.path.join(dl, "UPLOAD-TEXT.md"), "w").write(txt)
for k in ORDER: print(f"{k:16s} title {len(V[k]['title'])}  hook {len(V[k]['hook'])}")
