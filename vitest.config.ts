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
 */
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["src/**/__tests__/**/*.{test,spec}.{ts,tsx}", "packages/**/__tests__/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
    globals: false,
  },
});
