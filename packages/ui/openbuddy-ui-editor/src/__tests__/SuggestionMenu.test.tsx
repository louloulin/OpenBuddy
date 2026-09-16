/**
 * SuggestionMenu 渲染单测 —— 分组、高亮、空态、点击选择。
 */
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SuggestionMenu } from "../components/SuggestionMenu";
import { DEFAULT_SLASH_COMMANDS } from "../lib/slash-command";

describe("SuggestionMenu", () => {
  it("无结果时渲染空态文案", () => {
    render(
      <SuggestionMenu items={[]} query="zz" activeIndex={0} onHover={() => {}} onPick={() => {}} />,
    );
    expect(screen.getByText("没有匹配项")).toBeInTheDocument();
  });

  it("按分组渲染标题", () => {
    render(
      <SuggestionMenu
        items={DEFAULT_SLASH_COMMANDS}
        query=""
        activeIndex={0}
        onHover={() => {}}
        onPick={() => {}}
      />,
    );
    expect(screen.getByText("基础块")).toBeInTheDocument();
    expect(screen.getByText("技术块")).toBeInTheDocument();
    expect(screen.getByText("媒体")).toBeInTheDocument();
  });

  it("grouped=false 时不渲染分组标题", () => {
    render(
      <SuggestionMenu
        items={DEFAULT_SLASH_COMMANDS.slice(0, 3)}
        query=""
        activeIndex={0}
        onHover={() => {}}
        onPick={() => {}}
        grouped={false}
      />,
    );
    expect(screen.queryByText("基础块")).not.toBeInTheDocument();
  });

  it("activeIndex 对应项标记 aria-selected", () => {
    render(
      <SuggestionMenu
        items={DEFAULT_SLASH_COMMANDS.slice(0, 3)}
        query=""
        activeIndex={1}
        onHover={() => {}}
        onPick={() => {}}
      />,
    );
    const options = screen.getAllByRole("option");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
  });

  const listCommands = DEFAULT_SLASH_COMMANDS.filter((command) =>
    ["bullet", "ordered"].includes(command.id),
  );

  it("点击触发 onPick 并带上完整命令", () => {
    const onPick = vi.fn();
    render(
      <SuggestionMenu
        items={listCommands}
        query=""
        activeIndex={0}
        onHover={() => {}}
        onPick={onPick}
      />,
    );
    fireEvent.click(screen.getByText("无序列表"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "bullet" }));
  });

  it("悬停触发 onHover 并带扁平索引", () => {
    const onHover = vi.fn();
    render(
      <SuggestionMenu
        items={listCommands}
        query=""
        activeIndex={0}
        onHover={onHover}
        onPick={() => {}}
      />,
    );
    fireEvent.mouseEnter(screen.getByText("有序列表"));
    expect(onHover).toHaveBeenCalledWith(1);
  });
});
