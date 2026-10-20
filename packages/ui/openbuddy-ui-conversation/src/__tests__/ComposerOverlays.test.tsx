/**
 * ComposerOverlays.test.tsx — Plan5 组件化回归测试
 *
 * 验证从 Composer 抽出的两个 overlay 部件:
 *   - ComposerSetupHint:apiReady=false 时渲染,点击触发 onOpenSettings
 *   - ComposerDropzone:dragActive=true 时渲染提示文字
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ComposerSetupHint,
  ComposerDropzone,
} from "../composer/ComposerOverlays";

describe("ComposerOverlays (Plan5 componentization)", () => {
  describe("ComposerSetupHint", () => {
    it("visible=false 不渲染", () => {
      const { container } = render(
        <ComposerSetupHint visible={false} onOpenSettings={() => {}} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("visible=true 渲染 sr-only 文案", () => {
      render(<ComposerSetupHint visible onOpenSettings={() => {}} />);
      expect(screen.getByText(/请先配置 API Key/)).toBeTruthy();
    });

    it("点击触发 onOpenSettings", () => {
      const cb = vi.fn();
      render(<ComposerSetupHint visible onOpenSettings={cb} />);
      fireEvent.click(screen.getByRole("button"));
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("Enter / Space 触发 onOpenSettings", () => {
      const cb = vi.fn();
      render(<ComposerSetupHint visible onOpenSettings={cb} />);
      const btn = screen.getByRole("button");
      fireEvent.keyDown(btn, { key: "Enter" });
      fireEvent.keyDown(btn, { key: " " });
      expect(cb).toHaveBeenCalledTimes(2);
    });
  });

  describe("ComposerDropzone", () => {
    it("visible=false 不渲染", () => {
      const { container } = render(<ComposerDropzone visible={false} />);
      expect(container.firstChild).toBeNull();
    });

    it("visible=true 渲染拖拽提示", () => {
      render(<ComposerDropzone visible />);
      expect(screen.getByText(/松开以添加文件/)).toBeTruthy();
      expect(screen.getByRole("status")).toBeTruthy();
    });
  });
});
