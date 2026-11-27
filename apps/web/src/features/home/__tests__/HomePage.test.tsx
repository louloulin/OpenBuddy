import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HomePage } from "../HomePage";
import { useSessionsStore } from "@/features/sessions/state/sessions-store";

const base = {
  onSend: vi.fn(),
  streaming: false,
  apiReady: true,
  onOpenSettings: vi.fn(),
  onPlaceholder: vi.fn(),
};

describe("HomePage", () => {
  beforeEach(() => {
    useSessionsStore.setState({ independent: [], workspaceSessions: {} });
  });

  it("没有任务时展示应用使用指南（WorkBuddy 式指引卡）", () => {
    render(<HomePage {...base} />);
    expect(screen.getByRole("region", { name: "最近任务" })).toBeInTheDocument();
    expect(screen.getByText("应用使用指南")).toBeInTheDocument();
    expect(screen.getByText(/了解已安装应用的场景与工具/)).toBeInTheDocument();
  });

  it("按更新时间展示最近任务，点击可打开", () => {
    useSessionsStore.setState({
      independent: [
        { sessionId: "s-old", title: "旧任务", cwd: "", updatedAt: "2026-01-01T00:00:00.000Z" } as never,
        { sessionId: "s-new", title: "新任务", cwd: "/w/openbuddy", updatedAt: "2026-11-21T12:00:00.000Z" } as never,
      ],
    });
    const onOpenSession = vi.fn();
    render(<HomePage {...base} onOpenSession={onOpenSession} />);

    const items = screen.getAllByRole("button", { name: /任务/ });
    expect(items[0]).toHaveTextContent("新任务");
    fireEvent.click(screen.getByRole("button", { name: /新任务/ }));
    expect(onOpenSession).toHaveBeenCalledWith("s-new", "/w/openbuddy");
    expect(screen.queryByText("还没有任务")).toBeNull();
  });

  it("「查看全部」打开任务搜索", () => {
    useSessionsStore.setState({
      independent: [{ sessionId: "s1", title: "任务一", cwd: "", updatedAt: "2026-11-21T12:00:00.000Z" } as never],
    });
    const onOpenSearch = vi.fn();
    render(<HomePage {...base} onOpenSearch={onOpenSearch} />);
    fireEvent.click(screen.getByRole("button", { name: "查看全部" }));
    expect(onOpenSearch).toHaveBeenCalled();
  });

  it("渲染双行大标题", () => {
    render(<HomePage {...base} />);
    expect(screen.getByText("OpenBuddy")).toBeInTheDocument();
    expect(screen.getByText("你的职场超能力")).toBeInTheDocument();
  });

  it("副标题跟随场景 tab 切换", () => {
    render(<HomePage {...base} />);
    // 默认"日常办公"。
    expect(screen.getByText("你的职场超能力")).toBeInTheDocument();
    // 切到"代码开发"。
    fireEvent.click(screen.getByRole("tab", { name: /代码开发/ }));
    expect(screen.getByText("你的开发超能力")).toBeInTheDocument();
    expect(screen.queryByText("你的职场超能力")).toBeNull();
    // 切到"设计创意"。
    fireEvent.click(screen.getByRole("tab", { name: /设计创意/ }));
    expect(screen.getByText("你的设计超能力")).toBeInTheDocument();
  });

  it("场景标签可切换激活态并更换能力 chip 列表", () => {
    render(<HomePage {...base} />);
    // 默认"日常办公":应能看到能力 chip"文档处理"。
    expect(screen.getByRole("button", { name: "文档处理" })).toBeInTheDocument();
    const dev = screen.getByRole("tab", { name: /代码开发/ });
    fireEvent.click(dev);
    expect(dev.className).toContain("--active");
    expect(screen.getByRole("tab", { name: /日常办公/ }).className).not.toContain("--active");
    // 切到"代码开发"后,chip 列表换成 coding 的能力。
    expect(screen.getByRole("button", { name: "日常开发" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "文档处理" })).toBeNull();
  });

  it("点击能力 chip 插入操作类型标签并把该行替换为模板行", () => {
    render(<HomePage {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "文档处理" }));
    // 输入框出现黑色"操作类型"标签。
    expect(screen.getByRole("group", { name: /操作类型 文档处理/ })).toBeInTheDocument();
    // 能力行被模板行替换:出现模板 chip。
    expect(screen.getByRole("button", { name: "财报分析全流程" })).toBeInTheDocument();
    // 其他能力 chip 被隐藏。
    expect(screen.queryByRole("button", { name: "金融服务" })).toBeNull();
  });

  it("点击模板把 prompt 填入输入框并保留操作类型标签", () => {
    render(<HomePage {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "文档处理" }));
    fireEvent.click(screen.getByRole("button", { name: "财报分析全流程" }));
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(input.value).toContain("财报分析");
    // 标签仍然保留。
    expect(screen.getByRole("group", { name: /操作类型 文档处理/ })).toBeInTheDocument();
  });

  it("切换场景 tab 会清空操作类型标签与选中态", () => {
    render(<HomePage {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "文档处理" }));
    expect(screen.getByRole("group", { name: /操作类型 文档处理/ })).toBeInTheDocument();
    // 选中分类后能力行被隐藏,无法再点同一 chip;切换 tab 来取消。
    fireEvent.click(screen.getByRole("tab", { name: /代码开发/ }));
    expect(screen.queryByRole("group", { name: /操作类型 文档处理/ })).toBeNull();
    expect(screen.getByRole("button", { name: "日常开发" })).toBeInTheDocument();
  });

  it("未展开时折叠为前 3 个 + 更多,点击更多展开全部", () => {
    render(<HomePage {...base} />);
    // 折叠态:第 4 个分类"深度研究"不可见,但"更多"可见。
    expect(screen.queryByRole("button", { name: "深度研究" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    // 展开后可见全部分类,且不再有"更多"按钮。
    expect(screen.getByRole("button", { name: "深度研究" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "更多" })).toBeNull();
  });

  it("未配置模型时显示可关闭的引导，并保留草稿入口", () => {
    render(<HomePage {...base} apiReady={false} />);
    expect(screen.getByRole("region", { name: "快速开始" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "配置模型" }));
    expect(base.onOpenSettings).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "暂不配置" }));
    expect(screen.queryByRole("region", { name: "快速开始" })).toBeNull();
    expect(screen.getByRole("tab", { name: "日常办公" })).toBeInTheDocument();
  });

  it("模型已就绪时不显示首次引导", () => {
    render(<HomePage {...base} apiReady={true} />);
    expect(screen.queryByRole("region", { name: "快速开始" })).toBeNull();
  });

  it("输入框标签的 × 移除标签并回到能力行", () => {
    render(<HomePage {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "文档处理" }));
    fireEvent.click(screen.getByRole("button", { name: /移除 文档处理/ }));
    expect(screen.queryByRole("group", { name: /操作类型 文档处理/ })).toBeNull();
    expect(screen.getByRole("button", { name: "金融服务" })).toBeInTheDocument();
  });
});
