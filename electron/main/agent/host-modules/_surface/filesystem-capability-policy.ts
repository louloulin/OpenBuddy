/**
 * host-modules/_surface/filesystem-capability-policy.ts
 *
 * v5-F — Single source of truth for filesystem capability policy lookup.
 *
 * 背景:
 *   agent-host.ts:1737-1749 维护三个 export:
 *     - type FilesystemCapabilityPolicy
 *     - const DEFAULT_FILESYSTEM_POLICY = "disabled-by-policy"
 *     - function evaluateFilesystemCapabilityPolicy(overrides)
 *   它通过 `require("../../evals/node/_filesystem-capability-policy.mjs")`
 *   把 ESM helper 加载成 CJS, 返回统一的 policy shape。
 *
 * 设计:
 *   - 把类型 + 常量 + 函数移到本模块
 *   - 用 createRequire() 取代内联 require(), 保持 sync 接口
 *   - agent-host.ts 用 `export { ... } from "..."` re-export, 不改外部 API
 *
 * v5-F 收益: 11 行 → 2 行 (agent-host.ts)
 */

import { createRequire } from "node:module";

export type FilesystemCapabilityPolicy = {
  allowed: boolean;
  reason: string;
  source: "env" | "manifest" | "default";
};

export const DEFAULT_FILESYSTEM_POLICY = "disabled-by-policy";

interface FsPolicyHelper {
  evaluateFilesystemCapabilityPolicy: (
    overrides: { env?: NodeJS.ProcessEnv; manifestPolicy?: string },
  ) => FilesystemCapabilityPolicy;
}

const requireHelper = createRequire(import.meta.url);

/**
 * Evaluate whether the harness may run filesystem smoke tests. Delegates
 * to the canonical helper under evals/node so Node.mjs runners and the
 * Electron main process return the same answer. Keep this name stable;
 * callers grep for it.
 */
export function evaluateFilesystemCapabilityPolicy(
  overrides: { env?: NodeJS.ProcessEnv; manifestPolicy?: string } = {},
): FilesystemCapabilityPolicy {
  const helper = requireHelper("../../../../../evals/node/_filesystem-capability-policy.mjs") as FsPolicyHelper;
  return helper.evaluateFilesystemCapabilityPolicy(overrides);
}
