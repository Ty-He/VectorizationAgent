"use strict";
// Aggregate an attempt's gate results into a pass/fail verdict.
const config = require("../config");

// Compose a concise human-readable feedback string for the LLM from a failed attempt.
function feedbackForLLM({ compile, runJson, vectorized, bench, note }) {
  const parts = [];
  if (compile && !compile.ok) {
    parts.push("GATE compile: FAILED\n" + (compile.stderr || compile.error || "").slice(-1800));
  } else if (runJson && runJson.status !== "ok") {
    parts.push(
      `GATE run: status=${runJson.status}` + (runJson.status === "not_implemented" ? " (opt not linked? placeholder active)" : "")
    );
  } else if (runJson && runJson.mismatches !== 0) {
    parts.push(`GATE correctness: FAILED mismatches=${runJson.mismatches} (orig checksum ${runJson.checksum_orig})`);
    if (Array.isArray(runJson.mismatch_samples) && runJson.mismatch_samples.length) {
      parts.push(
        "first mismatches [array,index,expected,actual]: " +
          runJson.mismatch_samples
            .map((s) => `[${s[0]}[${s[1]}] expected=${s[2]} got=${s[3]}]`)
            .join("  ")
      );
    }
  } else if (vectorized && !vectorized.ok) {
    parts.push("GATE vectorized: FAILED -- clang did not emit a Passed loop-vectorize record for " + vectorized.fn);
    if (vectorized.sampleMissedText) parts.push("vectorizer says: " + vectorized.sampleMissedText.slice(0, 800));
  } else if (bench) {
    parts.push(
      `GATE performance: speedup_best=${bench.speedupBest.toFixed(3)} speedup_median=${bench.speedupMedian.toFixed(3)} ` +
        `origMin=${bench.origMin.toFixed(5)} optMin=${bench.optMin.toFixed(5)} (need >= ${config.THRESHOLD})`
    );
    parts.push(
      "performance note: these kernels are usually memory-bound. If the loop vectorized but ran slow, " +
        "the rewrite most likely ADDED whole-array passes (copy to temp + separate update loops), doubling " +
        "memory traffic. Remove the dependence by algebraic substitution so the body reads ONLY old values " +
        "and keep BOTH output statements in ONE vectorized loop with no extra passes."
    );
  }
  if (note) parts.push("note: " + note);
  return parts.join("\n");
}

// Verdict for one attempt.
function evaluate({ compile, runJson, vectorized, bench }) {
  const reasons = [];
  if (compile && !compile.ok) reasons.push("compile-error");
  else if (!runJson) reasons.push("run-no-json");
  else if (runJson.status === "not_implemented") reasons.push("placeholder");
  else if (runJson.status !== "ok") reasons.push("run-error");
  else if (runJson.mismatches !== 0) reasons.push("wrong-result");
  else if (vectorized && !vectorized.ok) reasons.push("not-vectorized");
  else if (bench && bench.speedupBest < config.THRESHOLD) reasons.push("too-slow");
  return {
    ok: reasons.length === 0,
    reasons,
    metrics: {
      speedupBest: bench ? bench.speedupBest : null,
      speedupMedian: bench ? bench.speedupMedian : null,
      vf: vectorized && vectorized.ok ? vectorized.width : null,
      mismatches: runJson ? runJson.mismatches : null,
    },
  };
}

module.exports = { evaluate, feedbackForLLM };
