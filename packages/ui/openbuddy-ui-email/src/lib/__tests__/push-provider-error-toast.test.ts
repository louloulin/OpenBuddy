/**
 * push-provider-error-toast.test.ts — 验证 EmailError code 透传到 toast UX 映射:
 *   - provider_unavailable → error + 8s + 「打开连接器」/「停止 AI」动作
 *   - rate_limited / network_error → warning + 「稍后重试」/「重试」
 *   - token_expired → error + ttlMs 0 + 「重新授权」(持久 toast)
 *   - invalid_input / operation_failed → error + 5s + 无动作
 *   - operation_not_supported → warning + 5s + 无动作
 *   - idempotency_conflict → info + 3s + 无动作
 *   - 未识别 code → 走 onToast 老 API
 *
 * 同 code 重复调用应该 dedup(同 id 5s 内覆盖),而不是堆栈。
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { useToastStore } from "@/stores/toast-store";
import {
  pushProviderErrorToast,
  PROVIDER_ERROR_TOAST_TABLE,
} from "../push-provider-error-toast";

beforeEach(() => {
  useToastStore.setState({ queue: [] });
});

afterEach(() => {
  useToastStore.setState({ queue: [] });
  vi.restoreAllMocks();
});

describe("pushProviderErrorToast", () => {
  it("provider_unavailable sets error toast with stop-AI action when sessionId+cancelAi given", () => {
    const cancelAi = vi.fn();
    pushProviderErrorToast({
      message: "没有已连接的邮箱 MCP 服务",
      code: "provider_unavailable",
      sessionId: "sess-1",
      cancelAi,
    });
    const queue = useToastStore.getState().queue;
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe("email:provider-unavailable");
    expect(queue[0].kind).toBe("error");
    expect(queue[0].ttlMs).toBe(8_000);
    expect(queue[0].action?.label).toBe("停止 AI");
    queue[0].action?.onClick();
    expect(cancelAi).toHaveBeenCalledWith("sess-1");
  });

  it("provider_unavailable falls back to 打开连接器 when no sessionId", () => {
    const onNavigate = vi.fn();
    const onToast = vi.fn();
    pushProviderErrorToast({
      message: "未授权",
      code: "provider_unavailable",
      onNavigate,
      onToast,
    });
    const queue = useToastStore.getState().queue;
    expect(queue[0].action?.label).toBe("打开连接器");
    queue[0].action?.onClick();
    expect(onNavigate).toHaveBeenCalledWith("专家·技能·连接器");
    expect(onToast).toHaveBeenCalled();
  });

  it("rate_limited renders warning toast with 稍后重试 action", () => {
    pushProviderErrorToast({ message: "请稍后再试", code: "rate_limited", onToast: vi.fn() });
    const q = useToastStore.getState().queue;
    expect(q[0]).toMatchObject({ kind: "warning", ttlMs: 5_000, action: { label: "稍后重试" } });
  });

  it("network_error renders warning toast with 重试 action", () => {
    pushProviderErrorToast({ message: "网络抖动", code: "network_error" });
    const q = useToastStore.getState().queue;
    expect(q[0]).toMatchObject({ kind: "warning", ttlMs: 5_000, action: { label: "重试" } });
  });

  it("token_expired persists (ttlMs: 0) with 重新授权 action", () => {
    const onNavigate = vi.fn();
    pushProviderErrorToast({ message: "授权过期", code: "token_expired", onNavigate });
    const q = useToastStore.getState().queue;
    expect(q[0]).toMatchObject({
      kind: "error",
      ttlMs: 0,
      id: "p:email:token-expired",
    });
    expect(q[0].action?.label).toBe("重新授权");
  });

  it("invalid_input / operation_failed render error toast without action", () => {
    pushProviderErrorToast({ message: "参数错", code: "invalid_input" });
    pushProviderErrorToast({ message: "操作失败", code: "operation_failed" });
    const q = useToastStore.getState().queue;
    expect(q.map((t) => ({ kind: t.kind, ttlMs: t.ttlMs, action: t.action }))).toEqual([
      { kind: "error", ttlMs: 5_000, action: undefined },
      { kind: "error", ttlMs: 5_000, action: undefined },
    ]);
  });

  it("operation_not_supported / idempotency_conflict render non-error toasts", () => {
    pushProviderErrorToast({ message: "能力不足", code: "operation_not_supported" });
    pushProviderErrorToast({ message: "幂等冲突", code: "idempotency_conflict" });
    const q = useToastStore.getState().queue;
    expect(q.map((t) => ({ kind: t.kind, ttlMs: t.ttlMs }))).toEqual([
      { kind: "warning", ttlMs: 5_000 },
      { kind: "info", ttlMs: 3_000 },
    ]);
  });

  it("unknown code falls through to onToast callback", () => {
    const onToast = vi.fn();
    pushProviderErrorToast({ message: "陌生错误", code: "some_future_code", onToast });
    expect(useToastStore.getState().queue).toHaveLength(0);
    expect(onToast).toHaveBeenCalledWith("陌生错误");
  });

  it("repeated provider_unavailable calls dedup by id (queue length stays 1)", () => {
    pushProviderErrorToast({ message: "v1", code: "provider_unavailable", onNavigate: () => undefined });
    pushProviderErrorToast({ message: "v2", code: "provider_unavailable", onNavigate: () => undefined });
    pushProviderErrorToast({ message: "v3", code: "provider_unavailable", onNavigate: () => undefined });
    const q = useToastStore.getState().queue;
    expect(q).toHaveLength(1);
    expect(q[0].message).toBe("v3");
  });
});

describe("PROVIDER_ERROR_TOAST_TABLE — spec alignment", () => {
  it("matches the spec.md §5.1 mapping (provider_unavailable/rate_limited/network_error/token_expired)", () => {
    expect(PROVIDER_ERROR_TOAST_TABLE.provider_unavailable).toEqual({ kind: "error", ttlMs: 8_000, actionLabel: "打开连接器" });
    expect(PROVIDER_ERROR_TOAST_TABLE.rate_limited).toEqual({ kind: "warning", ttlMs: 5_000, actionLabel: "稍后重试" });
    expect(PROVIDER_ERROR_TOAST_TABLE.network_error).toEqual({ kind: "warning", ttlMs: 5_000, actionLabel: "重试" });
    expect(PROVIDER_ERROR_TOAST_TABLE.token_expired).toEqual({ kind: "error", ttlMs: 0, actionLabel: "重新授权" });
  });
  it("covers 8 known EmailError codes (rate_limited / network_error / token_expired are the new ones per A11)", () => {
    expect(Object.keys(PROVIDER_ERROR_TOAST_TABLE).sort()).toEqual(
      [
        "idempotency_conflict",
        "invalid_input",
        "network_error",
        "operation_failed",
        "operation_not_supported",
        "provider_unavailable",
        "rate_limited",
        "token_expired",
      ].sort()
    );
  });
});
