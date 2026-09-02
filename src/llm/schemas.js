"use strict";
// Robust parsing helpers for LLM outputs.

function extractJson(text) {
  if (!text) throw new Error("empty LLM output");
  let t = text.trim();
  // strip a ```json ... ``` fence if present
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();

  // balanced-brace scan from the first '{', honoring quoted strings.
  const start = t.indexOf("{");
  if (start < 0) throw new Error("LLM output has no JSON object: " + JSON.stringify(t.slice(0, 150)));
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const cand = t.slice(start, i + 1);
        try {
          return JSON.parse(cand);
        } catch (e) {
          throw new Error("LLM JSON parse error: " + e.message + "\n" + JSON.stringify(cand.slice(0, 200)));
        }
      }
    }
  }
  throw new Error("LLM output has unbalanced JSON braces: " + JSON.stringify(t.slice(0, 200)));
}

// Extract the first fenced code block (any language). If no fence, return the whole
// trimmed text only when it looks like a single C function body fragment.
function extractCodeBlock(text) {
  if (!text) throw new Error("empty LLM output");
  const fences = text.match(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/g);
  if (fences && fences.length) {
    const first = fences[0];
    const inner = first.replace(/^```[a-zA-Z0-9_-]*\s*/, "").replace(/```$/, "").trim();
    return inner;
  }
  // No fences: hope the model obeyed and returned raw code.
  const t = text.trim();
  if (/^int\s+\w+_opt\s*\(/m.test(t) || /^#include/.test(t) || /^[A-Za-z_][\w\s\*]*\(void\)/m.test(t)) {
    return t;
  }
  throw new Error("No code block found in LLM output:\n" + t.slice(0, 300));
}

// Validate generated code has the expected function definition.
function assertHasFunction(code, funcName) {
  const re = new RegExp(`\\b${funcName}\\s*\\(\\s*void\\s*\\)`);
  if (!re.test(code)) {
    throw new Error(`generated code does not define 'int ${funcName}(void)'`);
  }
  return true;
}

function required(obj, keys, what) {
  const missing = keys.filter((k) => obj[k] === undefined || obj[k] === null || obj[k] === "");
  if (missing.length) throw new Error(`${what} output missing fields: ${missing.join(",")}`);
}

module.exports = { extractJson, extractCodeBlock, assertHasFunction, required };
