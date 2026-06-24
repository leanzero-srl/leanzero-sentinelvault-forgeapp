import { evaluateRules } from "../src/server/infra/rules-engine.js";
import { eq, ok, report } from "./_assert.mjs";

// ADF builders
const doc = (...content) => ({ type: "doc", content });
const heading = (level, text) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const para = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
const table = () => ({ type: "table", content: [{ type: "tableRow", content: [] }] });

const rule = (type, config, severity = "warn") => ({ id: type, type, label: type, severity, config });

// required-heading
let r = evaluateRules(doc(heading(2, "Decision Log"), para("x")), [], [rule("required-heading", { text: "Decision" })]);
eq("required-heading present", r.violations.length, 0);
r = evaluateRules(doc(para("no heading")), [], [rule("required-heading", { text: "Decision" })]);
eq("required-heading missing", r.violations.length, 1);
r = evaluateRules(doc(heading(3, "Notes")), [], [rule("required-heading", { level: 2 })]);
eq("required-heading wrong level", r.violations.length, 1);

// required-table
r = evaluateRules(doc(table()), [], [rule("required-table", { minCount: 1 })]);
eq("required-table present", r.violations.length, 0);
r = evaluateRules(doc(para("x")), [], [rule("required-table", { minCount: 1 })]);
eq("required-table missing", r.violations.length, 1);

// required-label
r = evaluateRules(doc(para("x")), ["approved", "reviewed"], [rule("required-label", { labels: ["approved"] })]);
eq("required-label present", r.violations.length, 0);
r = evaluateRules(doc(para("x")), ["reviewed"], [rule("required-label", { labels: ["approved"] })]);
eq("required-label missing", r.violations.length, 1);

// heading-hierarchy
r = evaluateRules(doc(heading(1, "A"), heading(2, "B"), heading(3, "C")), [], [rule("heading-hierarchy", {})]);
eq("hierarchy ok", r.violations.length, 0);
r = evaluateRules(doc(heading(1, "A"), heading(3, "C")), [], [rule("heading-hierarchy", {})]);
eq("hierarchy skip", r.violations.length, 1);

// max-length / min-length
r = evaluateRules(doc(para("short")), [], [rule("max-length", { maxChars: 3 })]);
eq("max-length exceeded", r.violations.length, 1);
r = evaluateRules(doc(para("plenty of characters here")), [], [rule("min-length", { minChars: 5 })]);
eq("min-length ok", r.violations.length, 0);

// severity → passed
r = evaluateRules(doc(para("x")), [], [rule("required-table", { minCount: 1 }, "block")]);
eq("block severity fails passed", r.passed, false);
r = evaluateRules(doc(para("x")), [], [rule("required-table", { minCount: 1 }, "warn")]);
eq("warn severity keeps passed", r.passed, true);
ok("warn still records violation", r.violations.length === 1);

// disabled rule skipped
r = evaluateRules(doc(para("x")), [], [{ id: "d", type: "required-table", enabled: false, config: { minCount: 1 } }]);
eq("disabled rule skipped", r.violations.length, 0);

report("rules-engine");
