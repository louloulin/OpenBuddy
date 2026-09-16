/**
 * R18 — 真实启动 Electron + 捕获 plugin/loaded 事件 stdout,验证
 * bridge-installed extension 真的被 initPiUserExtensions 拾起。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-pi-stdout-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

// 预置 Pi Extension
const piExtRoot = join(userData, "pi-extensions");
const extDir = join(piExtRoot, "demo.pi-sample");
const verDir = join(extDir, "1.0.0");
mkdirSync(verDir, { recursive: true });

writeFileSync(join(extDir, "current"), "1.0.0\n");
writeFileSync(join(verDir, "openbuddy.plugin.json"), JSON.stringify({
  schema: "openbuddy.plugin.v1",
  id: "demo.pi-sample",
  version: "1.0.0",
  surface: "pi",
  provides: [{ type: "tool", name: "demo-hello", description: "打招呼" }],
}, null, 2));
writeFileSync(join(piExtRoot, "installed.json"), JSON.stringify({
  version: 1,
  extensions: {
    "demo.pi-sample": {
      version: "1.0.0",
      path: verDir,
      installedAt: new Date().toISOString(),
      integrity: "r18-runtime-stdout-test",
      history: [],
      capabilities: ["tools.demo-hello"],
    },
  },
}, null, 2));

// 用本机 node_modules 的 electron binary 跑,捕获 stderr 拿到 plugin/loaded 日志
const electronBin = join(ROOT, "node_modules", ".bin", "electron");
console.log("LAUNCHING:", electronBin, "with userData=", userData);

const proc = spawn(electronBin, [`--user-data-dir=${userData}`, ROOT], {
  cwd: ROOT,
  env: { ...process.env },
});

const lines = [];
let pluginLoadCount = 0;
let pluginReadyCount = 0;
let demoFound = false;
let failedEvents = 0;

proc.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  const newLines = text.split("\n");
  for (const line of newLines) {
    if (line.includes("plugin/loaded") || line.includes("plugin/failed") || line.includes("plugin/ready") || line.includes("init-pipeline")) {
      console.log("[STDOUT]", line.slice(0, 250));
      if (line.includes("plugin/loaded")) pluginLoadCount++;
      if (line.includes("plugin/ready")) pluginReadyCount++;
      if (line.includes("plugin/failed")) failedEvents++;
      if (line.includes("demo.pi-sample") || line.includes("/pi-extensions/")) demoFound = true;
    }
    lines.push(line);
  }
});
proc.stderr.on("data", (chunk) => {
  const text = chunk.toString();
  for (const line of text.split("\n")) {
    if (line.includes("plugin/loaded") || line.includes("plugin/failed") || line.includes("init-pipeline")) {
      console.log("[STDERR]", line.slice(0, 250));
      if (line.includes("plugin/loaded")) pluginLoadCount++;
      if (line.includes("plugin/failed")) failedEvents++;
      if (line.includes("demo.pi-sample")) demoFound = true;
    }
  }
});

// Wait up to 30 seconds
await new Promise((resolve) => setTimeout(resolve, 30000));
proc.kill();
await new Promise((r) => proc.on("exit", r));

console.log("\n=== STDOUT SUMMARY ===");
console.log("plugin/loaded events:", pluginLoadCount);
console.log("plugin/failed events:", failedEvents);
console.log("plugin/ready events:", pluginReadyCount);
console.log("demo.pi-sample mentioned:", demoFound);

process.exit(demoFound ? 0 : 1);
