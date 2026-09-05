import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    isolate: false,
    server: { deps: { external: ["node:sqlite"] } },
  },
  ssr: { external: ["node:sqlite"], noExternal: [] },
  optimizeDeps: { exclude: ["node:sqlite", "sqlite"] },
  build: { rollupOptions: { external: ["node:sqlite"] } },
});
