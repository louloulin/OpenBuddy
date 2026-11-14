import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ShareMenu } from "../ShareMenu";
import type { ChatMessage } from "@/stores/session-store";

// triggerDownload 在 jsdom 下会走真实 document,我们 mock 掉 share 模块的核心副作用。
vi.mock("@/lib/share", async () => {
  const actual = await vi.importActual<typeof import("@/lib/share")>("@/lib/share");
  return {
    ...actual,
    triggerDownload: vi.fn(),
  };
});

import { triggerDownload, buildMailtoUrl } from "@/lib/share";
import { copyText } from "@openbuddy/platform/clipboard";
vi.mock("@openbuddy/platform/clipboard", () => ({ copyText: vi.fn(async () => {}) }));

const messages: ChatMessage[] = [
  { id: "u1", role: "user", complete: true, parts: [{ kind: "text", text: "你好" }] },
  { id: "a1", role: "assistant", complete: true, parts: [{ kind: "text", text: "你好!" }] },
];

describe("ShareMenu", () => {
  beforeEach(() => {
    vi.mocked(triggerDownload).mockClear();
  });

  it("点击「分享」展开菜单", () => {
    render(<ShareMenu messages={messages} />);
    fireEvent.click(screen.getByRole("button", { name: "分享" }));
    expect(screen.getByText("导出 Markdown")).toBeInTheDocument();
    expect(screen.getByText("复制并用邮件分享")).toBeInTheDocument();
  });

  it("导出 Markdown 触发 triggerDownload + onDone", () => {
    const onDone = vi.fn();
    render(<ShareMenu messages={messages} title="T" onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "分享" }));
    fireEvent.click(screen.getByText("导出 Markdown"));
    expect(triggerDownload).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "T.md", mime: expect.stringContaining("text/markdown") }),
    );
    expect(onDone).toHaveBeenCalledWith(expect.stringContaining("T.md"));
  });

  it("导出 HTML / 纯文本", () => {
    render(<ShareMenu messages={messages} title="X" />);
    fireEvent.click(screen.getByRole("button", { name: "分享" }));
    fireEvent.click(screen.getByText("导出 HTML（仅对话）"));
    expect(triggerDownload).toHaveBeenCalledWith(expect.objectContaining({ filename: "X.html" }));
    fireEvent.click(screen.getByRole("button", { name: "分享" }));
    fireEvent.click(screen.getByText("导出纯文本"));
    expect(triggerDownload).toHaveBeenCalledWith(expect.objectContaining({ filename: "X.txt" }));
  });

  it("复制全文后用 openUrl(mailto:…) 打开邮件客户端", async () => {
    const openUrl = vi.fn();
    const onDone = vi.fn();
    render(<ShareMenu messages={messages} title="分享主题" openUrl={openUrl} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "分享" }));
    fireEvent.click(screen.getByText("复制并用邮件分享"));
    await waitFor(() => expect(openUrl).toHaveBeenCalledTimes(1));
    expect(copyText).toHaveBeenCalledWith(expect.stringContaining("你好"));
    expect(onDone).toHaveBeenCalledWith("已复制对话内容并打开邮件客户端");
    const url = openUrl.mock.calls[0][0] as string;
    expect(url.startsWith("mailto:?subject=")).toBe(true);
    expect(url).toContain(encodeURIComponent("分享主题"));
    // buildMailtoUrl 是纯函数,可用它交叉校验格式。
    expect(buildMailtoUrl("分享主题", "")).toContain("mailto:");
  });

  it("点击外部关闭菜单", () => {
    render(
      <div>
        <ShareMenu messages={messages} />
        <button>外部</button>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "分享" }));
    expect(screen.getByText("导出 Markdown")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText("外部"));
    expect(screen.queryByText("导出 Markdown")).toBeNull();
  });
});
