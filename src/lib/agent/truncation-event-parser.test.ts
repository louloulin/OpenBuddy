import { describe, expect, it } from "vitest";
import {
  parseTruncationEvent,
  isTruncationEvent,
  summarizeTruncationEvents,
  type TruncationEvent,
  type TruncationBudget,
} from "./truncation-event-parser";

const validBudget: TruncationBudget = { maxChars: 24_000, keepFirst: 4, keepLast: 4 };

describe("truncation-event-parser (plan4.4 §C — renderer subscription for session/input-truncated)", () => {
  describe("isTruncationEvent", () => {
    it("accepts a well-formed payload", () => {
      const payload = {
        sessionId: "session-1",
        dropped: 12,
        totalChars: 32_000,
        budget: validBudget,
      };
      expect(isTruncationEvent(payload)).toBe(true);
    });

    it("rejects payloads missing required fields", () => {
      expect(isTruncationEvent(null)).toBe(false);
      expect(isTruncationEvent(undefined)).toBe(false);
      expect(isTruncationEvent({})).toBe(false);
      expect(isTruncationEvent({ sessionId: "x" })).toBe(false);
      expect(
        isTruncationEvent({ sessionId: "x", dropped: 0, totalChars: 0, budget: {} }),
      ).toBe(false);
    });

    it("rejects payloads with wrong field types", () => {
      expect(
        isTruncationEvent({ sessionId: 1, dropped: 0, totalChars: 0, budget: validBudget }),
      ).toBe(false);
      expect(
        isTruncationEvent({
          sessionId: "x",
          dropped: "1",
          totalChars: 0,
          budget: validBudget,
        }),
      ).toBe(false);
      expect(
        isTruncationEvent({
          sessionId: "x",
          dropped: 0,
          totalChars: 0,
          budget: { maxChars: "no", keepFirst: 4, keepLast: 4 },
        }),
      ).toBe(false);
    });
  });

  describe("parseTruncationEvent", () => {
    it("returns a normalised TruncationEvent for a valid payload", () => {
      const parsed = parseTruncationEvent({
        sessionId: "session-1",
        dropped: 12,
        totalChars: 32_000,
        budget: validBudget,
      });
      expect(parsed).toEqual({
        sessionId: "session-1",
        dropped: 12,
        totalChars: 32_000,
        budget: validBudget,
      });
    });

    it("returns null for malformed payloads (defensive)", () => {
      expect(parseTruncationEvent(null)).toBeNull();
      expect(parseTruncationEvent({})).toBeNull();
      expect(
        parseTruncationEvent({
          sessionId: "x",
          dropped: -1,
          totalChars: 0,
          budget: validBudget,
        }),
      ).toBeNull();
      expect(
        parseTruncationEvent({
          sessionId: "x",
          dropped: 0,
          totalChars: -10,
          budget: validBudget,
        }),
      ).toBeNull();
      expect(
        parseTruncationEvent({
          sessionId: "",
          dropped: 0,
          totalChars: 0,
          budget: validBudget,
        }),
      ).toBeNull();
    });

    it("rounds non-integer dropped/totalChars to integers (defensive)", () => {
      const parsed = parseTruncationEvent({
        sessionId: "session-1",
        dropped: 12.7,
        totalChars: 32_000.4,
        budget: validBudget,
      });
      expect(parsed).not.toBeNull();
      expect(parsed!.dropped).toBe(13);
      expect(parsed!.totalChars).toBe(32_000);
    });
  });

  describe("summarizeTruncationEvents", () => {
    const events: TruncationEvent[] = [
      { sessionId: "s1", dropped: 5, totalChars: 30_000, budget: validBudget },
      { sessionId: "s2", dropped: 8, totalChars: 40_000, budget: validBudget },
      { sessionId: "s1", dropped: 3, totalChars: 28_000, budget: validBudget },
    ];

    it("aggregates dropped + totalChars across the entire log", () => {
      const summary = summarizeTruncationEvents(events);
      expect(summary.events).toBe(3);
      expect(summary.dropped).toBe(16);
      expect(summary.totalChars).toBe(98_000);
      expect(summary.affectedSessions).toBe(2);
    });

    it("returns zeroes for an empty event list", () => {
      const summary = summarizeTruncationEvents([]);
      expect(summary).toEqual({ events: 0, dropped: 0, totalChars: 0, affectedSessions: 0 });
    });

    it("ignores malformed entries silently (defensive)", () => {
      const summary = summarizeTruncationEvents([
        ...events,
        null as unknown as TruncationEvent,
        undefined as unknown as TruncationEvent,
        { sessionId: "s1" } as unknown as TruncationEvent,
      ]);
      expect(summary.events).toBe(3);
      expect(summary.dropped).toBe(16);
      expect(summary.affectedSessions).toBe(2);
    });
  });
});