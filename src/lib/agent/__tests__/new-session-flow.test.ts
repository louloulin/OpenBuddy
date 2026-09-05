/**
 * newSessionFlow — orchestrator tests.
 *
 * The flow is a pure async function; it composes:
 *  - the supersede guard (`awaitPendingNewSession` re-await recovery)
 *  - the test-pinned `migrateSession` × 2 (sessions-store.test.ts:107-158
 *    + session-store.test.ts:84-104)
 *  - expert-persona wrapping (`piSetSessionExpert` + EXPERT_PERSONA markers)
 *  - project-conversation registration + first-conversation pre-wrap
 *  - the final `piSend(realId, text)`
 *
 * All four collaborators (`migrateSession`, `piSetSessionExpert`,
 * `piSend`, store action subscriptions) are mocked so we can drive the
 * flow deterministically without an Electron IPC round-trip.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  newSessionFlow,
  composeDiscoverBody,
  PlaceholderNeverResolvedError,
} from "../new-session-flow";
import { useSessionStore } from "@/stores/session-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { usePendingExpertStore } from "@/stores/pending-expert-store";
import { useProjectsStore } from "@/stores/projects-store";

// Mock pi-client — we don't want a real Electron round-trip in unit tests.
vi.mock("@/lib/agent/pi-client", () => ({
  piSend: vi.fn().mockResolvedValue(undefined),
  piSetSessionExpert: vi.fn().mockResolvedValue(undefined),
}));

import { piSend, piSetSessionExpert } from "@/lib/agent/pi-client";

function resetStores() {
  useSessionStore.setState({
    sessionId: null,
    streaming: false,
    planMode: false,
    optimisticBubble: null,
    error: null,
    messages: [],
    streamingMessageId: null,
    plan: null,
  });
  useSessionsStore.setState({
    independent: [],
    workspaces: [],
    workspaceSessions: {},
    tasksOpen: true,
    spacesOpen: true,
    expanded: {},
    homeCwd: "",
    currentSessionId: null,
    loading: false,
    error: null,
    query: "",
    drafts: {},
  });
  usePendingExpertStore.setState({ expert: null });
  useProjectsStore.setState({ projects: [], activeProjectId: null });
}

/**
 * Simulate the optimistic store flips that `useOptimisticNewSession
 * .ensureNewSession` performs *before* the IPC awaits the real id.
 * `migrateSession` is guarded by `s.sessionId === oldId`, so without
 * these flips the migration is a no-op.
 */
function adoptPending(pendingId: string) {
  useSessionStore.setState({ sessionId: pendingId });
  useSessionsStore.setState({ currentSessionId: pendingId });
}

beforeEach(() => {
  resetStores();
  vi.clearAllMocks();
});

describe("newSessionFlow", () => {
  it("happy path: realId arrives, migrate + piSend fire once", async () => {
    const awaitPending = vi.fn().mockResolvedValue(null);
    const pendingId = "__pending_1";
    adoptPending(pendingId);
    const result = await newSessionFlow({
      pendingId,
      promise: Promise.resolve("real-42"),
      text: "hello",
      cwd: "/home/user/proj",
      flowDeps: { awaitPendingNewSession: awaitPending },
    });
    expect(result.realId).toBe("real-42");
    // Migration runs on both stores — the test-pinned contract.
    expect(useSessionStore.getState().sessionId).toBe("real-42");
    expect(useSessionsStore.getState().currentSessionId).toBe("real-42");
    // Pi IPC fires with the migrated realId.
    expect(piSend).toHaveBeenCalledTimes(1);
    expect(piSend).toHaveBeenCalledWith("real-42", "hello");
    // No persona / project wrapping, so no expert IPC.
    expect(piSetSessionExpert).not.toHaveBeenCalled();
    // Supersede was a no-op (awaitPending would only run on a pending id).
    expect(awaitPending).not.toHaveBeenCalled();
  });

  it("supersede: first promise resolves to pending, awaitPending recovers", async () => {
    const awaitPending = vi.fn().mockResolvedValue("real-final");
    const pendingId = "__pending_1";
    adoptPending(pendingId);
    // Simulate the supersede path — the original Promise resolves to a
    // *stale* pending id (a newer caller already overwrote the in-flight
    // record).
    const result = await newSessionFlow({
      pendingId,
      promise: Promise.resolve("__pending_2"),
      text: "hello",
      cwd: "/home/user/proj",
      flowDeps: { awaitPendingNewSession: awaitPending },
    });
    expect(result.realId).toBe("real-final");
    expect(awaitPending).toHaveBeenCalledTimes(1);
    expect(piSend).toHaveBeenCalledWith("real-final", "hello");
  });

  it("placeholder-never-resolves: throws PlaceholderNeverResolvedError", async () => {
    const awaitPending = vi.fn().mockResolvedValue(null);
    adoptPending("__pending_1");
    await expect(
      newSessionFlow({
        pendingId: "__pending_1",
        promise: Promise.resolve("__pending_2"),
        text: "hello",
        cwd: "/home/user/proj",
        flowDeps: { awaitPendingNewSession: awaitPending },
      }),
    ).rejects.toBeInstanceOf(PlaceholderNeverResolvedError);
    // Migration should NOT have run — no real id to migrate to.
    expect(piSend).not.toHaveBeenCalled();
  });

  it("persona wrapping: EXPERT_PERSONA markers wrap text, piSetSessionExpert fires", async () => {
    adoptPending("__pending_1");
    const result = await newSessionFlow({
      pendingId: "__pending_1",
      promise: Promise.resolve("real-42"),
      text: "用户问题",
      cwd: "/home/user/proj",
      flowDeps: {
        awaitPendingNewSession: vi.fn().mockResolvedValue(null),
        persona: {
          expertId: "exp-1",
          name: "专家甲",
          source: "local",
          prompt: "你是一位资深架构师",
        },
      },
    });
    expect(result.realId).toBe("real-42");
    expect(piSetSessionExpert).toHaveBeenCalledWith(
      "real-42",
      "exp-1",
      "专家甲",
      "local",
      undefined,
    );
    expect(piSend).toHaveBeenCalledTimes(1);
    const sentText = vi.mocked(piSend).mock.calls[0][1];
    expect(sentText).toContain("<!--EXPERT_PERSONA_BEGIN-->");
    expect(sentText).toContain("<!--EXPERT_PERSONA_END-->");
    expect(sentText).toContain("你是一位资深架构师");
    expect(sentText).toContain("用户问题");
    // Pending expert store should be cleared so the next session starts fresh.
    expect(usePendingExpertStore.getState().expert).toBeNull();
  });

  it("project wrapping: registers conversation + first-conversation pre-wrap", async () => {
    adoptPending("__pending_1");
    useProjectsStore.setState({
      projects: [
        {
          id: "proj-1",
          name: "AI助手",
          cwd: "/home/user/proj",
          instructions: "用中文回答",
          connectors: [],
          experts: [],
          skills: [],
          plans: [],
          tasks: [],
          assets: [],
          dataSources: [],
          members: [],
          activities: [],
          conversations: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      activeProjectId: null,
    });
    await newSessionFlow({
      pendingId: "__pending_1",
      promise: Promise.resolve("real-42"),
      text: "开始吧",
      cwd: "/home/user/proj",
      flowDeps: {
        awaitPendingNewSession: vi.fn().mockResolvedValue(null),
        projectSeed: {
          id: "proj-1",
          name: "AI助手",
          instructions: "用中文回答",
        },
        registerProjectConversation: true,
      },
    });
    // First conversation was registered.
    const projects = useProjectsStore.getState().projects;
    expect(projects[0].conversations.length).toBe(1);
    expect(projects[0].conversations[0].sessionId).toBe("real-42");
    // Pre-wrap landed in the sent text.
    const sentText = vi.mocked(piSend).mock.calls[0][1];
    expect(sentText).toContain("项目「AI助手」背景与规范");
    expect(sentText).toContain("用中文回答");
    expect(sentText).toContain("开始吧");
  });

  it("project wrapping: non-first conversation does NOT pre-wrap", async () => {
    adoptPending("__pending_1");
    useProjectsStore.setState({
      projects: [
        {
          id: "proj-1",
          name: "AI助手",
          cwd: "/home/user/proj",
          instructions: "用中文回答",
          // Two existing conversations — this is the THIRD, so no pre-wrap.
          conversations: [
            { sessionId: "x", title: "t1", createdAt: new Date().toISOString() },
            { sessionId: "y", title: "t2", createdAt: new Date().toISOString() },
          ],
          connectors: [],
          experts: [],
          skills: [],
          plans: [],
          tasks: [],
          assets: [],
          dataSources: [],
          members: [],
          activities: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      activeProjectId: null,
    });
    await newSessionFlow({
      pendingId: "__pending_1",
      promise: Promise.resolve("real-42"),
      text: "再来一个",
      cwd: "/home/user/proj",
      flowDeps: {
        awaitPendingNewSession: vi.fn().mockResolvedValue(null),
        projectSeed: { id: "proj-1", name: "AI助手", instructions: "用中文回答" },
        registerProjectConversation: true,
      },
    });
    const projects = useProjectsStore.getState().projects;
    expect(projects[0].conversations.length).toBe(3); // +1 from register
    const sentText = vi.mocked(piSend).mock.calls[0][1];
    expect(sentText).not.toContain("项目「AI助手」背景与规范");
    expect(sentText).toBe("再来一个");
  });

  it("persona + project: both wrappers compose in the correct order", async () => {
    adoptPending("__pending_1");
    useProjectsStore.setState({
      projects: [
        {
          id: "proj-1",
          name: "AI助手",
          cwd: "/home/user/proj",
          instructions: "用中文",
          conversations: [],
          connectors: [],
          experts: [],
          skills: [],
          plans: [],
          tasks: [],
          assets: [],
          dataSources: [],
          members: [],
          activities: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      activeProjectId: null,
    });
    await newSessionFlow({
      pendingId: "__pending_1",
      promise: Promise.resolve("real-42"),
      text: "你好",
      cwd: "/home/user/proj",
      flowDeps: {
        awaitPendingNewSession: vi.fn().mockResolvedValue(null),
        persona: { expertId: "e", name: "n", source: "s", prompt: "p" },
        projectSeed: { id: "proj-1", name: "AI助手", instructions: "用中文" },
        registerProjectConversation: true,
      },
    });
    const sentText = vi.mocked(piSend).mock.calls[0][1];
    expect(sentText).toContain("<!--EXPERT_PERSONA_BEGIN-->");
    expect(sentText).toContain("项目「AI助手」背景与规范");
    expect(sentText).toContain("用中文");
    expect(sentText).toContain("你好");
  });

  it("propagates piSend errors (caller catches + rolls back)", async () => {
    adoptPending("__pending_1");
    vi.mocked(piSend).mockRejectedValueOnce(new Error("network down"));
    await expect(
      newSessionFlow({
        pendingId: "__pending_1",
        promise: Promise.resolve("real-42"),
        text: "hello",
        cwd: "/home/user/proj",
        flowDeps: { awaitPendingNewSession: vi.fn().mockResolvedValue(null) },
      }),
    ).rejects.toThrow("network down");
    // Migration already ran — caller is responsible for cleanup on error.
    expect(useSessionStore.getState().sessionId).toBe("real-42");
  });
});

describe("composeDiscoverBody", () => {
  it("returns the bare prompt when no agent is supplied", () => {
    expect(composeDiscoverBody("hello")).toBe("hello");
  });

  it("wraps the prompt with a role-prompt preamble when an agent is supplied", () => {
    const agent = {
      name: "专家甲",
      description: "简介",
      scope: "user",
      raw: undefined,
    } as Parameters<typeof composeDiscoverBody>[1];
    const body = composeDiscoverBody("用户问题", agent);
    expect(body).toContain("【角色设定 — 专家甲】");
    expect(body).toContain("简介");
    expect(body).toContain("用户的第一个问题：");
    expect(body).toContain("用户问题");
  });

  it("strips YAML frontmatter when raw is present", () => {
    const agent = {
      name: "X",
      description: "",
      scope: "user",
      raw: "---\nname: X\n---\n\nactual body",
    } as Parameters<typeof composeDiscoverBody>[1];
    const body = composeDiscoverBody("q", agent);
    expect(body).toContain("actual body");
    expect(body).not.toContain("name: X");
  });
});