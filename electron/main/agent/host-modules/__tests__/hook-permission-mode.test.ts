/**
 * hook-permission 的「模式即工具策略」—— 阶段 1.1 的最小运行时语义。
 *
 * 背景:`agent:set-permission-mode` 此前只把 mode 写进 settings.json,运行时
 * 没有任何代码读它 —— UI 上切「计划模式 / 完全访问」对工具执行毫无效果。
 * 现在权限钩子里的规则裁决会经过 modeGate:
 *   - bypassPermissions → 没有规则就放行,不再弹窗(deny 规则永远最优先);
 *   - plan → 非只读工具即使有 allow 规则也强制 ask(弹窗)。
 * 每条断言都 mutation 可杀:删掉 modeGate 的对应分支立刻红。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// bridge 是模块单例,hook 直接 import —— 在模块边界替身,逐测试改 mode/rules。
const bridgeState: { mode?: string; rules: Array<{ action: string; tool: string }> } = { rules: [] };
vi.mock("../../agent-permission-bridge", () => ({
  agentPermissionBridge: {
    readRules: async () => bridgeState.rules,
    readMode: async () => bridgeState.mode,
    writeRules: async () => undefined,
    writeMode: async () => undefined,
    evaluate: async () => undefined,
  },
}));

import { createDefaultAgentHostState } from "../_default-state";
import { confirmGateAllows, installHookPermission, requestHookPermission } from "../hook-permission";

const emittedRendererEvents: Array<{ channel: string; payload: unknown }> = [];

function install() {
  const state = createDefaultAgentHostState() as ReturnType<typeof createDefaultAgentHostState> & {
    hookPermissionSessionRules: Map<string, Array<unknown>>;
    pendingUiRequests: Map<string, unknown>;
  };
  state.session = { sessionId: "s-1" } as never;
  installHookPermission({
    state,
    emitPluginEvent: () => undefined,
    emitRendererEvent: (channel, payload) => emittedRendererEvents.push({ channel, payload }),
  });
  return { state };
}

const WRITE_REQUEST = { toolName: "bash", pattern: "rm -rf /" };
const READ_REQUEST = { toolName: "read", pattern: "/tmp/a.txt" };

function resolvePending(pending: Map<string, unknown>, decision: string) {
  const entry = [...pending.values()][0] as { resolve: (v: unknown) => void };
  entry.resolve({ decision });
}

async function flush() {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

describe("hook-permission 模式语义", () => {
  beforeEach(() => {
    bridgeState.mode = undefined;
    bridgeState.rules = [];
    emittedRendererEvents.length = 0;
  });

  it("plan 模式:执行类工具即使有 allow 规则也强制弹窗", async () => {
    bridgeState.mode = "plan";
    bridgeState.rules = [{ action: "allow", tool: "bash" }];
    const { state } = install();
    const pending = requestHookPermission("执行", "跑命令", WRITE_REQUEST);
    await flush();
    expect(state.pendingUiRequests.size).toBe(1);
    resolvePending(state.pendingUiRequests, "allow");
    await expect(pending).resolves.toBe("allow");
  });

  it("plan 模式:只读工具被 allow 规则放行,不受影响", async () => {
    bridgeState.mode = "plan";
    bridgeState.rules = [{ action: "allow", tool: "read" }];
    install();
    await expect(requestHookPermission("读取", "读文件", READ_REQUEST)).resolves.toBe("allow");
  });

  it("bypassPermissions:无规则直接放行,不弹窗;deny 规则仍最优先", async () => {
    bridgeState.mode = "bypassPermissions";
    bridgeState.rules = [];
    install();
    await expect(requestHookPermission("执行", "跑命令", WRITE_REQUEST)).resolves.toBe("allow");

    bridgeState.rules = [{ action: "deny", tool: "bash" }];
    const { state } = install();
    await expect(requestHookPermission("执行", "跑命令", WRITE_REQUEST)).resolves.toBe("deny");
    expect(state.pendingUiRequests.size).toBe(0);
  });

  it("confirmGateAllows:bypass 放行,其余档位无定论(undefined)", async () => {
    bridgeState.mode = "bypassPermissions";
    await expect(confirmGateAllows()).resolves.toBe(true);
    bridgeState.mode = "default";
    await expect(confirmGateAllows()).resolves.toBeUndefined();
    bridgeState.mode = "plan";
    await expect(confirmGateAllows()).resolves.toBeUndefined();
  });

  // 20261031 Phase 0.4 — 5 档模式 × {编辑, 命令} 的确认闸行为表。
  // true = 不弹窗直接放行;undefined = 交给弹窗 / 会话授权决定。
  it.each([
    ["default", "edit", undefined],
    ["default", "other", undefined],
    ["acceptEdits", "edit", true],
    ["acceptEdits", "other", undefined],
    ["dontAsk", "edit", undefined],
    ["dontAsk", "other", undefined],
    ["plan", "edit", undefined],
    ["plan", "other", undefined],
    ["bypassPermissions", "edit", true],
    ["bypassPermissions", "other", true],
  ] as const)("confirmGateAllows 矩阵:%s × %s → %s", async (mode, kind, expected) => {
    bridgeState.mode = mode;
    await expect(confirmGateAllows(kind)).resolves.toBe(expected);
  });

  it("default 模式:无规则维持既有行为 —— 弹窗询问", async () => {
    bridgeState.mode = "default";
    const { state } = install();
    const pending = requestHookPermission("执行", "跑命令", WRITE_REQUEST);
    await flush();
    expect(state.pendingUiRequests.size).toBe(1);
    resolvePending(state.pendingUiRequests, "deny");
    await expect(pending).resolves.toBe("deny");
  });
});
