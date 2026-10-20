// @vitest-environment jsdom
/**
 * PermissionOverrideDialog 核心契约测试 (P1.2 三件套之 2)
 *
 * 覆盖:
 *   - open=false 不渲染;open=true 渲染
 *   - 关闭/打开时 local state 重置为 props 传入值
 *   - 编辑 mode、编辑 rule action
 *   - 应用触发 onApply(mode, rules) + 关闭
 *   - 取消触发 onClose 但不触发 onApply
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PermissionOverrideDialog } from "../PermissionOverrideDialog.js";
import type { PermissionRule } from "@openbuddy/auth-permission";

function makeRule(overrides: Partial<PermissionRule> = {}): PermissionRule {
  return {
    action: "allow",
    tool: "bash",
    ...overrides,
  };
}

const defaultProps = {
  open: true,
  sessionId: "session-abc-123",
  currentMode: "default" as const,
  rules: [
    makeRule({ tool: "bash", action: "allow", pattern: "git *" }),
    makeRule({ tool: "write", action: "deny" }),
  ],
  onClose: vi.fn(),
  onApply: vi.fn(async () => undefined),
};

describe("PermissionOverrideDialog — 渲染契约", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("open=false 时不渲染对话框", () => {
    render(<PermissionOverrideDialog {...defaultProps} open={false} />);
    expect(screen.queryByTestId("permission-override-dialog")).not.toBeInTheDocument();
  });

  it("open=true 时渲染对话框与 session id", () => {
    render(<PermissionOverrideDialog {...defaultProps} />);
    expect(screen.getByTestId("permission-override-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("permission-override-session-id")).toHaveTextContent(
      "session-abc-123",
    );
  });

  it("sessionId=null 时显示 (无) 占位", () => {
    render(<PermissionOverrideDialog {...defaultProps} sessionId={null} />);
    expect(screen.getByTestId("permission-override-session-id")).toHaveTextContent("(无)");
  });

  it("rules 为空时显示「当前无规则」占位", () => {
    render(<PermissionOverrideDialog {...defaultProps} rules={[]} />);
    expect(screen.getByText("当前无规则")).toBeInTheDocument();
    expect(screen.queryByTestId("permission-override-rules-table")).not.toBeInTheDocument();
  });
});

describe("PermissionOverrideDialog — local state 重置", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("打开时 mode 重置为 currentMode", () => {
    render(<PermissionOverrideDialog {...defaultProps} currentMode="default" />);
    expect((screen.getByTestId("permission-override-mode-select") as HTMLSelectElement).value).toBe(
      "default",
    );
    // 切换为 plan
    fireEvent.change(screen.getByTestId("permission-override-mode-select"), {
      target: { value: "plan" },
    });
    expect((screen.getByTestId("permission-override-mode-select") as HTMLSelectElement).value).toBe(
      "plan",
    );
  });

  it("从 close → open 时,local rules 重置为外部 props 传入值", async () => {
    const rules = [
      makeRule({ tool: "bash", action: "allow" }),
      makeRule({ tool: "write", action: "deny" }),
    ];
    const { rerender } = render(
      <PermissionOverrideDialog {...defaultProps} open={false} rules={rules} />,
    );
    // 打开
    rerender(<PermissionOverrideDialog {...defaultProps} open={true} rules={rules} />);
    // 局部编辑第 0 条
    fireEvent.change(screen.getByTestId("permission-override-rule-action-0"), {
      target: { value: "deny" },
    });
    expect(
      (screen.getByTestId("permission-override-rule-action-0") as HTMLSelectElement).value,
    ).toBe("deny");
    // 关闭再打开
    rerender(<PermissionOverrideDialog {...defaultProps} open={false} rules={rules} />);
    rerender(<PermissionOverrideDialog {...defaultProps} open={true} rules={rules} />);
    // local state 重置回 props 的初始值
    expect(
      (screen.getByTestId("permission-override-rule-action-0") as HTMLSelectElement).value,
    ).toBe("allow");
  });

  it("rules prop 变化时,local rules 跟随(打开状态下)", () => {
    const rulesA = [makeRule({ tool: "bash", action: "allow" })];
    const rulesB = [
      makeRule({ tool: "bash", action: "allow" }),
      makeRule({ tool: "write", action: "deny" }),
    ];
    const { rerender } = render(
      <PermissionOverrideDialog {...defaultProps} open={true} rules={rulesA} />,
    );
    expect(screen.queryByTestId("permission-override-rule-1")).not.toBeInTheDocument();
    rerender(<PermissionOverrideDialog {...defaultProps} open={true} rules={rulesB} />);
    expect(screen.getByTestId("permission-override-rule-1")).toBeInTheDocument();
  });
});

describe("PermissionOverrideDialog — 编辑交互", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("切换 rule action 只更新对应行,不影响其他行", () => {
    render(<PermissionOverrideDialog {...defaultProps} />);
    expect(
      (screen.getByTestId("permission-override-rule-action-0") as HTMLSelectElement).value,
    ).toBe("allow");
    expect(
      (screen.getByTestId("permission-override-rule-action-1") as HTMLSelectElement).value,
    ).toBe("deny");
    fireEvent.change(screen.getByTestId("permission-override-rule-action-0"), {
      target: { value: "ask" },
    });
    expect(
      (screen.getByTestId("permission-override-rule-action-0") as HTMLSelectElement).value,
    ).toBe("ask");
    expect(
      (screen.getByTestId("permission-override-rule-action-1") as HTMLSelectElement).value,
    ).toBe("deny");
  });

  it("切换 mode select 后值更新", () => {
    render(<PermissionOverrideDialog {...defaultProps} />);
    fireEvent.change(screen.getByTestId("permission-override-mode-select"), {
      target: { value: "bypassPermissions" },
    });
    expect(
      (screen.getByTestId("permission-override-mode-select") as HTMLSelectElement).value,
    ).toBe("bypassPermissions");
  });
});

describe("PermissionOverrideDialog — 应用/取消", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("点击「应用」触发 onApply 携带当前 mode + rules,然后 onClose", async () => {
    const onApply = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(
      <PermissionOverrideDialog
        {...defaultProps}
        onApply={onApply}
        onClose={onClose}
      />,
    );
    // 切 mode
    fireEvent.change(screen.getByTestId("permission-override-mode-select"), {
      target: { value: "plan" },
    });
    // 切 rule action
    fireEvent.change(screen.getByTestId("permission-override-rule-action-0"), {
      target: { value: "deny" },
    });
    fireEvent.click(screen.getByTestId("permission-override-apply"));
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(onApply).toHaveBeenCalledWith({
      mode: "plan",
      rules: [
        { action: "deny", tool: "bash", pattern: "git *" },
        { action: "deny", tool: "write" },
      ],
    });
    // 应用成功后自动关闭
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点击「取消」只触发 onClose,不触发 onApply", () => {
    const onApply = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(
      <PermissionOverrideDialog
        {...defaultProps}
        onApply={onApply}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId("permission-override-cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("点击遮罩层关闭对话框(不触发 apply)", () => {
    const onClose = vi.fn();
    const onApply = vi.fn(async () => undefined);
    const { container } = render(
      <PermissionOverrideDialog
        {...defaultProps}
        onClose={onClose}
        onApply={onApply}
      />,
    );
    const overlay = container.querySelector(".permission-override-overlay") as HTMLElement;
    expect(overlay).toBeTruthy();
    // 模拟 mousedown 发生在 overlay 自身(非 modal 内)
    fireEvent.mouseDown(overlay, { target: overlay, currentTarget: overlay });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });
});
