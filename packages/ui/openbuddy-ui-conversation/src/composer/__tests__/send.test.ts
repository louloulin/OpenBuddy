/**
 * composer/send — 20261031 Phase 0.6:空输入不发送。
 * 此前空输入回车会兜底发送「你好」,首页上甚至因此新建一个会话。
 */
import { describe, expect, it, vi } from "vitest";
import { send, type SendDeps } from "../send";
import { createInputHistory } from "@/lib/ui/input-history";

function deps(overrides: Partial<SendDeps> = {}): SendDeps {
  return {
    text: "",
    attachments: [],
    images: [],
    sceneTag: null,
    pluginCommands: [],
    streaming: false,
    apiReady: true,
    onSend: vi.fn(),
    setAttachments: vi.fn(),
    setImages: vi.fn(),
    setCursorPos: vi.fn(),
    updateText: vi.fn(),
    histRef: { current: createInputHistory() },
    histCursorRef: { current: 0 },
    draftRef: { current: "" },
    ...overrides,
  } as SendDeps;
}

describe("composer send", () => {
  it("does nothing for an empty or whitespace-only composer", () => {
    for (const text of ["", "   ", "\n\t"]) {
      const d = deps({ text });
      send(d);
      expect(d.onSend).not.toHaveBeenCalled();
      expect(d.updateText).not.toHaveBeenCalled();
    }
  });

  it("sends the trimmed text and clears the composer", () => {
    const d = deps({ text: "  帮我总结一下  " });
    send(d);
    expect(d.onSend).toHaveBeenCalledWith("帮我总结一下");
    expect(d.updateText).toHaveBeenCalledWith("");
  });

  it("sends attachments even without text", () => {
    const d = deps({ attachments: ["/tmp/a.txt"] });
    send(d);
    expect(d.onSend).toHaveBeenCalledWith(expect.stringContaining("/tmp/a.txt"));
  });
});
