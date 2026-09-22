/**
 * 本地 token 估算 —— 对齐 WorkBuddy `credit-prediction` / `credit-estimate`
 * 的「发送前成本预估」意图,但不依赖计费后端(OpenBuddy 是 BYOK,无计费通道)。
 *
 * 用启发式近似计 token(不调用分词器):
 *  - CJK(中日韩)字符 ≈ 1 token/字(BPE 下大致如此)
 *  - 拉丁/西文按空白分词,每词 ≈ 1.3 token(GPT 家族经验值)
 *  - 标点/空白单独近似
 *
 * 纯函数、无副作用,便于单测。用于 Composer 发送前预估徽章。
 */
import type { ChatMessage } from "@/stores/session-store";

/** 单段文本的 token 估算。 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  let tokens = 0;
  // CJK 字符(常用区间):每个 ≈ 1 token。
  const cjk = text.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g);
  if (cjk) tokens += cjk.length;
  // 移除 CJK 后,对剩余按空白分词。
  const latin = text.replace(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g, " ");
  const words = latin.split(/\s+/).filter(Boolean);
  // 每词 ≈ 1.3 token。
  tokens += words.reduce((s, w) => s + wordTokens(w), 0);
  return Math.ceil(tokens);
}

/** 单词的 token 估算:长词(>6 字符)按 1 token/4 字符,短词按 1 token。 */
function wordTokens(word: string): number {
  const clean = word.replace(/[^\p{L}\p{N}]+/gu, "");
  if (!clean) return 0;
  if (clean.length <= 6) return 1;
  return Math.ceil(clean.length / 4);
}

/**
 * 对一条消息的全部 parts 聚合 token 估算。
 *  - text / thought:取原文
 *  - tool_call:取 title + content(command/output/text/diff path)
 */
export function estimateMessageTokens(message: ChatMessage): number {
  let total = 0;
  for (const p of message.parts) {
    if (p.kind === "text") {
      total += estimateTextTokens(p.text);
    } else if (p.kind === "thought") {
      total += estimateTextTokens(p.text);
    } else if (p.kind === "tool_call") {
      total += estimateToolCallTokens(p.toolCall);
    }
  }
  return total;
}

/** 工具调用的 token 估算(title + command + 输出 + diff path + raw input)。 */
export function estimateToolCallTokens(tc: {
  title: string;
  content?: Array<
    | { type: "text"; text: string }
    | { type: "command_output"; command?: string; output: string }
    | { type: "diff"; diff: { path: string; old: string; new: string } }
  >;
  rawInput?: unknown;
}): number {
  let total = estimateTextTokens(tc.title);
  for (const c of tc.content ?? []) {
    if (c.type === "command_output") {
      if (c.command) total += estimateTextTokens(c.command);
      total += estimateTextTokens(c.output);
    } else if (c.type === "text") {
      total += estimateTextTokens(c.text);
    } else if (c.type === "diff") {
      total += estimateTextTokens(c.diff.path);
      total += estimateTextTokens(c.diff.old);
      total += estimateTextTokens(c.diff.new);
    }
  }
  if (tc.rawInput != null) {
    const raw = typeof tc.rawInput === "string" ? tc.rawInput : JSON.stringify(tc.rawInput);
    total += estimateTextTokens(raw);
  }
  return total;
}

/** 对一组消息求和(用于会话已用上下文估算)。 */
export function estimateConversationTokens(messages: ChatMessage[]): number {
  return messages.reduce((s, m) => s + estimateMessageTokens(m), 0);
}

/**
 * 把单条待发送文本的估算 token 转成「发送前成本预估」:
 *  - 在会话已有上下文(used + 新增)基础上,估算占总窗口的比例
 *  - 返回 { newTokens, projectedTotal, projectedPct, label, severity }
 *
 * severity 用于徽章配色:ok(<60%) / warn(60–85%) / danger(>85%)。
 */
export interface CostEstimate {
  /** 待发送文本的估算 token。 */
  newTokens: number;
  /** 加上已有上下文后的预估总 token(无 ctxUsed 时 = newTokens)。 */
  projectedTotal: number;
  /** 相对 ctxTotal 的占比(0–100;ctxTotal 缺省时为 0)。 */
  projectedPct: number;
  /** 人类可读标签(如「+320 · 预计 12%」)。 */
  label: string;
  /** 徽章配色级别。 */
  severity: "ok" | "warn" | "danger";
}

export function estimateSendCost(
  text: string,
  ctxUsed?: number,
  ctxTotal?: number,
): CostEstimate {
  const newTokens = estimateTextTokens(text);
  const projectedTotal = (ctxUsed ?? 0) + newTokens;
  const projectedPct = ctxTotal && ctxTotal > 0
    ? Math.round((projectedTotal / ctxTotal) * 100)
    : 0;
  const severity: CostEstimate["severity"] =
    projectedPct > 85 ? "danger" : projectedPct > 60 ? "warn" : "ok";
  const label = `+${newTokens}${projectedPct > 0 ? ` · 预计 ${projectedPct}%` : ""}`;
  return { newTokens, projectedTotal, projectedPct, label, severity };
}
