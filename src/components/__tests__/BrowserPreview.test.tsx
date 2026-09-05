import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BrowserPreview } from "@openbuddy/ui-workbench";

describe("BrowserPreview", () => {
  it("空 URL 显示输入提示", () => {
    render(<BrowserPreview url="" />);
    expect(screen.getByText("输入一个 https 网址以预览。")).toBeInTheDocument();
  });

  it("不可预览 URL 显示拒绝提示", () => {
    render(<BrowserPreview url="localhost" />);
    expect(screen.getByText(/不可预览/)).toBeInTheDocument();
  });

  it("合法 URL 渲染 <iframe>(带 sandbox)", () => {
    render(<BrowserPreview url="https://example.com" />);
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    expect(iframe.getAttribute("src")).toContain("example.com");
    expect(iframe.getAttribute("sandbox")).toContain("allow-scripts");
  });

  it("Enter 触发 onUrlChange(规整后)", () => {
    const onUrlChange = vi.fn();
    render(<BrowserPreview url="" onUrlChange={onUrlChange} />);
    const input = screen.getByRole("textbox", { name: "预览网址" });
    fireEvent.change(input, { target: { value: "example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onUrlChange).toHaveBeenCalledWith("https://example.com/");
  });

  it("预览按钮 disabled 当 URL 无效", () => {
    render(<BrowserPreview url="localhost" />);
    expect(screen.getByRole("button", { name: "预览" })).toBeDisabled();
  });

  it("iframe title 用 hostname", () => {
    render(<BrowserPreview url="https://docs.example.com/x" />);
    expect(document.querySelector("iframe")?.title).toBe("docs.example.com");
  });
});
