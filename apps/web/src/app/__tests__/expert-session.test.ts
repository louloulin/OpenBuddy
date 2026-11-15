import { describe, it, expect, vi, beforeEach } from "vitest";
import { bindPendingExpert, clearSessionExpert, selectExpert, showLoadedExpert, showSessionExpert } from "../expert-session";
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

  it("follows the engine's binding on reload and branch moves, but keeps an old-style injected expert's badge", async () => {
    const bound = { sessionId: "s1", id: "data-analyst", name: "数据分析师", avatar: "📊", scope: "builtin", applied: {}, warnings: [] };
    const user = (text: string) => [{ role: "user", content: [{ type: "text", text }] }, { role: "assistant", content: "ok" }];
    // A bound session: the badge mirrors the binding, and a branch without it (model-state expert: null) clears it.
    showLoadedExpert("s1", { expert: bound, messages: user("hello") });
    expect(entry("s1")).toMatchObject({ expertId: "data-analyst", expertName: "数据分析师" });
    showSessionExpert("s1", null);
    expect(entry("s1")?.expertName).toBeUndefined();

    // Before W2.2 the persona went into the first prompt: no engine binding, the badge stays.
    useSessionsStore.setState({ independent: [{ sessionId: "s2", title: "t", cwd: "/w" }, { sessionId: "s3", title: "t", cwd: "/w", expertName: "法律顾问", expertAvatar: "⚖️" }] });
    showLoadedExpert("s2", { expert: null, messages: user("【角色设定 — 财务专家】请扮演……\n用户的第一个问题：本月预算？") });
    expect(entry("s2")).toMatchObject({ expertId: undefined, expertName: "财务专家" });
    showSessionExpert("s2", null);
    expect(entry("s2")?.expertName).toBe("财务专家");
    // The hidden persona block carries no name: the badge shown so far is kept.
    showLoadedExpert("s3", { expert: null, messages: user("<!--EXPERT_PERSONA_BEGIN-->你是律师<!--EXPERT_PERSONA_END-->\n合同要点") });
    expect(entry("s3")).toMatchObject({ expertName: "法律顾问", expertAvatar: "⚖️" });
    // A session without any expert shows none.
    showLoadedExpert("s1", { expert: null, messages: user("plain") });
    expect(entry("s1")?.expertName).toBeUndefined();
    // × on an old-style badge removes it (nothing was bound in the engine).
    api.agentClearSessionExpert.mockResolvedValueOnce(false);
    await clearSessionExpert("s2");
    expect(entry("s2")?.expertName).toBeUndefined();
  });
});
