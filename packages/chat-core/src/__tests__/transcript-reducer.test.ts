// @vitest-environment node
// The transcript reducer runs without a DOM or a store (20261115-md R7).
import { describe, expect, it } from "vitest";
import type { PiMessage, SessionUpdate } from "@openbuddy/protocol/dto";
import { empty, reduce, reduceTranscript, transcriptFromMessages } from "../transcript-reducer";

describe("transcript reducer (node, no store)", () => {
  it("builds a finished transcript from engine history", () => {
    const history: PiMessage[] = [
      { role: "user", content: "你好", timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "在的" }], timestamp: 2 },
    ];
    const t = transcriptFromMessages(history);
    expect(t.messages.map(m => [m.role, m.parts, m.complete])).toEqual([
      ["user", [{ kind: "text", text: "你好" }], true],
      ["assistant", [{ kind: "text", text: "在的", contentIndex: 0 }], true],
    ]);
    expect(t.busy).toBe(false);
  });

  it("assembles streamed deltas and settles the turn", () => {
    const events: SessionUpdate[] = [
      { type: "agent_start" },
      { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "你" } },
      { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "好" } },
    ];
    const live = events.reduce(reduceTranscript, empty());
    expect(live.busy).toBe(true);
    expect(live.messages).toHaveLength(1);
    expect(live.messages[0].parts).toEqual([{ kind: "text", text: "你好", contentIndex: 0 }]);
    const settled = reduceTranscript(live, { type: "agent_settled" });
    expect(settled.busy).toBe(false);
    expect(settled.messages[0].complete).toBe(true);
    expect(reduceTranscript).toBe(reduce);
  });
});
