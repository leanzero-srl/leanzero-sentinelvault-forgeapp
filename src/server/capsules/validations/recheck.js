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

// Which rules a stored status was judged against (2026-09-24, tester: a space rule was deleted
// and the page still read "Issues found · Missing required label: test" — nothing re-judges a
// page when its RULES change, only when the page does). Every writer stamps this; a read whose
// current rules differ treats the stored status as stale instead of showing it.
const stable = (v) => {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v === undefined ? null : v);
};

/** PURE. Order-insensitive fingerprint of the active rules (id, type, severity, config). */
export function rulesFingerprint(rules) {
  const active = (Array.isArray(rules) ? rules : [])
    .filter((r) => r && r.enabled !== false)
    .map((r) => stable({ id: r.id ?? null, type: r.type ?? null, severity: r.severity === "block" ? "block" : "warn", config: r.config || {} }))
    .sort();
  const str = active.join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ("0000000" + h.toString(16)).slice(-8);
}

/**
 * PURE. What a reader should be shown for a stored status under the CURRENT effective config.
 * No status at all when validation is off, pass/fail status is off, or no rule applies any more;
 * `stale` when the rules changed since it was written (older records carry no stamp → stale).
 */
export function reconcileStoredState({ effective, stored, fingerprint }) {
  if (!effective || !effective.enabled || !effective.modes?.gate) return { state: null, stale: false, why: "gate-off" };
  if (!Array.isArray(effective.rules) || effective.rules.filter((r) => r && r.enabled !== false).length === 0) return { state: null, stale: false, why: "no-rules" };
  // Rules apply and pass/fail is on, but this page was never judged (no save since the rule was
  // added): `applies` lets the panel show the group and check it now instead of hiding it —
  // Re-check lived INSIDE the hidden group (tester 2026-09-25).
  if (!stored || !["passed", "failed"].includes(stored.state)) return { state: null, stale: false, applies: true, why: "never-checked" };
  const stale = !stored.rulesFp || stored.rulesFp !== fingerprint;
  return { state: stored, stale, why: stale ? "rules-changed" : "current" };
}
