"use strict";
// CLI entry:  node src/cli.js <kernel|all> [options]
const config = require("./config");
const logger = require("./utils/logger");
const { optimize } = require("./agent/driver");

function usage() {
  console.log(`vectorizer - automatic loop-vectorization optimization agent

usage:
  node src/cli.js <kernel|all> [options]

kernels: ${config.KERNELS.join(", ")}

options:
  --force             re-run even if a result already exists
  --tries <n>         max generation/validation attempts (default ${config.MAX_TRIES})
  --threshold <x>     required speedup (default ${config.THRESHOLD})
  --bench <n>         benchmark trials per kernel (default ${config.BENCH_TRIALS})
  --retain-nogain     accept correct+vectorized even if speedup < threshold, mark no-gain
  --routes <a,b,c>    force route order (rewrite,pragma,intrinsic); default: from analyze
  --no-reflect        skip the LLM reflection step on failed attempts
  --quiet             less progress output
`);
}

/**
 * @param {string[]} args - command args
 * @author ty
 * override default config(in config.js)
 */
function applyOverrides(args) {
  const take = (i) => {
    const v = args[i + 1];
    if (v === undefined) throw new Error("missing value for " + args[i]);
    return v;
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--tries") config.MAX_TRIES = parseInt(take(i), 10) || config.MAX_TRIES;
    else if (a === "--threshold") config.THRESHOLD = parseFloat(take(i)) || config.THRESHOLD;
    else if (a === "--bench") config.BENCH_TRIALS = parseInt(take(i), 10) || config.BENCH_TRIALS;
    else if (a === "--retain-nogain") config.RETAIN_NOGAIN = true;
    else if (a === "--routes") config.FORCE_ROUTES = take(i).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const positionals = args.filter((a) => !a.startsWith("--"));
  const target = positionals[0];
  const opts = {
    force: args.includes("--force"),
    reflect: !args.includes("--no-reflect"),
  };
  if (args.includes("--quiet")) process.env.VECTORIZER_QUIET = "1";

  if (!target) {
    usage();
    process.exit(2);
  }
  applyOverrides(args);

  /**
   * @param {string} k - kernel name
   * @author ty
   */
  const run = async (k) => {
    logger.info(`==== optimizing ${k} ====`);
    return await optimize(k, opts);
  };

  try {
    if (target === "all") {
      const results = [];
      for (const k of config.KERNELS) {
        try {
          results.push(await run(k));
        } catch (e) {
          logger.error(`[${k}] ${e.message}`);
          results.push({ kernel: k, status: "error" });
        }
      }
      const ok = results.filter((r) => r.status === "ok" || r.status === "ok-nogain").length;
      logger.info(`\nsummary: ${ok}/${results.length} optimized. See experiments/results.csv`);
      process.exit(ok === results.length ? 0 : 1);
    } else if (config.KERNELS.includes(target)) {
      const r = await run(target);
      process.exit(r.status === "ok" || r.status === "ok-nogain" ? 0 : 1);
    } else {
      logger.error(`unknown kernel '${target}'. expected one of ${config.KERNELS.join(", ")} or 'all'`);
      process.exit(2);
    }
  } catch (e) {
    logger.error(e.message);
    process.exit(1);
  }
}

main();
