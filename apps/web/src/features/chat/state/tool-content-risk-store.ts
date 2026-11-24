import { useEffect } from "react";
import { create } from "zustand";
import { subscribeToolContentRisk } from "@openbuddy/client/api/approvals";
import type { ToolContentRiskEvent } from "@openbuddy/protocol/tool-content-risk";

/**
 * 工具内容注入审查 (G2-7)：`agent://tool-content-risk` 事件按会话折叠。
 *
 * 引擎在工具输出回灌给模型之前拦下疑似提示注入，这里保存这些事件，
 * 让聊天页能显示一张「已拦截」卡片，并让用户明确「仍要使用」。
 */
interface RiskState {
  risks: Record<string, ToolContentRiskEvent[]>;
  apply(event: ToolContentRiskEvent): void;
  /** 移除一条（用户选择「仍要使用」或「忽略」之后）。 */
  dismiss(toolCallId: string): void;
}

export const useToolContentRiskStore = create<RiskState>((set) => ({
  risks: {},
  apply: (event) =>
    set((state) => {
      const list = state.risks[event.sessionId] ?? [];
      if (list.some((one) => one.toolCallId === event.toolCallId)) return state;
      return { risks: { ...state.risks, [event.sessionId]: [...list, event] } };
    }),
  dismiss: (toolCallId) =>
    set((state) => {
      const next: Record<string, ToolContentRiskEvent[]> = {};
      for (const [sessionId, list] of Object.entries(state.risks)) {
        const kept = list.filter((one) => one.toolCallId !== toolCallId);
        if (kept.length) next[sessionId] = kept;
      }
      return { risks: next };
    }),
}));

/** Mounted once by the app shell: keeps the store in sync with `agent://tool-content-risk`. */
export function useToolContentRiskFeed() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    subscribeToolContentRisk((event) => useToolContentRiskStore.getState().apply(event)).then(
      (off) => { if (disposed) off(); else unlisten = off; },
      () => { /* no host bridge (tests, plain browser) */ },
    );
    return () => { disposed = true; unlisten?.(); };
  }, []);
}
