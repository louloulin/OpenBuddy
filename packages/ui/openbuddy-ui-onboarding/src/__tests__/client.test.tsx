import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_ONBOARDING_STEPS, apply } from "../client";

type Registered = {
  name: string;
  kind?: string;
  scope?: string;
  registrant?: string;
  component: unknown;
};

function stubContext() {
  const registered: Registered[] = [];
  const disposers: Array<ReturnType<typeof vi.fn>> = [];
  const ctx = {
    slots: {
      register(options: Record<string, unknown>, component: unknown) {
        registered.push({
          name: String(options.name),
          kind: options.kind as string,
          scope: options.scope as string,
          registrant: options.registrant as string,
          component,
        });
        const dispose = vi.fn();
        disposers.push(dispose);
        return dispose;
      },
    },
    events: { on: () => () => {} },
  };
  return { ctx, registered, disposers };
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => cleanup());

describe("@openbuddy/ui-onboarding/client apply()", () => {
  it("注册 5 个 onboarding.* 槽位并返回复合 dispose", () => {
    const { ctx, registered, disposers } = stubContext();
    const dispose = apply(ctx as never);

    expect(registered.map((entry) => entry.name)).toEqual([
      "onboarding.wizard",
      "onboarding.tour",
      "onboarding.data-dir",
      "onboarding.feedback",
      "onboarding.whats-new",
    ]);
    expect(registered.map((entry) => entry.kind)).toEqual([
      "single",
      "single",
      "single",
      "single",
      "single",
    ]);
    expect(registered.map((entry) => entry.scope)).toEqual([
      "root",
      "root",
      "session-maybe",
      "root",
      "root",
    ]);
    expect(registered.every((entry) => entry.registrant === "@openbuddy/ui-onboarding")).toBe(true);
    expect(registered.every((entry) => typeof entry.component === "function")).toBe(true);

    dispose();
    expect(disposers).toHaveLength(5);
    for (const disposeSlot of disposers) expect(disposeSlot).toHaveBeenCalledTimes(1);
  });

  it("单个槽位卸载抛错不影响其余槽位的清理", () => {
    const { ctx, disposers } = stubContext();
    const dispose = apply(ctx as never);
    disposers[0].mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() => dispose()).not.toThrow();
    for (const disposeSlot of disposers) expect(disposeSlot).toHaveBeenCalled();
  });

  it("默认向导步骤只包含 welcome → first-task → done（主题/模型/数据目录放进设置）", () => {
    expect(DEFAULT_ONBOARDING_STEPS.map((step) => step.id)).toEqual([
      "welcome",
      "first-task",
      "done",
    ]);
  });

  it("wizard / tour surface 零配置即可渲染", () => {
    const { ctx, registered } = stubContext();
    apply(ctx as never);

    const Wizard = registered[0].component as import("react").ComponentType<Record<string, never>>;
    const { unmount } = render(createElement(Wizard));
    expect(screen.getByTestId("onboarding-title").textContent).toBe("欢迎来到 OpenBuddy");
    unmount();

    const Tour = registered[1].component as import("react").ComponentType<Record<string, never>>;

    // 向导还没走完 → 漫游不抢焦点（首屏禁止两层引导浮层叠加）。
    render(createElement(Tour));
    expect(screen.queryByTestId("tour-modal")).toBeNull();
    cleanup();

    // 向导落盘结束后（status=done）→ R10.4：已"看过"的回访用户不再被
    // 暗幕拦截,TourSurface 在挂载时就把 openbuddy.tour.state 写为 "seen",
    // 所以 useTourController 的 shouldAutoOpenTour() 返回 false,tour-modal
    // 不渲染。漫游仍能通过设置里的"重新观看引导"入口或显式调用
    // tour.start() 主动打开(那条路径不读 shouldAutoOpenTour)。
    window.localStorage.setItem(
      "openbuddy.onboarding.state",
      JSON.stringify({ version: 1, status: "done", index: 0, steps: [] }),
    );
    render(createElement(Tour));
    expect(screen.queryByTestId("tour-modal")).toBeNull();
    expect(window.localStorage.getItem("openbuddy.tour.state")).toBe("seen");
    cleanup();
    window.localStorage.clear();
  });

  it("依赖宿主回调的 surface 在没有回调时渲染 null", () => {
    const { ctx, registered } = stubContext();
    apply(ctx as never);
    for (const index of [2, 3, 4]) {
      const Surface = registered[index].component as import("react").ComponentType<
        Record<string, never>
      >;
      const { unmount } = render(createElement(Surface));
      expect(screen.queryByTestId("data-dir-prompt")).toBeNull();
      expect(screen.queryByTestId("feedback-popup")).toBeNull();
      expect(screen.queryByTestId("whats-new-card")).toBeNull();
      unmount();
    }
  });

  it("宿主给了回调后 surface 正常渲染", () => {
    const { ctx, registered } = stubContext();
    apply(ctx as never);

    const DataDir = registered[2].component as import("react").ComponentType<
      Record<string, unknown>
    >;
    const first = render(createElement(DataDir, { onSubmit: () => {} }));
    expect(screen.getByTestId("data-dir-prompt")).toBeTruthy();
    first.unmount();

    const Feedback = registered[3].component as import("react").ComponentType<
      Record<string, unknown>
    >;
    const second = render(createElement(Feedback, { onSubmit: () => {} }));
    expect(screen.getByTestId("feedback-popup")).toBeTruthy();
    second.unmount();

    const WhatsNew = registered[4].component as import("react").ComponentType<
      Record<string, unknown>
    >;
    render(createElement(WhatsNew, { version: "0.15.0", items: [], onDismiss: () => {} }));
    expect(screen.getByTestId("whats-new-card")).toBeTruthy();
  });
});
