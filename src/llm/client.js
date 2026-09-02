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

async function chat({ system, user, temperature = 0.2, maxTokens = config.LLM_MAX_TOKENS, jsonMode = false } = {}) {
  const buildReq = (effectiveUser) => {
    const messages = [
      { role: "system", content: system },
      { role: "user", content: effectiveUser },
    ];
    const req = {
      model: config.DEEPSEEK_MODEL,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
    };
    if (jsonMode) req.response_format = { type: "json_object" };
    return req;
  };

  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    // Reasoning models (e.g. deepseek-v4-flash) burn tokens in `reasoning_content` before
    // emitting the real answer. If they exceed max_tokens the API returns content == "" with
    // finish_reason == "length". Nudge them to answer immediately on retry.
    const nudge = attempt > 1
      ? "\n\n(Your previous reply came back empty because you ran out of output budget while reasoning. " +
        "Do NOT over-deliberate. Emit the full requested answer now, and keep any reasoning to a minimum.)"
      : "";
    try {
      const res = await client.chat.completions.create(buildReq(user + nudge));
      const msg = res.choices && res.choices[0] ? res.choices[0].message : null;
      const finish = res.choices && res.choices[0] ? res.choices[0].finish_reason : null;
      const content = msg && msg.content ? msg.content : "";
      if (!content.trim()) {
        lastErr = new Error(`empty LLM content (finish_reason=${finish || "?"})`);
        logger.warn(`llm returned empty content (${finish || "?"}); retrying ${attempt}/3`);
        continue;
      }
      const usage = res.usage || {};
      if (usage.total_tokens) logger.debug(`llm tokens in=${usage.prompt_tokens} out=${usage.completion_tokens}`);
      return { content, usage: usage || {}, finishReason: finish };
    } catch (e) {
      lastErr = e;
      logger.warn(`llm attempt ${attempt} failed: ${e.message}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
  throw new Error("LLM call failed after retries: " + (lastErr && lastErr.message));
}

module.exports = { chat };
