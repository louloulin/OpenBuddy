/**
 * StreamingCaret — 流式文本末尾的打字机 caret。
 *
 * 视觉:1.5px 宽垂直线,呼吸动画(700ms ease-in-out),位于流式文本最后。
 *
 * 行为:
 *   - 仅当 `active === true && !complete` 时显示
 *   - 用 CSS 动画(避免 requestAnimationFrame 与 React 渲染耦合)
 *   - 不阻挡文本选择(pointer-events: none)
 *   - 主题色:reasoning 时用品牌色,其他时候灰
 *
 * 用法:
 *   <ConversationMarkdown text={...} streaming={active} />
 *   {active && !complete && <StreamingCaret theme="reasoning" />}
 */
import { memo } from "react";

export type StreamingCaretTheme = "loose" | "reasoning";

export type StreamingCaretProps = {
  /** 是否启用 caret;为 false 时返回 null。 */
  active: boolean;
  /** 流式阶段的 markdown 主题,用于选择 caret 颜色。 */
  theme?: StreamingCaretTheme;
  /** 流式 markdown 主题(可选重命名,与上面 theme 等价)。 */
  markdownTheme?: StreamingCaretTheme;
  /** 自定义 className。 */
  className?: string;
};

function StreamingCaretInner({ active, theme, markdownTheme, className }: StreamingCaretProps) {
  if (!active) return null;
  const resolved = (theme ?? markdownTheme ?? "loose") as StreamingCaretTheme;
  return (
    <span
      className={`streaming-caret streaming-caret--${resolved}${className ? " " + className : ""}`}
      aria-hidden="true"
      data-testid="streaming-caret"
    />
  );
}

export const StreamingCaret = memo(StreamingCaretInner);
