import {
  normalizeFindings,
  buildValidationPrompt,
  severityRank,
  mergeEffectiveRules,
  mergeEffectiveModes,
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

// audit D4: a real finding with only a ruleRef (no excerpt/explanation) must be KEPT — it was
// silently dropped before, which for the AI gate is a false PASS. A totally-empty one still drops.
const d4 = normalizeFindings({ findings: [{ severity: "high", category: "compliance", ruleRef: "PII policy" }] });
eq("D4: ruleRef-only finding kept", d4.findings.length, 1);
ok("D4: fallback explanation added", d4.findings[0].explanation.length > 0);
eq("D4: totally-empty finding still dropped", normalizeFindings({ findings: [{ foo: 1 }] }).findings.length, 0);

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

// audit C6: global block-severity rules are a compliance FLOOR — always applied; space rules
// add on top and replace only the advisory (warn) global rules.
{
  const global = [
    { id: "g-pii", severity: "block", type: "required-label" },
    { id: "g-style", severity: "warn", type: "required-heading" },
  ];
  const space = [{ id: "s-table", severity: "block", type: "required-table" }];
  // empty space → inherit ALL global (block + warn)
  eq("C6 empty space inherits all global", mergeEffectiveRules(global, []).length, 2);
  // space with rules → global BLOCK floor + space rules (global WARN dropped)
  const merged = mergeEffectiveRules(global, space);
  ok("C6 floor: global block rule always present", merged.some((r) => r.id === "g-pii"));
  ok("C6 space rule added", merged.some((r) => r.id === "s-table"));
  ok("C6 advisory global rule replaced", !merged.some((r) => r.id === "g-style"));
  // a space rule can't override a global block rule's id (floor wins)
  const collide = mergeEffectiveRules(global, [{ id: "g-pii", severity: "warn", type: "min-length" }]);
  eq("C6 floor id-collision keeps the global block rule", collide.filter((r) => r.id === "g-pii").length, 1);
  eq("C6 floor id-collision: kept rule is still block", collide.find((r) => r.id === "g-pii").severity, "block");
}

// it50: C6 compliance floor EXTENDED to enforcement MODES — a space may only STRENGTHEN, never
// weaken, the org's modes; all three modes are a UNION of global + space.
{
  const M = (advisory, gate, revert) => ({ advisory, gate, revert });
  eq("modes: null/null -> safe advisory default", mergeEffectiveModes(null, null), M(true, false, false));
  eq("modes: no space -> global passthrough", mergeEffectiveModes(M(false, true, true), null), M(false, true, true));
  // CORE it49/it50 bug: an advisory-only space CANNOT drop the org's mandated gate/revert
  eq("modes: advisory-only space can't drop global gate/revert", mergeEffectiveModes(M(false, true, true), M(true, false, false)), M(true, true, true));
  // a space MAY strengthen a global advisory-only mandate by adding gate/revert
  eq("modes: space can strengthen global advisory-only", mergeEffectiveModes(M(true, false, false), M(false, true, true)), M(true, true, true));
  // ADVISORY = UNION: a space CANNOT suppress the org's advisory comments
  eq("modes: space can't suppress global advisory", mergeEffectiveModes(M(true, false, false), M(false, false, false)), M(true, false, false));
  eq("modes: space can add advisory to global", mergeEffectiveModes(M(false, false, false), M(true, false, false)), M(true, false, false));
  // defensive: a malformed/partial space object keeps the global floor intact, no crash
  eq("modes: empty space object keeps the global floor", mergeEffectiveModes(M(false, true, true), {}), M(false, true, true));
  // defensive: a partial global (missing revert key) coerces to false, no NaN/undefined leak
  eq("modes: partial global coerces missing keys to false", mergeEffectiveModes({ advisory: true, gate: false }, null), M(true, false, false));
}

report("validations-logic");
