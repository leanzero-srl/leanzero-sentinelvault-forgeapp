/*
 * Sentinel Vault - the PUBLIC tracker's editorial layer.
 * Copyright (c) 2025-2026 LeanZero SRL.
 */

// One row per release-note line, keyed by the first 16 hex of sha256(line) (the same key the
// receipt and the issue property use, so a rerun never duplicates).
//   [title, component code, override]
// override:
//   { d: "public description" }  the issue text when the note line itself is not the right public
//                                 text (an admin step the note keeps in `action`, a rewrite).
//   { withhold: "why" }           the line is left out of the tracker entirely.
//   { fold: "<issue id>" }        the line is carried by another issue's description (its `d`
//                                 must include it); no issue of its own.
//   { id: "<old hash>" }          the note line was REWORDED after its issue was created: the row is
//                                 keyed by the new line's hash but keeps the issue made for the old
//                                 one (the receipt and the issue's svt.tracker property hold the old
//                                 hash). Without it a rewording creates a second issue. Combines with d.
// A note line with no row here is refused by `plan` (never published by accident).
// Without `d`, the description is the note line with its leading "New: ", "Changed: " or
// "Improved: " dropped (the issue type already says which).

export const COMPONENTS = {
  S: "Sealed files and sections",
  E: "Edit requests and access",
  P: "Page banner and Sentinel Vault window",
  C: "Space and site settings",
  W: "Workflow and approvals",
  L: "Classification",
  B: "Backup and restore",
  D: "Privacy and personal data",
  R: "REST API",
  M: "My work",
  A: "Activity report",
  G: "Layout and accessibility",
  I: "App permissions and updates",
  J: "Jira issue attachments",
};
// Every Jira FEATURE row (Improvement) works only once a site admin has connected Jira (8.0.0's
// action); rows whose note line does not say so carry this sentence in their description. A Jira FIX
// (8.2.0 on) affects only sites that already connected Jira, so it does not carry it.
const JIRA_ON = "It works once a site admin has connected Jira to Sentinel Vault in Atlassian Administration.";

export const ENTRIES = {
  // 8.22.1: the user count the app can read + the paid floor; the card after a trip (branch fix-user-count, 2026-10-26).
  "69dee81acf5fb68a": ["On a paid site the AI review allowance no longer falls back to 10 users", "C"],
  "2c4927a4bcc6a720": ["The AI allowance shows as used up as soon as a review is stopped", "C"],
  // 8.22.0: the site-wide AI allowance (branch fix-ai-allowance, 2026-10-26).
  "11fb498bbb566918": ["AI review has a monthly allowance for the whole site", "C"],
  // 8.21.0: written by the release door on 2026-10-23 (rows: deterministic; review pass: none, deterministic net only).
  "1ff085c8476f15d2": ["When a page has been deleted for good, the Activity tab of its space still shows the...", "S", {"fold":"known-purged-page-activity-no-title","d":"This problem is fixed."}],
  "4431848683e9da6b": ["On sites that use Confluence's own classification levels, choosing a level for a page,...", "S", {"fold":"known-native-classification-page-change-fails","d":"This problem is fixed."}],
  "f8db00e77406595e": ["When Confluence confirms that Sentinel Vault has no space it can keep its backup page...", "S", {"fold":"known-backup-no-space-fails-hourly","d":"This problem is fixed."}],
  "70adb0f1239814ef": ["When Confluence is busy, a backup no longer starts a second backup page", "S", {"fold":"known-backup-busy-second-page","d":"This problem is fixed."}],

  // 8.20.0: written by the release door on 2026-10-22 (rows: deterministic; review pass: none, deterministic net only).
  "874557d2ab1e7aad": ["Sentinel Vault could answer a request with a result it had looked up for another...", "S", {"withhold":"the review pass did not answer (release door: no review, no publication)"}],
  "ec4220d32fdb1924": ["Activity events recorded since 8.9.0 under a space key that is not a space on your...", "S", {"withhold":"touches security, permissions, isolation or keys (release door, deterministic rule)"}],
  "31d7c334c2616930": ["When Confluence is limiting requests, the banner says Classification unavailable...", "S", {"withhold":"the review pass did not answer (release door: no review, no publication)"}],

  // 8.19.0: written by the release door on 2026-10-22 (rows: deterministic; review pass: none, deterministic net only).
  "64d4cf1d83a49d4d": ["If the page a sealed file is on is deleted permanently from the space's trash, the...", "S", {"fold":"known-purged-page-seal-missing-from-owner-lists","d":"This problem is fixed."}],
  "12509ab24a178a82": ["On sites with very many pages in workflows, the hourly workflow check could fail to...", "S", {"fold":"known-workflow-hourly-check-stuck","d":"This problem is fixed."}],

  // 8.18.0: written by the release door on 2026-10-22 (rows: deterministic; review pass: none, deterministic net only).
  "597ca43774416fb5": ["When Sentinel Vault could not read a page, its hourly check removed the page's...", "S", {"withhold":"the review pass did not answer (release door: no review, no publication)"}],
  "63c181cd7a77ea4d": ["A seal whose time ran out on a page Sentinel Vault could not read was released at...", "S", {"withhold":"the review pass did not answer (release door: no review, no publication)"}],
  "490c2644a51ea4ee": ["The workflow dashboard says how many pages Sentinel Vault cannot read right now", "S", {"withhold":"the review pass did not answer (release door: no review, no publication)"}],
  "c28206f875846bd9": ["On sites with more than 2,000 pages under workflow, the hourly check now works through...", "S", {"withhold":"the review pass did not answer (release door: no review, no publication)"}],

  // 8.17.0: written by the release door on 2026-10-22 (rows: model; review pass: model).
  "d6d43e89ed3fe4f5": ["An approval request could stay open after enough approvers had decided", "W", {"fold":"known-approval-vote-not-applied","d":"An approval request could stay open although enough approvers had decided, when Confluence was limiting Sentinel Vault's requests or answering with errors at the moment of the deciding approval, or when two approvers decided at the same time. Sentinel Vault now finishes such a request at one of its hourly checks once Confluence answers again."}],
  "0cf9c8fa7f0c26f9": ["The My work total and the banner's Waiting for you count didn't match the lists", "M", {"fold":"known-waiting-count-higher-than-lists","d":"The total at the top of My work and the page banner's Waiting for you count now count exactly what the lists show: approval requests on pages in the trash and approval requests whose AI review did not pass are no longer counted. The approvals list says how many wait in all when there are more than it shows, the total updates after you decide from that list, and when Confluence could not answer for some of them right now, My work says so."}],

  // 8.16.0 (2026-10-22). Worded as what holds now (this file is public).
  "404db31677f1c667": ["A space admin's approval counts only while that person is still a space admin", "W"],
  "b6fec327b429123b": ["Deciding an approval request, a proposed change or Approve anyway needs permission to view the page", "W"],
  "7dca295bdf7d4542": ["A request whose AI review passed while approver rights could not be checked could stay open", "W"],

  // 8.15.0 (noted as 8.14.1 until Forge numbered it 8.15.0: the manifest gained a trigger): written by the release door on 2026-10-21 (rows: model; review pass: model).
  "51e4df6a02478bf4": ["Pages validated before 8.14.0 still stored who had checked and approved them", "D"],

  // 8.14.0: written by the release door on 2026-10-21 (rows: model; review pass: model).
  "573b0b724717566f": ["Restoring or permanently deleting a file from the panel follows your own Confluence permissions", "S"],
  "bf3d30788bb75ca9": ["Only a space's current approvers can decide its open approval requests", "W"],
  "0dc8be63209398e9": ["Adding a seal to an Approved page is refused while a change to the page is being checked", "S"],
  "6f0f9ff547d04450": ["Workflow settings that can't move edited Approved pages back are refused on save", "W"],
  "4fb91df0ea1a3a79": ["The app's own log lines no longer contain account IDs, personal space keys or error text", "D"],
  "955bf945b0ed226a": ["Unapproved edits could become an Approved page's approved version", "W"],
  "f6fa92c9422c6762": ["Changes to some parts of a sealed section or an Approved page were not detected", "S"],
  "76b3feb4b0745b54": ["An unapproved edit to an Approved page was left in place when the page could not be moved back", "W"],
  "ace25cdc5b0b832e": ["A configuration REST API job showed as done before its receipt reached the space's page", "R"],
  "8ba4a915fd791f89": ["Deleting or changing the app's page properties switched off page protection", "S"],

  // 8.13.0: written by the release door on 2026-10-21 (rows: model; review pass: model).
  "c64fc647c00462b6": ["Each action now writes one line to the app's logs, with no names, IDs, page content or anything typed", "D"],

  // 8.12.0 (2026-10-18). Outcome wording only (this file is public).
  f5edf7b2eb1d89de: ["A permission change in Confluence reaches Sentinel Vault within a minute", "C"],
  // The public text says only what 8.12.0 does (review 2026-10-18): the in-app line's "says so and asks you to try
  // again" holds for the banner, the pickers and most admin actions, not yet for every settings read.
  d9a9300f5335cbb7: ["A Confluence rate limit no longer makes space admins look like ordinary users", "W", {
    d: "While Confluence was limiting requests from Sentinel Vault, space admins could be treated as ordinary users: Approve and Deny were hidden, space admin actions were refused, and an edit a space admin made to an Approved page could be undone or the page moved back out of Approved. The approver and group lists could also come back empty. Sentinel Vault now asks Confluence about permissions far less often, and the page banner, the approver and group pickers and most space admin actions now say when Confluence is busy and ask you to try again.",
  }],
  "98b39eaacb4a218c": ["A page's activity names the person whose edit was undone, not an account ID", "A", {
    d: "A page's Sentinel Vault activity could show the person whose edit was undone, or whose page was moved back out of Approved, as an account ID instead of their name. It now shows their name.",
  }],

  // 8.11.0 (2026-10-18). Outcome wording only (this file is public).
  "2909e08b7dcf8ef8": ["The sentinel-vault-workflow page property adds reviewedVersion, the version that was approved", "R", {
    d: "On an Approved page, the page property sentinel-vault-workflow (read with Confluence's REST API) now also says reviewedVersion, the version that was approved, and baselineVersion, the version later changes are checked against, with baselineKind and baselineContentOf saying why that version moved and which version's content it holds (empty where that was not recorded). A page approved before this update gets these fields the next time Sentinel Vault updates its workflow record, for example when the page is edited or moved. approvedVersion keeps the value it had, for scripts that already read it.",
  }],
  "57ef916f1e809fe0": ["The Sentinel Vault status under the page title follows workflow moves made elsewhere", "W", {
    d: "The Sentinel Vault status under the page title kept showing the workflow state the page was opened with after the page was moved to another workflow state somewhere else, for example in another browser tab, while the banner above it already followed the move. The status under the title now follows within a few seconds too, without a reload.",
  }],
  "67cde2be10130ab3": ["An Approved page whose unapproved edit was undone names the version that was approved", "W"],

  // 8.10.0 (2026-10-18). Outcome wording only (this file is public).
  "15719e6c54496223": ["The site's AI review settings apply to every space", "C"],
  "7edab779ec80d20d": ["Space admins are recognised from the space's own permissions", "C", { id: "known-space-admin-not-recognised" }],
  "50b600968a6995cb": ["A declined admin access request can be sent again only after 48 hours", "E"],
  "1c1b8543e800a102": ["AI review progress is shown only to the person who started it", "P"],
  "784240429f3f7c19": ["The page banner follows a workflow move made elsewhere, without a reload", "W", { id: "known-workflow-banner-stale" }],

  // 8.9.0 (2026-10-18). Outcome wording only (this file is public).
  c18d6488e2b7a206: ["A page moved to another space after its workflow started holds still", "W"],
  "3834ea20d2a15f13": ["Assigning a workflow again is refused while a page is Approved or awaiting approval", "W"],
  "74f98ff60ededcc2": ["Stricter checks on acting on a page after it moves to another space", "W"],
  "20f17512cd5a49c6": ["A file on a blog post is sealed on that blog post", "S"],
  "09bea6bbb0ed6be3": ["The Sentinel Vault panel always uses the app's own macro key", "P"],

  // 8.8.0 (2026-10-17). Outcome wording only (this file is public).
  af2f3e700ff89f7d: ["Stricter checks on who can see Sentinel Vault's settings", "C"],

  // 8.7.0 (2026-10-17). Outcome wording only (this file is public).
  b976d32281146348: ["Stricter checks on who can see a space's scan status", "C"],

  // 8.6.0 (2026-10-16). Fixes worded as what holds now (this file is public).
  f2a8e80362c1cd57: ["Let it go deletes a deleted issue's kept copy before the 30 days run out", "M", {
    d: "On My work, the person who sealed a file on a Jira issue that was later deleted can delete the kept copy themselves with Let it go, instead of waiting for the 30 days to run out. " + JIRA_ON,
  }],
  c46e4629e1db2f01: ["Download the copy saves a deleted issue's file under its own name and type", "M", {
    d: "Download the copy on My work saves the file of a deleted Jira issue under its own name and file type. Sentinel Vault checks the copy against the file you sealed before saving it, and the row then says it was saved and that it is identical. " + JIRA_ON,
  }],
  "1cf7359d40e2d50b": ["My work notices a Jira issue deleted after the page was opened", "M", {
    d: "My work reads its Jira list again when you come back to the tab and, for the first few minutes, every 15 seconds while it shows a live seal, so a file whose issue has just been deleted shows as Issue deleted without reloading the page. " + JIRA_ON,
  }],
  "3ff564bbde29d621": ["The My work link and the space's Sentinel Vault page show the app's icon", "G"],
  f2b7028dfcea6c5f: ["Put it back keeps who really deleted a Jira file", "J", {
    d: "When someone uses Put it back on a deleted Jira file, the seal's history says they asked for it to be put back, and neither the history nor the issue comment names them as the person who deleted it.",
  }],
  f9709d7303048901: ["A sealed Jira file deleted a moment ago reads Being put back", "J", {
    d: "For the first moment after a sealed Jira file is deleted, the issue's Sentinel Vault section shows it as Being put back, with no Put it back button. It shows Not put back only after a put-back has failed, or if the file is still not back after about a minute and a half.",
  }],
  "9070423bc40990c5": ["Force-releasing a Jira file that was not put back says it deletes the last copy", "J"],
  cd48502460c66bf7: ["Edits to Approved pages are undone as set, with or without named approvers", "W", {
    d: "In a space set to undo edits to Approved pages, an edit by anyone who is not an approver or a space admin is undone, as the Workflow settings say, also when the space names no approvers.",
  }],
  eac256227cbe218f: ["A page approved right after its last edit stays Approved", "W", {
    d: "An edit made before a page was approved no longer counts as a change to the approved page, so the page stays Approved and its author is not told that their edit moved it.",
  }],
  cc540dc77a2d7f4b: ["Edits to Approved pages are kept while Protect Sealed Attachments in Page Body is off", "W", {
    d: "With Protect Sealed Attachments in Page Body turned off, Sentinel Vault no longer undoes edits to Approved pages or moves them back for review, and the Workflow settings, page banner, page details and approval dialog say Approved pages are not protected while it is off.",
  }],
  d5852f7374984940: ["The page banner leaves Approved as soon as an edit moves the page back", "P", {
    d: "After an edit moves an Approved page back for review, the page banner updates on its own instead of showing Approved until the page is reloaded.",
  }],
  a3033bc73e596a50: ["The approver's page banner names the person who edited the page", "P"],
  "0ead3c943cd7cd8f": ["Stricter checks on edits inside sealed sections", "S"],

  // 8.5.0 (2026-10-11). Worded as what holds now, not as the old overlap.
  "284985d5400474dc": ["Sealing a Jira file again keeps the new seal's copy safe", "J", {
    d: "When a Jira file is sealed again, Sentinel Vault first clears any clean-up still pending for an earlier seal's copy of that file, so the new seal's copy is never removed by it.",
  }],

  // 8.4.0 (2026-10-11). The panel re-reads every 3 s for at most a minute, so the public line says
  // "for up to a minute" where the note says "until the file is back".
  fd44b05748dac282: ["A sealed Jira file being put back showed as Not put back with a Put it back button", "J", {
    d: "For the few seconds between someone deleting a sealed Jira file and Sentinel Vault putting it back, the issue's Sentinel Vault section showed the file as Not put back with a Put it back button. It now reads Being put back, offers no button, and refreshes on its own for up to a minute, so the file shows as back without reloading the page. Not put back is kept for a file that really could not be put back.",
  }],

  // 8.3.0 (2026-10-11)
  "481b17194d495e48": ["A deleted issue's sealed file could not be downloaded if it was being put back at that moment", "J", {
    d: "If a sealed Jira file was being put back at the moment its issue was deleted, its copy could not be downloaded from My work afterwards. Sentinel Vault now comes back for it once the put-back has finished, so its copy is kept for 30 days and its owner can download it from My work in Confluence, like the copies from any other deleted issue.",
  }],

  // 8.2.0 (2026-10-11)
  "1bf78eaff8cdaca3": ["A copy of a sealed Jira file could be left behind when deleting it failed", "J"],
  "8c4d2a841c687774": ["On a site with thousands of sealed Jira files, some reminders, releases and clean-ups were never reached", "J"],
  // A correction to the 8.0.0 note's text, not a change to the app; the 8.0.0 issue already gives the
  // full path.
  c650448437dc24aa: ["", "J", { fold: "10453af12a85f805" }],

  // 8.1.0 (2026-10-11)
  "25bcb0f4e2594cfb": ["A security update to a bundled library", "I", {
    d: "The prosemirror-view library, which comes with Atlassian's own packages, is updated to 1.42.6 to close a published security advisory (GHSA-c8x8-7fp4-3x9w). Sentinel Vault's screens do not contain the affected code, so nothing about how the app works changes.",
  }],

  // 8.0.0 (2026-10-11). The security fixes are worded as what a person sees now (this file is public),
  // never as how protection could be got round before.
  // Review 2026-10-11: the admins' extend and force release depend on the site setting; the note line
  // did not say so.
  "10453af12a85f805": ["Seal the files attached to Jira issues", "J", {
    d: "Sentinel Vault works on Jira issues. Once a site admin connects Jira (Atlassian Administration, Apps, Sites, your site, Connected apps, Sentinel Vault, then on the Connections tab connect Jira, listed as Jira Apps), every issue has a Sentinel Vault section in its right-hand column listing the issue's files. Anyone who can edit the issue can seal a file for a chosen time, with an optional note; the owner can extend or release it; while the site setting Allow space admins to force-unseal is on, a Jira or project admin can extend it or force-release it with a typed reason.",
  }],
  "41aab197332ac705": ["A sealed Jira file deleted by someone else is put back from Sentinel Vault's copy", "J", {
    d: "Sentinel Vault keeps a copy of every sealed Jira file (files up to 25 MB). If anyone but the owner deletes a file while its seal holds, the copy is uploaded back to the same issue under the same name, the seal moves to it, and a comment on the issue tells the person who deleted it (setting Tell editors when their change is undone, on by default; at most one comment per file every 10 minutes). Jira gives the put-back file a new attachment id, and its author is Sentinel Vault. " + JIRA_ON,
  }],
  // The note's loop threshold is left out: the public line says what happens, not how many deletes.
  "0ee905800f9e746c": ["A sealed Jira file that could not be put back stays listed and is tried again", "J", {
    d: "If a sealed file cannot be put back (for example a temporary Jira error), the issue's Sentinel Vault section shows it as Not put back with a Put it back button, Sentinel Vault tries again on its own (after an hour, then less often, up to 10 times), and the expiry rules never delete that copy. If the same file keeps being deleted each time it is put back, for example by an automation rule, Sentinel Vault stops putting it back, keeps the copy, shows the file as Not put back and says so on the issue; anyone who can edit the issue puts it back with Put it back. " + JIRA_ON,
  }],
  "490e7e9399367b13": ["Deleting a Jira issue keeps its sealed files' copies for 30 days", "J", {
    d: "Deleting an issue cannot destroy a sealed file's copy. It is kept for 30 days and its owner can download it from My work in Confluence. " + JIRA_ON,
  }],
  "3976fbfc75fd979c": ["The site's seal settings apply to Jira too", "J", {
    d: "These site settings apply to Jira too: Default Seal Duration, Seals expire and the overdue reminders, Sign seal actions with an authenticator code, Allow space admins to force-unseal (on Jira it covers Jira and project admins), and the comment switches Page comments that mention people, Tell editors when their change is undone, and Expiry and release notices. Each issue's seal history is shown in its Sentinel Vault section and follows Delete old history. " + JIRA_ON,
  }],
  "adb91d44f9e91990": ["REST API operations for Jira seals, and an issue property that lists them", "R", {
    d: "Three REST content operations, seal-jira-attachment, extend-jira-attachment and release-jira-attachment, and an issue property, sentinel-vault-seals, that lists an issue's live seals without naming anyone. " + JIRA_ON,
  }],
  "429df114b278fcfd": ["The 8.0.0 update asks for three Jira permissions", "I", {
    d: "The 8.0.0 update asks a site admin to approve three new permissions, read:jira-work, write:jira-work and read:jira-user, used only to read an issue's files, put a deleted sealed file back, comment on the issue, keep the sentinel-vault-seals issue property up to date, read people's names, and check Jira permissions. Until it is approved the site stays on the previous version, and nothing happens on Jira until Jira is connected. A site admin approves the update in Confluence administration, Apps, Manage apps.",
  }],
  "145c96bc4f8badb6": ["Times read today, yesterday and tomorrow in words", "G"],
  // Reworded note lines (2026-10-11, 8.5.0 commit): the note line is the public text. These two, and
  // the "each seal" and approval rows below, got NEW issues keyed by the new hash (their old issues
  // were deleted, because Jira's History tab, readable logged out, kept the old wording).
  e434066a94d2691e: ["Stricter permission checks on purge, restore and force release", "S"],
  "4ba4e94148db2588": ["Clearing a lapsed seal from space settings cleans up everything it left behind", "C"],
  c1381ac869ea1a31: ["Each seal on a page stays in force until it is itself released", "S", {
    d: "Each seal on a page keeps its own file protected until that seal is released or expires.",
  }],
  "23792d6675c7c318": ["A new version uploaded by a seal's owner becomes the version the seal protects", "S"],
  "5d81e0936e24c393": ["Seals held by an approval stay in force until the approval ends", "W"],
  // Review 2026-10-11: with Overdue reminders before release at 0 the site holds lapsed seals, and a
  // deleted page's seal is held too (its reminder counts as given); the note line did not say so.
  // Reworded note line (2026-10-11: names the Overdue reminders at 0 case), issue keyed 81f69068660bb7e8.
  "1c89207ee0f71164": ["A lapsed seal on a deleted page was retried every hour and never released", "S", {
    id: "81f69068660bb7e8",
    d: "A lapsed seal on a page that was deleted is now released. Before, its reminder could not be posted, so it was retried every hour and the seal was never released. On a site where Overdue reminders before release is 0 (seals are held, not released), the seal stays and its reminder is counted as given, so the hourly retries stop. On a page in the trash, the seal finishes its normal countdown.",
  }],
  "f35395a7a5288a69": ["A file deleted from the panel without a seal could not be sealed by someone else later", "S"],
  "abf9170f4cbcf5c2": ["Edit requests waiting on you were missing when Seals expire was off", "E"],

  // 7.1.0 (2026-10-07)
  bb738ac5493e0004: ["File cards no longer cut a file's name short to fit their buttons", "S"],
  "1b1796693e630826": ["The page banner fits a phone, with fewer chips on narrow screens", "P"],
  "5a72bb4ba304ca77": ["The Sentinel Vault window and Seal attachments lay out for a phone's width", "P"],
  fdd961d457492eef: ["Space and site settings fit tablets and narrow windows", "C"],
  ef8cbf2f0ed996ad: ["Bigger buttons and switches on phones and tablets, and more readable small labels", "G"],
  "3e641e0a32ebd960": ["API access and the Activity report showed some people as an account ID", "A"],
  "01da593d264d0386": ["The Not applied yet reminder could cover the setting you had just changed", "C"],
  d0431e9f0d93b3bc: ["A sealed section low on a page could say it could not display its text", "S"],

  // 7.0.0 (2026-10-05)
  "22ba9b1dab16f22a": ["The 7.0.0 update asks for one new permission: reporting personal data to Atlassian", "I", {
    d: "The 7.0.0 update asks a site admin to approve one new permission, reporting personal data to Atlassian. Until it is approved the site stays on the previous version. A site admin approves the update in Confluence administration, Apps, Manage apps.",
  }],
  "97c0b636a957c0d4": ["Closed accounts are erased from Sentinel Vault's records, except mentions inside sealed content", "D", {
    d: "Once the 7.0.0 update is approved, the weekly personal-data check sends Atlassian the ids of the accounts Sentinel Vault stores, each at most once per Atlassian's reporting cycle (7 days unless Atlassian sets another period). When Atlassian answers that an account was closed, the app erases that person everywhere it keeps them, including the backup. When it answers that an account changed, the app refreshes the stored name. Sealed sections are the record of what was sealed and are never rewritten: a closed account mentioned inside sealed content stays mentioned there, as in Confluence's own page history. Everything else the app keeps about that person is erased once, and is erased again only if a restore brings it back.",
  }],
  // Review 2026-10-09: the bare line said "the first check" and relied on the line before it.
  "79e107cef46f4431": ["The first personal-data check runs within a day of the update", "D", {
    d: "The first personal-data check runs within a day of the 7.0.0 update, and each account is then checked every 7 days on the day, or on the period Atlassian asks for. If Atlassian refuses a check, it is tried again the next day instead of a week later.",
  }],
  // A note that qualifies the erasure line above; carried in that issue's description.
  "4556ad45fa3d8ee4": ["", "D", { fold: "97c0b636a957c0d4" }],
  // Review 2026-10-09: the net change is 11 fewer (38 -> 27 scopes: 12 removed, 1 added in the same
  // release), so the title names the 12 unused ones instead of a net count.
  "43a02b2d24c9bcde": ["Sentinel Vault no longer asks for 12 permissions it did not use", "I", {
    d: "Sentinel Vault asks for fewer permissions. It no longer requests 12 it held but did not use: read:confluence-space.summary, read:confluence-props, read:content:confluence, write:content:confluence, write:attachment:confluence, read:comment:confluence, read:content.property:confluence, write:content.property:confluence, read:content.restriction:confluence, write:content.restriction:confluence, read:content.metadata:confluence and read:content.permission:confluence. Everything the app did with them it already does through the permissions it keeps, so nothing it does changes. Two are kept on purpose: read:confluence-content.summary, because Confluence only tells the app about page and attachment changes with it, and read:label:confluence, which the page label check uses.",
  }],
  // "Kept on purpose" qualifies the permission line above; carried in that issue's description.
  "1c37b3461723560b": ["", "I", { fold: "43a02b2d24c9bcde" }],
  f9be20e18d7cff16: ["The weekly personal-data check could not ask Atlassian about closed or changed accounts", "D", {
    d: "The weekly personal-data check could not ask Atlassian about closed or changed accounts, because the app did not hold the permission for it.",
  }],

  // 6.11.0 (2026-10-04)
  "312ffb32a22ec18b": ["Email addresses brought back by a restore are cleaned every week", "D"],

  // 6.10.0 (2026-10-04)
  "2c3b5920fd91e2ba": ["Opening a page no longer schedules a backup", "B"],
  b7dba70248a89e99: ["After Delete the backup, the weekly check and backups queued earlier take no new backup", "B"],
  "88c021613301e484": ["Delete the backup could be undone by someone opening a page", "B"],
  "5c79d3744c4b859e": ["A backup file counted as deleted while it was still in the trash", "B"],

  // 6.9.0 (2026-10-04)
  // Review 2026-10-09: the note's "only after your next change" was disproved by two 6.10.0 fixes.
  "6036a92c6caa7bf3": ["After Delete the backup, the hourly check no longer takes a new backup on its own", "B", {
    d: "After Delete the backup, the hourly check no longer takes a new backup on its own, and the Backup tab says when the backup was deleted. Opening a page, the weekly personal-data check and backups queued before the delete could still take one until 6.10.0.",
  }],
  "913ede5ce2ad9cad": ["Approver lists in workflow settings no longer store email addresses", "D"],
  ecd546ab2fb14d66: ["A backup deleted before an uninstall could come back within the hour", "B"],
  c47db610d884c943: ["The Delete the backup dialog said nothing could bring the setup back after an uninstall", "B"],

  // 6.7.0 (2026-10-04)
  "6f53aee0c9069a52": ["Optional keep period for activity history, workflow history and read confirmations", "D", {
    d: "Site settings has a new Privacy and retention section. Turn on \"Delete old history\" to have activity history, workflow history and read confirmations older than \"Keep history for\" (730 days unless you change it) deleted by a weekly check. It is off unless you turn it on, so nothing is deleted on upgrade. If your records policy sets a keep period for history, turn on Delete old history there and set the period.",
  }],
  // The screen calls it "Weekly personal-data check", button "Run the check now".
  c3680a2963cfa650: ["Run the weekly personal-data check at once, in Site settings or over the REST API", "D", {
    d: "The weekly personal-data check can be run at once with Run the check now in Site settings, Privacy and retention, and over the REST API (operation privacy-sweep, admin tokens).",
  }],
  eb363ed1144af6ba: ["", "D", { withhold: "How authenticator codes for signed actions are stored (secret storage); security mechanism topic, as the CogniRunner tracker withholds secrets lines." }],
  eaf7dcbd01d6a84f: ["Sentinel Vault no longer stores the email address of the person who seals", "D", {
    d: "Sentinel Vault no longer stores the email address of the person who seals a file or section. Seal records saved before this version are cleaned by the weekly check.",
  }],
  "19aacd619c901ba0": ["Delete the backup deletes every backup file for good", "B"],
  "21e239ea4b19e7bf": ["Documentation and Support links in Site settings", "C"],
  "34b5a70ce95e3f81": ["Delete the backup reported success while the backup page stayed where it was", "B"],
  "797353b009467098": ["Read confirmations and approvals that named a group did not reach its members", "W"],
  "41ffc8131f0821e6": ["A sealed file deleted for good kept its seal record", "S"],

  // 6.6.0 (2026-10-02)
  af0750e9409a3cd1: ["Sentinel Vault backs up your setup automatically", "B", {
    d: "Site settings has a new Backup and restore section. Sentinel Vault backs up your settings, seals, sealed sections, workflows, validation rules, classification and history after each change in the app or REST API and once a day, to a Confluence page restricted to the app. After updating, open Site settings, Backup and restore, once and check that the first backup is there.",
  }],
  "67ff2bdee773be89": ["Restore your setup after a reinstall, with its automatic actions paused", "B", {
    d: "After a reinstall, or when the app comes back after a lapsed subscription, Site settings offer \"Restore your setup from [date]\" with a preview of what comes back. Things that act on their own (seals expiring, validation revert, AI review, workflow auto-assign and review timers) come back paused until you turn them on. REST API tokens and authenticator codes are never backed up: after a restore, create new tokens and ask people who sign actions to enroll again.",
  }],
  b6ca3fcc1e0d4623: ["Download the whole setup as one file and import it back", "B", {
    d: "You can download the whole setup as one JSON file and import it back later.",
  }],
  f068e52a8c2063e3: ["REST API operations for backup, restore, export and import", "R"],
  "54e26958cb39ec07": ["Uninstalling no longer erases the app's stored data on the spot", "B"],
  d3ea1dc0ed5f4434: ["Dialogs opened low on a long page opened partly off screen", "G"],

  // 6.5.0 (2026-09-30)
  // The note quotes the job's internal error text; the public line says what happened instead.
  "2e41e20b3342877f": ["REST API: giving, revoking and declining edit access failed in 6.4.0", "R", {
    d: "The REST operations that give, revoke and decline edit access to sealed files and sections now run. In 6.4.0 they were accepted but every job failed. Resubmit any failed job with a new Idempotency-Key.",
  }],

  // 6.4.0 (2026-09-30)
  // Classification is off unless a site admin turns it on (owner's decision 2026-09-19), and a space can opt out.
  "02dc09e3ae3c6c5a": ["Pages show their classification level when Classification levels is on", "L", {
    d: "When a site admin turns on Classification levels in Site settings (it is off unless turned on), every page shows its classification level, unless its space opts out. Raising a page's level is one action; lowering it asks for a reason.",
  }],
  "63b9625934ccc58c": ["Force release is offered only when a space admin may use it", "S"],
  "3dc93496d26ec777": ["Sealed and Available files have separate paging, and the counts match the cards", "S", {
    d: "Sealed and Available files have separate paging, the counts match the cards, and a file you just sealed or released moves to the top of its group.",
  }],
  "25208201ab12f4bd": ["A declined edit request can be asked again after a cooldown", "E"],
  "62540185f1c856a3": ["Seal actions can require an authenticator code", "S"],
};

// KNOWN, OPEN bugs a person using Sentinel Vault can meet today. Each was checked against the code
// at the 7.1.0 release (2026-10-09), and again at 8.1.0 (2026-10-11: none of the code behind them
// changed between 7.1.0 and 8.1.0, so all six stay open; 8.2.0 to 8.5.0 changed only the Jira seal
// code, which none of them is in); `affects` is the version it was confirmed on. Keyed by a stable
// slug. `why` (optional) says when the cause is Confluence's, not the app's.
// `fix: "scheduled"` puts the row in Selected for Development and its text says "fix scheduled"; when
// the fix ships, the release-note line that fixes it takes the row over (`id: "<slug>"`) and moves
// it to Done. 2026-10-17: known-workflow-banner-stale added, reproduced on the 8.6.0 production build;
// known-space-admin-not-recognised added (8.6.0, leanzero-demo dry take + wolfaenpak harness).
// 2026-10-18: both shipped in 8.10.0; their 8.10.0 lines take the rows over (id: "<slug>") and move them to Done.
// Open items that would describe how protection can be got round are NOT written here (this file is
// public); they go to the owner privately and are fixed instead.
export const KNOWN = [
  {
    k: "known-phone-settings-wider-than-screen", c: "C", affects: "7.1.0",
    t: "On a phone, space settings and site settings are wider than the screen",
    see: "On a phone, the space settings and site settings pages are wider than the screen, so you scroll sideways to reach their right-hand side. Dialogs and the Not applied yet reminder open in the part of the page you can see.",
    where: "Space settings and Site settings, on a phone.",
    workaround: "Scroll sideways, or use a tablet or a computer, where these pages fit the screen.",
    why: "Confluence keeps these pages at least about 700 px wide on a phone, so Sentinel Vault cannot make them narrower.",
  },
  {
    k: "known-phone-window-fixed-height", c: "P", affects: "7.1.0",
    t: "On a phone, the Sentinel Vault window opened from under the page title or the page menu keeps a fixed height",
    see: "Opened from Sentinel Vault under the page title, or from Seal attachments… in the page menu, the Sentinel Vault window keeps a fixed height. On a phone held sideways it runs past the bottom of the screen, so you scroll down to reach the Seal button. Held upright, it can leave empty space under its buttons.",
    where: "The Sentinel Vault window and Seal attachments, on a phone.",
    workaround: "For the Sentinel Vault window, use Open on the page's Sentinel Vault banner where the page shows one: on a phone it fills the screen. To seal files, open its Attachments tab and press Open the full attachments view, which also fills the screen and has a seal control on each file. Otherwise scroll down inside the window to reach its buttons.",
    why: "Confluence sets the size of windows opened from these two places.",
  },
  {
    k: "known-my-sealed-files-large-site", c: "M", affects: "7.1.0",
    t: "On a site with more than about 1,000 sealed files, your list of sealed files can leave some out",
    see: "Files you hold sealed in My work, and the My Sealed Files tab in space settings, look through about the first 1,000 sealed files on the whole site. On a site with more than that, some of the files you sealed may not be listed.",
    where: "My work, Files you hold sealed; space settings, My Sealed Files.",
    workaround: "Open the page the file is attached to: its Sentinel Vault panel and the Sentinel Vault window list the seals on that page.",
  },
  {
    k: "known-ai-chip-counts-dismissed", c: "P", affects: "7.1.0",
    t: "The banner's AI check chip still counts findings you dismissed",
    see: "The AI check chip on the page banner counts every finding from the latest AI review, including the ones you dismissed or marked as a false positive.",
    where: "The page banner, on pages that had an AI review, when the banner is about 860 px wide or wider (narrower banners do not show the chip).",
    workaround: "The Sentinel Vault panel on the page lists open findings apart from the hidden ones. Re-running the AI review after the page is fixed refreshes the count.",
  },
  {
    k: "known-macro-position-focus", c: "G", affects: "7.1.0",
    t: "The Top and Bottom choices for the panel's position show no keyboard focus",
    see: "When you move through space settings with the keyboard, the Top and Bottom switches under Macro Position show no focus outline, so you cannot see when one of them has focus.",
    where: "Space settings, Macro tab, Macro Position.",
    workaround: "The switches still work from the keyboard: the arrow keys move between Top and Bottom and the chosen one turns on. Use the mouse or touch if you need to see where you are.",
  },
  {
    k: "known-reminder-over-heading-phone", c: "C", affects: "7.1.0",
    t: "On a very narrow phone, the Not applied yet reminder can sit over the Enforcement heading",
    see: "On a phone narrower than about 355 px, after you change a validation setting, the Not applied yet reminder can cover the Enforcement heading's text. It does not cover a button or a field.",
    where: "Space settings or Site settings, Validations tab, on a phone narrower than about 355 px.",
    workaround: "Scroll a little to read the heading. The reminder goes away once you press Apply or Discard.",
  },
  // 2026-10-21 completeness sweep: every open, user-visible bug found in the repo's notes, reviews and ledgers, the
  // marketing and harness notes and the code, each re-checked against the 8.12.0 production code. Confirmed on 8.12.0.
  {
    k: "known-page-ribbon-setting-keeps-banner", c: "C", affects: "8.12.0",
    t: "Turning off Page ribbon in Site settings does not hide the Sentinel Vault banner on pages",
    see: "The Page ribbon switch says it controls the Sentinel Vault ribbon at the top of pages with sealed content. After you turn it off and apply, the banner still shows on pages with seals, a workflow or a classification level. On its own, the switch turns off only the recurring reminder banner for seals that do not expire. With Pop-up messages also off, the banner stops listing recent seal events.",
    where: "Site settings, Settings tab, Alerts, Page ribbon.",
    workaround: "None in Sentinel Vault. The banner shows only on pages that have something to show.",
  },
  {
    k: "known-force-unseal-switch-broader", c: "C", affects: "8.12.0",
    t: "Turning off Allow space admins to force-unseal also takes away other admin actions",
    see: "The switch's text says only that a space admin can release anyone's seal from the Sealed Files tab. While it is off, space admins and site admins also cannot open or change a space's workflow settings and workflows, see its Workflow status list, use Apply to existing pages, approve workflow pages as an admin, use Approve anyway on a failed content check, start an AI review, give or revoke edit access on other people's seals, or release other people's sealed sections. Space admins also cannot set their space's default classification level.",
    where: "Site settings, Settings tab, Protection, Allow space admins to force-unseal.",
    workaround: "Leave the switch on, or turn it on while you change these settings. Seal owners keep their own actions either way.",
  },
  {
    k: "known-content-protection-switch-broader", c: "C", affects: "8.12.0",
    t: "Turning off Protect Sealed Attachments in Page Body also turns off sealed section and Approved page protection",
    see: "The switch's text describes only sealed images and files in the page body. While it is off, edits to sealed sections are not undone either, and Approved pages in a workflow are not protected from edits by people who are not approvers. The page banner and the space's Workflow tab say that Approved pages are not protected, but the switch itself mentions neither.",
    where: "Site settings, Settings tab, Protection, Protect Sealed Attachments in Page Body.",
    workaround: "Leave the switch on unless you mean to turn off all of these protections.",
  },
  {
    k: "known-workflow-tab-shows-defaults", c: "W", affects: "8.12.0",
    t: "The Workflow tab can show the workflow as off, with default settings, when its settings could not be read",
    see: "The space's Workflow tab can open with Enable document workflow off and no approvers although the workflow is on, with no message saying the settings could not be read. This always happens while Allow space admins to force-unseal is off in Site settings (Save workflow settings is then refused as well), and it can happen when loading fails for another reason; saving from that state would replace the real settings with the defaults shown. In Site settings, when the settings cannot be read, Unable to load preferences. Verify your access rights. appears above a form that shows default values.",
    where: "Space settings, Workflow tab; Site settings, Settings tab.",
    workaround: "If the tab looks reset, do not save: reload the page and check again. Keep Allow space admins to force-unseal on while you manage workflows.",
  },
  {
    k: "known-inbox-signed-decisions-fail", c: "W", affects: "8.12.0",
    t: "With signed decisions required, Approve and Deny in the approvals list on My work always fail",
    see: "In a space where Require a signed decision is on, pressing Approve or Deny under Approvals waiting on you answers Enter the current code from your authenticator to sign this decision (or, if you have no signature yet, asks you to set one up), and there is no place to type a code there.",
    where: "My work, and the approvals list on the space's settings page, for pages in a space that requires signed decisions.",
    workaround: "Open the page and decide from its banner, which asks you to Sign with your authenticator code.",
  },
  {
    k: "known-approval-comment-no-reason", c: "W", affects: "8.12.0",
    t: "The comment for an approved request leaves out the approver's reason",
    see: "When an approver types a reason in Add a reason (optional) and approves, the page comment Sentinel Vault posts for the person who asked does not include the reason. A declined request's comment does include it.",
    where: "The page comment posted when an approval request is approved, in a space that uses a Sentinel Vault workflow with page comments turned on.",
    workaround: "The reason is shown in the page's Sentinel Vault activity, on the Approval given row.",
  },
  {
    k: "known-window-move-to-stale", c: "W", affects: "8.12.0",
    t: "Move to… in the Sentinel Vault window can keep offering moves from a state the page has already left",
    see: "If the Sentinel Vault window stays open while the page is moved to another workflow state elsewhere, for example in another tab or by a colleague, Move to… still offers the moves from the state the window opened with. Picking the state the page is already in answers Already in that state, and a move you pick there is made from the state the page is in now, not the one the window shows. After any move you try, the window shows the page's current state.",
    where: "The Sentinel Vault window opened from under the page title, Workflow section, Move to….",
    workaround: "Close and reopen the window, or reload the page, before choosing a move. The workflow chip on the page banner follows moves made elsewhere.",
  },
  {
    k: "known-rerequest-resets-approvals", c: "W", affects: "8.12.0",
    t: "Asking for approval again from a second tab sets approvers' decisions back to pending",
    see: "If you ask for approval and then ask again from another tab or window that had not caught up with your first request, the request starts over: approvers who already approved are set back to pending and asked again.",
    where: "The workflow chip on the page banner, or Move to… in the Sentinel Vault window, on a page waiting for approval.",
    workaround: "Reload the page before asking again. If it already happened, the approvers need to approve again.",
  },
  {
    k: "known-moved-page-missing-from-lists", c: "C", affects: "8.12.0",
    t: "A page moved to another space can disappear from both spaces' Workflow status and Sealed Files lists",
    see: "After a page with a Sentinel Vault workflow or sealed files is moved to another space, it no longer appears in the Workflow status list on either space's Workflow tab, and its sealed files can be missing from both spaces' Sealed Files tab.",
    where: "Space settings, Workflow tab and Sealed Files tab, for pages moved between spaces.",
    workaround: "The page's own banner and Sentinel Vault window still show its workflow state and seals, and each seal's owner still sees their files in My work.",
  },
  {
    k: "known-heading-rule-wording", c: "P", affects: "8.12.0",
    t: "A required heading rule's message reads Missing required a heading containing",
    see: "When a page misses a required heading, the content check message reads, for example, Missing required a heading containing Security, Missing required an H2 heading., or Needs at least 2 of a heading containing Security (found 1). The rule itself works; only the wording is wrong.",
    where: "The content check results on the page's Sentinel Vault panel, the page comment for a failed check, and the message when a workflow move is blocked by the content rules.",
    workaround: "None needed: the message names the heading the page is missing.",
  },
  {
    k: "known-rate-limit-two-screens-empty", c: "C", affects: "8.12.0",
    t: "While Confluence is limiting requests, some admin screens look empty or treat you as a non-admin instead of asking you to try again",
    see: "When Confluence is limiting Sentinel Vault's requests, many space admin actions say Confluence is limiting requests right now and ask you to try again. Some screens still answer as if you were not an admin: Space settings can open with only My Sealed Files and a Request admin access button, the Sealed Files tab can say No sealed files discovered in the index., the Workflow tab can show the workflow as off with default settings, the Activity tab can say No activity recorded yet in this space for these filters., and the spaces list on the Classification tab in Site settings can say You do not administer any space.",
    where: "Space settings (when it opens, and the Sealed Files, Workflow and Activity tabs); Site settings, Classification tab.",
    workaround: "Wait a few minutes and reload. The screens show their content again once Confluence stops limiting requests.",
    why: "Confluence limits how many requests an app may make in a period of time.",
  },
  {
    k: "known-unsaved-settings-lost", c: "C", affects: "8.12.0",
    t: "Unsaved changes on the Workflow and Validations tabs are lost without a warning",
    see: "If you change workflow or validation settings and then switch tab, or press Edit the states, approvers and protection… or ← Back to workflow settings, your changes are gone without the Apply your changes first? question other settings tabs ask.",
    where: "Space settings, Workflow and Validations tabs; Site settings, Validations tab.",
    workaround: "Save before you leave the view: Save workflow settings, Save workflow, or Save validation rules.",
  },
  {
    k: "known-dropdowns-not-keyboard", c: "G", affects: "8.12.0",
    t: "Some drop-down lists in the settings cannot be used with the keyboard",
    see: "You can reach these lists with Tab, but the keyboard either does not open them, or opens them without letting you pick an option.",
    where: "Space settings, Workflow tab (Decision rule, what happens when an Approved page is edited by someone else, the state to move it back to, AI review strictness, a state's colour); the Validations tabs (rule type, severity, model, severity threshold); the Activity tab's Time range; the Sealed Files tab's sort order; panel setup (Items per page, Cards per row); Site settings, Classification tab (the space default level pickers and the level colour swatches).",
    workaround: "Use a mouse or touch for these lists. For a level colour, open the swatch and type the colour's hex code in the field under the swatches.",
  },
  {
    k: "known-upload-click-not-keyboard", c: "G", affects: "8.12.0",
    t: "The click to select link in the upload area cannot be reached with the keyboard",
    see: "Tab skips click to select in the upload area (Drop files here or click to select on the panel, Drop a file here or click to select in the window), so someone using only the keyboard cannot pick a file to upload from Sentinel Vault.",
    where: "The Sentinel Vault panel on the page, and the Sentinel Vault window.",
    workaround: "Attach the file with Confluence's own attachment option; it then shows in Sentinel Vault.",
  },
  {
    k: "known-panel-collapse-no-name", c: "G", affects: "8.12.0",
    t: "The panel's collapse buttons have no readable name for screen readers",
    see: "The buttons that open and close the AI Review, Validation, Sealed Sections and Activity groups are announced as a symbol, and do not name their group or say whether it is open.",
    where: "The Sentinel Vault panel on the page.",
    workaround: "None.",
  },
  {
    k: "known-ai-dismiss-not-saved", c: "P", affects: "8.12.0",
    t: "Dismissing an AI finding can look done when it was not saved",
    see: "Dismiss or False positive hides the finding at once, but if you cannot edit the page, or the save fails, the finding comes back the next time the page loads. No message says it was not saved.",
    where: "The Sentinel Vault panel on the page, AI Review group.",
    workaround: "Ask someone who can edit the page to dismiss the finding.",
  },
  {
    k: "known-seal-expired-warning-repeats", c: "S", affects: "8.12.0",
    t: "The Seal expired warning in the full attachments view comes back after you close it",
    see: "In the full attachments view, a Seal expired warning for each of your expired seals appears again whenever the file list refreshes, for example after you or someone else seals or releases a file, even after you close it.",
    where: "The full attachments view: Open the full attachments view on the Attachments tab of the Sentinel Vault window.",
    workaround: "Release or extend your expired seals; the warning stops once none of your seals on the page has expired.",
  },
  {
    k: "known-phone-dropdown-off-top", c: "G", affects: "8.12.0",
    t: "On a phone, a drop-down list can open partly hidden at the top of the window",
    see: "On a phone, a list opened near the bottom of the Sentinel Vault window can open with its top part hidden under the top edge of the window, and it does not move if you scroll while it is open.",
    where: "The Sentinel Vault window and Seal attachments…, on a phone.",
    workaround: "Scroll so the field sits in the middle of the screen, then open the list again.",
  },
  {
    k: "known-autostart-workflow-missed", c: "W", affects: "8.12.0",
    t: "A new page can miss its automatic workflow start if the first try fails",
    see: "In a space with Auto-start workflow on new pages turned on, a page created while Confluence or Sentinel Vault had a passing error does not get the workflow, and Sentinel Vault does not try again or say so.",
    where: "New pages in a space whose Workflow tab has Auto-start workflow on new pages turned on.",
    workaround: "Press Apply to existing pages on the space's Workflow tab; it adds the workflow to pages that do not have it.",
  },
  {
    k: "known-access-requests-capped", c: "E", affects: "8.12.0",
    t: "Access Control can leave out admin access requests in a space with many of them",
    see: "Access Control reads up to 50 admin access requests for a space, pending and declined together. In a space with more than that, some pending requests may not be listed.",
    where: "Space settings, Access Control tab, Pending Access Requests.",
    workaround: "Add the person directly as a space admin on the Access Control tab.",
  },
  {
    k: "known-low-contrast-labels", c: "G", affects: "8.12.0",
    t: "Some labels and buttons have white text on a light colour that is hard to read",
    see: "Some labels and buttons put white text on cyan or amber, below the contrast normally needed for small text: the badge on a sealed section and the section dialog's buttons (light theme), the banner's read confirmation button, and the status pills and some counts on My work.",
    where: "Sealed sections on pages, the page banner, and My work.",
    workaround: "None.",
  },
  {
    k: "known-classification-swatch-contrast", c: "L", affects: "8.12.0",
    t: "Some colours offered for a classification level make the level name hard to read",
    see: "Light swatches such as orange, amber, yellow, green and cyan put white text on the level's chip and on the banner, which is hard to read.",
    where: "Site settings, Classification tab, the levels list, colour of a level.",
    workaround: "Pick a darker colour for the level, such as red, blue, purple, pink, slate or near-black.",
  },
  {
    k: "known-classification-level-removed-silently", c: "L", affects: "8.12.0",
    t: "Removing a classification level, or re-importing levels under new names, turns pages Unclassified without a warning",
    see: "Pages and spaces set to a level that is no longer in the list fall back to the space default or to Unclassified. Nothing warns you before you remove a level, and the import buttons do not say that pages set to a level that disappears will fall back.",
    where: "Site settings, Classification tab: removing a level and pressing Save levels, or Levels from JSM Assets, Import or Re-import now.",
    workaround: "Add the level back under the name it had when it was first created or imported. Pages that kept their setting then show the level again.",
  },
  {
    k: "known-assets-error-code-only", c: "L", affects: "8.12.0",
    t: "Linking classification levels to JSM Assets shows only an error code when Assets cannot be reached",
    see: "If Sentinel Vault cannot reach JSM Assets, the message is only a short status such as Assets workspace lookup answered 401, with no next step.",
    where: "Site settings, Classification tab, Levels from JSM Assets.",
    workaround: "Check that the site has Jira Service Management with Assets and that you can open Assets yourself, then try again.",
  },
  {
    k: "known-lists-empty-when-not-loaded", c: "M", affects: "8.12.0",
    t: "Some lists say there is nothing to show when they could not load, or before they have loaded",
    see: "My work can say Nothing is waiting on your approval. when the approvals list failed to load, and its approval signature card can say Not set up when the status could not be read. The space's Sealed Files tab shows No sealed files discovered in the index. until its list arrives, and Access Control can say No pending requests. when that list failed to load.",
    where: "My work; Space settings, Sealed Files and Access Control tabs.",
    workaround: "Wait a moment and reload the page before you rely on an empty list.",
  },
];

// Known bugs a release closed (folded into that release's note line, so the issue is Done with it).
// Moved out of KNOWN by the release door (scripts/release-autopilot.mjs); the tracker still builds their issues.
export const CLOSED = [
  // closed by 8.17.0 (SVT-146), moved out of KNOWN by the release door on 2026-10-22
  // 2026-10-22: two open defects found while releasing 8.16.0, confirmed on 8.16.0 and fixed in the next release.
  {
    k: "known-approval-vote-not-applied", c: "W", affects: "8.16.0", fix: "scheduled",
    t: "An approval request can stay open after enough approvers decided, when Confluence was limiting requests at that moment",
    see: "When Confluence is limiting Sentinel Vault's requests or answering with errors at the moment the deciding approval is given, the approval can be recorded without the request being completed. The approver can be told the approval was not applied, and trying again says the decision has already been recorded. The page stays where it was and the request stays open, although enough approvers have decided.",
    where: "Approval requests in a space that uses a Sentinel Vault workflow.",
    workaround: "The person who asked can press Withdraw request on the page banner and then ask for approval again. The approvers then need to decide again.",
  },

  // closed by 8.17.0 (SVT-147), moved out of KNOWN by the release door on 2026-10-22
  {
    k: "known-waiting-count-higher-than-lists", c: "M", affects: "8.16.0", fix: "scheduled",
    t: "The number of things waiting on you can be higher than the lists show",
    see: "The total at the top of My work can count an approval request or a proposed change that the lists below leave out, for example one on a page you cannot view or a page in the trash, or an approval whose AI review did not pass, or approvals past the first 25, which is as many as the approvals list shows. The page banner's Waiting for you count can also count an approval whose AI review did not pass. After you approve or deny from the approvals list on My work, the total keeps the old number until you reload the page.",
    where: "My work, the total at the top; the page banner, Waiting for you.",
    workaround: "Use the lists on My work: they show what you can act on. Reload My work after you decide to see the total update.",
  },

  // closed by 8.19.0 (SVT-150), moved out of KNOWN by the release door on 2026-10-22
  // 2026-10-22: found while testing, live, the release of a lapsed seal on a page deleted from the trash; confirmed on the 8.18.0 code, fix scheduled.
  {
    k: "known-purged-page-seal-missing-from-owner-lists", c: "S", affects: "8.18.0", fix: "scheduled",
    t: "A sealed file whose page was deleted from the trash disappears from your own list of sealed files",
    see: "If the page a file is on is deleted permanently from the space's trash, the file's seal is kept, but the file no longer appears under Files you hold sealed in My work or under My Sealed Files in space settings, so you cannot release it yourself.",
    where: "My work, Files you hold sealed; space settings, My Sealed Files.",
    workaround: "Ask a space admin to release it. Space admins still see the file on the Sealed Files tab in space settings, marked Missing, and can release it there with a reason while the site setting Allow space admins to force-unseal is on.",
  },

  // closed by 8.19.0 (SVT-149), moved out of KNOWN by the release door on 2026-10-22
  // 2026-10-22: found while reviewing the 8.18.0 release; confirmed on the 8.18.0 code, fix scheduled.
  {
    k: "known-workflow-hourly-check-stuck", c: "W", affects: "8.18.0", fix: "scheduled",
    t: "On sites with many pages in workflows, the hourly workflow check can keep starting again at the same place",
    see: "Once an hour Sentinel Vault goes through the pages in workflows, for example to move a page whose review date has passed to Expired and to keep state labels in step. On a site with very many pages in workflows, this check can fail to finish and start again at the same place the next hour. Pages that come later in the list can then stay in their state after their review date has passed, with no overdue comment on the page, and their state labels can fall out of step.",
    where: "Spaces with workflows turned on: review dates, the Expired state and state labels.",
    workaround: "Where the page's workflow allows it, open the Sentinel Vault banner on a page whose review date has passed and use Move to… to move it on, or set a new review date there.",
  },

  // closed by 8.21.0 (SVT-148), moved out of KNOWN by the release door on 2026-10-23
  // 2026-10-22: found while testing what a page deleted from the trash leaves behind; confirmed on the 8.17.0 code, fix scheduled.
  {
    k: "known-purged-page-activity-no-title", c: "A", affects: "8.17.0", fix: "scheduled",
    t: "After a page is deleted from the trash, the Activity tab can show its events under the page's ID instead of its title",
    see: "Once a page has been deleted permanently from the space's trash, the Activity tab in space settings still lists who did what on it, but the Page column can show those events as Page followed by a number, and the pageTitle column of the CSV export can be empty.",
    where: "Space settings, Activity tab, and its Export CSV file.",
    workaround: "Note the page's title before you delete it from the trash. The number shown is the page's ID, so an export taken while the page still existed links the two.",
  },

  // closed by 8.21.0 (SVT-152), moved out of KNOWN by the release door on 2026-10-23
  // 2026-10-23: reproduced on the test site; confirmed on the 8.20.0 code, fix scheduled.
  {
    k: "known-native-classification-page-change-fails", c: "L", affects: "8.20.0", fix: "scheduled",
    t: "Changing a page's classification fails on sites that use Confluence's own classification levels",
    see: "On a site where Sentinel Vault uses Confluence's own classification levels, choosing a level for a page, or choosing to follow the space default, shows an error and the page keeps its level. Raising a level also asks for the reason meant for lowering one, and a page that follows its space default says its level was set on the page.",
    where: "The page's classification chip and page details, and the classification settings in space and site settings.",
    workaround: "Set the page's level with Confluence's own classification control on the page. Setting a space's default level from Sentinel Vault works, though raising it asks for a reason.",
  },

  // closed by 8.21.0 (SVT-151), moved out of KNOWN by the release door on 2026-10-23
  // 2026-10-23: found in the production logs (one site, hourly); confirmed on the 8.20.0 code, fix scheduled.
  {
    k: "known-backup-no-space-fails-hourly", c: "B", affects: "8.20.0", fix: "scheduled",
    t: "On a site with no space Sentinel Vault can keep its backup page in, the automatic backup fails every hour",
    see: "When Sentinel Vault sees no space it can keep its backup page in, Backup and restore says the last backup failed and gives the reason, and the site history gets a new backup failed entry every hour.",
    where: "Site settings, Backup and restore, and its history.",
    workaround: "Choose a space for the backup with Move to another space. It must be a space where Sentinel Vault can view and add pages.",
  },

  // closed by 8.21.0 (SVT-153), moved out of KNOWN by the release door on 2026-10-23
  // 2026-10-23: found while fixing the backup row above; confirmed on the 8.20.0 code, fix scheduled.
  {
    k: "known-backup-busy-second-page", c: "B", affects: "8.20.0", fix: "scheduled",
    t: "When Confluence is busy, a backup can start a second backup page",
    see: "If Confluence is limiting requests or answers with an error while a backup looks for its backup page, the backup can create a new backup page and keep its later backups there. The earlier backups stay on the earlier page.",
    where: "Site settings, Backup and restore.",
    workaround: "None needed to keep your backups: the earlier ones are not deleted and stay on the earlier backup page.",
  },
];
