/**
 * MessageRewindMenu — 消息级撤销/分叉入口(Plan5 B.10)。
 *
 * 学习 Codex / Claude / Cursor 的"hover 一条消息 → 从此处重发 / 分叉"模式,
 * 把 RewindBar 的会话级入口下放到消息级,长 session 时不必滚到底。
 *
 * 用法:
 *   - ChatView 在 assistant 消息的 footer 渲染 `<MessageRewindMenu>`
 *     (默认 opacity 较低,hover/聚焦时满显)
 *   - 不修改 MessageItem 的核心测试断言 — 该组件**只渲染一个按钮组**,
 *     通过 `data-testid` 选择器定位
 *
 * 数据源:会话级 `rewindPoints` — 该组件不直接走 IPC,而是接收调用方
 * 已经拿到的 `promptIndex`,避免在每条消息上各发一次 IPC(round-trip 成本)。
 *
 * 视觉:与 Codex 风格一致 — 一行两个 icon-only 按钮 + tooltip + 键盘可达。
 */
import { useState } from "react";
import { Undo2, GitFork } from "lucide-react";

export type MessageRewindMenuProps = {
  /** 该 assistant 消息的回溯点 promptIndex(由调用方从 rewindPoints 里解析)。 */
  promptIndex?: number;
  /** 会话 id(调用方传入,组件负责做调用前的存在性校验)。 */
  sessionId?: string | null;
  /** 当前消息 id(用于 onAction 回溯时上报)。 */
  messageId: string;
  /** 是否允许 fork。Plan5 暂不在组件内 fork——只暴露重发。 */
  allowFork?: boolean;
  /** 实际执行回退:`rewindExecute(sessionId, promptIndex, mode, force=true)`。
   *  调用方负责映射 ipc,因为 ChatView 已经持有 pi-client 的引用。
   *  返回 Promise<void>。 */
  onRewind?: (params: { promptIndex: number }) => Promise<void> | void;
  onFork?: () => void;
  onToast?: (msg: string) => void;
};

export function MessageRewindMenu({
  promptIndex,
  sessionId,
  messageId,
  allowFork = false,
  onRewind,
  onFork,
  onToast,
}: MessageRewindMenuProps) {
  const [busy, setBusy] = useState(false);

  const handleRewind = async () => {
    if (typeof promptIndex !== "number" || !sessionId || !onRewind) return;
    setBusy(true);
    try {
      await onRewind({ promptIndex });
      onToast?.("已从此消息重发");
    } catch (e) {
      onToast?.(`重发失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(false);
    }
  };

  const rewindDisabled = busy || typeof promptIndex !== "number" || !sessionId;

  return (
    <div
      className="msg-rewind-menu"
      data-message-id={messageId}
      data-prompt-index={typeof promptIndex === "number" ? promptIndex : undefined}
      role="group"
      aria-label="消息级撤销/分叉"
    >
      <button
        type="button"
        className="msg-rewind-menu__btn"
        data-testid="msg-rewind"
        onClick={handleRewind}
        disabled={rewindDisabled}
        title="从此消息开始重发"
        aria-label="从此消息开始重发"
      >
        <Undo2 size={13} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {allowFork && onFork && (
        <button
          type="button"
          className="msg-rewind-menu__btn"
          data-testid="msg-fork"
          onClick={onFork}
          disabled={busy}
          title="从此处分叉"
          aria-label="从此处分叉"
        >
          <GitFork size={13} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
