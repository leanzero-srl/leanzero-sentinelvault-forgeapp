/*
 * The rules every workflow-enforcement path shares (the page event, the guard that runs it early,
 * the hourly sweep). PURE, zero imports — test/workflow-enforce-rules.test.mjs. Each rule had more
 * than one home before 2026-10-16 and the homes disagreed, which is how the bugs below shipped.
 */

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
export function enforceModeOf(settings) {
  return settings?.enforceMode === "revert" ? "revert" : "demote";
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
