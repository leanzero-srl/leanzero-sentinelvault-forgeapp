// Tolerant JSON salvage for LLM output — pure, Forge-free (so it is unit-testable
// without the Forge runtime). Used by the Forge LLM adapter to recover structured
// output from models that wrap JSON in prose/fences or truncate it.

/**
 * Parse possibly-messy model output into JSON. Strips markdown fences, then as a
 * last resort extracts the first balanced {…}/[…] block, repairing unescaped
 * quotes and truncation. Returns null instead of throwing.
 */
export const parseAIJson = (raw) => {
  if (raw == null) return null;
  let cleaned = String(raw).trim()
    .replace(/^```(?:json|javascript|js)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
  if (!cleaned) return null;
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const startObj = cleaned.indexOf("{");
  const startArr = cleaned.indexOf("[");
  let start = -1;
  if (startObj >= 0 && startArr >= 0) start = Math.min(startObj, startArr);
  else start = startObj >= 0 ? startObj : startArr;
  if (start < 0) return null;
  const openChar = cleaned[start];
  const closeChar = openChar === "{" ? "}" : "]";
  const end = cleaned.lastIndexOf(closeChar);
  if (end > start) {
    const block = cleaned.substring(start, end + 1);
    try { return JSON.parse(block); } catch { /* fall through */ }
    try { return JSON.parse(repairUnescapedQuotes(block)); } catch { /* fall through */ }
  }
  const repaired = repairTruncatedJson(cleaned, start);
  if (repaired) return repaired;
  return repairTruncatedJson(repairUnescapedQuotes(cleaned.slice(start)), 0);
};

// Close an unterminated string + open brackets in a truncated JSON snippet.
export const repairTruncatedJson = (s, start) => {
  if (start == null || start < 0) return null;
  const stack = [];
  let inStr = false, esc = false, out = "";
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    out += ch;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
  }
  if (inStr) {
    out += '"';
  } else {
    out = out.replace(/,\s*$/, "");
    if (/:\s*$/.test(out)) out += "null";
  }
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === "{" ? "}" : "]";
  try { return JSON.parse(out); } catch { return null; }
};

// Re-escape stray double-quotes inside JSON string values.
export const repairUnescapedQuotes = (s) => {
  let out = "", inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (!inStr) { out += ch; if (ch === '"') inStr = true; continue; }
    if (esc) { out += ch; esc = false; continue; }
    if (ch === "\\") { out += ch; esc = true; continue; }
    if (ch === '"') {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      const nx = s[j];
      if (nx === undefined || nx === "," || nx === "}" || nx === "]" || nx === ":") { out += '"'; inStr = false; }
      else { out += '\\"'; }
      continue;
    }
    out += ch;
  }
  return out;
};
