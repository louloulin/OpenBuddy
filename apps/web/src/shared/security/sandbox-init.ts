/**
 * 沙箱自动激活 —— 装好 @anthropic-ai/sandbox-runtime 后零代码改动自动激活 OS 级沙箱。
 *
 * 原理:用动态 import 探测包是否存在;存在则调用其 API 创建沙箱实例,注入 sandbox-guard
 * 的 AnthropicSandboxExecutor;不存在则静默降级为 PassthroughExecutor(纯逻辑守卫)。
 *
 * 用户只需在联网环境执行 `pnpm add @anthropic-ai/sandbox-runtime`,重启即生效。
 *
 * 注:@anthropic-ai/sandbox-runtime v0.0.17 的 API(Claude Code 同款):
 *  - 默认导出 createSandbox(policy) → sandbox 实例
 *  - sandbox.exec(command) / sandbox.run(command) → { stdout, stderr, exitCode }
 *  - policy: { fileRules, networkPolicy, defaultAction } (与 SandboxRules 对齐)
 *
 * 由于无法静态 import(离线环境会报错),这里用动态 import + duck-typing。
 */
import {
  AnthropicSandboxExecutor,
  setSandboxExecutor,
  getSandboxExecutor,
  DEFAULT_SANDBOX_RULES,
  type SandboxRuntimeLike,
} from "./sandbox-guard";

/** 沙箱包名。 */
const SANDBOX_PACKAGE = "@anthropic-ai/sandbox-runtime";

/** 激活状态。 */
export type SandboxActivationStatus =
  | { activated: true; version: string | undefined }
  | { activated: false; reason: "not-installed" | "import-failed" | "already-active" };

/**
 * 尝试自动激活 @anthropic-ai/sandbox-runtime。
 *  - 已激活 → 返回 already-active。
 *  - 包未安装(import 失败)→ 返回 not-installed,降级为 passthrough。
 *  - 包已安装 → 创建沙箱实例,setSandboxExecutor,返回 activated。
 *
 * @param policy 沙箱策略(默认用 DEFAULT_SANDBOX_RULES 转换)
 */
export async function tryActivateSandbox(
  policy?: Record<string, unknown>,
  deps?: { moduleResolver?: () => Promise<Record<string, unknown>> },
): Promise<SandboxActivationStatus> {
  // 已激活则不重复。
  const existing = getSandboxExecutor();
  if (existing?.isSandboxed) {
    return { activated: false, reason: "already-active" };
  }

  let mod: Record<string, unknown>;
  try {
    // 测试时注入 moduleResolver;运行时用动态 import。
    mod = deps?.moduleResolver
      ? await deps.moduleResolver()
      : ((await import(/* @vite-ignore */ SANDBOX_PACKAGE)) as Record<string, unknown>);
  } catch {
    return { activated: false, reason: "not-installed" };
  }

  try {
    const sandbox = createSandboxFromModule(mod, policy);
    if (!sandbox) return { activated: false, reason: "import-failed" };
    setSandboxExecutor(new AnthropicSandboxExecutor(sandbox));
    const version = typeof mod.version === "string" ? mod.version : undefined;
    return { activated: true, version };
  } catch {
    return { activated: false, reason: "import-failed" };
  }
}

/**
 * 从动态导入的模块中创建沙箱实例(duck-typed,适配多种导出形式)。
 *
 * @anthropic-ai/sandbox-runtime 可能的导出:
 *  - default export: createSandbox / Sandbox 类
 *  - named export: createSandbox, Sandbox, createSandboxFromPolicy
 *  - 直接是一个函数
 */
function createSandboxFromModule(
  mod: Record<string, unknown>,
  policy?: Record<string, unknown>,
): SandboxRuntimeLike | null {
  const defaultPolicy = policy ?? sandboxRulesToPolicy(DEFAULT_SANDBOX_RULES);

  // 1. mod.default 是函数 → 直接调用。
  const defaultExport = mod.default ?? mod;
  if (typeof defaultExport === "function") {
    const result = (defaultExport as (p: unknown) => unknown)(defaultPolicy);
    if (isSandboxInstance(result)) return toSandboxRuntime(result);
    // 可能是构造函数。
    try {
      const inst = new (defaultExport as { new (p: unknown): unknown })(defaultPolicy);
      if (isSandboxInstance(inst)) return toSandboxRuntime(inst);
    } catch {
      /* not a constructor */
    }
  }

  // 2. mod.createSandbox 函数。
  const createFn = mod.createSandbox ?? mod.createSandboxFromPolicy;
  if (typeof createFn === "function") {
    const inst = (createFn as (p: unknown) => unknown)(defaultPolicy);
    if (isSandboxInstance(inst)) return toSandboxRuntime(inst);
  }

  // 3. mod.Sandbox 类。
  const SandboxClass = mod.Sandbox;
  if (typeof SandboxClass === "function") {
    try {
      const inst = new (SandboxClass as { new (p: unknown): unknown })(defaultPolicy);
      if (isSandboxInstance(inst)) return toSandboxRuntime(inst);
    } catch {
      /* noop */
    }
  }

  return null;
}

/** 判断一个对象是否像沙箱实例(有 exec 或 run 方法)。 */
function isSandboxInstance(obj: unknown): boolean {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return typeof o.exec === "function" || typeof o.run === "function";
}

/** 把沙箱实例适配为 SandboxRuntimeLike(exec 方法)。 */
function toSandboxRuntime(obj: unknown): SandboxRuntimeLike {
  const o = obj as Record<string, (...a: unknown[]) => unknown>;
  // 优先 exec,其次 run。
  if (typeof o.exec === "function") {
    return { exec: o.exec as SandboxRuntimeLike["exec"] };
  }
  // run → 适配为 exec(返回结构可能不同,做归一)。
  return {
    exec: async (command: string, opts?: { cwd?: string }) => {
      const res = (await o.run(command, opts)) as { stdout?: string; stderr?: string; exitCode?: number | null };
      return {
        stdout: res.stdout ?? "",
        stderr: res.stderr ?? "",
        exitCode: res.exitCode ?? null,
      };
    },
  };
}

/** 把 SandboxRules 转成 @anthropic-ai/sandbox-runtime 的 policy 格式。 */
export function sandboxRulesToPolicy(
  rules: typeof DEFAULT_SANDBOX_RULES,
): Record<string, unknown> {
  return {
    defaultAction: rules.defaultAction,
    fileRules: rules.fileRules.map((r) => ({ pattern: r.pattern, action: r.action })),
    networkPolicy: { enabled: true, default: "allow" },
  };
}

/** 是否已激活 OS 级沙箱。 */
export function isSandboxActive(): boolean {
  return !!getSandboxExecutor()?.isSandboxed;
}
