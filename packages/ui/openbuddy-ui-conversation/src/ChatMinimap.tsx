/**
 * ChatMinimap.tsx — long-conversation color-block navigation map.
 *
 * Phase 5 (UI 差距补齐) sub-item A: 对标 pi-web 的会话缩略图。渲染一条垂直色块
 * 导航条，每个色块代表会话中的一个消息段（用户/助手/工具/系统/压缩/分支），
 * 点击色块跳转到对应消息。当前活跃段高亮。
 *
 * 纯展示组件：无 store 读取、无 I/O。输入为 `segments`（纯数据），输出为
 * 可点击的色块条。颜色复用 `--wb-*` 设计令牌，零新 CSS 概念。
 */
import type { CSSProperties } from "react";

export type ChatMinimapSegmentKind =
  | "user"
  | "assistant"
  | "tool"
  | "system"
  | "compaction"
  | "branch";

export interface ChatMinimapSegment {
  id: string;
  kind: ChatMinimapSegmentKind;
  label?: string;
}

export interface ChatMinimapProps {
  /** Ordered conversation segments (oldest first). */
  segments: ChatMinimapSegment[];
  /** Currently active segment id (highlighted). */
  activeId?: string;
  /** Called when a segment block is clicked. */
  onJump?: (id: string) => void;
  className?: string;
  /** Accessible label for the map. */
  label?: string;
}

/** Map a segment kind to a `--wb-*` color token. */
export function minimapColor(kind: ChatMinimapSegmentKind): string {
  switch (kind) {
    case "user":
      return "var(--wb-accent)";
    case "assistant":
      return "var(--wb-fg-primary)";
    case "tool":
      return "var(--wb-warning)";
    case "system":
      return "var(--wb-fg-tertiary)";
    case "compaction":
      return "var(--wb-success)";
    case "branch":
      return "var(--wb-danger)";
    default:
      return "var(--wb-fg-tertiary)";
  }
}

export function ChatMinimap({
  segments,
  activeId,
  onJump,
  className,
  label = "会话缩略图",
}: ChatMinimapProps) {
  if (segments.length === 0) return null;

  return (
    <div
      className={"chat-minimap" + (className ? ` ${className}` : "")}
      role="navigation"
      aria-label={label}
      data-testid="chat-minimap"
    >
      {segments.map((segment) => {
        const active = segment.id === activeId;
        const style: CSSProperties = {
          backgroundColor: minimapColor(segment.kind),
          ...(active ? { outline: "2px solid var(--wb-accent)", outlineOffset: "1px" } : {}),
        };
        return (
          <button
            key={segment.id}
            type="button"
            className={"chat-minimap__block" + (active ? " chat-minimap__block--active" : "")}
            style={style}
            title={segment.label ?? segment.kind}
            aria-label={segment.label ?? segment.kind}
            aria-current={active ? "true" : undefined}
            data-testid={`chat-minimap-block-${segment.id}`}
            onClick={() => onJump?.(segment.id)}
          />
        );
      })}
    </div>
  );
}
