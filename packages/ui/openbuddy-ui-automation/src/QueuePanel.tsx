/**
 * 消息队列面板 —— 对齐 WorkBuddy `cb-chat-ui/message-queue-panel`。
 *
 * agent 流式工作时,用户仍可继续排队 prompt。本面板渲染某会话的队列条目,
 * 支持编辑/删除/上移下移/暂停/恢复/立即发送。流式结束后由 App 自动续发
 * 下一条 active 项(本面板的「立即发送」是手动触发)。
 */
import { useState } from "react";
import { useMessageQueueStore, type QueueItem } from "@/stores/message-queue-store";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  XCloseIcon,
  PauseIcon,
  PlayIcon,
} from "@openbuddy/ui-primitives/icons";

export interface QueuePanelProps {
  sessionId: string;
  /** 手动「立即发送」一条:调用方负责 piSend。 */
  onSendNow?: (text: string) => void;
}

export function QueuePanel({ sessionId, onSendNow }: QueuePanelProps) {
  const queue = useMessageQueueStore((s) => s.queues[sessionId] ?? []);
  const remove = useMessageQueueStore((s) => s.remove);
  const reorder = useMessageQueueStore((s) => s.reorder);
  const setPaused = useMessageQueueStore((s) => s.setPaused);
  const update = useMessageQueueStore((s) => s.update);

  if (queue.length === 0) return null;

  return (
    <div className="queue-panel" role="list" aria-label="待发送队列">
      <div className="queue-panel__head">
        <span>待发送队列({queue.length})</span>
        <span className="queue-panel__hint">agent 完成回复后自动发送下一条</span>
      </div>
      {queue.map((item, idx) => (
        <QueueRow
          key={item.id}
          sessionId={sessionId}
          item={item}
          index={idx}
          total={queue.length}
          onRemove={() => remove(sessionId, item.id)}
          onUp={() => reorder(sessionId, idx, idx - 1)}
          onDown={() => reorder(sessionId, idx, idx + 1)}
          onTogglePause={() => setPaused(sessionId, item.id, !item.paused)}
          onCommitEdit={(text) => update(sessionId, item.id, text)}
          onSendNow={() => {
            remove(sessionId, item.id);
            onSendNow?.(item.text);
          }}
        />
      ))}
    </div>
  );
}

interface QueueRowProps {
  sessionId: string;
  item: QueueItem;
  index: number;
  total: number;
  onRemove: () => void;
  onUp: () => void;
  onDown: () => void;
  onTogglePause: () => void;
  onCommitEdit: (text: string) => void;
  onSendNow: () => void;
}

function QueueRow({
  item,
  index,
  total,
  onRemove,
  onUp,
  onDown,
  onTogglePause,
  onCommitEdit,
  onSendNow,
}: QueueRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const paused = item.paused;

  const commit = () => {
    const t = draft.trim();
    if (t) onCommitEdit(t);
    else onRemove();
    setEditing(false);
  };

  return (
    <div
      className={"queue-row" + (paused ? " queue-row--paused" : "")}
      role="listitem"
    >
      <span className="queue-row__index">{index + 1}</span>
      {editing ? (
        <textarea
          className="queue-row__edit"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              setDraft(item.text);
              setEditing(false);
            }
          }}
        />
      ) : (
        <span
          className="queue-row__text"
          title="点击编辑"
          onClick={() => {
            setDraft(item.text);
            setEditing(true);
          }}
        >
          {item.text}
        </span>
      )}
      <span className="queue-row__actions">
        <button
          type="button"
          className="queue-row__btn"
          onClick={onUp}
          disabled={index === 0}
          title="上移"
          aria-label="上移"
        >
          <ChevronLeftIcon size="sm" />
        </button>
        <button
          type="button"
          className="queue-row__btn"
          onClick={onDown}
          disabled={index === total - 1}
          title="下移"
          aria-label="下移"
        >
          <ChevronRightIcon size="sm" />
        </button>
        <button
          type="button"
          className="queue-row__btn"
          onClick={onTogglePause}
          title={paused ? "恢复" : "暂停"}
          aria-label={paused ? "恢复" : "暂停"}
          aria-pressed={paused}
        >
          {paused ? <PlayIcon size="sm" /> : <PauseIcon size="sm" />}
        </button>
        <button
          type="button"
          className="queue-row__btn queue-row__btn--send"
          onClick={onSendNow}
          disabled={paused}
          title="立即发送"
          aria-label="立即发送"
        >
          发送
        </button>
        <button
          type="button"
          className="queue-row__btn"
          onClick={onRemove}
          title="删除"
          aria-label="删除"
        >
          <XCloseIcon size="sm" />
        </button>
      </span>
    </div>
  );
}
