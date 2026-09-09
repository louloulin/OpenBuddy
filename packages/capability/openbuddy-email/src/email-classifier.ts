/**
 * email-classifier.ts — Email classification heuristics + date extraction.
 *
 * Phase H.1 of docs/OPENBUDDY_PI_NATIVE_PLAN.md (v15 §35.5):
 *   Extract the email classifier constants + helpers from the index.ts
 *   god module so the `Email` Cordis service class stays focused on
 *   persistence + IPC + the action-center query API.
 *
 * The classifier is consumed by:
 *   - `extractEmailActionCandidates()` (LLM-phrase fallback + noise gate)
 *   - `extract-action-candidates.test.ts` (unit tests for noise rules)
 *   - `emailHandlers.extractActionCandidates()` (PI tool surface)
 *
 * Reverse-dep invariant:
 *   This module imports nothing from electron/main/ and nothing from
 *   index.ts. It only depends on the local `EmailActionCandidateInput`
 *   interface shape (re-declared inline so we don't drag index.ts in).
 *
 * Classification rules (v1.0-stable):
 *   - NOISE: subject matches one of the 8 noise patterns OR body
 *     contains one of the 32 noise keywords (newsletter / no-reply /
 *     notification / happy-birthday / etc.).
 *   - REJECTED: body contains "暂不采购|暂不合作|rejected|not proceeding".
 *   - CANCELLED: body contains "取消|cancelled|已结束".
 *   - PASSIVE_FOLLOWUP: body reports progress (已进入审核 / 已发货 /
 *     仍在评审中 / 稍后通知).
 *   Any of these returns an empty action set + a human-readable reason.
 */

import type { EmailActionCandidateInput, EmailActionCandidate } from "./email-classifier-types";

const EMAIL_ACTION_TRIGGER_PATTERNS: ReadonlyArray<{ regex: RegExp; source: EmailActionCandidate["source"] }> = [
  { regex: /(?:请|麻烦|烦请|恳请|希望|期待)\s*([^\n。.!?！？;;；]{2,80})/g, source: "heuristic-imperative" },
  { regex: /\b(?:please|kindly|could you|can you|would you)\s+([^\n.!?]{2,80})/gi, source: "heuristic-imperative" },
  { regex: /(?:能否|可不可以|是否可以|方便|愿意)\s*([^\n。.!?！？;;；]{2,80})/g, source: "heuristic-imperative" },
  { regex: /(?:审批|审核|确认|签字|回签|签署|批准|agree|approve|sign)\s*([^\n。.!?！？;;；]{2,80})/g, source: "heuristic-imperative" },
  { regex: /(?:回复|反馈|提供|安排|发送|处理|完成|准备)\s*([^\n。.!?！？;;；]{2,80})/g, source: "heuristic-deadline" },
];

const EMAIL_NOISE_KEYWORDS = [
  "newsletter", "no-reply", "noreply", "automated", "automatic",
  "notification", "alert", "digest", "weekly", "每月精选", "本周精选",
  "每日精选", "weekly summary", "build succeeded", "build failed",
  "system report", "monitoring", "metrics", "p95", "延迟",
  "生日快乐", "happy birthday", "节日快乐",
  "感谢贵司", "感谢您的", "感谢你", "下次有项目", "下次见面",
  "webinar 邀请", "blog post", "release notes", "changelog",
  "团建", "公告", "[公告]",
];

const EMAIL_NOISE_SUBJECT_PATTERNS: RegExp[] = [
  /^InfoQ/i, /^Daily/i, /^Build\s*#/i, /^New Blog Post/i,
  /^v\d+\.\d+/, /^Webinar/i, /生日快乐/, /感谢/, /感谢贵司/,
];

const EMAIL_REJECTED_PATTERNS = [
  /(?:暂不采购|暂不合作|本期不|不续签|不参与)/,
  /(?:本期暂不|暂不考虑|暂未通过|拒绝|rejected|not proceeding)/i,
];

const EMAIL_CANCELLED_PATTERNS = [
  /(?:取消|取消：|已取消|cancelled|已结束)/,
];

const EMAIL_PASSIVE_FOLLOWUP_PATTERNS = [
  /已进入.*?(?:审核|终审|审批)/,
  /已发货|运单号|预计.*?送达/,
  /仍在.*?评审中/,
  /正在.*?处理/,
  /稍后通知|新时间稍后/,
];

export function resolveMessageId(input: { messages: EmailActionCandidateInput["messages"]; fallback: string }): { id: string; from?: string; date?: string } {
  if (input.messages.length === 0) return { id: input.fallback };
  const head = input.messages[0]!;
  return {
    id: head.id || input.fallback,
    ...(head.from ? { from: head.from } : {}),
    ...(head.date ? { date: head.date } : {}),
  };
}

export function extractAbsoluteDate(text: string, baseDate: Date): string | undefined {
  let earliest: string | undefined;
  for (const m of text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) {
    const key = m[1]!;
    if (!earliest || key < earliest) earliest = key;
  }
  for (const m of text.matchAll(/\b(\d{1,2})[/月-](\d{1,2})(?:[/月-](\d{2,4}))?\b/g)) {
    const month = parseInt(m[1]!, 10);
    const day = parseInt(m[2]!, 10);
    let year = m[3] ? parseInt(m[3], 10) : baseDate.getFullYear();
    if (year < 100) year += 2000;
    const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!earliest || candidate < earliest) earliest = candidate;
  }
  for (const m of text.matchAll(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/g)) {
    const month = parseInt(m[1]!, 10);
    const day = parseInt(m[2]!, 10);
    const candidate = `${baseDate.getFullYear()}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!earliest || candidate < earliest) earliest = candidate;
  }
  return earliest;
}

export function extractRelativeDate(text: string, baseDate: Date): string | undefined {
  const weekdayMap: Record<string, number> = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 0, "天": 0 };
  const targetWeekday = (text.match(/(?:本周|下周)([一二三四五六日天])/) ?? [])[1];
  if (!targetWeekday) {
    const directDay = text.match(/(\d{1,2})\s*天后/);
    if (directDay) {
      const offset = parseInt(directDay[1]!, 10);
      const target = new Date(baseDate.getTime() + offset * 24 * 60 * 60 * 1000);
      return target.toISOString().slice(0, 10);
    }
    const directWeeks = text.match(/(\d{1,2})\s*周后/);
    if (directWeeks) {
      const offset = parseInt(directWeeks[1]!, 10);
      const target = new Date(baseDate.getTime() + offset * 7 * 24 * 60 * 60 * 1000);
      return target.toISOString().slice(0, 10);
    }
    return undefined;
  }
  const offset = targetWeekday === "本" ? 0 : 7;
  const today = baseDate.getDay();
  const targetDay = weekdayMap[targetWeekday] ?? today;
  const diff = (targetDay - today + 7) % 7 + offset;
  const target = new Date(baseDate.getTime() + diff * 24 * 60 * 60 * 1000);
  return target.toISOString().slice(0, 10);
}

export function extractDueDate(text: string, baseDate: Date): string | undefined {
  return extractAbsoluteDate(text, baseDate) ?? extractRelativeDate(text, baseDate);
}

export function isNoiseEmail(input: EmailActionCandidateInput): boolean {
  const subject = input.subject ?? "";
  const body = input.body ?? "";
  const haystack = `${subject}\n${body}`;
  for (const pattern of EMAIL_NOISE_SUBJECT_PATTERNS) {
    if (pattern.test(subject)) return true;
  }
  return EMAIL_NOISE_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

export function isRejectedEmail(input: EmailActionCandidateInput): boolean {
  const haystack = `${input.subject ?? ""}\n${input.body ?? ""}`;
  return EMAIL_REJECTED_PATTERNS.some((pattern) => pattern.test(haystack));
}

export function isCancelledEmail(input: EmailActionCandidateInput): boolean {
  const haystack = `${input.subject ?? ""}\n${input.body ?? ""}`;
  return EMAIL_CANCELLED_PATTERNS.some((pattern) => pattern.test(haystack));
}

export function isPassiveFollowupEmail(input: EmailActionCandidateInput): boolean {
  return EMAIL_PASSIVE_FOLLOWUP_PATTERNS.some((pattern) => pattern.test(input.body ?? ""));
}

export function trimActionContent(content: string): string {
  const trimmed = content.replace(/\s+/g, " ").trim();
  if (trimmed.length <= 30) return trimmed;
  return `${trimmed.slice(0, 28)}…`;
}

export function getEmailActionTriggerPatterns(): ReadonlyArray<{ regex: RegExp; source: EmailActionCandidate["source"] }> {
  return EMAIL_ACTION_TRIGGER_PATTERNS;
}