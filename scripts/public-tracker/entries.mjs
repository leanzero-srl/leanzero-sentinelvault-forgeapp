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
    d: "If a sealed file cannot be put back (for example a temporary Jira error), the issue's Sentinel Vault section shows it as Not put back with a Put it back button, Sentinel Vault tries again on its own (after an hour, then less often, up to 10 times), and the expiry rules never delete that copy. If the same file is deleted again right after each time it is put back, for example by an automation rule, Sentinel Vault keeps the copy, shows the file as Not put back and says so on the issue; anyone who can edit the issue puts it back with Put it back. " + JIRA_ON,
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
  // Reworded note lines (2026-10-11, 8.4.0 commit): both now read as the outcome, word for word the
  // public text these issues already carried, so the note line itself is the description.
  // Issues keyed 8155941a5721bc75 and 09df2c3de21a70f3.
  e1a4994525618c2c: ["Purge, restore and force release are checked against the file's own space", "S", { id: "8155941a5721bc75" }],
  b9325e916fba1084: ["Clearing a lapsed seal from space settings needs its owner, a space admin or an editor of its page", "C", { id: "09df2c3de21a70f3" }],
  // Reworded note line (2026-10-11): was "Releasing one of several seals on a page no longer turns off
  // protection for the others", issue keyed 4d7af2e2e33c52fd. Public text says what holds now.
  c1381ac869ea1a31: ["Each seal on a page stays in force until it is itself released", "S", {
    id: "4d7af2e2e33c52fd",
    d: "Each seal on a page keeps its own file protected until that seal is released or expires.",
  }],
  "23792d6675c7c318": ["A new version uploaded by a seal's owner becomes the version the seal protects", "S"],
  // Reworded note line (2026-10-11), issue keyed 30ab95dfdfa9e559.
  "955367077fdaca82": ["Seals held by an approval stay in force until the approval ends", "W", {
    id: "30ab95dfdfa9e559",
    d: "While a page's approval holds its seals, a sealed file moved to the trash by anyone outside the approval, its owner included, is put back.",
  }],
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
// changed between 7.1.0 and 8.1.0, so all six stay open; 8.2.0 to 8.4.0 changed only the Jira seal
// code, which none of them is in); `affects` is the version it was confirmed on. Keyed by a stable
// slug. `why` (optional) says when the cause is Confluence's, not the app's.
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
];
