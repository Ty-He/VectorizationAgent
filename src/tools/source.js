"use strict";
// Read / modify the kernels/<kernel>.c file: manage the auto-generated <kernel>_opt block.
const compiler = require("./compiler");
const fsUtil = require("../utils/fs");

const BEGIN = "/* ====BEGIN_OPT_AUTOGEN (vectorizer agent)==== */";
const END = "/* ====END_OPT_AUTOGEN==== */";

function readKernel(kernel) {
  return fsUtil.readText(compiler.kernelFile(kernel));
}

// Remove any existing autogen block; return {text, had}.
function stripOpt(text) {
  const re = new RegExp(`\\s*${escapeRe(BEGIN)}[\\s\\S]*?${escapeRe(END)}\\s*`, "g");
  return { text: text.replace(re, "\n"), had: re.test(text) };
}

// Splice generated code into the kernel file (replacing any previous block).
function setOpt(kernel, code) {
  const orig = readKernel(kernel);
  const stripped = stripOpt(orig).text.replace(/\s*$/, "\n");
  const block = `\n\n${BEGIN}\n${code.trim()}\n${END}\n`;
  const updated = stripped + block;
  fsUtil.writeText(compiler.kernelFile(kernel), updated);
  return updated;
}

// Write current kernel file content back (used to restore pristine copy).
function writeKernel(kernel, text) {
  fsUtil.writeText(compiler.kernelFile(kernel), text);
}

// The kernel file without any opt block (a pristine "source-only" view).
function sourceOnlyText(kernel) {
  return stripOpt(readKernel(kernel)).text;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { readKernel, writeKernel, setOpt, stripOpt, sourceOnlyText, BEGIN, END };
