#!/usr/bin/env node
// UI token gate (B3e): the design layer must use the shared radius / control / numeric scale,
// and no stylesheet may add bare `px` values beyond the recorded baseline.
//   node tools/check-ui-tokens.mjs           # check (CI / verify)
//   node tools/check-ui-tokens.mjs --update  # record the current counts after a deliberate change
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const CSS_ROOTS = ["apps/web/src/styles", "packages/ui/src/styles"];
const BASELINE = "tools/ui-token-baseline.json";
const TOKENS = "packages/ui/src/styles/tokens.css";
const REQUIRED = ["--wb-radius-3xl", "--wb-radius-4xl", "--wb-size-control-xl", "--wb-font-numeric-lg", "--wb-font-numeric-feature"];
const PX = /(?<![\w-])\d+(?:\.\d+)?px/g;

const files = [];
for (const dir of CSS_ROOTS) {
  const abs = join(root, dir);
  for (const name of readdirSync(abs)) {
    if (name.endsWith(".css") && statSync(join(abs, name)).isFile()) files.push(`${dir}/${name}`);
  }
}
const counts = Object.fromEntries(
  files.map((file) => [file, (readFileSync(join(root, file), "utf8").match(PX) ?? []).length]),
);

const tokenText = readFileSync(join(root, TOKENS), "utf8");
const missing = REQUIRED.filter((token) => !tokenText.includes(`${token}:`));
const errors = [];
if (missing.length) errors.push(`missing tokens: ${missing.join(", ")}`);

if (process.argv.includes("--update")) {
  if (errors.length) {
    console.error("UI_TOKENS_FAIL", JSON.stringify({ missing }));
    process.exit(1);
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  writeFileSync(join(root, BASELINE), JSON.stringify({ schemaVersion: 1, files: counts, total }, null, 2) + "\n");
  console.log("UI_TOKENS_UPDATED", JSON.stringify({ files: files.length, total }));
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(join(root, BASELINE), "utf8"));
} catch {
  errors.push(`baseline missing: ${BASELINE} (run with --update after a deliberate change)`);
}
if (baseline) {
  for (const [file, count] of Object.entries(counts)) {
    const allowed = baseline.files?.[file];
    if (allowed === undefined) {
      if (count > 0) errors.push(`${file}: new stylesheet with ${count} bare px — use tokens or add it to the baseline deliberately`);
      continue;
    }
    if (count > allowed) errors.push(`${file}: ${count} bare px (baseline ${allowed}, +${count - allowed})`);
  }
}

const summary = {
  files: files.length,
  total: Object.values(counts).reduce((sum, count) => sum + count, 0),
  baseline: baseline?.total ?? null,
  tokens: REQUIRED.length,
};
if (errors.length) {
  console.error("UI_TOKENS_FAIL", JSON.stringify(summary));
  for (const error of errors) console.error(" -", error);
  process.exit(1);
}
console.log("UI_TOKENS_OK", JSON.stringify(summary));
