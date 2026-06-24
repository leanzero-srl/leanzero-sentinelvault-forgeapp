// Forge LLM adapter for Sentinel Vault.
//
// Wraps the Atlassian-hosted Forge LLMs API (@forge/llm, Preview since
// 2026-06-01) so AI features run ENTIRELY on the Atlassian platform — no API
// key, no external egress, so the app keeps its "Runs on Atlassian" badge.
// Token costs bill to the app vendor's Forge bill, so we enforce a Haiku-only
// policy (see isForgeLlmModelAllowed) at every layer.
//
// Ported from the proven CogniRunner implementation (callForgeLlmChat,
// parseAIJson and the JSON-repair helpers), trimmed to the system+user request
// shape Sentinel's content validation needs (no tool-calling). chat() has no
// response_format param, so JSON output is enforced via the system message and
// recovered with the tolerant parser below.
import { chat as forgeLlmChatApi, list as forgeLlmListApi } from "@forge/llm";
import { parseAIJson } from "./json-salvage.js";

// Re-export so existing importers can keep getting parseAIJson from here.
export { parseAIJson } from "./json-salvage.js";

// Default + only model family offered. Sonnet/Opus token costs are larger and
// reserved for a future paid tier; Haiku is enforced in list / save / chat.
export const FORGE_LLM_DEFAULT_MODEL = "claude-haiku-4-5-20251001";

// Documented Preview model ids — fallback when list() fails (e.g. the llm
// module hasn't been approved by an admin yet).
export const FORGE_LLM_FALLBACK_MODELS = ["claude-haiku-4-5-20251001"];

// POLICY: only Claude Haiku is offered on Forge LLM. Enforced at list, at save,
// AND here at the chat adapter, so a stale saved config can never bill a larger
// (vendor-billed) model.
export const isForgeLlmModelAllowed = (id) => /haiku/i.test(String(id || ""));

// Retry classifier: throttle / gateway / network blips are transient; a real
// 4xx (bad request) is not.
export const isTransientAIError = (status, error = "") =>
  status === 429 || status === 408 || (typeof status === "number" && status >= 500) ||
  /\b(429|rate.?limit|timed?.?out|timeout|network|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|aborted|socket hang up)\b/i.test(String(error));

/**
 * Low-level adapter: translate a system+user (and optional assistant) message
 * array to @forge/llm's chat() shape and back. Flattens multimodal content to
 * text (Forge LLMs are text-only in Preview), appends the JSON-mode instruction
 * to the system message when jsonMode is set, retries 429/5xx with bounded
 * backoff, and returns a normalized result.
 *
 * @returns {Promise<{ ok:boolean, status:number, content:string|null,
 *   usage:{ inputTokens:number, outputTokens:number, totalTokens:number },
 *   error?:string }>}
 */
export const callForgeLlmChat = async ({ model, messages, jsonMode, maxTokens = 4096 }) => {
  // Billing backstop: never let a stale config bill a larger model.
  if (!isForgeLlmModelAllowed(model)) {
    console.warn(`[FORGE-LLM] model "${model}" not allowed — clamping to ${FORGE_LLM_DEFAULT_MODEL}`);
    model = FORGE_LLM_DEFAULT_MODEL;
  }

  try {
    const outMessages = [];
    let jsonInstructionAdded = false;
    for (const msg of messages || []) {
      // Flatten multimodal content to plain text — Forge LLMs are text-only.
      let content = msg.content;
      if (Array.isArray(content)) {
        content = content.filter((p) => p?.type === "text").map((p) => p.text || "").join("\n");
      }
      const out = { role: msg.role, content: content ?? "" };
      if (msg.role === "system" && jsonMode && !jsonInstructionAdded) {
        out.content += "\n\nRespond with ONLY a valid JSON object. No markdown fences, no surrounding prose, no explanation outside the JSON.";
        jsonInstructionAdded = true;
      }
      outMessages.push(out);
    }
    if (jsonMode && !jsonInstructionAdded) {
      outMessages.unshift({
        role: "system",
        content: "Respond with ONLY a valid JSON object. No markdown fences, no surrounding prose, no explanation outside the JSON.",
      });
    }

    const prompt = { model, messages: outMessages, max_completion_tokens: maxTokens };

    let response;
    for (let attempt = 1; ; attempt++) {
      try {
        response = await forgeLlmChatApi(prompt);
        break;
      } catch (err) {
        if (attempt <= 3 && isTransientAIError(err?.status, err?.message)) {
          await new Promise((r) => setTimeout(r, Math.min(2000, 400 * 2 ** (attempt - 1))));
          continue;
        }
        throw err;
      }
    }

    const choice = response?.choices?.[0] || {};
    const message = choice.message || {};
    let content = message.content;
    if (Array.isArray(content)) {
      content = content.filter((p) => p?.type === "text").map((p) => p.text || "").join("");
    }
    const inputTokens = response?.usage?.input_tokens || 0;
    const outputTokens = response?.usage?.output_tokens || 0;
    return {
      ok: true,
      status: 200,
      content: content ?? null,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: response?.usage?.total_tokens || (inputTokens + outputTokens),
      },
    };
  } catch (err) {
    const detail = err?.message || String(err);
    console.error("[FORGE-LLM] error:", err?.status, detail);
    return {
      ok: false,
      status: err?.status || 500,
      content: null,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      error: String(detail).substring(0, 500),
    };
  }
};

/**
 * Convenience wrapper: run a single system+user JSON-mode call and return the
 * parsed object (or null on parse failure), plus token usage.
 *
 * @returns {Promise<{ ok:boolean, parsed:object|null, raw:string|null,
 *   usage:object, error?:string }>}
 */
export const runForgeLlmJson = async ({ model, system, user, maxTokens }) => {
  const result = await callForgeLlmChat({
    model: model || FORGE_LLM_DEFAULT_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    jsonMode: true,
    maxTokens,
  });
  if (!result.ok) {
    return { ok: false, parsed: null, raw: null, usage: result.usage, error: result.error };
  }
  const parsed = parseAIJson(result.content);
  return { ok: true, parsed, raw: result.content, usage: result.usage };
};

/**
 * List Haiku-only Forge LLM model ids for the admin model dropdown. Falls back
 * to the documented Preview ids if list() fails or the module isn't approved.
 */
export const listForgeLlmModels = async () => {
  try {
    const resp = await forgeLlmListApi();
    const raw = Array.isArray(resp) ? resp : (resp?.models || []);
    let ids = raw
      .filter((m) => typeof m === "string" || m?.status !== "deprecated")
      .map((m) => (typeof m === "string" ? m : m?.model))
      .filter(Boolean)
      .filter(isForgeLlmModelAllowed); // Haiku-only policy (vendor-billed tokens)
    if (ids.length === 0) ids = [...FORGE_LLM_FALLBACK_MODELS];
    return ids;
  } catch (e) {
    console.warn("[FORGE-LLM] list() failed — using documented fallback models:", e?.message);
    return [...FORGE_LLM_FALLBACK_MODELS];
  }
};
