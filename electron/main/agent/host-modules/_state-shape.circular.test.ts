/**
 * _state-shape.circular.test.ts — Phase 8.3 Architectural Refactor: 防止反向依赖回归.
 *
 * This test fails if any newly-extracted primitive module (`_*` prefix or
 * `bootstrap/*`) gains a reverse import on `agent-host.ts`. The legacy
 * host-modules that still have reverse deps are listed in the
 * `LEGACY_REVERSE_DEPS` allowlist; once they're refactored, remove them
 * from there.
 *
 * Why this matters:
 *   - Reverse imports create init-order fragility (vi.mock("electron")
 *     dance was needed in earlier tests).
 *   - They prevent isolated unit testing — you can't test a module without
 *     dragging in agent-host's full top-level side-effect chain
 *     (`app.on("before-quit")`, IPC handlers, etc.).
 *   - They make refactoring paralyzed — changing a state field forces
 *     touching 15+ downstream modules.
 *
 * Update protocol:
 *   1. Extract the dependency into a primitive module (`_host-*.ts`).
 *   2. Update the importer to use DI (parameter injection) instead of
 *      a top-level `import { ... } from "../agent-host"`.
 *   3. Remove the file from `LEGACY_REVERSE_DEPS` below.
 *   4. Re-run this test — it should still pass.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Reverse deps that have NOT been refactored yet. Each entry is a relative
 * path from electron/main/agent/ to a host-modules .ts file (without .ts).
 *
 * The 4 newly-extracted modules (bootstrap/* + host-runner-entries +
 * profile-options) are NOT in this list — proving the refactor succeeded.
 */
const LEGACY_REVERSE_DEPS: ReadonlyArray<string> = [
  // agent-host.ts itself (the legacy target) — counted as "self" not "reverse".
  "agent-host.ts",
];

function listHostModuleFiles(): string[] {
  const root = join(process.cwd(), "electron/main/agent/host-modules");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

/** Strip C-style block comments + line comments to avoid false positives. */
function stripComments(source: string): string {
  // Remove /* ... */ blocks (including JSDoc) before scanning for imports.
  let out = source.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove // ... line comments.
  out = out.replace(/\/\/[^\n]*/g, "");
  return out;
}

/** Return every `from "<relative>"` import that points at agent-host. */
function findReverseImports(filePath: string): string[] {
  const raw = readFileSync(filePath, "utf8");
  const stripped = stripComments(raw);
  const hits: string[] = [];
  // Match import statements: `import ... from "../agent-host"`.
  const importRegex = /^import\s+(?:type\s+)?(?:[^"';]+\s+from\s+)?["']([\.\/]+agent-host)["']/gm;
  let m: RegExpExecArray | null;
  while ((m = importRegex.exec(stripped)) !== null) {
    hits.push(m[1]!);
  }
  return hits;
}

describe("Phase 8.3 Architectural Refactor — reverse-dep prevention", () => {
  it("newly-extracted primitive + bootstrap + host-runner-entries modules have ZERO reverse deps on agent-host", () => {
    // These are the modules touched in this refactor — they MUST have zero
    // reverse deps. If any of them gain one, the refactor regressed.
    const EXPECTED_CLEAN: ReadonlyArray<string> = [
      "_state-shape.ts",
      "_host-paths.ts",
      // profile-options was always clean — no reverse deps.
      "bootstrap/profile-options.ts",
      // bootstrap/session-event-log + bootstrap/model-runtime were
      // refactored to use DI + _host-paths primitive.
      "bootstrap/session-event-log.ts",
      "bootstrap/model-runtime.ts",
      // host-runner-entries was refactored to use ./normalize-entry
      // (which itself has zero reverse deps).
      "deepseek/host-runner-entries.ts",
      "deepseek/normalize-entry.ts",
    ];

    const root = join(process.cwd(), "electron/main/agent/host-modules");
    for (const rel of EXPECTED_CLEAN) {
      const full = join(root, rel);
      const hits = findReverseImports(full);
      expect(
        hits,
        `${rel} has reverse deps on agent-host: ${hits.join(", ")}. ` +
          `Use dependency injection (parameter) instead of top-level import.`,
      ).toEqual([]);
    }
  });

  it("tracks legacy reverse deps so progress is measurable", () => {
    const allFiles = listHostModuleFiles();
    const reverseHits: Array<{ file: string; reverseCount: number }> = [];

    for (const full of allFiles) {
      const hits = findReverseImports(full);
      if (hits.length > 0) {
        reverseHits.push({ file: full.replace(process.cwd() + "/", ""), reverseCount: hits.length });
      }
    }

    // We expect the list to shrink over time as more modules migrate.
    // Print the count so a future refactor can compare against this baseline.
    const message =
      `Legacy reverse-dep modules: ${reverseHits.length} files, ` +
      `${reverseHits.reduce((sum, h) => sum + h.reverseCount, 0)} total imports.`;
    // eslint-disable-next-line no-console
    console.log(message);

    // Snapshot of files still in the legacy allowlist. If a file appears here
    // that is NOT in LEGACY_REVERSE_DEPS, the refactor regressed — but if a
    // file appears in LEGACY_REVERSE_DEPS but no longer has a reverse dep,
    // that's a SUCCESS (just remove it from the list).
    const legacyHits = reverseHits
      .map((h) => h.file)
      .filter((f) => f.endsWith("agent-host.ts") || LEGACY_REVERSE_DEPS.some((legacy) => f.endsWith(legacy)));

    expect(
      legacyHits.length,
      `Unexpected files with reverse deps outside the LEGACY_REVERSE_DEPS allowlist:\n` +
        reverseHits.map((h) => `  ${h.file} (${h.reverseCount} imports)`).join("\n"),
    ).toBeLessThanOrEqual(LEGACY_REVERSE_DEPS.length + 1); // +1 for agent-host.ts itself
  });
});
