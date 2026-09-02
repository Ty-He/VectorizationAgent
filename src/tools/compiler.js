"use strict";
// Deterministic tool: drive clang to build/run vec-lab single-kernel entries.
const path = require("path");
const config = require("../config");
const { runCmd } = require("../utils/process");
const fsUtil = require("../utils/fs");

const VEC = config.VEC_LAB;

function exePath(kernel, variant) {
  return path.join(VEC, `${kernel}_${variant}.exe`);
}
function kernelFile(kernel) {
  return path.join(VEC, "kernels", `${kernel}.c`);
}
function upper(kernel) {
  return kernel.toUpperCase();
}

function baseArgs() {
  return [...config.BASE_FLAGS, `-DTYPE=${config.TYPE}`, "-I."];
}

function diagArgs(yamlFile) {
  return [
    "-fsave-optimization-record",
    `-foptimization-record-file=${yamlFile}`,
    "-Rpass=loop-vectorize",
    "-Rpass-missed=loop-vectorize",
    "-Rpass-analysis=loop-vectorize",
  ];
}

function entrySources(kernel, variant) {
  return [`entry/${kernel}_${variant}.c`, "common.c", `kernels/${kernel}.c`];
}

// Build a single-kernel exe. variant: "test" (orig baseline) | "opt" (needs HAVE).
// When optCodePresent is true (real <kernel>_opt defined in the kernel file), opt
// builds MUST pass -DHAVE_<UPPER>_OPT or the placeholder would collide at link time.
function build(kernel, variant, opts = {}) {
  const args = [...baseArgs()];
  if (variant === "opt" && opts.optCodePresent !== false) {
    args.push(`-DHAVE_${upper(kernel)}_OPT`);
  }
  if (opts.diagFile) {
    args.push(...diagArgs(opts.diagFile));
  }
  args.push(...entrySources(kernel, variant), "-o", exePath(kernel, variant));
  return runCmd(config.CLANG, args, { cwd: VEC, timeout: opts.timeout || 180000 });
}

function run(kernel, variant, opts = {}) {
  return runCmd(exePath(kernel, variant), [], { cwd: VEC, timeout: opts.timeout || 120000 });
}

// Parse the single-line JSON the entry emits on stdout.
function parseJson(runResult) {
  try {
    return JSON.parse(runResult.stdout.trim());
  } catch {
    return null;
  }
}

module.exports = {
  VEC,
  exePath,
  kernelFile,
  upper,
  baseArgs,
  build,
  run,
  parseJson,
};
