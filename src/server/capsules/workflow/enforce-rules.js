/*
 * The rules every workflow-enforcement path shares (the page event, the guard that runs it early,
 * the hourly sweep). PURE — its only import is the pure state machine (state-machine.js), so the
 * browser can read it too — test/workflow-enforce-rules.test.mjs. Each rule had more than one home
 * before 2026-10-16 and the homes disagreed, which is how the bugs below shipped.
 */
import { planDemote, findState, validateDemoteTarget } from "./state-machine.js";

/**
 * What an edit by someone outside the privileged set does to an enforced page: "revert" (the
 * approved version is restored) or "demote" (the page moves back for review). Exactly what the
 * space admin chose — the Workflow tab, its rule sentence, the banner and the page details all say
 * this mode, so the engine must do this mode.
 *
 * Until 2026-10-16 the engine quietly turned revert into demote when the approval had no named approvers
 * (CL-5, F44-DESIGN §2.1 step 4: "a misconfig must not blank every non-steward edit"). Every part
 * of that fear is handled elsewhere: such a page reaches Approved only through a space admin's own
 * approval (or an AI-reviewed request a space admin made), which pins the version that admin saw as
 * `approvedVersion`; the privileged set is then the space admins, exactly as in demote mode; an
 * empty or unreadable baseline never blanks the page (Pass 0 CL-1, sweepRevertToApproved); and an
 * approver group that cannot be expanded refuses the request instead of producing an empty set.
 */
export function enforceModeOf(settings, { moved = false, def = null, stateId = null } = {}) {
  return enforcementPlan(settings, { moved, def, stateId }).mode;
}

/**
 * What the engine does to an unapproved edit, with the definition in hand: `{ mode: "revert",
 * fallback }` or `{ mode: "demote", target }`. A demote that cannot be made in this workflow
 * (state-machine.js planDemote: no transition to the target, the target is itself an enforce state,
 * …) is a REVERT, with `fallback: { code, reason }` saying why — never a silent no-op.
 * `stateId` is the page's state (the edge that will be taken); without it the target must be
 * reachable from every enforce state (the save-time check). Without `def` the chosen mode is
 * returned unchecked (a caller that cannot know; the engine always passes it).
 */
export function enforcementPlan(settings, { moved = false, def = null, stateId = null } = {}) {
  // A page that moved to another space after its workflow started is always reverted: the old
  // space's mode, demote target and definition are not the new space's (workflow/moved-hold.js).
  if (moved) return { mode: "revert", fallback: null };
  if (settings?.enforceMode === "revert") return { mode: "revert", fallback: null };
  if (!def) return { mode: "demote", target: null, fallback: null };
  const plan = planDemote(def, settings, stateId);
  if (plan.ok) return { mode: "demote", target: plan.target, fallback: null };
  return { mode: "revert", fallback: { code: plan.code, reason: plan.reason } };
}

/**
 * PURE. The save-time question: in demote mode, can every enforced page of this definition be moved
 * back? Null when it can (or the space reverts), else the reason a space admin reads. The settings
 * save, the definition save and the Workflow tab all ask this one function.
 */
export function demoteConfigProblem(def, settings) {
  const plan = enforcementPlan(settings, { def, stateId: null });
  if (plan.fallback) return plan.fallback.reason;
  // A chosen state this definition still HAS but can no longer move pages to (an edge dropped since
  // the setting was saved): the engine would quietly send pages to the first state instead, while
  // the tab still names the chosen one. A state the definition does not have (a label workflow with
  // other states, a state removed) means "the first state", as it always has.
  const want = settings?.demoteTo;
  if (plan.mode === "demote" && typeof want === "string" && want && want !== "initial" && findState(def, want)) {
    const v = validateDemoteTarget(def, want, settings?.entryConditions);
    if (!v.ok) return v.reason;
  }
  return null;
}

/**
 * Is this page under an enforced (Approved) state RIGHT NOW? The ONE rule for the page trigger's
 * probe, the hourly sweep, the seal gate (privilege.js) and the section retry. Enforced when the
 * page's state is an enforce state of its definition, or — for a record that entered one
 * (`record.enforce`) — when the definition cannot be trusted to say otherwise: the page moved to
 * another space (moved-hold.js), where it is could not be read (`auth.known === false`, or no
 * `auth` at all), or its state is gone from the definition (a definition or backup written past the
 * "a state still has pages" check, 2026-10-21). A known state the definition no longer flags as
 * enforced is the admin switching protection off for it: not enforced.
 */
export function isEnforcedNow(record, def, auth = null) {
  if (!record) return false;
  const state = findState(def, record.stateId);
  if (state?.enforce) return true;
  if (record.enforce !== true) return false;
  return !state || !auth || auth.moved === true || auth.known === false;
}

/**
 * Is this page event about a version the approval already covers? The baseline (`approvedVersion`)
 * is the version the approvers reviewed; a version at or below it was written BEFORE the approval
 * (an approval is refused when the page moved after the request — WF-1), so judging it now would
 * punish the requester for the edit that was approved. Page events arrive late (measured ~10 min),
 * so the requester's own last pre-approval save routinely lands after the approval. Unknown
 * versions (a synthetic event with no number) are judged as before.
 */
export function eventPredatesBaseline(eventVersion, approvedVersion) {
  return typeof eventVersion === "number" && Number.isFinite(eventVersion)
    && typeof approvedVersion === "number" && approvedVersion >= 1
    && eventVersion <= approvedVersion;
}

/**
 * The site switch "Protect Sealed Attachments in Page Body" (`enableContentProtection`, default on)
 * also switches off Approved-page enforcement (settings-reference.md, user guide). One reading of
 * it for every enforcement path.
 */
export function contentProtectionEnabled(globalPolicy) {
  return globalPolicy?.enableContentProtection !== false;
}

/**
 * What the app will DO to an unapproved edit of an enforced page, for the sentences that tell people:
 * "revert", "demote", or "off" when the site switch above has switched enforcement off. The banner,
 * the page details and the Workflow tab said "reverted" / "moved back" while the switch was off and
 * the engine did nothing (2026-10-16) — the same words-vs-behaviour gap as the old CL-5 downgrade.
 */
export function shownEnforcement(settings, globalPolicy, { moved = false, def = null, stateId = null } = {}) {
  // With the page's definition and state the word is what the engine will really do (a demote this
  // workflow cannot make is a revert — enforcementPlan).
  return contentProtectionEnabled(globalPolicy) ? enforceModeOf(settings, { moved, def, stateId }) : "off";
}
