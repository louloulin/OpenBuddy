/**
 * Canvas 面板 —— 状态机与面板交互。
 *
 * 关注四件容易写错的事:开关画布与开关工具面板的**互斥**、关掉当前 tab 后
 * 焦点落到相邻 tab 而不是悬空、宽度被容器收敛、以及沙箱 iframe 不给
 * `allow-same-origin`(这是"沙箱不执行 parent.*"的物理保证)。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { clampCanvasWidth, useCanvasStore, type CanvasTab } from "@openbuddy/ui-state/canvas-store";
import CanvasPanel from "../canvas/CanvasPanel";
import {
  canvasKindForPath,
  canvasTabIdForPath,
  canvasTitleForPath,
  isBinaryCanvasKind,
  openPathInCanvas,
} from "../canvas/open-path";

vi.mock("@openbuddy/ui-markdown", () => ({
  Markdown: ({ children }: { children: string }) => <div data-testid="md">{children}</div>,
}));

vi.mock("@/lib/platform/electron-api", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

const TAB_A: CanvasTab = { canvasId: "a", kind: "markdown", title: "A", content: "# A" };
const TAB_B: CanvasTab = { canvasId: "b", kind: "html", title: "B", content: "<p>B</p>" };

beforeEach(() => {
  useCanvasStore.getState().reset();
});

describe("canvas store", () => {
  it("opens a tab, focuses it, and does not duplicate on re-open", () => {
    const { openTab, setActive } = useCanvasStore.getState();
    openTab(TAB_A);
    expect(useCanvasStore.getState().open).toBe(true);
    expect(useCanvasStore.getState().tabs).toHaveLength(1);

    openTab(TAB_B);
    openTab(TAB_B);
    expect(useCanvasStore.getState().tabs.map((t) => t.canvasId)).toEqual(["a", "b"]);

    setActive("a");
    expect(useCanvasStore.getState().activeCanvasId).toBe("a");
  });

  it("ignores focusing a tab that is not open", () => {
    useCanvasStore.getState().openTab(TAB_A);
    useCanvasStore.getState().setActive("ghost");
    expect(useCanvasStore.getState().activeCanvasId).toBe("a");
  });

  it("moves focus to a neighbour when the active tab is closed", () => {
    const { openTab, closeTab } = useCanvasStore.getState();
    openTab(TAB_A);
    openTab(TAB_B);
    expect(useCanvasStore.getState().activeCanvasId).toBe("b");

    closeTab("b");
    expect(useCanvasStore.getState().activeCanvasId).toBe("a");
    expect(useCanvasStore.getState().open).toBe(true);
  });

  it("closes the panel when the last tab is closed", () => {
    const { openTab, closeTab } = useCanvasStore.getState();
    openTab(TAB_A);
    closeTab("a");
    expect(useCanvasStore.getState().open).toBe(false);
    expect(useCanvasStore.getState().activeCanvasId).toBeNull();
  });

  it("keeps the chat column usable by clamping width against the container", () => {
    // 容器 900px:比例上限 648,但还要给聊天列留 320 → 上限 580。
    expect(clampCanvasWidth(2000, 900)).toBe(580);
    // 想要 100 也抬到下限,不让面板缩成一条缝。
    expect(clampCanvasWidth(100, 900)).toBe(360);
    // 极窄容器:下限优先,宁可挤聊天列也不能让面板空转。
    expect(clampCanvasWidth(2000, 400)).toBe(360);
  });
});

describe("CanvasPanel", () => {
  it("renders one tab button per open canvas and swaps the carrier on tab switch", async () => {
    const { openTab } = useCanvasStore.getState();
    openTab(TAB_A);
    openTab(TAB_B);
    render(<CanvasPanel />);

    expect(screen.getByTestId("canvas-tab-a")).toBeTruthy();
    expect(screen.getByTestId("canvas-tab-b")).toBeTruthy();
    // 最后打开的是 B(html)→ 承载是沙箱而不是 markdown。
    expect(await screen.findByTestId("canvas-sandbox-frame")).toBeTruthy();

    fireEvent.click(screen.getByTestId("canvas-tab-a"));
    expect(await screen.findByTestId("canvas-markdown")).toBeTruthy();
    expect(screen.queryByTestId("canvas-sandbox-frame")).toBeNull();
  });

  it("closes the panel through the header close button", () => {
    useCanvasStore.getState().openTab(TAB_A);
    render(<CanvasPanel />);
    fireEvent.click(screen.getByTestId("canvas-panel-close"));
    expect(useCanvasStore.getState().open).toBe(false);
  });

  it("sandbox frame runs without allow-same-origin so it cannot reach the host", async () => {
    useCanvasStore.getState().openTab(TAB_B);
    render(<CanvasPanel />);
    const frame = await screen.findByTestId("canvas-sandbox-frame");
    // 不透明源:iframe 内的代码触碰 parent.* 会抛 SecurityError。
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(frame.getAttribute("srcdoc")).toContain("<p>B</p>");
  });

  it("editing markdown keeps the source textarea in sync", () => {
    useCanvasStore.getState().openTab(TAB_A);
    render(<CanvasPanel />);
    const source = screen.getByTestId("canvas-markdown-source") as HTMLTextAreaElement;
    fireEvent.change(source, { target: { value: "# 编辑后" } });
    expect(source.value).toBe("# 编辑后");
  });
});

describe("open-path → canvas", () => {
  it("maps extensions to carrier kinds, unknown → code", () => {
    expect(canvasKindForPath("a/b/README.md")).toBe("markdown");
    expect(canvasKindForPath("x.html")).toBe("html");
    expect(canvasKindForPath("diagram.svg")).toBe("svg");
    expect(canvasKindForPath("photo.JPG")).toBe("image");
    expect(canvasKindForPath("doc.pdf")).toBe("pdf");
    expect(canvasKindForPath("main.rs")).toBe("code");
    // 无扩展名的文件不该崩,也不该猜成 markdown。
    expect(canvasKindForPath("Makefile")).toBe("code");
  });

  it("derives stable ids and titles across path separators", () => {
    expect(canvasTabIdForPath("/a/b.md")).toBe("file:/a/b.md");
    expect(canvasTitleForPath("/a/b.md")).toBe("b.md");
    expect(canvasTitleForPath("C:\\x\\y\\z.ts")).toBe("z.ts");
  });

  it("treats image/pdf as binary carriers", () => {
    expect(isBinaryCanvasKind("image")).toBe(true);
    expect(isBinaryCanvasKind("pdf")).toBe(true);
    expect(isBinaryCanvasKind("code")).toBe(false);
    expect(isBinaryCanvasKind("markdown")).toBe(false);
  });

  it("opening a path really lands a matching tab in the store", () => {
    openPathInCanvas("/w/notes.md", "# hi");
    const s1 = useCanvasStore.getState();
    expect(s1.open).toBe(true);
    expect(s1.tabs).toHaveLength(1);
    expect(s1.tabs[0]).toMatchObject({
      canvasId: "file:/w/notes.md",
      kind: "markdown",
      title: "notes.md",
      content: "# hi",
      sourcePath: "/w/notes.md",
    });

    // 二进制承载不带正文 —— 画布会用 file:// 渲染 sourcePath。
    openPathInCanvas("/w/pic.png", "should be ignored");
    const png = useCanvasStore.getState().tabs.find((t) => t.canvasId === "file:/w/pic.png");
    expect(png?.kind).toBe("image");
    expect(png?.content).toBeUndefined();

    // 同一文件重复打开不新增 tab。
    openPathInCanvas("/w/notes.md", "# hi");
    expect(useCanvasStore.getState().tabs).toHaveLength(2);
  });
});

/**
 * 词表形状回归 —— `useT` 的 lookupKey 会把 key 按 `.` 全切开逐层下钻,
 * 所以 `conversation` 下必须是**嵌套对象**。写成扁平 `"canvas.panelLabel"`
 * 时键查不到,t() 会返回 key 本身,用户直接看到 `conversation.canvas.panelLabel`
 * (仓库里 conversation.pinnedSection.empty 就是这样坏的)。
 */
describe("canvas i18n", () => {
  beforeAll(async () => {
    const [{ getOrCreateLocaleService }, zhCN, enUS] = await Promise.all([
      import("@openbuddy/ui-locale/client"),
      import("../../../../../src/locales/zh-CN.json"),
      import("../../../../../src/locales/en-US.json"),
    ]);
    const locale = getOrCreateLocaleService();
    locale.merge("zh-CN", zhCN.default as Record<string, unknown>);
    locale.merge("en-US", enUS.default as Record<string, unknown>);
  });

  it("renders labels from the dictionary instead of the raw key", async () => {
    useCanvasStore.getState().openTab(TAB_A);
    render(<CanvasPanel />);
    const panel = await screen.findByTestId("canvas-panel");
    expect(panel.getAttribute("aria-label")).toBe("画布");
    expect(screen.getByTestId("canvas-panel-close").getAttribute("aria-label")).toBe("关闭画布");
    // kind 标签也是嵌套查出来的。
    expect(screen.getByTestId("canvas-tab-a").textContent).toContain("文档");
  });
});
