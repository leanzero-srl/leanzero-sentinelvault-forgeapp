// Conditions & Validations — pure rules engine.
//
// No I/O: takes a parsed ADF document, the page's labels, and a rules array, and
// returns structured violations. Reused by the page trigger (auto) and the
// "validate now" action. Rule types operate on ADF structure via the shared
// walkers in doc-surgery.js.
import { collectHeadings, countNodes, extractPlainText } from "./doc-surgery.js";

function headingMatches(headings, { text, level }) {
  return headings.filter((h) => {
    if (level && h.level !== level) return false;
    if (text && !h.text.toLowerCase().includes(String(text).toLowerCase())) return false;
    return true;
  }).length;
}

/**
 * Evaluate one rule. Returns a human-readable violation message, or null if the
 * rule passes.
 */
function evalRule(adfDoc, pageLabels, rule) {
  const cfg = rule.config || {};
  switch (rule.type) {
    case "required-heading": {
      const minCount = cfg.minCount || 1;
      const found = headingMatches(collectHeadings(adfDoc), { text: cfg.text, level: cfg.level });
      if (found < minCount) {
        const what = cfg.text ? `a heading containing "${cfg.text}"` : (cfg.level ? `an H${cfg.level} heading` : "a heading");
        return minCount > 1 ? `Needs at least ${minCount} of ${what} (found ${found}).` : `Missing required ${what}.`;
      }
      return null;
    }
    case "required-table": {
      const minCount = cfg.minCount || 1;
      const tables = countNodes(adfDoc, (n) => n.type === "table");
      if (tables < minCount) return `Needs at least ${minCount} table${minCount > 1 ? "s" : ""} (found ${tables}).`;
      return null;
    }
    case "required-macro": {
      const minCount = cfg.minCount || 1;
      const key = cfg.extensionKey;
      if (!key) return null;
      const macros = countNodes(adfDoc, (n) =>
        ["extension", "bodiedExtension", "inlineExtension"].includes(n.type) &&
        (n.attrs?.extensionKey === key || String(n.attrs?.extensionKey || "").endsWith(key)));
      if (macros < minCount) return `Missing required macro "${key}".`;
      return null;
    }
    case "required-label": {
      const needed = (cfg.labels || []).map((l) => String(l).toLowerCase());
      const have = new Set((pageLabels || []).map((l) => String(l).toLowerCase()));
      const missing = needed.filter((l) => !have.has(l));
      if (missing.length) return `Missing required label${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`;
      return null;
    }
    case "heading-hierarchy": {
      const headings = collectHeadings(adfDoc);
      let prev = 0;
      for (const h of headings) {
        if (prev && h.level > prev + 1) {
          return `Heading levels skip from H${prev} to H${h.level} (near "${h.text}").`;
        }
        prev = h.level;
      }
      return null;
    }
    case "max-length": {
      const max = cfg.maxChars;
      if (!max) return null;
      const { charCount } = extractPlainText(adfDoc);
      if (charCount > max) return `Page is too long: ${charCount} characters (max ${max}).`;
      return null;
    }
    case "min-length": {
      const min = cfg.minChars;
      if (!min) return null;
      const { charCount } = extractPlainText(adfDoc);
      if (charCount < min) return `Page is too short: ${charCount} characters (min ${min}).`;
      return null;
    }
    default:
      return null;
  }
}

/**
 * Evaluate all rules against a page.
 * @returns {{ passed:boolean, violations:Array<{ruleId,label,severity,message}> }}
 * passed is false only when a "block"-severity rule is violated.
 */
export function evaluateRules(adfDoc, pageLabels, rules) {
  const violations = [];
  for (const rule of rules || []) {
    if (rule.enabled === false) continue;
    let message;
    try {
      message = evalRule(adfDoc, pageLabels, rule);
    } catch (e) {
      console.error(`[RULES] rule ${rule.id} (${rule.type}) threw:`, e);
      message = null;
    }
    if (message) {
      violations.push({
        ruleId: rule.id,
        label: rule.label || rule.type,
        severity: rule.severity === "block" ? "block" : "warn",
        message,
      });
    }
  }
  const passed = !violations.some((v) => v.severity === "block");
  return { passed, violations };
}
