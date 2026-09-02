"use strict";
const { spawnSync } = require("child_process");

// Run a command synchronously and normalize the result.
function runCmd(exe, args, opts = {}) {
  const r = spawnSync(exe, args, {
    cwd: opts.cwd,
    encoding: "utf8",
    timeout: opts.timeout || 180000,
    maxBuffer: opts.maxBuffer || 64 * 1024 * 1024,
    env: opts.env,
    windowsHide: true,
  });
  const res = {
    ok: r.status === 0,
    status: r.status,
    signal: r.signal,
    stdout: (r.stdout || "").toString(),
    stderr: (r.stderr || "").toString(),
    error: r.error ? String(r.error.message || r.error) : null,
    timedOut: !!r.error && /timeout/i.test(String(r.error.message || r.error)),
  };
  return res;
}

// Collapse the tail of a string for compact diagnostics.
function tail(text, n = 2000) {
  if (!text) return "";
  const t = text.trim();
  return t.length > n ? "..." + t.slice(t.length - n) : t;
}

function head(text, n = 2000) {
  if (!text) return "";
  const t = text.trim();
  return t.length > n ? t.slice(0, n) + "..." : t;
}

module.exports = { runCmd, tail, head };
