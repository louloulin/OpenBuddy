/**
 * G3 PR 2 — DefaultPackageManager adapter (extended).
 *
 * PR 1 introduced the typed facade + double-track install/remove path
 * (pi `DefaultPackageManager` first, pnpm fallback). PR 2 layers three
 * new capabilities on top:
 *
 *   1. Specifier classification — `classifySpecifier(source)` returns a
 *      `SpecifierKind` enum so callers can route `git+https:`, `git@`,
 *      `github:`, `tarball https://…`, `file:`, or `npm:` specifiers
 *      through the right `DefaultPackageManager` overload instead of
 *      forcing every input through the strict npm-spec parser.
 *   2. Error aggregation — when both pi and pnpm fail, the adapter
 *      surfaces an `AggregateError` whose `.errors` carries the pi
 *      rejection and the pnpm rejection in that order, plus the
 *      classified specifier kind. This lets the executor pick a
 *      rollback strategy without re-running classification itself.
 *   3. Typed `PackageInstallResult` — distinguishes "installed via
 *      pi", "installed via pnpm fallback", and "rejected by both".
 *      Callers can opt to treat fallback as a soft warning (only the
 *      strict environments that pin pi-as-source-of-truth will surface
 *      this as a hard error).
 *
 * Spec: plan4.1.md §9.23 PR 2 (适配层补完).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir as osHomedir } from "node:os";
import { join } from "node:path";

import { DefaultPackageManager } from "@earendil-works/pi-coding-agent";

import type { ProfilePackageManager } from "./profile-manager";

const execFileAsync = promisify(execFile);

export type SpecifierKind =
  | "npm"
  | "git-https"
  | "git-ssh"
  | "github"
  | "tarball-https"
  | "file"
  | "local-directory"
  | "unknown";

export interface PackageInstallResult {
  ok: boolean;
  channel: "pi" | "pnpm-fallback" | "both-failed";
  specifier: SpecifierKind;
  piError?: string;
  pnpmError?: string;
}

export function classifySpecifier(source: string): SpecifierKind {
  if (!source) return "unknown";
  if (/^npm:/.test(source)) return "npm";
  if (/^github:/.test(source)) return "github";
  if (/^tarball[-+]https?:|^tarball:/.test(source)) return "tarball-https";
  if (/^git\+https:|^https?:\/\/.*\.git$/.test(source)) return "git-https";
  if (/^git\+ssh:|^git@/.test(source)) return "git-ssh";
  if (/^https?:\/\/.*\.tgz$|^https?:\/\/.*\.tar\.gz$/.test(source)) return "tarball-https";
  if (/^file:/.test(source)) return "file";
  if (/^(?:\.{1,2}|[\\/]|[A-Za-z]:[\\/])/.test(source)) return "local-directory";
  // bare `name@version` falls through to npm spec
  if (/^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+(?:@.*)?$/.test(source)) return "npm";
  return "unknown";
}

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
  let pnpmCause: unknown;
  try {
    await execFileAsync(
      "pnpm",
      ["add", "--save-prod", "--ignore-workspace", "--config.ignore-scripts=true", "--", source],
      { cwd: profileDir, maxBuffer: 4 * 1024 * 1024 },
    );
  } catch (error) {
    pnpmCause = error;
    const failure = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
    const stderr = typeof failure.stderr === "string" ? failure.stderr.trim() : "";
    const stdout = typeof failure.stdout === "string" ? failure.stdout.trim() : "";
    const originalMessage = typeof failure.message === "string" ? failure.message : "";
    const details = [originalMessage, stderr, stdout].filter(Boolean).join("\n");
    throw new Error(
      `profile-package: pnpm add failed for ${source}${details ? `\n${details}` : ""}`,
      { cause: error },
    );
  }
  void pnpmCause;
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
 * Wrap both install paths into a single `AggregateError` if both fail so
 * callers (the executor rollback path) can see pi's reason AND pnpm's
 * reason without re-running classification.
 */
function aggregateInstallErrors(specifier: SpecifierKind, source: string, piError: unknown, pnpmError: unknown): AggregateError {
  const piMessage = (piError as Error)?.message ?? String(piError);
  const pnpmMessage = (pnpmError as Error)?.message ?? String(pnpmError);
  const summary = `profile-package: install failed for ${source} (${specifier}); pi="${piMessage}"; pnpm="${pnpmMessage}"`;
  const aggregated = new AggregateError([piError, pnpmError], summary);
  return aggregated;
}

/**
 * The default `ProfilePackageManager` adapter: prefers pi's
 * `DefaultPackageManager` and falls back to a direct pnpm invocation when
 * the pi adapter rejects an install (e.g. legacy `file:` specifiers that
 * pre-date pi 0.85's strict source parser).
 *
 * `install` keeps the `Promise<void>` return type so the typed facade
 * contract is unchanged; richer per-install state lives in the
 * `lastInstallResult` module export, which callers opt into.
 */
export const defaultProfilePackageManager: ProfilePackageManager = {
  async install(profileDir, source) {
    const specifier = classifySpecifier(source);
    let piError: unknown;
    try {
      const pm = await buildAdapter(profileDir);
      await pm.install(source, { local: true });
      lastInstallResult = { ok: true, channel: "pi", specifier } satisfies PackageInstallResult;
      return;
    } catch (error) {
      piError = error;
    }
    let pnpmError: unknown;
    try {
      await fallbackPnpmInstall(profileDir, source);
      if (process.env.OPENBUDDY_PROFILE_PACKAGE_DEBUG === "1" && piError) {
        process.stderr.write(`[default-package-manager-adapter] pi install rejected (${specifier}): ${(piError as Error).message}\n`);
      }
      lastInstallResult = { ok: true, channel: "pnpm-fallback", specifier, piError: (piError as Error)?.message } satisfies PackageInstallResult;
      return;
    } catch (error) {
      pnpmError = error;
    }
    lastInstallResult = {
      ok: false,
      channel: "both-failed",
      specifier,
      piError: (piError as Error)?.message,
      pnpmError: (pnpmError as Error)?.message,
    } satisfies PackageInstallResult;
    throw aggregateInstallErrors(specifier, source, piError, pnpmError);
  },
  async remove(profileDir, packageName) {
    let piError: unknown;
    try {
      const pm = await buildAdapter(profileDir);
      await pm.remove(packageName, { local: true });
      return;
    } catch (error) {
      piError = error;
    }
    try {
      await fallbackPnpmRemove(profileDir, packageName);
      if (process.env.OPENBUDDY_PROFILE_PACKAGE_DEBUG === "1") {
        process.stderr.write(`[default-package-manager-adapter] pi remove rejected: ${(piError as Error).message}\n`);
      }
    } catch (pnpmError) {
      throw new AggregateError([piError, pnpmError], `profile-package: remove failed for ${packageName}; pi="${(piError as Error)?.message}"; pnpm="${(pnpmError as Error)?.message}"`);
    }
  },
};

/**
 * Last install result, exposed so the executor rollback path can read
 * which channel handled a given install without re-running classification.
 * PR 2 addition — PR 1 only exposed throw-based results.
 */
export let lastInstallResult: PackageInstallResult | undefined;
