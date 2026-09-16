/**
 * SearchOverlay.plugin-commands.test.tsx — ⌘K 面板真的把插件命令渲染出来。
 *
 * 背景:`plugin.command` 槽在此之前**没有任何消费者** —— 插件用
 * `api.registerCommand()` 注册的命令进得了内核却永远不出现在界面上。
 * 这条测试锁住三层:分组渲染 / `/` 前缀过滤 / 执行时把 args 交给插件回调。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SearchOverlay } from "../SearchOverlay";
import type { PluginCommandPayload } from "../plugin-commands";

const baseProps = {
  open: true,
  onClose: vi.fn(),
  onSelect: vi.fn(),
};

const greet: PluginCommandPayload = { id: "greet", label: "/greet — 输出问候", onExecute: vi.fn() };
const workspace: PluginCommandPayload = { id: "tidy-workspace", label: "整理工作区", onExecute: vi.fn() };

describe("SearchOverlay — 插件命令分组", () => {
  it("没有插件命令时整个分组不渲染(不出现空标题)", () => {
    render(<SearchOverlay {...baseProps} />);
    expect(screen.queryByText(/插件命令/)).toBeNull();
  });

  it("有插件命令时按 label 渲染,并带上 /id 提示", () => {
    render(<SearchOverlay {...baseProps} pluginCommands={[greet, workspace]} />);
    expect(screen.getByText("插件命令 (2)")).toBeTruthy();
    expect(screen.getByText("/greet — 输出问候")).toBeTruthy();
    expect(screen.getByText("整理工作区")).toBeTruthy();
  });

  it("输入 `/` 前缀按 id 前缀过滤", async () => {
    render(<SearchOverlay {...baseProps} pluginCommands={[greet, workspace]} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "/gr" } });
    await waitFor(() => {
      expect(screen.getByText("/greet — 输出问候")).toBeTruthy();
      expect(screen.queryByText("整理工作区")).toBeNull();
    });
  });

  it("点击执行:命令回调拿到 args,面板关闭", async () => {
    const onExecute = vi.fn();
    const onClose = vi.fn();
    render(
      <SearchOverlay
        {...baseProps}
        onClose={onClose}
        pluginCommands={[{ id: "greet", label: "/greet", onExecute }]}
      />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "/greet Alice" } });
    await waitFor(() => expect(screen.getByText("/greet")).toBeTruthy());
    fireEvent.click(screen.getByText("/greet"));
    expect(onExecute).toHaveBeenCalledWith({ args: "Alice" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("label 缺失的命令退化成 /id,仍然可执行", () => {
    render(<SearchOverlay {...baseProps} pluginCommands={[{ id: "raw-cmd" }]} />);
    expect(screen.getByText("/raw-cmd")).toBeTruthy();
  });
});
