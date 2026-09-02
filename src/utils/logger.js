"use strict";
// Minimal leveled logger.
const LEVELS = { DEBUG: 0, INFO: 1, STEP: 1, WARN: 2, ERROR: 3, SUCCESS: 1 };
let minLevel = process.env.VECTORIZER_LOG || "info";

function enabled(lvl) {
  return LEVELS[lvl] >= LEVELS[minLevel.toUpperCase()] && !(process.env.VECTORIZER_QUIET === "1" && lvl === "STEP");
}
function out(lvl, ...args) {
  if (!enabled(lvl)) return;
  const fn = lvl === "ERROR" ? console.error : lvl === "WARN" ? console.warn : console.log;
  const prefix =
    lvl === "STEP" ? "\n=== " : lvl === "SUCCESS" ? "[ok] " : lvl === "WARN" ? "[warn] " : lvl === "ERROR" ? "[err] " : "";
  fn(prefix, ...args);
}
module.exports = {
  debug: (...a) => out("DEBUG", ...a),
  info: (...a) => out("INFO", ...a),
  step: (...a) => out("STEP", ...a),
  warn: (...a) => out("WARN", ...a),
  error: (...a) => out("ERROR", ...a),
  success: (...a) => out("SUCCESS", ...a),
};
