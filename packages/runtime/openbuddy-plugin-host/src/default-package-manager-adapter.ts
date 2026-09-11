/**
 * G3 PR 1 — DefaultPackageManager adapter.
 *
 * Wires pi's `DefaultPackageManager` (real package install/remove resolver)
 * into openbuddy's `ProfilePackageManager` typed interface.
 *
 * Why a dedicated adapter (and not `new DefaultPackageManager(...)` directly)?
 * ------------------------------------------------------------------------
 * 1. pi's `DefaultPackageManager` is configured at the workspace level
 *    (`cwd`, `agentDir`, `settingsManager`). openbuddy profiles live under
 *    `process.env.PI_HOME/.pi/agent/profiles/<name>`, which is one agent
 *    dir deeper than the default cwd. We feed the per-profile dir in as
 *    `cwd` so pi's own install path resolution lands inside the right
 *    `node_modules/`.
 * 2. The openbuddy `ProfilePackageManager.install` / `remove` interface
 *    accepts `(profileDir, source|packageName)` — `DefaultPackageManager`
 *    wants `(source)`. This adapter is the only place that closes the gap,
 *    so callers stay typed and profileDir-aware.
 * 3. pnpm's `--config.ignore-scripts=true` policy (which gates the
 *    global `~/.npmrc` from running arbitrary install scripts) is the
 *    default the openbuddy runtime enforces; we surface that intent as
 *    `installOptions.local = true` (project-local only) so pi never
 *    escalates a `--save-prod` install into the global root.
 *
 * Spec: plan4.1.md §3 PR 1 (typed facade + DefaultPackageManager 适配层).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir as osHomedir } from "node:os";
import { join } from "node:path";

import { DefaultPackageManager } from "@earendil-works/pi-coding-agent";

import type { ProfilePackageManager } from "./profile-manager";

const execFileAsync = promisify(execFile);

function agentDirFor(profileDir: string): string {
  // openbuddy profiles live at <PI_HOME>/.pi/agent/profiles/<name>; walk up
  // until we find the agent dir so pi's settings lookup stays valid.
  let cursor = profileDir;
  for (let depth = 0; depth < 8; depth++) {
    if (cursor.endsWith(`${join(".pi", "agent")}`) || cursor.endsWith("/.pi/agent")) return cursor;
    const parent = join(cursor, "..");
    if (parent === cursor) break;
    cursor = parent;
  }
  return process.env.PI_CODING_AGENT_DIR ?? join(process.env.PI_HOME ?? osHomedir(), ".pi", "agent");
}

async function settingsManagerFor(profileDir: string): Promise<ConstructorParameters<typeof DefaultPackageManager>[0]["settingsManager"]> {
  // pi's SettingsManager carries persisted package sources / autoload flags.
  // We pull the shared instance from the global agent dir so any source
  // persisted through pi's settings store stays visible to this adapter.
  const mod = await import("@earendil-works/pi-coding-agent");
  const ctor = (mod as { SettingsManager?: { create: (cwd: string, agentDir?: string) => unknown } }).SettingsManager;
  if (!ctor) throw new Error("profile-package: pi SettingsManager export not available");
  return ctor.create(profileDir, agentDirFor(profileDir)) as ConstructorParameters<typeof DefaultPackageManager>[0]["settingsManager"];
}

async function buildAdapter(profileDir: string): Promise<DefaultPackageManager> {
  const settingsManager = await settingsManagerFor(profileDir);
  return new DefaultPackageManager({ cwd: profileDir, agentDir: agentDirFor(profileDir), settingsManager });
}

async function fallbackPnpmInstall(profileDir: string, source: string): Promise<void> {
  // pnpm 11 dropped the top-level `--ignore-scripts` flag; the dot-config
  // form keeps the global `~/.npmrc` ignore-scripts policy in force for
  // this invocation only.
  try {
    await execFileAsync(
      "pnpm",
      ["add", "--save-prod", "--ignore-workspace", "--config.ignore-scripts=true", "--", source],
      { cwd: profileDir, maxBuffer: 4 * 1024 * 1024 },
    );
  } catch (error) {
    const failure = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
    const stderr = typeof failure.stderr === "string" ? failure.stderr.trim() : "";
    const stdout = typeof failure.stdout === "string" ? failure.stdout.trim() : "";
    const details = [stderr, stdout].filter(Boolean).join("\n");
    throw new Error(
      `profile-package: pnpm add failed for ${source}${details ? `\n${details}` : ""}`,
      { cause: error },
    );
  }
}

async function fallbackPnpmRemove(profileDir: string, packageName: string): Promise<void> {
  try {
    await execFileAsync(
      "pnpm",
      ["remove", "--ignore-workspace", "--config.ignore-scripts=true", "--config.minimumReleaseAge=0", packageName],
      { cwd: profileDir, maxBuffer: 4 * 1024 * 1024 },
    );
  } catch (error) {
    const failure = error as { stderr?: unknown; stdout?: unknown };
    const stderr = typeof failure.stderr === "string" ? failure.stderr.trim() : "";
    const stdout = typeof failure.stdout === "string" ? failure.stdout.trim() : "";
    const details = [stderr, stdout].filter(Boolean).join("\n");
    throw new Error(
      `profile-package: pnpm remove failed for ${packageName}${details ? `\n${details}` : ""}`,
      { cause: error },
    );
  }
}

/**
 * The default `ProfilePackageManager` adapter: prefers pi's
 * `DefaultPackageManager` and falls back to a direct pnpm invocation when
 * the pi adapter rejects an install (e.g. legacy `file:` specifiers that
 * pre-date pi 0.85's strict source parser).
 */
export const defaultProfilePackageManager: ProfilePackageManager = {
  async install(profileDir, source) {
    let adapterError: unknown;
    try {
      const pm = await buildAdapter(profileDir);
      await pm.install(source, { local: true });
      return;
    } catch (error) {
      adapterError = error;
    }
    // Spec-parsing mismatch — fall back to direct pnpm so file: / git+https:
    // and other pre-0.85 specifiers keep working.
    await fallbackPnpmInstall(profileDir, source);
    if (adapterError && process.env.OPENBUDDY_PROFILE_PACKAGE_DEBUG === "1") {
      // Surface the original pi rejection to aid debugging without breaking
      // the install path.
      process.stderr.write(`[default-package-manager-adapter] pi install rejected: ${(adapterError as Error).message}\n`);
    }
  },
  async remove(profileDir, packageName) {
    let adapterError: unknown;
    try {
      const pm = await buildAdapter(profileDir);
      await pm.remove(packageName, { local: true });
      return;
    } catch (error) {
      adapterError = error;
    }
    await fallbackPnpmRemove(profileDir, packageName);
    if (adapterError && process.env.OPENBUDDY_PROFILE_PACKAGE_DEBUG === "1") {
      process.stderr.write(`[default-package-manager-adapter] pi remove rejected: ${(adapterError as Error).message}\n`);
    }
  },
};
