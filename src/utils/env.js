"use strict";
// Minimal .env loader (zero-dep). Loads <root>/.env into process.env if present.
// Does not override keys already set in the environment.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

function load(envFile) {
  const file = envFile || path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}

module.exports = { load, ROOT };
