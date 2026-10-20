#!/usr/bin/env node
/**
 * Architecture budget gate (CI).
 *
 * Mirrors PI-Desktop `scripts/check-architecture.mjs` + `docs/architecture/allowlist.json`:
 *
 *   - `electron/main/index.ts` ≤ 1500 LOC
 *   - every other TypeScript file under `electron/main/` ≤ 800 LOC
 *   - every Rust file under `crates/` ≤ 1000 LOC (allowlistable)
 *
 * Allowlist is `docs/architecture/allowlist.json`. Each entry has:
 *   { "path": "relative/path.ts", "limit": 1500, "reason": "..." }
 *
 * The budget for a file is:
 *   - the largest allowlist entry matching the path
 *   - otherwise the global default for that scope
 *
 * Exit code 0 = pass, 1 = violations found.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST_PATH = join(ROOT, "docs/architecture/allowlist.json");
const ELECTRON_MAIN_DEFAULT = 800;
const ELECTRON_INDEX_DEFAULT = 1500;
const RUST_DEFAULT = 1000;
const TYPESCRIPT_EXTS = new Set([".ts", ".tsx"]);
const RUST_EXTS = new Set([".rs"]);

const violations = [];
const checked = { electron: 0, rust: 0 };

function readAllowlist() {
  if (!existsSync(ALLOWLIST_PATH)) return [];
  try {
    const raw = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
    if (!Array.isArray(raw?.entries)) return [];
    return raw.entries;
  } catch (err) {
    console.error(`[check-architecture] failed to parse ${ALLOWLIST_PATH}:`, err.message);
    return [];
  }
}

function limitFor(relPath, defaultLimit, allowlist) {
  let matched = defaultLimit;
  for (const entry of allowlist) {
    if (entry?.path !== relPath) continue;
    if (typeof entry.limit === "number" && entry.limit > matched) {
      matched = entry.limit;
    }
  }
  return matched;
}

function visit(dir, extensions, kind, allowlist) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "target" || e.name === "dist") continue;
      visit(p, extensions, kind, allowlist);
      continue;
    }
    if (!e.isFile()) continue;
    // Test files are gated by coverage, not by LOC budget. Long test files
    // usually mean coverage is broad, which is desirable.
    if (p.endsWith(".test.ts") || p.endsWith(".test.tsx") || p.endsWith(".test.rs")) continue;
    const dot = p.lastIndexOf(".");
    if (dot < 0) continue;
    if (!extensions.has(p.slice(dot))) continue;
    const stat = statSync(p);
    const lines = countLines(p);
    const rel = relative(ROOT, p);
    let defaultLimit;
    if (kind === "electron") {
      defaultLimit = rel === "electron/main/index.ts"
        ? ELECTRON_INDEX_DEFAULT
        : ELECTRON_MAIN_DEFAULT;
    } else {
      defaultLimit = RUST_DEFAULT;
    }
    const allowed = limitFor(rel, defaultLimit, allowlist);
    if (lines > allowed) {
      const entry = allowlist.find((x) => x?.path === rel);
      violations.push({
        path: rel,
        lines,
        limit: allowed,
        defaultLimit,
        allowed: !!entry,
        reason: entry?.reason,
        size: stat.size,
      });
    }
    checked[kind]++;
  }
}

function countLines(p) {
  let n = 0;
  const text = readFileSync(p, "utf8");
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }
  if (text.length && !text.endsWith("\n")) n++;
  return n;
}

const allowlist = readAllowlist();
visit(join(ROOT, "electron/main"), TYPESCRIPT_EXTS, "electron", allowlist);
visit(join(ROOT, "crates"), RUST_EXTS, "rust", allowlist);

const result = {
  schema: "openbuddy.architecture-budget.v1",
  checkedAt: new Date().toISOString(),
  limits: {
    electronMainDefault: ELECTRON_MAIN_DEFAULT,
    electronMainIndex: ELECTRON_INDEX_DEFAULT,
    rustDefault: RUST_DEFAULT,
  },
  counts: checked,
  violations: violations.map((v) => ({
    path: v.path,
    lines: v.lines,
    limit: v.limit,
    allowed: v.allowed,
    defaultLimit: v.defaultLimit,
    reason: v.reason,
  })),
  passed: violations.length === 0,
};

const out = process.argv.includes("--json")
  ? JSON.stringify(result, null, 2)
  : format(result);

console.log(out);
process.exit(result.passed ? 0 : 1);

function format(r) {
  const lines = [];
  lines.push(`architecture budget — checked ${r.counts.electron} electron + ${r.counts.rust} rust files`);
  lines.push(`limits: electron-main ${r.limits.electronMainDefault} LOC, electron-main/index.ts ${r.limits.electronMainIndex} LOC, rust ${r.limits.rustDefault} LOC`);
  if (r.violations.length === 0) {
    lines.push("✓ all files within budget");
  } else {
    lines.push(`✗ ${r.violations.length} violation(s):`);
    for (const v of r.violations) {
      const tag = v.allowed ? "allowlisted" : "OVER";
      lines.push(`  [${tag}] ${v.path}: ${v.lines} lines > ${v.limit}${v.reason ? ` — ${v.reason}` : ""}`);
    }
  }
  return lines.join("\n");
}
