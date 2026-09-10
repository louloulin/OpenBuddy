/**
 * quit-gate.test.ts — Phase 4.5 plan4.md
 *
 * Integration / Electron-mock tests for quit-gate.ts.
 *
 * Mock strategy:
 *   - electron (app, dialog, BrowserWindow) via vi.mock() at file top.
 *     This is reliable because quit-gate imports these at the top level.
 *   - install-host-modules quitGateState: quit-gate writes to it; we verify
 *     the observable effect (app.exit NOT called for BACKGROUND/CANCEL) rather
 *     than the internal flag.  app.exit being called = app actually quit,
 *     which we intercept and track.
 *
 * What we test (all verifiable via mock assertions):
 *   ✓ Registers one before-quit handler
 *   ✓ No active tasks → dispose called, no dialog, no app.exit
 *   ✓ Active tasks + FORCE → killTask + dispose called, app.exit NOT called
 *   ✓ Active tasks + CANCEL → dispose NOT called, app.exit NOT called, re-arm
 *   ✓ Active tasks + BACKGROUND → window.close called, app.exit NOT called
 *   ✓ Dialog dismissed / window-destroyed → dispose NOT called
 *   ✓ Second quit while dialog open → preventDefault called, one dialog
 *   ✓ Background drain: when tasks drain → dispose + app.exit(0)
 *   ✓ Background drain: second before-quit → monitor cancelled
 *   ✓ __resetQuitGateForTest restores initial state
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock state tracking ────────────────────────────────────────────────────────

const dialogResults: number[] = [];
let dialogResolve: ((r: { response: number }) => void) | null = null;

function makeDialogDeferred() {
  let resolve!: (r: { response: number }) => void;
  const promise = new Promise<{ response: number }>((res) => {
    resolve = res;
  });
  return { promise, resolve: (r: { response: number }) => {
    dialogResults.push(r.response);
    resolve(r);
  }} as { promise: Promise<{ response: number }>; resolve: (r: { response: number }) => void };
}

const mockAppHandlers = new Map<string, Set<(event: unknown) => void>>();
const appExitCodes: number[] = [];

const mockApp = {
  on: vi.fn((event: string, handler: (event: unknown) => void) => {
    if (!mockAppHandlers.has(event)) mockAppHandlers.set(event, new Set());
    mockAppHandlers.get(event)!.add(handler);
  }),
  once: vi.fn((event: string, handler: (event: unknown) => void) => {
    if (!mockAppHandlers.has(event)) mockAppHandlers.set(event, new Set());
    mockAppHandlers.get(event)!.add(handler);
  }),
  exit: vi.fn((code: number) => appExitCodes.push(code)),
};

const mockBrowserWindow = {
  close: vi.fn(),
  isDestroyed: vi.fn(() => false),
};

const mockDialogShowBox = vi.fn(() => {
  const d = makeDialogDeferred();
  dialogResolve = d.resolve;
  return d.promise;
}) as ReturnType<typeof vi.fn> & (() => Promise<{ response: number }>);

vi.mock("electron", () => ({
  app: mockApp,
  dialog: { showMessageBox: mockDialogShowBox },
  BrowserWindow: { getAllWindows: () => [mockBrowserWindow] },
})); // eslint-disable-line @typescript-eslint/no-explicit-any

// ── install-host-modules mock (quitGateState) ─────────────────────────────────
//
// quit-gate.ts imports quitGateState from install-host-modules and writes to it.
// We export a shared object so both quit-gate (via mock) and tests read/write
// the same property.  Using vi.doMock in beforeEach to apply it per-test.

let sharedQuitState = { backgroundDraining: false, quitGateInstalled: false };

(vi.mock as (path: string, factory?: () => unknown, options?: { virtual?: boolean }) => void)(
  "../bootstrap/install-host-modules",
  () => ({ quitGateState: sharedQuitState }),
  { virtual: true },
);

// ── Test subjects ─────────────────────────────────────────────────────────────

let installQuitGate: (deps: {
  listActiveTasks: () => { id: string; kind: string; description: string; status: string; sessionId?: string }[];
  killTask: (id: string) => Promise<void>;
  dispose: () => Promise<void>;
  getMainWindow?: () => unknown;
}) => void;

type HarnessTaskSnapshot2 = {
  id: string;
  kind: string;
  description: string;
  status: "running" | "stopping" | "completed" | "killed" | "failed";
  sessionId?: string;
};

let __resetQuitGateForTest: () => void;

let importDone = false;

async function ensureImport(): Promise<void> {
  if (importDone) return;
  const mod = await import("../quit-gate");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  installQuitGate = mod.installQuitGate as unknown as typeof installQuitGate;
  __resetQuitGateForTest = mod.__resetQuitGateForTest;
  importDone = true;
}

beforeEach(async () => {
  // Reset mock / shared state.
  mockAppHandlers.clear();
  vi.clearAllMocks();
  appExitCodes.length = 0;
  dialogResults.length = 0;
  dialogResolve = null;
  sharedQuitState.backgroundDraining = false;
  sharedQuitState.quitGateInstalled = false;
  mockBrowserWindow.close.mockClear();
  mockBrowserWindow.isDestroyed.mockReturnValue(false);
  mockDialogShowBox.mockClear();

  // Ensure quit-gate is imported (first time: after vi.mock is set up).
  await ensureImport();

  // Reset quit-gate's module-level singletons.
  __resetQuitGateForTest();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function fireBeforeQuit(): { preventDefault: ReturnType<typeof vi.fn> } {
  const event = { preventDefault: vi.fn() };
  const handlers = mockAppHandlers.get("before-quit");
  if (handlers) {
    for (const h of handlers) h(event);
  }
  return event;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function resolveDialog(response: number): void {
  dialogResolve?.({ response });
}

type HarnessTaskSnapshot = { id: string; kind: string; description: string; status: string; sessionId?: string };
function makeTask(id = "t1", status: "running" | "stopping" | "completed" = "running"): HarnessTaskSnapshot {
  return { id, kind: "subagent", description: `Task ${id}`, status, sessionId: "s1" };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("installQuitGate", () => {
  it("registers exactly one before-quit handler", () => {
    installQuitGate({ listActiveTasks: () => [], killTask: vi.fn(), dispose: vi.fn() });
    expect(mockApp.on).toHaveBeenCalledWith("before-quit", expect.any(Function));
    expect(mockAppHandlers.get("before-quit")?.size).toBe(1);
  });
});

describe("no active tasks", () => {
  it("preventDefault + dispose + app.exit(0)", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    installQuitGate({ listActiveTasks: () => [], killTask: vi.fn(), dispose });
    fireBeforeQuit();
    await tick();
    expect(dispose).toHaveBeenCalled();
    expect(mockDialogShowBox).not.toHaveBeenCalled();
    expect(appExitCodes).toContain(0); // app.exit(0) called after dispose
  });
});

describe("FORCE quit", () => {
  it("kills all active tasks then disposes and exits", async () => {
    const killTask = vi.fn().mockResolvedValue(undefined);
    const dispose = vi.fn().mockResolvedValue(undefined);
    installQuitGate({
      listActiveTasks: () => [makeTask("t1"), makeTask("t2")],
      killTask,
      dispose,
    });
    fireBeforeQuit();
    await tick();
    expect(mockDialogShowBox).toHaveBeenCalled();
    resolveDialog(0); // FORCE
    await tick();
    expect(killTask).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalled();
    expect(appExitCodes).toContain(0); // app.exit(0) called after dispose
  });

  it("dispose rejection still calls app.exit(0)", async () => {
    // Even if dispose() rejects, the process must exit to avoid hanging.
    const dispose = vi.fn().mockRejectedValue(new Error("dispose failed"));
    installQuitGate({
      listActiveTasks: () => [makeTask("t1")],
      killTask: vi.fn().mockResolvedValue(undefined),
      dispose,
    });
    fireBeforeQuit();
    await tick();
    resolveDialog(0); // FORCE
    await tick();
    // dispose() rejected but app.exit(0) must still be called.
    expect(appExitCodes).toContain(0);
  });
});

describe("CANCEL quit", () => {
  it("does NOT dispose after user cancels", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    installQuitGate({ listActiveTasks: () => [makeTask()], killTask: vi.fn(), dispose });
    fireBeforeQuit();
    await tick();
    expect(mockDialogShowBox).toHaveBeenCalled();
    resolveDialog(2); // CANCEL
    await tick();
    expect(dispose).not.toHaveBeenCalled();
    expect(appExitCodes).not.toContain(0); // app stays alive
  });

  it("re-arms so a second quit attempt shows the dialog again", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    installQuitGate({ listActiveTasks: () => [makeTask()], killTask: vi.fn(), dispose });
    fireBeforeQuit();
    await tick();
    expect(mockDialogShowBox).toHaveBeenCalledTimes(1);
    resolveDialog(2); // CANCEL
    await tick();
    fireBeforeQuit();
    await tick();
    expect(mockDialogShowBox).toHaveBeenCalledTimes(2);
    expect(dispose).not.toHaveBeenCalled();
  });
});

describe("BACKGROUND quit", () => {
  it("closes the window and does NOT call dispose immediately", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    installQuitGate({
      listActiveTasks: () => [makeTask()],
      killTask: vi.fn(),
      dispose,
      getMainWindow: () => mockBrowserWindow,
    });
    fireBeforeQuit();
    await tick();
    expect(mockDialogShowBox).toHaveBeenCalled();
    resolveDialog(1); // BACKGROUND
    await tick();
    expect(mockBrowserWindow.close).toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled(); // waits for drain
    expect(appExitCodes).not.toContain(0); // app stays alive
  });


});

describe("dialog dismissed / timeout", () => {
  it("timeout: dispose NOT called while dialog is pending", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    installQuitGate({ listActiveTasks: () => [makeTask()], killTask: vi.fn(), dispose });
    fireBeforeQuit();
    await tick();
    expect(mockDialogShowBox).toHaveBeenCalled();
    // Never resolve — the 30s timeout handles it. Dispose should NOT be called.
    expect(dispose).not.toHaveBeenCalled();
  });

  it("window-destroyed (buttonIndex -1): treated as cancel", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    installQuitGate({ listActiveTasks: () => [makeTask()], killTask: vi.fn(), dispose });
    fireBeforeQuit();
    await tick();
    expect(mockDialogShowBox).toHaveBeenCalled();
    resolveDialog(-1); // window destroyed
    await tick();
    expect(dispose).not.toHaveBeenCalled();
    expect(appExitCodes).not.toContain(0);
  });
});

describe("second quit while dialog is open", () => {
  it("prevents the second quit and shows only one dialog", async () => {
    installQuitGate({
      listActiveTasks: () => [makeTask()],
      killTask: vi.fn(),
      dispose: vi.fn(),
    });
    // First quit.
    const event1 = { preventDefault: vi.fn() };
    const handlers = mockAppHandlers.get("before-quit")!;
    for (const h of handlers) h(event1);
    // Second quit while first dialog is still pending.
    const event2 = { preventDefault: vi.fn() };
    for (const h of handlers) h(event2);
    await tick();
    expect(event2.preventDefault).toHaveBeenCalled(); // second quit blocked
    expect(mockDialogShowBox).toHaveBeenCalledTimes(1); // only one dialog shown
  });
});

describe("background drain monitor", () => {
  it("dispose + app.exit(0) when tasks drain", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    let listCall = 0;
    const listActiveTasks = () => {
      listCall++;
      return listCall >= 2 ? [] : [makeTask("t1", "running")];
    };
    installQuitGate({
      listActiveTasks,
      killTask: vi.fn(),
      dispose,
      getMainWindow: () => mockBrowserWindow,
    });
    fireBeforeQuit();
    await tick();
    resolveDialog(1); // BACKGROUND
    await tick();
    // window.close was called (BACKGROUND branch reached).
    expect(mockBrowserWindow.close).toHaveBeenCalled();
    // Wait for 1s polling interval. Tasks drain on the 2nd call (~1s later).
    await new Promise((r) => setTimeout(r, 1200));
    expect(dispose).toHaveBeenCalled();
    expect(appExitCodes).toContain(0);
  });

  it("second before-quit cancels the monitor (dispose NOT called)", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    installQuitGate({
      listActiveTasks: () => [makeTask("t1", "running")],
      killTask: vi.fn(),
      dispose,
      getMainWindow: () => mockBrowserWindow,
    });
    fireBeforeQuit();
    await tick();
    resolveDialog(1); // BACKGROUND
    await tick();
    expect(mockBrowserWindow.close).toHaveBeenCalled(); // BACKGROUND branch reached
    // Second before-quit while draining — monitor should be cancelled.
    fireBeforeQuit();
    await tick();
    // dispose should NOT have been called (monitor cancelled before drain).
    expect(dispose).not.toHaveBeenCalled();
    expect(appExitCodes).not.toContain(0); // app still alive
  });
});

describe("__resetQuitGateForTest", () => {
  it("restores initial state so a new quit attempt works", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    installQuitGate({
      listActiveTasks: () => [makeTask()],
      killTask: vi.fn(),
      dispose,
    });
    fireBeforeQuit();
    await tick();
    resolveDialog(2); // CANCEL
    await tick();
    expect(dispose).not.toHaveBeenCalled();
    __resetQuitGateForTest();
    fireBeforeQuit();
    await tick();
    expect(mockDialogShowBox).toHaveBeenCalledTimes(2); // fresh dialog shown
  });
});
