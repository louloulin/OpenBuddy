import { defineConfig } from "vitest/config";

/**
 * Per-package vitest config — keeps the SDK self-contained for CI runs.
 *
 * The SDK is a pure Node module: no jsdom, no DOM types, no electron
 * preload imports. `node` environment matches the way this package is
 * imported at runtime (it is consumed by the Electron main process
 * during plugin discovery).
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: false,
    pool: "forks",
    isolate: true,
  },
});
