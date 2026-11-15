import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import type { EngineContext } from "../engine-context.js";
import { reserveBuiltinToolNames } from "../builtin/reserved-tools.js";

/**
 * 扩展中心 (20261116-pii W2.6 / U7.3): what one extension registers.
 *
 * Loading is isolated from the live sessions (`discoverAndLoadExtensions` with just the paths we
 * ask about), so a broken extension cannot affect a running session — and the UI can preview a
 * path *before* it is added to the settings.
 */
export interface ExtensionReport {
  /** The configured path (or the path the user is previewing). */
  path: string;
  /** Absolute path Pi resolved it to (null when loading failed). */
  resolvedPath: string | null;
  ok: boolean;
  tools: string[];
  commands: string[];
  shortcuts: string[];
  /** Why this path failed to load (null when it loaded). */
  error: string | null;
}

/** Load `paths` in an isolated loader and report each one's registrations or error. */
export async function inspectExtensions(
  engine: EngineContext,
  paths: readonly string[],
  cwd: string,
): Promise<ExtensionReport[]> {
  if (!paths.length) return [];
  // The same `ob_*` reservation the live loader applies, so a preview shows the same failure the
  // session would record (and "add" can refuse it).
  const result = reserveBuiltinToolNames(await discoverAndLoadExtensions([...paths], cwd, engine.settings.dir));
  const errors = new Map((result.errors ?? []).map((entry) => [entry.path, entry.error]));
  return paths.map((path) => {
    const ext = result.extensions.find((entry) => entry.path === path || entry.resolvedPath === path);
    // A path that produced neither an extension nor an error simply has no extension at it.
    const error = errors.get(path) ?? (ext ? null : "extension_not_found");
    return {
      path,
      resolvedPath: ext?.resolvedPath ?? null,
      ok: !!ext && !error,
      tools: ext ? [...ext.tools.keys()].sort() : [],
      commands: ext ? [...ext.commands.keys()].sort() : [],
      shortcuts: ext ? [...ext.shortcuts.keys()].sort() : [],
      error,
    };
  });
}
