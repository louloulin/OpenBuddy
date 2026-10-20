/**
 * 架构守卫:host-core bridge 的每个能力函数都必须被生产代码消费。
 *
 * 背景:2026-09-29 的全仓审计发现,audit / workspace / session_search 三个
 * Rust 能力模块(约 1500 行)+ 对应 TS bridge 全部实现完毕、注释里明确声称
 * 「已接线」,但**没有任何业务调用点**。bridge 永远走降级分支,Rust 能力
 * 一次都没执行过。这不是编译期能发现的问题 —— 导出、类型、单测全绿,只是
 * 没有活人在用它。
 *
 * 本测试就是那道缺失的防线:任何新加的 `*ViaBridge` 若只被自己的单测引用,
 * 这里立刻失败。
 *
 * 判定规则(`*ViaBridge` 函数被视为已接线,当且仅当):
 *   1. 函数名出现在自身模块之外、且不在 `__tests__` 里的某个源文件中;或
 *   2. 函数被收进本模块导出的 facade 对象(如 `agentPermissionBridge`),
 *      且该对象名出现在自身模块之外、且不在 `__tests__` 里的某个源文件中。
 *
 *   第 2 条是必需的:`agent-permission-bridge.ts` 把 5 个能力打包成
 *   `agentPermissionBridge` 对象再被 host-modules 消费,裸名字 grep 会误判。
 *
 * 不检查 `attach*` / `reset*` / `*BridgeState`:前者是 boot 装配点,后者是
 * 调试探针,都不代表「业务用到了这个能力」。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../../../../..");

/** 受管辖的 host-core bridge 模块。 */
const BRIDGE_FILES = [
  "electron/main/agent/agent-permission-bridge.ts",
  "electron/main/agent/agent-secret-store-bridge.ts",
  "electron/main/agent/agent-session-search-bridge.ts",
  "electron/main/agent/agent-workspace-bridge.ts",
  "electron/main/agent/agent-audit-bridge.ts",
] as const;

/** 会被本测试遍历的源码根。 */
const SCAN_ROOTS = ["electron", "src", "packages"] as const;

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", "build", "coverage", ".moon"]);

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const ALL_SOURCE_FILES = SCAN_ROOTS.flatMap((root) => {
  const abs = join(REPO_ROOT, root);
  return statSync(abs).isDirectory() ? collectSourceFiles(abs) : [];
});

/** 生产代码:排除测试文件。 */
const PRODUCTION_FILES = ALL_SOURCE_FILES.filter(
  (file) => !/__tests__|\.test\.(ts|tsx)$|\.spec\.(ts|tsx)$/.test(file),
);

function isReferencedByProduction(symbol: string, ownFile: string): boolean {
  const pattern = new RegExp(`\\b${symbol}\\b`);
  return PRODUCTION_FILES.some(
    (file) => resolve(file) !== resolve(ownFile) && pattern.test(readFileSync(file, "utf-8")),
  );
}

interface CapabilityFn {
  name: string;
  ownFile: string;
  facade?: string;
}

function collectCapabilities(ownFile: string): CapabilityFn[] {
  const source = readFileSync(ownFile, "utf-8");

  // 本模块内导出的 facade 对象:`export const X = { key: someViaBridgeFn, ... }`
  const facades = new Map<string, string[]>();
  for (const match of source.matchAll(/^export const (\w+)\s*=\s*\{([\s\S]*?)^\}/gm)) {
    const props = [...match[2].matchAll(/(\w+)\s*:\s*(\w+)/g)].map((m) => m[2]);
    facades.set(match[1], props);
  }

  const out: CapabilityFn[] = [];
  for (const match of source.matchAll(/^export (?:async )?function (\w+)/gm)) {
    const name = match[1];
    if (!name.endsWith("ViaBridge")) continue;
    const facade = [...facades.entries()].find(([, props]) => props.includes(name))?.[0];
    out.push({ name, ownFile, ...(facade ? { facade } : {}) });
  }
  return out;
}

const ALL_CAPABILITIES = BRIDGE_FILES.flatMap((rel) => collectCapabilities(join(REPO_ROOT, rel)));

describe("bridge-wiring — host-core 能力函数必须被生产代码消费", () => {
  it("扫描器本身能发现能力函数(防止守卫静默通过)", () => {
    expect(ALL_CAPABILITIES.length).toBeGreaterThan(0);
    const names = ALL_CAPABILITIES.map((c) => c.name);
    // 五个 bridge 各自的代表能力都在,少任何一个说明扫描路径坏了。
    for (const expected of [
      "evaluateViaBridge",
      "sessionSearchViaBridge",
      "sessionSetRootViaBridge",
      "workspaceCheckViaBridge",
      "auditAppendViaBridge",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it.each(ALL_CAPABILITIES.map((c) => [c.name, c] as const))(
    "%s 有生产调用点",
    (_name, capability) => {
      const target = capability.facade ?? capability.name;
      const wired = isReferencedByProduction(target, capability.ownFile);
      expect(
        wired,
        `${capability.name} 在生产代码中没有任何调用点。` +
          (capability.facade
            ? `(经 facade \`${capability.facade}\` 间接引用同样不算 —— 它也没有被消费)`
            : "") +
          `。要么接上业务调用点,要么删掉它及其单测;` +
          `否则 Rust 侧对应的能力永远不会被执行,而且没有任何机制会失败。`,
      ).toBe(true);
    },
  );
});
