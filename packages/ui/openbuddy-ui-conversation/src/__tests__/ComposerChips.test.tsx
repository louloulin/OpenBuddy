/**
 * ComposerChips.test.tsx — Plan5 组件化回归测试
 *
 * 验证从 Composer 抽出的三个 chip 组件:
 *   - ComposerBlocks:渲染多块内容提示
 *   - ComposerAttachmentChips:文件路径 chip + 移除回调
 *   - ComposerImageAttachmentChips:缩略图 + 移除回调
 *   - ComposerSceneTag:操作类型 chip + 移除回调
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ComposerBlocks,
  ComposerAttachmentChips,
  ComposerImageAttachmentChips,
} from "../composer/ComposerChips";
import { ComposerSceneTag } from "../composer/ComposerSceneTag";
import { blockLabel, type ContentBlock } from "@/lib/markdown/content-blocks";
import type { ImageAttachment } from "../Composer";

describe("ComposerChips (Plan5 componentization)", () => {
  describe("ComposerBlocks", () => {
    it("空数组时不渲染", () => {
      const { container } = render(<ComposerBlocks blocks={[]} />);
      expect(container.firstChild).toBeNull();
    });

    it("每个 block 渲染为 chip", () => {
      const blocks: ContentBlock[] = [
        { id: "b1", kind: "skill", name: "git" },
        { id: "b2", kind: "file", path: "/etc/hosts" },
      ];
      render(<ComposerBlocks blocks={blocks} />);
      expect(screen.getByText(blockLabel(blocks[0]))).toBeTruthy();
      expect(screen.getByText(blockLabel(blocks[1]))).toBeTruthy();
    });

    it("fullTitle 作为 title 属性", () => {
      const blocks: ContentBlock[] = [{ id: "b1", kind: "skill", name: "git" }];
      const { container } = render(
        <ComposerBlocks blocks={blocks} fullTitle="full-prompt" />,
      );
      expect(container.querySelector(".composer-blocks")?.getAttribute("title")).toBe("full-prompt");
    });
  });

  describe("ComposerAttachmentChips", () => {
    it("点击移除触发 onRemove(path)", () => {
      const onRemove = vi.fn();
      render(
        <ComposerAttachmentChips
          attachments={["/tmp/foo.txt"]}
          onRemove={onRemove}
        />,
      );
      fireEvent.click(screen.getByLabelText("移除附件"));
      expect(onRemove).toHaveBeenCalledWith("/tmp/foo.txt");
    });

    it("只显示文件名,不显示完整路径", () => {
      render(
        <ComposerAttachmentChips
          attachments={["/Users/me/projects/foo.txt"]}
          onRemove={() => {}}
        />,
      );
      expect(screen.getByText("foo.txt")).toBeTruthy();
    });
  });

  describe("ComposerImageAttachmentChips", () => {
    const sample: ImageAttachment = {
      id: "img1",
      mediaType: "image/png",
      data: "abc",
      name: "shot.png",
    };

    it("渲染缩略图 + 文件名", () => {
      const { container } = render(
        <ComposerImageAttachmentChips
          images={[sample]}
          onRemove={() => {}}
        />,
      );
      expect(container.querySelector("img")?.getAttribute("src")).toContain("data:image/png;base64,abc");
      expect(screen.getByText("shot.png")).toBeTruthy();
    });

    it("点击移除触发 onRemove(id)", () => {
      const onRemove = vi.fn();
      render(
        <ComposerImageAttachmentChips
          images={[sample]}
          onRemove={onRemove}
        />,
      );
      fireEvent.click(screen.getByLabelText("移除图片"));
      expect(onRemove).toHaveBeenCalledWith("img1");
    });

    it("外层带 role=list", () => {
      const { container } = render(
        <ComposerImageAttachmentChips images={[sample]} onRemove={() => {}} />,
      );
      expect(container.querySelector('[role="list"]')?.getAttribute("aria-label")).toBe("图片附件");
    });
  });

  describe("ComposerSceneTag", () => {
    const Heart = () => <svg data-testid="heart" />;

    it("sceneTag=null 时不渲染", () => {
      const { container } = render(<ComposerSceneTag sceneTag={null} />);
      expect(container.firstChild).toBeNull();
    });

    it("渲染 label + 移除按钮", () => {
      const onClear = vi.fn();
      render(
        <ComposerSceneTag
          sceneTag={{ label: "编程", icon: Heart as never }}
          onClear={onClear}
        />,
      );
      expect(screen.getByText("编程")).toBeTruthy();
      fireEvent.click(screen.getByLabelText("移除 编程"));
      expect(onClear).toHaveBeenCalledTimes(1);
    });
  });
});
