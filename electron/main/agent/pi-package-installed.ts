/**
 * pi-package-installed.ts — detect whether a pi.dev package is installed.
 * Used by the compatibility adapter layer to decide whether to auto-
 * passthrough the native pi extension.
 *
 * Detection rule: a package is "installed" when ANY of these resolve:
 *   (1) `require.resolve(pkg)` from the repo root succeeds (CJS-style
 *       packages with `main` or `exports.require`), OR
 *   (2) `<root>/node_modules/<pkg>/package.json` exists on disk (covers
 *       pure-ESM packages whose `exports` field has no `require` entry), OR
 *   (3) `<agentHome>/plugins/<pkg>/package.json` exists (covers packages
 *       installed via the marketplace, which `cp -r` into the agent-scoped
 *       plugins tree; projectRoot never sees them, so without (3) every
 *       marketplace-installed package was reported as "not installed" and
 *       the auto-passthrough path never fired).
 *
 * The marketplace install flow was the only path that ended up in (3),
 * so this is the missing probe that closes the loop documented in
 * docs/PI-PRIORITY.md and surfaced by Task #80 verification.
 *
 * All probes are intentionally cheap — pi dev packages are npm packages,
 * so we just walk Node's resolution paths and fall back to filesystem
 * probes in priority order.
 */

import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { agentHome } from "./agent-home";

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), "..", "..", "..");

const requireFromRoot = createRequire(resolve(projectRoot, "package.json"));

function readPackageJsonOnDisk(packageJsonPath: string): { version?: string } | null {
  if (!existsSync(packageJsonPath)) return null;
  try {
    return JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string };
  } catch {
    return null;
  }
}

/**
 * R-X1: probe the marketplace plugin install location. Returns the parsed
 * package.json (with at least a `version`) when found, or null otherwise.
 *
 * The marketplace installer copies npm tarballs/extracts to
 * `<agentHome>/plugins/<name>/`, so the npm `name` field is the same key
 * we receive here. Falls through to null when the directory or its
 * package.json is missing, or when JSON parsing fails.
 */
function readMarketplacePackageJson(packageName: string): { version?: string } | null {
  const candidate = join(agentHome(), "plugins", packageName, "package.json");
  return readPackageJsonOnDisk(candidate);
}

function readProjectPackageJson(packageName: string): { version?: string } | null {
  const candidate = resolve(projectRoot, "node_modules", packageName, "package.json");
  return readPackageJsonOnDisk(candidate);
}

export function isPiPackageInstalled(packageName: string): boolean {
  if (!packageName) return false;
  // 1) Fastest path: Node CJS resolver from project root.
  try {
    requireFromRoot.resolve(packageName);
    return true;
  } catch {
    // fall through to disk probes
  }
  // 2) Project-root node_modules probe.
  if (readProjectPackageJson(packageName) !== null) return true;
  // 3) Marketplace plugin tree probe (R-X1).
  if (readMarketplacePackageJson(packageName) !== null) return true;
  return false;
}

export interface PiPackageProbeResult {
  installed: boolean;
  version: string | null;
}

/**
 * Returns both a presence flag and the resolved version (when available) so
 * the caller can log it for debugging and the renderer can surface it in
 * "about" panels.
 *
 * The probe order matches `isPiPackageInstalled`: CJS resolve wins,
 * then project node_modules, then marketplace plugins. The first probe
 * that returns a `version` short-circuits the rest so we report the
 * same source the presence check would have matched.
 */
export function probePiPackage(packageName: string): PiPackageProbeResult {
  if (!packageName) return { installed: false, version: null };
  // 1) CJS resolve from project root.
  try {
    requireFromRoot.resolve(packageName);
    const pkg = readProjectPackageJson(packageName);
    return {
      installed: true,
      version: pkg && typeof pkg.version === "string" ? pkg.version : null,
    };
  } catch {
    // fall through
  }
  // 2) Project-root node_modules probe.
  {
    const pkg = readProjectPackageJson(packageName);
    if (pkg) {
      return {
        installed: true,
        version: typeof pkg.version === "string" ? pkg.version : null,
      };
    }
  }
  // 3) Marketplace plugin tree probe (R-X1).
  {
    const pkg = readMarketplacePackageJson(packageName);
    if (pkg) {
      return {
        installed: true,
        version: typeof pkg.version === "string" ? pkg.version : null,
      };
    }
  }
  return { installed: false, version: null };
}