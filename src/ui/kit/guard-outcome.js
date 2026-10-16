/*
 * What the page banner does with the answer of `guard-page-now` (the server judging the live version
 * ahead of its late page event). PURE, zero imports — test/guard-outcome.test.mjs.
 *
 * The guard can change what the banner shows in two ways: it WROTE the page (a seal or the approved
 * version put back → `restored`), or it moved the page's workflow without a write (a demote →
 * `workflowChanged`). Until 2026-10-16 only the first re-ran the banner, so after a demote it kept
 * saying "Approved vN" until the reader reloaded.
 */
export const GUARD_REEVALUATE_REASONS = Object.freeze(["guard restored", "guard workflow changed"]);

/** The evaluate() reason to re-run the banner with, or null when the answer changes nothing on it. */
export function guardReevaluateReason(answer) {
  if (!answer || typeof answer !== "object") return null;
  if (answer.restored === true) return "guard restored";
  if (answer.workflowChanged === true) return "guard workflow changed";
  return null;
}

/** An evaluation started BY a guard answer must not ask the guard again (no loop). */
export const isGuardFollowUp = (why) => GUARD_REEVALUATE_REASONS.includes(why);
