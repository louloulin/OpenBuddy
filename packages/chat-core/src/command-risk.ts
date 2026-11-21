/**
 * 命令风险检测 — 对齐 WorkBuddy `cb-chat-ui/chat-input/command-risk.ts`。
 *
 * 在工具调用渲染终端命令(run_terminal_command / bash)前,解析命令文本并标注风险等级
 * (high / medium / low)。纯函数、无副作用,便于单测。
 *
 * 设计要点(移植参考实现):
 *  - `rm` 命令单独解析:支持 `sudo` 前缀、`\rm` / `/bin/rm` 等绝对路径形式、
 *    短选项连写(`-rf`/`-fr`/`-Rf`)/ 分写(`-r -f`)、长选项(`--recursive`/`--force`)、
 *    以及 `--` 之后一律视为路径。
 *  - rm 的风险:递归 + 强制 命中危险路径 → high;递归 + 强制但安全路径 → medium;其余 low。
 *  - 非 rm 命令走正则集合:`dd of=/dev/`、`mkfs`、`chmod 777 /`、`git reset --hard` 等为 high;
 *    `git branch -D`、`kill`/`killall` 等为 medium。
 *
 * 仅用于「显示警示徽章」,不拦截执行 —— 与 WorkBuddy 的标注行为一致。
 */

export type RiskLevel = "low" | "medium" | "high";

export interface CommandRiskResult {
  /** 风险等级。空命令与未知命令均为 low。 */
  level: RiskLevel;
  /** 命中原因(人类可读),low 时为空数组。 */
  reasons: string[];
}

/** 危险路径集合(严格策略)。 */
function isDangerousRmPath(path: string): boolean {
  if (!path) return false;
  if (path === "/" || path === "~") return true;
  if (path === "$HOME" || path === "${HOME}") return true;
  if (path.includes("*")) return true;
  if (path === ".git" || /(^|\/)\.git(\/|$)/.test(path)) return true;
  if (/^\/(usr|var|etc|bin|sbin|lib|opt|boot|root|home|System|Library|tmp|dev)\/?$/.test(path))
    return true;
  return false;
}

interface ParsedRm {
  recursive: boolean;
  force: boolean;
  paths: string[];
}

/**
 * 解析 rm 命令;非 rm 命令返回 null。
 * 支持:sudo 前缀、`rm`/`\rm`/绝对路径 `/bin/rm`、短选项连写与分写、长选项、`--`。
 */
function parseRmCommand(command: string): ParsedRm | null {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  let i = 0;
  if (tokens[i] === "sudo") i++;
  const head = tokens[i];
  if (!head) return null;
  if (!/^(\\?rm|.*\/rm)$/.test(head)) return null;
  i++;
  let recursive = false;
  let force = false;
  const paths: string[] = [];
  let dashDashSeen = false;
  for (; i < tokens.length; i++) {
    const tok = tokens[i];
    if (dashDashSeen) {
      paths.push(tok);
      continue;
    }
    if (tok === "--") {
      dashDashSeen = true;
      continue;
    }
    if (tok === "--recursive") {
      recursive = true;
      continue;
    }
    if (tok === "--force") {
      force = true;
      continue;
    }
    if (/^--/.test(tok)) continue;
    if (/^-[a-zA-Z]+$/.test(tok)) {
      for (const ch of tok.slice(1)) {
        if (ch === "r" || ch === "R") recursive = true;
        else if (ch === "f") force = true;
      }
      continue;
    }
    paths.push(tok);
  }
  return { recursive, force, paths };
}

/** rm 命令的风险判定(优先于正则集合)。 */
function checkRmRisk(parsed: ParsedRm): CommandRiskResult {
  if (parsed.recursive && parsed.force) {
    const dangerous = parsed.paths.filter(isDangerousRmPath);
    if (dangerous.length > 0) {
      return {
        level: "high",
        reasons: [`递归强制删除危险路径:${dangerous.join(", ")}`],
      };
    }
    return { level: "medium", reasons: ["递归强制删除(rm -rf)"] };
  }
  return { level: "low", reasons: [] };
}

// high 风险正则集合(非 rm 命令)。
const HIGH_RISK_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /dd\s+.*of=\/dev\//, reason: "dd 写入块设备" },
  { re: /mkfs/, reason: "格式化文件系统(mkfs)" },
  { re: /chmod\s+777\s+\//, reason: "对根目录开放 777 权限" },
  { re: /git\s+reset\s+--hard/, reason: "git reset --hard 丢弃工作区改动" },
  { re: /git\s+clean\s+.*-[fFdDxX]+/, reason: "git clean 强制清理未跟踪文件" },
  { re: /git\s+push\s+.*--force/, reason: "git push --force 覆盖远端" },
  { re: /git\s+checkout\s+(-f|--force)/, reason: "git checkout --force 丢弃本地改动" },
  { re: /git\s+checkout\s+--\s+\./, reason: "git checkout -- . 还原全部改动" },
  { re: /find\s+.*-exec\s/, reason: "find -exec 执行任意命令" },
  { re: /find\s+.*-delete/, reason: "find -delete 批量删除" },
];

// medium 风险正则集合(非 rm 命令)。
const MEDIUM_RISK_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /git\s+branch\s+-D/, reason: "git branch -D 强制删除分支" },
  { re: /git\s+stash\s+(drop|clear)/, reason: "git stash drop/clear 丢弃储藏" },
  { re: /kill[\s]/, reason: "kill 终止进程" },
  { re: /killall[\s]/, reason: "killall 批量终止进程" },
];

/**
 * 评估单条命令的风险。
 *
 * 判定顺序:rm 命令优先(rf + 危险路径 → high;rf → medium);其余按 high → medium 正则;
 * 都不命中 → low。空 / 纯空白命令为 low。
 */
export function checkCommandRisk(command: string | undefined | null): CommandRiskResult {
  if (!command || !command.trim()) return { level: "low", reasons: [] };
  const cmd = command.trim();
  const rm = parseRmCommand(cmd);
  if (rm) return checkRmRisk(rm);
  for (const { re, reason } of HIGH_RISK_PATTERNS) {
    if (re.test(cmd)) return { level: "high", reasons: [reason] };
  }
  for (const { re, reason } of MEDIUM_RISK_PATTERNS) {
    if (re.test(cmd)) return { level: "medium", reasons: [reason] };
  }
  return { level: "low", reasons: [] };
}

/** 中文风险标签(用于徽章文案)。 */
export function riskLabel(level: RiskLevel): string {
  switch (level) {
    case "high":
      return "高危";
    case "medium":
      return "中危";
    default:
      return "";
  }
}
