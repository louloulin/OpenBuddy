/**
 * LibraryPage 接线测试 —— 真内核(SlotProvider),不是 mock。
 *
 * 要证的是一条**插件化**链路:注册到 `library.section` 的分区,用户在导航列里
 * 真的看得见、点得到;没有元数据的注册值被忽略;order 决定顺序而不是注册顺序。
 *
 * 用真 `SlotProvider` 的理由与 editor-slot-wiring 一致:槽位"有 entries"和
 * "用户看得见"是两件事,只有渲染出来才算数。
 */
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SlotProvider, getOrCreateSingleton } from "@openbuddy/ui-runtime/client";
import { LibraryPage } from "../LibraryPage";
import { LIBRARY_SECTION_IDS, defineLibrarySection } from "../section-contract";

const disposers: Array<() => void> = [];

/** 往真内核里注册一个分区(等价于插件 registerSlot 的效果)。 */
function contributeSection(id: string, Component: unknown) {
  const rt = getOrCreateSingleton();
  disposers.push(
    rt.slots.register(
      {
        name: "library.section",
        kind: "list",
        scope: "root",
        id,
        registrant: "test-plugin",
      },
      Component as never,
    ),
  );
}

/** 测试分区故意排在 900+ —— 内置分区(order 10..40)由 SlotProvider 自动装配,
 *  这样"点谁出谁"的断言不会被内置实现抢走。 */
function sections() {
  return [
    defineLibrarySection({ id: "beta", label: "乙分区", icon: "cloud", order: 910 }, () => (
      <div data-testid="body-beta">beta-body</div>
    )),
    defineLibrarySection({ id: "alpha", label: "甲分区", icon: "files", order: 900 }, () => (
      <div data-testid="body-alpha">alpha-body</div>
    )),
  ];
}

function railIds(): string[] {
  return screen
    .getAllByRole("tab")
    .map((el) => el.getAttribute("data-testid") ?? "")
    .filter((id) => id.startsWith("library-rail-"));
}

function mount(props: Parameters<typeof LibraryPage>[0] = {}) {
  return render(
    <SlotProvider>
      <LibraryPage {...props} />
    </SlotProvider>,
  );
}

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
  cleanup();
});

describe("LibraryPage", () => {
  it("内置 4 个分区由 apply() 注册进同一条总线,SlotProvider 装配后即出现在导航列", async () => {
    mount({ initialSection: LIBRARY_SECTION_IDS.inspiration });
    await waitFor(() =>
      expect(screen.getByTestId(`library-rail-${LIBRARY_SECTION_IDS.files}`)).toBeInTheDocument(),
    );
    for (const id of Object.values(LIBRARY_SECTION_IDS)) {
      expect(screen.getByTestId(`library-rail-${id}`)).toBeInTheDocument();
    }
    // 导航列顺序 = meta.order,不是注册顺序。
    const ids = railIds();
    expect(ids).toEqual([
      `library-rail-${LIBRARY_SECTION_IDS.files}`,
      `library-rail-${LIBRARY_SECTION_IDS.knowledge}`,
      `library-rail-${LIBRARY_SECTION_IDS.cloud}`,
      `library-rail-${LIBRARY_SECTION_IDS.inspiration}`,
    ]);
  });

  it("插件分区按 order 排在内置分区之后", async () => {
    const [beta, alpha] = sections();
    contributeSection("beta", beta);
    contributeSection("alpha", alpha);
    mount({ initialSection: "alpha" });

    await waitFor(() => expect(screen.getByTestId("library-rail-beta")).toBeInTheDocument());
    const ids = railIds();
    expect(ids.slice(-2)).toEqual(["library-rail-alpha", "library-rail-beta"]);
  });

  it("点击导航项切换分区(内容真的换掉,不是只换高亮)", async () => {
    const [beta, alpha] = sections();
    contributeSection("beta", beta);
    contributeSection("alpha", alpha);
    mount({ initialSection: "alpha" });

    await waitFor(() => expect(screen.getByTestId("body-alpha")).toBeInTheDocument());
    expect(screen.queryByTestId("body-beta")).toBeNull();

    fireEvent.click(screen.getByTestId("library-rail-beta"));
    await waitFor(() => expect(screen.getByTestId("body-beta")).toBeInTheDocument());
    expect(screen.queryByTestId("body-alpha")).toBeNull();
    expect(screen.getByTestId("library-rail-beta")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("library-rail-alpha")).toHaveAttribute("data-active", "false");
  });

  it("initialSection 直接落到指定分区(「灵感」入口就是这条路径)", async () => {
    const [beta, alpha] = sections();
    contributeSection("beta", beta);
    contributeSection("alpha", alpha);
    mount({ initialSection: "alpha" });
    await waitFor(() => expect(screen.getByTestId("body-alpha")).toBeInTheDocument());
    expect(screen.getByTestId("library-rail-alpha")).toHaveAttribute("aria-selected", "true");
  });

  it("initialSection 指向未注册分区时回落到第一个,不留空白页", async () => {
    mount({ initialSection: "not-there" });
    await waitFor(() =>
      expect(screen.getByTestId("library-content")).toHaveAttribute(
        "data-section",
        LIBRARY_SECTION_IDS.files,
      ),
    );
  });

  it("没有元数据的注册值被忽略(不画无标签导航项)", async () => {
    const [beta] = sections();
    contributeSection("beta", beta);
    contributeSection("raw", () => <div data-testid="body-raw">raw</div>);
    mount({ initialSection: "beta" });

    await waitFor(() => expect(screen.getByTestId("body-beta")).toBeInTheDocument());
    expect(screen.queryByTestId("body-raw")).toBeNull();
    expect(railIds()).not.toContain("library-rail-raw");
  });

  it("分区组件拿到宿主 props(active / cwd / onToast)", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const Probe = defineLibrarySection(
      { id: "probe", label: "探针", icon: "generic", order: 1 },
      (props) => {
        seen.push({ active: props.active, cwd: props.cwd, hasToast: typeof props.onToast });
        return <div data-testid="body-probe" />;
      },
    );
    contributeSection("probe", Probe);
    const onToast = () => undefined;
    mount({ initialSection: "probe", cwd: "/tmp/ws", onToast });

    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]).toEqual({ active: true, cwd: "/tmp/ws", hasToast: "function" });
  });
});
