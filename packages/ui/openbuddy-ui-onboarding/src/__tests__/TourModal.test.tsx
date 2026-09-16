import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TOUR_STORAGE_KEY,
  computeCardPosition,
  findAvailableTourIndex,
  probeTourStep,
  shouldAutoOpenTour,
  toTourRect,
  type TourRect,
  type TourStep,
  type TourStorageLike,
} from "../tour/tour-steps";
import { TourModal, useTourController } from "../tour/TourModal";

afterEach(() => {
  cleanup();
  document.querySelectorAll("[data-tour]").forEach((node) => node.remove());
});

function memoryStorage(seed?: Record<string, string>): TourStorageLike & {
  dump(): Record<string, string>;
} {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    dump: () => Object.fromEntries(map.entries()),
  };
}

/** jsdom 没有布局,给锚点手动挂一个可预测的 rect。 */
function mountTarget(
  id: string,
  rect = { top: 100, left: 200, width: 240, height: 40 },
): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("data-tour", id);
  element.getBoundingClientRect = () =>
    ({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(element);
  return element;
}

const STEPS: TourStep[] = [
  { id: "a", title: "步骤 A", body: "先看这里", target: "alpha", placement: "bottom" },
  { id: "b", title: "步骤 B", target: "beta", placement: "top" },
];

describe("@openbuddy/ui-onboarding/tour-steps(纯函数)", () => {
  it("probeTourStep 把 data-tour 锚点换算成外扩后的 rect", () => {
    mountTarget("alpha", { top: 50, left: 60, width: 100, height: 20 });
    const probe = probeTourStep({ id: "a", title: "A", target: "alpha", padding: 6 });
    expect(probe.found).toBe(true);
    expect(probe.rect).toEqual({
      top: 44,
      left: 54,
      width: 112,
      height: 32,
      right: 166,
      bottom: 76,
    });
  });

  it("probeTourStep 支持 CSS 选择器与缺失目标", () => {
    const element = document.createElement("div");
    element.id = "anchor-id";
    element.getBoundingClientRect = () =>
      toTourRect({ top: 1, left: 2, width: 3, height: 4 }) as DOMRect;
    document.body.appendChild(element);
    expect(probeTourStep({ id: "s", title: "S", target: "#anchor-id" }).found).toBe(true);
    element.remove();

    expect(probeTourStep({ id: "x", title: "X", target: "nope" })).toEqual({
      found: false,
      rect: null,
    });
    // 非法选择器不抛异常
    expect(probeTourStep({ id: "y", title: "Y", target: "###" }).found).toBe(false);
    // 没有 target 的步骤永远可达(居中卡片)
    expect(probeTourStep({ id: "z", title: "Z" })).toEqual({ found: true, rect: null });
  });

  it("findAvailableTourIndex 跳过不可达步骤", () => {
    mountTarget("beta");
    expect(findAvailableTourIndex(STEPS, 0)).toBe(1);
    expect(findAvailableTourIndex(STEPS, 2)).toBe(-1);
  });

  it("computeCardPosition:优先声明的 placement,空间不足时翻到对侧", () => {
    const viewport = { width: 1200, height: 800 };
    const card = { width: 340, height: 160 };
    const rect = toTourRect({ top: 300, left: 400, width: 200, height: 60 });

    const bottom = computeCardPosition(rect, "bottom", card, viewport);
    expect(bottom.placement).toBe("bottom");
    expect(bottom.top).toBe(rect.bottom + 14);
    expect(bottom.left).toBe(rect.left + rect.width / 2 - card.width / 2);

    // 目标贴底 → bottom 放不下,翻到 top
    const pinned = toTourRect({ top: 760, left: 400, width: 200, height: 30 });
    expect(computeCardPosition(pinned, "bottom", card, viewport).placement).toBe("top");
  });

  it("computeCardPosition:无 rect 时居中且始终夹紧在视口内", () => {
    const centered = computeCardPosition(
      null,
      "bottom",
      { width: 340, height: 160 },
      { width: 1200, height: 800 },
    );
    expect(centered).toEqual({ top: 320, left: 430, placement: "center" });

    const tiny = computeCardPosition(
      null,
      "bottom",
      { width: 340, height: 160 },
      { width: 200, height: 100 },
    );
    expect(tiny.top).toBe(12);
    expect(tiny.left).toBe(12);
  });

  it("shouldAutoOpenTour 默认只在没看过时返回 true", () => {
    expect(shouldAutoOpenTour(memoryStorage())).toBe(true);
    expect(shouldAutoOpenTour(memoryStorage({ [TOUR_STORAGE_KEY]: "seen" }))).toBe(false);
    expect(shouldAutoOpenTour(null)).toBe(false);
  });
});

describe("@openbuddy/ui-onboarding/TourModal", () => {
  it("open=false 时不渲染任何东西", () => {
    render(<TourModal open={false} steps={STEPS} storage={null} />);
    expect(screen.queryByTestId("tour-modal")).toBeNull();
    expect(screen.queryByTestId("tour-spotlight")).toBeNull();
  });

  it("渲染暗幕 + 挖孔到 body,并按目标 rect 定位", () => {
    mountTarget("alpha", { top: 100, left: 200, width: 240, height: 40 });
    render(<TourModal open steps={STEPS} storage={null} />);
    expect(screen.getByTestId("tour-title").textContent).toBe("步骤 A");
    const hole = screen.getByTestId("tour-spotlight-hole");
    expect(hole.style.top).toBe("94px");
    expect(hole.style.left).toBe("194px");
    expect(hole.style.width).toBe("252px");
    expect(hole.style.height).toBe("52px");
    expect(screen.getByTestId("tour-modal").dataset.placement).toBe("bottom");
  });

  it("下一步 / 上一步在步骤间移动", () => {
    mountTarget("alpha", { top: 100, left: 200, width: 240, height: 40 });
    // 目标位置不同 → placement 跟着目标空间走(top 放得下才是 top)
    mountTarget("beta", { top: 420, left: 200, width: 240, height: 40 });
    render(<TourModal open steps={STEPS} storage={null} />);
    fireEvent.click(screen.getByTestId("tour-next"));
    expect(screen.getByTestId("tour-title").textContent).toBe("步骤 B");
    expect(screen.getByTestId("tour-modal").dataset.placement).toBe("top");
    fireEvent.click(screen.getByTestId("tour-prev"));
    expect(screen.getByTestId("tour-title").textContent).toBe("步骤 A");
  });

  it("目标缺失时自动跳到下一个可达步骤", () => {
    mountTarget("beta");
    render(<TourModal open steps={STEPS} storage={null} />);
    expect(screen.getByTestId("tour-title").textContent).toBe("步骤 B");
  });

  it("所有目标都缺失时直接结束", () => {
    const onFinish = vi.fn();
    render(<TourModal open steps={STEPS} storage={null} onFinish={onFinish} />);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("tour-modal")).toBeNull();
  });

  it("whenMissing=wait 的步骤原地等待", () => {
    const steps: TourStep[] = [
      { id: "slow", title: "等待目标", target: "missing-anchor", whenMissing: "wait" },
      { id: "next", title: "后续" },
    ];
    render(<TourModal open steps={steps} storage={null} />);
    expect(screen.getByTestId("tour-title").textContent).toBe("等待目标");
  });

  it("最后一步的按钮触发 onFinish + onClose 并写入已看标记", () => {
    const storage = memoryStorage();
    const onFinish = vi.fn();
    const onClose = vi.fn();
    mountTarget("alpha");
    mountTarget("beta");
    render(
      <TourModal open steps={STEPS} storage={storage} onFinish={onFinish} onClose={onClose} />,
    );
    fireEvent.click(screen.getByTestId("tour-next"));
    const next = screen.getByTestId("tour-next");
    expect(next.dataset.last).toBe("true");
    fireEvent.click(next);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(storage.dump()[TOUR_STORAGE_KEY]).toBe("seen");
  });

  it("跳过按钮与 Esc 都会标记已看并回调宿主", () => {
    const storage = memoryStorage();
    const onClose = vi.fn();
    mountTarget("alpha");
    render(<TourModal open steps={STEPS} storage={storage} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(storage.dump()[TOUR_STORAGE_KEY]).toBe("seen");
    fireEvent.click(screen.getByTestId("tour-skip"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("箭头键翻页 + onStepChange 上报当前步骤", () => {
    const onStepChange = vi.fn();
    mountTarget("alpha");
    mountTarget("beta");
    render(<TourModal open steps={STEPS} storage={null} onStepChange={onStepChange} />);
    expect(onStepChange).toHaveBeenLastCalledWith(STEPS[0], 0);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("tour-title").textContent).toBe("步骤 B");
    expect(onStepChange).toHaveBeenLastCalledWith(STEPS[1], 1);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByTestId("tour-title").textContent).toBe("步骤 A");
  });

  it("renderBody 可完全接管卡片主体", () => {
    mountTarget("alpha");
    render(
      <TourModal
        open
        steps={STEPS}
        storage={null}
        renderBody={(step, index) => <p data-testid="custom-body">{`${index}:${step.id}`}</p>}
      />,
    );
    expect(screen.getByTestId("custom-body").textContent).toBe("0:a");
    expect(screen.queryByTestId("tour-title")).toBeNull();
  });

  it("useTourController.autoOpen 在没看过时自动打开,stop 后不会再打开", () => {
    const storage = memoryStorage();
    function Harness() {
      const tour = useTourController({ storage, autoOpen: true });
      return (
        <div>
          <span data-testid="tour-open">{String(tour.open)}</span>
          <button type="button" data-testid="tour-start" onClick={() => tour.start()}>
            start
          </button>
          <button type="button" data-testid="tour-stop" onClick={() => tour.stop()}>
            stop
          </button>
        </div>
      );
    }
    render(<Harness />);
    expect(screen.getByTestId("tour-open").textContent).toBe("true");
    fireEvent.click(screen.getByTestId("tour-stop"));
    expect(screen.getByTestId("tour-open").textContent).toBe("false");
    expect(storage.dump()[TOUR_STORAGE_KEY]).toBe("seen");
    fireEvent.click(screen.getByTestId("tour-start"));
    expect(screen.getByTestId("tour-open").textContent).toBe("true");
  });

  it("useTourController.autoOpen 在已看过时不打开", () => {
    function Harness() {
      const tour = useTourController({
        storage: memoryStorage({ [TOUR_STORAGE_KEY]: "seen" }),
        autoOpen: true,
      });
      return <span data-testid="tour-open">{String(tour.open)}</span>;
    }
    render(<Harness />);
    expect(screen.getByTestId("tour-open").textContent).toBe("false");
  });

  it("rect 为空时退化为居中卡片并渲染全屏暗幕", () => {
    render(
      <TourModal
        open
        steps={[{ id: "center", title: "居中", placement: "center" }]}
        storage={null}
      />,
    );
    expect(screen.getByTestId("tour-spotlight").dataset.hasHole).toBe("false");
    expect(screen.getByTestId("tour-modal").dataset.placement).toBe("center");
  });
});

describe("@openbuddy/ui-onboarding/toTourRect", () => {
  it("归一化 rect-like 对象", () => {
    const rect: TourRect = toTourRect({ top: 10, left: 20, width: 30, height: 40 });
    expect(rect).toEqual({ top: 10, left: 20, width: 30, height: 40, right: 50, bottom: 50 });
  });
});
