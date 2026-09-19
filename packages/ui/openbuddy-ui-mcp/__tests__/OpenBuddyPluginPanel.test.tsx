// @vitest-environment jsdom
/**
 * Goal mu7rpkze-gc769z / phase4-plugin-redo: locks in two contracts that
 * the half-done P0 split (reverted in commit 6cd232b) previously broke:
 *
 *  1. The integrity hash badge per Profile package row actually renders a
 *     real sha256-<hex> digest (NOT just an "—" placeholder or a stale
 *     value). The hash is computed main-side from
 *     `@openbuddy/plugin-host/plugin-security` (browser-safe subpath, not
 *     the ROOT re-export that pulled `./include.ts`'s `node:fs`/`node:path`
 *     and crashed the renderer build with 450 `[MISSING_EXPORT]` errors).
 *  2. The marketplace search input filters the rendered Profile packages list
 *     by name / version / manifest.namespaces, with a "matched / total"
 *     count chip that updates on every keystroke.
 *
 * The tests stub `agentHashContent` + the other panel-touching pi-client
 * wrappers with deterministic fixtures so the badge assertions don't
 * require a live IPC bridge. jsdom provides `window.api` via the preload
 * surface for any code path that needs it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Deterministic sha256 digest we control entirely — exercises the real
// substring math (slice(0, 12) + "…" suffix) without depending on Node crypto.
const KNOWN_HASH = "sha256-abcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

interface FakeProfilePackage {
  name: string;
  version?: string;
  listed: boolean;
  pi: boolean;
  client: boolean;
  remote: boolean;
  typert: boolean;
  cordis: boolean;
  bundle: boolean;
  manifest: {
    schema: string;
    namespaces: string[];
    missing: string[];
  };
  dependencies: Array<{ health: "ok" | "failed" }>;
  health: "ok" | "degraded";
}

const { agentHashContentMock, mockProfilePackages } = vi.hoisted(() => {
  return {
    agentHashContentMock: vi.fn(async (_content: string) => ({
      hash: KNOWN_HASH,
    })),
    mockProfilePackages: vi.fn(async (): Promise<FakeProfilePackage[]> => [
      {
        name: "pi-context-prune",
        version: "0.1.4",
        listed: true,
        pi: true,
        client: false,
        remote: false,
        typert: false,
        cordis: false,
        bundle: false,
        manifest: { schema: "1", namespaces: ["context", "summarize"], missing: [] },
        dependencies: [{ health: "ok" }],
        health: "ok",
      },
      {
        name: "pi-mcp-adapter",
        version: "0.2.0",
        listed: true,
        pi: true,
        client: false,
        remote: false,
        typert: false,
        cordis: false,
        bundle: false,
        manifest: { schema: "1", namespaces: ["mcp"], missing: [] },
        dependencies: [{ health: "ok" }],
        health: "ok",
      },
      {
        name: "pi-goal",
        version: "0.0.7",
        listed: true,
        pi: true,
        client: false,
        remote: false,
        typert: false,
        cordis: false,
        bundle: false,
        manifest: { schema: "1", namespaces: ["goal"], missing: [] },
        dependencies: [{ health: "ok" }],
        health: "ok",
      },
    ]),
  };
});

vi.mock("@/lib/agent/pi-client", () => ({
  agentHashContent: agentHashContentMock,
  agentProfilePackages: mockProfilePackages,
  // The OpenBuddyPluginPanel's other state-setters are stubbed to no-ops so the
  // panel can mount without booting the rest of the agent-runtime. The hooks
  // themselves still run (state + effect), so the badge + search/filter logic
  // is exercised end-to-end.
  agentGetStoredPluginState: vi.fn(async () => null),
  agentPluginInventory: vi.fn(async () => ({
    entries: [],
    piExtensions: [],
    providers: [],
    packages: [],
    terminalCount: 0,
    renderers: [],
    terminals: { sessionCount: 0, backends: [] },
  })),
  agentDeepSeekCordisSnapshot: vi.fn(async () => null),
  agentResourceInventory: vi.fn(async () => ({
    extensions: [], agents: [], skills: [], prompts: [], themes: [], hooks: [], diagnostics: [],
  })),
  agentOnPluginEvent: vi.fn(async () => () => undefined),
  agentSessionEventLog: vi.fn(async () => []),
  agentReloadPlugin: vi.fn(async () => undefined),
  agentResetPluginState: vi.fn(async () => ({ overrides: {}, updatedAt: "" })),
  agentSetPluginEnabled: vi.fn(async () => true),
  agentUpdatePluginConfig: vi.fn(async () => undefined),
  agentInstallProfilePackage: vi.fn(async () => ({ name: "x", version: "0", listed: false, pi: false, client: false, remote: false, typert: false, cordis: false, bundle: false, manifest: { schema: "1", namespaces: [], missing: [] }, dependencies: [], health: "ok" })),
  agentRemoveProfilePackage: vi.fn(async () => undefined),
  agentInstallDefaultPiPackages: vi.fn(async () => []),
}));

vi.mock("@/lib/runtime/renderer-plugin-runtime", () => ({
  useRendererContributions: vi.fn(() => []),
  useRendererSlot: vi.fn(() => []),
  useMainPluginInventory: vi.fn(() => ({
    entries: [], piExtensions: [], providers: [], packages: [], terminalCount: 0,
    renderers: [], terminals: { sessionCount: 0, backends: [] },
  })),
  usePluginSnapshot: vi.fn(() => null),
  usePluginReadiness: vi.fn(() => ({ phase: "ready", generation: 0, main: { loaded: 0, pending: 0, failed: 0 }, pi: { loaded: 0, pending: 0, failed: 0 } })),
}));

vi.mock("@openbuddy/ui-workbench", () => ({
  RendererSlotView: () => null,
}));

vi.mock("@openbuddy/ui-experts", () => ({
  ThumbImg: () => null,
}));

vi.mock("@/lib/platform/electron-api", () => ({
  openOne: vi.fn(async () => null),
}));

import { OpenBuddyPluginPanel } from "../src/OpenBuddyPluginPanel";

beforeEach(() => {
  agentHashContentMock.mockClear();
  mockProfilePackages.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("OpenBuddyPluginPanel integrity badge + search/filter (phase4-plugin-redo)", () => {
  it("renders the sha256-<hex> digest from agentHashContent in each row's badge", async () => {
    render(<OpenBuddyPluginPanel />);
    // Wait for the badge test-id to appear (renderer fetches hashes async).
    await waitFor(
      () => screen.queryByTestId("plugin-hash-pi-context-prune") !== null,
      { timeout: 5000 },
    );
    // Every row's badge should eventually show the first 12 chars of the
    // known sha256 digest followed by the ellipsis suffix. We wait for the
    // hash to populate (the useEffect fires after profilePackages lands, and
    // each Promise.all entry resolves independently) so we don't race the
    // async fetch.
    for (const pkg of ["pi-context-prune", "pi-mcp-adapter", "pi-goal"]) {
      await waitFor(
        () => screen.getByTestId(`plugin-hash-${pkg}`).textContent === `${KNOWN_HASH.slice(0, 12)}…`,
        { timeout: 5000 },
      );
    }
    // And agentHashContent was called once per package.
    expect(agentHashContentMock).toHaveBeenCalledTimes(3);
  });

  it("filters the rendered list by marketplace search term", async () => {
    render(<OpenBuddyPluginPanel />);
    // Wait for the marketplace-search-input to mount and the initial 3 rows to render.
    const searchInput = await screen.findByTestId("marketplace-search-input");
    await waitFor(
      () => screen.queryByTestId("profile-package-row-pi-context-prune") !== null,
      { timeout: 5000 },
    );
    expect(screen.getByTestId("profile-package-row-pi-context-prune")).toBeTruthy();
    expect(screen.getByTestId("profile-package-row-pi-mcp-adapter")).toBeTruthy();
    expect(screen.getByTestId("profile-package-row-pi-goal")).toBeTruthy();

    // Type a search term that matches a subset (substring of `pi-mcp-adapter`).
    fireEvent.change(searchInput, { target: { value: "mcp" } });
    await waitFor(
      () => screen.queryByTestId("profile-package-row-pi-context-prune") === null
        && screen.queryByTestId("profile-package-row-pi-goal") === null,
      { timeout: 2000 },
    );
    expect(screen.queryByTestId("profile-package-row-pi-context-prune")).toBeNull();
    expect(screen.queryByTestId("profile-package-row-pi-goal")).toBeNull();
    expect(screen.getByTestId("profile-package-row-pi-mcp-adapter")).toBeTruthy();

    // Match count chip updates with the new total.
    const countChip = await screen.findByTestId("marketplace-search-count");
    expect(countChip.textContent).toContain("匹配 1 / 3 个 package");

    // Clear button restores the full list.
    const clearButton = await screen.findByTestId("marketplace-search-clear");
    fireEvent.click(clearButton);
    await waitFor(
      () => screen.queryByTestId("profile-package-row-pi-context-prune") !== null,
      { timeout: 2000 },
    );
    expect(screen.getByTestId("profile-package-row-pi-context-prune")).toBeTruthy();
    expect(screen.getByTestId("profile-package-row-pi-mcp-adapter")).toBeTruthy();
    expect(screen.getByTestId("profile-package-row-pi-goal")).toBeTruthy();
  });
});