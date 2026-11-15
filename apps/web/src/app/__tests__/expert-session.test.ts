import { describe, it, expect, vi, beforeEach } from "vitest";
import { bindPendingExpert, clearSessionExpert, selectExpert, showSessionExpert } from "../expert-session";
import { usePendingExpertStore } from "../../features/experts";
import { useSessionsStore } from "../../features/sessions/state/sessions-store";

const api = vi.hoisted(() => ({
  agentSetSessionExpert: vi.fn(),
  agentClearSessionExpert: vi.fn(async () => true),
}));
vi.mock("@openbuddy/client/agent-client", () => api);

const entry = (id: string) => useSessionsStore.getState().independent.find((s) => s.sessionId === id);

beforeEach(() => {
  usePendingExpertStore.getState().clear();
  useSessionsStore.setState({ independent: [{ sessionId: "s1", title: "t", cwd: "/w" }] });
  api.agentSetSessionExpert.mockImplementation(async (sessionId: string, id: string) => ({ sessionId, id, name: "数据分析师", avatar: "📊", scope: "builtin", applied: {}, warnings: [] }));
});

describe("task ↔ expert glue (pii W2.2/W2.3)", () => {
  it("binds the summoned expert to a new task and mirrors it for the header badge", async () => {
    expect(await bindPendingExpert("s1")).toBeUndefined();
    expect(api.agentSetSessionExpert).not.toHaveBeenCalled();
    usePendingExpertStore.getState().set({ name: "数据分析师", prompt: "", description: "", expertId: "data-analyst", source: "builtin", avatarLocal: "📊" });
    expect(await bindPendingExpert("s1")).toBeUndefined();
    expect(api.agentSetSessionExpert).toHaveBeenCalledWith("s1", "data-analyst");
    expect(usePendingExpertStore.getState().expert).toBeNull();
    expect(entry("s1")).toMatchObject({ expertId: "data-analyst", expertName: "数据分析师", expertAvatar: "📊" });
    expect(await clearSessionExpert("s1")).toMatch(/已移除专家/);
    expect(entry("s1")?.expertName).toBeUndefined();
  });

  it("reports what could not be applied, and failures, without blocking the send", async () => {
    api.agentSetSessionExpert.mockResolvedValueOnce({ sessionId: "s1", id: "x", name: "X", scope: "user", applied: {}, warnings: ["model_unavailable"] });
    usePendingExpertStore.getState().set({ name: "X", prompt: "", description: "", expertId: "x", source: "user" });
    expect(await bindPendingExpert("s1")).toMatch(/模型不可用/);
    api.agentSetSessionExpert.mockRejectedValueOnce(new Error("expert_not_found: 找不到专家：gone"));
    usePendingExpertStore.getState().set({ name: "Gone", prompt: "", description: "", expertId: "gone", source: "user" });
    expect(await bindPendingExpert("s1")).toMatch(/Gone/);
  });

  it("an expert picked in an open task binds now; on the home page it becomes pending", async () => {
    const agent = { id: "translator", name: "翻译官", emoji: "🌐", scope: "builtin", path: "builtin:translator", raw: "" };
    expect(await selectExpert(agent, "s1")).toMatch(/已切换专家/);
    expect(api.agentSetSessionExpert).toHaveBeenCalledWith("s1", "translator");
    expect(await selectExpert(agent, undefined)).toBeUndefined();
    expect(usePendingExpertStore.getState().expert).toMatchObject({ expertId: "translator", avatarLocal: "🌐" });
    showSessionExpert("s1", null);
    expect(entry("s1")?.expertId).toBeUndefined();
  });
});
