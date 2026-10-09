/**
 * CitationChip — 内联引用标记 chip。
 *
 * 在 markdown 文本里以 `[[cite:source-id]]` 出现的占位符会被 StreamingMarkdown
 * 替换为这个组件。视觉对齐 Codex / Cursor / Perplexity 的"引用角标"风格:
 * 一条上标角标 + 主体里悬停可见的来源标题。
 *
 * 数据来源(Plan5 B.5):
 *   - 优先读取 `<ChatCitationProvider>` 注入的 `resolveCitation(id)` 回调
 *     —— 由宿主(ChatView)在拿到会话级 citation 索引后注入
 *   - 缺省时回退到 id 直显(`[source-id]`),保留视觉位置以保证后续异步补全
 *
 * 交互:
 *   - 点击 → `onSelect?(citation)`(宿主决定是滚到来源 / 打开侧栏 / 复制 id)
 *   - 键盘可达 — 默认 `<button>`,focus ring 来自 `--wb-*` 令牌
 */
import { memo, useContext } from "react";
import { createContext } from "react";
import type { ReactNode } from "react";
import { Hash } from "lucide-react";

export type Citation = {
  id: string;
  title: string;
  /** e.g. "https://...", "doc.pdf p.12", "L42-L58" */
  locator?: string;
};

export type CitationResolver = (id: string) => Citation | undefined;

type ChatCitationContextValue = {
  resolve: CitationResolver | undefined;
};

const ChatCitationContext = createContext<ChatCitationContextValue>({
  resolve: undefined,
});

export type ChatCitationProviderProps = {
  resolve?: CitationResolver;
  children: ReactNode;
};

export function ChatCitationProvider({ resolve, children }: ChatCitationProviderProps) {
  return (
    <ChatCitationContext.Provider value={{ resolve }}>
      {children}
    </ChatCitationContext.Provider>
  );
}

export function useCitationResolver(): CitationResolver | undefined {
  return useContext(ChatCitationContext).resolve;
}

export type CitationChipProps = {
  sourceId: string;
  onSelect?: (citation: Citation) => void;
};

function CitationChipInner({ sourceId, onSelect }: CitationChipProps) {
  const resolver = useCitationResolver();
  const resolved = resolver?.(sourceId);
  const label = resolved?.title ?? sourceId;
  const handleClick = () => {
    if (resolved) onSelect?.(resolved);
  };
  return (
    <button
      type="button"
      className="citation-chip"
      data-citation-id={sourceId}
      data-citation-resolved={resolved ? "true" : "false"}
      title={resolved?.locator ? `${label} — ${resolved.locator}` : label}
      onClick={handleClick}
    >
      <Hash size={11} strokeWidth={2} aria-hidden="true" className="citation-chip__icon" />
      <span className="citation-chip__label">{label}</span>
    </button>
  );
}

export const CitationChip = memo(CitationChipInner);
