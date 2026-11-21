#!/usr/bin/env node
// B5: docs gate — required user docs exist, relative links resolve, tables are well formed.
//
// Usage: node tools/check-docs.mjs
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const REQUIRED = ["docs/user-guide.md", "docs/faq.md", "docs/troubleshooting.md", "docs/privacy.md", "docs/release-notes.md"];
const problems = [];
let headings = 0;
let links = 0;
let tables = 0;

for (const rel of REQUIRED) {
  const path = join(ROOT, rel);
  if (!existsSync(path)) {
    problems.push(`${rel}: missing`);
    continue;
  }
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  if (!lines.some((line) => /^# \S/.test(line))) problems.push(`${rel}: no H1`);
  headings += lines.filter((line) => /^#{1,6} \S/.test(line)).length;

  // Relative markdown links must resolve on disk.
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:|#)/i.test(target)) continue;
    links += 1;
    const [file] = target.split("#");
    if (!file) continue;
    if (!existsSync(resolve(dirname(path), file))) problems.push(`${rel}: broken link ${target}`);
  }

  // Table rows inside one block must agree on the pipe count.
  let expected = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("|")) { expected = 0; continue; }
    const pipes = (line.match(/\|/g) ?? []).length;
    if (!expected) { expected = pipes; tables += 1; continue; }
    if (pipes !== expected) problems.push(`${rel}: inconsistent table row: ${line.slice(0, 60)}`);
  }
}

console.log(JSON.stringify({ files: REQUIRED.length, headings, links, tables, problems: problems.slice(0, 20) }));
if (problems.length) {
  console.error(`DOCS_FAIL (${problems.length})\n  ${problems.slice(0, 20).join("\n  ")}`);
  process.exit(1);
}
console.log("DOCS_OK");
