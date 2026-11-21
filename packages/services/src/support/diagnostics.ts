/**
 * 反馈诊断 (20261116-pii W6.5)：生成一份可在本地预览、复制或保存的诊断文本。
 *
 * 硬约束：不自动上传；不含 API Key、Bearer 令牌或绝对路径。字段由调用方挑选
 * （版本、平台、模型 id、权限模式、规则条数、扩展文件名），这里再做一次兜底清洗，
 * 即使反馈正文里贴了密钥或路径也会被替换掉。
 */

export interface DiagnosticsInput {
  app: string;
  versions: Record<string, string | undefined>;
  platform: string;
  arch: string;
  providerIds: string[];
  model?: { provider: string; modelId: string } | null;
  permissionMode: string;
  ruleCount: number;
  protectedPaths: string[];
  extensions: Array<{ name: string; error?: string }>;
  sessionId?: string;
  messageCount?: number;
  feedback?: string;
}

const PATH_RE = /(?:\/(?:Users|home|tmp|private|var|opt|etc)\/[^\s"'\n]+|[A-Za-z]:\\[^\s"'\n]+)/g;
const KEY_RE = /\b(?:sk|pk)-[A-Za-z0-9_-]{8,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;

/** Strip absolute paths and credential-looking tokens from free text. */
export function sanitizeDiagnostics(text: string): string {
  return text.replace(PATH_RE, "[path]").replace(KEY_RE, "[redacted]");
}

export function buildDiagnostics(input: DiagnosticsInput): string {
  const lines: string[] = [
    "# OpenBuddy 诊断报告",
    `生成时间：${new Date().toISOString()}`,
    "",
    "## 环境",
    `- 应用：${input.app}`,
    `- 平台：${input.platform} / ${input.arch}`,
    ...Object.entries(input.versions ?? {})
      .filter(([, value]) => typeof value === "string" && value)
      .map(([key, value]) => `- ${key}：${value}`),
    "",
    "## 模型与提供商",
    `- 提供商：${input.providerIds.length ? input.providerIds.join("、") : "（未配置）"}`,
    `- 当前模型：${input.model ? `${input.model.provider}/${input.model.modelId}` : "（无）"}`,
    "",
    "## 权限",
    `- 模式：${input.permissionMode}`,
    `- 自定义规则：${input.ruleCount} 条`,
    `- 受保护路径：${input.protectedPaths.length ? input.protectedPaths.join("、") : "（无）"}`,
    "",
    "## 扩展",
    input.extensions.length
      ? input.extensions.map((ext) => `- ${ext.name}${ext.error ? `：${ext.error.slice(0, 200)}` : ""}`).join("\n")
      : "- （无加载失败的扩展）",
  ];
  if (input.sessionId) {
    lines.push("", "## 会话", `- 会话 id：${input.sessionId}`, `- 消息数：${input.messageCount ?? 0}`);
  }
  if (input.feedback?.trim()) lines.push("", "## 用户反馈", input.feedback.trim());
  return sanitizeDiagnostics(lines.join("\n"));
}
