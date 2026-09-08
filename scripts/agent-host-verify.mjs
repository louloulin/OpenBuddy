#!/usr/bin/env node
/**
 * agent-host-verify.mjs — 持续验证 agent-host v6-G 改造方案的 4 个里程碑
 *
 * 验证项:
 *   M1 agent-host.ts < 1500 行
 *   M2 host-modules/** 反向依赖 = 0
 *   M3 openbuddy-core-plugin.ts 单一 capability mount = 0
 *   M4 facade 文件计数 + install 单点性
 *
 * 用法: node scripts/agent-host-verify.mjs
 * 退出码: 0 (全部通过) | 1 (有失败)
 */
import { readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "electron", "main", "agent");

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
}
function safeExec(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    return (err.stdout ?? "") + (err.stderr ?? "");
  }
}

// 工具: 把 `line:content` 或 `path:line:content` 格式的 grep 输出拆出 code 部分
function extractCode(line) {
  // 匹配行首或路径后的 :digits: (grep -n 输出, 或 grep -rn 输出)
  const m = line.match(/(?:^|:)(\d+):(.*)$/);
  return m ? m[2].trim() : line.trim();
}

// M1: agent-host.ts < 1500 行
const lineCount = parseInt(safeExec(`wc -l < "${ROOT}/agent-host.ts"`).trim() || "0", 10);
check("M1: agent-host.ts 行数 < 1500", lineCount < 1500, `actual=${lineCount}, target=<1500`);

// M2: host-modules/** 反向依赖 = 0
const reverseDeps = safeExec(
  `grep -rn "from '\\.\\./agent-host'\\|from '\\.\\./\\.\\./agent-host'" "${ROOT}/host-modules/" 2>/dev/null || true`,
);
check("M2: host-modules/** 反向依赖 = 0", reverseDeps === "", reverseDeps ? reverseDeps.slice(0, 500) : "none");

// M3: openbuddy-core-plugin.ts 实际 capability mount 调用 = 0 (排除注释行)
const dualTrackRaw = safeExec(
  `grep -nE "mountPermission|mountGoal|mountSession|mountFsLocal" "${ROOT}/openbuddy-core-plugin.ts" 2>/dev/null || true`,
);
const dualTrack = dualTrackRaw.split("\n").filter((line) => {
  if (!line) return false;
  const code = extractCode(line);
  return !(code.startsWith("//") || code.startsWith("*"));
}).join("\n");
check(
  "M3: openbuddy-core-plugin.ts 实际 capability mount = 0",
  dualTrack === "",
  dualTrack ? dualTrack.slice(0, 500) : "none (注释行已忽略)",
);

// M4a: facade/ 目录存在且文件数
const facadeDir = join(ROOT, "host-modules", "facade");
let facadeCount = 0;
if (existsSync(facadeDir)) {
  facadeCount = readdirSync(facadeDir).filter((f) => f.endsWith(".ts")).length;
}
check("M4a: host-modules/facade/ 至少 20 个 .ts", facadeCount >= 20, `actual=${facadeCount}, target=>=20`);

// M4b: installMicrokernelHost 在生产代码只调用 1 次
const installCallMatches = safeExec(
  `grep -rnE "(^|[^.a-zA-Z_])installMicrokernelHost\\s*\\(" "${ROOT}/" 2>/dev/null | grep -v ".test.ts" | grep -v "init-pipeline.ts" || true`,
);
const installCallLines = installCallMatches.split("\n").filter((line) => {
  if (!line) return false;
  const code = extractCode(line);
  if (code.includes("function installMicrokernelHost")) return false;
  if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return false;
  return true;
});
check(
  "M4b: installMicrokernelHost 在生产代码只调用 1 次",
  installCallLines.length === 1,
  `actual=${installCallLines.length}, target=1\n${installCallLines.join("\n")}`,
);

// 汇总
const failed = checks.filter((c) => !c.ok);
const passed = checks.length - failed.length;

const result = {
  framework: "openbuddy-agent-host-verify",
  schema: "openbuddy.verify.v1",
  timestamp: new Date().toISOString(),
  passed,
  failed: failed.length,
  total: checks.length,
  checks: checks.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail })),
  summary: failed.length === 0 ? "all milestones satisfied" : `${failed.length} milestone(s) pending`,
};

console.log(JSON.stringify(result, null, 2));
process.exit(failed.length > 0 ? 1 : 0);
