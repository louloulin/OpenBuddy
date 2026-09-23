/**
 * InlineApprovalHint.test.tsx — P1-2 P0-AI-Chat-Audit 升级护栏。
 *
 * 改造点(Codex 范式):
 *   - 折叠态新增三按钮快操作行:允许 / 拒绝 / 稍后
 *   - 允许/拒绝:只对 permission 队列生效,纯提问队列按钮 disabled
 *   - 稍后:仅收起展开 UI,队列内容保留
 *
 * 守住的契约:
 *   1. 0 permission + 0 question → 不渲染(R5-like null 边界)
 *   2. permission > 0 → 三个按钮都可见 + 启用
 *   3. question > 0 且 permission === 0 → 「允许」「拒绝」disabled
 *   4. 点击「允许」→ 调 piResolvePermission(optionId=allow 的 optionId)+ dismiss
 *   5. 点击「拒绝」→ 调 piResolvePermission(optionId=deny 的 optionId, cancelled=true)+ dismiss
 *   6. 点击「稍后」→ 不调 IPC,只 setExpanded(false);队列不动
 *   7. data-severity=permission / question 反映队列组成
 *   8. busy 期间所有按钮 disable=true(防止双击重复触发)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// Block vite-tsconfig-paths from following the import chain to electron-api
// which transitively pulls @openbuddy/ui-state/global-confirm-store (this
// subpath is unresolvable in the test env — same root cause as the 13
// pre-existing failures). Mocking electron-api at the alias level lets
// pi-client import a stub and the whole chain short-circuits.
const { piResolvePermission } = vi.hoisted(() => ({
  piResolvePermission: vi.fn(async () => {}),
}));
vi.mock("@/lib/platform/electron-api", () => ({}));
vi.mock("@/lib/agent/pi-client", () => ({
  piResolvePermission,
}));

import { usePermissionStore } from "@openbuddy/ui-state/permission-store";
import { useQuestionStore } from "@openbuddy/ui-state/question-store";
import { InlineApprovalHint } from "../InlineApprovalHint";

beforeEach(() => {
  piResolvePermission.mockClear();
  // 清空两个 store 的所有 session 队列
  usePermissionStore.setState({ queues: {} });
  useQuestionStore.setState({ queues: {} });
});
afterEach(() => cleanup());

function seedPermission(sessionId: string, requestId: string, options = [
  { optionId: "allow-once", kind: "allow", title: "允许一次" },
  { optionId: "allow-always", kind: "allow_always", title: "始终允许" },
  { optionId: "deny", kind: "deny", title: "拒绝" },
] as Array<{ optionId: string; kind: "allow" | "allow_always" | "deny"; title: string }>) {
  usePermissionStore.setState((s) => ({
    ...s,
    queues: {
      ...s.queues,
      [sessionId]: [
        {
          requestId,
          sessionId,
          toolKind: "bash",
          rawInput: { cmd: "echo" },
          title: "执行 shell",
          createdAt: Date.now(),
          options,
        },
      ],
    },
  }));
}

function seedQuestion(sessionId: string, requestId: string) {
  useQuestionStore.setState((s) => ({
    ...s,
    queues: {
      ...s.queues,
      [sessionId]: [
        {
          requestId,
          sessionId,
          question: "选择模型?",
          options: [{ label: "M2", description: "快速" }],
          createdAt: Date.now(),
        },
      ],
    },
  }));
}

describe("InlineApprovalHint P1-2 Codex 范式升级", () => {
  it("null sessionId → 整段不渲染", () => {
    const { container } = render(<InlineApprovalHint sessionId={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("0 permission + 0 question → 整段不渲染(R5-like null 边界)", () => {
    const { container } = render(<InlineApprovalHint sessionId="s1" />);
    expect(container.firstChild).toBeNull();
  });

  it("permission 队列 > 0 → 渲染 chip + 三按钮(允许/拒绝/稍后)全部启用", () => {
    seedPermission("s1", "r1");
    render(<InlineApprovalHint sessionId="s1" />);
    const hint = screen.getByTestId("msg-approval-hint");
    expect(hint).toHaveAttribute("data-permission-count", "1");
    expect(hint).toHaveAttribute("data-question-count", "0");
    expect(hint).toHaveAttribute("data-severity", "permission");
    const allow = screen.getByTestId("msg-approval-hint-allow");
    const deny = screen.getByTestId("msg-approval-hint-deny");
    const defer = screen.getByTestId("msg-approval-hint-defer");
    expect(allow).not.toBeDisabled();
    expect(deny).not.toBeDisabled();
    expect(defer).not.toBeDisabled();
    expect(allow).toHaveAttribute("aria-label", "允许");
    expect(deny).toHaveAttribute("aria-label", "拒绝");
    expect(defer).toHaveAttribute("aria-label", "稍后");
  });

  it("question 队列 > 0 且 permission === 0 → 「允许」「拒绝」disabled,只有「稍后」启用", () => {
    seedQuestion("s1", "r1");
    render(<InlineApprovalHint sessionId="s1" />);
    const hint = screen.getByTestId("msg-approval-hint");
    expect(hint).toHaveAttribute("data-severity", "question");
    expect(hint).toHaveAttribute("data-permission-count", "0");
    expect(hint).toHaveAttribute("data-question-count", "1");
    expect(screen.getByTestId("msg-approval-hint-allow")).toBeDisabled();
    expect(screen.getByTestId("msg-approval-hint-deny")).toBeDisabled();
    expect(screen.getByTestId("msg-approval-hint-defer")).not.toBeDisabled();
  });

  it("点击「允许」→ 调 piResolvePermission(allow optionId, cancelled=false) + dismiss 队列", async () => {
    seedPermission("s1", "r1");
    render(<InlineApprovalHint sessionId="s1" />);
    fireEvent.click(screen.getByTestId("msg-approval-hint-allow"));
    // wait microtask flush
    await Promise.resolve();
    await Promise.resolve();
    expect(piResolvePermission).toHaveBeenCalledTimes(1);
    expect(piResolvePermission).toHaveBeenCalledWith("r1", {
      optionId: "allow-once",
      cancelled: false,
    });
    // dismiss 后队列清空,hint 应消失
    expect(usePermissionStore.getState().queues.s1 ?? []).toHaveLength(0);
  });

  it("点击「拒绝」→ 调 piResolvePermission(deny optionId, cancelled=true) + dismiss 队列", async () => {
    seedPermission("s1", "r1");
    render(<InlineApprovalHint sessionId="s1" />);
    fireEvent.click(screen.getByTestId("msg-approval-hint-deny"));
    await Promise.resolve();
    await Promise.resolve();
    expect(piResolvePermission).toHaveBeenCalledTimes(1);
    expect(piResolvePermission).toHaveBeenCalledWith("r1", {
      optionId: "deny",
      cancelled: true,
    });
    expect(usePermissionStore.getState().queues.s1 ?? []).toHaveLength(0);
  });

  it("点击「稍后」→ 不调 IPC,仅收起展开 UI;队列保留", async () => {
    seedPermission("s1", "r1");
    const { rerender } = render(<InlineApprovalHint sessionId="s1" />);
    // 先展开(模拟用户曾点过 toggle)
    fireEvent.click(screen.getByRole("button", { name: /展开待审批/ }));
    expect(screen.getByTestId("msg-approval-hint")).toHaveClass("msg__approval-hint--expanded");
    fireEvent.click(screen.getByTestId("msg-approval-hint-defer"));
    await Promise.resolve();
    expect(piResolvePermission).not.toHaveBeenCalled();
    rerender(<InlineApprovalHint sessionId="s1" />);
    expect(screen.getByTestId("msg-approval-hint")).not.toHaveClass("msg__approval-hint--expanded");
    // 队列保留(没被 dismiss)
    expect(usePermissionStore.getState().queues.s1 ?? []).toHaveLength(1);
  });

  it("onToast 透传:允许成功 → toast「已允许」;失败 → toast「操作失败...」", async () => {
    seedPermission("x", "rx");
    const onToast = vi.fn();
    // 第一次成功
    const { rerender: rerender1 } = render(<InlineApprovalHint sessionId="x" onToast={onToast} />);
    fireEvent.click(screen.getByTestId("msg-approval-hint-allow"));
    await Promise.resolve();
    await Promise.resolve();
    expect(onToast).toHaveBeenLastCalledWith("已允许");

    // 第二次失败
    piResolvePermission.mockRejectedValueOnce(new Error("boom"));
    seedPermission("x", "rx2");
    rerender1(<InlineApprovalHint sessionId="x" onToast={onToast} />);
    fireEvent.click(screen.getByTestId("msg-approval-hint-allow"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(onToast).toHaveBeenLastCalledWith("操作失败,请打开完整审批卡");
  });
});
