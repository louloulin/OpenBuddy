/**
 * @openbuddy/capability-email/email-validators — AI analysis input validators.
 *
 * Phase H.2 round 2 of docs/OPENBUDDY_PI_NATIVE_PLAN.md (v23 §43.5):
 *   Extract the 6 AI analysis input validators out of index.ts so
 *   the god module shrinks by ~120 LOC and the validation pipeline
 *   is independently testable.
 *
 * What's in this module (round 2):
 *   - analysisCitations, analysisContextCitations
 *   - analysisFacts, analysisActions
 *   - analysisReplyDraft, analysisMeetingProposal
 *
 * What stays in index.ts (next rounds):
 *   - analysisContextCitationEntries, analysisCitationIds
 *   - searchableMessageText, citationQuoteMatches
 *   - draftFingerprint, processingPlanFingerprint (need the local `id` helper)
 *   - extractEmailActionCandidates (uses the email-classifier helpers)
 *
 * Architecture:
 *   - Each validator takes an `unknown` payload (raw LLM output)
 *     and returns a typed structure (or throws `EmailError`).
 *
 * Reverse-dep invariant:
 *   - imports nothing from electron/main/
 *   - imports local types from index.ts via `import type` (erased at runtime — no cycle)
 *   - imports `EmailError` (runtime) from ./email-error
 */

import { EmailError } from "./email-error";
import type {
  EmailAnalysisAction,
  EmailAnalysisCitation,
  EmailAnalysisContextCitation,
  EmailAnalysisFact,
  EmailAnalysisMeetingProposal,
  EmailAnalysisReplyDraft,
} from "./index";

const CITATION_LIMIT = 20;
const CITATION_MESSAGE_ID_MAX = 320;
const CITATION_FROM_MAX = 320;
const CITATION_DATE_MAX = 80;
const CITATION_QUOTE_MAX = 500;

const CONTEXT_SOURCE_ID_MAX = 500;
const CONTEXT_SOURCE_TITLE_MAX = 500;
const CONTEXT_SOURCE_PATH_MAX = 2000;
const CONTEXT_QUOTE_MAX = 1000;

const FACT_STATEMENT_MAX = 2000;
const ACTION_CONTENT_MAX = 2000;
const ACTION_OWNER_MAX = 320;
const ACTION_DUE_MAX = 80;

const REPLY_SUBJECT_MAX = 998;
const REPLY_BODY_MAX = 20000;
const MEETING_TITLE_MAX = 500;
const MEETING_LOCATION_MAX = 1000;
const MEETING_DESCRIPTION_MAX = 4000;
const MEETING_TIMEZONE_MAX = 80;

function trim(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.slice(0, max);
}

function trimNonEmpty(value: unknown, max: number): string | undefined {
  const t = trim(value, max);
  return t && t.trim() ? t.trim() : undefined;
}

// Email address regex used by the original inline `address()` helper
// in index.ts. Re-declared here so email-validators.ts can validate
// meeting attendees without dragging the whole `address()` helper in.
const EMAIL_ADDRESS_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function addresses(value: unknown): Array<{ name?: string; address: string }> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new EmailError("invalid_input", "AI 会议出席者必须是对象");
    }
    const item = entry as Record<string, unknown>;
    if (typeof item.address !== "string" || !item.address.trim()) {
      throw new EmailError("invalid_input", "AI 会议出席者必须包含 address");
    }
    const address = item.address.trim();
    if (!EMAIL_ADDRESS_REGEX.test(address)) {
      throw new EmailError("invalid_input", "invalid email address");
    }
    return {
      address,
      ...(typeof item.name === "string" && item.name.trim() ? { name: item.name.trim() } : {}),
    };
  });
}

export function analysisCitations(value: unknown): EmailAnalysisCitation[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, CITATION_LIMIT).map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new EmailError("invalid_input", "AI 分析引用必须是对象");
    }
    const item = entry as Record<string, unknown>;
    if (typeof item.messageId !== "string" || !item.messageId.trim()) {
      throw new EmailError("invalid_input", "AI 分析引用必须包含 messageId");
    }
    const from = trim(item.from, CITATION_FROM_MAX);
    const date = trim(item.date, CITATION_DATE_MAX);
    const quote = trim(item.quote, CITATION_QUOTE_MAX);
    return {
      messageId: item.messageId.trim().slice(0, CITATION_MESSAGE_ID_MAX),
      ...(from ? { from } : {}),
      ...(date ? { date } : {}),
      ...(quote ? { quote } : {}),
    };
  });
}

export function analysisContextCitations(value: unknown): EmailAnalysisContextCitation[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, CITATION_LIMIT).map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new EmailError("invalid_input", "AI 知识库引用必须是对象");
    }
    const item = entry as Record<string, unknown>;
    if (typeof item.sourceId !== "string" || !item.sourceId.trim()) {
      throw new EmailError("invalid_input", "AI 知识库引用必须包含 sourceId");
    }
    const quote = trim(item.quote, CONTEXT_QUOTE_MAX);
    const sourcePath = trim(item.sourcePath, CONTEXT_SOURCE_PATH_MAX);
    const sourceTitle = trim(item.sourceTitle, CONTEXT_SOURCE_TITLE_MAX);
    return {
      sourceId: item.sourceId.trim().slice(0, CONTEXT_SOURCE_ID_MAX),
      ...(sourceTitle ? { sourceTitle } : {}),
      ...(sourcePath ? { sourcePath } : {}),
      ...(quote ? { quote } : {}),
    };
  });
}

export function analysisFacts(value: unknown): EmailAnalysisFact[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new EmailError("invalid_input", "AI 事实必须是对象");
    }
    const item = entry as Record<string, unknown>;
    if (typeof item.statement !== "string" || !item.statement.trim()) {
      throw new EmailError("invalid_input", "AI 事实必须包含 statement");
    }
    const contextCitations = analysisContextCitations(item.contextCitations);
    return {
      statement: item.statement.trim().slice(0, FACT_STATEMENT_MAX),
      citations: analysisCitations(item.citations),
      ...(contextCitations.length ? { contextCitations } : {}),
    };
  });
}

export function analysisActions(value: unknown): EmailAnalysisAction[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new EmailError("invalid_input", "AI 行动项必须是对象");
    }
    const item = entry as Record<string, unknown>;
    if (typeof item.content !== "string" || !item.content.trim()) {
      throw new EmailError("invalid_input", "AI 行动项必须包含 content");
    }
    const contextCitations = analysisContextCitations(item.contextCitations);
    const owner = trim(item.owner, ACTION_OWNER_MAX);
    const dueAt = trim(item.dueAt, ACTION_DUE_MAX);
    return {
      content: item.content.trim().slice(0, ACTION_CONTENT_MAX),
      ...(owner ? { owner } : {}),
      ...(dueAt ? { dueAt } : {}),
      citations: analysisCitations(item.citations),
      ...(contextCitations.length ? { contextCitations } : {}),
    };
  });
}

export function analysisReplyDraft(value: unknown): EmailAnalysisReplyDraft | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EmailError("invalid_input", "AI 回复草稿必须是对象");
  }
  const item = value as Record<string, unknown>;
  if (typeof item.subject !== "string" || typeof item.body !== "string") {
    throw new EmailError("invalid_input", "AI 回复草稿必须包含 subject 和 body");
  }
  const tone = item.tone === "neutral" || item.tone === "warm" || item.tone === "formal" ? item.tone : undefined;
  const contextCitations = analysisContextCitations(item.contextCitations);
  return {
    subject: item.subject.slice(0, REPLY_SUBJECT_MAX),
    body: item.body.slice(0, REPLY_BODY_MAX),
    ...(tone ? { tone } : {}),
    citations: analysisCitations(item.citations),
    ...(contextCitations.length ? { contextCitations } : {}),
  };
}

export function analysisMeetingProposal(value: unknown): EmailAnalysisMeetingProposal | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EmailError("invalid_input", "AI 会议提案必须是对象");
  }
  const item = value as Record<string, unknown>;
  if (typeof item.title !== "string" || !item.title.trim() || typeof item.start !== "string" || typeof item.end !== "string") {
    throw new EmailError("invalid_input", "AI 会议提案必须包含 title、start 和 end");
  }
  const start = Date.parse(item.start);
  const end = Date.parse(item.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new EmailError("invalid_input", "AI 会议提案时间范围无效");
  }
  const meetingUrlRaw = typeof item.meetingUrl === "string" && item.meetingUrl.trim() ? item.meetingUrl.trim() : undefined;
  if (meetingUrlRaw) {
    try {
      const parsed = new URL(meetingUrlRaw);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("unsupported");
      }
    } catch {
      throw new EmailError("invalid_input", "会议链接必须是 http(s) URL");
    }
  }
  const timeZone = trimNonEmpty(item.timeZone, MEETING_TIMEZONE_MAX);
  const location = trimNonEmpty(item.location, MEETING_LOCATION_MAX);
  const description = trimNonEmpty(item.description, MEETING_DESCRIPTION_MAX);
  return {
    title: item.title.trim().slice(0, MEETING_TITLE_MAX),
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    ...(timeZone ? { timeZone } : {}),
    ...(location ? { location } : {}),
    ...(meetingUrlRaw ? { meetingUrl: meetingUrlRaw } : {}),
    attendees: addresses(item.attendees ?? []),
    ...(description ? { description } : {}),
    citations: analysisCitations(item.citations),
  };
}