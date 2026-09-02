"use strict";
// M0 smoke test: build & run the 10 vec-lab kernels' baseline.
// For each kernel verify:
//   1) <k>_test.exe compiles and runs   -> status ok
//   2) <k>_opt.exe (without HAVE) is the placeholder -> status not_implemented
//   3) clang remark on orig: no loop-vectorize "Passed/Vectorized" record for the orig function
// Prints a summary table. Exit code 0 = all hard checks passed.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const config = require("../src/config");

const VEC = config.VEC_LAB;
const { CLANG, TYPE, KERNELS } = config;
const FLAGS = [...config.BASE_FLAGS, `-DTYPE=${TYPE}`, "-I."];

function run(exe, args, opts = {}) {
  return spawnSync(exe, args, { cwd: opts.cwd || VEC, encoding: "utf8", timeout: 60000 });
}

function parseJson(text) {
  try { return JSON.parse(text.trim()); } catch { return null; }
}

// --- minimal text-scan of clang optimization-record yaml (no yaml dep) ---
function remarkRecords(yamlText) {
  const blocks = [];
  let cur = [];
  for (const line of yamlText.split(/\r?\n/)) {
    if (/^--- /.test(line)) { if (cur.length) blocks.push(cur); cur = [line]; }
    else if (/^\.\.\.\s*$/.test(line)) { if (cur.length) blocks.push(cur); cur = []; }
    else cur.push(line);
  }
  if (cur.length) blocks.push(cur);
  const field = (lines, name) => {
    const l = lines.find((x) => x.startsWith(name + ":"));
    return l ? l.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, "") : undefined;
  };
  return blocks.map((lines) => ({
    tag: (lines[0] || "").replace(/^--- /, ""),
    pass: field(lines, "Pass"),
    name: field(lines, "Name"),
    function: field(lines, "Function"),
    file: field(lines, "File"),
  }));
}

async function main() {
  const report = [];
  let hardFail = 0;

  for (const k of KERNELS) {
    const row = { kernel: k, compile: "ok", origRun: "ok", placeholder: "ok", remark: "ok" };
    try {
      // 1) baseline test entry
      let r = run(CLANG, [...FLAGS, `entry/${k}_test.c`, "common.c", `kernels/${k}.c`, "-o", `${k}_test.exe`]);
      if (r.status !== 0) throw new Error("compile test failed: " + (r.stderr || "").slice(0, 400));
      r = run(path.join(VEC, `${k}_test.exe`));
      const j = parseJson(r.stdout);
      if (!j || j.status !== "ok") throw new Error("orig run bad: " + r.stdout.trim().slice(0, 200));

      // 2) opt entry: placeholder when not implemented, real opt otherwise
      r = run(CLANG, [...FLAGS, `entry/${k}_opt.c`, "common.c", `kernels/${k}.c`, "-o", `${k}_opt.exe`]);
      if (r.status === 0) {
        // no real opt present -> placeholder expected
        r = run(path.join(VEC, `${k}_opt.exe`));
        const jo = parseJson(r.stdout);
        if (!jo || jo.status !== "not_implemented") throw new Error("placeholder not detected: " + r.stdout.trim().slice(0, 200));
        row.placeholder = "not_impl";
      } else {
        // kernels/<k>.c already defines <k>_opt -> rebuild with HAVE and expect ok
        r = run(CLANG, [...FLAGS, `-DHAVE_${k.toUpperCase()}_OPT`,
          `entry/${k}_opt.c`, "common.c", `kernels/${k}.c`, "-o", `${k}_opt.exe`]);
        if (r.status !== 0) throw new Error("compile opt(HAVE) failed: " + (r.stderr || "").slice(0, 400));
        r = run(path.join(VEC, `${k}_opt.exe`));
        const jo = parseJson(r.stdout);
        if (!jo || jo.status !== "ok") throw new Error("opt(HAVE) run not ok: " + r.stdout.trim().slice(0, 200));
        row.placeholder = "opt";
      }

      // 3) remark on orig
      const yamlName = `${k}_smoke.opt.yaml`;
      r = run(CLANG, [...FLAGS,
        "-fsave-optimization-record", `-foptimization-record-file=${yamlName}`,
        "-Rpass=loop-vectorize", "-Rpass-missed=loop-vectorize", "-Rpass-analysis=loop-vectorize",
        `entry/${k}_test.c`, "common.c", `kernels/${k}.c`, "-o", `${k}_test.exe`]);
      const yamlPath = path.join(VEC, yamlName);
      if (r.status !== 0) { row.remark = "warn(no-yaml)"; }
      else {
        const recs = remarkRecords(fs.readFileSync(yamlPath, "utf8"));
        const inOrig = recs.filter((x) => x.function && x.function.includes(k + "_orig") && x.pass === "loop-vectorize");
        const vectorized = inOrig.filter((x) => x.tag === "!Passed" && x.name === "Vectorized");
        const missed = inOrig.filter((x) => x.tag === "!Missed" || x.tag === "!Analysis");
        if (vectorized.length > 0) { row.remark = "FAIL(vectorized!" + vectorized.length + ")"; hardFail++; }
        else if (missed.length === 0) { row.remark = "warn(no-lv-records)"; }
        fs.unlinkSync(yamlPath);
      }
    } catch (e) {
      row.err = e.message;
      row.compile = row.origRun = row.placeholder = "FAIL";
      hardFail++;
    }
    report.push(row);
    console.log(
      `${k.padEnd(6)} test_compile=${row.compile.padEnd(4)} orig=${row.origRun.padEnd(4)} ` +
      `placeholder=${row.placeholder.padEnd(4)} remark=${row.remark}${row.err ? " :: " + row.err : ""}`
    );
  }

  console.log(`\n${KERNELS.length} kernels, hard failures = ${hardFail}`);
  process.exit(hardFail ? 1 : 0);
}

main();
