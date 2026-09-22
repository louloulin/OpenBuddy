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

function formatSecondsZh(ms: number): string {
  if (ms < 1000) return "思考中";
  return `已思考 ${formatDurationMs(ms)}`;
}

export function ThoughtMessagePart(props: MessagePartRenderProps) {
  if (props.part.kind !== "thought") return null;
  const currentTheme = useThemeSnapshot((s) => s.current());
  const resolvedTheme = (props.theme ?? currentTheme) as "light" | "dark";
  // 流式时显示"思考中 X 秒",每秒刷新一次;折叠时显示"已思考 X 秒"。
  const [tickMs, setTickMs] = useState(0);
  useEffect(() => {
    if (!props.isStreaming || props.complete) return;
    const start = Date.now();
    setTickMs(0);
    const handle = window.setInterval(() => setTickMs(Date.now() - start), 500);
    return () => window.clearInterval(handle);
  }, [props.isStreaming, props.complete, props.part.text]);
  const elapsedMs = props.isStreaming ? tickMs : null;
  const label = elapsedMs !== null ? formatSecondsZh(elapsedMs) : formatSecondsZh(0);

  return (
    <details
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
          {props.isStreaming && !props.complete ? "思考中" : "深度思考"}
        </span>
        <span className="msg__thought-elapsed">{label}</span>
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
