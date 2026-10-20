/**
 * CopyIconButton.test.tsx — Plan5 组件化回归测试
 *
 * 验证从 MessageItem 抽出的复制按钮:
 *   - 点击触发 onCopy 回调
 *   - 点击后短暂切换成 check icon
 *   - 1.5s 后自动恢复
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { CopyIconButton } from "../parts/CopyIconButton";

describe("CopyIconButton (Plan5 componentization)", () => {
  it("点击触发 onCopy 回调", () => {
    const onCopy = vi.fn();
    render(
      <CopyIconButton
        tooltip="复制"
        copiedTooltip="已复制"
        onCopy={onCopy}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it("点击后切换到「已复制」状态", () => {
    render(
      <CopyIconButton
        tooltip="复制"
        copiedTooltip="已复制"
        onCopy={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    expect(screen.getByLabelText("已复制")).toBeTruthy();
  });

  it("1.5s 后恢复成 idle", () => {
    vi.useFakeTimers();
    try {
      render(
        <CopyIconButton
          tooltip="复制"
          copiedTooltip="已复制"
          onCopy={() => {}}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "复制" }));
      expect(screen.getByLabelText("已复制")).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(1600);
      });
      expect(screen.getByLabelText("复制")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
