/**
 * PURE. Violation-comment dedup: has this outcome already been announced for this
 * (page, target) inside the current 24h window?
 *
 * Zero imports (the shared/baseline.js pattern) so the rule can be tested without KVS.
 *
 * F2 (owner feedback 2026-08-27) — "I was able to delete a sealed document; after a few second
 * it restored but without a specific notification". A UI delete of an embedded sealed file fires
 * BOTH updated:page and trashed:attachment. it58 aliased those two verbs onto one marker class so
 * a single delete could not produce two comments — correct as far as it went, but it also meant
 * whichever event won the race posted the ONLY comment there would ever be, and the trash handler
 * usually lost. The owner was told "the page content has been reverted" and never that the file
 * itself had been pulled back out of the trash.
 *
 * So the marker records WHICH outcomes it stands for, not merely that it exists. A repeat of the
 * same outcome is still swallowed — that is the incident spam loop the class was added to close —
 * while a materially different outcome is never hidden behind its sibling.
 */

/**
 * @param {object|null|undefined} existing  the stored marker, or null when none
 * @param {string} outcome                  the raw action verb about to be announced
 * @returns {{announce: boolean, marker?: {outcomes: string[]}}}
 *   announce: post the comment. marker: the outcome list to store when announcing.
 */
export function decideAnnounce(existing, outcome) {
  if (!existing) return { announce: true, marker: { outcomes: [outcome] } };

  // A marker written before F2 carries no outcome list, so it cannot say which message it stood
  // for. It keeps blocking exactly as it used to — an upgraded install must not emit a burst of
  // catch-up comments for violations its users were already told about. Self-heals in 24h.
  if (!Array.isArray(existing.outcomes)) return { announce: false };

  if (existing.outcomes.includes(outcome)) return { announce: false };

  return { announce: true, marker: { outcomes: [...existing.outcomes, outcome] } };
}

/**
 * @returns {{ drop: boolean, marker?: {outcomes: string[]} }}
 *   What to do with the marker when the comment FAILED to post. Releases only the outcome this
 *   call claimed: dropping the whole key would un-announce a sibling that did post, and that
 *   sibling would then post a second time.
 */
export function decideRelease(existing, outcome) {
  if (!existing || !Array.isArray(existing.outcomes)) return { drop: true };
  const remaining = existing.outcomes.filter((o) => o !== outcome);
  if (remaining.length === 0) return { drop: true };
  return { drop: false, marker: { outcomes: remaining } };
}
