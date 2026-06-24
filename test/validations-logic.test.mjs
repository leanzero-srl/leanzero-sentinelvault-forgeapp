import {
  normalizeFindings,
  buildValidationPrompt,
  severityRank,
} from "../src/server/capsules/validations/logic.js";
import { computeSectionRange } from "../src/server/capsules/section-seals/logic.js";
import { eq, ok, report } from "./_assert.mjs";

// severityRank ordering
ok("sev rank low<med<high", severityRank("low") < severityRank("medium") && severityRank("medium") < severityRank("high"));
eq("sev rank unknown -> low", severityRank("bogus"), 1);

// normalizeFindings clamps + drops empties + caps
const parsed = {
  summary: "x".repeat(500),
  findings: [
    { severity: "HIGH", category: "Style", excerpt: "a".repeat(500), explanation: "too long heading", suggestion: "fix" },
    { severity: "weird", category: "weird", excerpt: "ok", explanation: "" }, // category/severity coerced
    { foo: "bar" }, // dropped (no excerpt/explanation)
  ],
};
const norm = normalizeFindings(parsed);
eq("summary clamped to 200", norm.summary.length, 200);
eq("kept 2 findings", norm.findings.length, 2);
eq("severity coerced lowercase", norm.findings[0].severity, "high");
eq("category coerced", norm.findings[0].category, "style");
eq("excerpt clamped to 200", norm.findings[0].excerpt.length, 200);
eq("unknown severity -> low", norm.findings[1].severity, "low");
eq("unknown category -> rule", norm.findings[1].category, "rule");

// cap at 25
const many = { findings: Array.from({ length: 40 }, (_, i) => ({ severity: "low", excerpt: `e${i}`, explanation: "x" })) };
eq("capped at 25", normalizeFindings(many).findings.length, 25);

// null / garbage
eq("null parse -> empty", normalizeFindings(null), { findings: [], summary: "" });

// buildValidationPrompt includes config + page text
const { system, user } = buildValidationPrompt({
  ai: { rules: "No jargon", styleGuide: "AP style", tone: "Formal", compliance: "GDPR" },
  pageText: "Some body text",
  pageTitle: "My Page",
});
ok("system has rules", system.includes("No jargon"));
ok("system has style guide", system.includes("AP style"));
ok("system has tone", system.includes("Formal"));
ok("system has compliance", system.includes("GDPR"));
ok("system has output contract", system.toLowerCase().includes("json"));
ok("user has title + body", user.includes("My Page") && user.includes("Some body text"));

const { system: emptySys } = buildValidationPrompt({ ai: {}, pageText: "", pageTitle: "" });
ok("empty config -> 'None configured'", emptySys.includes("None configured"));

// computeSectionRange (heading + range to next same/higher level)
const content = [
  { type: "heading", attrs: { level: 2 } }, // 0
  { type: "paragraph" },                    // 1
  { type: "heading", attrs: { level: 3 } }, // 2 (deeper, stays in section)
  { type: "paragraph" },                    // 3
  { type: "heading", attrs: { level: 2 } }, // 4 (same level, ends section)
];
eq("section range stops at next H2", computeSectionRange(content, 0), { start: 0, end: 4 });
eq("non-heading seals single block", computeSectionRange(content, 1), { start: 1, end: 2 });

report("validations-logic");
