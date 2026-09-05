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
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

const rendererPackageAliases = {
  "@openbuddy/plugin-host/renderer-patch": resolve(__dirname, "packages/runtime/openbuddy-plugin-host/src/renderer-patch.ts"),
  "@openbuddy/plugin-host/yaml-patch": resolve(__dirname, "packages/runtime/openbuddy-plugin-host/src/yaml-patch.ts"),
  "@openbuddy/cordis": resolve(__dirname, "packages/runtime/openbuddy-cordis/src/index.ts"),
  "@openbuddy/renderer-host": resolve(__dirname, "packages/renderer/openbuddy-renderer-host/src/index.ts"),
};

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      ...rendererPackageAliases,
    },
  },
});
