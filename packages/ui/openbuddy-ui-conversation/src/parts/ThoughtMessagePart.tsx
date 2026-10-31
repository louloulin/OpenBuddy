/**
 * ThoughtMessagePart — assistant 消息的"推理/思考"部件。
 *
 * Phase B.2:实时流式卡片（实时流式 + 折叠卡）。
 *   - 流式时:显示带"思考中"标题 + 沙漏 icon + 实时耗时的渐变描边卡片
 *   - 完成时:折叠为"已思考 X 秒"单行 chip;点击展开 → 全文本 markdown
 *   - 视觉与 Codex / Claude 一致;用 `--wb-*` 品牌令牌
 *
 * 与改造前 `MessageItem.tsx:451-465` 兼容:
 *   - 保留 `<details class="msg__thought">` 结构(快照测试通过)
 *   - 增加数据属性 `data-thinking-streaming` 用于 caret/动画 CSS hook
 *   - 内部 markdown 主题 reasoning
 */
import { useEffect, useState } from "react";
import { useThemeSnapshot } from "@openbuddy/ui-theme/client";
import { Hourglass, Clock3 } from "lucide-react";
import { ConversationMarkdown } from "../conversation-slots";
import { formatDurationMs } from "@/lib/ui/duration";
import type { MessagePartRenderProps } from "./registry-defaults";

export function ThoughtMessagePart(props: MessagePartRenderProps) {
  // hook 必须在类型守卫之前调用(React 错误 300 号,同 TextMessagePart)。
  const currentTheme = useThemeSnapshot((s) => s.current());
  const [tickMs, setTickMs] = useState<number | null>(null);
  // 计时起点只在进入流式时取一次。此前依赖 part.text,每个 delta 都重置起点,
  // 流式中耗时永远 <1s、标题上看不到计时。
  const isLive = props.isStreaming && !props.complete;
  useEffect(() => {
    if (!isLive) return;
    const start = Date.now();
    setTickMs(0);
    const handle = window.setInterval(() => setTickMs(Date.now() - start), 500);
    return () => window.clearInterval(handle);
  }, [isLive]);
  // 流式中默认展开(用户能看到模型在想什么),完成后自动收起;用户手动
  // 展开/收起之后以用户为准。
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? isLive;
  if (props.part.kind !== "thought") return null;

  const resolvedTheme = (props.theme ?? currentTheme) as "light" | "dark";
  // 流式时显示"思考中 X 秒",每秒刷新一次;折叠时显示"已思考 X 秒"。
  /**
   * 自身计时:流式期间每 500ms 刷新,结束后**冻结**。
   *
   * 这里的坑:原实现用 `props.isStreaming ? tickMs : null` 取耗时,完成时拿到 null,
   * 于是回退到 `formatSecondsZh(0)` —— 而 `<1000ms` 恰好返回「思考中」。结果一个
   * **已经回答完**的思考块标题写着「深度思考 思考中」(2026-10-11 真机截图可见)。
   * 现在:计时值自己保存,完成时保留最后读数;从未在本组件里流式过(例如重载后
   * 直接看到历史)就不显示耗时,而不是显示一句错的。
   */
  const streaming = props.isStreaming && !props.complete;
  /**
   * 耗时只在**测到 ≥1s** 时才显示,且流式与完成用两套措辞:
   *   - 流式中:`· 3s`(主标签已经是「思考中」,再写一次「思考中」就是重复 ——
   *     旧实现在 <1s 时正是这样:标题渲染出「思考中 思考中」)
   *   - 已完成:`已思考 3s`
   * 从未在本组件里流式过(重载后直接看历史)时留空,不编一个数字。
   */
  const elapsedText =
    tickMs === null || tickMs < 1000
      ? ""
      : streaming
        ? `· ${formatDurationMs(tickMs)}`
        : `已思考 ${formatDurationMs(tickMs)}`;

  return (
    <details
      open={open}
      onToggle={(e) => {
        const next = (e.currentTarget as HTMLDetailsElement).open;
        if (next !== open) setUserOpen(next);
      }}
      className={
        "msg__thought" +
        (props.isStreaming && !props.complete ? " msg__thought--streaming" : "")
      }
      data-thinking-streaming={props.isStreaming && !props.complete ? "true" : "false"}
      data-thinking-complete={props.complete ? "true" : "false"}
    >
      <summary>
        <span className="msg__thought-icon" aria-hidden="true">
          {props.isStreaming && !props.complete ? (
            <Hourglass size={12} strokeWidth={1.75} className="msg__thought-icon-stream" />
          ) : (
            <Clock3 size={12} strokeWidth={1.75} />
          )}
        </span>
        <span className="msg__thought-label">
          {streaming ? "思考中" : "深度思考"}
        </span>
        <span className="msg__thought-elapsed">{elapsedText}</span>
      </summary>
      <div className="msg__thought-body">
        <ConversationMarkdown
          text={props.part.text}
          streaming={props.isStreaming}
          complete={props.complete}
          markdownTheme="reasoning"
          theme={resolvedTheme}
          config={props.markdownConfig as never}
        />
      </div>
    </details>
  );
}
