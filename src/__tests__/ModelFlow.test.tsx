import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import type { OpenBuddyBridge } from "@/lib/ipc";
import { useAgentModelStore } from "@/stores/agent-model-store";
import { useSessionStore } from "@/stores/session-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { useQuestionStore } from "@/stores/question-store";
import { loadUsage } from "@/lib/usage-quota";
vi.mock("@/lib/sandbox-init", () => ({ tryActivateSandbox: async () => ({ activated: false }) }));
const keyA = "model:a/shared"; const keyB = "model:b/shared";
const state = (sessionId: string, providerId: string) => ({ sessionId, providerId, modelId: "shared", modelKey: `model:${providerId}/shared`, thinkingLevel: providerId === "a" ? "off" : "high", availableThinkingLevels: providerId === "a" ? ["off"] : ["off", "high"] });
beforeEach(() => {
  localStorage.clear();
  useAgentModelStore.setState({ homeModelKey: undefined, states: {} });
  useSessionStore.setState({ sessionId: null, transcripts: {}, messages: [], streaming: false, error: null });
  useSessionsStore.setState({ currentSessionId: null, independent: [], workspaceSessions: {}, drafts: {} });
  useQuestionStore.setState({ queues: {}, notices: {} });
});
afterEach(() => { delete window.openbuddy; });
function fixture() {
  let defaultKey = keyB;
  const listeners = new Map<string, (payload: unknown) => void>();
  const invoke = vi.fn(async (command: string, payload?: unknown): Promise<unknown> => {
    const args = payload as Record<string, unknown>;
    switch (command) {
      case "agent_init": return { ok: true, cwd: "/workspace", defaultModelKey: defaultKey, defaultProviderId: defaultKey === keyA ? "a" : "b", defaultModelId: "shared", auth: { ready: true, providers: ["a", "b"] } };
      case "agent_auth_status": return { ready: true, providers: ["a", "b"] };
      case "providers_list": return { providers: [{ id: "a", label: "Provider A", providerKind: "custom" }, { id: "b", label: "Provider B", providerKind: "custom" }], models: [{ providerId: "a", modelId: "shared", modelKey: keyA }, { providerId: "b", modelId: "shared", modelKey: keyB, reasoning: true }] };
      case "agents_defaults_get": return { defaultModel: defaultKey, defaultPermission: "ask" };
      case "agents_defaults_save": defaultKey = (args.defaults as { defaultModel: string }).defaultModel; return;
      case "agent_list_sessions": return [{ sessionId: "one", title: "Session One", cwd: "/workspace" }, { sessionId: "two", title: "Session Two", cwd: "/workspace" }];
      case "agent_list_workspaces": case "commands_list": return [];
      case "agent_get_queue": case "agent_clear_queue": return { steering: [], followUp: [] };
      case "agent_load_session": case "agent_get_model_state": return state(String(args.sessionId), args.sessionId === "one" ? "a" : "b");
      case "agent_set_model": return state(String(args.sessionId), String(args.providerId));
      case "agent_set_thinking_level": return { ...state(String(args.sessionId), "b"), thinkingLevel: args.level };
      case "permission_mode_get": return "ask";
      case "notification_append": case "agent_resolve_ui": return;
      default: return undefined;
    }
  });
  window.openbuddy = { invoke, listen: (event, callback) => { listeners.set(event, callback); return () => listeners.delete(event); }, dialog: { open: async () => null, save: async () => null, ask: async () => false }, window: { minimize: async () => {}, close: async () => {}, toggleMaximize: async () => {}, isMaximized: async () => false, onResized: () => () => {} }, getPathForFile: file => file.name } satisfies OpenBuddyBridge;
  return { invoke, emit: (event: string, payload: unknown) => act(() => { listeners.get(event)?.(payload); }) };
}
const picker = () => screen.getByRole("button", { name: /选择模型：/ });

describe("App model runtime flow", () => {
  it("restores the configured provider-qualified default after remount", async () => {
    fixture(); const view = render(<App />);
    await waitFor(() => expect(picker()).toHaveAccessibleName(/Provider B/));
    view.unmount(); useAgentModelStore.setState({ homeModelKey: undefined, states: {} }); render(<App />);
    await waitFor(() => expect(picker()).toHaveAccessibleName(/Provider B/));
  });
  it("keeps the confirmed model when saving a new home default fails", async () => {
    const backend = fixture(); render(<App />);
    await waitFor(() => expect(picker()).toHaveAccessibleName(/Provider B/));
    const original = backend.invoke.getMockImplementation()!;
    backend.invoke.mockImplementation((command, args) => command === "agents_defaults_save" ? Promise.reject(new Error("disk error")) : original(command, args));
    fireEvent.click(picker()); fireEvent.click(within(screen.getByRole("group", { name: "Provider A" })).getByRole("option"));
    expect(await screen.findByRole("alert")).toHaveTextContent("disk error");
    expect(picker()).toHaveAccessibleName(/Provider B/);
  });
  it("restores each session model, ignores background model state, and records usage under model identity", async () => {
    const backend = fixture(); render(<App />); await screen.findByText("Session One");
    fireEvent.click(screen.getByText("Session One"));
    await waitFor(() => expect(picker()).toHaveAccessibleName(/Provider A/));
    fireEvent.click(screen.getByText("Session Two"));
    await waitFor(() => expect(picker()).toHaveAccessibleName(/Provider B/));
    backend.emit("agent://model-state", state("one", "a")); expect(picker()).toHaveAccessibleName(/Provider B/);
    expect(screen.getByRole("combobox", { name: "思考等级" })).toHaveValue("high");
    backend.emit("agent://event", { sessionId: "two", event: { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "done" }], usage: { input: 3, output: 2, totalTokens: 5 } } } });
    backend.emit("agent://event", { sessionId: "two", event: { type: "agent_settled" } });
    expect(loadUsage()[0]).toMatchObject({ modelId: keyB, promptTokens: 3, completionTokens: 2 });
  });
  it("keeps an extension input pending for its session when navigating away, without saving the draft", async () => {
    // Sessions keep running in the background pool, so leaving a task must not cancel its pending input.
    const backend = fixture(); render(<App />); fireEvent.click(await screen.findByText("Session One"));
    await waitFor(() => expect(picker()).toHaveAccessibleName(/Provider A/));
    backend.emit("agent://ui-request", { requestId: "secret", sessionId: "one", kind: "input", title: "API Key" });
    fireEvent.change(screen.getByLabelText("API Key", { selector: "input" }), { target: { value: "private-key" } });
    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
    await waitFor(() => expect(screen.queryByLabelText("API Key", { selector: "input" })).toBeNull());
    expect(backend.invoke).not.toHaveBeenCalledWith("agent_resolve_ui", expect.anything());
    expect(useQuestionStore.getState().queues.one?.map(request => request.requestId)).toEqual(["secret"]);
    expect(JSON.stringify(useSessionStore.getState().transcripts)).not.toContain("private-key");
  });
});
