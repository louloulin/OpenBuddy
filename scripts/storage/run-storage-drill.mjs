import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "../..");
const tests = [
  "packages/runtime/openbuddy-storage/src/__tests__/migration-fixture.test.ts",
  "packages/runtime/openbuddy-storage/src/__tests__/open-storage.test.ts",
];
const result = spawnSync("pnpm", ["exec", "vitest", "run", ...tests, "--reporter=dot"], {
  cwd: projectRoot,
  env: { ...process.env, CI: "1" },
  stdio: "inherit",
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log("storage migration/restore drill passed in isolated temporary fixtures");
