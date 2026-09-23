// Validation rule configuration — the ONE rule for "is this rule complete enough to save?".
//
// Zero imports on purpose: the rules editor (browser bundle) and `store-validation-config`
// (resolver, also reached by the config REST API) both call it, so the editor can never offer a
// save the server then refuses, and the server never accepts a rule the editor would flag.
//
// Why it exists (tester, 2026-09-23): a "Require a heading" rule saved with NO heading text and
// NO level means "the page has at least one heading of any kind" — a page without the intended
// "Security" heading passed every check, silently. Each rule type now has to say what it checks.

export const RULE_TYPES = Object.freeze([
  "required-heading",
  "required-table",
  "required-macro",
  "required-label",
  "heading-hierarchy",
  "max-length",
  "min-length",
]);

const isPosInt = (v) => Number.isInteger(v) && v > 0;

/**
 * PURE. What is missing or wrong in one rule, as a sentence for the person fixing it; null when
 * the rule is complete. The engine's defaults stay as they are (a missing minCount means 1).
 */
export function ruleConfigProblem(rule) {
  if (!rule || typeof rule !== "object") return "This rule is empty.";
  const cfg = rule.config && typeof rule.config === "object" ? rule.config : {};
  switch (rule.type) {
    case "required-heading": {
      const text = typeof cfg.text === "string" ? cfg.text.trim() : "";
      const hasLevel = cfg.level !== undefined && cfg.level !== null && cfg.level !== "";
      if (hasLevel && !(Number.isInteger(cfg.level) && cfg.level >= 1 && cfg.level <= 6)) return "The heading level must be a number from 1 to 6.";
      if (!text && !hasLevel) return "Enter the heading text, a heading level, or both — otherwise any heading would pass.";
      return null;
    }
    case "required-table":
      if (cfg.minCount !== undefined && !isPosInt(cfg.minCount)) return "The minimum number of tables must be 1 or more.";
      return null;
    case "required-macro": {
      const key = typeof cfg.extensionKey === "string" ? cfg.extensionKey.trim() : "";
      if (!key) return "Enter the macro key (for example toc or info).";
      if (cfg.minCount !== undefined && !isPosInt(cfg.minCount)) return "The minimum number of macros must be 1 or more.";
      return null;
    }
    case "required-label": {
      const labels = Array.isArray(cfg.labels) ? cfg.labels.filter((l) => typeof l === "string" && l.trim()) : [];
      if (!labels.length) return "Enter at least one label.";
      return null;
    }
    case "heading-hierarchy":
      return null;
    case "max-length":
      if (!isPosInt(cfg.maxChars)) return "Enter the maximum number of characters (1 or more).";
      return null;
    case "min-length":
      if (!isPosInt(cfg.minChars)) return "Enter the minimum number of characters (1 or more).";
      return null;
    default:
      return "Choose a rule type.";
  }
}

/**
 * PURE. Every incomplete rule in a list, 1-based so a message can say "Rule 2". Disabled rules are
 * checked too: turning one back on must not revive a rule that checks nothing.
 */
export function ruleListProblems(rules) {
  if (!Array.isArray(rules)) return [];
  const out = [];
  rules.forEach((rule, i) => {
    const problem = ruleConfigProblem(rule);
    if (problem) out.push({ index: i, number: i + 1, label: (rule && rule.label) || "", problem });
  });
  return out;
}

/** PURE. One refusal sentence for a save that carries incomplete rules; null when all are complete. */
export function ruleListRefusal(rules) {
  const problems = ruleListProblems(rules);
  if (!problems.length) return null;
  const first = problems[0];
  const name = first.label ? ` ("${first.label}")` : "";
  const more = problems.length > 1 ? ` ${problems.length - 1} more rule${problems.length > 2 ? "s need" : " needs"} attention too.` : "";
  return `Rule ${first.number}${name}: ${first.problem}${more}`;
}

/** PURE. True when any active rule judges the page's labels — the only case a label read matters. */
export function rulesNeedLabels(rules) {
  return Array.isArray(rules) && rules.some((r) => r && r.enabled !== false && r.type === "required-label");
}
