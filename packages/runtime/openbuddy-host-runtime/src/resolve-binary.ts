/**
 * Locate the compiled `openbuddy-host-core` binary on disk. Mirrors
 * PI-Desktop `apps/desktop/electron/main/host-process.ts:resolveHostBinary`
 * with adaptations (we use `PI_OPENBUDDY_HOST_BIN` instead of
 * `PI_DESKTOP_HOST_BIN`).
 *
 * Order of resolution:
 * 1. `PI_OPENBUDDY_HOST_BIN` env var (absolute path that exists).
 * 2. Packaged resources: `process.resourcesPath/bin/openbuddy-host-core{,.exe}`.
 * 3. Monorepo release build: `<repo>/crates/target/release/openbuddy-host-core{,.exe}`.
 * 4. Monorepo debug build: `<repo>/crates/target/debug/openbuddy-host-core{,.exe}`.
 *
 * Throws if none of the above resolve. Callers should surface the failure
 * to the user (recovery flow per PI-Desktop §07-process-model.md §3).
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EXE_SUFFIX = process.platform === "win32" ? ".exe" : "";

function pathExists(p: string | undefined): p is string {
  return !!p && existsSync(p);
}

/**
 * Resolve the monorepo root used as the base for `target/{debug,release}`.
 * Walks up from `import.meta.url` looking for either:
 *   - a `crates/Cargo.toml` workspace marker (preferred — OpenBuddy layout)
 *   - a top-level `Cargo.toml` (future layout, e.g. merged workspace)
 * Returns the directory that contains `crates/` (or `target/` for the
 * alternative layout). Stops after 16 hops or at the filesystem root.
 */
function resolveRepoRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 16; i += 1) {
    // OpenBuddy layout: Cargo.toml lives inside `crates/`.
    if (existsSync(join(cur, "crates/Cargo.toml"))) return cur;
    // Alternative layout: top-level Cargo.toml.
    if (existsSync(join(cur, "Cargo.toml")) && existsSync(join(cur, "target"))) {
      return cur;
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return start;
}

export function resolveHostBinary(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.PI_OPENBUDDY_HOST_BIN;
  if (pathExists(override)) {
    return override;
  }

  // Packaged Electron resources: process.resourcesPath is set when running
  // from a packaged build. We gate on `process.resourcesPath` to avoid
  // resolving to an empty string in `electron-vite dev`.
  const resources = process.env["process.resourcesPath"] ?? "";
  const packaged = join(resources, `bin/openbuddy-host-core${EXE_SUFFIX}`);
  if (pathExists(packaged)) {
    return packaged;
  }

  // Monorepo dev / build paths. We compute the repo root from this module's
  // URL so the resolver works regardless of how the package is consumed
  // (monorepo symlink, hoisted install, etc.).
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolveRepoRoot(here);
  const candidates = [
    join(repoRoot, `crates/target/release/openbuddy-host-core${EXE_SUFFIX}`),
    join(repoRoot, `crates/target/debug/openbuddy-host-core${EXE_SUFFIX}`),
  ];
  for (const c of candidates) {
    if (pathExists(c)) return c;
  }

  throw new Error(
    "openbuddy-host-core binary not found. Set PI_OPENBUDDY_HOST_BIN or run `cargo build --release -p openbuddy-host-core` from the repo root.",
  );
}
