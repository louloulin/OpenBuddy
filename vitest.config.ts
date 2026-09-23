/// <reference types="vitest" />
/**
 * Vitest configuration for OpenBuddy.
 *
 * 2026-09 改造:用 `vite-tsconfig-paths` 从根 tsconfig.json 自动派生 alias,
 * 不再手写 ~50 个 `@openbuddy/*` 别名。新增包时只需在 tsconfig.json 的
 * paths 里加一条,本配置无需修改。
 *
 * `vite-tsconfig-paths` 同时被 vite.config.ts 和 electron.vite.config.ts 使用,
 * 三个配置文件共享同一份 tsconfig.json paths 作为单一来源。
 *
 * 环境策略:
 *   - 默认 jsdom — React DOM / window.localStorage / document 等 DOM API 测试必需
 *   - bin/ 和 tests/integration/ 走 node — 避免 jsdom 开销,允许 child_process
 *   - 单一 setup 文件(`src/test-setup.ts`) — jsdom 全局 mock,vi globals
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths()],
  // P0-01 — Workaround for the 13 pre-existing vitest failures whose root
  // cause is `@openbuddy/ui-state/global-confirm-store` being statically
  // imported (transitively, via `electron-api.ts`'s dynamic import) by
  // every test that touches the platform bridge. `vite-tsconfig-paths`
  // doesn't resolve the subpath through the package `exports` map in
  // static-analysis mode, so we point the import at the actual file.
  //
  // Alias is scoped to vitest only (this file is just for diagnostics, so
  // production builds via electron.vite.config.ts are unaffected).
  resolve: {
    alias: {
      "@openbuddy/ui-state/global-confirm-store": resolve(__dirname, "packages/ui/openbuddy-ui-state/src/global-confirm-store.ts"),
    },
  },
  test: {
    include: ["src/**/__tests__/**/*.{test,spec}.{ts,tsx}", "packages/**/__tests__/**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "**/node_modules/**",
      "**/.worktrees/**",
      "**/dist/**",
      "tests/electron/**",
      // `scripts/perf/*.test.mjs` use `node:test` and run via `pnpm perf:cold-start:test`.
      // Vitest cannot discover their suites (no `describe/it` API surface), so we keep
      // them out of the vitest discovery pass to avoid a noisy "No test suite found" failure.
      "scripts/perf/**/*.test.mjs",
      // `scripts/electron/_*.test.mjs` are vitest wrappers around live-Electron
      // probes: they spawn a real Electron process against the packaged app, so
      // Vitest must not collect them. They are driven via moon/scripts instead.
      "scripts/electron/_*.test.mjs",
    ],
    globals: true,
    environment: "jsdom",
    setupFiles: [resolve(__dirname, "src/test-setup.ts")],
    css: false,
    // Mark `bin/__tests__/**` and `tests/integration/**` as node-environment so
    // the file-system + child-process helpers work without jsdom overhead.
    environmentMatchGlobs: [
      ["bin/__tests__/**", "node"],
      ["tests/integration/**", "node"],
    ],
  },
});
