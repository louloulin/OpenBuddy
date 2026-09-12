import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultAgentHostState } from "./_default-state";
import { installAgentPrompt, promptContent } from "./agent-prompt";

function installSession() {
  const state = createDefaultAgentHostState();
  const sendUserMessage = vi.fn(async () => undefined);
  state.session = { sessionId: "truncation-test-session", sendUserMessage } as any;
  state.attachmentStore = { save: vi.fn() } as any;
  const emitPluginEvent = vi.fn();
  installAgentPrompt({
    state,
    emitPluginEvent,
    emitRendererEvent: vi.fn(),
    publicQueueItems: () => [],
  });
  return { sendUserMessage, emitPluginEvent };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("agent prompt document-block truncation (plan4.3 §3.6)", () => {
  it("does not truncate or emit a plugin event when the prompt fits the budget", async () => {
    const { sendUserMessage, emitPluginEvent } = installSession();
    await promptContent([{ type: "text", text: "Short prompt — should never trip the truncator." }]);
    const [wireContent] = sendUserMessage.mock.calls[0] as unknown as [
      { type: "text"; text: string }[],
    ];
    expect(wireContent[0].text).not.toContain("<document-truncated");
    expect(emitPluginEvent).not.toHaveBeenCalledWith(
      "session/input-truncated",
      expect.anything(),
    );
  });

  it("exports the pure truncator so renderer-side code can apply it elsewhere", async () => {
    // Regression guard for the agent-prompt wiring: the truncator must
    // remain a pure exported function so the algorithm is independently
    // testable AND importable by future renderer-side paths.
    const mod = await import("./document-truncator");
    expect(typeof mod.truncateDocumentBlocks).toBe("function");
    expect(typeof mod.DEFAULT_TRUNCATION_OPTIONS).toBe("object");
    expect(mod.DEFAULT_TRUNCATION_OPTIONS.maxChars).toBeGreaterThan(0);
  });
});