"use strict";
// Parse & summarize clang -fsave-optimization-record YAML (optimization records).
const fs = require("fs");
const YAML = require("yaml");

function toPlain(doc) {
  try {
    return doc.toJS(doc);
  } catch {
    return null;
  }
}

// Parse a whole optimization-record file into normalized records.
// A record: { tag, pass, name, function, file, line, col, text, args }
function parseRecordFile(file) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8");
  let docs;
  try {
    docs = YAML.parseAllDocuments(text, { prettyErrors: false });
  } catch (e) {
    throw new Error(`failed to parse optimization record ${file}: ${e.message}`);
  }
  const out = [];
  for (const doc of docs) {
    const o = toPlain(doc);
    if (!o || typeof o !== "object") continue;
    const dl = o.DebugLoc || {};
    const argsText = Array.isArray(o.Args)
      ? o.Args
          .map((item) => {
            if (typeof item === "string") return item;
            if (item && typeof item === "object") {
              const e = Object.entries(item)[0];
              return e ? String(e[1]) : "";
            }
            return String(item);
          })
          .join("")
      : "";
    out.push({
      tag: doc.contents && doc.contents.tag ? String(doc.contents.tag).replace(/^!/, "") : "",
      pass: o.Pass,
      name: o.Name,
      function: o.Function,
      file: dl.File,
      line: dl.Line,
      col: dl.Column,
      text: argsText || "",
      args: Array.isArray(o.Args) ? o.Args : [],
    });
  }
  return out;
}

// Keep only records that concern a given function and pass (default loop-vectorize).
function filterRecords(records, opts = {}) {
  const passes = new Set(opts.passes || ["loop-vectorize"]);
  return records.filter((r) => {
    if (!r.pass || !passes.has(r.pass)) return false;
    if (opts.function && r.function && r.function !== opts.function) return false;
    if (opts.fileSubstr && r.file && !r.file.includes(opts.fileSubstr)) return false;
    return true;
  });
}

// ty: records should not be too long, it take much token
function summarize(records, limit = 60) {
  const lines = records.map((r) => {
    const loc = r.file ? `${r.file}:${r.line}:${r.col}` : r.function || "?";
    return `[${r.tag}/${r.pass}/${r.name}] ${r.function} @ ${loc}  ${r.text}`.trim();
  });
  const cap = limit > 0 && lines.length > limit ? lines.length : undefined;
  const body = cap ? lines.slice(0, limit) : lines;
  return { text: body.join("\n"), total: lines.length, truncated: !!cap };
}

// Vectorization info for one function from its loop-vectorize records.
function vectorizeInfo(records, functionName) {
  const mine = filterRecords(records, { function: functionName, passes: ["loop-vectorize"] });
  const passed = mine.filter((r) => r.tag === "Passed" && r.name === "Vectorized");
  const vfs = [];
  for (const p of passed) {
    const m = p.text.match(/vectorization width:\s*(\d+)/);
    if (m) vfs.push(parseInt(m[1], 10));
  }
  const missed = mine.filter((r) => /not vectorized|vectorization not beneficial|interleaving loop|Potential.*overflow/i.test(r.text) || r.tag === "Missed" || r.tag === "Analysis");
  return {
    vectorized: passed.length > 0,
    vfs,
    width: vfs.length ? Math.max(...vfs) : null,
    passedCount: passed.length,
    failed: mine.filter((r) => r.tag === "Missed").map((r) => r.name),
    sampleMissedText: missed.length ? missed.slice(0, 6).map((r) => r.text).join(" | ") : "",
  };
}

// Heuristic evidence that SIMD instructions are actually emitted, read from asm-printer
// InstructionMix records. Useful for the intrinsic route, where there may be no
// loop-vectorize "Passed" record but the codegen still contains vector instructions.
const SIMD_TOKEN_RE = /\b[A-Z][A-Z0-9_]*(?:PD|PS|DQ|YMM|XMM|FMA|APD|APS)\b/i;
function simdEvidence(records, functionName) {
  const mine = records.filter(
    (r) => r.pass === "asm-printer" && r.name === "InstructionMix" && (!functionName || r.function === functionName)
  );
  const text = mine.map((r) => r.text).join("\n");
  const tokens = text.match(/\b[A-Z][A-Z0-9_]*\b/g) || [];
  const hits = [];
  const seen = new Set();
  for (const t of tokens) {
    if (SIMD_TOKEN_RE.test(t) && !seen.has(t)) {
      seen.add(t);
      hits.push(t);
    }
  }
  return {
    // approximate: total count of vector-ish tokens appearing in the instruction mix
    simd: hits.length > 0,
    names: hits.slice(0, 20),
    count: hits.length,
  };
}

module.exports = { parseRecordFile, filterRecords, summarize, vectorizeInfo, simdEvidence };
