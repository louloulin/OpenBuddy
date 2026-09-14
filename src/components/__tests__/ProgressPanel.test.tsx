import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  liveHandler: undefined as ((event: unknown) => void) | undefined,
  history: [] as unknown[],
  snapshot: [] as unknown[],
  cancel: vi.fn(async () => undefined),
  retry: vi.fn(async () => undefined),
}));

vi.mock("../../lib/agent/pi-client", () => ({
  agentOnPluginEvent: vi.fn(async (handler: (event: unknown) => void) => {
    state.liveHandler = handler;
    return () => {
      if (state.liveHandler === handler) state.liveHandler = undefined;
    };
  }),
  agentPluginEvents: vi.fn(async () => state.history),
  progressRunsGet: vi.fn(async () => state.snapshot),
  progressRunCancel: state.cancel,
  progressRunRetry: state.retry,
}));

vi.mock("../../lib/agent/progress-runs", () => ({
  handleProgressEvent: vi.fn((event: { type?: string; payload?: unknown }) => {
    const payload = event.payload as Record<string, unknown> | undefined;
    return payload?.runId ? payload : null;
  }),
}));

const { ProgressPanel } = await import("../ProgressPanel");

type Run = {
  runId: string;
  taskId: string;
  stage: string;
  percent: number | null;
  recentEvent: string;
  status: "running" | "cancelled" | "failed" | "completed";
  startedAt: number;
  updatedAt: number;
  error?: string;
};

function run(overrides: Partial<Run> = {}): Run {
  return {
    runId: "run-1",
    taskId: "task-1",
    stage: "working",
    percent: 42,
    recentEvent: "tool started",
    status: "running",
    startedAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe("ProgressPanel", () => {
  beforeEach(() => {
    state.liveHandler = undefined;
    state.history = [];
    state.snapshot = [];
    state.cancel.mockClear();
    state.retry.mockClear();
  });

  afterEach(() => vi.clearAllMocks());

  it("renders a live progress event and updates it through success", async () => {
    const current = run();
    state.snapshot = [current];
    render(<ProgressPanel />);
    await waitFor(() => expect(screen.getByTestId("progress-run-run-1")).toBeTruthy());

    act(() => state.liveHandler?.({ type: "progress/update", payload: { ...current, status: "completed", stage: "done", percent: 100, recentEvent: "Task completed" } }));
    expect(await screen.findByText("done")).toBeTruthy();
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("shows failure feedback and invokes cancel/retry controls idempotently", async () => {
    const failed = run({ status: "failed", error: "network failure", recentEvent: "Task failed" });
    state.snapshot = [failed];
    const failedView = render(<ProgressPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("network failure");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry" })); });
    await waitFor(() => expect(state.retry).toHaveBeenCalledWith("run-1"));

    act(() => state.liveHandler?.({ type: "progress/update", payload: run() }));
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Cancel" })); });
    await waitFor(() => expect(state.cancel).toHaveBeenCalledWith("run-1"));
  });

  it("flushes refresh after retry and cancel without stale state", async () => {
    const failed = run({ status: "failed", error: "retryable" }); state.snapshot = [failed]; render(<ProgressPanel />);
    await screen.findByRole("button", { name: "Retry" });
    state.snapshot = [run({ stage: "retried" })];
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry" })); });
    await waitFor(() => expect(screen.getByText("retried")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("restores history after a renderer reconnect and does not mix old run events", async () => {
    const oldRun = run({ runId: "old-run", taskId: "task-old", status: "completed" });
    const current = run({ runId: "run-2", taskId: "task-2", stage: "resumed", percent: null });
    state.history = [{ type: "progress/run", payload: oldRun }, { type: "progress/run", payload: current }];
    state.snapshot = [current];

    const first = render(<ProgressPanel />);
    await waitFor(() => expect(screen.getByTestId("progress-run-run-2")).toBeTruthy());
    expect(screen.queryByTestId("progress-run-old-run")).toBeNull();
    first.unmount();

    render(<ProgressPanel />);
    await waitFor(() => expect(screen.getByTestId("progress-run-run-2")).toBeTruthy());
    expect(screen.queryByTestId("progress-run-old-run")).toBeNull();
    expect(screen.getByText("Working")).toBeTruthy();
  });
});
