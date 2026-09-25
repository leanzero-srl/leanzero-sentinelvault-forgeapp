import { ruleConfigProblem, ruleListProblems, ruleListRefusal, rulesNeedLabels, RULE_TYPES } from "../src/server/shared/rule-config.js";
import { decideRecheckWrite, recheckNote, rulesFingerprint, reconcileStoredState } from "../src/server/capsules/validations/recheck.js";
import { evaluateRules } from "../src/server/infra/rules-engine.js";
import { eq, report } from "./_assert.mjs";

const r = (type, config = {}, extra = {}) => ({ id: "r1", type, severity: "block", label: "", config, ...extra });
const ok = (name, v) => eq(name, v, true);

// The tester's rule: "Require a heading", label "Security", heading text EMPTY → checked nothing.
ok("heading: no text, no level → refused", !!ruleConfigProblem(r("required-heading", {}, { label: "Security" })));
ok("heading: whitespace text → refused", !!ruleConfigProblem(r("required-heading", { text: "   " })));
eq("heading: text → ok", ruleConfigProblem(r("required-heading", { text: "Security" })), null);
eq("heading: level only → ok", ruleConfigProblem(r("required-heading", { level: 2 })), null);
ok("heading: level 7 → refused", !!ruleConfigProblem(r("required-heading", { text: "x", level: 7 })));
ok("heading: level 0 → refused", !!ruleConfigProblem(r("required-heading", { level: 0 })));
eq("heading: empty-string level + text → ok (cleared field)", ruleConfigProblem(r("required-heading", { text: "x", level: "" })), null);

eq("table: default minCount → ok", ruleConfigProblem(r("required-table")), null);
ok("table: minCount 0 → refused", !!ruleConfigProblem(r("required-table", { minCount: 0 })));
ok("macro: no key → refused", !!ruleConfigProblem(r("required-macro", {})));
eq("macro: key → ok", ruleConfigProblem(r("required-macro", { extensionKey: "toc" })), null);
ok("label: none → refused", !!ruleConfigProblem(r("required-label", { labels: [] })));
ok("label: only blanks → refused", !!ruleConfigProblem(r("required-label", { labels: ["", " "] })));
eq("label: one → ok", ruleConfigProblem(r("required-label", { labels: ["test"] })), null);
eq("hierarchy: nothing to configure", ruleConfigProblem(r("heading-hierarchy")), null);
ok("max-length: missing → refused", !!ruleConfigProblem(r("max-length", {})));
ok("max-length: 0 → refused", !!ruleConfigProblem(r("max-length", { maxChars: 0 })));
eq("max-length: 200 → ok", ruleConfigProblem(r("max-length", { maxChars: 200 })), null);
ok("min-length: missing → refused", !!ruleConfigProblem(r("min-length", {})));
ok("unknown type → refused", !!ruleConfigProblem(r("nuke")));
ok("null rule → refused", !!ruleConfigProblem(null));
eq("every engine type is known here", RULE_TYPES.length, 7);

// Lists and the refusal sentence.
eq("no problems in an empty list", ruleListProblems([]), []);
eq("non-array → none", ruleListProblems(undefined), []);
const list = [r("required-heading", { text: "A" }), r("required-heading", {}, { label: "Security" }), r("max-length", {})];
eq("problems are 1-based", ruleListProblems(list).map((p) => p.number), [2, 3]);
const refusal = ruleListRefusal(list);
ok("refusal names rule 2 and its label", refusal.startsWith('Rule 2 ("Security"): '));
ok("refusal counts the rest", refusal.endsWith("1 more rule needs attention too."));
eq("complete list → no refusal", ruleListRefusal([r("required-label", { labels: ["x"] })]), null);
ok("disabled rules are still checked", !!ruleListRefusal([r("min-length", {}, { enabled: false })]));

// Label reads matter only when an ACTIVE label rule exists.
eq("needs labels: label rule", rulesNeedLabels([r("required-label", { labels: ["x"] })]), true);
eq("needs labels: disabled label rule", rulesNeedLabels([r("required-label", { labels: ["x"] }, { enabled: false })]), false);
eq("needs labels: none", rulesNeedLabels([r("required-heading", { text: "x" })]), false);
eq("needs labels: not a list", rulesNeedLabels(null), false);

// The engine's own reading of an empty heading rule — why the save gate exists.
const docWithOtherHeading = { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "2. UI Wireframes" }] }] };
eq("engine: empty heading rule passes on ANY heading", evaluateRules(docWithOtherHeading, [], [r("required-heading", {})]).passed, true);
eq("engine: text rule fails without it", evaluateRules(docWithOtherHeading, [], [r("required-heading", { text: "Security" })]).passed, false);

// Re-check persistence.
const base = { gateOn: true, canEdit: true, checked: true, passed: true, version: 18, stored: { state: "failed", version: 17 } };
eq("recheck: writes when gate on + can edit", decideRecheckWrite(base), { write: true, why: "ok" });
eq("recheck: never writes an unchecked result", decideRecheckWrite({ ...base, checked: false }).write, false);
eq("recheck: gate off → live only", decideRecheckWrite({ ...base, gateOn: false }), { write: false, why: "gate-off" });
eq("recheck: reader → live only", decideRecheckWrite({ ...base, canEdit: false }), { write: false, why: "cannot-edit" });
const approved = { state: "passed", version: 18, approvedBy: "712020:x" };
eq("recheck: keeps an admin's approval of THIS version", decideRecheckWrite({ ...base, passed: false, stored: approved }), { write: false, why: "approved-override" });
eq("recheck: a newer version is judged again", decideRecheckWrite({ ...base, passed: false, version: 19, stored: approved }).write, true);
eq("recheck: a pass may still write over an approval", decideRecheckWrite({ ...base, passed: true, stored: approved }).write, true);
eq("recheck: first check of a page (no stored state)", decideRecheckWrite({ ...base, stored: null }).write, true);
ok("note: gate-off explains", /Pass\/fail status is off/.test(recheckNote("gate-off")));
ok("note: reader explains", /someone who can edit/.test(recheckNote("cannot-edit")));
eq("note: none for a write", recheckNote("ok"), null);

// Stored status vs CURRENT rules (2026-09-24: a deleted space rule kept "Issues found" on screen).
const labelRule = r("required-label", { labels: ["test"] });
const headRule = { ...r("required-heading", { text: "Security" }), id: "r2" };
const fp1 = rulesFingerprint([labelRule, headRule]);
eq("fp: order-insensitive", rulesFingerprint([headRule, labelRule]), fp1);
ok("fp: a config change moves it", rulesFingerprint([labelRule, { ...headRule, config: { text: "Privacy" } }]) !== fp1);
ok("fp: a severity change moves it", rulesFingerprint([labelRule, { ...headRule, severity: "warn" }]) !== fp1);
ok("fp: a deleted rule moves it", rulesFingerprint([headRule]) !== fp1);
eq("fp: disabled rules do not count", rulesFingerprint([headRule, { ...labelRule, enabled: false }]), rulesFingerprint([headRule]));
eq("fp: config key order does not matter", rulesFingerprint([r("required-heading", { text: "a", level: 2 })]), rulesFingerprint([r("required-heading", { level: 2, text: "a" })]));
const eff = { enabled: true, modes: { gate: true }, rules: [labelRule, headRule] };
const failed = { state: "failed", violations: [{ label: "test" }], rulesFp: fp1 };
eq("reconcile: current rules → shown, not stale", reconcileStoredState({ effective: eff, stored: failed, fingerprint: fp1 }).stale, false);
eq("reconcile: rules changed → stale", reconcileStoredState({ effective: { ...eff, rules: [headRule] }, stored: failed, fingerprint: rulesFingerprint([headRule]) }).stale, true);
eq("reconcile: THE REPORT — last rule deleted → no status", reconcileStoredState({ effective: { ...eff, rules: [] }, stored: failed, fingerprint: rulesFingerprint([]) }).state, null);
eq("reconcile: validation off → no status", reconcileStoredState({ effective: { enabled: false }, stored: failed, fingerprint: fp1 }).state, null);
eq("reconcile: gate off → no status", reconcileStoredState({ effective: { ...eff, modes: { gate: false } }, stored: failed, fingerprint: fp1 }).state, null);
eq("reconcile: only disabled rules left → no status", reconcileStoredState({ effective: { ...eff, rules: [{ ...labelRule, enabled: false }] }, stored: failed, fingerprint: fp1 }).state, null);
eq("reconcile: an old record without a stamp is stale", reconcileStoredState({ effective: eff, stored: { state: "failed" }, fingerprint: fp1 }).stale, true);
eq("reconcile: no stored status → none", reconcileStoredState({ effective: eff, stored: null, fingerprint: fp1 }).state, null);
eq("reconcile: never checked but a rule applies → applies", reconcileStoredState({ effective: eff, stored: null, fingerprint: fp1 }).applies, true);
eq("reconcile: no rules → no applies", reconcileStoredState({ effective: { ...eff, rules: [] }, stored: null, fingerprint: fp1 }).applies, undefined);
eq("reconcile: unknown stored state → none", reconcileStoredState({ effective: eff, stored: { state: "awaiting-approval", rulesFp: fp1 }, fingerprint: fp1 }).state, null);

report("validation-rule-config");
