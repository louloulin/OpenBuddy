/**
 * 20261031 Phase 1.8 — 错误卡"切换模型"通过窗口事件打开模型菜单;
 * 多个选择器同时挂载时只有第一个响应。
 */
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ModelSelector, openModelSelector } from "../ModelSelector";

vi.mock("@openbuddy/ui-locale/client", () => ({
  useLocale: () => ({ t: (key: string) => key, current: () => "zh-CN", subscribe: () => () => {} }),
  useT: (key: string) => key,
}));

const MODELS = [{ id: "p/a", label: "model-a" }];

describe("openModelSelector", () => {
  it("无选择器挂载时返回 false", () => {
    expect(openModelSelector()).toBe(false);
  });

  it("只打开第一个挂载的选择器,焦点进入菜单", () => {
    render(
      <>
        <ModelSelector models={MODELS} modelId="p/a" onModelChange={() => {}} />
        <ModelSelector models={MODELS} modelId="p/a" onModelChange={() => {}} />
      </>,
    );
    let handled = false;
    act(() => {
      handled = openModelSelector();
    });
    expect(handled).toBe(true);
    const triggers = screen.getAllByRole("button", { expanded: true });
    expect(triggers).toHaveLength(1);
    // 菜单打开后焦点落在列表上(与点击触发器一致),键盘可直接上下选择。
    expect(screen.getByRole("listbox").contains(document.activeElement) || document.activeElement === screen.getByRole("listbox")).toBe(true);
  });
});
