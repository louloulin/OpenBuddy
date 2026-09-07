/**
 * session-queue-items.test.ts — smoke tests for publicQueueItems().
 */
import { describe, it, expect, vi } from "vitest";

import { publicQueueItems } from "./session-queue-items";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

function makeFakeSession(steering: string[], followUp: string[]): AgentSession {
  return {
    getSteeringMessages: vi.fn(() => steering),
    getFollowUpMessages: vi.fn(() => followUp),
  } as unknown as AgentSession;
}

describe("session-queue-items", () => {
  it("returns empty array for null session", () => {
    expect(publicQueueItems(null)).toEqual([]);
  });

  it("projects steering messages with steer: prefix", () => {
    const items = publicQueueItems(makeFakeSession(["do X"], []));
    expect(items).toEqual([
      { itemId: "steer:do X", mode: "steer", content: [{ type: "text", text: "do X" }] },
    ]);
  });

  it("projects follow-up messages with queue: prefix", () => {
    const items = publicQueueItems(makeFakeSession([], ["also Y"]));
    expect(items).toEqual([
      { itemId: "queue:also Y", mode: "queue", content: [{ type: "text", text: "also Y" }] },
    ]);
  });

  it("merges steering and follow-up in single pass (steering first)", () => {
    const items = publicQueueItems(makeFakeSession(["a"], ["b", "c"]));
    expect(items.map((i) => i.mode)).toEqual(["steer", "queue", "queue"]);
  });
});
