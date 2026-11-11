/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Electron only trusts this loopback development origin.
const HOST = "127.0.0.1";
const PORT = 1420;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Mirror WorkBuddy's `@` alias so ported components resolve unchanged.
      "@": path.resolve(__dirname, "src"),
    },
  },
  // Relative assets support the packaged file:// renderer.
  base: "./",
  clearScreen: false,
  server: {
    host: HOST,
    port: PORT,
    strictPort: true,
    watch: { ignored: ["**/electron/**", "**/dist-electron/**", "**/release/**"] },
  },
  // Build assets for the packaged Electron renderer.
  build: {
    target: "es2021",
    // Split the heavy markdown / syntax-highlight libs out of the app
    // chunk so the main bundle stays small and fast to hot-reload.
    rollupOptions: {
      output: {
        manualChunks: {
          markdown: [
            "react-markdown",
            "remark-gfm",
            "remark-breaks",
            "remark-math",
            "rehype-highlight",
            "rehype-sanitize",
            "lowlight",
          ],
          katex: ["katex", "rehype-katex"],
          mermaid: ["mermaid"],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    // 不让 CSS import 在测试里报错(我们没装 jsdom CSS 处理)。
    css: false,
  },
});
