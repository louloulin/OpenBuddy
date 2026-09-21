/**
 * AiMessageList — 共享邮件消息渲染(替代占位文本)。
 *
 * 第 3 周改进(P2-1):复用 EmailDetail 的渲染逻辑 — 安全的 HTML / 附件 / 退订入口 / 引用嵌套。
 *
 * 设计:从 AiInboxShell 抽出 messages 段,使 EmailDetail 与 AiMessageList 共享同一渲染路径。
 * AiInboxShell 之前用占位文本("这里会渲染原邮件消息..."),现在改为真正渲染。
 */
import { sanitizeEmailHtml } from "../../lib/safe-email-html";

export interface AiMessageAttachment {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
}

export interface AiMessage {
  id: string;
  from: { name?: string; address: string };
  date: string;
  text?: string;
  html?: string;
  unread: boolean;
  attachments: AiMessageAttachment[];
  unsubscribeLinks?: string[];
}

export interface AiMessageListProps {
  messages: AiMessage[];
  messageIndex?: number;
  /** 退订按钮回调 — 若未提供则按钮 disabled。 */
  onUnsubscribe?: (message: AiMessage) => void;
  /** 附件下载回调。 */
  onDownloadAttachment?: (messageId: string, attachmentId: string) => void;
  /** 操作权限检查(默认允许)。 */
  canManageOperation?: (op: string) => boolean;
}

export function AiMessageList({
  messages,
  messageIndex = 0,
  onUnsubscribe,
  onDownloadAttachment,
  canManageOperation = () => true,
}: AiMessageListProps): JSX.Element {
  if (messages.length === 0) {
    return (
      <div className="ai-message-list__empty">
        <p>（无消息）</p>
      </div>
    );
  }
  return (
    <div className="ai-message-list" data-thread-active-index={messageIndex}>
      {messages.map((message, index) => (
        <article
          key={message.id}
          className={`ai-message ${index === messageIndex ? "is-current" : ""}`}
          data-message-id={message.id}
        >
          <div className="ai-message__header">
            <strong>{message.from.name || message.from.address}</strong>
            <small>{new Date(message.date).toLocaleString()}</small>
          </div>
          {message.unsubscribeLinks && message.unsubscribeLinks.length > 0 ? (
            <div className="ai-message__unsubscribe">
              <span>发现 {message.unsubscribeLinks.length} 个退订入口</span>
              <button
                type="button"
                disabled={!canManageOperation("unsubscribe") || !onUnsubscribe}
                onClick={() => onUnsubscribe?.(message)}
              >
                退订邮件列表
              </button>
            </div>
          ) : null}
          {message.html ? (
            <div
              className="ai-message__body"
              dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(message.html) }}
            />
          ) : (
            <p className="ai-message__body">{message.text || "（无正文）"}</p>
          )}
          {message.attachments.length > 0 ? (
            <div className="ai-message__attachments">
              {message.attachments.map((attachment) => (
                <button
                  type="button"
                  key={attachment.id}
                  onClick={() => onDownloadAttachment?.(message.id, attachment.id)}
                >
                  📎 下载 {attachment.name}
                </button>
              ))}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}
