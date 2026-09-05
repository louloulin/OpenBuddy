/**
 * pi-extension-discovery.ts — auto-discover npm-installable Pi extension
 * packages under node_modules so Pi's DefaultResourceLoader can load them.
 *
 * Stage D F3: Pi's DefaultResourceLoader scans `~/.pi/agent/plugins/<n>`
 * and `<cwd>/.pi/plugins/<n>` by default. Users who install a Pi extension
 * via `npm install pi-<name>` (e.g. `pi-mcp-adapter`, `pi-hermes-memory`)
 * expect it to be picked up automatically without editing the profile.
 *
 * This module walks a curated list of canonical pi.dev extension package
 * names and probes node_modules-style locations to produce absolute paths
 * that can be appended to `additionalExtensionPaths`.
 *
 * Discovery is best-effort: any failure (ENOENT, permission, parse error)
 * silently drops the package so the loader never blocks on it.
 */
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const CANONICAL_PI_PACKAGES: readonly string[] = [
  // P0 memory + tasks
  "pi-hermes-memory",
  "@remnic/plugin-pi",
  "@juicesharp/rpiv-todo",
  "@anthropic/pi-todo",
  // P0 web + MCP
  "pi-web-access",
  "@diegopetrucci/pi-web-access",
  "pi-mcp-adapter",
  // Plan + permission
  "pi-plan-mode",
  "@narumitw/pi-plan-mode",
  "@arvoretech/pi-plan-mode",
  "@plannotator/pi-extension",
  "pi-permission-system",
  // Folder trust + notification
  "pi-folder-trust",
  "@anthropic/pi-folder-trust",
  "pi-notification",
  "@anthropic/pi-notification",
  // Goal + automation + subagents
  "pi-goal",
  "pi-goal-x",
  "@narumitw/pi-goal",
  "pi-automation",
  "pi-workflow",
  "pi-cron",
  "pi-schedule",
  "@anthropic/pi-automation",
  "pi-subagents",
  // Whitelisted zero-cost pi extensions
  "pi-lens",
  "pi-simplify",
  "pi-hashline",
  "pi-worktree",
];

/**
 * Standard extension entry points Pi packages export. We probe each one in
 * order so a package that uses an unconventional entry (e.g. ESM-only) is
 * still discoverable.
 */
const ENTRY_CANDIDATES: readonly string[] = [
  "extension.js",
  "index.js",
  "dist/extension.js",
  "src/extension.js",
];

function nodeModulesRoots(): string[] {
  const roots = new Set<string>();
  // Current working directory is the most common install location for
  // users who `npm install pi-<name>` in their project.
  try {
    roots.add(resolve(process.cwd(), "node_modules"));
  } catch {
    // ignore
  }
  // The Electron main process directory is the second-most-common install
  // location for global pi extensions shipped with the app.
  try {
    const electronRoot = dirname(resolve(process.argv[1] ?? "."));
    roots.add(join(electronRoot, "node_modules"));
  } catch {
    // ignore
  }
  // `~/.pi/agent/node_modules` is the recommended per-user install root
  // for system-wide pi extensions.
  try {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    if (home) roots.add(join(home, ".pi", "agent", "node_modules"));
  } catch {
    // ignore
  }
  return Array.from(roots);
}

function probePackageDir(packageDir: string): string | undefined {
  if (!existsSync(packageDir)) return undefined;
  try {
    if (!statSync(packageDir).isDirectory()) return undefined;
  } catch {
    return undefined;
  }
  for (const entry of ENTRY_CANDIDATES) {
    const candidate = join(packageDir, entry);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function packageDirFromRoot(root: string, packageName: string): string {
  if (packageName.startsWith("@")) {
    const [scope, name] = packageName.split("/");
    return join(root, scope!, name!);
  }
  return join(root, packageName);
}

export interface DiscoveredPiPackage {
  packageName: string;
  entryPath: string;
  root: string;
}

/**
 * Probe every canonical pi package name under the well-known node_modules
 * roots. Returns the first absolute path found for each package so callers
 * can append them to `DefaultResourceLoader.additionalExtensionPaths`.
 *
 * Safe to call repeatedly; no caching is needed because the function is
 * pure I/O and runs only at agent boot.
 */
export function discoverInstalledPiPackages(): readonly DiscoveredPiPackage[] {
  const results: DiscoveredPiPackage[] = [];
  const seen = new Set<string>();
  for (const root of nodeModulesRoots()) {
    if (!existsSync(root)) continue;
    for (const pkg of CANONICAL_PI_PACKAGES) {
      if (seen.has(pkg)) continue;
      const dir = packageDirFromRoot(root, pkg);
      const entry = probePackageDir(dir);
      if (entry) {
        results.push({ packageName: pkg, entryPath: entry, root });
        seen.add(pkg);
      }
    }
  }
  return results;
}

/**
 * Convenience helper for callers that only need absolute paths (e.g. the
 * agent-host extension resolver that feeds `additionalExtensionPaths`).
 */
export function discoveredPiPackagePaths(): readonly string[] {
  return discoverInstalledPiPackages().map((entry) => entry.entryPath);
}
