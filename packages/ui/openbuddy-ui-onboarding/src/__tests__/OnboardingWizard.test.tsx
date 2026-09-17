import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OnboardingWizard, type OnboardingStep } from "../components/OnboardingWizard";
import {
  ONBOARDING_STORAGE_KEY,
  writeOnboardingState,
  createInitialOnboardingState,
  nextOnboardingStep,
  type OnboardingStorageLike,
} from "../lib/onboarding-reducer";

afterEach(() => cleanup());

function memoryStorage(): OnboardingStorageLike & { dump(): Record<string, string> } {
  const map = new Map<string, string>();
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

const STEPS: OnboardingStep[] = [
  { id: "welcome", title: "第一步", description: "开始吧" },
  { id: "theme", title: "第二步", optional: true },
  { id: "done", title: "第三步" },
];

function title(): string {
  return screen.getByTestId("onboarding-title").textContent ?? "";
}

describe("@openbuddy/ui-onboarding/OnboardingWizard", () => {
  it("渲染第一步与进度点", () => {
    render(<OnboardingWizard steps={STEPS} storage={null} />);
    expect(title()).toBe("第一步");
    expect(screen.getByTestId("onboarding-description").textContent).toBe("开始吧");
    expect(screen.getAllByTestId("onboarding-dot")).toHaveLength(3);
    expect(screen.getByTestId("onboarding-counter").textContent).toContain("1 / 3");
    // 第一步不能后退
    expect((screen.getByTestId("onboarding-back") as HTMLButtonElement).disabled).toBe(true);
  });

  it("下一步 / 上一步在步骤间移动", () => {
    render(<OnboardingWizard steps={STEPS} storage={null} />);
    fireEvent.click(screen.getByTestId("onboarding-next"));
    expect(title()).toBe("第二步");
    fireEvent.click(screen.getByTestId("onboarding-back"));
    expect(title()).toBe("第一步");
  });

  it("可选步骤显示跳过按钮,非可选步骤不显示", () => {
    render(<OnboardingWizard steps={STEPS} storage={null} />);
    expect(screen.queryByTestId("onboarding-skip")).toBeNull();
    fireEvent.click(screen.getByTestId("onboarding-next"));
    fireEvent.click(screen.getByTestId("onboarding-skip"));
    expect(title()).toBe("第三步");
  });

  it("最后一步按钮文案为完成,完成后触发 onComplete 并自我隐藏", () => {
    const onComplete = vi.fn();
    render(<OnboardingWizard steps={STEPS} storage={null} onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId("onboarding-next"));
    fireEvent.click(screen.getByTestId("onboarding-next"));
    const next = screen.getByTestId("onboarding-next");
    expect(next.dataset.last).toBe("true");
    expect(next.textContent).toBe("完成");
    fireEvent.click(next);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("onboarding-wizard")).toBeNull();
  });

  it("blocked 步骤禁用下一步", () => {
    const steps: OnboardingStep[] = [
      { id: "a", title: "A", blocked: true },
      { id: "b", title: "B" },
    ];
    render(<OnboardingWizard steps={steps} storage={null} />);
    expect((screen.getByTestId("onboarding-next") as HTMLButtonElement).disabled).toBe(true);
  });

  it("通过受控 index 完全受控", () => {
    const onIndexChange = vi.fn();
    render(
      <OnboardingWizard steps={STEPS} storage={null} index={2} onIndexChange={onIndexChange} />,
    );
    expect(title()).toBe("第三步");
    fireEvent.click(screen.getByTestId("onboarding-back"));
    expect(onIndexChange).toHaveBeenCalledWith(1, STEPS[1]);
  });

  it("宿主注入的 render 拿到 api 并能驱动前进", () => {
    const steps: OnboardingStep[] = [
      {
        id: "a",
        title: "A",
        render: (api) => (
          <button type="button" data-testid="custom-next" onClick={api.next}>
            自定义继续 {api.index + 1}/{api.total}
          </button>
        ),
      },
      { id: "b", title: "B" },
    ];
    render(<OnboardingWizard steps={steps} storage={null} />);
    expect(screen.getByTestId("custom-next").textContent).toContain("1/2");
    fireEvent.click(screen.getByTestId("custom-next"));
    expect(title()).toBe("B");
  });

  it("进度写入注入的 storage,重挂载可恢复", () => {
    const storage = memoryStorage();
    const first = render(<OnboardingWizard steps={STEPS} storage={storage} />);
    fireEvent.click(screen.getByTestId("onboarding-next"));
    expect(storage.dump()[ONBOARDING_STORAGE_KEY]).toContain('"index":1');
    first.unmount();

    render(<OnboardingWizard steps={STEPS} storage={storage} />);
    expect(title()).toBe("第二步");
    expect(screen.getByTestId("onboarding-counter").textContent).toContain("2 / 3");
  });

  it("storage 里已完成时默认不渲染(除非显式 open)", () => {
    const storage = memoryStorage();
    let state = createInitialOnboardingState(
      STEPS.map((s) => s.id),
      1,
    );
    state = nextOnboardingStep(
      state,
      STEPS.map((s) => s.id),
      2,
    );
    state = nextOnboardingStep(
      state,
      STEPS.map((s) => s.id),
      3,
    );
    state = nextOnboardingStep(
      state,
      STEPS.map((s) => s.id),
      4,
    );
    writeOnboardingState(storage, state);

    const { unmount } = render(<OnboardingWizard steps={STEPS} storage={storage} />);
    expect(screen.queryByTestId("onboarding-wizard")).toBeNull();
    unmount();

    render(<OnboardingWizard steps={STEPS} storage={storage} open />);
    expect(screen.getByTestId("onboarding-wizard")).toBeTruthy();
  });

  it("进度点:走不到的步骤禁用,已走过的可回看", () => {
    render(<OnboardingWizard steps={STEPS} storage={null} />);
    let dots = screen.getAllByTestId("onboarding-dot");
    expect((dots[0] as HTMLButtonElement).disabled).toBe(false);
    expect((dots[1] as HTMLButtonElement).disabled).toBe(true);
    expect((dots[2] as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId("onboarding-next"));
    fireEvent.click(screen.getByTestId("onboarding-next"));
    dots = screen.getAllByTestId("onboarding-dot");
    expect((dots[0] as HTMLButtonElement).disabled).toBe(false);
    expect((dots[1] as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(dots[0]);
    expect(title()).toBe("第一步");
  });

  it("Esc 与关闭按钮都会通知宿主(onDismiss),且关掉后不再显示", () => {
    // R62 —— 关闭是**终结态**:组件自己落盘 dismissed 并停止渲染。所以这里
    // 用两次独立挂载分别验证两个入口(而不是在同一棵树上连点两次 —— 第一次
    // 关闭后浮层已经不存在了,那正是我们想要的行为)。
    const viaEsc = vi.fn();
    const first = render(
      <OnboardingWizard steps={STEPS} storage={null} onDismiss={viaEsc} />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(viaEsc).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("onboarding-wizard")).toBeNull();
    first.unmount();

    const viaButton = vi.fn();
    render(<OnboardingWizard steps={STEPS} storage={null} onDismiss={viaButton} />);
    fireEvent.click(screen.getByTestId("onboarding-close"));
    expect(viaButton).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("onboarding-wizard")).toBeNull();
  });

  // ── R62 — 关闭引导必须落盘 ────────────────────────────────────────
  //
  // 用户反馈"为什么每次都弹出引导，引导过了就不需要弹出"。根因:「×」/Esc
  // 只调用宿主回调把浮层藏起来,组件自己不写 storage,于是 openbuddy.onboarding
  // .state 始终是 idle,重启后向导原样再弹。这组用例锁住"关闭即终结态"。
  describe("R62 — 关闭/跳过整段引导会持久化 dismissed", () => {
    const dismissCases: Array<[string, (storage: OnboardingStorageLike) => void]> = [
      ["关闭按钮", (storage) => fireEvent.click(screen.getByTestId("onboarding-close"))],
      ["Esc", () => fireEvent.keyDown(window, { key: "Escape" })],
    ];

    for (const [label, act] of dismissCases) {
      it(`${label} 后 storage 落 dismissed,再次挂载不再显示`, () => {
        const storage = memoryStorage();
        const first = render(
          <OnboardingWizard steps={STEPS} storage={storage} onDismiss={() => {}} />,
        );
        expect(screen.getByTestId("onboarding-wizard")).toBeTruthy();
        act(storage);
        const raw = storage.dump()[ONBOARDING_STORAGE_KEY];
        expect(JSON.parse(raw ?? "null").status).toBe("dismissed");
        first.unmount();

        // 关键:同一份 storage 重新挂载(等价于重启应用)不该再弹。
        render(<OnboardingWizard steps={STEPS} storage={storage} onDismiss={() => {}} />);
        expect(screen.queryByTestId("onboarding-wizard")).toBeNull();
      });
    }

    it("已 done 的状态不会被关闭动作改写成 dismissed", () => {
      const storage = memoryStorage();
      const done = nextOnboardingStep(
        nextOnboardingStep(
          nextOnboardingStep(createInitialOnboardingState(STEPS.map((s) => s.id))),
        ),
      );
      writeOnboardingState(storage, done);
      expect(done.status).toBe("done");

      render(<OnboardingWizard steps={STEPS} storage={storage} onDismiss={() => {}} />);
      // 已终结 → 根本不渲染,也不会写回
      expect(screen.queryByTestId("onboarding-wizard")).toBeNull();
      expect(JSON.parse(storage.dump()[ONBOARDING_STORAGE_KEY] ?? "null").status).toBe("done");
    });

    it("走完最后一步仍落 done(不是 dismissed)", () => {
      const storage = memoryStorage();
      render(<OnboardingWizard steps={STEPS} storage={storage} />);
      fireEvent.click(screen.getByTestId("onboarding-next"));
      fireEvent.click(screen.getByTestId("onboarding-next"));
      fireEvent.click(screen.getByTestId("onboarding-next"));
      const parsed = JSON.parse(storage.dump()[ONBOARDING_STORAGE_KEY] ?? "null");
      expect(parsed.status).toBe("done");
      expect(parsed.completedAt).toBeTypeOf("number");
    });
  });

  it("箭头键翻页,但输入框内不劫持", () => {
    const steps: OnboardingStep[] = [
      {
        id: "a",
        title: "A",
        render: () => <input data-testid="inner-input" />,
      },
      { id: "b", title: "B" },
    ];
    render(<OnboardingWizard steps={steps} storage={null} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(title()).toBe("B");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(title()).toBe("A");
    fireEvent.keyDown(screen.getByTestId("inner-input"), { key: "ArrowRight" });
    expect(title()).toBe("A");
  });

  it("空步骤列表不渲染", () => {
    render(<OnboardingWizard steps={[]} storage={null} />);
    expect(screen.queryByTestId("onboarding-wizard")).toBeNull();
  });
});
