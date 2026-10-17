// A page that MOVED to another space after its workflow started runs on the rules of the space it
// left (its definition, approvers, conditions, AI budget), which that space's admins can change and
// the new space cannot see. Its workflow therefore holds still until an admin of both spaces, or a
// site admin, takes it out and starts it again: no request, decision, re-request, AI completion or
// accepted proposal moves it meanwhile. A "no" is still allowed (it only closes a request).
// ONE home for that rule: request-transition, decide-approval, re-request, the approval finalizer
// and proposals all ask here. A failed lookup holds too (retry), never lets it through.
import { readPageWorkflow } from "./logic.js";
import { recordAuthority, isStewardOfSpaces } from "../../shared/content-access.js";
import { isAccountStewardAsApp } from "../../shared/steward-checks.js";

export const MOVED_HOLD_REASON = "This page moved to another space after its workflow started. An admin of both spaces, or a site admin, needs to start its workflow again before it can change state.";
export const MOVED_UNKNOWN_REASON = "Could not check where this page is right now — please retry.";

/**
 * null when the page's workflow may move; else `{ reason, moved?, unknown? }`.
 * `storedKey` defaults to the workflow record's space; `liveKey` is a space key Confluence just gave
 * for this page; `check` is the steward test for the actor (an admin of both spaces passes).
 */
export async function movedPageHold(pageId, { actorAccountId = null, storedKey, liveKey = null, check = isAccountStewardAsApp } = {}) {
  if (!pageId) return null;
  const stored = storedKey !== undefined ? storedKey : ((await readPageWorkflow(pageId))?.spaceKey || null);
  if (!stored) return null; // no record space: nothing it could have moved from
  const auth = await recordAuthority({ contentId: pageId, storedKey: stored, liveKey });
  if (!auth.known) return { reason: MOVED_UNKNOWN_REASON, unknown: true };
  if (!auth.moved) return null;
  if (actorAccountId && (await isStewardOfSpaces(check, actorAccountId, auth.spaces))) return null;
  return { reason: MOVED_HOLD_REASON, moved: true };
}
