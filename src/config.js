"use strict";
// Central configuration. Loading this module also loads <root>/.env.
require("./utils/env").load();

const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function envNum(name, dflt) {
  const v = parseFloat(process.env[name]);
  return Number.isFinite(v) ? v : dflt;
}

module.exports = {
  ROOT,
  VEC_LAB: path.join(ROOT, "vec-lab"),
  KERNELS: ["s1161", "s211", "s212", "s241", "s292", "s341", "s421", "s453", "s482", "vdotr"],

  // compiler / lab
  CLANG: process.env.CLANG || "clang",
  TYPE: process.env.VECLAB_TYPE || "double",
  BASE_FLAGS: ["-O3", "-march=native"],

  // agent loop
  THRESHOLD: envNum("VECTORIZER_THRESHOLD", 1.15),
  MAX_TRIES: parseInt(process.env.VECTORIZER_MAX_TRIES || "5", 10),
  BENCH_TRIALS: parseInt(process.env.VECTORIZER_BENCH_TRIALS || "7", 10),
  // accept correct+vectorized even when speedup is below THRESHOLD, label it no-gain
  RETAIN_NOGAIN: process.env.VECTORIZER_RETAIN_NOGAIN === "1",
  // candidate-diversity route budget: each NON-first fallback route gets this many attempts
  // (default 1); the FIRST (preferred, usually rewrite) route receives all remaining attempts.
  // e.g. tries=6, routes=[rewrite,pragma,intrinsic] -> 4 rewrite + 1 pragma + 1 intrinsic.
  ROUTE_SWITCH_TRIES: parseInt(process.env.VECTORIZER_ROUTE_SWITCH_TRIES || "1", 10),
  // allowed code-generation routes (hybrid is handled as intrinsic-style generation here)
  ROUTES: ["rewrite", "pragma", "intrinsic"],
  // optional explicit route order override (e.g. "pragma,intrinsic"); empty = follow analyze
  FORCE_ROUTES: (process.env.VECTORIZER_FORCE_ROUTES || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  // llm
  LLM_BASE_URL: process.env.LLM_BASE_URL || "https://api.deepseek.com",
  LLM_API_KEY: process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY,
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  LLM_MAX_TOKENS: parseInt(process.env.LLM_MAX_TOKENS || "8192", 10),
  LLM_TIMEOUT_MS: parseInt(process.env.LLM_TIMEOUT_MS || "120000", 10),
};
