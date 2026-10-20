// @vitest-environment jsdom
/**
 * PermissionPanel 核心契约测试 (P1.2 三件套之 1)
 *
 * 覆盖:
 *   - 视图切换(全部/允许/拒绝/询问)与每视图计数
 *   - 规则 CRUD(新增 / 切换 action / 删除)
 *   - mode 选择(5 个 PermissionMode 选项)
 *   - loading 状态、过滤为空、只读模式(无 callback)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PermissionPanel } from "../PermissionPanel.js";
import type { PermissionAction, PermissionMode, PermissionRule } from "@openbuddy/auth-permission";

function makeRule(overrides: Partial<PermissionRule> = {}): PermissionRule {
  return {
    action: "allow" as PermissionAction,
    tool: "bash",
    ...overrides,
  };
}

describe("PermissionPanel — 渲染契约", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("渲染标题、视图 tab、规则表与 mode 选择器", () => {
    const rules: PermissionRule[] = [
      makeRule({ tool: "bash", action: "allow", pattern: "git *" }),
      makeRule({ tool: "write", action: "deny" }),
    ];
    render(<PermissionPanel rules={rules} mode="default" />);
    expect(screen.getByTestId("permission-panel")).toBeInTheDocument();
    expect(screen.getByTestId("permission-mode-select")).toBeInTheDocument();
    expect(screen.getByTestId("permission-rules-table")).toBeInTheDocument();
    // 四个 tab 全部渲染
    expect(screen.getByTestId("permission-tab-all")).toBeInTheDocument();
    expect(screen.getByTestId("permission-tab-allow")).toBeInTheDocument();
    expect(screen.getByTestId("permission-tab-deny")).toBeInTheDocument();
    expect(screen.getByTestId("permission-tab-ask")).toBeInTheDocument();
  });

  it("空规则时显示 empty 占位文案", () => {
    render(<PermissionPanel rules={[]} mode="default" />);
    expect(screen.getByText("当前视图下没有规则")).toBeInTheDocument();
  });

  it("loading=true 时显示 loading 占位文案,而不是表格", () => {
    render(<PermissionPanel rules={[makeRule()]} mode="default" loading={true} />);
    expect(screen.getByText("加载中…")).toBeInTheDocument();
    expect(screen.queryByTestId("permission-rules-table")).not.toBeInTheDocument();
  });

  it("每个视图 tab 上显示该视图的规则数量(基于全量 rules,不基于当前过滤)", () => {
    const rules: PermissionRule[] = [
      makeRule({ action: "allow", tool: "bash" }),
      makeRule({ action: "allow", tool: "read" }),
      makeRule({ action: "deny", tool: "write" }),
      makeRule({ action: "ask", tool: "edit" }),
    ];
    render(<PermissionPanel rules={rules} mode="default" />);
    expect(screen.getByTestId("permission-tab-all")).toHaveTextContent("全部 (4)");
    expect(screen.getByTestId("permission-tab-allow")).toHaveTextContent("允许 (2)");
    expect(screen.getByTestId("permission-tab-deny")).toHaveTextContent("拒绝 (1)");
    expect(screen.getByTestId("permission-tab-ask")).toHaveTextContent("询问 (1)");
  });
});

describe("PermissionPanel — 视图过滤", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("点击 deny tab 后表格只显示 action='deny' 的规则", () => {
    const rules: PermissionRule[] = [
      makeRule({ action: "allow", tool: "bash" }),
      makeRule({ action: "deny", tool: "write" }),
      makeRule({ action: "deny", tool: "delete" }),
      makeRule({ action: "ask", tool: "edit" }),
    ];
    render(<PermissionPanel rules={rules} mode="default" />);
    fireEvent.click(screen.getByTestId("permission-tab-deny"));
    // 过滤后只剩 deny 两条
    expect(screen.getByTestId("permission-rule-0")).toHaveTextContent("write");
    expect(screen.getByTestId("permission-rule-1")).toHaveTextContent("delete");
    expect(screen.queryByText("bash")).not.toBeInTheDocument();
    expect(screen.queryByText("edit")).not.toBeInTheDocument();
    // 当前 tab 是 deny
    expect(screen.getByTestId("permission-tab-deny")).toHaveAttribute("aria-selected", "true");
  });

  it("点击 all tab 后显示全部规则", () => {
    const rules: PermissionRule[] = [
      makeRule({ action: "allow", tool: "bash" }),
      makeRule({ action: "deny", tool: "write" }),
    ];
    render(<PermissionPanel rules={rules} mode="default" />);
    fireEvent.click(screen.getByTestId("permission-tab-deny"));
    // 切回 all
    fireEvent.click(screen.getByTestId("permission-tab-all"));
    expect(screen.getByTestId("permission-rule-0")).toHaveTextContent("bash");
    expect(screen.getByTestId("permission-rule-1")).toHaveTextContent("write");
    expect(screen.getByTestId("permission-tab-all")).toHaveAttribute("aria-selected", "true");
  });

  it("视图下无规则时显示 empty 占位", () => {
    const rules: PermissionRule[] = [makeRule({ action: "allow", tool: "bash" })];
    render(<PermissionPanel rules={rules} mode="default" />);
    fireEvent.click(screen.getByTestId("permission-tab-ask"));
    expect(screen.getByText("当前视图下没有规则")).toBeInTheDocument();
  });
});

describe("PermissionPanel — 规则 CRUD", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("输入工具名 + pattern + action 后点添加,onRuleAdd 收到正确 payload", async () => {
    const onRuleAdd = vi.fn(async () => undefined);
    render(
      <PermissionPanel rules={[]} mode="default" onRuleAdd={onRuleAdd} />,
    );
    fireEvent.change(screen.getByTestId("permission-add-tool"), {
      target: { value: "bash" },
    });
    fireEvent.change(screen.getByTestId("permission-add-pattern"), {
      target: { value: "npm *" },
    });
    fireEvent.change(screen.getByTestId("permission-add-action"), {
      target: { value: "deny" },
    });
    fireEvent.click(screen.getByTestId("permission-add-submit"));
    await waitFor(() => expect(onRuleAdd).toHaveBeenCalledTimes(1));
    expect(onRuleAdd).toHaveBeenCalledWith({
      action: "deny",
      tool: "bash",
      pattern: "npm *",
    });
  });

  it("添加时若省略 pattern,rule 不含 pattern 字段", async () => {
    const onRuleAdd = vi.fn(async (_rule: PermissionRule) => undefined);
    render(
      <PermissionPanel rules={[]} mode="default" onRuleAdd={onRuleAdd} />,
    );
    fireEvent.change(screen.getByTestId("permission-add-tool"), {
      target: { value: "read" },
    });
    fireEvent.change(screen.getByTestId("permission-add-pattern"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByTestId("permission-add-submit"));
    await waitFor(() => expect(onRuleAdd).toHaveBeenCalledTimes(1));
    expect(onRuleAdd).toHaveBeenCalledWith({
      action: "allow",
      tool: "read",
    });
    // pattern 字段不应存在(undefined)
    // 类型层断言:参数必须是 PermissionRule,pattern 字段不存在(纯工具名规则)
    const call = onRuleAdd.mock.calls[0];
    expect(call).toBeDefined();
    const passedRule = call![0] as PermissionRule;
    expect(passedRule.pattern).toBeUndefined();
  });

  it("tool 为空时添加按钮 disabled", () => {
    render(
      <PermissionPanel rules={[]} mode="default" onRuleAdd={vi.fn(async () => undefined)} />,
    );
    expect(screen.getByTestId("permission-add-submit")).toBeDisabled();
    fireEvent.change(screen.getByTestId("permission-add-tool"), {
      target: { value: "bash" },
    });
    expect(screen.getByTestId("permission-add-submit")).not.toBeDisabled();
  });

  it("成功后清空新增表单的输入", async () => {
    const onRuleAdd = vi.fn(async () => undefined);
    render(
      <PermissionPanel rules={[]} mode="default" onRuleAdd={onRuleAdd} />,
    );
    fireEvent.change(screen.getByTestId("permission-add-tool"), {
      target: { value: "bash" },
    });
    fireEvent.change(screen.getByTestId("permission-add-pattern"), {
      target: { value: "git *" },
    });
    fireEvent.click(screen.getByTestId("permission-add-submit"));
    await waitFor(() => expect(onRuleAdd).toHaveBeenCalledTimes(1));
    expect((screen.getByTestId("permission-add-tool") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("permission-add-pattern") as HTMLInputElement).value).toBe("");
  });

  it("切换单条规则的 action 触发 onRuleToggle(rule, nextAction)", async () => {
    const rule = makeRule({ action: "allow", tool: "bash", pattern: "git *" });
    const onRuleToggle = vi.fn(async () => undefined);
    render(
      <PermissionPanel
        rules={[rule]}
        mode="default"
        onRuleToggle={onRuleToggle}
      />,
    );
    fireEvent.change(screen.getByTestId("permission-rule-action-0"), {
      target: { value: "deny" },
    });
    await waitFor(() => expect(onRuleToggle).toHaveBeenCalledTimes(1));
    expect(onRuleToggle).toHaveBeenCalledWith(rule, "deny");
  });

  it("删除规则触发 onRuleDelete", async () => {
    const rule = makeRule({ tool: "write", action: "deny" });
    const onRuleDelete = vi.fn(async () => undefined);
    render(
      <PermissionPanel
        rules={[rule]}
        mode="default"
        onRuleDelete={onRuleDelete}
      />,
    );
    fireEvent.click(screen.getByTestId("permission-rule-delete-0"));
    await waitFor(() => expect(onRuleDelete).toHaveBeenCalledTimes(1));
    expect(onRuleDelete).toHaveBeenCalledWith(rule);
  });
});

describe("PermissionPanel — mode 选择", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("mode select 显示 5 个选项且当前值被选中", () => {
    render(
      <PermissionPanel
        rules={[]}
        mode="acceptEdits"
        onModeChange={vi.fn(async () => undefined)}
      />,
    );
    const select = screen.getByTestId("permission-mode-select") as HTMLSelectElement;
    expect(select.value).toBe("acceptEdits");
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual([
      "default",
      "acceptEdits",
      "dontAsk",
      "plan",
      "bypassPermissions",
    ]);
  });

  it("切换 mode 触发 onModeChange(nextMode)", async () => {
    const onModeChange = vi.fn(async () => undefined);
    render(
      <PermissionPanel
        rules={[]}
        mode="default"
        onModeChange={onModeChange}
      />,
    );
    fireEvent.change(screen.getByTestId("permission-mode-select"), {
      target: { value: "plan" },
    });
    await waitFor(() => expect(onModeChange).toHaveBeenCalledTimes(1));
    expect(onModeChange).toHaveBeenCalledWith("plan" satisfies PermissionMode);
  });

  it("无 onModeChange 时 mode select 被 disabled", () => {
    render(<PermissionPanel rules={[]} mode="default" />);
    expect(screen.getByTestId("permission-mode-select")).toBeDisabled();
  });
});

describe("PermissionPanel — 只读模式(无 callback)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("无 onRuleAdd 时不渲染新增表单", () => {
    render(<PermissionPanel rules={[makeRule()]} mode="default" />);
    expect(screen.queryByTestId("permission-add-tool")).not.toBeInTheDocument();
    expect(screen.queryByTestId("permission-add-submit")).not.toBeInTheDocument();
  });

  it("无 onRuleToggle / onRuleDelete 时规则以只读 span 显示,无 select/button", () => {
    render(<PermissionPanel rules={[makeRule({ tool: "bash" })]} mode="default" />);
    expect(screen.queryByTestId("permission-rule-action-0")).not.toBeInTheDocument();
    expect(screen.queryByTestId("permission-rule-delete-0")).not.toBeInTheDocument();
    // 只读状态 span 至少存在
    expect(screen.getByText("bash")).toBeInTheDocument();
  });
});
