/**
 * host-modules/bootstrap/filesystem-capability-policy.ts
 *
 * v6-G M1 收尾: 抽取 agent-host.ts 的 FilesystemCapabilityPolicy 域
 * (type / 常量 / evaluate). 原 ~14 行 inline 代码提到独立文件.
 *
 * 这是 "harness 能否跑 filesystem smoke" 的单一来源; Node.mjs runners
 * 和 Electron 主进程共享同一个判断逻辑 (委托给 evals/node 下的 helper).
 *
 * 反向依赖不变量: 此模块不 import agent-host.ts.
 */
import { createRequire } from "node:module";

const requireFromHere = createRequire(import.meta.url);

export type FilesystemCapabilityPolicy = {
  allowed: boolean;
  reason: string;
  source: "env" | "manifest" | "default";
};

export const DEFAULT_FILESYSTEM_POLICY = "disabled-by-policy";

export function evaluateFilesystemCapabilityPolicy(
  overrides: { env?: NodeJS.ProcessEnv; manifestPolicy?: string } = {},
): FilesystemCapabilityPolicy {
  const helper = requireFromHere("../../../../evals/node/_filesystem-capability-policy.mjs");
  return helper.evaluateFilesystemCapabilityPolicy(overrides);
}
