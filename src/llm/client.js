"use strict";
// DeepSeek (OpenAI-compatible) chat completions client.
const OpenAI = require("openai");
const config = require("../config");
const logger = require("../utils/logger");

if (!config.LLM_API_KEY) {
  throw new Error("No LLM API key: set LLM_API_KEY or DEEPSEEK_API_KEY in .env");
}

const client = new OpenAI({
  baseURL: config.LLM_BASE_URL,
  apiKey: config.LLM_API_KEY,
  timeout: config.LLM_TIMEOUT_MS,
});

async function chat({ system, user, temperature = 0.2, maxTokens = config.LLM_MAX_TOKENS, jsonMode = false, maxAttempts = 3, escalate = true } = {}) {
  const baseBudget = maxTokens || config.LLM_MAX_TOKENS;
  const attempts = Math.max(1, Math.min(3, maxAttempts));
  // On retry we bump the budget (the previous reply was cut off at max_tokens) and tell the model
  // to be terse so it finishes inside the (larger) budget. Advisory calls (e.g. reflect) can pass
  // escalate:false to keep a fixed small budget and fail fast.
  const budgetFor = (attempt) => {
    if (!escalate || attempt <= 1) return baseBudget;
    return Math.min(baseBudget * 4, 32768);
  };
  const buildReq = (effectiveUser, attempt) => {
    const messages = [
      { role: "system", content: system },
      { role: "user", content: effectiveUser },
    ];
    const req = {
      model: config.DEEPSEEK_MODEL,
      messages,
      temperature,
      max_tokens: budgetFor(attempt),
      stream: false,
    };
    if (jsonMode) req.response_format = { type: "json_object" };
    return req;
  };

  let lastErr = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    // DeepSeek returns finish_reason="length" when the reply hit max_tokens. That can happen
    // with (a) reasoning models that burn tokens in `reasoning_content` (content == ""), or
    // (b) plain truncation mid-JSON/code (content non-empty but cut off -> "unbalanced braces"
    // when we try to parse it). Both cases: retry with a larger budget and a terseness nudge.
    const nudge = attempt > 1
      ? "\n\n(Your previous reply was cut off because you ran out of output budget. " +
        "Do NOT over-deliberate. Keep the whole answer SHORT and COMPLETE — JSON objects must be fully " +
        "closed and code blocks must be whole. Emit the final answer now.)"
      : "";
    try {
      const res = await client.chat.completions.create(buildReq(user + nudge, attempt));
      const msg = res.choices && res.choices[0] ? res.choices[0].message : null;
      const finish = res.choices && res.choices[0] ? res.choices[0].finish_reason : null;
      const content = msg && msg.content ? msg.content : "";
      if (!content.trim() || finish === "length") {
        lastErr = new Error(`LLM reply incomplete (finish_reason=${finish || "?"})`);
        logger.warn(
          `llm reply incomplete (finish=${finish || "?"}, content_len=${content.length}, ` +
            `budget=${budgetFor(attempt)}); retrying ${attempt}/${attempts}`
        );
        continue;
      }
      const usage = res.usage || {};
      if (usage.total_tokens) logger.debug(`llm tokens in=${usage.prompt_tokens} out=${usage.completion_tokens}`);
      return { content, usage: usage || {}, finishReason: finish };
    } catch (e) {
      lastErr = e;
      logger.warn(`llm attempt ${attempt} failed: ${e.message}`);
      if (attempt < attempts) await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
  throw new Error("LLM call failed after retries: " + (lastErr && lastErr.message));
}

module.exports = { chat };
