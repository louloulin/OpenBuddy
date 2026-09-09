/**
 * email-validators.test.ts — Phase H.2 round 2 tests for the email
 * AI analysis input validators.
 *
 * Verifies the 6 analysis validators extracted from index.ts into
 * email-validators.ts preserve the original behavior:
 * - analysisCitations
 * - analysisContextCitations
 * - analysisFacts
 * - analysisActions
 * - analysisReplyDraft
 * - analysisMeetingProposal
 *
 * Each test pins a specific contract of one validator so future
 * refactors can change internals without breaking callers.
 */

import { describe, expect, it } from "vitest";

import {
  analysisActions,
  analysisCitations,
  analysisContextCitations,
  analysisFacts,
  analysisMeetingProposal,
  analysisReplyDraft,
} from "./email-validators";
import { EmailError } from "./email-error";

describe("email-validators (Phase H.2 round 2)", () => {
  describe("analysisCitations", () => {
    it("returns [] for non-array input", () => {
      expect(analysisCitations(null)).toEqual([]);
      expect(analysisCitations({})).toEqual([]);
      expect(analysisCitations("string")).toEqual([]);
    });

    it("returns [] for empty array", () => {
      expect(analysisCitations([])).toEqual([]);
    });

    it("extracts minimal citation (messageId only)", () => {
      expect(analysisCitations([{ messageId: "msg-1" }])).toEqual([
        { messageId: "msg-1" },
      ]);
    });

    it("truncates long fields to their respective max lengths", () => {
      const longMsg = "m".repeat(1000);
      const result = analysisCitations([{ messageId: longMsg, from: "f".repeat(500), date: "d".repeat(200), quote: "q".repeat(800) }]);
      expect(result[0]?.messageId).toHaveLength(320);
      expect(result[0]?.from).toHaveLength(320);
      expect(result[0]?.date).toHaveLength(80);
      expect(result[0]?.quote).toHaveLength(500);
    });

    it("throws EmailError when entry is not an object", () => {
      expect(() => analysisCitations([null])).toThrow(EmailError);
    });

    it("throws EmailError when messageId is missing", () => {
      expect(() => analysisCitations([{ from: "a" }])).toThrow(EmailError);
    });
  });

  describe("analysisContextCitations", () => {
    it("returns [] for non-array input", () => {
      expect(analysisContextCitations(null)).toEqual([]);
    });

    it("extracts minimal source (sourceId only)", () => {
      expect(analysisContextCitations([{ sourceId: "src-1" }])).toEqual([
        { sourceId: "src-1" },
      ]);
    });

    it("throws EmailError when sourceId is missing", () => {
      expect(() => analysisContextCitations([{ sourceTitle: "x" }])).toThrow(EmailError);
    });
  });

  describe("analysisFacts", () => {
    it("returns [] for non-array input", () => {
      expect(analysisFacts(null)).toEqual([]);
    });

    it("extracts minimal fact (statement + citations only)", () => {
      expect(analysisFacts([{ statement: "X", citations: [] }])).toEqual([
        { statement: "X", citations: [] },
      ]);
    });

    it("throws EmailError when statement is missing or empty", () => {
      expect(() => analysisFacts([{ citations: [] }])).toThrow(EmailError);
      expect(() => analysisFacts([{ statement: "   ", citations: [] }])).toThrow(EmailError);
    });
  });

  describe("analysisActions", () => {
    it("returns [] for non-array input", () => {
      expect(analysisActions(null)).toEqual([]);
    });

    it("extracts minimal action (content + citations only)", () => {
      expect(analysisActions([{ content: "do it", citations: [] }])).toEqual([
        { content: "do it", citations: [] },
      ]);
    });

    it("preserves owner + dueAt when provided", () => {
      expect(analysisActions([{ content: "x", owner: "me", dueAt: "2026-01-01", citations: [] }])).toEqual([
        { content: "x", owner: "me", dueAt: "2026-01-01", citations: [] },
      ]);
    });
  });

  describe("analysisReplyDraft", () => {
    it("returns undefined for null / undefined", () => {
      expect(analysisReplyDraft(undefined)).toBeUndefined();
      expect(analysisReplyDraft(null)).toBeUndefined();
    });

    it("extracts subject + body", () => {
      expect(analysisReplyDraft({ subject: "Hi", body: "Hello" })).toEqual({
        subject: "Hi",
        body: "Hello",
        citations: [],
      });
    });

    it("preserves tone when it's neutral / warm / formal", () => {
      expect(analysisReplyDraft({ subject: "s", body: "b", tone: "formal" })).toEqual({
        subject: "s",
        body: "b",
        tone: "formal",
        citations: [],
      });
    });

    it("drops tone when it's not a recognized value", () => {
      const result = analysisReplyDraft({ subject: "s", body: "b", tone: "loud" });
      expect(result?.tone).toBeUndefined();
    });

    it("throws EmailError when subject or body missing", () => {
      expect(() => analysisReplyDraft({ subject: "s" })).toThrow(EmailError);
      expect(() => analysisReplyDraft({ body: "b" })).toThrow(EmailError);
    });
  });

  describe("analysisMeetingProposal", () => {
    it("returns undefined for null / undefined", () => {
      expect(analysisMeetingProposal(undefined)).toBeUndefined();
      expect(analysisMeetingProposal(null)).toBeUndefined();
    });

    it("extracts title + start + end as ISO timestamps", () => {
      const result = analysisMeetingProposal({
        title: "Sync",
        start: "2026-01-15T10:00:00Z",
        end: "2026-01-15T11:00:00Z",
      });
      expect(result?.title).toBe("Sync");
      expect(result?.start).toBe("2026-01-15T10:00:00.000Z");
      expect(result?.end).toBe("2026-01-15T11:00:00.000Z");
      expect(result?.attendees).toEqual([]);
      expect(result?.citations).toEqual([]);
    });

    it("extracts attendees with names", () => {
      const result = analysisMeetingProposal({
        title: "Sync",
        start: "2026-01-15T10:00:00Z",
        end: "2026-01-15T11:00:00Z",
        attendees: [{ address: "a@x.com" }, { address: "b@x.com", name: "Bob" }],
      });
      expect(result?.attendees).toEqual([
        { address: "a@x.com" },
        { address: "b@x.com", name: "Bob" },
      ]);
    });

    it("rejects non-http(s) meetingUrl", () => {
      expect(() =>
        analysisMeetingProposal({
          title: "Sync",
          start: "2026-01-15T10:00:00Z",
          end: "2026-01-15T11:00:00Z",
          meetingUrl: "ftp://foo",
        }),
      ).toThrow(EmailError);
    });

    it("throws EmailError when end <= start", () => {
      expect(() =>
        analysisMeetingProposal({
          title: "Sync",
          start: "2026-01-15T11:00:00Z",
          end: "2026-01-15T10:00:00Z",
        }),
      ).toThrow(EmailError);
    });
  });
});