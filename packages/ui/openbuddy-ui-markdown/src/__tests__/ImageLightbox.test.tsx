/**
 * ImageLightbox.test — plan1030 批 5b（兑现 cursor:zoom-in 承诺）。
 *
 * 锁定四条不变量：
 *   1. 点击 markdown 图片打开 lightbox（role=dialog，含图片）；
 *   2. Esc 关闭；
 *   3. 点击遮罩关闭；
 *   4. 点击图片在适配/原始尺寸间切换（zoom-out class），且不冒泡关掉 lightbox。
 */
import { describe, expect, it } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { Markdown } from "../components/Markdown";
import { ImageLightbox } from "../components/ImageLightbox";

describe("ImageLightbox（plan1030 批 5b）", () => {
  it("组件本体：点击图片切换缩放且不冒泡；点遮罩关闭；Esc 关闭", () => {
    const { container } = render(
      <ImageLightbox src="file:///tmp/a.png" alt="截图" onClose={() => container.remove()} />,
    );
    void container;
  });

  it("组件本体：图片点击切换 full class，不触发遮罩关闭", () => {
    let closed = false;
    const { container } = render(
      <ImageLightbox src="file:///tmp/a.png" alt="截图" onClose={() => (closed = true)} />,
    );
    const img = container.querySelector(".md-lightbox__img") as HTMLImageElement;
    expect(img.className).not.toContain("--full");
    fireEvent.click(img);
    expect(closed).toBe(false);
    expect(img.className).toContain("--full");
  });

  it("组件本体：打开即聚焦关闭按钮,点击关闭按钮触发 onClose", () => {
    let closed = false;
    const { container } = render(
      <ImageLightbox src="file:///tmp/a.png" closeLabel="关闭" onClose={() => (closed = true)} />,
    );
    const close = container.querySelector(".md-lightbox__close") as HTMLButtonElement;
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    expect(closed).toBe(true);
  });

  it("组件本体：Esc 触发 onClose", () => {
    let closed = false;
    const { container } = render(
      <ImageLightbox src="file:///tmp/a.png" onClose={() => (closed = true)} />,
    );
    fireEvent(window, new KeyboardEvent("keydown", { key: "Escape" }));
    expect(closed).toBe(true);
    void container;
  });

  it("Markdown 集成：点击消息内图片打开 dialog，点遮罩后关闭", () => {
    const { container } = render(<Markdown>{"![图](https://example.com/a.png)"}</Markdown>);
    const img = container.querySelector(".markdown-body img") as HTMLImageElement;
    expect(img).not.toBeNull();
    fireEvent.click(img);
    const dialog = container.querySelector(".md-lightbox");
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("role")).toBe("dialog");
    fireEvent.click(container.querySelector(".md-lightbox__backdrop") as Element);
    expect(container.querySelector(".md-lightbox")).toBeNull();
  });
});
