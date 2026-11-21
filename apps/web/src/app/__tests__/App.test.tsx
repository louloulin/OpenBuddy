import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import App from "../App";
import type { OpenBuddyBridge } from "@openbuddy/client/ipc";

vi.mock("@/shared/security/sandbox-init", () => ({ tryActivateSandbox: async () => ({ activated: false }) }));

afterEach(() => { delete window.openbuddy; });

describe("Electron first launch", () => {
  it("renders the setup composer without BYOK and requests no deferred features", async () => {
    const requests: string[] = [];
    const auth = { ready: false, hasAuthFile: false, providers: [] };
    const bridge: OpenBuddyBridge = {
      invoke: async command => {
        requests.push(command);
        switch (command) {
          case "agent_init": return { ok: false, auth, cwd: "/app/pi/inbox" };
          case "agent_auth_status": return auth;
          case "agent_list_sessions": case "agent_list_workspaces": case "commands_list": return [];
          case "providers_list": return { providers: [], models: [] };
          case "permission_mode_get": return "ask";
          case "host_capabilities": return { protocolVersion: 1, platform: "desktop", commands: ["host_capabilities"], events: [], features: [] };
          default: throw new Error(`Unexpected startup request: ${command}`);
        }
      },
      listen: () => () => {},
      dialog: { open: async () => null, save: async () => null, ask: async () => false },
      window: { minimize: async () => {}, toggleMaximize: async () => {}, close: async () => {}, isMaximized: async () => false, onResized: () => () => {} },
      getPathForFile: file => file.name,
    };
    window.openbuddy = bridge;
    render(<App />);
    expect(await screen.findByText("请先配置 API Key 开始使用")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeDisabled();
    await waitFor(() => expect(requests).toContain("providers_list"));
    // 运行中 (W4.5): the sidebar asks for running tasks on mount; it stays empty here.
    expect(requests.filter(command => command === "tasks_list")).toEqual(["tasks_list"]);
    expect(requests.filter(command => /experts|automations|agents_list|team_|marketplace|plugins|memory|prompt_history/.test(command))).toEqual([]);
    // pii W0.1: capabilities are read once at startup.
    expect(requests.filter(command => command === "host_capabilities")).toEqual(["host_capabilities"]);
    expect(screen.queryByText(/未就绪/)).toBeNull();
    expect(screen.getByRole("textbox")).toHaveAttribute("placeholder", "");
    fireEvent.click(screen.getByRole("button", { name: "请先配置 API Key 开始使用" }));
    expect(await screen.findByRole("dialog", { name: "设置" })).toBeInTheDocument();
  });
});
