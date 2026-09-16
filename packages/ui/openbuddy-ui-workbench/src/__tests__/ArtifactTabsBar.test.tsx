/**
 * ArtifactTabsBar —— 向后兼容渲染 + 中键关闭 + 滚轮横滚 + 溢出菜单 单测。
 *
 * jsdom 提示：getBoundingClientRect 全零、scrollWidth/clientWidth 恒为 0，
 * 因此溢出相关用例显式用 defineProperty 造出「内容比条宽」的数值，再触发
 * resize 让组件重新测量；拖拽排序的真实几何行为不在本文件覆盖范围内。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ArtifactTabsBar } from "../ArtifactTabsBar";
import type { UnifiedTab } from "@/lib/ui/use-unified-tabs";

beforeEach(() => {
  // jsdom 未实现 scrollIntoView（真实 Electron 环境有）。组件用它把激活标签
  // 滚入视野，因此这里补一个空实现即可，不影响被测逻辑。
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView;
});

afterEach(() => cleanup());

/** @testing-library/dom 的 fireEvent 没有 auxClick 快捷方法，手动派发。 */
function auxClick(element: Element, button: number) {
  fireEvent(
    element,
    new MouseEvent("auxclick", { bubbles: true, cancelable: true, button }),
  );
}

function tab(id: string, label: string): UnifiedTab {
  return { id, kind: "file", label, filePath: `/repo/${label}`, viewWhenActive: "fileTree" };
}

const TABS = [tab("f:a.ts", "a.ts"), tab("f:b.ts", "b.ts"), tab("f:c.ts", "c.ts")];

/** 造出「内容宽 900 / 可视宽 300」的溢出场景。 */
function forceOverflow(node: Element | null) {
  if (!node) throw new Error("tab list not found");
  Object.defineProperty(node, "scrollWidth", { value: 900, configurable: true });
  Object.defineProperty(node, "clientWidth", { value: 300, configurable: true });
  Object.defineProperty(node, "scrollLeft", { value: 0, writable: true, configurable: true });
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

describe("ArtifactTabsBar 向后兼容", () => {
  it("tabs 为空时渲染 null", () => {
    const { container } = render(
      <ArtifactTabsBar tabs={[]} onSelect={() => {}} onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("渲染 tablist / tab 角色与 aria-selected", () => {
    render(
      <ArtifactTabsBar
        tabs={TABS}
        activeTabId="f:b.ts"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("tablist")).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
      "false",
    ]);
  });

  it("点击标签切换、点击 × 关闭（旧行为不变）", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <ArtifactTabsBar
        tabs={TABS}
        activeTabId="f:a.ts"
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /b\.ts/ }));
    expect(onSelect).toHaveBeenCalledWith("f:b.ts");
    const closes = screen.getAllByRole("button", { name: "关闭标签" });
    fireEvent.click(closes[2]);
    expect(onClose).toHaveBeenCalledWith("f:c.ts");
  });

  it("不溢出不渲染溢出菜单；overflowMenu=false 时即使溢出也不渲染", () => {
    const { container, unmount } = render(
      <ArtifactTabsBar tabs={TABS} onSelect={() => {}} onClose={() => {}} />,
    );
    forceOverflow(container.querySelector(".artifact-tabs__list"));
    expect(screen.getByRole("button", { name: "查看全部标签" })).toBeTruthy();
    unmount();

    const second = render(
      <ArtifactTabsBar
        tabs={TABS}
        onSelect={() => {}}
        onClose={() => {}}
        overflowMenu={false}
      />,
    );
    forceOverflow(second.container.querySelector(".artifact-tabs__list"));
    expect(screen.queryByRole("button", { name: "查看全部标签" })).toBeNull();
  });

  it("单标签时即使溢出也不显示溢出菜单", () => {
    const { container } = render(
      <ArtifactTabsBar tabs={[tab("f:a.ts", "a.ts")]} onSelect={() => {}} onClose={() => {}} />,
    );
    forceOverflow(container.querySelector(".artifact-tabs__list"));
    expect(screen.queryByRole("button", { name: "查看全部标签" })).toBeNull();
  });
});

describe("ArtifactTabsBar 中键关闭", () => {
  it("中键（auxclick button=1）关闭标签且不切换选中", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <ArtifactTabsBar
        tabs={TABS}
        activeTabId="f:a.ts"
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    auxClick(screen.getByRole("tab", { name: /b\.ts/ }), 1);
    expect(onClose).toHaveBeenCalledWith("f:b.ts");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("中键按下被 preventDefault（阻止 Chromium 自动滚动）", () => {
    render(<ArtifactTabsBar tabs={TABS} onSelect={() => {}} onClose={() => {}} />);
    const tabEl = screen.getByRole("tab", { name: /a\.ts/ });
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 1 });
    const notCancelled = tabEl.dispatchEvent(event);
    expect(notCancelled).toBe(false);
  });

  it("左键 auxclick 不关闭", () => {
    const onClose = vi.fn();
    render(<ArtifactTabsBar tabs={TABS} onSelect={() => {}} onClose={onClose} />);
    auxClick(screen.getByRole("tab", { name: /a\.ts/ }), 0);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ArtifactTabsBar 滚轮横滚", () => {
  it("竖向滚轮在溢出时转成横向滚动并 preventDefault", () => {
    const { container } = render(
      <ArtifactTabsBar tabs={TABS} onSelect={() => {}} onClose={() => {}} />,
    );
    const list = container.querySelector(".artifact-tabs__list") as HTMLElement;
    forceOverflow(list);
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 });
    const notCancelled = list.dispatchEvent(event);
    expect(notCancelled).toBe(false);
    expect(list.scrollLeft).toBe(120);
  });

  it("不溢出时不拦截滚轮（交还页面滚动）", () => {
    const { container } = render(
      <ArtifactTabsBar tabs={TABS} onSelect={() => {}} onClose={() => {}} />,
    );
    const list = container.querySelector(".artifact-tabs__list") as HTMLElement;
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 });
    const notCancelled = list.dispatchEvent(event);
    expect(notCancelled).toBe(true);
  });

  it("已有横向 deltaX 时优先用 deltaX", () => {
    const { container } = render(
      <ArtifactTabsBar tabs={TABS} onSelect={() => {}} onClose={() => {}} />,
    );
    const list = container.querySelector(".artifact-tabs__list") as HTMLElement;
    forceOverflow(list);
    list.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: 40, deltaY: 5 }),
    );
    expect(list.scrollLeft).toBe(40);
  });

  it("滚动到边界后不再拦截", () => {
    const { container } = render(
      <ArtifactTabsBar tabs={TABS} onSelect={() => {}} onClose={() => {}} />,
    );
    const list = container.querySelector(".artifact-tabs__list") as HTMLElement;
    forceOverflow(list);
    list.scrollLeft = 600; // maxScroll = 900 - 300
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 200 });
    const notCancelled = list.dispatchEvent(event);
    expect(notCancelled).toBe(true);
    expect(list.scrollLeft).toBe(600);
  });
});

describe("ArtifactTabsBar 溢出菜单", () => {
  function renderOverflow() {
    const onSelect = vi.fn();
    const rendered = render(
      <ArtifactTabsBar
        tabs={TABS}
        activeTabId="f:a.ts"
        onSelect={onSelect}
        onClose={() => {}}
      />,
    );
    forceOverflow(rendered.container.querySelector(".artifact-tabs__list"));
    return { ...rendered, onSelect };
  }

  it("展开菜单列出全部标签并标记当前激活项", () => {
    renderOverflow();
    const trigger = screen.getByRole("button", { name: "查看全部标签" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu", { name: "全部标签" })).toBeTruthy();
    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain("a.ts");
  });

  it("点选菜单项切换标签并关闭菜单", () => {
    const { onSelect } = renderOverflow();
    fireEvent.click(screen.getByRole("button", { name: "查看全部标签" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /c\.ts/ }));
    expect(onSelect).toHaveBeenCalledWith("f:c.ts");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Esc 关闭菜单", () => {
    renderOverflow();
    fireEvent.click(screen.getByRole("button", { name: "查看全部标签" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("点击菜单外部关闭", () => {
    renderOverflow();
    fireEvent.click(screen.getByRole("button", { name: "查看全部标签" }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("中键关闭在溢出菜单场景下依然生效", () => {
    const onClose = vi.fn();
    const rendered = render(
      <ArtifactTabsBar
        tabs={TABS}
        activeTabId="f:a.ts"
        onSelect={() => {}}
        onClose={onClose}
      />,
    );
    forceOverflow(rendered.container.querySelector(".artifact-tabs__list"));
    auxClick(screen.getByRole("tab", { name: /a\.ts/ }), 1);
    expect(onClose).toHaveBeenCalledWith("f:a.ts");
  });
});
