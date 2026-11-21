import { memo, useState } from "react";
import type { ChatMessage } from "@/features/chat/state/session-store";
import { Markdown } from "@openbuddy/markdown";
import { useTheme } from "@openbuddy/ui/ThemeProvider";
import { UserBubble } from "../UserBubble";
import { BashRow } from "./BashRow";

/** One prompt row; memoized so streaming elsewhere does not re-render it. */
export const UserNode = memo(function UserNode({ message, editable, onEditFrom, onToast }: {
  message: ChatMessage;
  editable: boolean;
  onEditFrom: (messageId: string, text: string, resend: boolean) => Promise<void>;
  onToast: (msg: string) => void;
}) {
  return <UserBubble message={message} onToast={onToast} onEdit={editable ? (text, resend) => onEditFrom(message.id, text, resend) : undefined} />;
});

/**
 * 提示行 (§5.1): "上下文已压缩 ›" / "已切换到其他分支 ›" expand to the summary
 * Pi wrote; extension messages show their text; `!command` shows its output.
 */
export const NoticeRow = memo(function NoticeRow({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const { theme } = useTheme();
  const kind = message.meta?.notice;
  const text = message.parts[0]?.kind === "text" ? message.parts[0].text : "";
  const label = kind === "compaction" ? "上下文已压缩" : kind === "branch" ? "已切换到其他分支" : kind === "bash" ? "命令" : "扩展消息";
  // `!command` rows know what ran and how it ended (W1.2); older rows only have text.
  if (kind === "bash" && message.meta?.bash) return <BashRow message={message} />;
  if (kind === "bash") {
    return (
      <div className="chat-notice" data-msg-ids={message.id}>
        <span className="chat-notice__label">{label}</span>
        {text && <pre className="chat-notice__body">{text}</pre>}
      </div>
    );
  }
  return (
    <div className={"chat-notice" + (open ? " chat-notice--open" : "")} data-msg-ids={message.id}>
      {text ? (
        <button type="button" className="chat-notice__label chat-notice__toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {label}<span className="chat-notice__chev" aria-hidden>›</span>
        </button>
      ) : <span className="chat-notice__label">{label}</span>}
      {open && text && <div className="chat-notice__summary"><Markdown complete theme={theme}>{text}</Markdown></div>}
    </div>
  );
});
