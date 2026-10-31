/**
 * 20261031 Phase 1.2 — Stop 后立即发送:渲染层在主进程确认中止前就回到空闲,
 * 这时的 prompt 必须等中止完成再派发,而不是撞上 "Agent is already processing"。
 */
import { describe, expect, it, vi } from "vitest";
import { createDefaultAgentHostState } from "./_default-state";
import { abort, installAgentPrompt, prompt } from "./agent-prompt";

vi.mock("../pi-resources", async (orig) => ({ ...(await orig<object>()), writePromptHistory: async () => undefined }));

describe("agent-prompt abort → prompt ordering", () => {
  it("prompt sent during a slow abort waits for the abort to settle", async () => {
    const order: string[] = [];
    let finishAbort: () => void = () => undefined;
    const state = createDefaultAgentHostState();
    state.session = {
      sessionId: "s-1",
      abort: () => new Promise<void>((resolve) => {
        finishAbort = () => {
          order.push("abort-settled");
          resolve();
        };
      }),
      prompt: async () => {
        order.push("prompt");
      },
    } as never;
    installAgentPrompt({
      state,
      emitPluginEvent: vi.fn(),
      emitRendererEvent: vi.fn(),
      publicQueueItems: () => [],
    });

    const aborting = abort({ sessionId: "s-1" });
    const sending = prompt("next", { sessionId: "s-1" });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(order).toEqual([]);
    finishAbort();
    await Promise.all([aborting, sending]);
    expect(order).toEqual(["abort-settled", "prompt"]);
  });

  it("without an abort in flight, prompt dispatches immediately", async () => {
    const promptFn = vi.fn(async () => undefined);
    const state = createDefaultAgentHostState();
    state.session = { sessionId: "s-2", prompt: promptFn } as never;
    installAgentPrompt({ state, emitPluginEvent: vi.fn(), emitRendererEvent: vi.fn(), publicQueueItems: () => [] });
    await prompt("hi", { sessionId: "s-2" });
    expect(promptFn).toHaveBeenCalledWith("hi");
  });
});
