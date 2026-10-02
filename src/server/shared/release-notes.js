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
    version: "6.6.0",
    date: "2026-10-02",
    headline: "Your setup survives an uninstall: automatic backup, restore, export and import",
    changes: [
      "New: Backup and restore in Site settings. Sentinel Vault backs up your settings, seals, sealed sections, workflows, validation rules, classification and history after every change and once a day, to a Confluence page that only the app can open.",
      "New: after a reinstall, or when the app comes back after a lapsed subscription, Site settings offer \"Restore your setup from <date>\" with a preview of what comes back. Things that act on their own (seals expiring, validation revert, AI review, workflow auto-assign and review timers) come back paused until you turn them on.",
      "New: download the whole setup as one JSON file, and import it on this site or another one.",
      "New: REST operations backup, restore, export, import, rediscover, resume-automations and backup-location, for admin tokens.",
      "Changed: uninstalling no longer erases the app's stored data on the spot. Atlassian keeps it for 28 days, so the 21-day re-link path stays open.",
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
