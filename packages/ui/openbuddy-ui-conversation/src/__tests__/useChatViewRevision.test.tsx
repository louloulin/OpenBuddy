/**
 * useChatViewRevision.test.tsx — Plan5 组件化回归测试
 *
 * 验证 useChatViewRevision hook 的核心契约:
 *   - handleEditResend:写入 resendText + 增加 nonce;无 editResendOriginId 时不写 revision
 *   - handleInlineResend:相同行为,但直接接受 messageId
 *   - handleQuickPrompt:仅写 resendText,无 revision
 *   - handleResendAfterAssistantEdit:触发 handleRetryRef.current
 *   - handleStepRevision:无 revisions 时静不操作
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useChatViewRevision } from "../chatview/useChatViewRevision";

// 模拟 session-store 的最小接口;在 beforeEach 中重置计数,保证测试隔离。
const mockState = {
  messages: [] as Array<{
    id: string;
    revisions?: string[];
    activeRevision?: number;
  }>,
  calls: {
    appendUserRevision: [] as Array<[string, string]>,
    setActiveRevision: [] as Array<[string, number]>,
    editAssistantMessage: [] as Array<[string, string]>,
  },
};
vi.mock("@/stores/session-store", () => ({
  useSessionStore: {
    getState: () => ({
      messages: mockState.messages,
      appendUserRevision: (id: string, text: string) => {
        mockState.calls.appendUserRevision.push([id, text]);
      },
      setActiveRevision: (id: string, n: number) => {
        mockState.calls.setActiveRevision.push([id, n]);
      },
      editAssistantMessage: (id: string, md: string) => {
        mockState.calls.editAssistantMessage.push([id, md]);
      },
    }),
  },
}));
const storeMock = mockState;

beforeEach(() => {
  storeMock.calls.appendUserRevision.length = 0;
  storeMock.calls.setActiveRevision.length = 0;
  storeMock.calls.editAssistantMessage.length = 0;
});

describe("useChatViewRevision (Plan5 componentization)", () => {
  it("handleEditResend:无 originId 时不写 revision,仅 seed composer", () => {
    const handleRetryRef = { current: null };
    const { result } = renderHook(() => useChatViewRevision({ handleRetryRef }));
    act(() => result.current.handleEditResend("hello"));
    expect(storeMock.calls.appendUserRevision.length).toBe(0);
    expect(result.current.resendText).toBe("hello");
    expect(result.current.resendNonce).toBe(1);
  });

  it("handleInlineResend:写入 revision + seed composer", () => {
    const handleRetryRef = { current: null };
    const { result } = renderHook(() => useChatViewRevision({ handleRetryRef }));
    act(() => result.current.handleInlineResend("msg-1", "hi"));
    expect(storeMock.calls.appendUserRevision).toEqual([["msg-1", "hi"]]);
    expect(result.current.resendText).toBe("hi");
    expect(result.current.resendNonce).toBe(1);
  });

  it("handleQuickPrompt:仅 seed composer,不写 revision", () => {
    const handleRetryRef = { current: null };
    const { result } = renderHook(() => useChatViewRevision({ handleRetryRef }));
    act(() => result.current.handleQuickPrompt("explain X"));
    expect(storeMock.calls.appendUserRevision.length).toBe(0);
    expect(result.current.resendText).toBe("explain X");
  });

  it("handleEditAssistantMessage:转发到 store.editAssistantMessage", () => {
    const handleRetryRef = { current: null };
    const { result } = renderHook(() => useChatViewRevision({ handleRetryRef }));
    act(() => result.current.handleEditAssistantMessage("msg-2", "# new"));
    expect(storeMock.calls.editAssistantMessage).toEqual([["msg-2", "# new"]]);
  });

  it("handleResendAfterAssistantEdit:触发 handleRetryRef.current", () => {
    const retryFn = vi.fn();
    const handleRetryRef = { current: retryFn };
    const { result } = renderHook(() => useChatViewRevision({ handleRetryRef }));
    act(() => result.current.handleResendAfterAssistantEdit("msg-3"));
    expect(retryFn).toHaveBeenCalledTimes(1);
  });

  it("handleStepRevision:无 revisions 时静不操作", () => {
    const handleRetryRef = { current: null };
    const { result } = renderHook(() => useChatViewRevision({ handleRetryRef }));
    // 消息数组为空,不会触发任何 store 调用
    act(() => result.current.handleStepRevision("missing", 1));
    expect(storeMock.calls.setActiveRevision.length).toBe(0);
  });

  it("空字符串 / 纯空白被丢弃", () => {
    const handleRetryRef = { current: null };
    const { result } = renderHook(() => useChatViewRevision({ handleRetryRef }));
    act(() => result.current.handleEditResend("   "));
    expect(result.current.resendText).toBeUndefined();
  });
});
