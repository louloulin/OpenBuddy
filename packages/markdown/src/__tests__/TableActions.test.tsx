import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "@openbuddy/ui/ThemeProvider";
import { Markdown } from "../index";
import { tableToMarkdown } from "../TableActions";

const table = [
  "| 项目 | 内容 |",
  "| --- | --- |",
  "| 会议号 | 655121522 |",
].join("\n");

describe("表格块操作 (WorkBuddy 对齐)", () => {
  it("renders 添加到对话 / 放大 / 下载 above the table", () => {
    render(<ThemeProvider><Markdown config={{ onTableAction: vi.fn() }}>{table}</Markdown></ThemeProvider>);
    expect(screen.getByRole("button", { name: "添加到对话" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "放大表格" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下载表格" })).toBeInTheDocument();
  });

  it("omits 添加到对话 when the app cannot take the table back", () => {
    render(<ThemeProvider><Markdown>{table}</Markdown></ThemeProvider>);
    expect(screen.queryByRole("button", { name: "添加到对话" })).toBeNull();
  });

  it("hands the table Markdown back to the app", () => {
    const onTableAction = vi.fn();
    render(<ThemeProvider><Markdown config={{ onTableAction }}>{table}</Markdown></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "添加到对话" }));
    expect(onTableAction).toHaveBeenCalledWith("add-to-chat", expect.stringContaining("655121522"));
  });

  it("opens an overlay on 放大", () => {
    render(<ThemeProvider><Markdown>{table}</Markdown></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "放大表格" }));
    expect(screen.getByRole("dialog", { name: "放大的表格" })).toBeInTheDocument();
  });

  it("serializes a table element back to GFM", () => {
    const el = document.createElement("table");
    el.innerHTML = "<tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr>";
    expect(tableToMarkdown(el)).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |");
  });
});
