

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
  const raw = String(e).replace(/^(?:Error:\s*)?Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "").replace(/^Error:\s*/, "");
  if (raw.includes("model_auth_missing")) return "该提供商尚未配置 API Key，请先在设置中配置";
  if (raw.includes("model_ambiguous")) return "存在同名模型，请明确选择提供商后重试";
  if (raw.includes("model_not_found")) return "该模型已不可用，请在设置中检查配置或重新选择";
  return formatAgentError(raw) ?? raw;
}
