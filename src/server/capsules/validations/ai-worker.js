import { errorFacts, errText } from "../../shared/action-log.js";
import { setWithTtl } from "../../shared/kvs-ttl.js";
import { readDocBody, readDocBodyAtVersion, extractPlainText } from "../../infra/doc-surgery.js";
import { runForgeLlmJson, isForgeLlmModelAllowed, FORGE_LLM_DEFAULT_MODEL } from "../../infra/forge-llm.js";
import { postAiFindingsComment } from "../../infra/validation-blueprints.js";
import { applyAiVerdict } from "../workflow/approvals.js";
import { recordActivity } from "../../infra/activity-log.js";
import { aiAllowance, estimateMicro, monthLabel, resetLabel } from "./allowance.js";
import {
  checkAiSpend,
  aiGateRefusal,
  buildValidationPrompt,
  normalizeFindings,
  severityRank,
  accrueTokenUsage,
  storeFindings,
} from "./logic.js";

// The site-wide allowance around ONE model call (allowance.js): reserve the worst case for this
// prompt, call, settle to the reported tokens. Returns { refused } or { res }. A throw from the call
// leaves the reservation in place; it is charged at its reserved size when it expires (fail-safe).
async function callWithinAllowance(id, globalAi, { model, system, user }) {
  const resv = await aiAllowance.reserve(id, estimateMicro(`${system || ""}${user || ""}`), globalAi);
  if (!resv.ok) {
    if (resv.firstTrip) await noteAllowanceReached(resv);
    return { refused: { ok: false, why: resv.why, reason: resv.reason } };
  }
  const res = await runForgeLlmJson({ model, system, user });
  const s = await aiAllowance.settle(resv, res?.usage);
  if (s.firstTrip) await noteAllowanceReached(s);
  return { res };
}

async function noteAllowanceReached({ month, limitMicro }) {
  try {
    const at = Date.UTC(Number(String(month).slice(0, 4)), Number(String(month).slice(4, 6)) - 1, 15);
    await recordActivity({
      type: "validation.ai-allowance-reached", site: true, pageId: null, spaceKey: null, actor: null,
      target: { kind: "site", id: "site", name: null },
      details: { month, monthLabel: monthLabel(month), resetLabel: resetLabel(at), limitMicro: limitMicro || 0 },
    });
  } catch (e) { console.warn("[AI-ALLOWANCE] activity not recorded:", errText(e)); }
}

// #46 Part B: gate-mode review. Scores the PINNED version (the bytes the humans reviewed and
// #44 will enforce), then writes a terminal verdict onto the pending aiGate via applyAiVerdict.
// Fail-closed: an LLM/parse/read failure is a terminal FAILED (retry), NEVER a swallow that
// leaves the gate hanging forever.
async function handleGateReview(body) {
  const { pageId, spaceKey, realmKey, pinnedVersion, threshold, onBudgetExhausted } = body;
  try {
    // The spend gate again, right before the model call (logic.js checkAiSpend): the site switch
    // may have gone off, or the budget run out, since the job was queued. Same verdict as at
    // enqueue (aiGateRefusal). A job queued before onBudgetExhausted rode along blocks.
    const spend = await checkAiSpend(spaceKey);
    if (!spend.ok) {
      const refusal = aiGateRefusal(spend, onBudgetExhausted);
      await applyAiVerdict(pageId, pinnedVersion, refusal.verdict, refusal.reason);
      return { outcome: "refused", step: "spend-gate" }; // these returns are read by the action log only
    }
    const { ai } = spend;
    let model = ai.model || FORGE_LLM_DEFAULT_MODEL;
    if (!isForgeLlmModelAllowed(model)) model = FORGE_LLM_DEFAULT_MODEL;
    const { adfDoc, pageData } = pinnedVersion
      ? await readDocBodyAtVersion(pageId, pinnedVersion)
      : await readDocBody(pageId);
    const pageTitle = pageData?.title || "Untitled";
    let { text } = extractPlainText(adfDoc);
    const maxChars = ai.maxChars || 40000;
    if (text.length > maxChars) text = text.slice(0, maxChars);
    const { system, user } = buildValidationPrompt({ ai, pageText: text, pageTitle });
    const call = await callWithinAllowance(`gate:${pageId}:${pinnedVersion || "cur"}:${Date.now()}`, spend.globalAi, { model, system, user });
    if (call.refused) {
      const refusal = aiGateRefusal(call.refused, onBudgetExhausted);
      await applyAiVerdict(pageId, pinnedVersion, refusal.verdict, refusal.reason);
      return { outcome: "refused", step: "allowance" };
    }
    const { res } = call;
    if (res.usage) await accrueTokenUsage(realmKey || spaceKey, res.usage);
    if (!res.ok || !res.parsed) {
      await applyAiVerdict(pageId, pinnedVersion, "failed", "AI review failed — please retry.");
      return { outcome: "error", step: res.ok ? "llm-parse" : "llm-call" };
    }
    // audit C7: a truncated LLM response can drop findings — never grant a gate PASS on it.
    if (res.truncated) {
      await applyAiVerdict(pageId, pinnedVersion, "failed", "AI review was cut off (too long) — please retry.");
      return { outcome: "error", step: "llm-truncated" };
    }
    const norm = normalizeFindings(res.parsed);
    const bar = severityRank(threshold || "medium");
    const blocking = norm.findings.filter((f) => severityRank(f.severity) >= bar);
    const status = blocking.length === 0 ? "passed" : "failed";
    const reason = status === "failed"
      ? `${blocking.length} issue(s): ${blocking.slice(0, 3).map((f) => f.ruleRef || f.explanation || f.severity).join("; ")}`
      : null;
    await applyAiVerdict(pageId, pinnedVersion, status, reason);
  } catch (e) {
    console.error("[AI-GATE] review error:", errText(e));
    try { await applyAiVerdict(pageId, pinnedVersion, "failed", "AI review error — please retry."); } catch (_) { /* best effort */ }
    return { outcome: "error", ...errorFacts(e) };
  }
}

// Async consumer for Semantic AI validation jobs. The Forge LLM call can exceed
// the 25s resolver limit, so it runs on the ai-validation-queue (120s function).
// Uses Atlassian-hosted Claude via @forge/llm — no external egress.
//
// event.body: { taskId, pageId, spaceKey, realmKey, requestedBy }
export async function aiValidationConsumer(event) {
  // #46: transition-condition review rides the same queue with mode "gate".
  if (event?.body?.mode === "gate") return await handleGateReview(event.body);

  const { taskId, pageId, spaceKey, realmKey, requestedBy } = event?.body || {};
  if (!taskId || !pageId) {
    console.error("[AI-VALIDATE] missing taskId or pageId in event body");
    return { outcome: "refused", step: "missing-input" }; // read by the action log only
  }
  const statusKey = `ai-validation-status-${taskId}`;
  const STATUS_TTL_MS = 3600000;
  // Every write keeps the requester on the row (get-validation-job answers only them).
  const setStatus = (value) => setWithTtl(statusKey, { ...value, requestedBy: requestedBy || null }, STATUS_TTL_MS);

  try {
    await setStatus({ status: "processing", pageId });

    // The spend gate again, right before the model call (logic.js checkAiSpend): the site switch
    // may have gone off, or the budget run out, since the review was requested.
    const spend = await checkAiSpend(spaceKey);
    if (!spend.ok) {
      await setStatus({ status: "error", error: spend.reason, pageId });
      return { outcome: "refused", step: "spend-gate" }; // read by the action log only
    }
    const { ai } = spend;

    let model = ai.model || FORGE_LLM_DEFAULT_MODEL;
    if (!isForgeLlmModelAllowed(model)) model = FORGE_LLM_DEFAULT_MODEL; // cost backstop

    const { pageData, adfDoc } = await readDocBody(pageId);
    const pageTitle = pageData?.title || "Untitled";
    let { text } = extractPlainText(adfDoc);
    const maxChars = ai.maxChars || 40000;
    let truncated = false;
    if (text.length > maxChars) { text = text.slice(0, maxChars); truncated = true; }

    const { system, user } = buildValidationPrompt({ ai, pageText: text, pageTitle });
    // A re-delivered event (same taskId) must get its OWN reservation: sharing the id let the second
    // reserve overwrite the first, and the second settle then found nothing to settle (uncounted run).
    const call = await callWithinAllowance(`manual:${taskId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, spend.globalAi, { model, system, user });
    if (call.refused) {
      await setStatus({ status: "error", error: call.refused.reason, pageId });
      return { outcome: "refused", step: "allowance" };
    }
    const { res } = call;

    if (res.usage) await accrueTokenUsage(realmKey || spaceKey, res.usage);

    if (!res.ok) {
      await setStatus({ status: "error", error: res.error || "LLM call failed", pageId });
      return { outcome: "error", step: "llm-call" };
    }

    if (!res.parsed) {
      // Parse failure: record audit, post NO comment (fail-closed — never fabricate).
      const payload = { pageId, pageTitle, parseError: true, findings: [], summary: "", model, truncated, usage: res.usage, at: new Date().toISOString() };
      await storeFindings(pageId, payload);
      await setStatus({ status: "done", result: payload });
      return { outcome: "error", step: "llm-parse" };
    }

    const norm = normalizeFindings(res.parsed);
    const payload = {
      pageId, pageTitle, findings: norm.findings, summary: norm.summary,
      model, truncated, usage: res.usage, requestedBy, at: new Date().toISOString(),
    };
    await storeFindings(pageId, payload);

    // Notify the page author when configured and findings meet the threshold.
    if (ai.notifyAuthor) {
      const threshold = severityRank(ai.severityThreshold || "low");
      const qualifying = norm.findings.filter((f) => severityRank(f.severity) >= threshold);
      if (qualifying.length > 0) {
        const authorId = pageData?.version?.authorId || requestedBy || null;
        try {
          await postAiFindingsComment({ pageId, recipientAccountId: authorId, findings: qualifying, pageTitle });
        } catch (e) {
          console.error("[AI-VALIDATE] comment failed:", errText(e));
        }
      }
    }

    await setStatus({ status: "done", result: payload });
  } catch (e) {
    console.error("[AI-VALIDATE] consumer error:", errText(e));
    try {
      await setStatus({ status: "error", error: String(e?.message || e).slice(0, 300), pageId });
    } catch (_) { /* best effort */ }
    // Manual flow: do NOT rethrow (avoid retry double-billing).
    return { outcome: "error", ...errorFacts(e) };
  }
}
