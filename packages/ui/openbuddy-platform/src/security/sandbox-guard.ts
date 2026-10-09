/**
 * 本地命令沙箱守卫 —— WorkBuddy tsbx 本地沙箱 DLL + security-center 的可移植替代。
 *
 * WorkBuddy 的 tsbx 是 Rust 进程隔离沙箱(文件系统保护 + white_process + 网络策略),
 * 绑定专有 DLL,不可移植。OpenBuddy 用「纯逻辑路径规则 + 命令预检」替代:在执行命令/
 * 访问文件前,按规则集判定 allow/deny/ask,而非 OS 级隔离。这与既有的 command-risk(危险
 * 命令检测)互补:command-risk 判危险等级,sandbox-guard 判路径访问策略。
 *
 * 纯函数核心(规则匹配 + 预检),便于单测。运行时由权限弹窗(PermissionDialog)承载 ask。
 */

/** 规则动作。 */
export type SandboxAction = "allow" | "deny" | "ask";

/** 文件访问规则(glob 模式匹配路径)。 */
export interface FileRule {
  /** glob 模式(支持 ** / *,如 "%USERPROFILE%/.ssh/**")。 */
  pattern: string;
  /** 动作。 */
  action: SandboxAction;
}

/** 进程白名单规则(glob 匹配可执行名/路径)。 */
export interface ProcessRule {
  pattern: string;
  action: SandboxAction;
}

/** 沙箱规则集。 */
export interface SandboxRules {
  /** 默认动作(无规则命中时)。 */
  defaultAction: SandboxAction;
  /** 文件规则(按顺序匹配,首个命中生效)。 */
  fileRules: FileRule[];
  /** 进程规则。 */
  processRules: ProcessRule[];
}

/** 默认规则集:敏感目录拒绝,临时目录允许,其余询问。 */
export const DEFAULT_SANDBOX_RULES: SandboxRules = {
  defaultAction: "ask",
  fileRules: [
    { pattern: "**/.ssh/**", action: "deny" },
    { pattern: "**/.gnupg/**", action: "deny" },
    { pattern: "**/.aws/credentials", action: "deny" },
    { pattern: "**/.git/config", action: "deny" },
    { pattern: "**/Temp/**", action: "allow" },
    { pattern: "**/.env", action: "deny" },
  ],
  processRules: [
    { pattern: "**/cmd.exe", action: "allow" },
    { pattern: "**/powershell.exe", action: "allow" },
    { pattern: "**/bash", action: "allow" },
    { pattern: "**/sh", action: "allow" },
  ],
};

/** 简化 glob 匹配:支持 ** (跨目录) 与 * (单段)。把 glob 转成正则。 */
export function globToRegex(pattern: string): RegExp {
  // 转义正则元字符,再还原 glob 语义。
  let re = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  // ** → 任意(含分隔符)。
  re = re.replace(/\*\*/g, "::DS::");
  // * → 单段(不含分隔符)。
  re = re.replace(/\*/g, "[^/\\\\]*");
  re = re.replace(/::DS::/g, ".*");
  // 环境变量占位符 %X% → 任意段(简化:不解析真实值,仅匹配非分隔符段)。
  re = re.replace(/%[^%/\\]+%/g, "[^/\\\\]+");
  return new RegExp(`^${re}$`, "i");
}

/** 判断路径是否匹配 glob 模式。 */
export function matchGlob(path: string, pattern: string): boolean {
  return globToRegex(pattern).test(path.replace(/\\/g, "/"));
}

/** 按文件规则集判定路径访问动作(首个命中生效,无命中用 defaultAction)。 */
export function checkFileAccess(path: string, rules: SandboxRules = DEFAULT_SANDBOX_RULES): SandboxAction {
  const normalized = path.replace(/\\/g, "/");
  for (const rule of rules.fileRules) {
    if (matchGlob(normalized, rule.pattern)) return rule.action;
  }
  return rules.defaultAction;
}

/** 按进程规则集判定可执行文件动作。 */
export function checkProcessAccess(exePath: string, rules: SandboxRules = DEFAULT_SANDBOX_RULES): SandboxAction {
  const normalized = exePath.replace(/\\/g, "/");
  for (const rule of rules.processRules) {
    if (matchGlob(normalized, rule.pattern)) return rule.action;
  }
  return rules.defaultAction;
}

/** 预检结果。 */
export interface PrecheckResult {
  /** 允许/拒绝/询问。 */
  action: SandboxAction;
  /** 命中的规则(无则 default)。 */
  matchedRule?: string;
  /** 命中的文件/进程路径。 */
  target: string;
  /** 人类可读原因。 */
  reason: string;
}

/**
 * 命令预检:解析命令文本里可能的路径参数,逐个判定文件访问动作,返回最终守卫决策。
 * 这是对 command-risk 的补充:command-risk 看命令危险等级(rm -rf),sandbox-guard 看
 * 访问的路径是否在受保护目录(如 .ssh)。
 *
 * 语义(deny 一票否决,否则取命中规则的动作,无命中用 defaultAction):
 *  - 任一路径 deny → deny(最严格,保护敏感目录)。
 *  - 否则,若任一路径命中显式规则(allow/ask),取其中最严格的命中动作。
 *  - 无路径命中规则 → defaultAction。
 *
 * 简化解析:提取命令里的「看起来像路径」的 token(含 / 或 \ 或盘符)。
 */
export function precheckCommand(command: string, rules: SandboxRules = DEFAULT_SANDBOX_RULES): PrecheckResult {
  const tokens = command.split(/\s+/).filter(Boolean);
  const rank: Record<SandboxAction, number> = { allow: 0, ask: 1, deny: 2 };
  let denyHit: PrecheckResult | null = null;
  let bestExplicit: PrecheckResult | null = null;
  for (const tok of tokens) {
    const looksLikePath = /[\\/]/.test(tok) || /^[A-Za-z]:[\\/]/.test(tok) || /^\.[\w-]+/.test(tok);
    if (!looksLikePath) continue;
    const normalized = tok.replace(/\\/g, "/");
    const matched = rules.fileRules.find((r) => matchGlob(normalized, r.pattern));
    const action = matched ? matched.action : rules.defaultAction;
    const entry: PrecheckResult = {
      action,
      matchedRule: matched?.pattern,
      target: tok,
      reason:
        action === "deny"
          ? `路径受保护(${matched?.pattern ?? "deny"})`
          : action === "ask"
            ? "路径需确认"
            : "路径允许",
    };
    if (action === "deny") {
      denyHit = entry;
      break; // deny 一票否决,立即返回。
    }
    // 只追踪「命中显式规则」的(非默认)。
    if (matched && (!bestExplicit || rank[action] >= rank[bestExplicit.action])) {
      bestExplicit = entry;
    }
  }
  if (denyHit) return denyHit;
  if (bestExplicit) return bestExplicit;
  return { action: rules.defaultAction, target: command, reason: "默认策略" };
}

/** 序列化/反序列化规则集(localStorage 持久化用)。 */
export function serializeRules(rules: SandboxRules): string {
  return JSON.stringify(rules);
}
export function deserializeRules(json: string, fallback = DEFAULT_SANDBOX_RULES): SandboxRules {
  try {
    const obj = JSON.parse(json) as SandboxRules;
    if (!obj.defaultAction || !Array.isArray(obj.fileRules)) return fallback;
    return obj;
  } catch {
    return fallback;
  }
}

// ========================================================================
// OS 级沙箱执行器适配层 —— @anthropic-ai/sandbox-runtime 的可插拔接入点
//
// WorkBuddy 用 tsbx(Rust DLL)做进程隔离;其开源等价物是 Anthropic 的
// @anthropic-ai/sandbox-runtime(CLI: srt),Claude Code 也用它。它不需 Docker,
// 在 OS 级别施加文件系统 + 网络限制。
//
// 当前环境无法安装该包(离线),因此这里提供:
//  1. SandboxExecutor 接口(纯类型 + 依赖注入)
//  2. PassthroughExecutor(默认,无沙箱,仅记录)
//  3. AnthropicSandboxExecutor 适配器(包装 @anthropic-ai/sandbox-runtime 的 Node API)
//     — 装好包后注入即可激活 OS 级沙箱,无需改其它代码。
// ========================================================================

/** 命令执行结果。 */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** 是否在沙箱内执行(true=OS 级沙箱;false=直通)。 */
  sandboxed: boolean;
}

/**
 * 沙箱执行器接口:把命令执行委托给不同后端。
 *  - PassthroughExecutor:直接执行(无沙箱,仅 precheck 守卫)。
 *  - AnthropicSandboxExecutor:用 @anthropic-ai/sandbox-runtime 在 OS 级隔离执行。
 */
export interface SandboxExecutor {
  /** 执行器标识。 */
  readonly id: string;
  /** 是否真正在 OS 级沙箱内执行。 */
  readonly isSandboxed: boolean;
  /** 执行一条命令,返回结果。 */
  exec(command: string, opts?: { cwd?: string }): Promise<ExecResult>;
}

/** 默认执行器:直通(无 OS 级沙箱),仅记录。运行时用 child_process / Electron-compatible shell 命令。 */
export class PassthroughExecutor implements SandboxExecutor {
  readonly id = "passthrough";
  readonly isSandboxed = false;
  constructor(
    private readonly run: (cmd: string, opts?: { cwd?: string }) => Promise<ExecResult>,
  ) {}
  async exec(command: string, opts?: { cwd?: string }): Promise<ExecResult> {
    return this.run(command, opts);
  }
}

/**
 * Anthropic sandbox-runtime 适配器。
 *
 * 把 @anthropic-ai/sandbox-runtime 的 Node API 包装为 SandboxExecutor。
 * 装好包后,构造时传入其 `sandboxCommand`(或等价 API)即可:
 *
 * ```ts
 * import { createSandbox } from "@anthropic-ai/sandbox-runtime";
 * const sandbox = createSandbox({ fileRules: [...], networkPolicy: {...} });
 * const executor = new AnthropicSandboxExecutor(sandbox);
 * ```
 *
 * `sandboxRuntime` 是一个最小接口(duck-typed),不直接 import 包(避免离线环境报错)。
 * 运行时由调用方注入真实实例。
 */
export interface SandboxRuntimeLike {
  /** sandbox-runtime 的命令执行 API(签名与 @anthropic-ai/sandbox-runtime 一致)。 */
  exec(command: string, opts?: { cwd?: string }): Promise<{ stdout: string; stderr: string; exitCode: number | null }>;
}

export class AnthropicSandboxExecutor implements SandboxExecutor {
  readonly id = "anthropic-sandbox-runtime";
  readonly isSandboxed = true;
  constructor(private readonly sandbox: SandboxRuntimeLike) {}
  async exec(command: string, opts?: { cwd?: string }): Promise<ExecResult> {
    const res = await this.sandbox.exec(command, opts);
    return { ...res, sandboxed: true };
  }
}

/** 当前激活的执行器(默认 passthrough)。 */
let activeExecutor: SandboxExecutor | null = null;

/** 设置全局沙箱执行器(装好 @anthropic-ai/sandbox-runtime 后调用)。 */
export function setSandboxExecutor(executor: SandboxExecutor): void {
  activeExecutor = executor;
}

/** 取当前执行器(未设置则返回 null)。 */
export function getSandboxExecutor(): SandboxExecutor | null {
  return activeExecutor;
}

/** 重置为默认(测试用)。 */
export function resetSandboxExecutor(): void {
  activeExecutor = null;
}

/**
 * 安全执行命令:先做 precheck(纯逻辑守卫),deny 直接拒绝;allow/ask 时委托给
 * 当前沙箱执行器(若有 OS 级执行器则隔离执行,否则用传入的 fallback 直通执行)。
 *
 * @param command 命令文本
 * @param rules 沙箱规则集
 * @param fallbackExec 无 OS 级沙箱时的直通执行函数(运行时 = Electron-compatible shell 命令)
 * @param opts 执行选项(cwd)
 */
export async function safeExec(
  command: string,
  rules: SandboxRules = DEFAULT_SANDBOX_RULES,
  fallbackExec: (cmd: string, opts?: { cwd?: string }) => Promise<ExecResult>,
  opts?: { cwd?: string },
): Promise<ExecResult> {
  // 1. 纯逻辑预检:deny → 拒绝执行。
  const precheck = precheckCommand(command, rules);
  if (precheck.action === "deny") {
    return {
      stdout: "",
      stderr: `命令被沙箱守卫拒绝:${precheck.reason}(路径 ${precheck.target})`,
      exitCode: null,
      sandboxed: false,
    };
  }
  // 2. 委托执行:有 OS 级沙箱执行器则用它,否则直通。
  const executor = activeExecutor ?? new PassthroughExecutor(fallbackExec);
  return executor.exec(command, opts);
}
