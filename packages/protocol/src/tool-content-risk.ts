/**
 * 工具内容注入审查 (G2-7)：`agent://tool-content-risk` 的载荷。
 *
 * 工具输出里的提示注入在回灌给模型之前被拦下；这条事件告诉界面「哪次工具调用被拦了、
 * 命中了哪条规则」，用户可以明确「仍要使用」。
 */
export interface ToolContentRiskEvent {
  sessionId: string;
  toolCallId: string;
  toolName: string;
  /** 命中的规则 id。 */
  rule: string;
  severity: "high" | "medium";
  /** 给用户看的原因。 */
  reason: string;
  /** 命中的原文片段（截断预览）。 */
  excerpt: string;
}
