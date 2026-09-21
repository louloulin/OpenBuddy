/**
 * composer/ActionButtons — the streaming-conditional send / enqueue / stop
 * button group in the Composer's footer.
 *
 * Goal mu7rpkze-gc769z / phase3-composer-split. The streaming-conditional
 * render of enqueue+stop buttons (when `streaming === true`) vs the send
 * button (when `streaming === false`) used to live inline in
 * `Composer.tsx` (~58 lines including the wrapper conditionals, disabled
 * states, accessibility labels, and title tooltips). Phase-3 split moved
 * it into this sub-component so the orchestrator file stays under the
 * 800-line cap while preserving exact behaviour.
 *
 * Behaviour contract:
 *  - `streaming === true`:
 *      - If `onEnqueue` is provided AND the user has typed non-empty text,
 *        show the "+" enqueue button (WorkBuddy message-queue parity).
 *      - Always show the stop button (always enabled — even when
 *        `apiReady === false` / `disabled === true` — so the user has a
 *        guaranteed escape hatch during a stuck stream).
 *  - `streaming === false`:
 *      - Show the send button. Disabled when there's no text AND no
 *        attachments (R0.8), or when `disabled` is true.
 *      - `wb-composer__send--empty` class is applied when the buffer is
 *        empty (purely visual; disabled state is independent).
 */
import { Square } from "lucide-react";
import { SendPlaneIcon } from "@openbuddy/ui-primitives/icons";

export interface ActionButtonsProps {
  /** True while the model is streaming a response (drives stop-vs-send). */
  streaming: boolean;
  /** Whether the API key is configured (disables send + changes title). */
  apiReady: boolean;
  /** Whether the composer is externally disabled. */
  disabled?: boolean;
  /** Current text in the textarea (drives enqueue visibility + send disable). */
  text: string;
  /** Number of path attachments (drives send-disable when text is empty). */
  attachmentCount: number;
  /** Whether voice input is currently listening (decorates the mic button). */
  listening: boolean;
  /** Enqueue handler (WorkBuddy message-queue parity). */
  onEnqueue?: (text: string) => void;
  /** Send handler. */
  onSend: (text: string) => void;
  /** Stop handler (always available — guaranteed escape hatch). */
  onCancel: () => void;
}

export function ActionButtons(props: ActionButtonsProps) {
  const {
    streaming,
    apiReady,
    disabled,
    text,
    attachmentCount,
    listening,
    onEnqueue,
    onSend,
    onCancel,
  } = props;
  if (streaming) {
    return (
      <>
        {/* 流式时可加入待发送队列(对齐 WorkBuddy message-queue)。 */}
        {onEnqueue && text.trim() !== "" && (
          <button
            className="wb-composer__send wb-composer__send--enqueue"
            onClick={(e) => {
              e.stopPropagation();
              onEnqueue(text);
            }}
            disabled={disabled || !apiReady}
            aria-label="加入待发送队列"
            title="加入待发送队列(agent 完成后自动发送)"
          >
            +
          </button>
        )}
        <button
          className="wb-composer__send wb-composer__send--stop"
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
          // R6.8 — 停止按钮必须永远可点。即便 apiReady=false / disabled=true,
          // 用户面对"AI 卡死但 UI 整体还能动"时,这是唯一的逃生口。
          // 取消本身不依赖 apiReady(走 piCancel 单独的 IPC 通道)。
          disabled={false}
          aria-label="停止生成"
          title="停止生成(若 AI 长时间无响应,可强制中断)"
        >
          <Square size={12} strokeWidth={2.5} aria-hidden="true" />
        </button>
      </>
    );
  }
  return (
    <button
      className={
        "wb-composer__send" +
        (text.trim() === "" && attachmentCount === 0
          ? " wb-composer__send--empty"
          : "")
      }
      // R0.8: disable send when there's no content AND no attachments,
      // when disabled by parent (e.g. api not ready), or while streaming.
      disabled={
        (text.trim() === "" && attachmentCount === 0) ||
        disabled ||
        streaming
      }
      onClick={(e) => {
        e.stopPropagation();
        onSend(text);
      }}
      aria-label="发送"
      title={!apiReady ? "请先配置 API Key" : "发送消息"}
    >
      <SendPlaneIcon size="md" />
    </button>
  );
}