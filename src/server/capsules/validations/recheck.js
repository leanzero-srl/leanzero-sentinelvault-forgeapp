// Re-check persistence — the ONE decision for whether an on-demand check may replace the page's
// stored pass/fail status. Zero imports (unit-tested in test/validation-recheck.test.mjs).
//
// Why (tester, 2026-09-23): the panel's badge only ever changed on a published save, so after
// Re-check it could read "Passed" above a listed violation, and a label change (which makes no
// new page version, so no save check) left the badge wrong until the next unrelated edit.

/**
 * PURE.
 * @param {object} p
 * @param {boolean} p.gateOn      pass/fail status is on for the page's space (effective modes)
 * @param {boolean} p.canEdit     the caller may edit the page (the bar for any app write to it)
 * @param {boolean} p.checked     the check actually ran (no read failure, rules present)
 * @param {boolean} p.passed      the check's verdict
 * @param {number|null} p.version the live page version the check read
 * @param {object|null} p.stored  the stored validation state
 * @returns {{ write: boolean, why: string }}
 */
export function decideRecheckWrite({ gateOn, canEdit, checked, passed, version, stored }) {
  if (!checked) return { write: false, why: "not-checked" };
  if (!gateOn) return { write: false, why: "gate-off" };
  if (!canEdit) return { write: false, why: "cannot-edit" };
  // A space admin's "Approve anyway" stands for the version they approved: a re-check of that same
  // version must not quietly undo their decision. The next published version is judged again.
  if (!passed && stored && stored.approvedBy && version != null && Number(stored.version) === Number(version)) {
    return { write: false, why: "approved-override" };
  }
  return { write: true, why: "ok" };
}

/** PURE. The sentence the panel shows under a live result that did NOT update the stored status. */
export function recheckNote(why) {
  switch (why) {
    case "gate-off": return "This is a live check. Pass/fail status is off for this space, so nothing was stored.";
    case "cannot-edit": return "This is a live check. The status updates when someone who can edit the page publishes or re-checks it.";
    case "approved-override": return "A space admin approved this version, so the status stays Passed until the next published edit.";
    default: return null;
  }
}
