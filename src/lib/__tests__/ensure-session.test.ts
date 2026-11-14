import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSession } from "../ensure-session";
import { agentGetModelState, agentNewSession } from "@openbuddy/client/agent-client";
import { useSessionStore } from "@/stores/session-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { useAgentModelStore } from "@/stores/agent-model-store";

vi.mock("@openbuddy/client/agent-client", () => ({ agentNewSession: vi.fn(), agentGetModelState: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  useSessionStore.setState({ sessionId: null, transcripts: {} });
  useSessionsStore.getState().setHomeCwd("/workspace");
  useAgentModelStore.setState({ homeModelKey: "model:p/shared", states: {} });
});
describe("ensureSession", () => {
  it("shares concurrent creation using the selected home model and caches actual runtime state", async () => {
    let finish!: (sessionId: string) => void;
    vi.mocked(agentNewSession).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const state = { sessionId: "new", providerId: "p", modelId: "shared", modelKey: "model:p/shared", thinkingLevel: "off", availableThinkingLevels: ["off"] };
    vi.mocked(agentGetModelState).mockResolvedValue(state);
    const first = ensureSession(); const second = ensureSession();
    expect(agentNewSession).toHaveBeenCalledTimes(1);
    expect(agentNewSession).toHaveBeenCalledWith("/workspace", "model:p/shared");
    finish("new");
    expect(await Promise.all([first, second])).toEqual(["new", "new"]);
    expect(useAgentModelStore.getState().states.new).toEqual(state);
  });
  it("releases a failed creation so the user can retry", async () => {
    vi.mocked(agentNewSession).mockRejectedValueOnce(new Error("offline")).mockResolvedValue("retry");
    vi.mocked(agentGetModelState).mockResolvedValue({ sessionId: "retry", providerId: "p", modelId: "shared", modelKey: "model:p/shared", thinkingLevel: "off", availableThinkingLevels: ["off"] });
    await expect(ensureSession()).rejects.toThrow("offline");
    await expect(ensureSession()).resolves.toBe("retry");
  });
});
