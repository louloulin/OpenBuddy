import { parseProtocolError, stripErrorWrappers, type ProtocolErrorCode } from "@openbuddy/protocol/errors";

interface PromptUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedReadTokens?: number;
  reasoningTokens?: number;
  modelCalls?: number;
  apiDurationMs?: number;
  numTurns?: number;
  modelUsage?: Record<string, unknown>;
}

interface AgentErrorData {
  message?: string;
  promptUsage?: PromptUsage;
  [key: string]: unknown;
}


/**
 * Convert Rust Debug-style value wrappers to JSON.
 * Handles: String("...") → "...", Number(123) → 123,
 * Object {...} → {...}, Bool(true) → true, etc.
 */
function rustDebugToJson(s: string): string {
  return s
    // String("value") → "value" (handle escaped quotes inside)
    .replace(/String\("((?:[^"\\]|\\.)*)"\)/g, '"$1"')
    // Number(123) or Number(123.45) → 123 or 123.45
    .replace(/Number\(([^)]+)\)/g, "$1")
    // Bool(true/false) → true/false
    .replace(/Bool\((true|false)\)/g, "$1")
    // Object { → { (the inner content is already JSON-like after above transforms)
    .replace(/Object\s*\{/g, "{")
    // None → null
    .replace(/\bNone\b/g, "null")
    // Some(...) → just the inner value (already unwrapped by caller)
    ;
}

function tryParseAgentError(raw: string): {
  code?: number;
  message?: string;
  data?: AgentErrorData;
} | null {
  // Pattern 1: Rust-style "Error { code: -32003: ..., message: "...", data: Some({...}) }"
  // Pattern 2: JSON stringified Error object
  // Pattern 3: plain error string
  try {
    // Try JSON parse first
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") return obj;
  } catch {
    // Not JSON — try regex extraction
  }

  // Rust Debug-style: Error { code: NNN, message: "...", data: Some({...}) }
  const codeMatch = raw.match(/code:\s*(-?\d+)/);
  const msgMatch = raw.match(/message:\s*"([^"]*)"/);

  if (!codeMatch && !msgMatch) return null;

  // Extract data object (the Some({...}) part)
  let data: AgentErrorData | undefined;
  const dataStart = raw.indexOf("data: Some(");
  if (dataStart >= 0) {
    // Find the matching closing paren — count parens
    let depth = 0;
    let start = raw.indexOf("(", dataStart + 10)!;
    for (let i = start; i < raw.length; i++) {
      if (raw[i] === "(") depth++;
      else if (raw[i] === ")") {
        depth--;
        if (depth === 0) {
          const content = raw.slice(start + 1, i);
          try {
            data = JSON.parse(content);
          } catch {
            // Rust Debug format: convert String(...)/Number(...)/Object wrappers
            const converted = rustDebugToJson(content);
            // Try extracting the inner object { ... }
            const braceStart = converted.indexOf("{");
            const braceEnd = converted.lastIndexOf("}");
            if (braceStart >= 0 && braceEnd > braceStart) {
              try {
                data = JSON.parse(converted.slice(braceStart, braceEnd + 1));
              } catch {
                // give up
              }
            }
          }
          break;
        }
      }
    }
  }

  return {
    code: codeMatch ? parseInt(codeMatch[1], 10) : undefined,
    message: msgMatch ? msgMatch[1] : undefined,
    data,
  };
}

/** Format token count for display: 219848 → "219.8k" */
function fmtTokens(n?: number): string {
  if (!n) return "0";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Format duration: 211574 → "3分32秒" */
function fmtDuration(ms?: number): string {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return rs > 0 ? `${m}分${rs}秒` : `${m}分钟`;
}


export function formatAgentError(raw: string): string | null {
  const parsed = tryParseAgentError(raw);

  // If structured parsing failed, check raw string for known patterns.
  if (!parsed) {
    const lower = raw.toLowerCase();
    if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid api key")) {
      return "⚠️ API 认证失败。请检查 Settings 中的 API Key 配置是否正确。";
    }
    if (lower.includes("connection") || lower.includes("timeout") || lower.includes("econnrefused")) {
      return "⚠️ 网络连接失败。请检查网络/代理设置，确认 API endpoint 可达。";
    }
    if (lower.includes("429") || lower.includes("rate limit")) {
      return "⚠️ API 速率限制已触发。请等待 1-2 分钟后重试。";
    }
    return null;
  }

  const { code, message, data } = parsed;
  const innerMsg = data?.message ?? message ?? "";

  // 429 Rate limit
  if (code === -32003 && innerMsg.includes("429")) {
    const usage = data?.promptUsage;
    const isTpm = innerMsg.includes("tpm");
    const isRpm = innerMsg.includes("rpm");
    const limitType = isTpm ? "TPM（每分钟 token 数）" : isRpm ? "RPM（每分钟请求数）" : "API 速率";

    const lines = [`⚠️ ${limitType}限制已触发`];

    if (usage) {
      const model = usage.modelUsage ? Object.keys(usage.modelUsage)[0] : "unknown";
      lines.push(`模型: ${model}`);
      lines.push(
        `本次消耗: 输入 ${fmtTokens(usage.inputTokens)} + 输出 ${fmtTokens(usage.outputTokens)} = ${fmtTokens(usage.totalTokens)} tokens`,
      );
      if (usage.modelCalls) lines.push(`模型调用: ${usage.modelCalls} 次`);
      if (usage.numTurns) lines.push(`对话轮数: ${usage.numTurns} 轮`);
      if (usage.apiDurationMs) lines.push(`耗时: ${fmtDuration(usage.apiDurationMs)}`);
      if (usage.cachedReadTokens === 0) {
        lines.push(`缓存命中: 0（未启用 prompt caching，每次发送完整上下文）`);
      }
    }

    lines.push("");
    lines.push("建议: 等待 1-2 分钟后重试，或缩短对话上下文（新建会话）。");
    if (usage && usage.inputTokens && usage.inputTokens > 100_000) {
      lines.push("提示: 当前上下文已达 " + fmtTokens(usage.inputTokens) + " tokens，考虑新建会话以减少上下文大小。");
    }

    return lines.join("\n");
  }

  // Auth errors
  if (innerMsg.includes("401") || innerMsg.includes("Unauthorized") || innerMsg.includes("auth")) {
    return "⚠️ API 认证失败。请检查 Settings 中的 API Key 配置是否正确。";
  }

  // Connection errors
  if (innerMsg.includes("connection") || innerMsg.includes("timeout") || innerMsg.includes("ECONNREFUSED")) {
    return "⚠️ 网络连接失败。请检查网络/代理设置，确认 API endpoint 可达。";
  }

  // Model not found
  if (innerMsg.includes("model") && (innerMsg.includes("not found") || innerMsg.includes("invalid"))) {
    return `⚠️ 模型不可用: ${innerMsg}。请在 Settings 中检查模型配置。`;
  }

  // Context too long
  if (innerMsg.includes("context") && innerMsg.includes("length")) {
    const usage = data?.promptUsage;
    const tokens = usage?.inputTokens ? fmtTokens(usage.inputTokens) : "过大";
    return `⚠️ 上下文超出模型限制（当前 ${tokens} tokens）。请新建会话或缩短对话。`;
  }

  // Generic: extract inner message if available
  if (innerMsg) {
    return `⚠️ ${innerMsg}`;
  }

  return null;
}

/**
 * Wrap an error value (string or Error) with formatAgentError.
 * Falls back to String(e) if the error can't be parsed.
 */
export function friendlyError(e: unknown): string {
  const description = describeError(e);
  return description.hint ? `${description.title}：${description.hint}` : description.title;
}

export interface ErrorDescription {
  /** One sentence for people. */
  title: string;
  /** Suggested next step. */
  hint?: string;
  /** Primary recovery action the UI can offer. */
  action?: "retry" | "settings" | "model" | "wait";
  /** Original message for the expandable detail. */
  raw: string;
}

/** Strip IPC wrappers ("Error invoking remote method …: Error: …"). */
export function rawErrorText(e: unknown): string {
  return stripErrorWrappers(String(e instanceof Error ? e.message : e));
}

type Copy = readonly [title: string, hint?: string, action?: ErrorDescription["action"]];
/**
 * Copy for protocol error codes (pii W0.6). Host modules throw `ProtocolError` (or legacy
 * `code: detail` messages); the code survives IPC as the message prefix (protocol errors.ts).
 */
const CODE_COPY: Record<ProtocolErrorCode, Copy> & Record<string, Copy | undefined> = {
  not_implemented: ["当前版本还不支持这个功能", "这个入口需要的后端能力还没有提供，请更新应用后再试"],
  invalid_payload: ["请求内容无效", "检查输入后重试；如果反复出现，请在「帮助与反馈」中反馈"],
  session_not_loaded: ["任务已关闭或不存在", "从侧栏重新打开该任务", "retry"],
  workspace_not_authorized: ["工作空间未授权", "通过「选择工作空间 → 打开本地文件夹」重新选择", "retry"],
  model_not_found: ["当前模型已不可用", "重新选择一个模型", "model"],
  model_auth_missing: ["模型服务商还没有配置 API Key", "在设置 → 模型中填写 API Key", "settings"],
  extension_load_failed: ["扩展加载失败", "在 专家·技能·连接器 → 扩展 中检查或停用该扩展", "settings"],
  export_path_not_authorized: ["导出位置未授权", "通过保存对话框重新选择导出位置", "retry"],
  not_found: ["要找的内容不存在或已被删除", "刷新列表后重试", "retry"],
  already_exists: ["同名的项目已经存在", "换一个名字再保存", "retry"],
  session_busy: ["任务正在运行", "等当前回复完成，或点停止后再试", "wait"],
  entry_not_found: ["这条消息已不在当前对话里", "刷新对话后重试", "retry"],
  permission_denied: ["这条命令被权限规则拒绝", "在设置 → 安全中调整规则，或换一种做法"],
  bash_running: ["上一条命令还在运行", "等它结束，或点停止后再试", "wait"],
  path_not_authorized: ["这个位置不在允许访问的目录里", "把它放进专家库目录或已授权的工作空间后再试"],
  expert_not_found: ["找不到这个专家", "它可能已被删除，刷新专家列表后重试", "retry"],
  expert_invalid: ["专家内容不完整或格式有误", "检查名称和人设后再保存"],
  expert_readonly: ["内置专家不能直接修改", "先「复制」一份到我的专家，再编辑副本"],
  // Legacy `code: detail` messages thrown before ProtocolError existed.
  path_outside_workspace: ["路径不在当前工作空间内", "只能访问工作空间里的文件", "retry"],
  rewind_point_not_found: ["找不到要回到的位置", "对话可能已经变化，刷新后重试", "retry"],
  extension_path_not_authorized: ["扩展文件未授权", "通过文件选择对话框重新选择扩展", "retry"],
  fork_requires_history: ["还没有可以分叉的对话", "先发送一条消息再分叉", "retry"],
};

/** The protocol code behind an error, when it carries one (`invalid_payload: query` → "invalid_payload"). */
export function errorCode(e: unknown): string | undefined {
  return parseProtocolError(e)?.code;
}

/** Map engine, provider and host error codes to a friendly description. */
export function describeError(e: unknown): ErrorDescription {
  const raw = rawErrorText(e);
  const lower = raw.toLowerCase();
  const d = (title: string, hint?: string, action?: ErrorDescription["action"]): ErrorDescription => ({ title, hint, action, raw });
  const coded = parseProtocolError(e);
  const copy = coded ? CODE_COPY[coded.code] : undefined;
  if (copy) return d(copy[0], coded!.code === "invalid_payload" && coded!.message ? `${copy[1]}（字段：${coded!.message}）` : copy[1], copy[2]);
  // The renderer bridge reports a missing handler with this sentence (client ipc.ts).
  if (raw.includes("暂不可用")) return d(CODE_COPY.not_implemented[0], CODE_COPY.not_implemented[1]);
  if (/too_many_running/.test(raw)) return d("同时运行的任务已达上限", "等其中一个任务完成后再发送", "wait");
  if (raw.includes("会话忙碌") || lower.includes("already processing")) return d("上一条消息还在处理中", "等待回复完成，或点停止后再发送", "wait");
  if (raw.includes("queue_unavailable")) return d("当前没有正在运行的回复，无法插入消息", "直接发送即可", "retry");
  if (raw.includes("model_does_not_support_images")) return d("当前模型不支持图片", "换一个支持图片输入的模型，或移除图片附件", "model");
  if (raw.includes("model_auth_missing") || lower.includes("no api key") || lower.includes("api key")) return d("模型服务商还没有配置 API Key", "在设置 → 模型中填写 API Key", "settings");
  if (raw.includes("model_not_found")) return d("当前模型已不可用", "重新选择一个模型", "model");
  if (raw.includes("model_ambiguous")) return d("存在同名模型", "在模型列表中明确选择服务商", "model");
  if (raw.includes("file_not_authorized") || raw.includes("native_file") || raw.includes("file_changed")) return d("附件需要重新选择", "文件在选择后被修改或未授权，请重新添加", "retry");
  if (raw.includes("attachment_too_large") || raw.includes("images_too_large")) return d("附件太大", "图片单个 10 MB、文本单个 256 KB 以内，总计 20 MB", "retry");
  if (raw.includes("unsupported_attachment")) return d("不支持该附件类型", "目前支持图片和 UTF-8 文本文件", "retry");
  if (raw.includes("invalid_image")) return d("图片无法解析", "换一张图片再试", "retry");
  if (raw.includes("extension_load_failed")) return d("扩展加载失败", "在 技能·连接器 → 扩展 中检查或停用该扩展", "settings");
  if (raw.includes("workspace_not_authorized")) return d("工作空间未授权", "通过「选择工作空间 → 打开本地文件夹」重新选择", "retry");
  if (raw.includes("会话未加载") || raw.includes("会话不存在")) return d("任务已关闭或不存在", "从侧栏重新打开该任务", "retry");
  if (raw.includes("安全密钥存储不可用")) return d("系统钥匙串不可用，无法安全保存 API Key", "Linux 请安装并解锁 gnome-keyring 或 KWallet 后重启应用", "settings");
  if (/\b429\b/.test(raw) || lower.includes("rate limit") || lower.includes("too many requests")) return d("已达到模型用量上限", "稍等片刻再重试，或换一个模型", "retry");
  if (/\b(401|403)\b/.test(raw) || lower.includes("unauthorized") || lower.includes("invalid api key") || lower.includes("authentication")) return d("API Key 无效或已过期", "在设置 → 模型中检查 API Key", "settings");
  if (lower.includes("context") && (lower.includes("length") || lower.includes("too long") || lower.includes("overflow"))) return d("对话太长，超出了模型的上下文", "输入 /compact 压缩上下文，或新建任务", "retry");
  if (/\b(500|502|503|504)\b/.test(raw) || lower.includes("overloaded") || lower.includes("internal server error")) return d("模型服务暂时不可用", "稍后重试，或换一个模型", "retry");
  if (lower.includes("econnrefused") || lower.includes("enotfound") || lower.includes("network") || lower.includes("fetch failed") || lower.includes("timeout") || lower.includes("connection")) return d("无法连接到模型服务", "检查网络或代理，以及服务商的接口地址", "retry");
  if (lower.includes("aborted")) return d("已停止", undefined, undefined);
  return d(raw.length > 80 ? "本轮执行出错" : raw || "本轮执行出错", raw.length > 80 ? "展开查看原始错误" : undefined, "retry");
}
