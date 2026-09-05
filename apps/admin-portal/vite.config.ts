import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import react from "@vitejs/plugin-react";

const __dirname = dirname(fileURLToPath(import.meta.url));

const gatewayTarget = process.env.VITE_GATEWAY_URL || "http://localhost:8787";
const casdoorTarget = process.env.VITE_CASDOOR_URL || "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  server: {
    port: 5173,
    proxy: {
      "/api/gateway": {
        target: gatewayTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/gateway/, ""),
      },
      "/api/casdoor": {
        target: casdoorTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/casdoor/, ""),
      },
    },
  },
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
  },
});
