import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Repo-wide tests (apps/* and packages/*). Aliases mirror apps/web/vite.config.ts and tsconfig paths.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\//, replacement: path.resolve(__dirname, "apps/web/src") + "/" },
      { find: /^@openbuddy\/([^/]+)$/, replacement: path.resolve(__dirname, "packages") + "/$1/src/index.ts" },
      { find: /^@openbuddy\/([^/]+)\/(.*)$/, replacement: path.resolve(__dirname, "packages") + "/$1/src/$2" },
    ],
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./apps/web/src/test-setup.ts"],
    // 不让 CSS import 在测试里报错(我们没装 jsdom CSS 处理)。
    css: false,
    // Agent worktrees live under .claude/worktrees; their copies are not this checkout's tests.
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
