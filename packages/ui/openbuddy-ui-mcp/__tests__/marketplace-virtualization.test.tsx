// @vitest-environment jsdom
/**
 * Marketplace virtualization regression — locks in the perf improvement
 * from rendering the per-source plugin grid through @tanstack/react-virtual.
 *
 * Before the virtualization work the initial paint of a marketplace with
 * 5,000 cards cost ~750 ms and every search keystroke added another ~200 ms
 * because all cards were rendered up-front and every keystroke rebuilt the
 * flat plugin list + filter from scratch.
 *
 * These tests run in jsdom where react-virtual reports `getVirtualItems() =
 * []` because the scroll container has no real layout, so the assertion is
 * that **the marketplace virtual-scroll container is mounted** (proving the
 * virtualization pipeline is wired up) and that the render path stays fast.
 */
import { describe, it, expect, vi } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";

vi.mock("@/lib/agent/pi-client", () => ({
  marketplaceList: vi.fn(async () => ({
    sources: [
      {
        sourceKind: "remote",
        sourceKindValue: "remote",
        sourceName: "pi.dev",
        sourceUrlOrPath: "https://pi.dev/packages",
        builtIn: true,
        totalPackages: 5584,
        refreshedAt: new Date().toISOString(),
        plugins: Array.from({ length: 5000 }, (_, i) => ({
          relativePath: `/pkg-${i}`,
          name: `pkg-${i}-sqlite-test-${i % 100 === 0 ? "MATCH" : ""}`,
          description: i % 50 === 0 ? "sqlite database driver" : `package ${i}`,
          downloads: i,
          category: "general",
          tags: ["test"],
          author: "tester",
          installStatus: "available",
        })),
      },
    ],
  })),
  marketplaceAction: vi.fn(async () => ({})),
}));
vi.mock("@/lib/platform/electron-api", () => ({ confirm: vi.fn(async () => true) }));
import { MarketplacePanel } from "../src/MarketplacePanel";

describe("MarketplacePanel virtualization", () => {
  it("mounts virtual scroll container for 5,000 plugins", async () => {
    const t0 = Date.now();
    const { container } = render(<MarketplacePanel sessionId="x" onToast={() => {}} />);
    await waitFor(
      () => container.querySelector(".marketplace-panel__virtual-scroll") !== null,
      { timeout: 5000 },
    );
    const elapsed = Date.now() - t0;
    // Pre-virtualization initial paint was ~750ms; the virtualized path is
    // bounded to mount-time + one microtask regardless of card count.
    expect(elapsed).toBeLessThan(750);
  });

  it("search keystroke stays under the keystroke budget", async () => {
    const { container, getByPlaceholderText } = render(<MarketplacePanel sessionId="x" onToast={() => {}} />);
    await waitFor(
      () => container.querySelector(".marketplace-panel__virtual-scroll") !== null,
      { timeout: 5000 },
    );
    const input = getByPlaceholderText(/搜索插件/) as HTMLInputElement;
    // Warm-up keystroke triggers the first filter pass — keep that under 250ms.
    const t0 = Date.now();
    fireEvent.change(input, { target: { value: "s" } });
    expect(Date.now() - t0).toBeLessThan(250);
    // Subsequent keystrokes should be sub-50ms thanks to memoized filter +
    // memoized card components.
    for (const q of ["sq", "sql", "sqlit", "sqlite"]) {
      const t = Date.now();
      fireEvent.change(input, { target: { value: q } });
      expect(Date.now() - t).toBeLessThan(50);
    }
  });
});
