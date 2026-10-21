/*
 * WF-11 (UX critique 2026-09-19): the effective workflow rule, as ONE sentence a space admin can
 * read at the top of the Workflow tab instead of reconstructing it from twenty controls:
 *   "New pages start in Draft. Any one of Mihai Perdum approves. Approved pages are protected: an
 *    edit by anyone else moves the page back to Draft. Re-review after 150 days."
 * PURE; its one import is the pure state machine (test/workflow-rule.test.mjs). Reads the settings record and the definition
 * the way the server does (workflow/logic.js): the enforce state is the one flagged `enforce`
 * (or "approved" for a definition saved before the flag), the review clock is the setting, then
 * the state's own value, then 150.
 */
import { planDemote } from "../../server/capsules/workflow/state-machine.js"; // pure: the engine's own demote plan

const isEnforce = (s) => !!s?.enforce || s?.id === "approved";
const names = (list) => list.map((a) => a?.name || a?.id).filter(Boolean);
const join = (arr) => (arr.length <= 1 ? arr.join("") : `${arr.slice(0, -1).join(", ")} and ${arr[arr.length - 1]}`);

export function workflowRuleSentence(settings = {}, def = null, { protectionOff = false, demoteProblem = null } = {}) {
  if (!settings || settings.enabled === false) return "The workflow is off in this space: pages carry no state.";
  const states = Array.isArray(def?.states) ? def.states : [];
  const first = states.find((s) => s.initial) || states[0] || null;
  const enforce = states.find(isEnforce) || null;
  const parts = [];
  parts.push(first ? `${settings.autoAssignNew ? "New pages start" : "Pages start"} in ${first.name}.` : "Pages start at the workflow's first state.");
  if (enforce) {
    const ap = settings.approval || null;
    const people = ap ? names(Array.isArray(ap.approvers) ? ap.approvers : []) : [];
    if (ap && people.length > 0) {
      const mode = ap.mode === "all" ? `All of ${join(people)} approve` : ap.mode === "min" ? `At least ${ap.min || 1} of ${join(people)} approve` : people.length === 1 ? `${people[0]} approves` : `Any one of ${join(people)} approves`;
      parts.push(`${mode} before a page is ${enforce.name}.`);
    } else if (ap) {
      parts.push(`No approvers are set, so only a space admin can move a page to ${enforce.name}.`);
    } else {
      parts.push(`Only a space admin can move a page to ${enforce.name}.`);
    }
    // Where the engine really sends the page (state-machine.js planDemote — the same plan), not the
    // setting as typed: a chosen state the workflow can no longer reach is not named (2026-10-21).
    const plan = def ? planDemote(def, settings, null) : null;
    const back = plan?.ok ? plan.target?.name : null;
    // `demoteProblem` (get-space-workflow-settings, enforce-rules.js demoteConfigProblem): the space
    // moves pages back, but its workflows cannot make that move, so the engine reverts (2026-10-21).
    const consequence = settings.enforceMode === "revert"
      ? "is undone (the approved version is restored)"
      : demoteProblem
        ? "is undone (the approved version is restored), because this workflow cannot move the page back"
        : `moves the page back to ${back || first?.name || "the first state"}`;
    // The site switch "Protect Sealed Attachments in Page Body" off switches enforcement off for
    // every space (2026-10-16: the tab said "protected" while the engine did nothing).
    parts.push(protectionOff
      ? `${enforce.name} pages are not protected right now: the site setting “Protect Sealed Attachments in Page Body” is off, so edits stay and the page keeps its state.`
      : `${enforce.name} pages are protected: an edit by anyone who is not an approver or a space admin ${consequence}.`);
    const days = Number(settings.reviewAfterDays) > 0 ? Number(settings.reviewAfterDays) : Number(enforce.reviewAfterDays) > 0 ? Number(enforce.reviewAfterDays) : 150;
    parts.push(`Re-review after ${days} days.`);
  }
  return parts.join(" ");
}
