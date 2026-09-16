// @vitest-environment jsdom
/**
 * PiExtensionsSection — 区块级回归。
 *
 * 这是 R32 新加的产品面(「市场」面板顶部的 Pi 扩展区块),覆盖:
 *   - 没配源时的本地优先空态(而不是一个大空列表);
 *   - 有源时的来源 chips + 统计;
 *   - 刷新后把每源状态(fresh / cached)与「不可达」提示透出来;
 *   - 安装走 InstallDialog,高风险同意的失败要能回到对话框里。
 *
 * IPC 全部 mock —— 这里验证的是**区块自己的状态机**,链路真实性由
 * `src/lib/pi-market/__tests__/pi-market-client.test.ts` 接真 bridge 覆盖。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const client = vi.hoisted(() => ({
  listPiMarket: vi.fn(),
  refreshPiMarket: vi.fn(),
  installPiMarket: vi.fn(),
  upgradePiMarket: vi.fn(),
  rollbackPiMarket: vi.fn(),
  uninstallPiMarket: vi.fn(),
  lockfilePiMarket: vi.fn(),
  auditPiMarket: vi.fn(),
  piMarketErrorInfo: vi.fn((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return { code: "unknown", detail: message };
  }),
}));

vi.mock("@/lib/pi-market/pi-market-client", () => client);
vi.mock("@/lib/platform/electron-api", () => ({ confirm: vi.fn(async () => true) }));

import { PiExtensionsSection } from "../src/PiExtensionsSection";

function entry(partial: Record<string, unknown> = {}) {
  return {
    id: "demo",
    name: "Demo 扩展",
    publisher: "openbuddy",
    description: "演示",
    version: "1.0.0",
    versions: ["1.0.0"],
    kinds: ["extension"],
    capabilities: [{ id: "tools.demo", risk: "low" }],
    manifest: {},
    sourceId: "local",
    ...partial,
  };
}

beforeEach(() => {
  client.listPiMarket.mockReset().mockResolvedValue({ entries: [entry()] });
  client.refreshPiMarket.mockReset().mockResolvedValue({
    count: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "remote",
  });
  client.installPiMarket.mockReset().mockResolvedValue({
    id: "demo",
    version: "1.0.0",
    path: "/tmp/demo",
    changed: true,
    installedAt: "2026-01-01T00:00:00.000Z",
    capabilities: ["tools.demo"],
  });
  client.upgradePiMarket.mockReset().mockResolvedValue({
    id: "demo",
    version: "1.0.0",
    path: "/tmp/demo",
    changed: false,
    installedAt: "2026-01-01T00:00:00.000Z",
    capabilities: [],
  });
  client.rollbackPiMarket.mockReset();
  client.uninstallPiMarket.mockReset().mockResolvedValue({
    id: "demo",
    version: "1.0.0",
    removedVersions: ["1.0.0"],
    removedPath: "/tmp/demo",
    at: "2026-01-01T00:00:00.000Z",
    payloadKept: false,
  });
  client.lockfilePiMarket.mockReset().mockResolvedValue({ version: 1, extensions: {} });
  client.auditPiMarket.mockReset().mockResolvedValue({ entries: [] });
});

describe("本地优先空态", () => {
  it("没有源时告诉用户源该写在哪里,而不是渲染空列表", async () => {
    client.listPiMarket.mockResolvedValue({ entries: [] });
    render(<PiExtensionsSection onToast={() => {}} />);
    const empty = await screen.findByTestId("pi-ext-empty");
    expect(empty.textContent).toContain("pi-extensions/sources.json");
    expect(empty.textContent).toContain("OPENBUDDY_PI_MARKET_SOURCES");
    expect(screen.queryByTestId("marketplace-tab")).toBeNull();
  });

  it("索引不可用(全部源拉不到且无缓存)时显示补救提示", async () => {
    client.listPiMarket.mockRejectedValue(new Error("pi-market: all 2 registry source(s) unreachable"));
    render(<PiExtensionsSection onToast={() => {}} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("unreachable");
  });
});

describe("来源展示", () => {
  it("没有刷新报告时从条目反推来源 chips", async () => {
    render(<PiExtensionsSection onToast={() => {}} />);
    const sources = await screen.findByTestId("pi-ext-sources");
    expect(sources.textContent).toContain("本地索引");
    expect(sources.textContent).toContain("1");
    expect(screen.getByTestId("marketplace-tab")).toBeTruthy();
  });

  it("刷新后用权威的每源状态,并把不可达(用缓存)说出来", async () => {
    const onToast = vi.fn();
    client.refreshPiMarket.mockResolvedValue({
      count: 7,
      updatedAt: "2026-01-01T00:00:00.000Z",
      source: "remote",
      sources: [
        { id: "official", label: "官方", weight: 10, state: "fresh", entryCount: 5 },
        { id: "mirror", weight: 0, state: "cached", entryCount: 2 },
      ],
      failed: [{ id: "mirror", weight: 0, state: "cached", entryCount: 2 }],
    });
    render(<PiExtensionsSection onToast={onToast} />);
    await screen.findByTestId("marketplace-tab");

    fireEvent.click(screen.getByTestId("pi-ext-refresh"));

    await waitFor(() => expect(client.refreshPiMarket).toHaveBeenCalledTimes(1));
    const sources = await screen.findByTestId("pi-ext-sources");
    expect(sources.textContent).toContain("官方");
    expect(sources.textContent).toContain("用缓存");
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("已用上次缓存"),
    );
    expect(onToast).toHaveBeenCalledWith("索引已刷新：7 条,1 个源不可达");
  });
});

describe("卸载 / 重装(R33)", () => {
  const installed = () => entry({ installedVersion: "1.0.0" });

  it("没安装的条目没有 ⋯ 菜单(避免点了才报 not-found)", async () => {
    render(<PiExtensionsSection onToast={() => {}} />);
    await screen.findByTestId("marketplace-tab");
    expect(screen.queryAllByTestId("marketplace-card-menu")).toHaveLength(0);
  });

  it("已安装的条目可以在 ⋯ 里卸载,确认后调 IPC 并刷新", async () => {
    const onToast = vi.fn();
    client.listPiMarket.mockResolvedValue({ entries: [installed()] });
    render(<PiExtensionsSection onToast={onToast} />);
    await screen.findByTestId("marketplace-tab");

    fireEvent.click(screen.getAllByTestId("marketplace-card-menu")[0]);
    expect(screen.getByTestId("marketplace-card-menu-list").textContent).toContain("卸载");
    fireEvent.click(screen.getByText("卸载"));

    await waitFor(() => expect(client.uninstallPiMarket).toHaveBeenCalledTimes(1));
    expect(client.uninstallPiMarket.mock.calls[0][0]).toMatchObject({ id: "demo" });
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("已卸载：demo@1.0.0"));
    // 卸载后要重新拉列表,否则卡片还显示「已安装」。
    expect(client.listPiMarket.mock.calls.length).toBeGreaterThan(1);
  });

  it("强制重装走 force=true(修复被外部改写的载荷)", async () => {
    const onToast = vi.fn();
    client.listPiMarket.mockResolvedValue({ entries: [installed()] });
    render(<PiExtensionsSection onToast={onToast} />);
    await screen.findByTestId("marketplace-tab");

    fireEvent.click(screen.getAllByTestId("marketplace-card-menu")[0]);
    fireEvent.click(screen.getByText(/强制重装/));

    await waitFor(() => expect(client.installPiMarket).toHaveBeenCalledTimes(1));
    expect(client.installPiMarket.mock.calls[0][0]).toMatchObject({
      id: "demo",
      version: "1.0.0",
      force: true,
      allowHighRisk: true,
    });
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("已重装：demo@1.0.0"));
  });

  it("卸载失败时按错误码给补救说明", async () => {
    const onToast = vi.fn();
    client.listPiMarket.mockResolvedValue({ entries: [installed()] });
    client.piMarketErrorInfo.mockReturnValue({ code: "unsafe-target", detail: "symlink" });
    client.uninstallPiMarket.mockRejectedValue(new Error("unsafe"));

    render(<PiExtensionsSection onToast={onToast} />);
    await screen.findByTestId("marketplace-tab");
    fireEvent.click(screen.getAllByTestId("marketplace-card-menu")[0]);
    fireEvent.click(screen.getByText("卸载"));

    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith(expect.stringContaining("卸载失败")),
    );
    expect(onToast.mock.calls.at(-1)?.[0]).toContain("符号链接");
  });
});

describe("安装流程", () => {
  it("点安装打开 InstallDialog,确认后调用 install 并刷新列表", async () => {
    const onToast = vi.fn();
    render(<PiExtensionsSection onToast={onToast} />);
    await screen.findByTestId("marketplace-tab");

    fireEvent.click(screen.getAllByTestId("marketplace-card-primary")[0]);
    const dialog = await screen.findByTestId("install-dialog");
    expect(dialog).toBeTruthy();

    fireEvent.click(screen.getByTestId("install-dialog-confirm"));
    await waitFor(() => expect(client.installPiMarket).toHaveBeenCalledTimes(1));
    expect(client.installPiMarket.mock.calls[0][0]).toMatchObject({ id: "demo" });
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("已就绪：demo@1.0.0"));
  });

  it("高风险同意被拒时把补救说明留在对话框里,而不是关掉对话框", async () => {
    client.piMarketErrorInfo.mockReturnValue({
      code: "consent-required",
      detail: "demo requests high-risk capabilities: fs.write",
    });
    client.installPiMarket.mockRejectedValue(new Error("consent"));

    render(<PiExtensionsSection onToast={() => {}} />);
    await screen.findByTestId("marketplace-tab");
    fireEvent.click(screen.getAllByTestId("marketplace-card-primary")[0]);
    fireEvent.click(await screen.findByTestId("install-dialog-confirm"));

    const error = await screen.findByTestId("install-dialog-error");
    expect(error.textContent).toContain("高风险");
    expect(screen.getByTestId("install-dialog")).toBeTruthy();
  });
});
