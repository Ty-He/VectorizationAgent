"use strict";
const fs = require("fs");
const path = require("path");
const config = require("../config");

const ROOT = config.ROOT;

function exists(p) {
  return fs.existsSync(p);
}
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}
function readText(p) {
  return fs.readFileSync(p, "utf8");
}
function writeText(p, text) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, text, "utf8");
}
function readJson(p, dflt = null) {
  if (!exists(p)) return dflt;
  try { return JSON.parse(readText(p)); } catch { return dflt; }
}
function writeJson(p, obj) {
  writeText(p, JSON.stringify(obj, null, 2));
}
function rmIfExists(p) {
  if (exists(p)) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }
}
function rel(p) {
  return path.relative(ROOT, p);
}

module.exports = { ROOT, exists, ensureDir, readText, writeText, readJson, writeJson, rmIfExists, rel };
