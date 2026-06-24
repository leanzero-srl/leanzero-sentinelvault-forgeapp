import { kvs } from "@forge/kvs";

import { readDocBody, extractPlainText } from "../../infra/doc-surgery.js";
import { runForgeLlmJson, isForgeLlmModelAllowed, FORGE_LLM_DEFAULT_MODEL } from "../../infra/forge-llm.js";
import { postAiFindingsComment } from "../../infra/validation-blueprints.js";
import {
  resolveAiConfig,
  buildValidationPrompt,
  normalizeFindings,
  severityRank,
  accrueTokenUsage,
  storeFindings,
} from "./logic.js";

// Async consumer for Semantic AI validation jobs. The Forge LLM call can exceed
// the 25s resolver limit, so it runs on the ai-validation-queue (120s function).
// Uses Atlassian-hosted Claude via @forge/llm — no external egress.
//
// event.body: { taskId, pageId, spaceKey, realmKey, requestedBy }
export async function aiValidationConsumer(event) {
  const { taskId, pageId, spaceKey, realmKey, requestedBy } = event?.body || {};
  if (!taskId || !pageId) {
    console.error("[AI-VALIDATE] missing taskId or pageId in event body");
    return;
  }
  const statusKey = `ai-validation-status-${taskId}`;
  const ttl = { expiresAt: Date.now() + 3600000 };

  try {
    await kvs.set(statusKey, { status: "processing", pageId }, ttl);

    const ai = await resolveAiConfig(spaceKey);
    if (!ai || ai.enabled !== true) {
      await kvs.set(statusKey, { status: "error", error: "AI validation is not enabled", pageId }, ttl);
      return;
    }

    let model = ai.model || FORGE_LLM_DEFAULT_MODEL;
    if (!isForgeLlmModelAllowed(model)) model = FORGE_LLM_DEFAULT_MODEL; // cost backstop

    const { pageData, adfDoc } = await readDocBody(pageId);
    const pageTitle = pageData?.title || "Untitled";
    let { text } = extractPlainText(adfDoc);
    const maxChars = ai.maxChars || 40000;
    let truncated = false;
    if (text.length > maxChars) { text = text.slice(0, maxChars); truncated = true; }

    const { system, user } = buildValidationPrompt({ ai, pageText: text, pageTitle });
    const res = await runForgeLlmJson({ model, system, user });

    if (res.usage) await accrueTokenUsage(realmKey || spaceKey, res.usage);

    if (!res.ok) {
      await kvs.set(statusKey, { status: "error", error: res.error || "LLM call failed", pageId }, ttl);
      return;
    }

    if (!res.parsed) {
      // Parse failure: record audit, post NO comment (fail-closed — never fabricate).
      const payload = { pageId, pageTitle, parseError: true, findings: [], summary: "", model, truncated, usage: res.usage, at: new Date().toISOString() };
      await storeFindings(pageId, payload);
      await kvs.set(statusKey, { status: "done", result: payload }, ttl);
      return;
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
          console.error("[AI-VALIDATE] comment failed:", e);
        }
      }
    }

    await kvs.set(statusKey, { status: "done", result: payload }, ttl);
  } catch (e) {
    console.error("[AI-VALIDATE] consumer error:", e);
    try {
      await kvs.set(statusKey, { status: "error", error: String(e?.message || e).slice(0, 300), pageId }, ttl);
    } catch (_) { /* best effort */ }
    // Manual flow: do NOT rethrow (avoid retry double-billing).
  }
}
