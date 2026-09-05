import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = resolve(import.meta.dirname, "..");

export default defineConfig({
  resolve: {
    alias: {
      "@openbuddy/collaboration-protocol": resolve(root, "packages/collaboration/openbuddy-protocol/src/index.ts"),
      "@openbuddy/collaboration-task": resolve(root, "packages/collaboration/openbuddy-task/src/index.ts"),
      "@openbuddy/collaboration-evidence": resolve(root, "packages/collaboration/openbuddy-evidence/src/index.ts"),
      "@openbuddy/collaboration-coordinator": resolve(root, "packages/collaboration/openbuddy-coordinator/src/index.ts"),
      "@openbuddy/collaboration-network": resolve(root, "packages/collaboration/openbuddy-network/src/index.ts"),
      "@openbuddy/collaboration-inbox": resolve(root, "packages/collaboration/openbuddy-inbox/src/index.ts"),
      "@openbuddy/collaboration-room": resolve(root, "packages/collaboration/openbuddy-room/src/index.ts"),
    },
  },
  ssr: { noExternal: true },
  build: {
    outDir: process.env.OPENBUDDY_PROCESS_WORKER_OUT ?? resolve(root, "out/collaboration-process-worker"),
    emptyOutDir: true,
    ssr: resolve(root, "electron/main/collaboration/collaboration-process-worker.ts"),
    target: "node20",
    rollupOptions: {
      external: ["ws"],
      output: { entryFileNames: "collaboration-process-worker.mjs" },
    },
    ssrEmitAssets: false,
  },
});
