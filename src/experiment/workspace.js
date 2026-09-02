"use strict";
// Paths for per-kernel experiment workspace under <root>/experiments/<kernel>.
const path = require("path");
const fsUtil = require("../utils/fs");
const config = require("../config");

function dir(kernel) {
  return path.join(config.ROOT, "experiments", kernel);
}
function ensureDir(kernel) {
  fsUtil.ensureDir(dir(kernel));
  return dir(kernel);
}
function file(kernel, name) {
  return path.join(ensureDir(kernel), name);
}
// canonical artifacts
const names = {
  stateJson: "state.json",
  resultJson: "result.json",
  origRemarkYaml: "diag_orig.opt.yaml",
  optRemarkYaml: "diag_opt.opt.yaml",
  attemptCode: (n) => `attempt_${n}.c`,
  candidateCode: "candidate.c",
  backupOrig: "kernels_orig.c", // snapshot of pristine kernel file
  runLog: "driver.log",
};

module.exports = { dir, ensureDir, file, names };
