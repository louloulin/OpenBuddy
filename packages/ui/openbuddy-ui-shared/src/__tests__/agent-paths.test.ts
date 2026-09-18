/**
 * agent-paths / useAgentPaths 单测(R95)。
 *
 * 背景:renderer 侧有 40+ 处文案写着 `~/.pi/...`,但 OpenBuddy 的 agent 根是
 * `~/.openbuddy/agent`(@openbuddy/storage 的 `agentHome()`)。用户照着文案去翻
 * 目录只会扑空。这两个模块是 renderer 侧的**唯一真源**。
 *
 * 本测试锁住的契约:
 *   - 没有桥 → 兜底常量(而非 undefined / 崩溃)
 *   - 有 `agent:paths` → 直接用 main 给的全量快照
 *   - 没有 `agent:paths`(旧 preload)→ 退回 `mcp:config-path` 的 dirname
 *   - 两条路都失败 → 兜底常量
 *   - 结果缓存(第二次不再打 IPC)
 *   - `useAgentPaths()` 首帧兜底、回话后切真实值,`resolved` 标志跟随
 *   - **绝不产出 `~/.pi`** —— 这是本单元存在的理由
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AGENTS_DISPLAY_FALLBACK,
  FALLBACK_AGENT_HOME,
  FALLBACK_USER_AGENTS,
  MCP_CONFIG_DISPLAY_FALLBACK,
  PLUGINS_DISPLAY_FALLBACK,
  USER_AGENTS_DISPLAY_FALLBACK,
  agentsDisplayFrom,
  extensionInstallDisplayFrom,
  pluginsDisplayFrom,
  resolveAgentHomeAbsolute,
  resolveAgentHomeDisplay,
  resolveAgentPathsSnapshot,
  resetAgentPathsCacheForTests,
  type AgentPathsSnapshot,
} from "../agent-paths";
import { useAgentPaths } from "../use-agent-paths";

const SNAPSHOT: AgentPathsSnapshot = {
  home: "/Users/tester/.openbuddy/agent",
  homeDisplay: "~/.openbuddy/agent",
  // Flat layout: agents is the sibling of home, not a subdir.
  agents: "/Users/tester/.openbuddy/agents",
  agentsDisplay: "~/.openbuddy/agents",
  experts: "/Users/tester/.openbuddy/agent/experts",
  mcpConfig: "/Users/tester/.openbuddy/agent/mcp.json",
  models: "/Users/tester/.openbuddy/agent/models.json",
  auth: "/Users/tester/.openbuddy/agent/auth.json",
  sessions: "/Users/tester/.openbuddy/agent/sessions",
  extensions: "/Users/tester/.openbuddy/agent/node_modules",
  plugins: "/Users/tester/.openbuddy/agent/plugins",
  fromEnv: false,
};

type Invoke = (channel: string, args?: unknown) => Promise<unknown>;

function installBridge(invoke: Invoke): void {
  (globalThis as { api?: { invoke: Invoke } }).api = { invoke };
}

function removeBridge(): void {
  delete (globalThis as { api?: unknown }).api;
}

beforeEach(() => {
  resetAgentPathsCacheForTests();
  removeBridge();
});

afterEach(async () => {
  removeBridge();
  resetAgentPathsCacheForTests();
  await act(async () => { await Promise.resolve(); });
});

describe("兜底常量", () => {
  it("指向 ~/.openbuddy/agent + ~/.openbuddy/agents,而不是 ~/.pi", () => {
    expect(FALLBACK_AGENT_HOME).toBe("~/.openbuddy/agent");
    // Flat user-agents path is the **canonical** default, not <home>/agents.
    expect(FALLBACK_USER_AGENTS).toBe("~/.openbuddy/agents");
    expect(USER_AGENTS_DISPLAY_FALLBACK).toBe("~/.openbuddy/agents");
    expect(MCP_CONFIG_DISPLAY_FALLBACK).toBe("~/.openbuddy/agent/mcp.json");
    // 扩展装在 <agentHome>/node_modules(见 pi-extension-discovery.ts)。
    expect(extensionInstallDisplayFrom(FALLBACK_AGENT_HOME)).toBe("~/.openbuddy/agent/node_modules");
    expect(PLUGINS_DISPLAY_FALLBACK).toBe("~/.openbuddy/agent/plugins");
    // 任何一个兜底值都不许出现 `.pi/`,且 agents 的扁平值不能等于
    // <home>/agents(那样就把 SDK 的嵌套扫描路径当成默认了)。
    for (const value of [
      FALLBACK_AGENT_HOME,
      FALLBACK_USER_AGENTS,
      USER_AGENTS_DISPLAY_FALLBACK,
      MCP_CONFIG_DISPLAY_FALLBACK,
      PLUGINS_DISPLAY_FALLBACK,
      extensionInstallDisplayFrom(FALLBACK_AGENT_HOME),
    ]) {
      expect(value).not.toMatch(/~\/\.pi\//);
    }
    expect(FALLBACK_USER_AGENTS).not.toBe(AGENTS_DISPLAY_FALLBACK);
  });

  it("子路径派生不做双斜杠拼接", () => {
    expect(agentsDisplayFrom("~/.openbuddy/agent/")).toBe("~/.openbuddy/agent/agents");
    expect(pluginsDisplayFrom("/tmp/home/agent")).toBe("/tmp/home/agent/plugins");
  });
});

describe("resolveAgentPathsSnapshot", () => {
  it("没有桥时返回 null(调用方回落到常量)", async () => {
    expect(await resolveAgentPathsSnapshot()).toBeNull();
    expect(await resolveAgentHomeDisplay()).toBe(FALLBACK_AGENT_HOME);
    expect(await resolveAgentHomeAbsolute()).toBeNull();
  });

  it("优先消费 agent:paths 的全量快照", async () => {
    const invoke = vi.fn<Invoke>().mockResolvedValue(SNAPSHOT);
    installBridge(invoke);
    const snapshot = await resolveAgentPathsSnapshot();
    expect(snapshot).toEqual(SNAPSHOT);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]![0]).toBe("agent:paths");
  });

  it("agent:paths 不可用时退回 mcp:config-path 的 dirname", async () => {
    const invoke = vi.fn<Invoke>(async (channel) => {
      if (channel === "agent:paths") throw new Error("No handler registered for 'agent:paths'");
      if (channel === "mcp:config-path") return "/Users/tester/.openbuddy/agent/mcp.json";
      throw new Error(`unexpected channel ${channel}`);
    });
    installBridge(invoke);
    const snapshot = await resolveAgentPathsSnapshot();
    expect(snapshot?.home).toBe("/Users/tester/.openbuddy/agent");
    expect(snapshot?.plugins).toBe("/Users/tester/.openbuddy/agent/plugins");
    expect(snapshot?.extensions).toBe("/Users/tester/.openbuddy/agent/node_modules");
    // 兼容路径下,agentsDisplay 留空表示"未告知真实扁平路径"。
    expect(snapshot?.agentsDisplay).toBe("");
    expect(snapshot?.agents).toBe("/Users/tester/.openbuddy/agent/agents");
    // 兼容路径只能自己拼,所以 fromEnv 只能是保守的 false。
    expect(snapshot?.fromEnv).toBe(false);
  });

  it("agent:paths 返回形状不对时也走兼容路径", async () => {
    const invoke = vi.fn<Invoke>(async (channel) => {
      if (channel === "agent:paths") return { oops: true };
      return "/Users/tester/.openbuddy/agent/mcp.json";
    });
    installBridge(invoke);
    expect((await resolveAgentPathsSnapshot())?.home).toBe("/Users/tester/.openbuddy/agent");
  });

  it("两条路都失败时返回 null,不抛错", async () => {
    installBridge(vi.fn<Invoke>().mockRejectedValue(new Error("bridge down")));
    expect(await resolveAgentPathsSnapshot()).toBeNull();
  });

  it("结果被缓存:第二次调用不再打 IPC", async () => {
    const invoke = vi.fn<Invoke>().mockResolvedValue(SNAPSHOT);
    installBridge(invoke);
    await resolveAgentPathsSnapshot();
    await resolveAgentPathsSnapshot();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("并发调用只打一次 IPC(inflight 去重)", async () => {
    const invoke = vi.fn<Invoke>().mockResolvedValue(SNAPSHOT);
    installBridge(invoke);
    const [a, b, c] = await Promise.all([
      resolveAgentPathsSnapshot(),
      resolveAgentPathsSnapshot(),
      resolveAgentPathsSnapshot(),
    ]);
    expect(a).toEqual(SNAPSHOT);
    expect(b).toEqual(SNAPSHOT);
    expect(c).toEqual(SNAPSHOT);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe("useAgentPaths", () => {
  it("首帧先给兜底常量(resolved=false),不渲染 undefined", () => {
    installBridge(vi.fn<Invoke>().mockReturnValue(new Promise(() => {})));
    const { result, unmount } = renderHook(() => useAgentPaths());
    expect(result.current.resolved).toBe(false);
    expect(result.current.home).toBe(FALLBACK_AGENT_HOME);
    // 扁平用户代理路径才是产品说明书告诉用户的内容。
    expect(result.current.agents).toBe(FALLBACK_USER_AGENTS);
    unmount();
  });

  it("桥回话后切成真实路径并置 resolved", async () => {
    installBridge(vi.fn<Invoke>().mockResolvedValue(SNAPSHOT));
    const { result, unmount } = renderHook(() => useAgentPaths());
    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(result.current.home).toBe("~/.openbuddy/agent");
    expect(result.current.plugins).toBe("~/.openbuddy/agent/plugins");
    // agents 来自 snapshot.agentsDisplay(扁平 ~/),不是 <home>/agents。
    expect(result.current.agents).toBe("~/.openbuddy/agents");
    unmount();
  });

  it("没有桥时永远停在兜底(resolved=false),不崩溃", async () => {
    const { result, unmount } = renderHook(() => useAgentPaths());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.resolved).toBe(false);
    expect(result.current.home).toBe(FALLBACK_AGENT_HOME);
    expect(result.current.agents).toBe(FALLBACK_USER_AGENTS);
    unmount();
  });
});
