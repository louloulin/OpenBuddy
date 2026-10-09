// packages/ui/openbuddy-ui-email/src/use-ai-draft-polling.ts
//
// 2026-09 拆分:从 EmailPanel.tsx(原 1632 行)抽出 AI 草稿轮询逻辑,
// 降低单文件复杂度。逻辑等价,只是把 useRef / useEffect / waitForAiDraft
// 抽到独立 hook。EmailPanel.tsx 调用 useAiDraftPolling({ onToast, openDraft })。
import { useEffect, useRef } from "react";
import { emailListDrafts, type EmailDraft } from "@/lib/agent/pi-client";

export const AI_DRAFT_CONTEXT_KEY = "openbuddy:email:ai-draft-context";

interface AiDraftContext {
  accountId: string;
  threadId: string;
  subject: string;
  baseline: Map<string, string>;
}

export interface UseAiDraftPollingParams {
  onDraftReady: (draft: EmailDraft) => void;
  onToast?: (message: string) => void;
  pollIntervalMs?: number;
  maxAttempts?: number;
}

export function useAiDraftPolling({
  onDraftReady,
  onToast,
  pollIntervalMs = 1000,
  maxAttempts = 30,
}: UseAiDraftPollingParams): void {
  const aiDraftPoll = useRef<ReturnType<typeof setTimeout> | undefined>();

  useEffect(() => {
    const raw = sessionStorage.getItem(AI_DRAFT_CONTEXT_KEY);
    if (!raw) return;
    let context: AiDraftContext | undefined;
    try {
      const parsed = JSON.parse(raw) as {
        accountId?: string;
        threadId?: string;
        subject?: string;
        baseline?: Record<string, string>;
      };
      if (parsed.accountId && parsed.threadId && parsed.subject) {
        context = {
          accountId: parsed.accountId,
          threadId: parsed.threadId,
          subject: parsed.subject,
          baseline: new Map(Object.entries(parsed.baseline ?? {})),
        };
      }
    } catch {
      sessionStorage.removeItem(AI_DRAFT_CONTEXT_KEY);
      return;
    }
    if (!context) return;

    const waitForAiDraft = async () => {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        await new Promise<void>((resolve) => {
          aiDraftPoll.current = setTimeout(resolve, pollIntervalMs);
        });
        try {
          const candidates: EmailDraft[] = await emailListDrafts(context!.accountId);
          const draft = candidates.find(
            (item) =>
              item.accountId === context!.accountId &&
              (!context!.baseline.has(item.id) ||
                item.updatedAt > (context!.baseline.get(item.id) ?? "")) &&
              (item.threadId === context!.threadId ||
                (!item.threadId && item.subject.toLowerCase().includes(context!.subject.toLowerCase()))),
          );
          if (draft) {
            sessionStorage.removeItem(AI_DRAFT_CONTEXT_KEY);
            onDraftReady(draft);
            onToast?.("AI 已生成回复草稿，请审阅后发送");
            return;
          }
        } catch {
          return;
        }
      }
    };

    void waitForAiDraft();

    return () => {
      if (aiDraftPoll.current) clearTimeout(aiDraftPoll.current);
    };
  }, [maxAttempts, onDraftReady, onToast, pollIntervalMs]);
}
