/**
 * 会话内查找条 —— 对齐 WorkBuddy `cb-chat-ui/chat-search`(extract-plain-text + 跳转高亮)。
 *
 * 在当前对话的消息列表中查找关键词(大小写不敏感),基于 `extractPlainText` 索引命中,
 * 提供上一个/下一个/关闭与计数。命中消息的容器高亮由调用方按 `hitIds` / `currentId`
 * 添加 className 实现(此处不深入 Markdown DOM,保持渲染稳定)。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  XCloseIcon,
} from "@openbuddy/ui-primitives/icons";
import { matchesQuery, extractPlainText } from "@/lib/files/extract-text";
import type { ChatMessage } from "@/stores/session-store";

interface FindBarProps {
  /** 当前对话的全部消息(按时间顺序)。 */
  messages: ChatMessage[];
  /** 受控开关。 */
  open: boolean;
  /** 关闭回调。 */
  onClose: () => void;
  /** 当前命中序号变化(1-based;0 表示无命中/空)。 */
  onActiveChange?: (messageId: string | null) => void;
  /** 命中集合变化(供父级高亮命中容器)。 */
  onHitsChange?: (hitIds: string[]) => void;
}

export function FindBar({ messages, open, onClose, onActiveChange, onHitsChange }: FindBarProps) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 命中消息索引(按时间顺序的 message id 列表)。
  const hitIds = useMemo(() => {
    if (!query) return [] as string[];
    return messages
      .filter((m) => matchesQuery(extractForSearch(m), query))
      .map((m) => m.id);
  }, [messages, query]);

  const total = hitIds.length;
  const currentId = total > 0 ? hitIds[activeIdx] : null;

  // query 变化时回到第一条命中。
  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  // 暴露当前命中给父级(用于滚动 + 容器高亮)。
  useEffect(() => {
    onActiveChange?.(currentId);
  }, [currentId, onActiveChange]);

  // 暴露命中集合(供父级高亮命中容器)。
  useEffect(() => {
    onHitsChange?.(hitIds);
  }, [hitIds, onHitsChange]);

  // 打开时聚焦输入框。
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    } else {
      // 关闭时清空,避免残留高亮。
      setQuery("");
    }
  }, [open]);

  const step = useCallback(
    (dir: 1 | -1) => {
      if (total === 0) return;
      setActiveIdx((i) => (i + dir + total) % total);
    },
    [total],
  );

  // 键盘:Enter 下一个,Shift+Enter 上一个,Esc 关闭。
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div className="findbar" role="search">
      <input
        ref={inputRef}
        className="findbar__input"
        type="text"
        value={query}
        placeholder="在当前对话中查找…"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label="查找"
      />
      <span className="findbar__count">
        {query ? (total > 0 ? `${activeIdx + 1}/${total}` : "0/0") : ""}
      </span>
      <button
        type="button"
        className="findbar__btn"
        onClick={() => step(-1)}
        disabled={total === 0}
        title="上一个(Shift+Enter)"
        aria-label="上一个"
      >
        <ChevronLeftIcon size="sm" />
      </button>
      <button
        type="button"
        className="findbar__btn"
        onClick={() => step(1)}
        disabled={total === 0}
        title="下一个(Enter)"
        aria-label="下一个"
      >
        <ChevronDownIcon size="sm" />
      </button>
      <button
        type="button"
        className="findbar__btn"
        onClick={onClose}
        title="关闭(Esc)"
        aria-label="关闭查找"
      >
        <XCloseIcon size="sm" />
      </button>
    </div>
  );
}

/** 懒加载 extractPlainText,避免循环依赖时把整条消息结构耦合进来。 */
function extractForSearch(m: ChatMessage): string {
  return extractPlainText(m);
}

/** 供调用方判断某条消息是否命中(高亮容器)。 */
export function isFindHit(hitIds: string[], messageId: string): boolean {
  return hitIds.includes(messageId);
}
