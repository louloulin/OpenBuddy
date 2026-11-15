import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { OpenBuddyBridge } from "@openbuddy/client/ipc";
import { loadCapabilities, useCapabilitiesStore, useCapability, useEvent } from "../capabilities-store";

const caps = { protocolVersion: 1, platform: "desktop", commands: ["host_capabilities", "skills_list", "session_search"], events: ["agent://event"], features: [] };
function install(invoke: OpenBuddyBridge["invoke"]) {
  window.openbuddy = {
    invoke,
    listen: () => () => {},
    dialog: { open: async () => null, save: async () => null, ask: async () => false },
    window: { minimize: async () => {}, toggleMaximize: async () => {}, close: async () => {}, isMaximized: async () => false, onResized: () => () => {} },
    getPathForFile: (file) => file.name,
  };
}
function Probe({ command, event }: { command: string; event?: string }) {
  const has = useCapability(command);
  const hasEvent = useEvent(event ?? "agent://none");
  return <span data-testid="probe">{`${command}:${has}|${event ?? "-"}:${hasEvent}`}</span>;
}
beforeEach(() => useCapabilitiesStore.setState({ status: "idle", platform: undefined, commands: new Set(), events: new Set() }));
afterEach(() => { delete window.openbuddy; });

describe("useCapability / useEvent (pii W0.1)", () => {
  it("is false while host_capabilities is loading, then follows the host's answer", async () => {
    let resolve!: (value: unknown) => void;
    install(vi.fn(() => new Promise((r) => { resolve = r; })));
    render(<Probe command="session_search" event="agent://event" />);
    expect(screen.getByTestId("probe")).toHaveTextContent("session_search:false|agent://event:false");
    await waitFor(() => expect(useCapabilitiesStore.getState().status).toBe("loading"));
    await act(async () => resolve(caps));
    expect(screen.getByTestId("probe")).toHaveTextContent("session_search:true|agent://event:true");
  });

  it("is false for a command or event the host does not serve", async () => {
    install(vi.fn(async () => caps));
    render(<Probe command="automations_snapshot" event="agent://plan" />);
    await waitFor(() => expect(useCapabilitiesStore.getState().status).toBe("ready"));
    expect(screen.getByTestId("probe")).toHaveTextContent("automations_snapshot:false|agent://plan:false");
  });

  it("is false everywhere in a browser-only preview (no bridge) or when the host cannot answer", async () => {
    render(<Probe command="skills_list" />);
    await waitFor(() => expect(useCapabilitiesStore.getState().status).toBe("unavailable"));
    expect(screen.getByTestId("probe")).toHaveTextContent("skills_list:false");
    install(vi.fn(async () => { throw new Error("not_implemented: host_capabilities"); }));
    await act(() => loadCapabilities(true));
    expect(useCapabilitiesStore.getState().status).toBe("unavailable");
    expect(screen.getByTestId("probe")).toHaveTextContent("skills_list:false");
  });

  it("fetches once at startup however many components ask", async () => {
    const invoke = vi.fn(async () => caps);
    install(invoke);
    render(<><Probe command="skills_list" /><Probe command="session_search" /><Probe command="x" /></>);
    await waitFor(() => expect(useCapabilitiesStore.getState().status).toBe("ready"));
    await act(() => loadCapabilities());
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("host_capabilities", undefined);
  });
});
