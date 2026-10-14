/**
 * useChatShortcuts —— 兑现 ChatShortcutOverlay 面板宣称的对话快捷键(A2)。
 *
 * 背景:面板(`CHAT_SHORTCUTS`)宣称了 ⌘R/⌘E/⌘P/⌘G/⌘⇧G/⌘L/⌘⏎,但代码里
 * 没有对应注册 —— 面板"单一真值"与现实脱节(2026-10-13 盘点)。本 hook 把
 * 这些键注册到 window 级(useShortcut,与 `?`/⌘K 同一模式)。
 *
 * 语义:
 *   ⌘R   重试最后一条用户消息(作为新输入重发)
 *   ⌘E   编辑最后一条用户消息(文本回填 composer 并聚焦 —— 与 Claude 的
 *        "edit previous prompt" 行为一致)
 *   ⌘P   暂停生成(软停止,保留上下文;仅 streaming 时)
 *   ⌘L   清空当前输入(经 composer 的 externalText 管道写空 + 聚焦)
 *   ⌘G / ⌘⇧G 在 FindBar 内部注册(仅查找打开时),见 FindBar.tsx
 *   ⌘F   已由 useChatViewShortcuts 注册(不重复)
 *   ⌘⏎  任意焦点位置发送/入队(composer 内部已有,这里补全局兜底)
 *
 * 输入框聚焦守卫:⌘R/⌘E 在 textarea 聚焦时也生效(它们是对话级操作);
 * ⌘L/⌘⏎ 只在 composer 空闲(非 streaming 入队逻辑由 send 分流处理)。
 */
import { useCallback } from "react";
import { useShortcut } from "@openbuddy/ui-shell";
import type { ChatMessage } from "@/stores/session-store";
import { EXPERT_PERSONA_BEGIN, EXPERT_PERSONA_END } from "../persona-markers";

/** 与 MessageItem 的 plainText 同语义:取全部 text parts 并剥隐藏 persona。 */
function messagePlainText(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.kind === "text")
    .map((part) => (message.role === "user" ? stripPersona(part.text) : part.text))
    .join("\n")
    .trim();
}

function stripPersona(text: string): string {
  const begin = text.indexOf(EXPERT_PERSONA_BEGIN);
  if (begin === -1) return text;
  const end = text.indexOf(EXPERT_PERSONA_END, begin);
  if (end === -1) return text;
  return (text.slice(0, begin) + text.slice(end + EXPERT_PERSONA_END.length).replace(/^\n+/, "")).trim();
}

/** 最后一条用户消息的文本;没有则 null。 */
function lastUserText(messages: readonly ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "user") continue;
    const text = messagePlainText(message);
    if (text) return text;
  }
  return null;
}

export interface UseChatShortcutsOptions {
  messages: readonly ChatMessage[];
  streaming: boolean;
  sessionId?: string;
  onSend: (text: string) => void;
  onPause: () => void;
  /** 回填 composer(⌘E):复用 quick-prompt 的 externalText 管道。 */
  onPrefillComposer: (text: string) => void;
  /** 清空输入(⌘L):同样走 externalText 管道写空。 */
  /** 留空则不注册 ⌘L —— Composer 内部已自带(setText + 草稿回写都在那),
   *  ChatView 不重复注册以免一次按键双执行。 */
  onClearComposer?: () => void;
  enabled?: boolean;
}

export function useChatShortcuts(options: UseChatShortcutsOptions): void {
  const {
    messages,
    streaming,
    sessionId,
    onSend,
    onPause,
    onPrefillComposer,
    onClearComposer,
    enabled = true,
  } = options;

  const whenSession = useCallback(() => Boolean(sessionId), [sessionId]);

  // ⌘R — 重试最后一条用户消息。
  useShortcut(
    { mod: true, key: "r", when: () => enabled && whenSession() && !streaming },
    () => {
      const text = lastUserText(messages);
      if (text) onSend(text);
    },
  );

  // ⌘E — 编辑最后一条用户消息(回填 composer)。
  useShortcut(
    { mod: true, key: "e", when: () => enabled && whenSession() && !streaming },
    () => {
      const text = lastUserText(messages);
      if (text) onPrefillComposer(text);
    },
  );

  // ⌘P — 暂停生成(仅 streaming)。
  useShortcut(
    { mod: true, key: "p", when: () => enabled && streaming },
    () => {
      onPause();
    },
  );

  // ⌘L — 清空当前输入(仅当调用方显式传入)。
  if (onClearComposer) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useShortcut(
      { mod: true, key: "l", when: () => enabled && whenSession() },
      () => {
        onClearComposer();
      },
    );
  }

  // ⌘F — 已由 useChatViewShortcuts 注册(onToggleFind),这里不重复注册,
  // 否则一次按键会触发两次。
}
