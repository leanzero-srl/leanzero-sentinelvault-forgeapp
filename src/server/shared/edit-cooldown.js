/**
 * Edit-request cooldown — the PURE rule for "how long after a declined request may the same
 * person ask again?". No Forge imports: `test/edit-cooldown.test.mjs` runs it in plain node and
 * the browser bundle imports it through row-state.js.
 *
 * One home (tester report 2026-09-17): the interval used to be a literal 48h typed into four
 * places (editreq/actions.js ×4 branches, page-details/actions.js, the row-state hint, the
 * resolver doc comment), so it could not be changed without them drifting. It is now the site
 * setting `editRequestCooldownHours` (0 = ask again at once) and every reader goes through
 * `cooldownMsFrom`. The sealer's direct grant (grant-edit-access / grant-section-edit) is the
 * other way out of a declined request and does not wait for the cooldown at all.
 */

export const EDIT_COOLDOWN_HOURS_DEFAULT = 1;
export const EDIT_COOLDOWN_HOURS_MAX = 168; // a week

/** The cooldown in ms from the global settings record; malformed / out-of-range → default. */
export function cooldownMsFrom(globalSettings) {
  const raw = globalSettings?.editRequestCooldownHours;
  const n = Number(raw);
  const hours = raw === null || raw === undefined || raw === "" || !Number.isFinite(n) || n < 0 || n > EDIT_COOLDOWN_HOURS_MAX
    ? EDIT_COOLDOWN_HOURS_DEFAULT
    : Math.floor(n);
  return hours * 3600 * 1000;
}

/** When a request declined at `deniedAt` may be made again (ISO), or null when it may be made now. */
export function retryAtFor(deniedAt, cooldownMs, now = Date.now()) {
  const t = deniedAt ? new Date(deniedAt).getTime() : 0;
  if (!Number.isFinite(t) || t <= 0) return null;
  const retry = t + cooldownMs;
  return retry > now ? new Date(retry).toISOString() : null;
}

export const isCoolingDown = (deniedAt, cooldownMs, now = Date.now()) => retryAtFor(deniedAt, cooldownMs, now) !== null;
