/**
 * 分享 / 导出菜单 —— 对齐 WorkBuddy `share:*`(导出对话 / 分享链接)。
 *
 * OpenBuddy 本地导出(markdown/html/text 下载 + mailto 分享意图),不上传云端。
 * 由 ChatView 顶栏「分享」按钮触发。
 */
import { useEffect, useRef, useState } from "react";
import { Share } from "lucide-react";
import {
  buildSharePayload,
  buildMailtoUrl,
  triggerDownload,
  type ShareFormat,
} from "@openbuddy/chat-core/share";
import type { ChatMessage } from "@/features/chat/state/session-store";
import { save as saveDialog } from "@openbuddy/client/ipc";
import { agentExportHtml } from "@openbuddy/client/agent-client";
import { sanitizeFilename } from "@openbuddy/chat-core/export-markdown";
import { copyText } from "@openbuddy/platform/clipboard";

/** Mail clients reject very long mailto: URLs; the full text goes through 导出. */
const MAIL_BODY_LIMIT = 1800;

interface ShareMenuProps {
  messages: ChatMessage[];
  title?: string;
  /** 宿主回调(打开系统邮件客户端)。依赖注入便于测试;缺省用 window.open。 */
  openUrl?: (url: string) => void;
  onDone?: (msg: string) => void;
  /** Enables Pi's own HTML export (full session incl. tool steps). */
  sessionId?: string;
}

export function ShareMenu({ messages, title, openUrl, onDone, sessionId }: ShareMenuProps) {
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

  // 导出网页: Pi's exporter renders the whole session (tools, diffs, thinking) as one HTML file.
  const exportPage = async () => {
    setOpen(false);
    if (!sessionId) return;
    try {
      const target = await saveDialog({ title: "导出网页", defaultPath: `${sanitizeFilename(title || "对话")}.html`, filters: [{ name: "网页", extensions: ["html"] }] });
      if (!target) return;
      await agentExportHtml(sessionId, target);
      onDone?.("已导出网页");
    } catch (e) {
      onDone?.(`导出失败：${String(e instanceof Error ? e.message : e)}`);
    }
  };

  // 复制内容并打开邮件客户端 (U8.1): the full text goes to the clipboard, the mail
  // body carries what fits in a mailto: URL.
  const shareMail = async () => {
    const payload = buildSharePayload(messages, "text", title);
    const long = payload.content.length > MAIL_BODY_LIMIT;
    const copied = await copyText(payload.content).then(() => true, () => false);
    const body = long ? `${payload.content.slice(0, MAIL_BODY_LIMIT)}\n\n……（内容较长，${copied ? "完整内容已复制，可直接粘贴" : "完整对话请用导出保存后作为附件发送"}）` : payload.content;
    const url = buildMailtoUrl(title || "对话分享", body);
    (openUrl ?? ((u: string) => window.open(u, "_blank")))(url);
    setOpen(false);
    onDone?.(copied ? "已复制对话内容并打开邮件客户端" : "已打开邮件客户端");
  };

  return (
    <div className="share-menu" ref={ref}>
      <button
        type="button"
        className={"main-topbar__btn" + (open ? " main-topbar__btn--active" : "")}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="分享"
        aria-expanded={open}
        data-tip="导出 / 分享本会话"
      >
        <Share size={16} strokeWidth={1.75} />
      </button>
      {open && (
        <div className="share-menu__popover" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="share-menu__item" onClick={() => exportAs("markdown")}>
            导出 Markdown
          </button>
          {sessionId && (
            <button type="button" className="share-menu__item" onClick={() => void exportPage()}>
              导出网页（含步骤）
            </button>
          )}
          <button type="button" className="share-menu__item" onClick={() => exportAs("html")}>
            导出 HTML（仅对话）
          </button>
          <button type="button" className="share-menu__item" onClick={() => exportAs("text")}>
            导出纯文本
          </button>
          <div className="share-menu__divider" />
          <button type="button" className="share-menu__item" onClick={() => void shareMail()}>
            复制并用邮件分享
          </button>
        </div>
      )}
    </div>
  );
}
