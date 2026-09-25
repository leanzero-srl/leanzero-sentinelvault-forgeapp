import { asApp, route } from "@forge/api";
import { kvs } from "@forge/kvs";
import { Queue } from "@forge/events";
import { fetchPageLabelsChecked } from "../../infra/labels.js";
import { ruleListRefusal, rulesNeedLabels } from "../../shared/rule-config.js";
import { recordActivity } from "../../infra/activity-log.js";
import { decideRecheckWrite, recheckNote, rulesFingerprint, reconcileStoredState } from "./recheck.js";

import { authorizeSteward, isOperatorSteward, isOperatorSiteAdmin } from "../../shared/steward-checks.js";
import { setWithTtl } from "../../shared/kvs-ttl.js";
// audit B6 / SV-SEC-1: resolvePageSpaceKey moved to the shared module so the workflow capsule
// uses the same copy instead of a second one that can drift apart from this one.
import { canEditPage, canReadPage, mustVerify, resolvePageSpaceKey } from "../../shared/content-access.js";

import { readDocBody } from "../../infra/doc-surgery.js";
import { evaluateRules } from "../../infra/rules-engine.js";
import {
  loadValidationConfig,
  storeValidationConfig,
  readValidationState,
  writeValidationState,
  resolveEffectiveConfig,
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
  let space = spaceKey ? await kvs.get(`validation-config-space-${sanitize(spaceKey)}`) : null;
  // A space whose own switch is OFF is ignored, exactly as the save check ignores it
  // (resolveEffectiveConfig, it50). Otherwise Re-check and the transition gate judged a page on
  // space rules the save check never applies — two answers for one page (2026-09-23).
  if (space && space.enabled === false) space = null;
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
  if (!authorized) return { success: false, reason: "Not authorized — space admin access required." };
  // 2026-09-23: a rule that checks nothing (a "Require a heading" with no text and no level
  // passes on any heading) is refused here, the one door every save goes through — the rules
  // editor, and the config REST API (which stores through this resolver).
  if (data.rules !== undefined) {
    if (!Array.isArray(data.rules)) return { success: false, reason: "Rules must be a list." };
    const refusal = ruleListRefusal(data.rules);
    if (refusal) return { success: false, reason: refusal };
  }
  // Cost backstop: never persist a non-Haiku AI model.
  if (data.ai && data.ai.model && !isForgeLlmModelAllowed(data.ai.model)) {
    data.ai.model = FORGE_LLM_DEFAULT_MODEL;
  }
  return await storeValidationConfig(scope || "global", key, data);
};

// The space whose rules apply is a property of the page, not of the caller. Context first (it is
// authentic and free, and only when it names THIS page); otherwise resolve it from the page itself.
async function pageSpaceKey(req, pageId) {
  const ctxPageId = req.context.extension?.content?.id;
  const ctxSpaceKey = req.context.extension?.content?.space?.key || req.context.extension?.space?.key || null;
  if (ctxSpaceKey && ctxPageId && String(ctxPageId) === String(pageId)) return ctxSpaceKey;
  return (await resolvePageSpaceKey(pageId)) || null;
}

// Judge the LIVE page against `rules`. Never fails open: a read error or an incomplete label
// read (when a label rule is present) returns checked:false with a reason the panel shows.
async function judgePage(pageId, rules) {
  try {
    const { pageData, adfDoc } = await readDocBody(pageId);
    const version = pageData?.version?.number ?? null;
    const { labels, complete } = await fetchPageLabelsChecked(pageId);
    if (!complete && rulesNeedLabels(rules)) {
      return { checked: false, version, failureReason: "Could not read this page's labels, so the label rules were not checked. Try again in a moment." };
    }
    const { passed, violations } = evaluateRules(adfDoc, labels, rules);
    return { checked: true, version, passed, violations };
  } catch (e) {
    console.error("[VALIDATE-NOW] failed:", e);
    // SV-m3: do NOT fail open — a page-read error must not render as "all checks passed".
    return { checked: false, version: null, failureReason: "Could not read this page to check it. Try again in a moment.", error: String(e?.message || e) };
  }
}

/**
 * On-demand validation (no mutation).
 */
const validatePageNow = async (req) => {
  const ctxPageId = req.context.extension?.content?.id;
  const pageId = req.payload?.pageId || ctxPageId;
  if (!pageId) return { passed: true, violations: [], reason: "No page" };

  // SV-SEC-1. The body is read via asApp() and the violations echo derived content back —
  // verbatim heading text, exact character counts, which labels/macros/tables are present — so
  // a payload-named page id was a readable window onto pages the caller cannot open.
  if (mustVerify(req.payload?.pageId, ctxPageId)
    && !(await canReadPage(req.context.accountId, pageId))) {
    return { ok: false, passed: false, violations: [], failureReason: "Could not validate this page" };
  }

  const rules = await resolveRules(await pageSpaceKey(req, pageId));
  if (!rules.length) return { passed: true, violations: [], noRules: true };

  const r = await judgePage(pageId, rules);
  if (!r.checked) return { ok: false, passed: false, violations: [], failureReason: r.failureReason, error: r.error };
  return { passed: r.passed, violations: r.violations, version: r.version };
};

/**
 * Re-check (the panel's button, and the config API's `recheck-validation`): judge the live page
 * NOW and, when pass/fail status is on for its space and the caller may edit the page, store the
 * verdict — so the badge, the ribbon chip and the workflow gate agree with what was just shown.
 * No comment, no revert: those stay with a published save. Reads the same effective rules as the
 * save check, so the two can never judge one page differently.
 */
const recheckPageValidation = async (req) => {
  const ctxPageId = req.context.extension?.content?.id;
  const pageId = req.payload?.pageId || ctxPageId;
  const accountId = req.context.accountId;
  if (!pageId) return { ok: false, passed: false, violations: [], failureReason: "No page", reason: "No page" };

  if (mustVerify(req.payload?.pageId, ctxPageId) && !(await canReadPage(accountId, pageId))) {
    return { ok: false, passed: false, violations: [], failureReason: "Could not validate this page", reason: "Could not validate this page" };
  }

  const spaceKey = await pageSpaceKey(req, pageId);
  const effective = await resolveEffectiveConfig(spaceKey);
  // Validation switched off site-wide: still answer the question on the authored rules (what the
  // panel always did), but nothing is stored — there is no status to keep in step.
  const rules = effective.enabled ? (effective.rules || []) : await resolveRules(spaceKey);
  const stored = await readValidationState(pageId);
  if (!rules.length) return { success: true, passed: true, violations: [], noRules: true, state: null, persisted: false };

  const r = await judgePage(pageId, rules);
  if (!r.checked) {
    return { ok: false, passed: false, violations: [], failureReason: r.failureReason, reason: r.failureReason, error: r.error, state: stored, persisted: false };
  }

  const gateOn = !!(effective.enabled && effective.modes?.gate);
  const canEdit = gateOn ? await canEditPage(accountId, pageId) : false;
  const decision = decideRecheckWrite({ gateOn, canEdit, checked: true, passed: r.passed, version: r.version, stored });
  let state = stored;
  if (decision.write) {
    const next = r.passed ? "passed" : "failed";
    state = { state: next, violations: r.passed ? [] : r.violations, version: r.version, checkedAt: new Date().toISOString(), checkedBy: accountId, source: "recheck", rulesFp: rulesFingerprint(rules) };
    await writeValidationState(pageId, state);
    if (stored?.state !== next) {
      await recordActivity({
        type: "validation.gate",
        pageId,
        spaceKey,
        actor: accountId ? { accountId, name: null } : null,
        target: { kind: "page", id: pageId, name: null },
        details: { state: next, previous: stored?.state || null, source: "recheck", violations: next === "failed" ? r.violations.map((v) => v?.label || "rule").slice(0, 25) : [] },
        version: r.version,
      });
    }
  }
  // `success` = the check ran (the config API's receipt reads it); `passed` is the verdict.
  return { success: true, passed: r.passed, violations: r.violations, version: r.version, state, persisted: decision.write, note: recheckNote(decision.why) };
};

const getValidationState = async (req) => {
  const ctxPageId = req.context.extension?.content?.id;
  const pageId = req.payload?.pageId || ctxPageId;
  if (!pageId) return { state: null };
  // SV-SEC-1: the state carries the page's outstanding violations and who approved its gate.
  if (mustVerify(req.payload?.pageId, ctxPageId)
    && !(await canReadPage(req.context.accountId, pageId))) {
    return { state: null };
  }
  // 2026-09-24: answer for the CURRENT rules. Validation or pass/fail off, or no rule left →
  // no status (the panel group and the ribbon chip disappear); rules changed since the status
  // was written → `stale`, and the panel re-checks instead of showing the old verdict.
  const effective = await resolveEffectiveConfig(await pageSpaceKey(req, pageId));
  const stored = await readValidationState(pageId);
  const { state, stale, applies } = reconcileStoredState({ effective, stored, fingerprint: rulesFingerprint(effective.rules) });
  return { state, stale, applies: applies === true };
};

/**
 * "Approve anyway": a space admin marks a page that fails validation as passed. Stands for the
 * version they looked at (stamped here), so a re-check of that version keeps it and the next
 * published edit is judged again. Only meaningful where pass/fail status is on.
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
  if (!allowed) return { success: false, reason: "Only an admin of this page's space can approve it" };

  const effective = await resolveEffectiveConfig(spaceKey);
  if (!effective.enabled || !effective.modes?.gate) {
    return { success: false, reason: "Pass/fail status is off for this space, so there is nothing to approve." };
  }

  let version = null;
  try { version = (await readDocBody(pageId)).pageData?.version?.number ?? null; }
  catch (_) { return { success: false, reason: "Could not read the page. Try again in a moment." }; }

  const stored = await readValidationState(pageId);
  const state = { state: "passed", violations: [], version, approvedBy: accountId, approvedAt: new Date().toISOString(), checkedAt: new Date().toISOString(), rulesFp: rulesFingerprint(effective.rules) };
  await writeValidationState(pageId, state);
  await recordActivity({
    type: "validation.gate",
    pageId,
    spaceKey,
    actor: accountId ? { accountId, name: null } : null,
    target: { kind: "page", id: pageId, name: null },
    details: { state: "passed", previous: stored?.state || null, approved: true, violations: [] },
    version,
  });
  return { success: true, state };
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
  if (!allowed) return { success: false, reason: "Only an admin of this page's space can run an AI review" };

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
  const ctxPageId = req.context.extension?.content?.id;
  const pageId = req.payload?.pageId || ctxPageId;
  if (!pageId) return { findings: null, aiEnabled: false };
  // SV-SEC-1: findings quote the page back — up to 25 verbatim excerpts of its body, originally
  // read with asApp() — plus the title and the accountId of the steward who ran the review.
  if (mustVerify(req.payload?.pageId, ctxPageId)
    && !(await canReadPage(req.context.accountId, pageId))) {
    return { findings: null, aiEnabled: false };
  }
  // The aiEnabled flag describes the space the PAGE lives in, so derive it from the page.
  // Reading it out of the caller's extension context instead answers for the space the caller
  // happens to be standing in — the same page-vs-space mix-up the SV-SEC-1 audit found all over
  // this surface, and it is wrong here for the same reason even though this one only drives a
  // display flag: ask about page X and be told whether AI is on for space B. Context stays as a
  // fallback for the ordinary in-page call, where it is already correct and costs no round-trip.
  const ctxSpaceKey =
    req.context.extension?.content?.space?.key ||
    req.context.extension?.space?.key ||
    null;
  const spaceKey = (ctxPageId && String(pageId) === String(ctxPageId) && ctxSpaceKey)
    ? ctxSpaceKey
    : ((await resolvePageSpaceKey(pageId)) || ctxSpaceKey);
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
  // SV-SEC-1: this WRITES triage state (dismissed / false-positive) against a payload-named
  // page, so ungated anyone could clear another page's AI findings. Dismissing a finding is a
  // judgement about the page's content — the bar is being able to change the page.
  if (!(await canEditPage(req.context.accountId, pageId))) {
    return { success: false, reason: "You do not have permission to change this page's review" };
  }
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
  // SV-SEC-1 (same class as its neighbours): AI spend is an administrative metric for a
  // payload-named space, so it belongs to that space's stewards.
  if (!spaceKey || !(await isOperatorSteward(req.context?.accountId, spaceKey))) {
    return { monthlyTokens: null };
  }
  const monthlyTokens = await getMonthlyTokenUsage(spaceKey);
  return { monthlyTokens };
};

export const actions = [
  ["load-validation-config", loadConfig],
  ["store-validation-config", storeConfig],
  ["validate-page-now", validatePageNow],
  ["recheck-page-validation", recheckPageValidation],
  ["get-validation-state", getValidationState],
  ["approve-page-gate", approvePageGate],
  ["list-ai-models", listAiModels],
  ["enqueue-page-validation", enqueuePageValidation],
  ["get-validation-job", getValidationJob],
  ["get-ai-findings", getAiFindings],
  ["set-ai-finding-state", setAiFindingState],
  ["get-validation-audit", getValidationAudit],
];
