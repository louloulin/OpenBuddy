import { describe, expect, it, vi, afterEach } from "vitest";
import { provideRpcUiContext } from "./provide-rpc-ui-context";

describe("provideRpcUiContext timeout contract", () => {
  afterEach(() => vi.useRealTimers());

  it("resolves confirm as deny after timeout and emits a diagnostic", async () => {
    vi.useFakeTimers();
    const pendingUiRequests = new Map<string, any>();
    const pluginEvents: Array<{ type: string; payload: any }> = [];
    const rendererEvents: unknown[] = [];
    const ui = provideRpcUiContext({
      context: { provide: vi.fn() },
      session: { sessionId: "timeout-session" } as any,
      state: { pendingUiRequests, extensionEditorText: new Map(), extensionToolsExpanded: new Map() },
      emitPluginEvent: (type, payload) => pluginEvents.push({ type, payload }),
      emitRendererEvent: (_type, payload) => rendererEvents.push(payload),
      questionAnswer: (value) => typeof value === "string" ? value : undefined,
      createOpenBuddyRpcUiContext: (args: any) => args,
      piGeneration: 3,
    }) as any;

    const promise = ui.confirm("Allow", "message");
    expect(pendingUiRequests.size).toBe(1);
    await vi.advanceTimersByTimeAsync(120_000);
    await expect(promise).resolves.toBe(false);
    expect(pendingUiRequests.size).toBe(0);
    expect(pluginEvents).toEqual(expect.arrayContaining([expect.objectContaining({ type: "pi/ui-request-timeout", payload: expect.objectContaining({ diagnostic: "ui-timeout" }) })]));
    expect(rendererEvents).toHaveLength(1);
  });
});
