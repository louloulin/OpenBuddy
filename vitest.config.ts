/// <reference types="vitest" />
/**
 * Vitest-only configuration for OpenBuddy.
 *
 * The renderer/build/dev pipeline is driven by `electron.vite.config.ts`;
 * this file keeps the renderer's dependency graph small. Tests use the
 * separate `vitest.config.ts`, which carries the full workspace alias map.
 *
 * If a new workspace package is used by the renderer, mirror its alias here
 * and in `electron.vite.config.ts`.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

const workspacePackageAliases: Array<{ find: string; replacement: string }> = [
  { find: "@openbuddy/plugin-host/remote-codec", replacement: resolve(__dirname, "packages/runtime/openbuddy-plugin-host/src/remote-codec.ts") },
  { find: "@openbuddy/plugin-host/rpc-contract", replacement: resolve(__dirname, "packages/runtime/openbuddy-plugin-host/src/rpc-contract.ts") },
  { find: "@openbuddy/plugin-host/bundle-manifest", replacement: resolve(__dirname, "packages/runtime/openbuddy-plugin-host/src/bundle-manifest.ts") },
  { find: "@openbuddy/plugin-host/persistence", replacement: resolve(__dirname, "packages/runtime/openbuddy-plugin-host/src/persistence.ts") },
  { find: "@openbuddy/plugin-host/renderer-patch", replacement: resolve(__dirname, "packages/runtime/openbuddy-plugin-host/src/renderer-patch.ts") },
  { find: "@openbuddy/plugin-host/yaml-patch", replacement: resolve(__dirname, "packages/runtime/openbuddy-plugin-host/src/yaml-patch.ts") },
  { find: "@openbuddy/plugin-host/js-expr", replacement: resolve(__dirname, "packages/runtime/openbuddy-plugin-host/src/js-expr.ts") },
  { find: "@openbuddy/team-team/pi", replacement: resolve(__dirname, "packages/team/openbuddy-team/src/pi.ts") },
  { find: "@openbuddy/cordis", replacement: resolve(__dirname, "packages/runtime/openbuddy-cordis/src/index.ts") },
  { find: "@openbuddy/bundle-base/renderer", replacement: resolve(__dirname, "packages/bundle/openbuddy-base/src/renderer.ts") },
  { find: "@openbuddy/plugin-host", replacement: resolve(__dirname, "packages/runtime/openbuddy-plugin-host/src/index.ts") },
  { find: "@openbuddy/bundle-base", replacement: resolve(__dirname, "packages/bundle/openbuddy-base/src/index.ts") },
  { find: "@openbuddy/renderer-host", replacement: resolve(__dirname, "packages/renderer/openbuddy-renderer-host/src/index.ts") },
  { find: "@openbuddy/core-session/lifecycle", replacement: resolve(__dirname, "packages/core/openbuddy-session/src/lifecycle.ts") },
  { find: "@openbuddy/core-session", replacement: resolve(__dirname, "packages/core/openbuddy-session/src/index.ts") },
  { find: "@openbuddy/capability-plan", replacement: resolve(__dirname, "packages/capability/openbuddy-plan/src/index.ts") },
  { find: "@openbuddy/capability-authorization", replacement: resolve(__dirname, "packages/capability/openbuddy-authorization/src/index.ts") },
  { find: "@openbuddy/auth-permission", replacement: resolve(__dirname, "packages/auth/openbuddy-permission/src/index.ts") },
  { find: "@openbuddy/auth-casdoor", replacement: resolve(__dirname, "packages/auth/openbuddy-casdoor/src/index.ts") },
  { find: "@openbuddy/shared-types", replacement: resolve(__dirname, "packages/shared/openbuddy-types/src/index.ts") },
  { find: "@openbuddy/files-kb", replacement: resolve(__dirname, "packages/shared/openbuddy-files-kb/src/index.ts") },
  { find: "@openbuddy/logging-shared", replacement: resolve(__dirname, "packages/shared/openbuddy-logging-shared/src/index.ts") },
  { find: "@openbuddy/logging-main", replacement: resolve(__dirname, "packages/core/openbuddy-logging-main/src/index.ts") },
  { find: "@openbuddy/logging-renderer", replacement: resolve(__dirname, "packages/core/openbuddy-logging-renderer/src/index.ts") },
  { find: "@openbuddy/fs-fs-local", replacement: resolve(__dirname, "packages/fs/openbuddy-fs-local/src/index.ts") },
  { find: "@openbuddy/team-team", replacement: resolve(__dirname, "packages/team/openbuddy-team/src/index.ts") },
  { find: "@openbuddy/collaboration-protocol", replacement: resolve(__dirname, "packages/collaboration/openbuddy-protocol/src/index.ts") },
  { find: "@openbuddy/collaboration-policy", replacement: resolve(__dirname, "packages/collaboration/openbuddy-policy/src/index.ts") },
  { find: "@openbuddy/collaboration-task", replacement: resolve(__dirname, "packages/collaboration/openbuddy-task/src/index.ts") },
  { find: "@openbuddy/collaboration-evidence", replacement: resolve(__dirname, "packages/collaboration/openbuddy-evidence/src/index.ts") },
  { find: "@openbuddy/collaboration-room", replacement: resolve(__dirname, "packages/collaboration/openbuddy-room/src/index.ts") },
  { find: "@openbuddy/collaboration-inbox", replacement: resolve(__dirname, "packages/collaboration/openbuddy-inbox/src/index.ts") },
  { find: "@openbuddy/collaboration-coordinator", replacement: resolve(__dirname, "packages/collaboration/openbuddy-coordinator/src/index.ts") },
  { find: "@openbuddy/collaboration-network", replacement: resolve(__dirname, "packages/collaboration/openbuddy-network/src/index.ts") },
  { find: "@openbuddy/storage", replacement: resolve(__dirname, "packages/runtime/openbuddy-storage/src/index.ts") },
];

// Auto-discover packages/ui/* and build aliases from each package's
// package.json exports. This keeps Vite resolution in sync with the
// tsconfig.json paths that scripts/sync-ui-aliases.mjs maintains.
function discoverUiAliases(): Array<{ find: string; replacement: string }> {
  const uiDir = resolve(__dirname, "packages/ui");
  const out: Array<{ find: string; replacement: string }> = [];
  if (!existsSync(uiDir)) return out;
  for (const entry of readdirSync(uiDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("openbuddy-ui-")) continue;
    const dir = entry.name;
    const pkgPath = join(uiDir, dir, "package.json");
    if (!existsSync(pkgPath)) continue;
    let pkg: { name?: string; exports?: Record<string, unknown> };
    try {
      pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    } catch {
      continue;
    }
    if (!pkg.name) continue;
    const exports = pkg.exports || {};
    for (const [subpath, target] of Object.entries(exports)) {
      if (!subpath.startsWith(".")) continue;
      if (typeof target !== "string") continue;
      let seg = subpath.slice(1);
      if (seg.startsWith("/")) seg = seg.slice(1);
      const aliasKey = pkg.name + (seg ? "/" + seg : "");
      // targets look like "./src/index.ts" or "./client.tsx"; resolve to
      // the file under packages/ui/<dir>/.
      const filePath = resolve(uiDir, dir, target.replace(/^\.\//, ""));
      if (existsSync(filePath)) {
        out.push({ find: aliasKey, replacement: filePath });
      }
    }
  }
  // Sort longest find first so subpath aliases win over bare-package
  // aliases (e.g. `@openbuddy/ui-account/invariant` must beat
  // `@openbuddy/ui-account`).
  return out.sort((a, b) => b.find.length - a.find.length);
}

export default defineConfig({
  resolve: {
    alias: [
      { find: "@", replacement: resolve(__dirname, "src") },
      { find: "pg", replacement: resolve(__dirname, "services/casdoor-resource-gateway/src/__pg-stub__.ts") },
      { find: "mysql2/promise", replacement: resolve(__dirname, "services/casdoor-resource-gateway/src/__mysql2-stub__.ts") },
      ...discoverUiAliases(),
      ...workspacePackageAliases,
    ],
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: [resolve(__dirname, "src/test-setup.ts")],
    css: false,
    // OpenBuddy ships a CLI in `bin/` with its own Node-only test file.
    // Mark it as node-environment so the file-system + child-process
    // helpers work without jsdom overhead.
    environmentMatchGlobs: [
      ["bin/__tests__/**", "node"],
    ],
    exclude: ["**/node_modules/**", "**/.worktrees/**", "**/dist/**", "tests/electron/**"],
  },
});
