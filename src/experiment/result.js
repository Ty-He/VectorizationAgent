"use strict";
// Persist per-kernel run state (resume / audit) and export final results (json + csv).
const fsUtil = require("../utils/fs");
const path = require("path");
const workspace = require("./workspace");
const config = require("../config");

const CSV_COLS = [
  "kernel", "status", "speedup_best", "speedup_median",
  "orig_min", "opt_min", "vf", "mismatches", "attempts", "obstacle", "strategy", "ts",
];
const csvFile = path.join(config.ROOT, "experiments", "results.csv");

function saveState(state) {
  fsUtil.writeJson(workspace.file(state.kernel, workspace.names.stateJson), state);
}

function loadState(kernel) {
  return fsUtil.readJson(workspace.file(kernel, workspace.names.stateJson), null);
}

function exportResult(state) {
  const kernel = state.kernel;
  const out = {
    kernel,
    status: state.status,
    final: state.final,
    analysis: state.analysis,
    baseline: state.baseline,
    ts: state.updatedAt,
  };
  const f = workspace.file(kernel, workspace.names.resultJson);
  fsUtil.writeJson(f, out);

  // append a CSV row
  const a = state.analysis || {};
  const fin = state.final || {};
  const metrics = fin.metrics || {};
  const row = {
    kernel,
    status: state.status,
    speedup_best: metrics.speedupBest != null ? metrics.speedupBest.toFixed(4) : "",
    speedup_median: metrics.speedupMedian != null ? metrics.speedupMedian.toFixed(4) : "",
    orig_min: metrics.origMin != null ? metrics.origMin.toFixed(6) : "",
    opt_min: metrics.optMin != null ? metrics.optMin.toFixed(6) : "",
    vf: metrics.vf != null ? metrics.vf : "",
    mismatches: metrics.mismatches != null ? metrics.mismatches : "",
    attempts: (state.attempts || []).length,
    obstacle: (a.obstacle || "").replace(/[\r\n,]/g, " "),
    strategy: (a.strategy || "").replace(/[\r\n,]/g, " "),
    ts: state.updatedAt || "",
  };
  const noHeader = fsUtil.exists(csvFile);
  const line = CSV_COLS.map((c) => quote(String(row[c] ?? ""))).join(",");
  fsUtil.ensureDir(path.dirname(csvFile));
  fsUtil.writeText(csvFile, (noHeader ? "" : CSV_COLS.map(quote).join(",") + "\n") + line + "\n");
  return f;
}

function quote(s) {
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

module.exports = { saveState, loadState, exportResult, csvFile };
