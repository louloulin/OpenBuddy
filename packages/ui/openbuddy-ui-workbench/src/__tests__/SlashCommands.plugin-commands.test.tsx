/**
 * SlashCommands.plugin-commands.test.tsx — Composer 的 `/` 菜单认 Plugin SDK 命令。
 *
 * 以前这个菜单只列 Pi 自带命令 + 渲染端 contribution(insertText 模板),SDK 注册的
 * 命令要靠 ⌘K 才能执行,而 `docs/EXTENSION_RECIPES.md` 的 Recipe 3 却承诺「在 Composer
 * 输入后触发执行」。这条测试锁住补全菜单里的可见性,以及「同名时 Pi 赢」的顺序。
 *
 * 用 findBy*(异步)而不是 getBy*:菜单挂载后会异步拉 Pi 的命令列表,异步查询会把这次
 * 状态更新包进 act,输出里不会再有 act 警告。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SlashCommands } from "../SlashCommands";
import type { PluginCommandPayload } from "../plugin-commands";

vi.mock("@/lib/agent/pi-client", () => ({ commandsList: () => Promise.resolve([]) }));

const baseProps = { cursor: 3, onPick: vi.fn(), anchorRect: null };
const greet: PluginCommandPayload = { id: "greet", label: "/greet — 输出问候" };

describe("SlashCommands — 插件命令", () => {
  it("输入 /gr 时列出插件命令(id 作为命令名,label 作为描述)", async () => {
    render(<SlashCommands {...baseProps} text="/gr" pluginCommands={[greet]} />);
    expect(await screen.findByText("/greet")).toBeTruthy();
    expect(screen.getByText("/greet — 输出问候")).toBeTruthy();
  });

  it("未提供 pluginCommands 时不渲染任何插件命令", async () => {
    render(<SlashCommands {...baseProps} text="/" />);
    expect(await screen.findByText("/plan")).toBeTruthy();
    expect(screen.queryByText("/greet")).toBeNull();
  });

  it("同名时 Pi 自带命令赢(插件条目被去重掉)", async () => {
    render(
      <SlashCommands {...baseProps} text="/plan" pluginCommands={[{ id: "plan", label: "插件版 /plan" }]} />,
    );
    expect(await screen.findByText("切换计划模式(让 agent 先写计划再执行)")).toBeTruthy();
    expect(screen.queryByText("插件版 /plan")).toBeNull();
  });
});
