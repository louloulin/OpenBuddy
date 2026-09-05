// Filesystem capability policy decision — single source of truth.
//
// Centralizes the OPENBUDDY_FILESYSTEM_SMOKE env flag + `filesystemSmoke:
// "disabled-by-policy"` manifest gate so any runner (Node mjs or Electron TS)
// reads the same answer.
//
// Returns:
//   { allowed: boolean, reason: string, source: "env" | "manifest" | "default" }
//
// Allowed iff:
//   1. Manifest policy field "filesystemSmoke" === "disabled-by-policy" AND
//   2. Env OPENBUDDY_FILESYSTEM_SMOKE === "0" (the default for all
//      eval/E2E launches; see run_full_acceptance.mjs:69 and
//      launch-real-evals-echo.mjs:136,255).
//
// Any deviation ⇒ allowed=false and the runner must report
// `filesystem: "not-run-by-policy"` in its summary (matches
// run_full_acceptance.mjs:139).

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

const MANIFEST_PATHS = [
  join(repoRoot, "evals", "benchmark-manifest.json"),
  join(repoRoot, "evals", "agent-scenario-manifest.json"),
];

function readManifestPolicy() {
  for (const path of MANIFEST_PATHS) {
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      if (parsed?.policy?.filesystemSmoke) return parsed.policy.filesystemSmoke;
    } catch { /* ignore */ }
  }
  return "disabled-by-policy";
}

export function evaluateFilesystemCapabilityPolicy({
  env = process.env,
  manifestPolicy = readManifestPolicy(),
} = {}) {
  const fromEnv = env.OPENBUDDY_FILESYSTEM_SMOKE;
  const envAllowed = fromEnv === undefined ? false : fromEnv !== "0";
  const manifestAllowed = manifestPolicy !== "disabled-by-policy";
  const allowed = envAllowed && manifestAllowed;
  let reason;
  let source;
  if (!manifestAllowed) {
    reason = `manifest.policy.filesystemSmoke=${manifestPolicy} (disabled-by-policy gate)`;
    source = "manifest";
  } else if (!envAllowed) {
    reason = `OPENBUDDY_FILESYSTEM_SMOKE=${fromEnv} (eval/E2E launches default to 0)`;
    source = "env";
  } else {
    reason = "filesystem capability enabled by both manifest and env";
    source = "default";
  }
  return { allowed, reason, source };
}

export const DEFAULT_FILESYSTEM_POLICY = "disabled-by-policy";