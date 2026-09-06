import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(__dirname, "../agent/host-modules/bootstrap/handle-session-event.ts"),
  "utf-8",
);

describe("handle-session-event forwards sessionId", () => {
  it("attaches the active session id to the wire event", () => {
    expect(source).toMatch(/const sessionEvent = \{ \.\.\.event, sessionId: session\.sessionId \};/);
  });

  it("tags message and tool updates with the active session", () => {
    expect(source).toMatch(/emitRendererEvent\("pi:\/\/update", \{\s*sessionId: session\.sessionId,\s*type: "agent_message_chunk"/);
    expect(source).toMatch(/emitRendererEvent\("pi:\/\/update", \{\s*sessionId: session\.sessionId,\s*type: "tool_call"/);
    expect(source).toMatch(/emitRendererEvent\("pi:\/\/update", \{\s*sessionId: session\.sessionId,\s*type: "tool_call_update"/);
  });

  it("tags completion events with the active session", () => {
    expect(source).toMatch(/emitRendererEvent\("pi:\/\/complete", \{\s*sessionId: session\.sessionId,\s*promptId/);
  });

  it("does not emit an update payload without a session id", () => {
    const updateCall = /emitRendererEvent\("pi:\/\/update", \{([^}]*)\}/g;
    let match: RegExpExecArray | null;
    while ((match = updateCall.exec(source))) {
      expect(match[1].trimStart().startsWith("sessionId: session.sessionId")).toBe(true);
    }
  });

  it("preserves partial tool-call updates", () => {
    expect(source).toMatch(/type: "tool_call_update",\s*toolCallId: tc\.id,\s*update: \{ partial: true/);
  });
});
