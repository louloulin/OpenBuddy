#!/usr/bin/env node
/**
 * Generate the reproducible Phase 0 facts used by plan4.
 * The report is intentionally derived from the current checkout and records
 * the commands' inputs, rather than copying historical LOC claims.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const write = args.includes("--write");
const run = (command, commandArgs) => {
  try {
    return execFileSync(command, commandArgs, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    return `FAILED (${error.status ?? "unknown"}): ${output.split("\n").slice(-3).join("\n")}`;
  }
};
const lineCount = (path) => Number(run("wc", ["-l", path]).split(/\s+/)[0]);
const files = [
  "electron/main/agent/agent-host.ts",
  "electron/main/agent/pi-extensions.ts",
  "electron/main/agent/host-modules/bootstrap/install-host-modules.ts",
  "packages/runtime/openbuddy-plugin-host/src/index.ts",
  "packages/capability/openbuddy-email/src/index.ts",
];
const rows = files.map((path) => `| \`${path}\` | ${lineCount(path)} |`);
const report = `# Plan 4 Phase 0 baseline\n\nGenerated from checkout ${run("git", ["rev-parse", "HEAD"])} on ${new Date().toISOString()}.\n\n## Reproducible facts\n\n| Measurement | Value |\n|---|---|\n| Tracked files | ${run("git", ["ls-files"]).split("\n").filter(Boolean).length} |\n| Package version | ${run("node", ["-p", "require('./package.json').version"])} |\n\n## Key source line counts\n\n| File | Lines |\n|---|---:|\n${rows.join("\n")}\n\n## Verification commands\n\n- \`pnpm verify:plan\` (static architecture gates)\n- \`pnpm typecheck\` (not run by this generator)\n- \`pnpm test\` (not run by this generator)\n\nHistorical plan numbers are not treated as current facts; regenerate this report after structural changes.\n`;
if (write) {
  mkdirSync(resolve(root, "docs/architecture"), { recursive: true });
  writeFileSync(resolve(root, "docs/architecture/PLAN4_PHASE0_BASELINE.md"), report);
}
process.stdout.write(report);
