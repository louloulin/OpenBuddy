import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { keyLabel, matchShortcut, SHORTCUTS } from "@/lib/shortcuts";
import { SearchPalette, ShortcutList } from "../ShortcutsPanel";

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

it("matches only the exact combination (U8.2)", () => {
  expect(matchShortcut(key("k", { ctrlKey: true }), "search")).toBe(true);
  expect(matchShortcut(key("k", { metaKey: true }), "search")).toBe(true);
  expect(matchShortcut(key("k"), "search")).toBe(false);
  expect(matchShortcut(key("k", { ctrlKey: true, shiftKey: true }), "search")).toBe(false);
  expect(matchShortcut(key("C", { ctrlKey: true, shiftKey: true }), "copyLast")).toBe(true);
  expect(matchShortcut(key("\\", { metaKey: true }), "togglePanel")).toBe(true);
  expect(matchShortcut(key("Escape"), "stop")).toBe(true);
  expect(keyLabel("Mod", true)).toBe("⌘");
  expect(keyLabel("Mod", false)).toBe("Ctrl");
});

it("lists every registered shortcut, grouped by scope", () => {
  render(<ShortcutList />);
  for (const s of SHORTCUTS) expect(screen.getByText(s.label)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "全局" })).toBeInTheDocument();
  expect(screen.queryByText(/引用对话文件/)).not.toBeInTheDocument(); // not built yet → not listed
});

it("Ctrl/Cmd+K finds a task by title and opens it with Enter", () => {
  const onOpen = vi.fn(), onClose = vi.fn();
  const sessions = [
    { sessionId: "a", title: "季度销售报告", cwd: "/w", updatedAt: "2026-11-13T10:00:00Z" },
    { sessionId: "b", title: "修复登录 bug", cwd: "/w", updatedAt: "2026-11-14T10:00:00Z" },
    { sessionId: "c", title: "旧的", cwd: "/w", archived: true },
  ];
  render(<SearchPalette sessions={sessions} onOpen={onOpen} onNewTask={vi.fn()} onClose={onClose} />);
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([expect.stringContaining("新建任务"), expect.stringContaining("修复登录 bug"), expect.stringContaining("季度销售报告")]);
  const input = screen.getByPlaceholderText("搜索任务标题…");
  fireEvent.change(input, { target: { value: "报告" } });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onOpen).toHaveBeenCalledWith(sessions[0]);
  expect(onClose).toHaveBeenCalled();
});
