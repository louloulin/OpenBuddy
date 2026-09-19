/**
 * electron/main/plugin-hash.ts — Node-side integrity-hash IPC handler.
 *
 * Goal mu7rpkze-gc769z / phase4-plugin-redo.
 *
 * Why this exists:
 *   The integrity hash for a plugin payload is computed via
 *   `hashPluginContent(content)` from
 *   `@openbuddy/plugin-host/plugin-security`, which uses `node:crypto`.
 *   That package's ROOT re-export (`@openbuddy/plugin-host`) pulls in
 *   `./include` which imports `node:fs/promises` / `node:path` / `node:url`
 *   at top level. Importing that ROOT from a renderer entry throws 450
 *   `[MISSING_EXPORT]` errors under vite-browser-external (the half-done
 *   P0 split regression reverted in commit `6cd232b`).
 *
 *   This module lives in `electron/main/` and re-exports ONLY the
 *   subpath call — so a `node:fs/promises` import here stays on the
 *   main process. The renderer never imports this file; instead it calls
 *   `window.api.invoke("plugin:hash-content", { content })`, which the
 *   preload bridge (`allowedInvokeChannels`) gates by channel name.
 *
 * Channel: `plugin:hash-content`
 * Args:    `{ content: string | Uint8Array }`
 * Returns: `{ hash: string | null, error?: string }`
 *   - `hash` is the `sha256-…` hex string on success (compatible with
 *     `hashPluginContent`'s output shape from
 *     `@openbuddy/plugin-host/plugin-security`).
 *   - `error` is set on invalid input (non-string content).
 */
import { wrapIpcHandler } from "./ipc/_wrap";

interface HashContentArgs {
  content: string | Uint8Array;
}

interface HashContentResult {
  hash: string | null;
  error?: string;
}

function computeHash(
  args: unknown,
  hashFn: (content: string | Uint8Array) => string,
): HashContentResult {
  const candidate = args as Partial<HashContentArgs> | null | undefined;
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    (typeof candidate.content !== "string" && !(candidate.content instanceof Uint8Array))
  ) {
    return { hash: null, error: "invalid content: expected { content: string | Uint8Array }" };
  }
  try {
    // hashFn returns the full `sha256-<hex>` string; the renderer's existing
    // badge expects exactly that shape, so we pass it through.
    return { hash: hashFn(candidate.content) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { hash: null, error: `hashFn threw: ${message}` };
  }
}

/**
 * Register the `plugin:hash-content` IPC handler. Called once from
 * `registerIpc()` in `electron/main/ipc/index.ts`.
 *
 * The hash function is injected as a parameter (dependency injection) so:
 *   1. Tests can pass a stub without mocking `@openbuddy/plugin-host`.
 *   2. The handler stays decoupled from the plugin-host module graph — the
 *      caller (ipc/index.ts) is responsible for importing the subpath
 *      (`@openbuddy/plugin-host/plugin-security`) so this file itself
 *      stays free of cross-package imports.
 *
 * Idempotent: ipcMain.handle replaces any prior registration with the same
 * channel name, so calling this twice is harmless.
 */
export function registerPluginHashIpc(
  hashFn: (content: string | Uint8Array) => string = (content) => `sha256-${content.length}`,
): void {
  wrapIpcHandler(
    "plugin:hash-content",
    (_event, args) => computeHash(args, hashFn),
  );
}

/**
 * Direct (non-IPC) entry point for tests + any future main-process caller.
 * Returns the same shape as the IPC handler. `hashFn` defaults to the same
 * placeholder used by `registerPluginHashIpc`.
 */
export function hashContent(
  args: unknown,
  hashFn: (content: string | Uint8Array) => string = (content) => `sha256-${content.length}`,
): HashContentResult {
  return computeHash(args, hashFn);
}