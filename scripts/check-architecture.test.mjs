/**
 * Tests for scripts/check-architecture.mjs.
 *
 * Invariants covered:
 *  - clean tree: rc=0, no violations, exit 0
 *  - synthetic oversize file: rc=0 with violation, exit 1
 *  - allowlist raises the budget for a known file
 *  - test files (`*.test.ts`) are excluded from the budget
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Use process.cwd() because vitest may load the test from a sandboxed location.
const REPO_ROOT = process.cwd();
const SOURCE_SCRIPT = join(REPO_ROOT, "scripts", "check-architecture.mjs");

function runIn(scratch) {
  // Copy the script into `scratch/scripts/` so the script's location-derived
  // ROOT points at the synthetic fixture directory instead of the real repo.
  mkdirSync(join(scratch, "scripts"), { recursive: true });
  const localScript = join(scratch, "scripts", "check-architecture.mjs");
  copyFileSync(SOURCE_SCRIPT, localScript);
  const result = spawnSync("node", [localScript, "--json"], {
    cwd: scratch,
    encoding: "utf8",
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
    json: (() => {
      try { return JSON.parse(result.stdout); } catch { return null; }
    })(),
  };
}

describe("check-architecture budget gate", () => {
  let scratch;
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "ob-arch-"));
    // Minimal allowlist + scaffold so the script can run.
    mkdirSync(join(scratch, "docs/architecture"), { recursive: true });
    mkdirSync(join(scratch, "electron/main"), { recursive: true });
    mkdirSync(join(scratch, "crates"), { recursive: true });
    writeFileSync(
      join(scratch, "docs/architecture/allowlist.json"),
      JSON.stringify({ entries: [] }),
    );
  });
  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("passes on an empty scaffold", () => {
    const res = runIn(scratch);
    expect(res.code).toBe(0);
    expect(res.json?.passed).toBe(true);
    expect(res.json?.violations).toEqual([]);
  });

  it("flags a synthetic oversize .ts file under electron/main", () => {
    // 801 lines > default 800 → must fail
    const big = "x".repeat(80);
    const lines = Array.from({ length: 801 }, () => big).join("\n");
    writeFileSync(join(scratch, "electron/main/huge.ts"), lines + "\n");

    const res = runIn(scratch);
    expect(res.code).toBe(1);
    const violations = res.json?.violations ?? [];
    const hit = violations.find((v) => v.path === "electron/main/huge.ts");
    expect(hit).toBeTruthy();
    expect(hit.lines).toBeGreaterThan(800);
    expect(hit.allowed).toBe(false);
  });

  it("does not flag a 700-line .ts file under the default budget", () => {
    const big = "y".repeat(80);
    const lines = Array.from({ length: 700 }, () => big).join("\n");
    writeFileSync(join(scratch, "electron/main/medium.ts"), lines + "\n");

    const res = runIn(scratch);
    expect(res.code).toBe(0);
    expect(res.json?.violations).toEqual([]);
  });

  it("treats electron/main/index.ts at 1500 LOC as the larger budget", () => {
    // 1499 lines ≤ 1500 → pass
    const big = "z".repeat(80);
    const lines = Array.from({ length: 1499 }, () => big).join("\n");
    writeFileSync(join(scratch, "electron/main/index.ts"), lines + "\n");

    const res = runIn(scratch);
    expect(res.code).toBe(0);
    expect(res.json?.violations).toEqual([]);
  });

  it("respects allowlist entries by raising the limit", () => {
    // 900 lines > 800 default, but allowlist raises to 1000.
    const big = "w".repeat(80);
    const lines = Array.from({ length: 900 }, () => big).join("\n");
    writeFileSync(join(scratch, "electron/main/legacy.ts"), lines + "\n");
    writeFileSync(
      join(scratch, "docs/architecture/allowlist.json"),
      JSON.stringify({
        entries: [
          { path: "electron/main/legacy.ts", limit: 1000, reason: "test fixture" },
        ],
      }),
    );

    const res = runIn(scratch);
    expect(res.code).toBe(0);
    const violations = res.json?.violations ?? [];
    const hit = violations.find((v) => v.path === "electron/main/legacy.ts");
    expect(hit).toBeUndefined();
  });

  it("excludes test files from the budget", () => {
    // 1500-line test file would normally violate, but tests are excluded.
    const big = "v".repeat(80);
    const lines = Array.from({ length: 1500 }, () => big).join("\n");
    writeFileSync(join(scratch, "electron/main/long.test.ts"), lines + "\n");

    const res = runIn(scratch);
    expect(res.code).toBe(0);
    const violations = res.json?.violations ?? [];
    const hit = violations.find((v) => v.path === "electron/main/long.test.ts");
    expect(hit).toBeUndefined();
  });

  it("flags oversize Rust files but uses the rust default (1000)", () => {
    // 1001 lines > 1000 rust default.
    const big = "u".repeat(80);
    const lines = Array.from({ length: 1001 }, () => big).join("\n");
    mkdirSync(join(scratch, "crates/openbuddy-host-core/src"), { recursive: true });
    writeFileSync(join(scratch, "crates/openbuddy-host-core/src/big.rs"), lines + "\n");

    const res = runIn(scratch);
    expect(res.code).toBe(1);
    const violations = res.json?.violations ?? [];
    const hit = violations.find((v) => v.path.endsWith("big.rs"));
    expect(hit).toBeTruthy();
    expect(hit.limit).toBe(1000);
  });
});
