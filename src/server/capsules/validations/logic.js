import { kvs } from "@forge/kvs";
import { asApp, route } from "@forge/api";

// Conditions & Validations — config + state storage.
//
// Config lives in dedicated KVS keys (not the admin-settings object) so it is
// isolated from the existing settings-save flows:
//   validation-config-global
//   validation-config-space-{sanitizedKey}
// The config object also carries an `ai` sub-object used by Semantic AI
// Validations (Phase 5).

const sanitize = (key) => String(key).replace(/[^a-zA-Z0-9:._\s-#]/g, "_");

export const DEFAULT_VALIDATION_CONFIG = {
  enabled: false, // global master switch
  modes: { advisory: true, gate: false, revert: false },
  rules: [],
  ai: {
    enabled: false,
    model: "claude-haiku-4-5-20251001",
    styleGuide: "",
    tone: "",
    compliance: "",
    rules: "",
    severityThreshold: "low", // low | medium | high
    notifyAuthor: false,
    monthlyTokenBudget: 0, // 0 = unlimited
    maxChars: 40000,
  },
};

export async function loadValidationConfig(scope, key) {
  const storeKey = scope === "space" && key
    ? `validation-config-space-${sanitize(key)}`
    : "validation-config-global";
  const cfg = await kvs.get(storeKey);
  if (!cfg) return scope === "space" ? { rules: [], modes: null, ai: null } : { ...DEFAULT_VALIDATION_CONFIG };
  return cfg;
}

export async function storeValidationConfig(scope, key, data) {
  const storeKey = scope === "space" && key
    ? `validation-config-space-${sanitize(key)}`
    : "validation-config-global";
  await kvs.set(storeKey, data);
  return { success: true };
}

/**
 * Resolve the effective validation config for a page's space. Global is the
 * master switch; a space config refines rules/modes/ai when present.
 * Returns { enabled:false } when validation is globally off.
 */
export async function resolveEffectiveConfig(spaceKey) {
  const global = await kvs.get("validation-config-global");
  if (!global || global.enabled !== true) return { enabled: false };

  let space = null;
  if (spaceKey) {
    space = await kvs.get(`validation-config-space-${sanitize(spaceKey)}`);
  }

  const rules = (space?.rules && space.rules.length) ? space.rules : (global.rules || []);
  const modes = space?.modes || global.modes || { advisory: true, gate: false, revert: false };
  const ai = space?.ai && space.ai.enabled !== undefined ? space.ai : (global.ai || {});

  return { enabled: true, modes, rules, ai };
}

/**
 * Resolve the effective AI config for a space, INDEPENDENT of the validation
 * master switch (AI has its own opt-in via ai.enabled).
 */
export async function resolveAiConfig(spaceKey) {
  const global = (await kvs.get("validation-config-global")) || {};
  const space = spaceKey ? await kvs.get(`validation-config-space-${sanitize(spaceKey)}`) : null;
  if (space?.ai && space.ai.enabled !== undefined) return space.ai;
  return global.ai || {};
}

// --- Page validation-state content property ---
const STATE_KEY = "sentinel-vault-validation";

export async function readValidationState(pageId) {
  if (!pageId) return null;
  try {
    const res = await asApp().requestConfluence(
      route`/wiki/api/v2/pages/${pageId}/properties?key=${STATE_KEY}`,
    );
    if (!res.ok) return null;
    const body = await res.json();
    return body.results?.[0]?.value || null;
  } catch (e) {
    console.error("[VALIDATION-STATE] read failed:", e);
    return null;
  }
}

export async function writeValidationState(pageId, state) {
  if (!pageId) return;
  try {
    const getRes = await asApp().requestConfluence(
      route`/wiki/api/v2/pages/${pageId}/properties?key=${STATE_KEY}`,
    );
    if (!getRes.ok) return;
    const body = await getRes.json();
    const existing = body.results?.[0];
    if (existing) {
      await asApp().requestConfluence(
        route`/wiki/api/v2/pages/${pageId}/properties/${existing.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: STATE_KEY, value: state, version: { number: (existing.version?.number || 1) + 1 } }),
        },
      );
    } else {
      await asApp().requestConfluence(
        route`/wiki/api/v2/pages/${pageId}/properties`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: STATE_KEY, value: state }),
        },
      );
    }
  } catch (e) {
    console.error("[VALIDATION-STATE] write failed:", e);
  }
}

// --- Last-known-good version pointer (for revert mode) ---
export async function getLastGoodVersion(pageId) {
  return (await kvs.get(`validation-lastgood-${pageId}`)) || null;
}
export async function setLastGoodVersion(pageId, versionNumber) {
  await kvs.set(`validation-lastgood-${pageId}`, versionNumber);
}

// --- Per-version dedup marker (avoid re-validating the same version) ---
export async function wasVersionChecked(pageId, version) {
  if (!version) return false;
  return !!(await kvs.get(`validation-checked-${pageId}-${version}`));
}
export async function markVersionChecked(pageId, version) {
  if (!version) return;
  await kvs.set(`validation-checked-${pageId}-${version}`, true, { expiresAt: Date.now() + 30 * 24 * 3600 * 1000 });
}

// ===========================================================================
// Semantic AI Validations (Forge LLM)
// ===========================================================================

const SEV_RANK = { low: 1, medium: 2, high: 3 };
export function severityRank(sev) {
  return SEV_RANK[String(sev || "low").toLowerCase()] || 1;
}

/**
 * Build the system + user messages for an AI content review from the admin's
 * configured rules / style guide / tone / compliance config and the page text.
 */
export function buildValidationPrompt({ ai, pageText, pageTitle }) {
  const cfg = ai || {};
  const system = [
    "You are a Confluence content reviewer for the organization. Evaluate the page content against the policies below and report only concrete, actionable findings.",
    "",
    "## Custom rules",
    cfg.rules ? cfg.rules : "None configured",
    "",
    "## Style guide",
    cfg.styleGuide ? cfg.styleGuide : "None configured",
    "",
    "## Tone / voice requirements",
    cfg.tone ? cfg.tone : "None configured",
    "",
    "## Compliance standards",
    cfg.compliance ? cfg.compliance : "None configured",
    "",
    "## Output contract",
    'Return ONLY a JSON object with this exact shape:',
    '{"findings":[{"severity":"high|medium|low","category":"rule|style|tone|compliance","ruleRef":"<short label>","excerpt":"<=200 chars of the offending text, verbatim>","explanation":"<one sentence why it violates the policy>","suggestion":"<concrete fix>"}],"summary":"<=200 chars overall assessment"}',
    'If the page fully complies, return {"findings":[],"summary":"No issues found."}.',
    "Do not invent violations. Quote excerpts verbatim from the provided text.",
  ].join("\n");

  const user = `Page title: ${pageTitle || "Untitled"}\n\n---\n${pageText || ""}`;
  return { system, user };
}

/**
 * Clamp parsed model output to the finding schema. Drops malformed entries and
 * caps the count.
 */
export function normalizeFindings(parsed) {
  const out = { findings: [], summary: "" };
  if (!parsed || typeof parsed !== "object") return out;
  out.summary = typeof parsed.summary === "string" ? parsed.summary.slice(0, 200) : "";
  const arr = Array.isArray(parsed.findings) ? parsed.findings : [];
  const sevSet = new Set(["high", "medium", "low"]);
  const catSet = new Set(["rule", "style", "tone", "compliance"]);
  for (const f of arr) {
    if (!f || typeof f !== "object") continue;
    const excerpt = typeof f.excerpt === "string" ? f.excerpt.slice(0, 200) : "";
    const explanation = typeof f.explanation === "string" ? f.explanation.slice(0, 300) : "";
    if (!excerpt && !explanation) continue; // need at least one to be actionable
    out.findings.push({
      severity: sevSet.has(String(f.severity).toLowerCase()) ? String(f.severity).toLowerCase() : "low",
      category: catSet.has(String(f.category).toLowerCase()) ? String(f.category).toLowerCase() : "rule",
      ruleRef: typeof f.ruleRef === "string" ? f.ruleRef.slice(0, 120) : "",
      excerpt,
      explanation,
      suggestion: typeof f.suggestion === "string" ? f.suggestion.slice(0, 300) : "",
    });
    if (out.findings.length >= 25) break;
  }
  return out;
}

// --- Token usage accounting (per realm per month) ---
function monthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function getMonthlyTokenUsage(realmKey) {
  const usage = await kvs.get(`ai-usage-${realmKey || "global"}-${monthKey()}`);
  return usage?.totalTokens || 0;
}

export async function accrueTokenUsage(realmKey, usage) {
  const key = `ai-usage-${realmKey || "global"}-${monthKey()}`;
  const cur = (await kvs.get(key)) || { inputTokens: 0, outputTokens: 0, totalTokens: 0, runs: 0 };
  cur.inputTokens += usage?.inputTokens || 0;
  cur.outputTokens += usage?.outputTokens || 0;
  cur.totalTokens += usage?.totalTokens || 0;
  cur.runs += 1;
  await kvs.set(key, cur, { expiresAt: Date.now() + 120 * 24 * 3600 * 1000 });
  return cur;
}

// --- AI findings storage ---
export async function storeFindings(pageId, payload) {
  const ts = Date.now();
  await kvs.set(`ai-finding-${pageId}-${ts}`, payload, { expiresAt: ts + 90 * 24 * 3600 * 1000 });
  await kvs.set(`ai-latest-${pageId}`, payload);
}
export async function getLatestFindings(pageId) {
  return (await kvs.get(`ai-latest-${pageId}`)) || null;
}
