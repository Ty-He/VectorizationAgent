"use strict";
// Stable performance measurement: run each exe several times in fresh processes,
// take best-of-N (min time) and median. speedup = origTime / optTime.
const compiler = require("./compiler");
const config = require("../config");

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Measure one kernel. Returns metrics or null if any gate failed mid-run.
function benchKernel(kernel, opts = {}) {
  const trials = opts.trials || config.BENCH_TRIALS;
  const origTimes = [];
  const optTimes = [];
  for (let i = 0; i < trials; i++) {
    const rT = compiler.run(kernel, "test");
    const jT = compiler.parseJson(rT);
    if (!rT.ok || !jT || jT.status !== "ok") return { error: "baseline run failed", run: rT, json: jT };
    origTimes.push(jT.time);

    const rO = compiler.run(kernel, "opt");
    const jO = compiler.parseJson(rO);
    if (!rO.ok || !jO || jO.status !== "ok") return { error: "opt run failed", run: rO, json: jO };
    optTimes.push(jO.time);
  }
  const origMin = Math.min(...origTimes);
  const optMin = Math.min(...optTimes);
  const origMed = median(origTimes);
  const optMed = median(optTimes);
  return {
    trials,
    origTimes,
    optTimes,
    origMin,
    optMin,
    origMedian: origMed,
    optMedian: optMed,
    speedupBest: optMin > 0 ? origMin / optMin : 0,
    speedupMedian: optMed > 0 ? origMed / optMed : 0,
  };
}

module.exports = { benchKernel, median };
