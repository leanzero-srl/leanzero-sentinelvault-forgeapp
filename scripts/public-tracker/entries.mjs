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
};

export const ENTRIES = {
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
  "79e107cef46f4431": ["The first personal-data check runs within a day of the update", "D"],
  // A note that qualifies the erasure line above; carried in that issue's description.
  "4556ad45fa3d8ee4": ["", "D", { fold: "97c0b636a957c0d4" }],
  "43a02b2d24c9bcde": ["Sentinel Vault asks for 12 fewer permissions", "I", {
    d: "Sentinel Vault asks for fewer permissions. It no longer requests 12 it held but did not use: read:confluence-space.summary, read:confluence-props, read:content:confluence, write:content:confluence, write:attachment:confluence, read:comment:confluence, read:content.property:confluence, write:content.property:confluence, read:content.restriction:confluence, write:content.restriction:confluence, read:content.metadata:confluence and read:content.permission:confluence. Everything the app did with them it already does through the permissions it keeps, so nothing it does changes. Two are kept on purpose: read:confluence-content.summary, because Confluence only tells the app about page and attachment changes with it, and read:label:confluence, which the page label check uses.",
  }],
  // "Kept on purpose" qualifies the permission line above; carried in that issue's description.
  "1c37b3461723560b": ["", "I", { fold: "43a02b2d24c9bcde" }],
  f9be20e18d7cff16: ["The weekly check could not ask Atlassian about closed or changed accounts", "D"],

  // 6.11.0 (2026-10-04)
  "312ffb32a22ec18b": ["Email addresses brought back by a restore are cleaned every week", "D"],

  // 6.10.0 (2026-10-04)
  "2c3b5920fd91e2ba": ["Opening a page no longer schedules a backup", "B"],
  b7dba70248a89e99: ["After Delete the backup, the weekly check and backups queued earlier take no new backup", "B"],
  "88c021613301e484": ["Delete the backup could be undone by someone opening a page", "B"],
  "5c79d3744c4b859e": ["A backup file counted as deleted while it was still in the trash", "B"],

  // 6.9.0 (2026-10-04)
  "6036a92c6caa7bf3": ["After Delete the backup, no new backup is taken until your next change", "B"],
  "913ede5ce2ad9cad": ["Approver lists in workflow settings no longer store email addresses", "D"],
  ecd546ab2fb14d66: ["A backup deleted before an uninstall could come back within the hour", "B"],
  c47db610d884c943: ["The Delete the backup dialog said nothing could bring the setup back after an uninstall", "B"],

  // 6.7.0 (2026-10-04)
  "6f53aee0c9069a52": ["Optional keep period for activity history, workflow history and read confirmations", "D", {
    d: "Site settings has a new Privacy and retention section. Turn on \"Delete old history\" to have activity history, workflow history and read confirmations older than \"Keep history for\" (730 days unless you change it) deleted by a weekly check. It is off unless you turn it on, so nothing is deleted on upgrade. If your records policy sets a keep period for history, turn on Delete old history there and set the period.",
  }],
  c3680a2963cfa650: ["Run the weekly privacy check at once, in Site settings or over the REST API", "D", {
    d: "The weekly privacy check can be run at once from Site settings, Privacy and retention, and over the REST API (operation privacy-sweep, admin tokens).",
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
  "02dc09e3ae3c6c5a": ["Every page shows its classification level", "L"],
  "63b9625934ccc58c": ["Force release is offered only when a space admin may use it", "S"],
  "3dc93496d26ec777": ["Sealed and Available files page separately, and the counts match the cards", "S"],
  "25208201ab12f4bd": ["A declined edit request can be asked again after a cooldown", "E"],
  "62540185f1c856a3": ["Seal actions can require an authenticator code", "S"],
};

// KNOWN, OPEN bugs a person using Sentinel Vault can meet today. Each was checked against the code
// at the 7.1.0 release (2026-10-09); `affects` is the version it was confirmed on. Keyed by a stable
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
    workaround: "Use Open on the page's Sentinel Vault banner where the page shows one: on a phone that window fills the screen. Otherwise scroll down inside the window to reach its buttons.",
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
    k: "known-edit-access-ends-at-old-seal-date", c: "E", affects: "7.1.0",
    t: "After Seals expire is turned off and on again, edit access on a sealed file can end before the seal does",
    see: "Edit access given on a sealed file ends on the seal's end date. When a site admin turns Seals expire off and later on again, the seal's end date moves later by the time it was off, but edit access already given still ends on the old date, so after that date the person can no longer change the file.",
    where: "Edit access on sealed files, on a site where Seals expire (Site settings) was turned off and then on again.",
    workaround: "The file's owner, or a space admin, gives edit access again with Give edit access… in the file's ⋯ menu. The new access lasts until the seal's new end date.",
  },
  {
    k: "known-ai-chip-counts-dismissed", c: "P", affects: "7.1.0",
    t: "The banner's AI check chip still counts findings you dismissed",
    see: "The AI check chip on the page banner counts every finding from the latest AI review, including the ones you dismissed or marked as a false positive.",
    where: "The page banner, on pages that had an AI review, on screens wider than about 860 px.",
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
    t: "On a narrow phone, the Not applied yet reminder can sit over the Enforcement heading",
    see: "On a narrow phone, after you change a validation setting, the Not applied yet reminder can cover the Enforcement heading's text. It does not cover a button or a field.",
    where: "Space settings or Site settings, Validations tab, on a narrow phone.",
    workaround: "Press Apply or Discard on the reminder, or scroll a little to read the heading.",
  },
];
