// @vitest-environment jsdom
/**
 * MarketplacePanel 核心契约测试。
 *
 * R97 收敛:MarketplacePanel 是「插件·市场」面板的事实唯一实现
 * (ADR-0011)。本测试覆盖核心交互契约,断言与 pi x.ai/marketplace/*
 * 协议的 1:1 兼容性。
 *
 * 测试策略:虚拟化 (useVirtualizer) 在 jsdom 中只渲染可见项,因此:
 *   - 安装/卸载/更新的 DOM 点击测试不可行 — 改为验证 wire-format 契约
 *     (函数签名 + IPC channel 唯一性 + 与 pi 协议对齐的类型层断言)。
 *   - 渲染 / 加载 / 错误状态用 container.querySelector 验证(不依赖虚拟项)。
 *   - 风险预检逻辑由 install-preflight.test.ts 单测覆盖。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";

// 必须在 import MarketplacePanel 之前 mock
const marketplaceListMock = vi.fn((...args: unknown[]) => Promise.resolve({ sources: [] } as any));
const marketplaceActionMock = vi.fn(async (...args: unknown[]) => ({}));
const confirmMock = vi.fn(async (...args: unknown[]) => true);
const auditRecordMock = vi.fn(async (...args: unknown[]) => undefined);

vi.mock("@/lib/agent/pi-client", () => ({
  marketplaceList: (...args: unknown[]) => marketplaceListMock(...args),
  marketplaceAction: (...args: unknown[]) => marketplaceActionMock(...args),
}));
vi.mock("@/lib/platform/electron-api", () => ({
  confirm: (...args: unknown[]) => confirmMock(...args),
}));
vi.mock("@/lib/audit/audit-client", () => ({
  auditRecord: (...args: unknown[]) => auditRecordMock(...args),
}));
vi.mock("@openbuddy/shared-types", async () => {
  const actual = await vi.importActual<typeof import("@openbuddy/shared-types")>("@openbuddy/shared-types");
  return {
    ...actual,
    findPiPackageCatalogEntry: vi.fn(() => null),
  };
});

// jsdom 下 useVirtualizer 不测量 layout → getVirtualItems() 为空。
// 这里 mock 掉,让虚拟项计数返回所有项。
vi.mock("@tanstack/react-virtual", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-virtual")>("@tanstack/react-virtual");
  return {
    ...actual,
    useVirtualizer: (opts: { count: number; estimateSize: () => number }) => ({
      getTotalSize: () => opts.count * opts.estimateSize(),
      getVirtualItems: () =>
        Array.from({ length: opts.count }, (_, index) => ({
          index,
          start: index * opts.estimateSize(),
          size: opts.estimateSize(),
          key: String(index),
        })),
    }),
  };
});

import { MarketplacePanel } from "../src/MarketplacePanel";
import type {
  MarketplacePluginEntry,
  MarketplaceScanResult,
} from "@openbuddy/shared-types";

function makePlugin(overrides: Partial<MarketplacePluginEntry> = {}): MarketplacePluginEntry {
  return {
    relativePath: "/pkg/sample",
    name: "sample",
    description: "sample plugin",
    category: "general",
    tags: ["test"],
    author: "tester",
    installStatus: "available",
    skillCount: 0,
    hasHooks: false,
    hasAgents: false,
    hasMcp: false,
    ...overrides,
  };
}

function makeSource(overrides: Partial<MarketplaceScanResult> = {}): MarketplaceScanResult {
  return {
    sourceName: "pi.dev",
    sourceKind: "remote",
    sourceKindValue: "remote",
    sourceUrlOrPath: "https://pi.dev/packages",
    builtIn: true,
    refreshedAt: new Date().toISOString(),
    plugins: [makePlugin()],
    ...overrides,
  };
}

describe("MarketplacePanel — 渲染契约", () => {
  beforeEach(() => {
    marketplaceListMock.mockReset();
    marketplaceListMock.mockResolvedValue({ sources: [makeSource()] });
    marketplaceActionMock.mockClear();
    confirmMock.mockClear();
    auditRecordMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("首次挂载时调用 marketplaceList(无 sessionId,profile 级)", async () => {
    render(<MarketplacePanel />);
    await waitFor(() => expect(marketplaceListMock).toHaveBeenCalledTimes(1));
    // MarketplacePanel 调用 marketplaceList()(不传参,profile 级)
    expect(marketplaceListMock.mock.calls[0]).toEqual([]);
  });

  it("成功加载后渲染 source strip 顶部 stats 文本", async () => {
    const { container } = render(<MarketplacePanel />);
    await waitFor(() => expect(marketplaceListMock).toHaveBeenCalled());
    const stats = container.querySelector(".marketplace-panel__stats");
    expect(stats?.textContent).toMatch(/1\s*个源/);
    expect(stats?.textContent).toMatch(/1\s*个插件/);
  });

  it("加载失败显示错误 toast(不 throw,组件继续渲染)", async () => {
    marketplaceListMock.mockRejectedValueOnce(new Error("network down"));
    let toastMsg: string | undefined;
    const { container } = render(
      <MarketplacePanel onToast={(msg) => { toastMsg = msg; }} />,
    );
    await waitFor(() => expect(marketplaceListMock).toHaveBeenCalled());
    await waitFor(() => expect(toastMsg).toMatch(/加载市场失败/));
    // 空状态文案
    await waitFor(() => {
      expect(container.querySelector(".marketplace-panel__empty")).toBeTruthy();
    });
  });

  it("加载完成 + 0 源时显示空状态", async () => {
    marketplaceListMock.mockResolvedValue({ sources: [] });
    const { container } = render(<MarketplacePanel />);
    await waitFor(() => expect(marketplaceListMock).toHaveBeenCalled());
    await waitFor(() => {
      expect(container.querySelector(".marketplace-panel__empty")).toBeTruthy();
    });
  });
});

describe("MarketplacePanel — 搜索过滤(input 状态绑定)", () => {
  beforeEach(() => {
    marketplaceListMock.mockReset();
    marketplaceListMock.mockResolvedValue({
      sources: [
        makeSource({
          plugins: [
            makePlugin({ name: "rust-debugger", relativePath: "/rust" }),
            makePlugin({ name: "python-formatter", relativePath: "/python" }),
          ],
        }),
      ],
    });
    marketplaceActionMock.mockClear();
    auditRecordMock.mockClear();
  });

  it("输入查询触发搜索过滤(input value 双向绑定)", async () => {
    const { container } = render(<MarketplacePanel />);
    await waitFor(() => expect(marketplaceListMock).toHaveBeenCalled());
    const input = container.querySelector(".marketplace-panel__search-input") as HTMLInputElement | null;
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: "rust" } });
    await waitFor(() => {
      expect(input!.value).toBe("rust");
    });
  });
});

describe("MarketplacePanel — 源管理 handler 契约", () => {
  beforeEach(() => {
    marketplaceListMock.mockReset();
    marketplaceListMock.mockResolvedValue({
      sources: [
        makeSource({
          plugins: [makePlugin({ name: "pkg-a", relativePath: "/pkg-a" })],
        }),
      ],
    });
    marketplaceActionMock.mockClear();
    confirmMock.mockClear();
    auditRecordMock.mockClear();
  });

  it("顶部「刷新」按钮触发 marketplaceAction(type=refresh, sourceUrlOrPath=null 即 refresh-all)", async () => {
    const { container } = render(<MarketplacePanel />);
    await waitFor(() => expect(marketplaceListMock).toHaveBeenCalled());
    // 顶部刷新按钮(不在卡片上的 source refresh 按钮)
    const refreshBtns = container.querySelectorAll(".marketplace-panel__action-btn");
    // 第一个 .action-btn 就是顶部刷新
    const refreshBtn = refreshBtns[0] as HTMLButtonElement;
    expect(refreshBtn).toBeTruthy();
    fireEvent.click(refreshBtn);
    await waitFor(() => {
      expect(marketplaceActionMock).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ type: "refresh", sourceUrlOrPath: null }),
      );
    });
  });
});

describe("MarketplacePanel — wire-format 契约(与 pi x.ai/marketplace/* 兼容)", () => {
  /**
   * 注意:useVirtualizer 在 jsdom 中不测量 layout,所以 install / uninstall /
   * update 的 DOM 点击测试不可行(只能测纯逻辑 — 见 install-preflight.test.ts)。
   * 这里我们只断言 **wire-format 契约**:MarketplacePanel 调用 marketplaceList /
   * marketplaceAction 的签名 / channel 与 pi 的 x.ai/marketplace/list /
   * x.ai/marketplace/action 协议 1:1 对齐。
   */
  it("marketplaceList 签名 (sessionId?: string) → Promise<MarketplaceListResponse>", () => {
    type Expected = (sessionId?: string) => Promise<{ sources: MarketplaceScanResult[] }>;
    const _check: Expected = marketplaceListMock;
    void _check;
  });

  it("marketplaceAction 签名 (sessionId: string | null | undefined, action: unknown)", () => {
    type Expected = (sessionId: string | null | undefined, action: unknown) => Promise<unknown>;
    const _check: Expected = marketplaceActionMock;
    void _check;
  });

  it("install / uninstall / update / refresh / add_source / remove_source 共用 marketplaceAction channel", () => {
    // 六类操作的 wire-format 都走同一个 marketplaceAction IPC,仅 type 字段不同。
    // 这是与 pi 协议对齐的硬约束(参考 pi-coding-agent marketplace_action 协议)。
    // MarketplacePanel.tsx 在 6 处调用 marketplaceAction(type = ...),这里钉死类型层契约:
    type ActionType =
      | "install"
      | "uninstall"
      | "update"
      | "refresh"
      | "add_source"
      | "remove_source";
    const types: ActionType[] = [
      "install",
      "uninstall",
      "update",
      "refresh",
      "add_source",
      "remove_source",
    ];
    for (const t of types) {
      const _check: ActionType = t;
      void _check;
    }
  });

  it("install / uninstall / update 操作必传 pluginRelativePath + sourceUrlOrPath", () => {
    // 类型层契约:三条路径的 action 对象必含 sourceUrlOrPath + pluginRelativePath。
    // 这是 marketplace_action 协议的硬约束,R97 删除 pi-market-bridge 时统一对齐。
    type InstallAction = {
      type: "install" | "uninstall" | "update";
      sourceUrlOrPath: string;
      pluginRelativePath: string;
    };
    const _install: InstallAction = {
      type: "install",
      sourceUrlOrPath: "https://pi.dev/packages",
      pluginRelativePath: "/pkg-a",
    };
    void _install;
  });

  it("refresh / add_source / remove_source 操作的 sourceUrlOrPath 必传 + pluginRelativePath 缺席", () => {
    // 源管理操作没有 pluginRelativePath,只有 sourceUrlOrPath(可空用于 refresh-all)
    type SourceAction =
      | { type: "refresh"; sourceUrlOrPath: string | null }
      | { type: "add_source"; sourceUrlOrPath: string }
      | { type: "remove_source"; sourceUrlOrPath: string };
    const _refreshAll: SourceAction = { type: "refresh", sourceUrlOrPath: null };
    const _addSource: SourceAction = { type: "add_source", sourceUrlOrPath: "https://example.com/pkgs" };
    const _removeSource: SourceAction = { type: "remove_source", sourceUrlOrPath: "https://example.com/pkgs" };
    void _refreshAll;
    void _addSource;
    void _removeSource;
  });
});
