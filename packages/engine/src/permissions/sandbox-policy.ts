/**
 * 沙箱与网络策略 (G2-3)：在**权限闸门之前**生效的硬边界。
 *
 * 与「受保护路径」同级：即使完全访问 / 始终允许 / 自动化放行，违反策略的调用仍然被拒，
 * 并给出可读原因，让模型换一种做法。三个维度：
 *
 * - 文件写入白名单：write / edit / delete 的目标路径必须命中 `fileWriteAllow`；
 * - 命令白名单：bash 的命令必须命中 `commandAllow`（前缀匹配）；
 * - 网络域名白名单：带 URL 的工具（fetch / http / web_* / mcp 网络工具）的主机必须命中 `networkAllow`。
 *
 * 空的名单 = 不限制（与 WorkBuddy 的「默认不拦、开了才拦」一致）。
 */

export interface SandboxPolicy {
  /** 允许写入的路径片段（子串匹配，命中任意一条即可）。 */
  fileWriteAllow: string[];
  /** 允许执行的命令前缀（子串匹配）。 */
  commandAllow: string[];
  /** 允许访问的域名（主机名匹配，支持 `example.com` 精确或 `.example.com` 后缀）。 */
  networkAllow: string[];
}

export const EMPTY_SANDBOX_POLICY: SandboxPolicy = {
  fileWriteAllow: [],
  commandAllow: [],
  networkAllow: [],
};

export interface PolicyViolation {
  /** 哪一条策略被违反。 */
  rule: "file" | "command" | "network";
  /** 给模型看的可读原因。 */
  reason: string;
}

/** 写文件类工具：与 permissions.ts 的 MUTATING_TOOL 保持同一批。 */
const WRITE_TOOLS = /^(write|edit)$|delete|remove/i;
const NETWORK_TOOL = /fetch|http|web|download|url/i;

function inputValue(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

/** 路径是否命中白名单（子串匹配，空名单不限制）。 */
export function pathAllowed(policy: SandboxPolicy, path: string): boolean {
  if (!policy.fileWriteAllow.length) return true;
  return policy.fileWriteAllow.some((rule) => rule.trim() && path.includes(rule.trim()));
}

/** 命令是否命中白名单（子串匹配，空名单不限制）。 */
export function commandAllowed(policy: SandboxPolicy, command: string): boolean {
  if (!policy.commandAllow.length) return true;
  return policy.commandAllow.some((rule) => rule.trim() && command.includes(rule.trim()));
}

/** 主机是否命中域名白名单：精确相等或 `.suffix` 后缀命中。 */
export function hostAllowed(policy: SandboxPolicy, host: string): boolean {
  if (!policy.networkAllow.length) return true;
  const target = host.toLowerCase();
  return policy.networkAllow.some((raw) => {
    const rule = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!rule) return false;
    if (rule.startsWith(".")) return target.endsWith(rule);
    return target === rule || target.endsWith(`.${rule}`);
  });
}

/** 从工具入参里取出可能出现的 URL / 主机名。 */
export function targetsOf(toolName: string, input: unknown): string[] {
  const value = inputValue(input);
  const urls: string[] = [];
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== "string") continue;
    if (!/url|uri|host|endpoint|link|address/i.test(key)) continue;
    urls.push(raw);
  }
  if (typeof value.command === "string") {
    const found = value.command.match(/https?:\/\/[^\s"')]+/g);
    if (found) urls.push(...found);
  }
  return urls;
}

/**
 * 检查一次工具调用是否违反策略。返回 undefined 表示放行。
 * 顺序：文件写入 → 命令 → 网络。
 */
export function policyViolation(
  policy: SandboxPolicy | undefined,
  toolName: string,
  input: unknown,
): PolicyViolation | undefined {
  if (!policy) return undefined;
  const value = inputValue(input);

  if (WRITE_TOOLS.test(toolName)) {
    const path = typeof value.path === "string" ? value.path : undefined;
    if (path && !pathAllowed(policy, path))
      return {
        rule: "file",
        reason: `沙箱策略（文件写入白名单）不允许写入 ${path}。可写路径：${policy.fileWriteAllow.join("、") || "（无）"}。`,
      };
  }

  if (toolName === "bash" && typeof value.command === "string" && !commandAllowed(policy, value.command))
    return {
      rule: "command",
      reason: `沙箱策略（命令白名单）不允许执行该命令。允许的命令片段：${policy.commandAllow.join("、") || "（无）"}。`,
    };

  if (NETWORK_TOOL.test(toolName)) {
    for (const url of targetsOf(toolName, input)) {
      const match = url.match(/^[a-z]+:\/\/([^/:?#]+)/i);
      const host = match ? match[1] : url;
      if (!hostAllowed(policy, host))
        return {
          rule: "network",
          reason: `沙箱策略（网络域名白名单）不允许访问 ${host}。允许的域名：${policy.networkAllow.join("、") || "（无）"}。`,
        };
    }
  }

  return undefined;
}
