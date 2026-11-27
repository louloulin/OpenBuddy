/**
 * 安装错误可读化 (20261127-upup §4 U3)。
 *
 * Pi 包管理器的错误来自 git / npm / 网络栈，原始信息对用户没有行动指引。
 * 这里只做**稳定分类 + 保留原文**：分类给下一步动作，原文用于排查。
 * 纯函数，宿主与渲染进程共用（不依赖 node / DOM）。
 */
export function describeAppInstallError(error: unknown): string {
  const raw = (error instanceof Error ? error.message : String(error ?? "")).replace(/^Error:\s*/, "").trim();
  const message = raw || "未知错误";
  const lower = message.toLowerCase();
  let friendly: string;
  if (/enotfound|eai_again|network unreachable|econnrefused|econnreset|etimedout|timeout|socket hang up/.test(lower)) {
    friendly = "无法连接安装源（网络不可达或代理未配置）。请检查网络/代理后重试，或改用本地目录安装。";
  } else if (/authentication failed|could not read username|permission denied|403|401|repository not found|not authorized/.test(lower)) {
    friendly = "安装源需要认证或仓库不存在。请确认地址、分支与访问权限。";
  } else if (/enospc|no space left/.test(lower)) {
    friendly = "磁盘空间不足。请清理后重试。";
  } else if (/spawn git enoent|git: command not found|git not found/.test(lower)) {
    friendly = "缺少 Git。请先安装 Git 再重试。";
  } else {
    friendly = "安装失败。请查看原始信息后重试。";
  }
  return `${friendly}（原始信息：${message}）`;
}
