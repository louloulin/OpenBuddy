import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock desktop dialog + electron-kb-reader，使「添加本地文件夹」可在 vitest 下测试。
const openDialog = vi.fn();
vi.mock("@/lib/platform/electron-api", () => ({ open: (...a: unknown[]) => openDialog(...a), invoke: vi.fn() }));
vi.mock("@/lib/files/electron-kb-reader", () => ({
  isElectronAvailable: () => true,
  createElectronDirectoryReader: () => ({
    listDir: async () => [],
    readText: async () => null,
  }),
}));

import { KnowledgeBasePanel } from "@openbuddy/ui-files";
import { registerKbProvider, resetKbRegistry, listKbProviders, unregisterKbProvider } from "@openbuddy/files-kb";

describe("KnowledgeBasePanel", () => {
  beforeEach(resetKbRegistry);

  it("无 provider 显示未配置", () => {
    render(<KnowledgeBasePanel />);
    expect(screen.getByText("未配置知识源")).toBeInTheDocument();
  });

  it("有 provider 显示源数与名称", async () => {
    registerKbProvider({
      id: "local",
      label: "本地文件夹",
      isEnabled: () => true,
      list: () => [{ id: "1", title: "笔记" }],
    });
    render(<KnowledgeBasePanel />);
    // 源摘要「1 个源」(异步加载)。
    await waitFor(() => expect(screen.getByText(/1 个源/)).toBeInTheDocument());
    // 添加按钮存在。
    expect(screen.getByRole("button", { name: /添加本地文件夹/ })).toBeInTheDocument();
  });

  it("搜索命中显示结果(source + title)", async () => {
    registerKbProvider({
      id: "docs",
      label: "文档库",
      isEnabled: () => true,
      list: (q) =>
        q
          ? [{ id: "1", title: "React 指南", snippet: " Hooks" }].filter((e) =>
              e.title.includes(q),
            )
          : [{ id: "1", title: "React 指南" }],
    });
    render(<KnowledgeBasePanel />);
    fireEvent.change(screen.getByRole("textbox", { name: "搜索知识库" }), {
      target: { value: "React" },
    });
    await waitFor(() => expect(screen.getByText("React 指南")).toBeInTheDocument());
    expect(screen.getByText("docs")).toBeInTheDocument();
  });

  it("搜索无匹配显示空态", async () => {
    registerKbProvider({
      id: "docs",
      label: "文档库",
      isEnabled: () => true,
      list: () => [],
    });
    render(<KnowledgeBasePanel />);
    fireEvent.change(screen.getByRole("textbox", { name: "搜索知识库" }), {
      target: { value: "不存在" },
    });
    await waitFor(() => expect(screen.getByText("无匹配结果")).toBeInTheDocument());
  });

  it("点击结果回调 onOpen", async () => {
    const onOpen = vi.fn();
    registerKbProvider({
      id: "docs",
      label: "文档库",
      isEnabled: () => true,
      list: () => [{ id: "9", title: "T", url: "https://x/9" }],
    });
    render(<KnowledgeBasePanel onOpen={onOpen} />);
    fireEvent.change(screen.getByRole("textbox", { name: "搜索知识库" }), {
      target: { value: "T" },
    });
    await waitFor(() => expect(screen.getByText("T")).toBeInTheDocument());
    fireEvent.click(screen.getByText("T"));
    expect(onOpen).toHaveBeenCalledWith("9", "https://x/9");
  });

  it("「添加本地文件夹」弹出目录选择并注册 local provider", async () => {
    openDialog.mockResolvedValue("/my/notes");
    const before = listKbProviders().length;
    render(<KnowledgeBasePanel onToast={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /添加本地文件夹/ }));
    await waitFor(() => expect(listKbProviders().length).toBe(before + 1));
    expect(listKbProviders().some((s) => s.id === "local")).toBe(true);
    expect(openDialog).toHaveBeenCalledWith({ directory: true, multiple: false });
  });

  it("取消选择(返回 null)不注册 provider", async () => {
    openDialog.mockResolvedValue(null);
    const before = listKbProviders().length;
    render(<KnowledgeBasePanel onToast={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /添加本地文件夹/ }));
    await waitFor(() => expect(openDialog).toHaveBeenCalled());
    expect(listKbProviders().length).toBe(before);
  });

  it("「移除知识源」按钮注销已注册 provider", async () => {
    registerKbProvider({
      id: "local",
      label: "本地文件夹",
      isEnabled: () => true,
      list: () => [],
    });
    render(<KnowledgeBasePanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("本地文件夹")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "移除知识源 本地文件夹" }));
    expect(listKbProviders().some((s) => s.id === "local")).toBe(false);
    // 直接确认 registry 也已移除。
    expect(unregisterKbProvider("local")).toBe(false); // 已移除 → 再移除返回 false
  });

  it("「刷新索引」按钮调用 provider.rebuild 并 toast 条目数", async () => {
    const rebuild = vi.fn(async () => 5);
    registerKbProvider({
      id: "local",
      label: "本地文件夹",
      isEnabled: () => true,
      list: () => [],
      rebuild,
    });
    const onToast = vi.fn();
    render(<KnowledgeBasePanel onToast={onToast} />);
    const refreshBtn = await screen.findByRole("button", { name: /刷新索引/ });
    fireEvent.click(refreshBtn);
    await waitFor(() => expect(rebuild).toHaveBeenCalledTimes(1));
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining("5 项"));
  });

  it("无知识源时不显示「刷新索引」按钮", () => {
    render(<KnowledgeBasePanel onToast={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /刷新索引/ })).toBeNull();
  });

  it("索引状态指示:显示已索引文件数 + 最近更新时间", async () => {
    registerKbProvider({
      id: "local",
      label: "本地文件夹",
      isEnabled: () => true,
      list: () => [],
      getStats: async () => ({ fileCount: 12, lastRebuiltAt: Date.now() - 60000 }),
    });
    render(<KnowledgeBasePanel onToast={vi.fn()} />);
    // 已索引 12 个文件。
    await waitFor(() => expect(screen.getByText(/已索引 12 个文件/)).toBeInTheDocument());
    // 最近更新(相对时间,1 分钟前)。
    expect(screen.getByText(/分钟前/)).toBeInTheDocument();
  });

  it("索引状态:无 fileCount 时不显示数字,无 lastRebuiltAt 时不显示时间", async () => {
    registerKbProvider({
      id: "local",
      label: "本地文件夹",
      isEnabled: () => true,
      list: () => [],
      getStats: async () => ({}),
    });
    render(<KnowledgeBasePanel onToast={vi.fn()} />);
    // fileCount 未定义 → 显示 0(求和默认)。
    await waitFor(() => expect(screen.getByText(/已索引 0 个文件/)).toBeInTheDocument());
    // 无时间。
    expect(screen.queryByText(/分钟前|小时前|刚刚|天前/)).toBeNull();
  });
});
