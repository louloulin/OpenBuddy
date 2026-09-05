import { describe, expect, it } from "vitest";
import { createPiPlanModeExtension, type PiPlanController } from "./pi-plan-mode";

type TestContext = {
  sessionManager: { getSessionId: () => string };
  ui: { notify: (message: string, type?: "info" | "warning" | "error") => void };
};

function createHarness(controller: PiPlanController) {
  const handlers = new Map<string, (event: unknown, context: TestContext) => unknown>();
  const commands = new Map<string, { handler: (args: string, context: TestContext) => Promise<void> | void }>();
  const extension = createPiPlanModeExtension({ resolveController: () => controller });
  extension({
    on: (event: string, handler: (value: unknown, context: TestContext) => unknown) => {
      if (event === "before_agent_start" || event === "turn_start") handlers.set(event, handler);
    },
    registerCommand: (name: string, options: { handler: (args: string, context: TestContext) => Promise<void> | void }) => commands.set(name, options),
  } as never);
  return { handlers, commands };
}

function state(enabled: boolean, planText = "") {
  return { enabled, state: enabled ? "draft" : "draft", planText };
}

describe("Pi plan mode extension", () => {
  it("only adds the policy to the prompt while plan mode is enabled", async () => {
    let current = state(false);
    const harness = createHarness({
      getPlan: async () => current,
      setEnabled: async (_id, enabled) => (current = state(enabled)),
      requestEnabled: async (_id, enabled) => current,
      commitPending: async () => current,
      setPlan: async (_id, planText) => (current = state(true, planText)),
      approve: async () => current,
      reject: async () => (current = state(false)),
    });
    const context: TestContext = { sessionManager: { getSessionId: () => "s1" }, ui: { notify: () => undefined } };
    const handler = harness.handlers.get("before_agent_start")!;
    await expect(handler({ systemPrompt: "base" }, context)).resolves.toBeUndefined();
    current = state(true, "# Plan");
    await expect(handler({ systemPrompt: "base" }, context)).resolves.toMatchObject({ systemPrompt: expect.stringContaining("## Plan mode") });
  });

  it("registers /plan and routes commands to the shared plan controller", async () => {
    let current = state(false);
    const notices: string[] = [];
    const harness = createHarness({
      getPlan: async () => current,
      setEnabled: async (_id, enabled) => (current = state(enabled)),
      requestEnabled: async (_id, enabled) => (current = state(enabled)),
      commitPending: async () => current,
      setPlan: async (_id, planText) => (current = state(true, planText)),
      approve: async () => current,
      reject: async () => (current = state(false)),
    });
    const context: TestContext = {
      sessionManager: { getSessionId: () => "s1" },
      ui: { notify: (message) => notices.push(message) },
    };
    const command = harness.commands.get("plan")!.handler;
    await command("on", context);
    await command("set # Ship it", context);
    expect(current).toMatchObject({ enabled: true, planText: "# Ship it" });
    expect(notices.at(-1)).toContain("# Ship it");
    await command("off", context);
    expect(current.enabled).toBe(false);
  });

  it("commits a requested mode before the next prompt is assembled", async () => {
    let current = state(false);
    let pending = false;
    const harness = createHarness({
      getPlan: async () => current,
      setEnabled: async (_id, enabled) => (current = state(enabled)),
      requestEnabled: async (_id, enabled) => { pending = enabled; return state(enabled); },
      commitPending: async () => { if (pending) current = state(true); return current; },
      setPlan: async (_id, planText) => (current = state(true, planText)),
      approve: async () => current,
      reject: async () => (current = state(false)),
    });
    const context: TestContext = { sessionManager: { getSessionId: () => "s1" }, ui: { notify: () => undefined } };
    await harness.commands.get("plan")!.handler("on", context);
    expect(current.enabled).toBe(false);
    await harness.handlers.get("before_agent_start")?.({ systemPrompt: "base" }, context);
    expect(current.enabled).toBe(true);
  });
});
