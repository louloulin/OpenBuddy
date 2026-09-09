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

    expect(captured.actions).toBeDefined();
    expect(captured.contextActions).toBeDefined();
    expect(captured.contextActions?.getSession()).toEqual({ sessionId: "session-test" });
  });

  it("sendMessage action delegates to host.prompt and coerces return to boolean", async () => {
    const { runner, captured } = makeRunner();
    const host = makeHost();
    bindCoreForSession(runner, host);

    const ok = await captured.actions!.sendMessage({ content: "hello" }, { source: "extension" });
    expect(ok).toBe(true);
    expect(host.prompt).toHaveBeenCalledWith("hello", { source: "extension" });

    // Non-true return value still coerces to false.
    (host.prompt as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const falsy = await captured.actions!.sendMessage({ content: "x" }, undefined);
    expect(falsy).toBe(false);
  });

  it("sendUserMessage action delegates to host.promptContent when present", async () => {
    const { runner, captured } = makeRunner();
    const host = makeHost();
    bindCoreForSession(runner, host);

    await captured.actions!.sendUserMessage(["hello", { text: "world" }], { trigger: "queue" });
    expect(host.promptContent).toHaveBeenCalledWith(["hello", { text: "world" }], "queue");
    expect(host.prompt).not.toHaveBeenCalled();
  });

  it("sendUserMessage falls back to host.prompt when promptContent is absent", async () => {
    const { runner, captured } = makeRunner();
    const host = makeHost();
    delete (host as { promptContent?: unknown }).promptContent;
    bindCoreForSession(runner, host);

    await captured.actions!.sendUserMessage(["a", "b"], { trigger: "steer" });
    expect(host.prompt).toHaveBeenCalledWith("a\nb", { trigger: "steer" });
  });

  it("setModel action delegates to host.setModel", async () => {
    const { runner, captured } = makeRunner();
    const host = makeHost();
    bindCoreForSession(runner, host);

    await captured.actions!.setModel({ id: "model-y" });
    expect(host.setModel).toHaveBeenCalledWith("model-y", {});
  });

  it("setThinkingLevel action delegates to host.setThinkingLevel when present", async () => {
    const { runner, captured } = makeRunner();
    const host = makeHost();
    bindCoreForSession(runner, host);

    await captured.actions!.setThinkingLevel("high");
    expect(host.setThinkingLevel).toHaveBeenCalledWith("high", {});
  });

  it("setThinkingLevel is a no-op when host has no setThinkingLevel", async () => {
    const { runner, captured } = makeRunner();
    const host = makeHost();
    delete (host as { setThinkingLevel?: unknown }).setThinkingLevel;
    bindCoreForSession(runner, host);

    // No throw — the action silently succeeds.
    await expect(captured.actions!.setThinkingLevel("high")).resolves.toBeUndefined();
  });

  it("exec action throws a typed error (no host surface today)", async () => {
    const { runner, captured } = makeRunner();
    const host = makeHost();
    bindCoreForSession(runner, host);

    await expect(captured.actions!.exec("ls", ["-la"], { cwd: "/" })).rejects.toThrow(/no exec\(\) surface/);
  });

  it("getActiveTools / getCommands return empty arrays (safe defaults)", () => {
    const { runner, captured } = makeRunner();
    const host = makeHost();
    bindCoreForSession(runner, host);

    expect(captured.actions!.getActiveTools()).toEqual([]);
    expect(captured.actions!.getAllTools()).toEqual([]);
    expect(captured.actions!.getCommands()).toEqual([]);
    expect(captured.actions!.getThinkingLevel()).toBeUndefined();
    expect(captured.actions!.getSessionName()).toBeUndefined();
    expect(captured.actions!.getLabel("any-entry")).toBeUndefined();
  });

  it("setActiveTools is a no-op (host has no allowlist surface yet)", async () => {
    const { runner, captured } = makeRunner();
    const host = makeHost();
    bindCoreForSession(runner, host);

    await expect(captured.actions!.setActiveTools(["any-tool"])).resolves.toBeUndefined();
  });

  it("getModel action returns host.getModel()", () => {
    const { runner, captured } = makeRunner();
    const host = makeHost();
    bindCoreForSession(runner, host);

    expect(captured.actions!.getModel()).toEqual({ id: "model-x" });
    expect(host.getModel).toHaveBeenCalled();
  });
});