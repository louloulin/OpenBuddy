#!/usr/bin/env node
/**
 * OpenBuddy Admin Portal · Build 脚本
 *
 * 用法：
 *   node apps/admin-portal/scripts/build.mjs
 *
 * 这个脚本会：
 *   1. 检查依赖
 *   2. 调用 vite build（共享 root node_modules）
 *   3. 输出 apps/admin-portal/dist/ 静态文件
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..", "..");
const APP_DIR = resolve(__dirname, "..");

console.log("📦 OpenBuddy Admin Portal Build\n");
console.log(`  App:    ${APP_DIR}`);
console.log(`  Root:   ${ROOT}\n`);

const pkg = JSON.parse(readFileSync(resolve(APP_DIR, "package.json"), "utf8"));
console.log(`  Name:   ${pkg.name}@${pkg.version}`);

const requiredDeps = ["react", "react-dom", "react-router-dom", "zustand", "lucide-react"];
const missing = requiredDeps.filter((d) => !existsSync(resolve(ROOT, "node_modules", d)));
if (missing.length > 0) {
  console.warn(`⚠️  缺少依赖：${missing.join(", ")}`);
  console.warn(`   请在根目录运行: pnpm install\n`);
}

console.log("🔨 运行 vite build...\n");
try {
  execSync(
    `cd ${APP_DIR} && npx vite build --config ${resolve(APP_DIR, "vite.config.ts")}`,
    { stdio: "inherit", env: { ...process.env, NODE_ENV: "production" } },
  );
  console.log("\n✅ Build 完成。输出：apps/admin-portal/dist/\n");
} catch (err) {
  console.error("\n❌ Build 失败");
  process.exit(1);
}
