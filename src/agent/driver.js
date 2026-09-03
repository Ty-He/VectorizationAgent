"use strict";
// Vectorization agent driver: fixed-stage pipeline orchestrating LLM + deterministic tools.
const crypto = require("crypto");
const path = require("path");
const config = require("../config");
const logger = require("../utils/logger");
const fsUtil = require("../utils/fs");
const compiler = require("../tools/compiler");
const remarks = require("../tools/remarks");
const benchmark = require("../tools/benchmark");
const sourceTool = require("../tools/source");
const validation = require("../tools/validation");
const schemas = require("../llm/schemas");
const llmClient = require("../llm/client");
const prompts = require("../llm/prompts");
const workspace = require("../experiment/workspace");
const resultStore = require("../experiment/result");
const experienceStore = require("../memory/experienceStore");

function optFn(kernel) {
  return `${kernel}_opt`;
}
function origFn(kernel) {
  return `${kernel}_orig`;
}

/**
 * @param {function} build - build prompt for llm
 * @param {function} check - check the json responsed by llm
 * @param {object} [chatOpts] - extra options passed to llmClient.chat (budget/escalate/attempts)
 * request llm for analysis
 */
async function callJson(build, check, chatOpts = {}) {
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    try {
      const p = build();
      const { content } = await llmClient.chat({ system: p.system, user: p.user, jsonMode: true, ...chatOpts });
      const obj = schemas.extractJson(content);
      if (check) check(obj);
      return obj;
    } catch (e) {
      lastErr = e;
      logger.warn(`json LLM call attempt ${i + 1} failed: ${e.message}`);
    }
  }
  throw lastErr || new Error("callJson failed");
}

/**
 * @param {string} kernel - kernel name
 * @param {object} vars - context include analysis, experience, feedback
 * request llm to generate code that compiler could optimize it easily
 */
async function generateCode(kernel, vars, temperature) {
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    try {
      const p = prompts.buildGenerate(vars);
      const { content } = await llmClient.chat({ system: p.system, user: p.user, temperature });
      const code = schemas.extractCodeBlock(content);
      schemas.assertHasFunction(code, optFn(kernel));
      return code;
    } catch (e) {
      lastErr = e;
      logger.warn(`codegen attempt ${i + 1} failed: ${e.message}`);
    }
  }
  throw lastErr || new Error("codegen failed");
}

function hashText(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

// Normalize the analyze output's recommended_routes into the allowed route set.
// 'hybrid' is generated through the intrinsic-style template in this implementation.
function normalizeRoutes(list) {
  const out = [];
  const seen = new Set();
  if (Array.isArray(list)) {
    for (const r of list) {
      const key = r === "hybrid" ? "intrinsic" : r;
      if (config.ROUTES.includes(key) && !seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    }
  }
  if (!out.length) out.push("rewrite");
  return out;
}

// Build a deterministic route schedule across MAX_TRIES attempts. The FIRST route (the
// recommended/preferred one, usually "rewrite") is tried first and keeps ALL attempts not spent
// on fallbacks; each subsequent (fallback) route gets at most ROUTE_SWITCH_TRIES attempts.
// Example: tries=6, routes=[rewrite,pragma,intrinsic], switchTries=1 -> rewrite,rewrite,rewrite,
// rewrite,pragma,intrinsic. This avoids starving the route that empirically wins most kernels.
function buildRouteSchedule(routes, maxTries, fallbackTries) {
  const fb = Math.max(1, fallbackTries);
  const counts = new Array(routes.length).fill(0);
  let remaining = maxTries;
  for (let i = 1; i < routes.length && remaining > 0; i++) {
    const give = Math.min(fb, remaining);
    counts[i] = give;
    remaining -= give;
  }
  counts[0] += remaining; // remainder goes to the preferred (first) route
  const schedule = [];
  for (let i = 0; i < routes.length; i++) {
    for (let k = 0; k < counts[i]; k++) schedule.push(routes[i]);
  }
  return schedule;
}

// Reflect on a failed attempt, then return the note string to append to feedback history.
// Never silently drops the round: if the LLM produced nothing, say so explicitly so the
// generator knows this round was NOT steered.
async function reflectNote(kernel, analysis, currentSource, feedback, n) {
  const rt = await runReflect(kernel, analysis, currentSource, feedback, n);
  if (rt) return `REFLECT(attempt ${n}):\n${rt}`;
  return `REFLECT(attempt ${n}): UNAVAILABLE -- the LLM returned no usable guidance this round; revise the code yourself from the gate diagnostics above.`;
}

/**
 * @param {string} kernel - kernel name, such as s453
 * @param {object} see cli.js>main()>opt
 * @author ty
 */
async function optimize(kernel, opts = {}) {
  const force = !!opts.force;
  const reflect = opts.reflect !== false;

  // Already finished? short-circuit unless forced.
  const existing = resultStore.loadState(kernel);
  if (existing && (existing.status === "ok" || existing.status === "ok-nogain" || existing.status === "failed") && !force) {
    logger.info(`kernel ${kernel} already finished (${existing.status}); use --force to re-run.`);
    return existing;
  }
  if (existing && existing.status === "running" && !force) {
    logger.warn(`previous run of ${kernel} left a 'running' state; use --force to restart.`);
  }

  logger.step(`[${kernel}] workspace prep`);
  workspace.ensureDir(kernel);
  // ty: pristine: 原始的，备份 vec-lab\kernels 下原始内容
  const pristine = sourceTool.readKernel(kernel);
  fsUtil.writeText(workspace.file(kernel, workspace.names.backupOrig), pristine);

  // ty: see /experiments/<kernel_name>/state.json
  const state = {
    kernel,
    status: "running",
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    baseline: null,
    analysis: null,
    attempts: [],
    final: null,
  };
  resultStore.saveState(state);

  try {
    /* ---------------- baseline ---------------- */
    logger.step(`[${kernel}] baseline: build orig + remarks + run`);
    // ty: the yaml file generated by `-fsave-optimization-record`
    const diagFile = workspace.file(kernel, workspace.names.origRemarkYaml);
    const b = compiler.build(kernel, "test", { diagFile });
    if (!b.ok) {
      throw new Error("baseline compile failed:\n" + (b.stderr || b.error).slice(-1500));
    }
    const records = remarks.parseRecordFile(diagFile);
    // ty: 过滤出目标函数相关的优化记录，因为`-fsave-optimization-record`会连同测试代码框架一同产生
    const recsOrig = remarks.filterRecords(records, { function: origFn(kernel) });
    const origInfo = remarks.vectorizeInfo(records, origFn(kernel));
    const sum = remarks.summarize(recsOrig, 60);
    const run = compiler.run(kernel, "test");
    const baseJson = compiler.parseJson(run);
    if (!baseJson || baseJson.status !== "ok") {
      throw new Error("baseline run failed: " + (run.stderr || run.stdout || "").slice(-800));
    }
    state.baseline = {
      checksum: baseJson.checksum,
      time: baseJson.time,
      origVectorized: origInfo.vectorized,
      origMissedText: origInfo.sampleMissedText,
      remarkSummary: sum.text,
      remarkTotal: sum.total,
    };
    logger.info(`orig vectorized=${origInfo.vectorized} missed=${!!origInfo.sampleMissedText} checksum=${baseJson.checksum} time=${baseJson.time.toFixed(5)}s`);

    /* ---------------- analysis ---------------- */
    logger.step(`[${kernel}] LLM analyze`);
    const sourceText = sourceTool.sourceOnlyText(kernel);
    const analysis = await callJson(
      () =>
        prompts.buildAnalyze({
          kernel,
          source: sourceText,
          remarks: sum.text || "(no loop-vectorize remarks)",
        }),
      (o) => schemas.required(o, ["obstacle", "strategy", "transform_plan", "obstacle_kind"], "analyze")
    );
    analysis.vectorizable = analysis.vectorizable !== false;
    state.analysis = analysis;
    logger.info(`strategy: ${analysis.strategy}  (vectorizable=${analysis.vectorizable})`);

    // candidate-diversity route schedule (default: rewrite all the way if model says nothing)
    const routes = normalizeRoutes(config.FORCE_ROUTES.length ? config.FORCE_ROUTES : analysis.recommended_routes);
    const routeSchedule = buildRouteSchedule(routes, config.MAX_TRIES, config.ROUTE_SWITCH_TRIES);
    state.routes = {
      recommended: analysis.recommended_routes || [],
      normalized: routes,
      schedule: routeSchedule,
    };
    logger.info(`routes: ${routes.join(" -> ")}  schedule=${routeSchedule.join(",")}`);

    /* ---------------- attempt loop ---------------- */
    let feedbackHistory = [];
    let lastCode = "";
    const attemptHashes = [];
    let bestNoGain = null; // best correct+vectorized candidate below THRESHOLD (RETAIN_NOGAIN mode)

    for (let n = 1; n <= config.MAX_TRIES; n++) {
      const route = routeSchedule[n - 1];
      logger.step(`[${kernel}] attempt ${n}/${config.MAX_TRIES} (route: ${route})`);
      const related = experienceStore.findRelated(kernel, analysis);
      const baseFeedback = feedbackHistory.length ? feedbackHistory.join("\n\n") : "(none - first try)";
      const genVars = {
        kernel,
        kernel_upper: compiler.upper(kernel),
        route,
        source: sourceText,
        remarks: (state.baseline && state.baseline.remarkSummary) || "(no loop-vectorize remarks)",
        analysis: JSON.stringify(analysis, null, 2),
        feedback: baseFeedback,
        last_attempt: lastCode ? `\`\`\`c\n${lastCode}\n\`\`\`` : "(none - write from scratch)",
        experience: experienceStore.formatExperiences(related),
      };

      // Generate code, re-prompting when the model reproduces a previous byte-identical
      // attempt (that is a sign it ignored the feedback and would just loop forever).
      let code = null;
      let codeHash = null;
      let dupRetries = 0;
      for (;;) {
        try {
          const temperature = 0.2 + 0.3 * dupRetries;
          code = await generateCode(kernel, genVars, temperature);
        } catch (e) {
          logger.error(`codegen malformed: ${e.message}`);
          feedbackHistory.push(`attempt ${n}: GENERATE FAILED -- ${e.message}`);
          code = null;
          break;
        }
        codeHash = hashText(code);
        if (attemptHashes.includes(codeHash) && dupRetries < 2) {
          dupRetries++;
          genVars.feedback =
            baseFeedback +
            `\n\nWARNING: the code you just produced is byte-identical to a previous failed attempt. ` +
            `That attempt was rejected; do NOT resubmit it. Produce a structurally DIFFERENT implementation ` +
            `that addresses the failure diagnostics.`;
          logger.warn(`code identical to a previous attempt; re-prompting for a novel version (${dupRetries}/2)`);
          continue;
        }
        break;
      }
      if (!code) continue;
      lastCode = code;
      attemptHashes.push(codeHash);
      fsUtil.writeText(workspace.file(kernel, workspace.names.attemptCode(n)), code);
      // keep per-route candidate copies for audit / later comparison
      const candDir = path.join(workspace.dir(kernel), "candidates");
      fsUtil.ensureDir(candDir);
      const candName = `${route}_${n}.c`;
      fsUtil.writeText(path.join(candDir, candName), code);

      // splice into kernel file
      sourceTool.setOpt(kernel, code);

      const attempt = {
        n,
        route,
        codeFile: workspace.names.attemptCode(n),
        candidateFile: candName,
        codeHash,
        gates: [],
        feedback: "",
      };
      state.attempts.push(attempt);
      state.updatedAt = new Date().toISOString();
      resultStore.saveState(state);

      // four gate, if fail on anyone, continue or reflect

      /* gate 1: compile */
      logger.info(`compile opt ...`);
      const cRes = compiler.build(kernel, "opt");
      attempt.compile = { ok: cRes.ok, err: cRes.ok ? "" : (cRes.stderr || cRes.error || "").slice(-1200) };
      if (!cRes.ok) {
        attempt.outcome = "compile-fail";
        attempt.feedback = `attempt ${n} outcome: COMPILE ERROR\n${attempt.compile.err}`;
        feedbackHistory.push(attempt.feedback);
        logger.warn(`compile failed (${cRes.stderr.split("\n").slice(0, 2).join(" | ")})`);
        continue;
      }

      /* gate 2: run + correctness */
      logger.info(`run opt ...`);
      const rRes = compiler.run(kernel, "opt");
      const jRes = compiler.parseJson(rRes);
      attempt.runJson = jRes;
      const runGateOk = jRes && jRes.status === "ok" && jRes.mismatches === 0;
      if (!runGateOk) {
        const fb = validation.feedbackForLLM({
          compile: cRes,
          runJson: jRes,
          note: rRes.ok ? "" : (rRes.stderr || rRes.error || "").slice(-400),
        });
        attempt.outcome = jRes && jRes.status === "not_implemented" ? "not-implemented" : "correctness-fail";
        attempt.feedback = `attempt ${n} outcome: ${attempt.outcome}\n${fb}`;
        feedbackHistory.push(attempt.feedback);
        if (reflect) feedbackHistory.push(await reflectNote(kernel, analysis, sourceTool.readKernel(kernel), attempt.feedback, n));
        logger.warn(`correctness gate failed (mismatches=${jRes ? jRes.mismatches : "n/a"})`);
        continue;
      }

      /* gate 3: vectorized? */
      logger.info(`check vectorization remark ...`);
      const optDiag = workspace.file(kernel, workspace.names.optRemarkYaml);
      const dRes = compiler.build(kernel, "opt", { diagFile: optDiag });
      const optRecords = dRes.ok ? remarks.parseRecordFile(optDiag) : [];
      const vecInfo = remarks.vectorizeInfo(optRecords, optFn(kernel));
      attempt.vectorized = {
        ok: vecInfo.vectorized,
        width: vecInfo.width,
        missedText: vecInfo.sampleMissedText,
        failed: vecInfo.failed,
      };
      if (!vecInfo.vectorized) {
        const fb = validation.feedbackForLLM({
          compile: cRes,
          runJson: jRes,
          vectorized: { ok: false, fn: optFn(kernel), sampleMissedText: vecInfo.sampleMissedText },
        });
        attempt.outcome = "not-vectorized";
        attempt.feedback = `attempt ${n} outcome: not-vectorized\n${fb}`;
        feedbackHistory.push(attempt.feedback);
        if (reflect) feedbackHistory.push(await reflectNote(kernel, analysis, sourceTool.readKernel(kernel), attempt.feedback, n));
        logger.warn(`not vectorized (${vecInfo.sampleMissedText || "no missed detail"})`);
        continue;
      }
      logger.info(`vectorized width=${vecInfo.width}`);

      /* gate 4: benchmark speedup */
      logger.info(`benchmark (${config.BENCH_TRIALS} trials) ...`);
      const bench = benchmark.benchKernel(kernel);
      attempt.bench = bench;
      if (bench.error) {
        attempt.outcome = "bench-error";
        attempt.feedback = `attempt ${n} outcome: benchmark error ${bench.error}`;
        feedbackHistory.push(attempt.feedback);
        logger.warn(`benchmark error: ${bench.error}`);
        continue;
      }
      const verdict = validation.evaluate({ compile: cRes, runJson: jRes, vectorized: { ok: true, width: vecInfo.width }, bench });
      attempt.verdict = verdict;
      logger.info(
        `speedup best=${bench.speedupBest.toFixed(3)} med=${bench.speedupMedian.toFixed(3)} ` +
          `(origMin=${bench.origMin.toFixed(5)} optMin=${bench.optMin.toFixed(5)})`
      );

      const speedOk = bench.speedupBest >= config.THRESHOLD;
      if (speedOk) {
        /* ---------------- success (meets speed target) ---------------- */
        state.status = "ok";
        state.final = {
          attempt: n,
          routeUsed: attempt.route,
          metrics: {
            ...verdict.metrics,
            origMin: bench.origMin,
            optMin: bench.optMin,
          },
          checksum: jRes.checksum,
          checksumOrig: jRes.checksum_orig,
        };
        state.updatedAt = new Date().toISOString();
        resultStore.saveState(state);
        resultStore.exportResult(state);
        experienceStore.addExperience({
          kernel,
          kind: "success",
          category: analysis.category,
          obstacle_kind: analysis.obstacle_kind,
          obstacle: analysis.obstacle,
          strategy: analysis.strategy,
          transform_plan: analysis.transform_plan,
          pitfalls: analysis.risk_notes || "",
          result: { ok: true, speedupBest: bench.speedupBest, speedupMedian: bench.speedupMedian, vf: vecInfo.width },
          codeFile: workspace.file(kernel, workspace.names.attemptCode(n)),
        });
        logger.success(`[${kernel}] OPTIMIZED: correct + vectorized(vf=${vecInfo.width}) + speedup ${bench.speedupBest.toFixed(3)}x`);
        return state;
      }

      // Below threshold. In no-gain mode keep exploring the remaining routes and remember the best
      // correct+vectorized candidate (finalize at budget end); otherwise it is a plain "too slow".
      if (config.RETAIN_NOGAIN) {
        if (!bestNoGain || bench.speedupBest > bestNoGain.bench.speedupBest) {
          bestNoGain = { attempt, bench, vf: vecInfo.width, runJson: jRes };
        }
        attempt.outcome = "too-slow";
        attempt.noGainCandidate = true;
        logger.warn(
          `no-gain candidate: correct + vectorized(vf=${vecInfo.width}) but speedup ` +
            `${bench.speedupBest.toFixed(3)}x < ${config.THRESHOLD}; keep trying remaining routes`
        );
        continue;
      }

      /* too slow */
      const fb = validation.feedbackForLLM({ compile: cRes, runJson: jRes, bench });
      attempt.outcome = "too-slow";
      attempt.feedback = `attempt ${n} outcome: too-slow\n${fb}`;
      feedbackHistory.push(attempt.feedback);
      if (reflect) feedbackHistory.push(await reflectNote(kernel, analysis, sourceTool.readKernel(kernel), attempt.feedback, n));
      logger.warn(`too slow (need >= ${config.THRESHOLD})`);
    }

    /* ---------------- budget exhausted ---------------- */
    if (config.RETAIN_NOGAIN && bestNoGain) {
      // Splice the best correct+vectorized (no-gain) candidate back in and retain it as ok-nogain.
      const bg = bestNoGain;
      const bgCode = fsUtil.readText(workspace.file(kernel, bg.attempt.codeFile));
      sourceTool.setOpt(kernel, bgCode);
      state.status = "ok-nogain";
      state.final = {
        attempt: bg.attempt.n,
        routeUsed: bg.attempt.route,
        noGain: true,
        metrics: {
          speedupBest: bg.bench.speedupBest,
          speedupMedian: bg.bench.speedupMedian,
          vf: bg.vf,
          mismatches: bg.runJson ? bg.runJson.mismatches : null,
          origMin: bg.bench.origMin,
          optMin: bg.bench.optMin,
        },
        checksum: bg.runJson ? bg.runJson.checksum : null,
        checksumOrig: bg.runJson ? bg.runJson.checksum_orig : null,
      };
      state.updatedAt = new Date().toISOString();
      resultStore.saveState(state);
      resultStore.exportResult(state);
      experienceStore.addExperience({
        kernel,
        kind: "no-gain",
        category: analysis.category,
        obstacle_kind: analysis.obstacle_kind,
        obstacle: analysis.obstacle,
        strategy: analysis.strategy,
        transform_plan: analysis.transform_plan,
        pitfalls:
          `best correct+vectorized attempt ${bg.attempt.n} (route ${bg.attempt.route}) only reached ` +
          `speedup ${bg.bench.speedupBest.toFixed(3)} (< ${config.THRESHOLD}); retained as no-gain. ${analysis.risk_notes || ""}`,
        result: {
          ok: true,
          noGain: true,
          speedupBest: bg.bench.speedupBest,
          speedupMedian: bg.bench.speedupMedian,
          vf: bg.vf,
        },
        codeFile: workspace.file(kernel, bg.attempt.codeFile),
      });
      logger.success(
        `[${kernel}] RETAINED(NO-GAIN): best correct+vectorized(vf=${bg.vf}) at speedup ` +
          `${bg.bench.speedupBest.toFixed(3)}x (route ${bg.attempt.route})`
      );
      return state;
    }

    logger.step(`[${kernel}] budget exhausted, restoring pristine kernel source`);
    sourceTool.writeKernel(kernel, pristine); // do not ship a sub-par opt in kernels/
    const best = state.attempts.find((a) => a.verdict && a.verdict.reasons.length === 1) || state.attempts[state.attempts.length - 1] || null;
    state.status = "failed";
    state.final = {
      attempt: best ? best.n : 0,
      metrics: best && best.bench && best.bench.speedupBest
        ? {
            speedupBest: best.bench.speedupBest,
            speedupMedian: best.bench.speedupMedian,
            vf: best.vectorized && best.vectorized.width,
            mismatches: best.runJson ? best.runJson.mismatches : null,
          }
        : {},
      bestOutcome: best ? best.outcome : "no-attempt",
    };
    state.updatedAt = new Date().toISOString();
    resultStore.saveState(state);
    resultStore.exportResult(state);
    if (best && best.vectorized && best.vectorized.ok) {
      experienceStore.addExperience({
        kernel,
        kind: "failure",
        category: analysis.category,
        obstacle_kind: analysis.obstacle_kind,
        obstacle: analysis.obstacle,
        strategy: analysis.strategy,
        transform_plan: analysis.transform_plan,
        pitfalls: `best correct+vectorized attempt ${best.n} only reached speedup ${(best.bench && best.bench.speedupBest).toFixed(2)} (< ${config.THRESHOLD})`,
        result: { ok: false, speedupBest: best.bench && best.bench.speedupBest, vf: best.vectorized && best.vectorized.width },
        codeFile: best.codeFile ? workspace.file(kernel, best.codeFile) : "",
      });
    }
    logger.error(`[${kernel}] FAILED after ${config.MAX_TRIES} attempts. See experiments/${kernel}/ for details.`);
    return state;
  } catch (e) {
    state.status = "error";
    state.error = e.message;
    state.updatedAt = new Date().toISOString();
    resultStore.saveState(state);
    logger.error(`[${kernel}] driver error: ${e.message}`);
    throw e;
  }
}

// Reflect on a failed attempt -> returns a compact structured "fix" note string (or null).
// Advisory only: give it a small fixed budget and fail fast rather than burning tokens when the
// model over-produces. Failure degrades to an explicit "UNAVAILABLE" note (see reflectNote).
async function runReflect(kernel, analysis, currentSource, feedback, n) {
  try {
    const obj = await callJson(
      () =>
        prompts.buildReflect({
          kernel,
          threshold: String(config.THRESHOLD),
          source: currentSource,
          analysis: JSON.stringify(analysis, null, 2),
          feedback,
        }),
      (o) => schemas.required(o, ["root_cause", "next_action", "concrete_fixes"], "reflect"),
      { maxTokens: 1600, maxAttempts: 1, escalate: false }
    );
    const fixes = Array.isArray(obj.concrete_fixes) ? obj.concrete_fixes.join(" | ") : String(obj.concrete_fixes || "");
    return `root_cause=${obj.root_cause}\nnext_action=${obj.next_action}\nfixes: ${fixes}`;
  } catch (e) {
    logger.warn(`reflect LLM failed (bounded): ${e.message}`);
    return null;
  }
}

module.exports = { optimize };
