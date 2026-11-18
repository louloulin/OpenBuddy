// @vitest-environment node
import { describe, expect, it } from "vitest";
import { validateCommandPayload } from "../src/validate.js";

describe("agent_set_queue payload (pii W1.8)", () => {
  it("accepts plain strings and items with attachments", () => {
    expect(validateCommandPayload("agent_set_queue", {
      sessionId: "s1",
      steering: ["插话一"],
      followUp: [{ text: "带图的消息", attachments: [{ path: "/tmp/shot.png" }] }],
    })).toMatchObject({ sessionId: "s1" });
  });

  it("rejects hostile items", () => {
    expect(() => validateCommandPayload("agent_set_queue", { sessionId: "s1", steering: [{ text: "" }], followUp: [] })).toThrow(/invalid_payload/);
    expect(() => validateCommandPayload("agent_set_queue", { sessionId: "s1", steering: [{ text: "x", attachments: [{ path: 1 }] }], followUp: [] })).toThrow(/invalid_payload/);
    expect(() => validateCommandPayload("agent_set_queue", { sessionId: "s1", steering: new Array(51).fill("x"), followUp: [] })).toThrow(/invalid_payload/);
  });
});
