/**
 * QueuedMessages —— 消息队列的 composer 一等插槽(A1,对齐 Claude
 * `ChatComposerDock` 的 QueuedMessages 插槽结构,REA 实测 2.31226.1)。
 *
 * 与 automation 包的 QueuePanel 的关系:
 *   - 同一份 store(`message-queue-store`),不是两套存储;
 *   - QueuePanel 是块级面板(automation 独立嵌入场景仍可用);
 *   - 本组件是 **chat 面的紧凑 dock 条**:一行一条 = 序号 + 截断摘要 +
 *     暂停/删除/立即发送,头部常显计数。挂在 composer 上方。
 *
 * 键盘:↑/↓ 在行间移动焦点(useRowPanelNav,row-panel 范式);Home/End 跳端。
 */
import { useRef } from "react";
import { useMessageQueueStore } from "@/stores/message-queue-store";
import { useRowPanelNav } from "../chatview/useRowPanelNav";
import { useLocale } from "@openbuddy/ui-locale/client";
import {
  XCloseIcon,
  PauseIcon,
  PlayIcon,
  SendPlaneIcon,
} from "@openbuddy/ui-primitives/icons";

export interface QueuedMessagesProps {
  sessionId: string;
  /** 手动「立即发送」:调用方负责 piSend。 */
  onSendNow?: (text: string) => void;
}

/** 摘要截断上限:一行内不换行,超出省略。 */
const SUMMARY_MAX_CHARS = 60;

export function QueuedMessages({ sessionId, onSendNow }: QueuedMessagesProps) {
  const queue = useMessageQueueStore((s) => s.queues[sessionId] ?? []);
  const remove = useMessageQueueStore((s) => s.remove);
  const setPaused = useMessageQueueStore((s) => s.setPaused);
  // 注意:必须用 useLocale().t 而不是 `const t = useT` —— 后者把 hook 函数
  // 存下来在 early return 之后调用,hook 数量随 queue.length 变化,直接触发
  // React 错误 310 崩掉整个对话视图(2026-10-14 真实启动实测)。
  const locale = useLocale();
  const containerRef = useRef<HTMLDivElement>(null);
  useRowPanelNav({ containerRef, rowSelector: "[data-queued-row]" });

  if (queue.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="composer-queued"
      role="listbox"
      aria-label={locale.t("chat.queue.aria")}
      aria-describedby="composer-queued-hint"
    >
      <div className="composer-queued__head">
        <span>{locale.t("chat.queue.count", { count: String(queue.length) })}</span>
        <span id="composer-queued-hint" className="composer-queued__hint">{locale.t("chat.queue.hint")}</span>
      </div>
      {queue.map((item, index) => (
        <div
          key={item.id}
          className={"composer-queued__row" + (item.paused ? " composer-queued__row--paused" : "")}
          role="option"
          aria-selected={false}
          data-queued-row=""
          tabIndex={0}
        >
          <span className="composer-queued__index">{index + 1}</span>
          <span className="composer-queued__summary" title={item.text}>
            {item.text.length > SUMMARY_MAX_CHARS
              ? `${item.text.slice(0, SUMMARY_MAX_CHARS)}…`
              : item.text}
          </span>
          <button
            type="button"
            className="composer-queued__btn"
            aria-label={item.paused ? locale.t("chat.queue.resume") : locale.t("chat.queue.pause")}
            title={item.paused ? locale.t("chat.queue.resume") : locale.t("chat.queue.pause")}
            onClick={() => setPaused(sessionId, item.id, !item.paused)}
          >
            {item.paused ? <PlayIcon size="sm" /> : <PauseIcon size="sm" />}
          </button>
          <button
            type="button"
            className="composer-queued__btn"
            aria-label={locale.t("chat.queue.sendNow")}
            title={locale.t("chat.queue.sendNow")}
            onClick={() => {
              remove(sessionId, item.id);
              onSendNow?.(item.text);
            }}
          >
            <SendPlaneIcon size="sm" />
          </button>
          <button
            type="button"
            className="composer-queued__btn"
            aria-label={locale.t("chat.queue.remove")}
            title={locale.t("chat.queue.remove")}
            onClick={() => remove(sessionId, item.id)}
          >
            <XCloseIcon size="sm" />
          </button>
        </div>
      ))}
    </div>
  );
}
