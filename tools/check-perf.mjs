#!/usr/bin/env node
// A4 性能预算门禁: static bundle budgets + lazy-loaded heavy chunks.
//
// Usage: node tools/check-perf.mjs [--dist dist] [--budget tools/perf-budget.json]
// Gate: entry JS, largest chunk, total JS, CSS, dist-electron size, and the presence of
// heavy vendor chunks outside the entry (mermaid / katex / cytoscape).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};
const ROOT = resolve(import.meta.dirname, "..");
const DIST = resolve(ROOT, arg("--dist", "dist"));
const BUDGET_FILE = resolve(ROOT, arg("--budget", "tools/perf-budget.json"));

if (!existsSync(join(DIST, "index.html"))) {
  console.error(`PERF_FAIL missing build output: ${join(DIST, "index.html")}`);
  process.exit(1);
}
const budget = JSON.parse(readFileSync(BUDGET_FILE, "utf8"));
const assets = join(DIST, "assets");
const files = readdirSync(assets);
const js = files.filter((name) => name.endsWith(".js"));
const css = files.filter((name) => name.endsWith(".css"));
const sizeOf = (dir, name) => statSync(join(dir, name)).size;
const html = readFileSync(join(DIST, "index.html"), "utf8");
const entryMatch = /<script[^>]+src="(?:\.\/)?assets\/([^"]+\.js)"/.exec(html);
if (!entryMatch) {
  console.error("PERF_FAIL cannot locate the entry script in dist/index.html");
  process.exit(1);
}
const entry = entryMatch[1];
const entryBytes = sizeOf(assets, entry);
const largest = js.reduce((best, name) => (sizeOf(assets, name) > best.bytes ? { name, bytes: sizeOf(assets, name) } : best), { name: "", bytes: 0 });
const totalJs = js.reduce((sum, name) => sum + sizeOf(assets, name), 0);
const totalCss = css.reduce((sum, name) => sum + sizeOf(assets, name), 0);
const dirSize = (dir) => readdirSync(dir).reduce((sum, name) => {
  const path = join(dir, name);
  const stat = statSync(path);
  return sum + (stat.isDirectory() ? dirSize(path) : stat.size);
}, 0);
const electronDir = join(ROOT, "dist-electron");
const electronBytes = existsSync(electronDir) ? dirSize(electronDir) : 0;

const violations = [];
const limit = (label, value, max) => {
  if (typeof max !== "number") return;
  if (value > max) violations.push(`${label}: ${value} > ${max}`);
};

limit("entryJs", entryBytes, budget.entryJs);
limit("largestJs", largest.bytes, budget.largestJs);
limit("totalJs", totalJs, budget.totalJs);
limit("css", totalCss, budget.css);
limit("distElectron", electronBytes, budget.distElectron);

// Heavy viewers must stay lazy: a chunk named after the vendor exists and is not the entry.
const missingLazy = [];
const entrySource = readFileSync(join(assets, entry), "utf8");
for (const name of budget.lazyChunks ?? []) {
  const chunk = js.find((file) => file.startsWith(`${name}-`) || file.startsWith(`${name}.`));
  if (!chunk || chunk === entry) missingLazy.push(name);
  // The entry must not statically embed the vendor payload; it may only name the dynamic import.
  if (entrySource.includes(`${name}/dist`) || entrySource.includes(`node_modules/${name}`)) missingLazy.push(`${name}:static-import`);
}

const result = {
  entry: { name: entry, bytes: entryBytes },
  largest,
  totalJs,
  css: totalCss,
  distElectron: electronBytes,
  lazyChunks: budget.lazyChunks ?? [],
  missingLazy,
  budget,
};
console.log(JSON.stringify(result));
if (missingLazy.length) violations.push(`lazyChunks: ${missingLazy.join(", ")}`);
if (violations.length) {
  console.error(`PERF_FAIL\n  ${violations.join("\n  ")}`);
  process.exit(1);
}
console.log("PERF_OK");
