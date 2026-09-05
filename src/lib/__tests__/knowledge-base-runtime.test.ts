import { describe, it, expect, beforeEach, vi } from "vitest";

const state = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  registerProviderMock: vi.fn(),
  unregisterProviderMock: vi.fn(),
  searchKbMock: vi.fn(),
  createLocalKbProviderMock: vi.fn(),
  createElectronDirectoryReaderMock: vi.fn(),
}));

vi.mock("@/lib/platform/electron-api", () => ({
  invoke: (...args: unknown[]) => state.invokeMock(...args),
}));
vi.mock("@/lib/files/electron-kb-reader", () => ({
  createElectronDirectoryReader: () => state.createElectronDirectoryReaderMock(),
}));
vi.mock("@openbuddy/files-kb", () => ({
  createLocalKbProvider: (...args: unknown[]) => state.createLocalKbProviderMock(...args),
  registerKbProvider: (...args: unknown[]) => state.registerProviderMock(...args),
  unregisterKbProvider: (...args: unknown[]) => state.unregisterProviderMock(...args),
  searchKb: (...args: unknown[]) => state.searchKbMock(...args),
}));




// Re-import per-test so module-level cache (loadedRootsKey / loadedProviderIds)
// resets between tests.
let ensureStoredLocalKnowledgeProviders: typeof import("../files/knowledge-base-runtime").ensureStoredLocalKnowledgeProviders;
let searchStoredKnowledge: typeof import("../files/knowledge-base-runtime").searchStoredKnowledge;

beforeEach(async () => {
  state.invokeMock.mockReset();
  state.registerProviderMock.mockReset();
  state.unregisterProviderMock.mockReset();
  state.searchKbMock.mockReset();
  state.createLocalKbProviderMock.mockReset();
  state.createElectronDirectoryReaderMock.mockReset();
  state.createElectronDirectoryReaderMock.mockReturnValue({ name: "stub" });
  vi.resetModules();
  ({ ensureStoredLocalKnowledgeProviders, searchStoredKnowledge } = await import("../files/knowledge-base-runtime"));
});

describe("ensureStoredLocalKnowledgeProviders", () => {
  it("returns silently when IPC fails", async () => {
    state.invokeMock.mockRejectedValueOnce(new Error("ipc-down"));
    await expect(ensureStoredLocalKnowledgeProviders()).resolves.toBeUndefined();
    expect(state.registerProviderMock).not.toHaveBeenCalled();
  });

  it("returns silently when the persisted list is not an array", async () => {
    state.invokeMock.mockResolvedValueOnce({ foo: "bar" });
    await ensureStoredLocalKnowledgeProviders();
    expect(state.registerProviderMock).not.toHaveBeenCalled();
  });

  it("filters non-string entries and ignores empty strings", async () => {
    state.invokeMock.mockResolvedValueOnce(["/docs", "", 42, null, "/notes"]);
    await ensureStoredLocalKnowledgeProviders();
    expect(state.registerProviderMock).toHaveBeenCalledTimes(2);
    expect(state.unregisterProviderMock).not.toHaveBeenCalled();
  });

  it("is idempotent: calling twice with the same roots does not re-register", async () => {
    state.invokeMock.mockResolvedValue(["/docs"]);
    await ensureStoredLocalKnowledgeProviders();
    await ensureStoredLocalKnowledgeProviders();
    expect(state.registerProviderMock).toHaveBeenCalledTimes(1);
  });

  it("unregisters previous providers when the persisted root set changes", async () => {
    state.invokeMock.mockResolvedValueOnce(["/docs"]);
    await ensureStoredLocalKnowledgeProviders();
    expect(state.registerProviderMock).toHaveBeenCalledTimes(1);

    state.invokeMock.mockResolvedValueOnce(["/docs", "/notes"]);
    await ensureStoredLocalKnowledgeProviders();
    expect(state.unregisterProviderMock).toHaveBeenCalledWith("local");
    expect(state.registerProviderMock).toHaveBeenCalledTimes(3);
  });
});

describe("searchStoredKnowledge", () => {
  it("loads providers first and forwards the query to searchKb", async () => {
    state.invokeMock.mockResolvedValueOnce(["/docs"]);
    state.searchKbMock.mockResolvedValueOnce([{ path: "/docs/a.md", title: "a", snippet: "..." }]);
    const hits = await searchStoredKnowledge("query");
    expect(state.searchKbMock).toHaveBeenCalledWith("query");
    expect(hits).toEqual([{ path: "/docs/a.md", title: "a", snippet: "..." }]);
  });
});
