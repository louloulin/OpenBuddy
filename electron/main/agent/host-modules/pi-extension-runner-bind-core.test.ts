/**
 * host-modules/pi-extension-runner-bind-core.test.ts — B.2 tests.
 *
 * Verifies the bindCoreForSession helper correctly wires the
 * OpenBuddy host-functions to a PI ExtensionRunner so that:
 *   1. The runner's `sendMessage` action delegates to host.prompt
 *   2. The runner's `setModel` action delegates to host.setModel
 *   3. The runner's `getActiveTools` / `getCommands` return safe
 *      defaults (host has no native surface for these yet)
 *   4. The runner's `setActiveTools` is a no-op (host gap)
 *   5. The runner's `contextActions.getSession` delegates to
 *      host.getSession
 *   6. The runner's `exec` throws a typed error (no host surface)
 *
 * The mock runner only records the call shape — we don't construct
 * a real `ExtensionRunner` instance because that requires the full
 * PI runtime. The tests pin the contract.
 */

import { describe, expect, it, vi } from "vitest";
import {
  bindCoreForSession,
  type BindCoreHostFunctions,
  type BindCoreActions,
  type BindCoreContextActions,
} from "./pi-extension-runner-bind-core";

interface CapturedBindings {
  actions?: BindCoreActions;
  contextActions?: BindCoreContextActions;
}

function makeRunner() {
  const captured: CapturedBindings = {};
  return {
    runner: {
      bindCore: (actions: BindCoreActions, contextActions: BindCoreContextActions) => {
        captured.actions = actions;
        captured.contextActions = contextActions;
      },
    } as unknown as Parameters<typeof bindCoreForSession>[0],
    captured,
  };
}

function makeHost(): BindCoreHostFunctions & {
  prompt: ReturnType<typeof vi.fn>;
  setModel: ReturnType<typeof vi.fn>;
  setThinkingLevel: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
  getModel: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  promptContent: ReturnType<typeof vi.fn>;
  onEvent: ReturnType<typeof vi.fn>;
} {
  return {
    prompt: vi.fn(async () => true),
    setModel: vi.fn(async () => undefined),
    setThinkingLevel: vi.fn(async () => undefined),
    getSession: vi.fn(() => ({ sessionId: "session-test" })),
    getModel: vi.fn(() => ({ id: "model-x" })),
    abort: vi.fn(async () => undefined),
    promptContent: vi.fn(async () => undefined),
    onEvent: vi.fn(() => () => undefined),
  };
}

describe("pi-extension-runner-bind-core (Phase B.2)", () => {
  it("calls runner.bindCore with adapted actions + contextActions", () => {
    const { runner, captured } = makeRunner();
    const host = makeHost();

    bindCoreForSession(runner, host);

    expect(captured.contextActions?.getModel()).toEqual({ id: "model-x" });
  });

  it("sendMessage action delegates to host.prompt and coerces return to boolean", async () => {
    const { runner, captured } = makeRunner();
    const host = makeHost();
    bindCoreForSession(runner, host);

    await (captured.actions! as any).sendMessage({ customType: "test", content: "hello", display: true, details: undefined }, { deliverAs: "steer" });
    expect(host.prompt).toHaveBeenCalledWith("hello", { deliverAs: "steer" });
  });

  it("sendUserMessage action delegates to host.promptContent when present", async () => {
    const { runner, captured } = makeRunner();
    const host = makeHost();
    bindCoreForSession(runner, host);

    await (captured.actions! as any).sendUserMessage([{ type: "text", text: "hello" }, { type: "text", text: "world" }], { deliverAs: "steer" });
    expect(host.promptContent).toHaveBeenCalledWith([{ type: "text", text: "hello" }, { type: "text", text: "world" }], "steer");
    expect(host.prompt).not.toHaveBeenCalled();
  });

  it("sendUserMessage falls back to host.prompt when promptContent is absent", async () => {
    const { runner, captured } = makeRunner();
    const host = makeHost();
    delete (host as { promptContent?: unknown }).promptContent;
    bindCoreForSession(runner, host);

    await (captured.actions! as any).sendUserMessage([{ type: "text", text: "a" }, { type: "text", text: "b" }], { deliverAs: "steer" });
    expect(host.prompt).toHaveBeenCalledWith("a\nb", { deliverAs: "steer" });
  });

  it("setModel action delegates to host.setModel", async () => {
    const { runner, captured } = makeRunner();
    const host = makeHost();
    bindCoreForSession(runner, host);

    await captured.actions!.setModel({ id: "model-y" } as any);
    expect(host.setModel).toHaveBeenCalledWith("model-y", {});
  });

  it("setThinkingLevel action delegates to host.setThinkingLevel when present", async () => {
    const { runner, captured } = makeRunner();
    const host = makeHost();
    bindCoreForSession(runner, host);

    await (captured.actions! as any).setThinkingLevel("high");
    expect(host.setThinkingLevel).toHaveBeenCalledWith("high", {});
  });

  it("setThinkingLevel is a no-op when host has no setThinkingLevel", async () => {
    const { runner, captured } = makeRunner();
    const host = makeHost();
    delete (host as { setThinkingLevel?: unknown }).setThinkingLevel;
    bindCoreForSession(runner, host);

    // No throw — the action silently succeeds.
    expect(() => (captured.actions! as any).setThinkingLevel("high")).not.toThrow();
  });

  it("Pi 0.85.1 action surface omits legacy exec", () => {
    const { runner, captured } = makeRunner();
    bindCoreForSession(runner, makeHost());
    expect((captured.actions! as any).exec).toBeUndefined();
  });

  it("getActiveTools / getCommands return empty arrays (safe defaults)", () => {
    const { runner, captured } = makeRunner();
    const host = makeHost();
    bindCoreForSession(runner, host);

    expect((captured.actions! as any).getActiveTools()).toEqual([]);
    expect((captured.actions! as any).getAllTools()).toEqual([]);
    expect((captured.actions! as any).getCommands()).toEqual([]);
    expect((captured.actions! as any).getThinkingLevel()).toBe("normal");
    expect((captured.actions! as any).getSessionName()).toBeUndefined();
  });

  it("setActiveTools is a no-op (host has no allowlist surface yet)", async () => {
    const { runner, captured } = makeRunner();
    const host = makeHost();
    bindCoreForSession(runner, host);

    expect(() => (captured.actions! as any).setActiveTools(["any-tool"])).not.toThrow();
  });

  it("getModel action returns host.getModel()", () => {
    const { runner, captured } = makeRunner();
    const host = makeHost();
    bindCoreForSession(runner, host);

    expect((captured.contextActions! as any).getModel()).toEqual({ id: "model-x" });
    expect(host.getModel).toHaveBeenCalled();
  });
});