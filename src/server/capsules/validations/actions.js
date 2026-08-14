import { asApp, route } from "@forge/api";
import { kvs } from "@forge/kvs";
import { Queue } from "@forge/events";
import { fetchPageLabels } from "../../infra/labels.js";

import { authorizeSteward, isOperatorSteward, isOperatorSiteAdmin } from "../../shared/steward-checks.js";
import { setWithTtl } from "../../shared/kvs-ttl.js";

// audit B6: resolve a page's REAL space key from its id (never trust a caller-supplied
// spaceKey for authorization — else a steward of space A could act on a page in space B).
//
// B11 (LIVE-VERIFIED BUG FIX): the old v1 read — `/wiki/rest/api/content/{id}?expand=space` —
// now returns **HTTP 410 Gone** for the Forge app on EVERY page (the v1 Confluence content GET
// endpoints were sunset for apps). That made this return null for all pages, so BOTH callers
// (approvePageGate + enqueuePageValidation) denied EVERY steward ("Only a steward of this page's
// space can…") — page-gate approval and manual AI review were silently broken in production.
// Fix: resolve via the v2 API the rest of the app already uses — page → spaceId → space key.
async function resolvePageSpaceKey(pageId) {
  try {
    const pres = await asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}`);
    if (!pres.ok) return null;
    const spaceId = (await pres.json())?.spaceId;
    if (!spaceId) return null;
    const sres = await asApp().requestConfluence(route`/wiki/api/v2/spaces/${spaceId}`);
    if (!sres.ok) return null;
    return (await sres.json())?.key || null;
  } catch (_) { /* deny on failure */ }
  return null;
}
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
  getFindingStates,
  setFindingState,
  mergeEffectiveRules,
} from "./logic.js";
import { isForgeLlmModelAllowed, FORGE_LLM_DEFAULT_MODEL, listForgeLlmModels } from "../../infra/forge-llm.js";

// it57: ai-validation-queue is constructed LAZILY at push time (see enqueue paths below) so this
// module is import-safe for the dev test-hook (no Queue at module load — the it17 trap).

const sanitize = (key) => String(key).replace(/[^a-zA-Z0-9:._\s-#]/g, "_");


/**
 * Merge global + space validation rules (manual check uses rules regardless of
 * the global enabled flag).
 */
export async function resolveRules(spaceKey) {
  const global = (await kvs.get("validation-config-global")) || {};
  const space = spaceKey ? await kvs.get(`validation-config-space-${sanitize(spaceKey)}`) : null;
  // audit C6: apply the global block-severity compliance floor here too (this feeds the
  // transition gate), so a space can't drop an org-mandatory rule from the gate either.
  return mergeEffectiveRules(global.rules, space?.rules);
}

const loadConfig = async (req) => {
  const { scope, key } = req.payload || {};
  return await loadValidationConfig(scope || "global", key);
};

const storeConfig = async (req) => {
  const { scope, key, data } = req.payload || {};
  if (!data) return { success: false, reason: "No data" };
  // it17 (authz): gate config writes — this ruleset drives org-wide compliance (incl. the C6
  // block-severity floor) and the AI budget/prompt, so an ungated write let any reader rewrite
  // or disable it. Mirrors store-policy (audit A1): global config → site admin; space config →
  // steward of that space (isOperatorSteward already allows site admins). Returns {success:false}
  // (not a throw), which the it16 UI fix surfaces as an error banner.
  const caller = req.context?.accountId;
  const authorized = !!caller && ((scope === "space" && key)
    ? await isOperatorSteward(caller, key)
    : await isOperatorSiteAdmin(caller));
  if (!authorized) return { success: false, reason: "Not authorized — steward or admin access required." };
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
    // SV-m3: do NOT fail open — a page-read error must not render as "all checks passed".
    return { ok: false, passed: false, violations: [], error: String(e?.message || e), failureReason: "Could not validate this page" };
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
  if (!pageId) return { success: false, reason: "No page" };

  // audit B6: authorize against the page's REAL space (resolved from the id), NOT the
  // caller-supplied spaceKey — else a steward of any space could clear any page's gate.
  const spaceKey = await resolvePageSpaceKey(pageId);
  let allowed = false;
  try { allowed = !!spaceKey && await authorizeSteward(accountId, spaceKey); } catch (_) { /* deny */ }
  if (!allowed) return { success: false, reason: "Only a steward of this page's space can approve it" };

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
export const enqueuePageValidation = async (req) => {
  const pageId = req.payload?.pageId || req.context.extension?.content?.id;
  const accountId = req.context.accountId;
  if (!pageId) return { success: false, reason: "No page" };

  // audit B6: resolve the page's REAL space + require a steward of it — a manual AI review
  // spends the space's token budget, so it must not be triggerable by anyone against any
  // space's budget via a caller-supplied spaceKey.
  const spaceKey = await resolvePageSpaceKey(pageId);
  let allowed = false;
  try { allowed = !!spaceKey && await authorizeSteward(accountId, spaceKey); } catch (_) { /* deny */ }
  if (!allowed) return { success: false, reason: "Only a steward of this page's space can run an AI review" };

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
  await setWithTtl(`ai-validation-status-${taskId}`, { status: "queued", pageId }, 3600000);
  await new Queue({ key: "ai-validation-queue" }).push({ body: { taskId, pageId, spaceKey, realmKey: spaceKey, requestedBy: accountId } });
  return { success: true, taskId };
};

// #46: enqueue an AI transition-condition review (mode "gate"). Returns { enqueued } when a
// job was pushed, or { enqueued:false, verdict, reason } when it resolved WITHOUT an LLM call
// (AI disabled → skip; budget exhausted → block/allow per onBudgetExhausted). The caller then
// applies that verdict to the pending aiGate immediately.
export async function enqueueAiGate({ pageId, spaceKey, pinnedVersion, threshold, onBudgetExhausted }) {
  const ai = await resolveAiConfig(spaceKey);
  if (!ai || ai.enabled !== true) {
    return { enqueued: false, verdict: "passed", reason: "AI review isn't enabled — condition skipped." };
  }
  if (ai.monthlyTokenBudget && ai.monthlyTokenBudget > 0) {
    const used = await getMonthlyTokenUsage(spaceKey);
    if (used >= ai.monthlyTokenBudget) {
      return onBudgetExhausted === "allow"
        ? { enqueued: false, verdict: "passed", reason: "AI budget exhausted — allowed with a warning." }
        : { enqueued: false, verdict: "failed", reason: "This space has reached its monthly AI budget." };
    }
  }
  const taskId = `aigate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await new Queue({ key: "ai-validation-queue" }).push({ body: { taskId, pageId, spaceKey, realmKey: spaceKey, mode: "gate", pinnedVersion, threshold } });
  return { enqueued: true, taskId };
}

/**
 * Poll an AI validation job; deletes the status row once terminal.
 */
export const getValidationJob = async (req) => {
  const { taskId } = req.payload || {};
  if (!taskId) return { status: "unknown" };
  const row = await kvs.get(`ai-validation-status-${taskId}`);
  if (!row) return { status: "pending" };
  if (row.status === "done" || row.status === "error") {
    try { await kvs.delete(`ai-validation-status-${taskId}`); } catch (_) { /* ignore */ }
  }
  return row;
};

export const getAiFindings = async (req) => {
  const pageId = req.payload?.pageId || req.context.extension?.content?.id;
  if (!pageId) return { findings: null, aiEnabled: false };
  const spaceKey =
    req.payload?.spaceKey ||
    req.context.extension?.content?.space?.key ||
    req.context.extension?.space?.key ||
    null;
  const findings = await getLatestFindings(pageId);
  // Attach per-finding state (open/dismissed/false-positive/acknowledged).
  if (findings && Array.isArray(findings.findings)) {
    const states = await getFindingStates(pageId);
    findings.findings = findings.findings.map((f) => ({ ...f, state: states[f.id] || "open" }));
  }
  let aiEnabled = false;
  try { aiEnabled = (await resolveAiConfig(spaceKey))?.enabled === true; } catch (_) { /* off */ }
  return { findings, aiEnabled };
};

const setAiFindingState = async (req) => {
  const { pageId, findingId: fid, state } = req.payload || {};
  if (!pageId || !fid) return { success: false, reason: "Missing params" };
  const allowed = new Set(["open", "dismissed", "false-positive", "acknowledged"]);
  await setFindingState(pageId, fid, allowed.has(state) ? state : "open");
  return { success: true };
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
  ["set-ai-finding-state", setAiFindingState],
  ["get-validation-audit", getValidationAudit],
];
