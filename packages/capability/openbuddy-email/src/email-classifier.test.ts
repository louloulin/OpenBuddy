/**
 * email-classifier.test.ts — Phase H.1 tests for the email classifier helpers.
 *
 * Verifies the noise / rejected / cancelled / passive-followup rules
 * + date extraction work in isolation, after extraction from the
 * index.ts god module. These rules are consumed by
 * `extractEmailActionCandidates()` (LLM-phrase fallback + noise gate).
 */

import { describe, expect, it } from "vitest";

import {
  extractAbsoluteDate,
  extractDueDate,
  extractRelativeDate,
  getEmailActionTriggerPatterns,
  isCancelledEmail,
  isNoiseEmail,
  isPassiveFollowupEmail,
  isRejectedEmail,
  resolveMessageId,
  trimActionContent,
} from "./email-classifier";

const baseInput = { subject: "", body: "", messages: [] };

describe("email-classifier (Phase H.1)", () => {
  it("isNoiseEmail flags newsletter + no-reply + chinese 公告 + blog post", () => {
    // Phase H.1 note: pre-existing implementation matches keywords in a
    // case-sensitive haystack (`${subject}\n${body}`) against lowercase
    // keywords. Subject-only "Release notes" (capital R) does NOT match
    // the lowercase "release notes" keyword, so we put the keyword in
    // the body to exercise the rule.
    expect(isNoiseEmail({ ...baseInput, subject: "Weekly digest", body: "" })).toBe(true);
    expect(isNoiseEmail({ ...baseInput, subject: "Hi", body: "From no-reply@foo" })).toBe(true);
    expect(isNoiseEmail({ ...baseInput, subject: "v2.4.0", body: "release notes attached" })).toBe(true);
    expect(isNoiseEmail({ ...baseInput, subject: "[公告] 团建", body: "" })).toBe(true);
    expect(isNoiseEmail({ ...baseInput, subject: "Build #1234 failed", body: "" })).toBe(true);
  });

  it("isNoiseEmail returns false for actionable mail", () => {
    expect(isNoiseEmail({ ...baseInput, subject: "Please review the PR", body: "Could you sign off by Friday?" })).toBe(false);
  });

  it("isRejectedEmail flags 暂不 / 拒绝 / not proceeding", () => {
    expect(isRejectedEmail({ ...baseInput, subject: "采购决议", body: "我们本期暂不考虑该方案" })).toBe(true);
    expect(isRejectedEmail({ ...baseInput, subject: "Re: contract", body: "We are not proceeding with this." })).toBe(true);
    expect(isRejectedEmail({ ...baseInput, subject: "Procurement", body: "暂不采购" })).toBe(true);
  });

  it("isCancelledEmail flags 取消 / cancelled / 已结束", () => {
    expect(isCancelledEmail({ ...baseInput, subject: "Meeting", body: "已取消" })).toBe(true);
    expect(isCancelledEmail({ ...baseInput, subject: "Trip", body: "cancelled due to weather" })).toBe(true);
    expect(isCancelledEmail({ ...baseInput, subject: "Workshop", body: "已结束" })).toBe(true);
  });

  it("isPassiveFollowupEmail flags 仍在评审中 / 已发货 / 稍后通知", () => {
    expect(isPassiveFollowupEmail({ ...baseInput, subject: "Status", body: "仍在评审中" })).toBe(true);
    expect(isPassiveFollowupEmail({ ...baseInput, subject: "Shipment", body: "已发货" })).toBe(true);
    expect(isPassiveFollowupEmail({ ...baseInput, subject: "Update", body: "稍后通知" })).toBe(true);
  });

  it("resolveMessageId returns fallback when messages is empty", () => {
    expect(resolveMessageId({ messages: [], fallback: "fb-1" })).toEqual({ id: "fb-1" });
  });

  it("resolveMessageId returns the first message's id (or fallback if empty)", () => {
    expect(resolveMessageId({
      messages: [{ id: "msg-1", from: "a@x.com", date: "2024-01-15" }],
      fallback: "fb",
    })).toEqual({ id: "msg-1", from: "a@x.com", date: "2024-01-15" });

    expect(resolveMessageId({
      messages: [{ id: "", from: "a@x.com" }],
      fallback: "fb",
    })).toEqual({ id: "fb", from: "a@x.com" });
  });

  it("extractAbsoluteDate picks the earliest ISO date", () => {
    const base = new Date("2024-01-15T00:00:00Z");
    expect(extractAbsoluteDate("On 2024-02-20 we meet, and again 2024-03-01", base)).toBe("2024-02-20");
  });

  it("extractAbsoluteDate normalises 2024年3月1日 format", () => {
    const base = new Date("2024-01-15T00:00:00Z");
    expect(extractAbsoluteDate("3月1日 开会", base)).toBe("2024-03-01");
  });

  it("extractRelativeDate handles 本周二 / 下周三", () => {
    // 2024-01-15 is a Monday (day 1) in UTC.
    // Phase H.1 note: pre-existing implementation has a quirk — the
    // `offset` variable is keyed off `targetWeekday` (the captured
    // weekday name "二") not the "本" / "下" prefix, so "本周二" returns
    // the NEXT Tuesday (1 week later, 2024-01-23) instead of today +
    // 1 day. We pin the current behaviour so the test catches any
    // refactor that might inadvertently change the offset semantics.
    const base = new Date("2024-01-15T12:00:00Z");
    expect(extractRelativeDate("本周二提交", base)).toBe("2024-01-23");
    expect(extractRelativeDate("下周三发版", base)).toBe("2024-01-24");
  });

  it("extractRelativeDate handles N 天后 / N 周后", () => {
    const base = new Date("2024-01-15T00:00:00Z");
    expect(extractRelativeDate("3 天后到货", base)).toBe("2024-01-18");
    expect(extractRelativeDate("2 周后到期", base)).toBe("2024-01-29");
  });

  it("extractDueDate prefers absolute over relative", () => {
    const base = new Date("2024-01-15T00:00:00Z");
    expect(extractDueDate("3 天后 2024-02-20", base)).toBe("2024-02-20");
  });

  it("trimActionContent caps at 30 chars and adds ellipsis", () => {
    expect(trimActionContent("a".repeat(40))).toBe(`${"a".repeat(28)}…`);
    expect(trimActionContent("short")).toBe("short");
  });

  it("getEmailActionTriggerPatterns returns the 5-pattern heuristic set", () => {
    const patterns = getEmailActionTriggerPatterns();
    expect(patterns).toHaveLength(5);
    // The 4 imperative + 1 deadline pattern is the v1.0-stable set.
    const sources = patterns.map((p) => p.source);
    expect(sources.filter((s) => s === "heuristic-imperative")).toHaveLength(4);
    expect(sources.filter((s) => s === "heuristic-deadline")).toHaveLength(1);
  });
});