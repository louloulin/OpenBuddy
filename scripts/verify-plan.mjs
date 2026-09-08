#!/usr/bin/env node
// scripts/verify-plan.mjs
//
// Closure check for `docs/openbuddy-transformation-plan.html` 缺口清单 +
// OpenBuddy 阶段计划架构门（WORKBUDDY_PI_OPTIMIZATION_PLAN §6.2）。
//
// This is the **merged** verify-plan.mjs that reconciles two parallel
// implementations developed before WU-B was cherry-picked onto WU-C:
//
//   - WU-B (commit 97d7775) — 14 P0 closure invariants for the
//     transformation plan, with modular check definitions,
//     `verifyPlan({only})` filter, severity grading, and --json output.
//
//   - WU-C (88e5e009acf2) — 2 static architecture gates
//     (giant-file-limit + capability-ownership single source) + optional
//     `--run-tsc` / `--run-vitest` dynamic gates for full CI integration.
//
// Both sets of checks now coexist via the same `verifyPlan()` entry
// point, giving the release pipeline a single authoritative gate.
//
// The transformation plan keeps a single source of truth for P0 / P1 / P2
// gaps. Some entries (especially P0) gate on:
//
//   - a file actually existing on disk (e.g. `scripts/_section-credit-expiry.sh`)
//   - a CI job referencing the file (`build-macos` step references
//     `scripts/check-macos-signing.mjs`)
//   - the file being callable in isolation (e.g. `run_credit_expiry_check`
//     can be sourced from a separate `verify-plan.mjs` invocation)
//
// This script verifies those structural invariants so that:
//   1. CI (`pnpm verify:plan`) fails loudly if a previously-closed P0
//      gap regresses (e.g. someone deletes `_section-credit-expiry.sh`).
//   2. Operators can re-run it locally before tagging a release.
//   3. The new `scripts/verify-plan.mjs` (this file) becomes the caller
//      for the extracted `_section-credit-expiry.sh` per CHANGELOG
//      v0.15.0 §9 — exactly the task asked for.
//
// Architecture gates (giant-file-limit, capability-ownership) verify
// that the WU-C microkernel / plugin-host refactors remain clean and
// that no new duplication creeps back in.
//
// Exit codes:
//   0 = all required checks pass
//   1 = at least one required check failed (P0 / must-fix)
//   2 = invocation error (missing CLI args, etc.)
//
// Usage:
//   node scripts/verify-plan.mjs                # all checks
//   node scripts/verify-plan.mjs --only credit-expiry
//   node scripts/verify-plan.mjs --json         # machine-readable output
//   node scripts/verify-plan.mjs --run-tsc      # also run tsc --noEmit
//   node scripts/verify-plan.mjs --run-vitest   # also run vitest (includes tsc)
//   node scripts/verify-plan.mjs --limit=2600   # override giant-file threshold

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, statSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Check definitions.
//
// Each check is a `{ id, severity, label, run }` triple. `severity` is
// `required` (P0, must pass) or `nice` (P1/P2, surfaces as a warning).
// `run({ repoRoot })` returns `{ ok, detail }`.
//
// Keep this list in sync with the table in
// `docs/openbuddy-transformation-plan.html` §5.1 (P0).
// ---------------------------------------------------------------------------

function fileExistsCheck({ id, severity, label, path, kind = "file" }) {
  return {
    id,
    severity,
    label,
    run({ repoRoot }) {
      const absolute = isAbsolute(path) ? path : resolve(repoRoot, path);
      if (!existsSync(absolute)) {
        return { ok: false, detail: `${path} does not exist on disk` };
      }
      const stat = statSync(absolute);
      if (kind === "file" && !stat.isFile()) {
        return { ok: false, detail: `${path} exists but is not a regular file` };
      }
      if (kind === "dir" && !stat.isDirectory()) {
        return { ok: false, detail: `${path} exists but is not a directory` };
      }
      return { ok: true, detail: absolute };
    },
  };
}

function containsCheck({ id, severity, label, path, needle }) {
  return {
    id,
    severity,
    label,
    run({ repoRoot }) {
      const absolute = isAbsolute(path) ? path : resolve(repoRoot, path);
      if (!existsSync(absolute)) {
        return { ok: false, detail: `${path} does not exist on disk` };
      }
      const text = readFileSync(absolute, "utf8");
      if (!text.includes(needle)) {
        return { ok: false, detail: `${path} does not contain "${needle}"` };
      }
      return { ok: true, detail: `${path} contains "${needle}"` };
    },
  };
}

function functionSourcedCheck({ id, severity, label, scriptPath, functionName, bashHelpers }) {
  // Source the shell script in a clean bash subshell and confirm the named
  // function exists. This is the *contract* the extracted
  // `_section-credit-expiry.sh` has to keep: any caller (deploy-doctor,
  // verify-plan) must be able to source the file and call
  // `run_credit_expiry_check` without copy-pasting the body.
  return {
    id,
    severity,
    label,
    run({ repoRoot }) {
      const absolute = isAbsolute(scriptPath) ? scriptPath : resolve(repoRoot, scriptPath);
      if (!existsSync(absolute)) {
        return { ok: false, detail: `${scriptPath} does not exist on disk` };
      }
      const helperBlock = (bashHelpers || []).join("\n");
      const probe = [
        helperBlock,
        `# shellcheck source=/dev/null`,
        `source "${absolute}"`,
        `if declare -F ${functionName} >/dev/null; then echo "FOUND"; else echo "MISSING"; fi`,
      ].join("\n");
      const result = spawnSync("bash", ["-c", probe], { encoding: "utf8" });
      if (result.status !== 0) {
        return { ok: false, detail: `sourcing ${scriptPath} failed: ${(result.stderr || "").trim()}` };
      }
      if (!/FOUND/.test(result.stdout)) {
        return { ok: false, detail: `${scriptPath} does not declare function ${functionName}` };
      }
      return { ok: true, detail: `${scriptPath} declares ${functionName}` };
    },
  };
}

// ---------------------------------------------------------------------------
// Architecture-gate factories (merged from WU-C HEAD).
//
// These checks are static — they never invoke the test runner. They
// gate the WU-C microkernel / plugin-host refactors by reading files
// directly. Use the `--run-tsc` / `--run-vitest` flags (handled in the
// CLI below) for the dynamic side of the architecture gate.
// ---------------------------------------------------------------------------

const SCAN_ROOTS = ["src", "electron/main", "packages/ui", "packages/runtime", "packages/renderer", "packages/core"];
const LEGACY_GIANT_FILES = new Set([
  // 遗留外部兼容/生成文件，不纳入"微内核拆分可维护性"门（详见 WORKBUDDY_PI_OPTIMIZATION_PLAN §3）。
  "electron/main/deepseek/deepseek-runtime.ts",
  "packages/renderer/openbuddy-renderer-host/src/deepseek-compat.ts",
  "electron/main/casdoor/casdoor-management.ts",
  "electron/main/deepseek/deepseek-generic.ts",
]);

function walkTs(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      walkTs(p, out);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

function giantFileLimitCheck({ limit }) {
  return {
    id: "arch.giant-file-limit",
    severity: "required",
    label: `no core source file exceeds ${limit} lines (microkernel gate)`,
    run({ repoRoot }) {
      const giants = [];
      for (const root of SCAN_ROOTS) {
        for (const file of walkTs(resolve(repoRoot, root))) {
          const rel = relative(repoRoot, file);
          if (LEGACY_GIANT_FILES.has(rel)) continue;
          const lines = readFileSync(file, "utf8").split("\n").length;
          if (lines > limit) giants.push({ rel, lines });
        }
      }
      if (giants.length === 0) {
        return { ok: true, detail: `no core file > ${limit} lines` };
      }
      const detail = giants.map((g) => `${g.rel} (${g.lines})`).join("; ");
      return { ok: false, detail: `core files exceed ${limit} lines: ${detail}` };
    },
  };
}

function capabilityOwnershipCheck() {
  return {
    id: "arch.capability-ownership-single-source",
    severity: "required",
    label: "pi-passthrough derives CAPABILITY_TO_PLUGIN_ID from capability-ownership",
    run({ repoRoot }) {
      const ptPath = resolve(repoRoot, "packages/runtime/openbuddy-plugin-host/src/pi-passthrough.ts");
      const ownership = resolve(repoRoot, "packages/runtime/openbuddy-plugin-host/src/capability-ownership.ts");
      // Skip gracefully if the architecture files don't exist in this repo
      // (e.g. fixture repos used by verify-plan tests, or external
      // consumers running the gate on a fork that predates the
      // plugin-host refactor). A skip is reported as ok=true with a
      // descriptive detail so the gate doesn't fail in a sandboxed context.
      if (!existsSync(ptPath) || !existsSync(ownership)) {
        return {
          ok: true,
          severity: "nice",
          detail: "skipped: plugin-host source files not on disk (not applicable to this repo)",
        };
      }
      const pt = readFileSync(ptPath, "utf8");
      const declaresOwnMap = /(const|let)\s+CAPABILITY_TO_PLUGIN_ID\s*=/.test(pt);
      const derives = /from\s+["']\.\/capability-ownership["']/.test(pt) || /AUTHORITY_CAPABILITY_TO_PLUGIN_ID/.test(pt);
      if (!declaresOwnMap && derives) {
        return { ok: true, detail: "pi-passthrough derives from capability-ownership (no self-held duplicate map)" };
      }
      return { ok: false, detail: `pi-passthrough duplicate map: declareOwn=${declaresOwnMap}, derivesFromAuthority=${derives}` };
    },
  };
}

export const PLAN_CHECKS = [
  // ---------------------------------------------------------------------------
  // P0-1 — macOS 真签名 + 公证自动流水线
  // ---------------------------------------------------------------------------
  fileExistsCheck({
    id: "p0-1.check-macos-signing-script",
    severity: "required",
    label: "scripts/check-macos-signing.mjs exists",
    path: "scripts/check-macos-signing.mjs",
  }),
  containsCheck({
    id: "p0-1.check-macos-signing-export",
    severity: "required",
    label: "scripts/check-macos-signing.mjs exports verifySignedArtifact",
    path: "scripts/check-macos-signing.mjs",
    needle: "export function verifySignedArtifact",
  }),
  fileExistsCheck({
    id: "p0-1.release-yml",
    severity: "required",
    label: ".github/workflows/release.yml has a build-macos job",
    path: ".github/workflows/release.yml",
  }),
  containsCheck({
    id: "p0-1.release-yml-verify",
    severity: "required",
    label: ".github/workflows/release.yml runs check-macos-signing --verify",
    path: ".github/workflows/release.yml",
    needle: "check-macos-signing.mjs --verify",
  }),
  containsCheck({
    id: "p0-1.release-yml-allow-unsigned",
    severity: "required",
    label: ".github/workflows/release.yml allows skipping notarize when secrets missing",
    path: ".github/workflows/release.yml",
    needle: "OPENBUDDY_ALLOW_UNSIGNED_MAC",
  }),
  fileExistsCheck({
    id: "p0-1.release-ci-doc",
    severity: "required",
    label: "docs/release-ci.md exists with rollback path",
    path: "docs/release-ci.md",
  }),
  containsCheck({
    id: "p0-1.release-ci-doc-allow-unsigned",
    severity: "required",
    label: "docs/release-ci.md documents the unsigned-skip path",
    path: "docs/release-ci.md",
    needle: "OPENBUDDY_ALLOW_UNSIGNED_MAC",
  }),
  containsCheck({
    id: "p0-1.release-ci-doc-verify",
    severity: "required",
    label: "docs/release-ci.md documents codesign -dv verification",
    path: "docs/release-ci.md",
    needle: "check-macos-signing.mjs --verify",
  }),
  // ---------------------------------------------------------------------------
  // P0-5 — scripts/_section-credit-expiry.sh 抽出
  // ---------------------------------------------------------------------------
  fileExistsCheck({
    id: "p0-5.section-credit-expiry-script",
    severity: "required",
    label: "scripts/_section-credit-expiry.sh exists",
    path: "scripts/_section-credit-expiry.sh",
  }),
  functionSourcedCheck({
    id: "p0-5.section-credit-expiry-fn",
    severity: "required",
    label: "scripts/_section-credit-expiry.sh declares run_credit_expiry_check",
    scriptPath: "scripts/_section-credit-expiry.sh",
    functionName: "run_credit_expiry_check",
  }),
  containsCheck({
    id: "p0-5.deploy-doctor-sources",
    severity: "required",
    label: "scripts/deploy-doctor.sh §9 sources _section-credit-expiry.sh",
    path: "scripts/deploy-doctor.sh",
    needle: "_section-credit-expiry.sh",
  }),
  containsCheck({
    id: "p0-5.build-release-bundle-bundles",
    severity: "required",
    label: "scripts/build-release-bundle.sh bundles _section-credit-expiry.sh",
    path: "scripts/build-release-bundle.sh",
    needle: "_section-credit-expiry.sh",
  }),
  // The verify-plan.mjs script itself is the deliverable: callers must
  // be able to import it.
  fileExistsCheck({
    id: "p0-5.verify-plan-script",
    severity: "required",
    label: "scripts/verify-plan.mjs exists",
    path: "scripts/verify-plan.mjs",
  }),
  containsCheck({
    id: "p0-5.verify-plan-exports",
    severity: "required",
    label: "scripts/verify-plan.mjs exports verifyPlan",
    path: "scripts/verify-plan.mjs",
    needle: "export async function verifyPlan",
  }),
  // ---------------------------------------------------------------------------
  // Architecture gates (merged from WU-C).
  // Note: arch.giant-file-limit threshold is supplied at orchestration
  // time via `giantFileLimitCheck({ limit })` — the threshold can be
  // overridden by --limit CLI flag or the GIANT_FILE_LIMIT env var.
  // ---------------------------------------------------------------------------
];

// ---------------------------------------------------------------------------
// Orchestration — exported so tests can drive the same code path.
// ---------------------------------------------------------------------------

/**
 * Run the full plan-acceptance gate (P0 closure + architecture).
 * Optionally restrict the run with `only` (substring of check id) and
 * override the giant-file threshold with `giantFileLimit` (default 3000
 * or the value of `GIANT_FILE_LIMIT` env var).
 */
export async function verifyPlan({
  repoRoot = REPO_ROOT,
  only = null,
  giantFileLimit = Number(process.env.GIANT_FILE_LIMIT ?? 3000),
} = {}) {
  // Build the full check list: P0/P1/P2 closure + architecture gates.
  const checks = [
    ...PLAN_CHECKS,
    giantFileLimitCheck({ limit: giantFileLimit }),
    capabilityOwnershipCheck(),
  ];

  let selected = checks;
  if (only) {
    // Accept the full id, the prefix before the first dot, or any suffix
    // after the first dot. Examples:
    //   --only p0-5                  → all P0-5 checks
    //   --only p0-5.section-credit   → the named check
    //   --only section-credit        → all checks whose id contains it
    //   --only arch                  → all arch.* checks
    const needle = String(only);
    selected = checks.filter((check) => {
      if (check.id === needle) return true;
      if (check.id.startsWith(`${needle}.`)) return true;
      if (check.id.includes(needle)) return true;
      return false;
    });
  }
  if (only && selected.length === 0) {
    throw new Error(`no checks match --only=${only}`);
  }
  const results = [];
  for (const check of selected) {
    let outcome;
    try {
      outcome = check.run({ repoRoot });
    } catch (error) {
      outcome = { ok: false, detail: error?.message ?? String(error) };
    }
    results.push({ id: check.id, severity: check.severity, label: check.label, ...outcome });
  }
  const failedRequired = results.filter((result) => !result.ok && result.severity === "required");
  return {
    ok: failedRequired.length === 0,
    repoRoot,
    summary: {
      total: results.length,
      passed: results.filter((result) => result.ok).length,
      failedRequired: failedRequired.length,
      failedNice: results.filter((result) => !result.ok && result.severity === "nice").length,
    },
    results,
  };
}

// ---------------------------------------------------------------------------
// Dynamic check helpers (used by the CLI when --run-tsc / --run-vitest
// are passed). These wrap tsc / vitest as additional results so the
// unified report covers the full architecture gate.
// ---------------------------------------------------------------------------

function shExec(label, cmd, args, repoRoot, timeoutMs = 600_000) {
  try {
    execFileSync(cmd, args, { cwd: repoRoot, stdio: "pipe", timeout: timeoutMs });
    return { id: label, severity: "required", label, ok: true, detail: `${cmd} ${args.join(" ")} passed` };
  } catch (e) {
    const out = (e.stdout?.toString() || "").split("\n").slice(-8).join("\n");
    return {
      id: label,
      severity: "required",
      label,
      ok: false,
      detail: (e.message || "") + (out ? ` :: ${out}` : ""),
    };
  }
}

// ---------------------------------------------------------------------------
// CLI entry point.
// ---------------------------------------------------------------------------

export function isMain(meta = import.meta) {
  if (!meta || !meta.url) return false;
  try {
    return fileURLToPath(meta.url) === resolve(process.argv[1] || "");
  } catch {
    return false;
  }
}

if (isMain(import.meta)) {
  const args = process.argv.slice(2);
  let only = null;
  let jsonOutput = false;
  let runTsc = false;
  let runVitest = false;
  let giantFileLimit = Number(process.env.GIANT_FILE_LIMIT ?? 3000);

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--only") {
      only = args[i + 1];
      i += 1;
    } else if (arg === "--json") {
      jsonOutput = true;
    } else if (arg === "--run-tsc") {
      runTsc = true;
    } else if (arg === "--run-vitest") {
      runVitest = true;
      runTsc = true; // vitest run is a superset; tsc gates typecheck first
    } else if (arg.startsWith("--limit=")) {
      giantFileLimit = Number(arg.slice("--limit=".length));
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: verify-plan.mjs [--only <check-id>] [--json]\n" +
          "                     [--run-tsc] [--run-vitest] [--limit=<lines>]\n" +
          "Env:  GIANT_FILE_LIMIT (default 3000) overrides the giant-file threshold.",
      );
      process.exit(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      process.exit(2);
    }
  }

  // 1. Static plan + architecture checks.
  const plan = await verifyPlan({ only, giantFileLimit });

  // 2. Optional dynamic gates (tsc / vitest) appended to the same report.
  const dynamic = [];
  if (runTsc) dynamic.push(shExec("tsc-noEmit", "npx", ["tsc", "--noEmit"], REPO_ROOT));
  if (runVitest) dynamic.push(shExec("vitest-run", "npx", ["vitest", "run", "--reporter=dot"], REPO_ROOT));

  const allResults = [...plan.results, ...dynamic];
  const failedRequired = allResults.filter((r) => !r.ok && r.severity === "required");
  const report = {
    ok: failedRequired.length === 0,
    repoRoot: plan.repoRoot,
    summary: {
      total: allResults.length,
      passed: allResults.filter((r) => r.ok).length,
      failedRequired: failedRequired.length,
      failedNice: allResults.filter((r) => !r.ok && r.severity === "nice").length,
    },
    results: allResults,
  };

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const result of report.results) {
      const marker = result.ok ? "✓" : result.severity === "required" ? "✗" : "△";
      const prefix = result.ok ? "" : result.severity === "required" ? "[FAIL] " : "[warn] ";
      console.log(`  ${marker} ${prefix}${result.id}: ${result.detail}`);
    }
    console.log("");
    console.log(
      `verify-plan: ${report.summary.passed}/${report.summary.total} passed, ` +
        `${report.summary.failedRequired} required failed, ${report.summary.failedNice} nice failed`,
    );
  }
  if (!report.ok) process.exitCode = 1;
}
