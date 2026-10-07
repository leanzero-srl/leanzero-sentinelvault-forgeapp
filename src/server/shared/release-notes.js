/*
 * Release notes (baseline pillar 4) — a module constant, newest first, bundled into the backend
 * AND the site console (no storage, no manifest entry). Written for the admin running the site, in
 * the same commit as the code they describe; `docs/RELEASE-NOTES.md` is rendered from here by
 * scripts/render-release-notes.mjs. Pinned by test/release-notes.test.mjs.
 *
 *   version        the PRODUCTION product version this note ships as (Forge prod version)
 *   status         "testing" until the version is live in production on the Marketplace
 *   reconstructed  true for an entry written after the fact (from the Marketplace listing text)
 */
const note = (n) => Object.freeze({ ...n, changes: Object.freeze([...(n.changes || [])]), fixes: Object.freeze([...(n.fixes || [])]) });

export const RELEASE_NOTES = Object.freeze([
  note({
    version: "7.1.0",
    date: "2026-10-07",
    headline: "Sentinel Vault works better on phones, tablets and smaller laptop screens",
    changes: [
      "Changed: file cards in space settings, the attachments view and the page panel no longer cut a file's name short to fit their buttons, on phones, tablets and laptops. A card keeps its buttons on the same line as the name when both fit and moves them under the name when they do not. On wide screens the attachments view shows up to five columns instead of three stretched cards. The panel's Cards per row setting is now a maximum, because a card is never narrower than about 340 px, so a panel set to 3 per row shows 2 on a standard-width page.",
      "Changed: the page banner fits a phone, and nothing overlaps its Open button. To make room, a banner narrower than about 860 px (phones, most tablets, narrow windows) no longer shows the Validation and AI check chips, and below about 720 px it also leaves out the approval and review-date chip. The review date and approval record are still in the window Open shows. Validation and AI check results are in the Sentinel Vault panel on pages that have one.",
      "Changed: the Sentinel Vault window (Open on the banner, or Sentinel Vault under the page title) and Seal attachments lay out for a phone's width, their menus open where you can see them, and while you tick files the Seal button stays pinned in view without covering the file you just ticked. On a phone only Open on the banner fills the screen. Opened from under the page title or from Seal attachments… in the page menu, the window keeps a fixed height, and on a phone held sideways you scroll down to reach the Seal button.",
      "Changed: space and site settings fit tablets and narrow windows. On a phone, Confluence still shows these pages wider than the screen, so you scroll sideways, but their dialogs and the Not applied yet reminder open in the part you can see. The tabs wrap into even rows instead of leaving one tab alone on a line, the Activity, API access and backup tables turn into stacked rows instead of scrolling sideways, the Workflow tab lists its first 20 pages and API access its newest 10 jobs with a Show all link, revoked API tokens are folded behind a link that shows them, and on wide screens the settings keep a readable width.",
      "Changed: buttons, checkboxes, switches and chips are bigger on phones and tablets, most small labels and badges are now at least 11 px, and in dark mode the text on cyan and red buttons is readable.",
    ],
    fixes: [
      "API access and the Activity report showed some people as an account ID. They now show the person's name. When Atlassian returns no name for an account, the Activity report says Someone and API access leaves the name out.",
      "The Not applied yet reminder could cover the setting you had just changed, such as a new validation rule's pickers. It now appears near that setting without covering any button or field, and nothing on the page moves when it appears.",
      "A sealed section further down a page could show \"could not display this section's text\" if you reached it more than about 15 seconds after the page opened. It now waits until you reach it and shows its content.",
    ],
    action: "Nothing to do if your site already runs 7.0.0. A site still on an earlier version gets this update after a site admin approves the 7.0.0 update in Confluence administration, Apps, Manage apps.",
  }),
  note({
    version: "7.0.0",
    date: "2026-10-05",
    headline: "The weekly personal-data check now asks Atlassian about closed accounts, and the app asks for fewer permissions",
    changes: [
      "New permission: this update asks a site admin to approve one new permission, reporting personal data to Atlassian. Until it is approved the site stays on the previous version.",
      "Changed: once approved, the weekly personal-data check sends Atlassian the ids of the accounts Sentinel Vault stores, each at most once per Atlassian's reporting cycle (7 days unless Atlassian sets another period). When Atlassian answers that an account was closed, the app erases that person everywhere it keeps them, including the backup. When it answers that an account changed, the app refreshes the stored name.",
      "Changed: the first check runs within a day of the update, and each account is then checked every 7 days on the day, or on the period Atlassian asks for. If Atlassian refuses a check, it is tried again the next day instead of a week later.",
      "Note: sealed sections are the record of what was sealed and are never rewritten. A closed account mentioned inside sealed content stays mentioned there, as in Confluence's own page history; everything else the app keeps about that person is erased once, and is erased again only if a restore brings it back.",
      "Changed: Sentinel Vault asks for fewer permissions. It no longer requests 12 it held but did not use: read:confluence-space.summary, read:confluence-props, read:content:confluence, write:content:confluence, write:attachment:confluence, read:comment:confluence, read:content.property:confluence, write:content.property:confluence, read:content.restriction:confluence, write:content.restriction:confluence, read:content.metadata:confluence and read:content.permission:confluence. Everything the app did with them it already does through the permissions it keeps, so nothing it does changes.",
      "Kept on purpose: read:confluence-content.summary, because Confluence only tells the app about page and attachment changes with it, and read:label:confluence, which the page label check uses.",
    ],
    fixes: [
      "The weekly check could not ask Atlassian about closed or changed accounts, because the app did not hold the permission for it.",
    ],
    action: "A site admin approves the update in Confluence administration, Apps, Manage apps. Nothing else to do.",
  }),
  note({
    version: "6.11.0",
    date: "2026-10-04",
    headline: "Email addresses brought back by a restore are cleaned again",
    changes: [
      "Changed: the weekly personal-data check removes stored email addresses from seal records and approver lists every week, not only the first time, so addresses that a restore or import of an older backup brought back are cleaned too.",
    ],
    fixes: [],
    action: "Nothing to do.",
  }),
  note({
    version: "6.10.0",
    date: "2026-10-04",
    headline: "Viewing a page no longer triggers a backup, so a deleted backup stays deleted",
    changes: [
      "Changed: opening a page no longer schedules a backup. A backup is scheduled only after a change, or when the page check actually puts protected text back.",
      "Changed: after Delete the backup, the weekly personal-data check and backups queued before the delete no longer take a new one. Only the next change in the app or over REST, or Back up now, does.",
    ],
    fixes: [
      "Delete the backup could be undone within minutes by someone opening a page.",
      "A backup file is counted as deleted only once it is purged from the trash, and a second Delete finishes files an interrupted delete left in the trash.",
    ],
    action: "Nothing to do.",
  }),
  note({
    version: "6.9.0",
    date: "2026-10-04",
    headline: "Delete the backup stays deleted, and approver lists no longer keep email addresses",
    changes: [
      "Changed: after Delete the backup, the hourly check no longer takes a new backup on its own. A new one is taken only after your next change, or when you press Back up now, and the Backup tab says when the backup was deleted.",
      "Changed: approver lists in workflow settings no longer store the approver's email address. The people picker still shows it while you search. Lists saved earlier are cleaned by the weekly check.",
    ],
    fixes: [
      "Deleting the backup before an uninstall could be undone within the hour by an automatic backup on a new page.",
      "The Delete the backup dialog said nothing could bring the setup back after an uninstall; an export you downloaded, or Atlassian re-linking the app within 21 days, still can.",
    ],
    action: "Nothing to do.",
  }),
  note({
    version: "6.7.0",
    date: "2026-10-04",
    headline: "Privacy and retention: an optional keep period for history, and less personal data stored",
    changes: [
      "New: Site settings, Privacy and retention. Turn on \"Delete old history\" to have activity history, workflow history and read confirmations older than \"Keep history for\" (730 days unless you change it) deleted by a weekly check. It is off unless you turn it on, so nothing is deleted on upgrade.",
      "New: the weekly check can be run at once from the same place, and over the REST API (operation privacy-sweep, admin tokens).",
      "Changed: authenticator codes for signed actions are now stored as encrypted secrets. Nobody has to set them up again; each moves across the first time it is used.",
      "Changed: Sentinel Vault no longer stores the email address of the person who seals a file or section, and the seal marker on a page now carries only who sealed it and when. Older markers are rewritten by the weekly check.",
      "Changed: Delete the backup now deletes every backup file for good before the emptied page goes to the space trash, and says so when something could not be removed.",
      "New: Documentation and Support links at the top of Site settings.",
    ],
    fixes: [
      "Delete the backup used to report success while the backup page stayed where it was.",
      "Read confirmations and approvals that name a group now reach the group's members.",
      "A sealed file deleted for good is now recognised as gone, so its seal record is cleaned up.",
    ],
    action: "If your records policy sets a keep period for history, turn on Delete old history in Site settings, Privacy and retention and set it there.",
  }),
  note({
    version: "6.6.0",
    date: "2026-10-02",
    headline: "Your setup survives an uninstall: automatic backup, restore, export and import",
    changes: [
      "New: Backup and restore in Site settings. Sentinel Vault backs up your settings, seals, sealed sections, workflows, validation rules, classification and history after each change in the app or REST API and once a day, to a Confluence page restricted to the app.",
      "New: after a reinstall, or when the app comes back after a lapsed subscription, Site settings offer \"Restore your setup from [date]\" with a preview of what comes back. Things that act on their own (seals expiring, validation revert, AI review, workflow auto-assign and review timers) come back paused until you turn them on.",
      "New: download the whole setup as one JSON file and import it back later.",
      "New: REST operations backup, restore, export, import, rediscover, resume-automations and backup-location, for admin tokens.",
      "Changed: uninstalling no longer erases the app's stored data on the spot. Atlassian keeps it for 28 days, so LeanZero can still ask Atlassian to re-link it within 21 days.",
    ],
    fixes: [
      "Dialogs opened from low on a long page (Site settings, space settings, page panels) now open fully on screen, with their buttons in view.",
    ],
    action: "Open Site settings, Backup and restore, once after the update and check that the first backup is there. REST API tokens and authenticator codes are never backed up; after a restore, create new tokens and ask people who sign actions to enroll again.",
  }),
  note({
    version: "6.5.0",
    date: "2026-09-30",
    reconstructed: true,
    headline: "REST API: give, revoke and decline edit access now work",
    fixes: [
      "The REST operations that give, revoke and decline edit access to sealed files and sections now run. In 6.4.0 they were accepted but every job failed with \"No resolver\". Resubmit any failed job with a new Idempotency-Key.",
    ],
  }),
  note({
    version: "6.4.0",
    date: "2026-09-30",
    reconstructed: true,
    headline: "Always-visible classification, honest Force release, clearer sealed-files panel",
    changes: [
      "New: every page shows its classification level. Raising it is one action; lowering it asks for a reason.",
      "Improved: Force release is offered only to space admins when \"Allow space admins to force-unseal\" is on.",
      "Improved: Sealed and Available files page separately, counts match the cards, and a file you just sealed or released moves to the top of its group.",
      "A declined edit request can be retried after a site-configurable cooldown (default 1 hour).",
      "Seal actions can require a 6-digit authenticator code (site setting).",
    ],
  }),
]);

export const CURRENT_RELEASE = RELEASE_NOTES[0];

/** PURE. "6.10.0" > "6.9.2". */
export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}
