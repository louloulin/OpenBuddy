/**
 * 分享 / 导出菜单 —— 对齐 WorkBuddy `share:*`(导出对话 / 分享链接)。
 *
 * OpenBuddy 本地导出(markdown/html/text 下载 + mailto 分享意图),不上传云端。
 * 由 ChatView 顶栏「分享」按钮触发。
 */
import { useEffect, useRef, useState } from "react";
import { Share2 } from "lucide-react";
import {
  buildSharePayload,
  buildMailtoUrl,
  triggerDownload,
  type ShareFormat,
} from "@/lib/collaboration/share";
import type { ChatMessage } from "@/stores/session-store";

interface ShareMenuProps {
  messages: ChatMessage[];
  title?: string;
  /** 宿主回调(打开系统邮件客户端)。依赖注入便于测试;缺省用 window.open。 */
  openUrl?: (url: string) => void;
  onDone?: (msg: string) => void;
}

export function ShareMenu({ messages, title, openUrl, onDone }: ShareMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const exportAs = (format: ShareFormat) => {
    const payload = buildSharePayload(messages, format, title);
    triggerDownload(payload);
    setOpen(false);
    onDone?.(`已导出 ${payload.filename}`);
  };

  const shareMail = () => {
    const payload = buildSharePayload(messages, "text", title);
    const url = buildMailtoUrl(title || "对话分享", payload.content);
    (openUrl ?? ((u: string) => window.open(u, "_blank")))(url);
    setOpen(false);
    onDone?.("已打开邮件分享");
  };

  return (
    <div className="share-menu" ref={ref}>
      <button
        type="button"
        className={
          "chatview__tool-btn" +
          (open ? " chatview__tool-btn--active" : "")
        }
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="导出 / 分享本会话"
        data-tip="分享 / 导出"
      >
        <Share2 size={15} strokeWidth={1.75} />
      </button>
      {open && (
        <div className="share-menu__popover" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="share-menu__item" onClick={() => exportAs("markdown")}>
            导出 Markdown
          </button>
          <button type="button" className="share-menu__item" onClick={() => exportAs("html")}>
            导出 HTML
          </button>
          <button type="button" className="share-menu__item" onClick={() => exportAs("text")}>
            导出纯文本
          </button>
          <div className="share-menu__divider" />
          <button type="button" className="share-menu__item" onClick={shareMail}>
            通过邮件分享
          </button>
        </div>
      )}
    </div>
  );
}
