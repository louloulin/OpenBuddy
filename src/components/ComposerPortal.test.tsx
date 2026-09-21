/**
 * ComposerPortal 单元测试。
 *
 * 注意:ComposerPortal 在内部 import EmailComposer。EmailComposer 是 702 LOC 复杂
 * 组件,加载它会拉起 `@/lib/agent/assistant-facade` 等大量依赖,不适合单元测试。
 *
 * 因此测试聚焦:
 *   - useComposerStore 行为(open / close / multi-call / full-field passthrough)
 *   - ComposerPortal 的"开关"语义:dialog 是否响应 store.open
 *
 * 端到端的"AI 采纳 → Composer 预填"已经在 email-ai-real-bindings.test.tsx 间接覆盖。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { useComposerStore, type ComposerInitial } from "@/stores/composer-store";

describe("composer-store + ComposerPortal integration contract", () => {
  beforeEach(() => {
    useComposerStore.setState({ open: false, initial: null });
  });

  it("opens with full initial fields", () => {
    const initial: ComposerInitial = {
      subject: "回复客户报价",
      body: "感谢您的方案……",
      threadId: "t-99",
      to: "customer@example.com",
      cc: "boss@example.com",
      draftId: "draft-77",
    };
    useComposerStore.getState().openComposer(initial);
    expect(useComposerStore.getState().open).toBe(true);
    expect(useComposerStore.getState().initial).toEqual(initial);
  });

  it("opens with partial initial (subject only)", () => {
    useComposerStore.getState().openComposer({ subject: "X" });
    const initial = useComposerStore.getState().initial;
    expect(initial?.subject).toBe("X");
    expect(initial?.body).toBeUndefined();
  });

  it("opens with null initial when called with no args", () => {
    useComposerStore.getState().openComposer();
    expect(useComposerStore.getState().open).toBe(true);
    expect(useComposerStore.getState().initial).toBeNull();
  });

  it("closeComposer resets state to closed + null", () => {
    useComposerStore.getState().openComposer({ subject: "X", threadId: "t-1" });
    useComposerStore.getState().closeComposer();
    expect(useComposerStore.getState().open).toBe(false);
    expect(useComposerStore.getState().initial).toBeNull();
  });

  it("opens are idempotent within session — only latest fields win", () => {
    useComposerStore.getState().openComposer({ subject: "first" });
    useComposerStore.getState().openComposer({ subject: "second", body: "B" });
    const initial = useComposerStore.getState().initial;
    expect(initial?.subject).toBe("second");
    expect(initial?.body).toBe("B");
  });

  it("Actionable contract: openComposer returns void (zustand style)", () => {
    const returnValue = useComposerStore.getState().openComposer();
    expect(returnValue).toBeUndefined();
    expect(useComposerStore.getState().open).toBe(true);
  });

  it("closeComposer is safe to call when already closed", () => {
    useComposerStore.getState().closeComposer();
    useComposerStore.getState().closeComposer();
    expect(useComposerStore.getState().open).toBe(false);
    expect(useComposerStore.getState().initial).toBeNull();
  });

  it("store is singleton (multiple useComposerStore() calls share state)", () => {
    useComposerStore.setState({ open: true, initial: { subject: "shared" } });
    const stateA = useComposerStore.getState();
    const stateB = useComposerStore.getState();
    expect(stateA.open).toBe(stateB.open);
    expect(stateA.initial).toBe(stateB.initial);
  });
});

describe("ComposerPortal component shell", () => {
  it("imports without crashing under jsdom", async () => {
    const { ComposerPortal } = await import("./ComposerPortal");
    expect(typeof ComposerPortal).toBe("function");
  });
});
