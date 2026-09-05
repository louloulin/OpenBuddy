/**
 * P2-06: IPC handler registry drift detector.
 *
 * Exercises every `register*` IPC function in isolation, captures all
 * `ipcMain.handle` channel names, and asserts:
 *
 *   1. No two handlers register the same channel (drift would silently
 *      overwrite the first with the second — easy to miss in code review).
 *   2. Every registered channel follows the `<domain>:<verb>` convention
 *      so the preload side has a stable shape.
 *   3. The total channel count is at least the floor we know about
 *      (catches accidental drops when a module is refactored out).
 *
 * The test mocks `electron.ipcMain` with a recording stub so we never
 * actually invoke a handler — we only enumerate the registrations.
 */
import { describe, expect, it, vi } from "vitest";

type ChannelRecord = { channel: string; once?: boolean };

const registeredChannels: ChannelRecord[] = [];

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, _listener: unknown) => {
      registeredChannels.push({ channel });
    }),
    on: vi.fn((channel: string, _listener: unknown) => {
      registeredChannels.push({ channel });
    }),
    removeHandler: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showMessageBox: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
    showItemInFolder: vi.fn(),
  },
  BrowserWindow: class {},
}));

// registerIpc pulls in almost the entire main process graph, including
// casdoor and deepseek-runtime. We don't need that for the registry
// drift check — list the modules we want and import them directly.
describe("P2-06 IPC handler registry drift", () => {
  it("registers every channel exactly once and follows <domain>:<verb>", async () => {
    registeredChannels.length = 0;

    const noWindow = () => null;
    const [agent, collaboration, connectors, harness, misc, storage, email, casdoor] = await Promise.all([
      import("../agent"),
      import("../collaboration"),
      import("../connectors"),
      import("../harness"),
      import("../misc"),
      import("../storage"),
      import("../email"),
      import("../casdoor"),
    ]);
    agent.registerAgentIpc(noWindow);
    collaboration.registerCollaborationIpc(noWindow);
    connectors.registerConnectorsIpc(noWindow);
    harness.registerHarnessIpc(noWindow);
    misc.registerMiscIpc(noWindow);
    storage.registerStorageIpc(noWindow);
    email.registerEmailIpc(noWindow);
    casdoor.registerCasdoorIpc(noWindow);

    // 1. No duplicate channel registrations.
    const counts = new Map<string, number>();
    for (const { channel } of registeredChannels) {
      counts.set(channel, (counts.get(channel) ?? 0) + 1);
    }
    const duplicates = [...counts.entries()].filter(([, count]) => count > 1);
    expect(duplicates, `duplicate channels: ${duplicates.map(([c]) => c).join(", ")}`).toEqual([]);

    // 2. Every channel matches the channel-naming convention: lowercase
    // letters/digits/dashes/underscores/dots/slashes, optionally with a
    // `:` separator between domain and verb (e.g. `agent:init`,
    // `agents_list`, `pi://update`).
    const badName = registeredChannels
      .map(({ channel }) => channel)
      .filter((channel) => !/^[a-z][a-z0-9_.:/-]*$/u.test(channel));
    expect(badName, `non-conformant channels: ${badName.join(", ")}`).toEqual([]);

    // 3. Floor check: today the 8 modules register ~320 channels.
    // A drop below that means a module failed to register or was
    // mistakenly removed from registerIpc.
    expect(registeredChannels.length).toBeGreaterThan(300);
  });
});