"use strict";
// Loads prompt templates from prompts/ and fills {{placeholders}}.
const fsUtil = require("../utils/fs");
const path = require("path");

const PROMPT_DIR = path.join(fsUtil.ROOT, "prompts");
const cache = new Map();

function template(name) {
  if (!cache.has(name)) {
    cache.set(name, fsUtil.readText(path.join(PROMPT_DIR, name + ".md")));
  }
  return cache.get(name);
}

function fill(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in vars)) return `{{${key}}}`;
    const v = vars[key];
    return typeof v === "string" ? v : JSON.stringify(v, null, 2);
  });
}

const SYSTEM = {
  analyze:
    "You are a meticulous senior compiler engineer (LLVM auto-vectorization). Answer with VALID JSON only, no prose.",
  generate:
    "You are an expert C programmer specializing in SIMD auto-vectorization. Output ONLY the requested fenced C code block, nothing else.",
  reflect:
    "You are an expert at debugging failed vectorization attempts. Answer with VALID JSON only, no prose.",
};

function buildAnalyze(vars) {
  return { system: SYSTEM.analyze, user: fill(template("analyze"), vars) };
}
function buildGenerate(vars) {
  return { system: SYSTEM.generate, user: fill(template("generate"), vars) };
}
function buildReflect(vars) {
  return { system: SYSTEM.reflect, user: fill(template("reflect"), vars) };
}

module.exports = { buildAnalyze, buildGenerate, buildReflect, fill, template };
