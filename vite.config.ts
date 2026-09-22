/// <reference types="vitest" />
/**
 * Vitest configuration for OpenBuddy.
 *
 * The renderer/build/dev pipeline is driven by `electron.vite.config.ts`;
 * this file keeps the renderer's dependency graph small.
 *
 * 2026-09 改造:用 `vite-tsconfig-paths` 从根 tsconfig.json 自动派生 alias,
 * 不再手写 ~50 个 `@openbuddy/*` 别名。新增包时只需在 tsconfig.json 的
 * paths 里加一条,本配置无需修改。
 */
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
});
