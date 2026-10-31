/**
 * MemoryPanel —— 面板必须真的走 memory-store:* IPC,且写后刷新(不做本地乐观更新)。
 *
 * mutation 可杀:把 reload 换成"只改本地 state"第二条用例立刻红。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryPanel } from "../MemoryPanel";

const invoke = vi.fn();
// 词表在 mock 里返回 key 本身:这里断言的是**接线**(调了哪个通道、带了什么参数),
// 翻译正确性由 verify:i18n 词表门禁负责。
vi.mock("@openbuddy/ui-locale/client", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, string>) =>
      `${key}${params ? `:${JSON.stringify(params)}` : ""}`,
  }),
}));

const ENTRY = {
  id: "memory-1",
  scope: "user" as const,
  title: "回答偏好用中文",
  body: "所有回答使用简体中文",
  tags: ["偏好"],
  createdAt: "2026-10-12T00:00:00.000Z",
  updatedAt: "2026-10-12T00:00:00.000Z",
};

describe("MemoryPanel", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue([ENTRY]);
  });

  it("列表经 memory-store:list 取数,并把 cwd 传下去(决定工作区层范围)", async () => {
    render(<MemoryPanel cwd="/tmp/ws" invoke={invoke as never} />);
    await waitFor(() => expect(screen.getByTestId(`memory-item-${ENTRY.id}`)).toBeInTheDocument());
    expect(invoke).toHaveBeenCalledWith("memory-store:list", { cwd: "/tmp/ws", query: undefined });
    expect(screen.getByText("memory.scopeBadgeUser", { selector: ".memory-panel__badge" })).toBeInTheDocument();
  });

  it("新增后重新拉取列表(写后端再刷新)", async () => {
    invoke.mockResolvedValueOnce([]).mockResolvedValue([ENTRY]);
    render(<MemoryPanel cwd="/tmp/ws" invoke={invoke as never} />);
    await waitFor(() => expect(screen.getByTestId("memory-panel-empty")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("memory.composerTitle"), { target: { value: "新记忆" } });
    fireEvent.click(screen.getByRole("button", { name: "memory.add" }));
    await waitFor(() => expect(screen.getByTestId(`memory-item-${ENTRY.id}`)).toBeInTheDocument());
    expect(invoke).toHaveBeenCalledWith("memory-store:add", { title: "新记忆", body: "新记忆", scope: "user" });
  });

  it("删除走 memory-store:delete 后刷新", async () => {
    render(<MemoryPanel cwd="/tmp/ws" invoke={invoke as never} />);
    await waitFor(() => expect(screen.getByTestId(`memory-item-${ENTRY.id}`)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(`memory.deleteAria:${JSON.stringify({ title: ENTRY.title })}`));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("memory-store:delete", { id: ENTRY.id }));
  });
});
