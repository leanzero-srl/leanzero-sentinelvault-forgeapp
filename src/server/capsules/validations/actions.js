import { asApp, route } from "@forge/api";
import { kvs } from "@forge/kvs";
import { Queue } from "@forge/events";

import { authorizeSteward } from "../../shared/steward-checks.js";
import { readDocBody } from "../../infra/doc-surgery.js";
import { evaluateRules } from "../../infra/rules-engine.js";
import {
  loadValidationConfig,
  storeValidationConfig,
  readValidationState,
  writeValidationState,
  resolveAiConfig,
  getMonthlyTokenUsage,
  getLatestFindings,
} from "./logic.js";
import { isForgeLlmModelAllowed, FORGE_LLM_DEFAULT_MODEL, listForgeLlmModels } from "../../infra/forge-llm.js";

const aiQueue = new Queue({ key: "ai-validation-queue" });

const sanitize = (key) => String(key).replace(/[^a-zA-Z0-9:._\s-#]/g, "_");

async function fetchPageLabels(pageId) {
  try {
    const res = await asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}/labels`);
    if (!res.ok) return [];
    const body = await res.json();
    return (body.results || []).map((l) => l.name);
  } catch (_) {
    return [];
  }
}

/**
 * Merge global + space validation rules (manual check uses rules regardless of
 * the global enabled flag).
 */
async function resolveRules(spaceKey) {
  const global = (await kvs.get("validation-config-global")) || {};
  const space = spaceKey ? await kvs.get(`validation-config-space-${sanitize(spaceKey)}`) : null;
  return (space?.rules && space.rules.length) ? space.rules : (global.rules || []);
}

const loadConfig = async (req) => {
  const { scope, key } = req.payload || {};
  return await loadValidationConfig(scope || "global", key);
};

const storeConfig = async (req) => {
  const { scope, key, data } = req.payload || {};
  if (!data) return { success: false, reason: "No data" };
  // Cost backstop: never persist a non-Haiku AI model.
  if (data.ai && data.ai.model && !isForgeLlmModelAllowed(data.ai.model)) {
    data.ai.model = FORGE_LLM_DEFAULT_MODEL;
  }
  return await storeValidationConfig(scope || "global", key, data);
};

/**
 * On-demand validation (no mutation). Used by the "Validate now" button.
 */
const validatePageNow = async (req) => {
  const pageId = req.payload?.pageId || req.context.extension?.content?.id;
  const spaceKey =
    req.payload?.spaceKey ||
    req.context.extension?.content?.space?.key ||
    req.context.extension?.space?.key;
  if (!pageId) return { passed: true, violations: [], reason: "No page" };

  const rules = await resolveRules(spaceKey);
  if (!rules.length) return { passed: true, violations: [], noRules: true };

  try {
    const { adfDoc } = await readDocBody(pageId);
    const labels = await fetchPageLabels(pageId);
    return evaluateRules(adfDoc, labels, rules);
  } catch (e) {
    console.error("[VALIDATE-NOW] failed:", e);
    return { passed: true, violations: [], error: String(e?.message || e) };
  }
};

const getValidationState = async (req) => {
  const pageId = req.payload?.pageId || req.context.extension?.content?.id;
  if (!pageId) return { state: null };
  const state = await readValidationState(pageId);
  return { state };
};

/**
 * Approve a page gate (approver: steward, or the configured approver). Stamps
 * the validation state property as passed.
 */
const approvePageGate = async (req) => {
  const pageId = req.payload?.pageId || req.context.extension?.content?.id;
  const accountId = req.context.accountId;
  const spaceKey =
    req.payload?.spaceKey ||
    req.context.extension?.content?.space?.key ||
    req.context.extension?.space?.key;
  if (!pageId) return { success: false, reason: "No page" };

  let allowed = false;
  try { allowed = await authorizeSteward(accountId, spaceKey); } catch (_) { /* deny */ }
  if (!allowed) return { success: false, reason: "Only a steward can approve this page" };

  await writeValidationState(pageId, {
    state: "passed",
    violations: [],
    approvedBy: accountId,
    checkedAt: new Date().toISOString(),
  });
  return { success: true };
};

// --- Semantic AI Validations (Forge LLM) ---

const listAiModels = async () => {
  const models = await listForgeLlmModels();
  return { models };
};

/**
 * Enqueue a manual AI review of a page. Returns a taskId the UI polls.
 */
const enqueuePageValidation = async (req) => {
  const pageId = req.payload?.pageId || req.context.extension?.content?.id;
  const spaceKey =
    req.payload?.spaceKey ||
    req.context.extension?.content?.space?.key ||
    req.context.extension?.space?.key ||
    null;
  const accountId = req.context.accountId;
  if (!pageId) return { success: false, reason: "No page" };

  const ai = await resolveAiConfig(spaceKey);
  if (!ai || ai.enabled !== true) {
    return { success: false, reason: "AI validation is not enabled. An admin can turn it on in Sentinel Vault settings." };
  }

  // Monthly token budget guard (0 = unlimited).
  if (ai.monthlyTokenBudget && ai.monthlyTokenBudget > 0) {
    const used = await getMonthlyTokenUsage(spaceKey);
    if (used >= ai.monthlyTokenBudget) {
      return { success: false, reason: "This space has reached its monthly AI token budget." };
    }
  }

  const taskId = `aival_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await kvs.set(`ai-validation-status-${taskId}`, { status: "queued", pageId }, { expiresAt: Date.now() + 3600000 });
  await aiQueue.push({ body: { taskId, pageId, spaceKey, realmKey: spaceKey, requestedBy: accountId } });
  return { success: true, taskId };
};

/**
 * Poll an AI validation job; deletes the status row once terminal.
 */
const getValidationJob = async (req) => {
  const { taskId } = req.payload || {};
  if (!taskId) return { status: "unknown" };
  const row = await kvs.get(`ai-validation-status-${taskId}`);
  if (!row) return { status: "pending" };
  if (row.status === "done" || row.status === "error") {
    try { await kvs.delete(`ai-validation-status-${taskId}`); } catch (_) { /* ignore */ }
  }
  return row;
};

const getAiFindings = async (req) => {
  const pageId = req.payload?.pageId || req.context.extension?.content?.id;
  if (!pageId) return { findings: null, aiEnabled: false };
  const spaceKey =
    req.payload?.spaceKey ||
    req.context.extension?.content?.space?.key ||
    req.context.extension?.space?.key ||
    null;
  const findings = await getLatestFindings(pageId);
  let aiEnabled = false;
  try { aiEnabled = (await resolveAiConfig(spaceKey))?.enabled === true; } catch (_) { /* off */ }
  return { findings, aiEnabled };
};

const getValidationAudit = async (req) => {
  const spaceKey =
    req.payload?.spaceKey ||
    req.context.extension?.content?.space?.key ||
    req.context.extension?.space?.key ||
    null;
  const monthlyTokens = await getMonthlyTokenUsage(spaceKey);
  return { monthlyTokens };
};

export const actions = [
  ["load-validation-config", loadConfig],
  ["store-validation-config", storeConfig],
  ["validate-page-now", validatePageNow],
  ["get-validation-state", getValidationState],
  ["approve-page-gate", approvePageGate],
  ["list-ai-models", listAiModels],
  ["enqueue-page-validation", enqueuePageValidation],
  ["get-validation-job", getValidationJob],
  ["get-ai-findings", getAiFindings],
  ["get-validation-audit", getValidationAudit],
];
