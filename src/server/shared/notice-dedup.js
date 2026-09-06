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
 *
 * it69 (the two races in SECURITY-TODO "Known, pre-existing"): KVS has no compare-and-swap, so a
 * claim is check-then-act. Two near-simultaneous deliveries can both read "no marker" and both
 * announce. The marker therefore also records a per-outcome CLAIM TOKEN; the claimer writes,
 * waits a settle interval, re-reads, and announces only if its own token still stands
 * (`confirmClaim`). And a clean save may clear the markers only when a USER made that save
 * (`decideClear`): a late duplicate delivery that reads the app's own restore is looking at the
 * app's work, not at a clean save, and must not release the window its sibling just claimed.
 */

/**
 * @param {object|null|undefined} existing  the stored marker, or null when none
 * @param {string} outcome                  the raw action verb about to be announced
 * @param {string} [token]                  this run's claim token for the outcome
 * @returns {{announce: boolean, marker?: {outcomes: string[], claims: Record<string,string>}}}
 *   announce: post the comment. marker: what to store when announcing.
 */
export function decideAnnounce(existing, outcome, token = "") {
  const claims = existing && existing.claims && typeof existing.claims === "object" ? existing.claims : {};
  if (!existing) return { announce: true, marker: { outcomes: [outcome], claims: { ...claims, [outcome]: token } } };

  // A marker written before F2 carries no outcome list, so it cannot say which message it stood
  // for. It keeps blocking exactly as it used to — an upgraded install must not emit a burst of
  // catch-up comments for violations its users were already told about. Self-heals in 24h.
  if (!Array.isArray(existing.outcomes)) return { announce: false };

  if (existing.outcomes.includes(outcome)) return { announce: false };

  return { announce: true, marker: { outcomes: [...existing.outcomes, outcome], claims: { ...claims, [outcome]: token } } };
}

/**
 * After the settle interval: does this run's claim still stand?
 * @returns {"held"|"lost"|"clobbered"}
 *   held      — my token is on record for this outcome: announce.
 *   lost      — another run's token is on record for this outcome: it announces, I stay silent.
 *   clobbered — the outcome is not on record at all: a sibling OUTCOME's writer overwrote the
 *               marker between my write and my re-read (F2 shape); merge mine back in and confirm
 *               again — never silently drop a materially different message.
 */
export function confirmClaim(existing, outcome, token) {
  const claims = existing && existing.claims && typeof existing.claims === "object" ? existing.claims : {};
  const held = claims[outcome];
  if (held === token) return "held";
  if (typeof held === "string" && held.length > 0) return "lost";
  return "clobbered";
}

/**
 * @returns {{ drop: boolean, marker?: {outcomes: string[], claims?: Record<string,string>} }}
 *   What to do with the marker when the comment FAILED to post. Releases only the outcome this
 *   call claimed: dropping the whole key would un-announce a sibling that did post, and that
 *   sibling would then post a second time.
 */
export function decideRelease(existing, outcome) {
  if (!existing || !Array.isArray(existing.outcomes)) return { drop: true };
  const remaining = existing.outcomes.filter((o) => o !== outcome);
  if (remaining.length === 0) return { drop: true };
  const claims = { ...(existing.claims && typeof existing.claims === "object" ? existing.claims : {}) };
  delete claims[outcome];
  return { drop: false, marker: { outcomes: remaining, claims } };
}

/**
 * May this run clear the (page, target) markers on the strength of a clean body?
 * A clear re-arms the comment for the next tamper, so it must stand for a real clean save.
 * @param {object} o
 * @param {boolean} o.sawViolations   this run saw a violation on any attempt (409 retry twin)
 * @param {string|null} o.readAuthorId  who saved the version the run judged clean (v2 authorId)
 * @param {string|null} o.appAccountId  the app's own account
 */
export function decideClear({ sawViolations, readAuthorId, appAccountId }) {
  if (sawViolations) return false;
  // The body we judged clean was written by the app itself — a restore. A run reading that is a
  // late or duplicate delivery of the tamper it fixed, not a user's clean save. Nothing to re-arm.
  if (appAccountId && readAuthorId && readAuthorId === appAccountId) return false;
  // No author on the read (older payload shape): keep the pre-it69 behaviour rather than
  // silently disabling the re-arm forever.
  return true;
}
