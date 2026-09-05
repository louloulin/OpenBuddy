import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ModalIcon } from "@openbuddy/ui-dialogs";

describe("ModalIcon", () => {
  it("info tone 渲染圆形图标", () => {
    const { container } = render(<ModalIcon tone="info" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    // info tone 应该使用 circle 路径 (question mark in circle)
    const html = container.innerHTML;
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain("circle");
  });

  it("danger tone 渲染三角形警告图标", () => {
    const { container } = render(<ModalIcon tone="danger" />);
    const html = container.innerHTML;
    // 三角路径
    expect(html).toMatch(/M12 3 L22 20 L2 20 Z/);
  });

  it("warning tone 渲染三角形警告图标", () => {
    const { container } = render(<ModalIcon tone="warning" />);
    const html = container.innerHTML;
    expect(html).toMatch(/M12 3 L22 20 L2 20 Z/);
  });

  it("info 和 danger/warning 是不同的图标", () => {
    const { container: infoContainer } = render(<ModalIcon tone="info" />);
    const { container: dangerContainer } = render(<ModalIcon tone="danger" />);
    expect(infoContainer.innerHTML).not.toBe(dangerContainer.innerHTML);
  });

  it("使用 currentColor 让父元素控制颜色", () => {
    const { container } = render(<ModalIcon tone="info" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("stroke", "currentColor");
  });

  it("尺寸可配置", () => {
    const { container } = render(<ModalIcon tone="info" size={32} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "32");
    expect(svg).toHaveAttribute("height", "32");
  });

  it("aria-hidden=true 让屏幕阅读器忽略", () => {
    const { container } = render(<ModalIcon tone="danger" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});
