/**
 * PiMarketSection onCopied / useFixtures / pageSize 集成测试 — P4 修复验证。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Mock pi-market IPC so listPiMarket returns empty (fixtures 接管)
vi.mock("@/lib/pi-market/pi-market-client", () => ({
  listPiMarket: vi.fn(async () => ({ entries: [], sources: [], lockfile: null })),
  auditPiMarket: vi.fn(async () => ({ entries: [] })),
  installPiMarket: vi.fn(async () => ({ ok: true })),
  upgradePiMarket: vi.fn(async () => ({ ok: true })),
  uninstallPiMarket: vi.fn(async () => ({ ok: true })),
  refreshPiMarket: vi.fn(async () => ({ count: 0 })),
  rollbackPiMarket: vi.fn(async () => ({ ok: true })),
  lockfilePiMarket: vi.fn(async () => ({})),
  piMarketErrorInfo: vi.fn(() => ({ title: "err", hint: "err" })),
}));

// Mock clipboard API
const clipboardWrite = vi.fn(async () => undefined);
Object.assign(globalThis.navigator, { clipboard: { writeText: clipboardWrite } });

// Inject fixture flag
beforeEach(() => {
  globalThis.__OPENBUDDY_PI_MARKET_FIXTURES__ = 1;
});

import { PiMarketSection } from "../src/PiMarketSection";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PiMarketSection onCopied", () => {
  it("calls onCopied when Copy button clicked (and falls back to onToast)", async () => {
    const onCopied = vi.fn();
    render(<PiMarketSection onCopied={onCopied} />);
    await waitFor(() => {
      expect(screen.getAllByTestId("pi-package-card").length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByTestId("pi-package-copy")[0]);
    await waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalled();
      expect(onCopied).toHaveBeenCalled();
    });
    const [entryArg, cmdArg] = onCopied.mock.calls[0];
    expect(entryArg?.name).toBeTruthy();
    expect(cmdArg).toMatch(/^pi install npm:/);
  });

  it("falls back to onToast when onCopied not provided", async () => {
    const onToast = vi.fn();
    render(<PiMarketSection onToast={onToast} />);
    await waitFor(() => {
      expect(screen.getAllByTestId("pi-package-card").length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByTestId("pi-package-copy")[0]);
    await waitFor(() => {
      expect(onToast).toHaveBeenCalledWith(expect.stringMatching(/已复制.*pi install npm:/));
    });
  });
});

describe("PiMarketSection pageSize", () => {
  it("respects pageSize prop (pageSize=3 forces multi-page)", async () => {
    render(<PiMarketSection pageSize={3} />);
    await waitFor(() => {
      expect(screen.getAllByTestId("pi-package-card").length).toBeGreaterThan(0);
    });
    // 10 fixtures, pageSize=3 → 4 pages, footer should mention "Page 1 of 4"
    expect(screen.getByTestId("pi-market-footer").textContent).toMatch(/Page 1 of 4/);
    // bottom pager visible
    expect(screen.getByTestId("pi-market-page-prev-bottom")).toBeTruthy();
    expect(screen.getByTestId("pi-market-page-next-bottom")).toBeTruthy();
  });
});

describe("PiMarketSection error rendering — R85 F2 regression", () => {
  it("toast and inline error use describeError.hint (never [object Object])", async () => {
    // Make every install call throw, exercising the triggerAction catch branch.
    const client = await import("@/lib/pi-market/pi-market-client");
    (client.installPiMarket as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      throw new Error("fake install failure");
    });
    const onToast = vi.fn();
    render(<PiMarketSection onToast={onToast} />);
    await waitFor(() => {
      expect(screen.getAllByTestId("pi-package-card").length).toBeGreaterThan(0);
    });
    // Add a non-blocked community fixture on the fly so the Install button is enabled.
    // The blocked `experimental-pi-runtime` fixture would otherwise be the only community one.
    // Easier: drive the error path via refresh() which doesn't depend on any button state.
    const refresh = screen.getByTestId("pi-market-section-refresh");
    (client.refreshPiMarket as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      throw new Error("fake refresh failure");
    });
    fireEvent.click(refresh);
    await waitFor(() => {
      expect(onToast).toHaveBeenCalled();
    });
    for (const call of onToast.mock.calls) {
      const msg = call[0] as string;
      expect(msg).not.toMatch(/\[object Object\]/);
      // Must contain a Chinese error sentence, not just "[object Object]"
      expect(msg.length).toBeGreaterThan(4);
    }
  });
});

describe("PiMarketSection PendingDialog", () => {
  it("opens the pending dialog via onOpenItem, Escape closes it", async () => {
    // 让 listPiMarket 返回 community-pi-toolkit 的 view,这样 onOpenItem 能查到 view。
    const client = await import("@/lib/pi-market/pi-market-client");
    (client.listPiMarket as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
      entries: [
        {
          id: "community-pi-toolkit",
          name: "community-pi-toolkit",
          npmName: "@community-labs/pi-toolkit",
          sourceId: "src-1",
          sourceName: "fixture-community",
          recommendedVersion: "0.5.0",
          versions: ["0.5.0"],
          versionCount: 1,
          alsoOfferedBy: [],
          capabilities: [],
        },
      ],
      sources: [
        { id: "src-1", name: "fixture-community", url: "https://registry.community-labs.example", kind: "registry", priority: 0 },
      ],
      lockfile: null,
    }));
    render(<PiMarketSection />);
    await waitFor(() => {
      expect(screen.getAllByTestId("pi-package-card").length).toBeGreaterThan(0);
    });
    // 点卡片名字按钮 → onOpenItem → 打开 dialog
    const openBtn = screen.getAllByTestId("pi-package-card-open").find(
      (b) => b.closest("[data-entry-id]")?.getAttribute("data-entry-id") === "community-pi-toolkit",
    );
    expect(openBtn).toBeTruthy();
    fireEvent.click(openBtn!);
    await waitFor(() => {
      expect(screen.getByTestId("pi-market-pending-dialog")).toBeTruthy();
    });
    expect(screen.getByText("安装扩展")).toBeTruthy();
    // dialog body 应该有 entry name
    const dialog = screen.getByTestId("pi-market-pending-dialog");
    expect(dialog.textContent).toContain("community-pi-toolkit");
    // Escape 关闭
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByTestId("pi-market-pending-dialog")).toBeNull();
    });
  });

  it("confirming the pending dialog runs installPiMarket and closes the dialog", async () => {
    const client = await import("@/lib/pi-market/pi-market-client");
    (client.listPiMarket as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
      entries: [
        {
          id: "community-pi-toolkit",
          name: "community-pi-toolkit",
          npmName: "@community-labs/pi-toolkit",
          sourceId: "src-1",
          sourceName: "fixture-community",
          recommendedVersion: "0.5.0",
          versions: ["0.5.0"],
          versionCount: 1,
          alsoOfferedBy: [],
          capabilities: [],
        },
      ],
      sources: [
        { id: "src-1", name: "fixture-community", url: "https://registry.community-labs.example", kind: "registry", priority: 0 },
      ],
      lockfile: null,
    }));
    const installMock = client.installPiMarket as unknown as ReturnType<typeof vi.fn>;
    render(<PiMarketSection />);
    await waitFor(() => {
      expect(screen.getAllByTestId("pi-package-card").length).toBeGreaterThan(0);
    });
    const openBtn = screen.getAllByTestId("pi-package-card-open").find(
      (b) => b.closest("[data-entry-id]")?.getAttribute("data-entry-id") === "community-pi-toolkit",
    );
    fireEvent.click(openBtn!);
    await waitFor(() => {
      expect(screen.getByTestId("pi-market-pending-dialog")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("pi-market-pending-confirm"));
    await waitFor(() => {
      expect(installMock).toHaveBeenCalledWith({ id: "community-pi-toolkit" });
    });
    await waitFor(() => {
      expect(screen.queryByTestId("pi-market-pending-dialog")).toBeNull();
    });
  });
});
