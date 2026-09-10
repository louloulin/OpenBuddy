import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ reload: vi.fn(), listeners: new Map<string, (payload: unknown) => void>() }));
vi.mock("@/lib/agent/pi-client", () => ({ reloadPiExtensions: mocks.reload }));
vi.mock("@/lib/runtime/renderer-plugin-runtime", () => ({
  getRendererPluginRuntime: () => ({ events: { on: (type: string, handler: (payload: unknown) => void) => { mocks.listeners.set(type, handler); return () => mocks.listeners.delete(type); } } }),
}));
import { PiReloadFailureBanner } from "../PiReloadFailureBanner";

describe("PiReloadFailureBanner", () => {
  beforeEach(() => { mocks.reload.mockReset(); mocks.listeners.clear(); });
  it("renders failure state and clears after the real reload adapter succeeds", async () => {
    mocks.reload.mockResolvedValue([]);
    render(<PiReloadFailureBanner />);
    act(() => { mocks.listeners.get("renderer/pi-reload-failed")?.({ reason: "profile", error: "broken", generation: 2 }); });
    expect(screen.getByTestId("pi-reload-failure")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId("pi-reload-retry")); });
    expect(mocks.reload).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId("pi-reload-failure")).toBeNull());
  });
  it("deduplicates clicks while retrying and exposes a retry failure", async () => {
    let resolve!: (value: unknown[]) => void;
    mocks.reload.mockImplementation(() => new Promise((r) => { resolve = r; }));
    render(<PiReloadFailureBanner />);
    act(() => { mocks.listeners.get("renderer/pi-reload-failed")?.({ reason: "profile", error: "broken" }); });
    fireEvent.click(screen.getByTestId("pi-reload-retry"));
    fireEvent.click(screen.getByTestId("pi-reload-retry"));
    expect(mocks.reload).toHaveBeenCalledTimes(1);
    await act(async () => { resolve([]); });
    await waitFor(() => expect(screen.queryByTestId("pi-reload-failure")).toBeNull());
  });
  it("keeps the affordance visible after reload failure", async () => {
    mocks.reload.mockRejectedValue(new Error("still broken"));
    render(<PiReloadFailureBanner />);
    act(() => { mocks.listeners.get("renderer/pi-reload-failed")?.({ reason: "profile", error: "broken" }); });
    await act(async () => { fireEvent.click(screen.getByTestId("pi-reload-retry")); });
    await waitFor(() => expect(screen.getByText("Error: still broken")).toBeTruthy());
    expect(screen.getByTestId("pi-reload-retry")).not.toBeDisabled();
  });
});
