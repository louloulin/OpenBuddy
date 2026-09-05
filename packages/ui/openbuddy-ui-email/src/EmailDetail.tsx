/**
 * EmailDetail — 线程详情和 AI 工作流展示层。
 *
 * 详情组件只负责渲染和把用户意图转成 callbacks；AI 生成、审阅、草稿采纳、
 * 任务/提醒/日历链接仍由 EmailPanel 的 orchestration 层执行。
 */
import type { EmailAccount, EmailAnalysisRecord, EmailManagementCapability, EmailThread } from "@openbuddy/capability-email";
import { sanitizeEmailHtml } from "./lib/safe-email-html";

export interface EmailDetailProps {
  selected: EmailThread | null;
  selectedAccount?: EmailAccount;
  folder: string;
  messageIndex: number;
  analyses: EmailAnalysisRecord[];
  activeAnalysisId: string | null;
  projectsCount: number;
  canManageSelected: boolean;
  canManageOperation: (operation: EmailManagementCapability) => boolean;
  onUpdate: (kind: Extract<EmailManagementCapability, "mark-read" | "mark-unread" | "archive" | "restore" | "star" | "trash" | "spam" | "label">, confirmed?: boolean) => void;
  onSnooze: () => void;
  onChangeLabel: (add: boolean) => void;
  onDelete: (kind: "trash" | "spam") => void;
  onSenderPolicy: (policy: "signal" | "noise" | "block") => void;
  onShare: () => void;
  onFollowup: () => void;
  onMoveToProject: () => void;
  onReply: (replyAll: boolean) => void;
  onMessageIndexChange: (index: number) => void;
  onRunAi: (kind: "summary" | "actions" | "meeting" | "reply" | "task") => void;
  onDownloadAttachment: (messageId: string, attachmentId: string) => void;
  onUnsubscribe: (message: EmailThread["messages"][number]) => void;
  onReviewAnalysis: (id: string, review: "accepted" | "dismissed") => void;
  onAdoptReplyDraft: (analysis: EmailAnalysisRecord) => void;
  onAdoptActionsAsTasks: (analysis: EmailAnalysisRecord) => void;
  onAdoptActionsAsProjectTasks: (analysis: EmailAnalysisRecord) => void;
  onCreateReminder: (analysis: EmailAnalysisRecord) => void;
  onProposeMeeting: (analysis: EmailAnalysisRecord) => void;
}

function kindLabel(kind: EmailAnalysisRecord["kind"]): string {
  return kind === "summary" ? "摘要" : kind === "actions" ? "行动项" : kind === "risk" ? "风险" : kind === "meeting" ? "会议提案" : "回复草稿";
}

function citationLabel(messageId: string): string { return `邮件消息 ${messageId.slice(0, 8)}`; }

export function EmailDetail(props: EmailDetailProps): JSX.Element {
  const { selected } = props;
  if (!selected) return <section className="email-detail" aria-label="邮件详情"><div className="email-empty email-empty--inviting"><strong>选择左侧线程查看详情</strong><span>在左侧列表选中一个线程后，这里会展示邮件正文、附件与 AI 分析。<br />键盘提示：<kbd>Enter</kbd> 打开 · <kbd>Esc</kbd> 返回 · <kbd>r</kbd> AI 摘要 · <kbd>c</kbd>+<kbd>r</kbd> 生成回复草稿。</span></div></section>;
  const currentMessage = selected.messages[props.messageIndex];
  const hasUnread = selected.messages.some((message) => message.unread);
  const writable = props.selectedAccount?.capabilities.write === true;
  return (
    <section className="email-detail" aria-label="邮件详情">
      <div className="email-detail__actions">
        <button type="button" disabled={!props.canManageOperation(hasUnread ? "mark-read" : "mark-unread")} onClick={() => props.onUpdate(hasUnread ? "mark-read" : "mark-unread")}>{hasUnread ? "标记已读" : "标记未读"}</button>
        <button type="button" disabled={!props.canManageOperation(props.folder === "archive" ? "restore" : "archive")} onClick={() => props.onUpdate(props.folder === "archive" ? "restore" : "archive")}>{props.folder === "archive" ? "恢复到收件箱" : "归档"}</button>
        <button type="button" disabled={!props.canManageOperation("star")} onClick={() => props.onUpdate("star")}>收藏</button>
        <button type="button" disabled={!props.canManageOperation("snooze")} onClick={props.onSnooze}>稍后处理</button>
        <button type="button" disabled={!props.canManageOperation("label-add")} onClick={() => props.onChangeLabel(true)}>添加标签</button>
        <button type="button" disabled={!props.canManageOperation("label-remove")} onClick={() => props.onChangeLabel(false)}>移除标签</button>
        <button type="button" disabled={!props.canManageOperation("trash")} onClick={() => props.onDelete("trash")}>删除</button>
        <button type="button" disabled={!props.canManageOperation("spam")} onClick={() => props.onDelete("spam")}>垃圾邮件</button>
        <button type="button" disabled={!props.canManageSelected} onClick={() => props.onSenderPolicy("signal")}>发件人 Signal</button>
        <button type="button" disabled={!props.canManageSelected} onClick={() => props.onSenderPolicy("noise")}>发件人 Noise</button>
        <button type="button" disabled={!props.canManageSelected} onClick={() => props.onSenderPolicy("block")}>阻断发件人</button>
        <button type="button" onClick={props.onShare}>分享线程</button><button type="button" onClick={props.onFollowup}>跟进提醒</button><button type="button" onClick={props.onMoveToProject}>关联项目</button>
        <button type="button" onClick={() => props.onReply(false)} disabled={!writable}>回复</button><button type="button" onClick={() => props.onReply(true)} disabled={!writable}>回复全部</button>
      </div>
      <div className="email-message-nav"><button type="button" onClick={() => props.onMessageIndexChange(Math.max(props.messageIndex - 1, 0))} disabled={props.messageIndex === 0}>上一封</button><span>{props.messageIndex + 1} / {selected.messages.length}</span><button type="button" onClick={() => props.onMessageIndexChange(Math.min(props.messageIndex + 1, selected.messages.length - 1))} disabled={props.messageIndex === selected.messages.length - 1}>下一封</button></div>
      <div className="email-ai-actions"><strong>AI 工作流</strong>{(["summary", "actions", "meeting", "reply", "task"] as const).map((kind) => <button type="button" key={kind} onClick={() => props.onRunAi(kind)}>{kind === "summary" ? "摘要" : kind === "actions" ? "提取行动项" : kind === "meeting" ? "识别会议" : kind === "reply" ? "生成回复草稿" : "转为任务建议"}</button>)}</div>
      <div className="email-ai-analyses">{props.analyses.map((analysis) => <article key={analysis.id} className={`email-ai-analysis ${props.activeAnalysisId === analysis.id ? "is-active" : ""}`}>
        <header><strong>{kindLabel(analysis.kind)}</strong><span>置信度 {(analysis.confidence * 100).toFixed(0)}% · {analysis.needsReview ? "需审阅" : "自动"} · {new Date(analysis.generatedAt).toLocaleTimeString()}</span></header>
        {analysis.summary ? <p className="email-ai-analysis__summary">{analysis.summary}</p> : null}
        {analysis.facts.length > 0 ? <ul className="email-ai-analysis__facts">{analysis.facts.map((fact, index) => <li key={index}><span>{fact.statement}</span><small>{fact.citations.map((citation) => citationLabel(citation.messageId)).join(" · ")}</small></li>)}</ul> : null}
        {analysis.actions.length > 0 ? <ul className="email-ai-analysis__actions">{analysis.actions.map((action, index) => <li key={index}><span>{action.content}</span><small>{action.owner ? `负责人：${action.owner}` : ""}{action.dueAt ? ` · 截止 ${action.dueAt}` : ""}</small></li>)}</ul> : null}
        {analysis.replyDraft ? <div className="email-ai-analysis__reply"><strong>建议主题：{analysis.replyDraft.subject}</strong><pre>{analysis.replyDraft.body}</pre></div> : null}
        {analysis.meetingProposal ? <div className="email-ai-analysis__meeting"><strong>建议加入日历：{analysis.meetingProposal.title}</strong><small>{new Date(analysis.meetingProposal.start).toLocaleString()} - {new Date(analysis.meetingProposal.end).toLocaleTimeString()}</small>{analysis.meetingProposal.meetingUrl ? <p className="email-ai-analysis__meeting-link">会议链接仅作参考，不会自动打开</p> : null}</div> : null}
        <footer><span className={`email-ai-analysis__review email-ai-analysis__review--${analysis.review}`}>审阅状态：{analysis.review === "pending" ? "待审阅" : analysis.review === "accepted" ? "已采纳" : "已驳回"}</span>{analysis.review === "pending" ? <><button type="button" onClick={() => props.onReviewAnalysis(analysis.id, "accepted")}>采纳</button><button type="button" onClick={() => props.onReviewAnalysis(analysis.id, "dismissed")}>驳回</button></> : null}{analysis.kind === "reply" && analysis.replyDraft && analysis.review === "pending" ? <button type="button" onClick={() => props.onAdoptReplyDraft(analysis)}>采纳草稿</button> : null}{analysis.actions.length > 0 && !analysis.linkedTaskIds?.length ? <button type="button" onClick={() => props.onAdoptActionsAsTasks(analysis)}>采纳行动项为任务</button> : null}{analysis.actions.length > 0 && props.projectsCount > 0 && !analysis.linkedProjectTaskIds?.length ? <button type="button" onClick={() => props.onAdoptActionsAsProjectTasks(analysis)}>采纳到项目任务</button> : null}{analysis.kind === "actions" && !analysis.linkedReminderIds?.length ? <button type="button" onClick={() => props.onCreateReminder(analysis)}>创建跟进提醒</button> : null}{analysis.meetingProposal && analysis.confidence >= 0.7 && !analysis.linkedCalendarTaskId ? <button type="button" onClick={() => props.onProposeMeeting(analysis)}>提交日历审批</button> : null}</footer>
      </article>)}</div>
      <h2>{selected.subject || "（无主题）"}</h2>
      {selected.messages.map((message, index) => <article className={`email-message ${index === props.messageIndex ? "is-current" : ""}`} key={message.id}><div className="email-message__header"><strong>{message.from.name || message.from.address}</strong><small>{new Date(message.date).toLocaleString()}</small></div>{message.unsubscribeLinks?.length ? <div className="email-message__unsubscribe"><span>发现 {message.unsubscribeLinks.length} 个退订入口</span><button type="button" disabled={!props.canManageOperation("unsubscribe")} onClick={() => props.onUnsubscribe(message)}>退订邮件列表</button></div> : null}{message.html ? <div className="email-message__body" dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(message.html) }} /> : <p className="email-message__body">{message.text || "（无正文）"}</p>}{message.attachments.length > 0 ? <div className="email-message__attachments">{message.attachments.map((attachment) => <button type="button" key={attachment.id} onClick={() => props.onDownloadAttachment(message.id, attachment.id)}>下载 {attachment.name}</button>)}</div> : null}</article>)}
    </section>
  );
}
