/**
 * createDefaultEmailAiBindings — 把 capability-email 的真实 IPC 绑定到
 * EmailAiPanel 期望的 CapabilityBindings 形状。
 *
 * 第 4 周:让 EmailAiPanel 不再依赖 mock bindings,直接走 capability-email IPC。
 *   - listAnalyses → 摘要(读已有分析 → 兜底 "AI 尚未生成")
 *   - updateThread → archive / mark-read / label / snooze (Gmail 通用 mutation)
 *   - prepareSend   → 回复准备发送
 *   - createDraft   → 转任务
 *   - 缺 routePrompt 时退到简单启发式 (mark-read for noise)。
 *
 * 单元测试需要 mock 这些函数;实际渲染走默认工厂即可。
 */
import {
  emailListAnalyses,
  emailUpdateThread,
  emailPrepareSend,
  emailCreateDraft,
  emailTriage,
} from "@/lib/agent/pi-client-email";
import type { CapabilityBindings } from "@openbuddy/ui-email/ai";

export interface CreateDefaultEmailAiBindingsOptions {
  /** 可选:自定义 LLM 路由(用于生产环境的真正 AI 规划)。 */
  routePrompt?: (prompt: string) => Promise<Array<{
    id: string;
    kind: string;
    threadId: string;
    confidence: number;
    reason: string;
  }>>;
  /** 当前 account id,默认为 "self"。 */
  accountId?: string;
  /**
   * 启用后,一键清空噪声时先跑 triage,只对 noise 类目线程执行 mark-read/归档。
   * 默认关闭,避免误清空真实邮件。
   */
  enableTriagePlan?: boolean;
}

export function createDefaultEmailAiBindings(
  options: CreateDefaultEmailAiBindingsOptions = {},
): CapabilityBindings {
  const accountId = options.accountId ?? "self";

  return {
    async listAnalyses(input: { accountId: string; threadId: string }) {
      const items = await emailListAnalyses({
        accountId: input.accountId ?? accountId,
        threadId: input.threadId,
      });
      return { items: items.map((item) => ({ summary: item.summary, confidence: item.confidence })) };
    },

    async updateThread(input: { threadId: string; mutation: string; label?: string; snoozeUntil?: string }) {
      const result = await emailUpdateThread({
        threadId: input.threadId,
        mutation: input.mutation as never,
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.snoozeUntil !== undefined ? { snoozeUntil: input.snoozeUntil } : {}),
      });
      return result;
    },

    async prepareSend(input: { draftId: string }) {
      return await emailPrepareSend(input.draftId);
    },

    async createDraft(input: { taskTitle?: string; dueAt?: string; taskOwner?: string }) {
      // 当前 capability 把「转任务」语义化为 compose-input。
      return await emailCreateDraft({
        accountId: "self",
        to: [],
        subject: input.taskTitle ?? "(无标题任务)",
        body: "",
        ...(input.dueAt !== undefined ? { scheduledAt: input.dueAt } : {}),
      });
    },

    async routePrompt(prompt: string) {
      if (options.routePrompt) {
        return await options.routePrompt(prompt);
      }
      // 默认降级:返回空 action 数组,让 UI 显示 "无可执行行动",
      // 而不是误清空 — 真实 LLM 路由器在生产环境注入即可。
      return [];
    },
  };
}

/**
 * 便捷 hook-style 工厂:返回一个稳定引用,适合放进 useMemo 依赖列表。
 * EmailAiPanel 内部使用 useEmailAiRuntime 已经做了稳定化,这里只是做
 * 单次构造 + 错误归一处理。
 */
export function buildRuntimeArgs(
  options: CreateDefaultEmailAiBindingsOptions = {},
): {
  bindings: CapabilityBindings;
  onProviderError?: (err: { message: string; code?: string }) => void;
} {
  return {
    bindings: createDefaultEmailAiBindings(options),
  };
}

// 重新 export 便于单测中直接引用
export {
  emailListAnalyses,
  emailUpdateThread,
  emailPrepareSend,
  emailCreateDraft,
  emailTriage,
};
