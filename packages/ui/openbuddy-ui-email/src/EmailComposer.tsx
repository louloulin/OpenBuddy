import { useEffect, useMemo, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { open as openDialog } from "@/lib/platform/electron-api";
import { ConfirmDialog, type ConfirmTone } from "@openbuddy/ui-dialogs";
import { PromptDialog } from "@openbuddy/ui-dialogs";
import { ModalShell, ModalHead, ModalBody, ModalFooter } from "@openbuddy/ui-dialogs";
import { emailCancelPendingSend, emailCreateDraft, emailPrepareScheduleSend, emailPrepareSend, emailQueueSend, emailScheduleSend, type EmailAccount, type EmailDraft, type EmailPendingSend } from "@/lib/agent/pi-client";
import type { EmailContact } from "@/lib/email/email-contacts";

interface EmailComposerProps {
  account: EmailAccount;
  accounts?: EmailAccount[];
  contacts?: EmailContact[];
  onSaved: (draft: EmailDraft) => void;
  onClose: () => void;
  initial?: Partial<{ draftId: string; accountId: string; to: string; cc: string; bcc: string; subject: string; body: string; threadId: string; messageId: string }>;
}

function addresses(value: string, contacts: readonly EmailContact[] = []) {
  return value.split(/[;,\n]/).map((item) => item.trim()).filter(Boolean).map((item) => {
    const match = item.match(/^(.*?)\s*<([^<>]+)>$/);
    const name = match?.[1]?.trim();
    const address = (match?.[2] ?? item).trim();
    const contact = contacts.find((candidate) => candidate.address.toLowerCase() === address.toLowerCase() || candidate.name?.toLowerCase() === address.toLowerCase());
    return { address: contact?.address ?? address, ...(name || contact?.name ? { name: name || contact?.name } : {}) };
  });
}

function mentionedAddresses(body: string) {
  return [...body.matchAll(/@([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/g)].map((match) => ({ address: match[1] }));
}

function documentLinks(body: string) {
  return [...body.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g)].map((match) => ({ label: match[1], url: match[2] }));
}

function uniqueAddresses(values: Array<{ address: string; name?: string }>) {
  return [...new Map(values.map((item) => [item.address.toLowerCase(), item])).values()];
}

function markdownToSafeHtml(value: string): string {
  return renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{value || ""}</ReactMarkdown>);
}

function avatarInitial(value: string): string {
  const trimmed = value.replace(/[^A-Za-z0-9一-龥]/g, "");
  return trimmed.slice(0, 1).toUpperCase() || "?";
}

interface EmailQuickTemplate { id: string; name: string; subject?: string; body: string }
const TEMPLATE_STORAGE_KEY = "openbuddy.email.quick-templates";
const SIGNATURE_STORAGE_KEY = "openbuddy.email.signature";

function loadTemplates(): EmailQuickTemplate[] {
  try {
    const value = JSON.parse(localStorage.getItem(TEMPLATE_STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is EmailQuickTemplate => Boolean(item && typeof item === "object" && typeof (item as EmailQuickTemplate).id === "string" && typeof (item as EmailQuickTemplate).name === "string" && typeof (item as EmailQuickTemplate).body === "string")) : [];
  } catch { return []; }
}

const MailEnvelopeIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M3.5 6.5 L12 13 L20.5 6.5" />
  </svg>
);

const PaperclipIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 11.5 L11.5 21 a5.5 5.5 0 0 1 -7.8 -7.8 L13.4 3.6 a4 4 0 0 1 5.7 5.7 L9.4 18.9 a2.5 2.5 0 0 1 -3.6 -3.6 L14.5 6.5" />
  </svg>
);

const ClockIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7 L12 12 L15.5 14" />
  </svg>
);

const EyeIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1.5 12 C5 6.5 8.5 4.5 12 4.5 C15.5 4.5 19 6.5 22.5 12 C19 17.5 15.5 19.5 12 19.5 C8.5 19.5 5 17.5 1.5 12 Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const PencilIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14.5 4 L20 9.5 L8.5 21 L3 21 L3 15.5 Z" />
    <path d="M13 5.5 L18.5 11" />
  </svg>
);

const LinkIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 14 a4 4 0 0 0 5.7 0 L19 10.7 a4 4 0 1 0 -5.7 -5.7 L11.5 6.8" />
    <path d="M14 10 a4 4 0 0 0 -5.7 0 L5 13.3 a4 4 0 1 0 5.7 5.7 L12.5 17.2" />
  </svg>
);

const SaveIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 4 H17 L20 7 V20 H4 V4 Z" />
    <path d="M8 4 V10 H16 V4" />
    <path d="M8 14 H16 V20 H8 Z" />
  </svg>
);

const SendIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 2 L11 13" />
    <path d="M22 2 L15 22 L11 13 L2 9 Z" />
  </svg>
);

const UndoIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 14 L4 9 L9 4" />
    <path d="M4 9 H14 a6 6 0 0 1 0 12 H10" />
  </svg>
);

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 7 H20" />
    <path d="M9 7 V5 a2 2 0 0 1 2 -2 H13 a2 2 0 0 1 2 2 V7" />
    <path d="M6 7 L7 20 a2 2 0 0 0 2 2 H15 a2 2 0 0 0 2 -2 L18 7" />
  </svg>
);

export function EmailComposer({ account, accounts = [account], contacts = [], onSaved, onClose, initial }: EmailComposerProps) {
  const availableAccounts = accounts;
  const [accountId, setAccountId] = useState(initial?.accountId ?? account.id);
  const selectedAccount = availableAccounts.find((item) => item.id === accountId) ?? account;
  const [to, setTo] = useState(initial?.to ?? "");
  const [cc, setCc] = useState(initial?.cc ?? "");
  const [bcc, setBcc] = useState(initial?.bcc ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [signature, setSignature] = useState(() => localStorage.getItem(SIGNATURE_STORAGE_KEY) ?? "");
  const [body, setBody] = useState(() => initial?.body ?? (signature.trim() ? signature : ""));
  const [attachments, setAttachments] = useState<string[]>([]);
  const [draft, setDraft] = useState<EmailDraft | null>(null);
  const [editingDraftId, setEditingDraftId] = useState(initial?.draftId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduleAt, setScheduleAt] = useState("");
  const [templates, setTemplates] = useState<EmailQuickTemplate[]>(loadTemplates);
  const [pendingSend, setPendingSend] = useState<EmailPendingSend | null>(null);
  const [undoSeconds, setUndoSeconds] = useState(0);
  const [preview, setPreview] = useState(false);
  const [showCc, setShowCc] = useState(Boolean(initial?.cc));
  const [showBcc, setShowBcc] = useState(Boolean(initial?.bcc));
  const [showSchedule, setShowSchedule] = useState(false);

  type PendingConfirm = {
    title: string;
    description?: string;
    tone?: ConfirmTone;
    confirmLabel?: string;
    resolve: (ok: boolean) => void;
  };
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const requestConfirm = (cfg: Omit<PendingConfirm, "resolve">): Promise<boolean> =>
    new Promise((resolve) => {
      setPendingConfirm({ ...cfg, resolve });
    });
  const closeConfirm = (ok: boolean) => {
    setPendingConfirm((current) => {
      current?.resolve(ok);
      return null;
    });
  };

  type PendingPrompt = {
    title: string;
    description?: string;
    multiline?: boolean;
    placeholder?: string;
    defaultValue?: string;
    hint?: string;
    validate?: (value: string) => string | null | undefined;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: ConfirmTone;
    resolve: (value: string | null) => void;
  };
  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt | null>(null);
  const requestPrompt = (cfg: Omit<PendingPrompt, "resolve">): Promise<string | null> =>
    new Promise((resolve) => {
      setPendingPrompt({ ...cfg, resolve });
    });
  const closePrompt = (value: string | null) => {
    setPendingPrompt((current) => {
      current?.resolve(value);
      return null;
    });
  };

  const save = async (): Promise<EmailDraft | null> => {
    if (!uniqueAddresses(addresses(to, contacts)).length || !subject.trim()) { setError("请填写收件人和主题"); return null; }
    setBusy(true); setError(null);
    try {
      const next = await emailCreateDraft({ draftId: draft?.id ?? editingDraftId, accountId: selectedAccount.id, to: uniqueAddresses(addresses(to, contacts)), cc: uniqueAddresses([...addresses(cc, contacts), ...mentionedAddresses(body)]), bcc: addresses(bcc, contacts), subject: subject.trim(), body, bodyHtml: markdownToSafeHtml(body), attachments, threadId: initial?.threadId, messageId: initial?.messageId });
      setDraft(next); setEditingDraftId(next.id); onSaved(next); return next;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存草稿失败"); return null; }
    finally { setBusy(false); }
  };

  const addAttachments = async () => {
    if (!selectedAccount.capabilities.attachments) return;
    const selected = await openDialog({ multiple: true, title: "选择邮件附件" });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    setAttachments((current) => [...new Set([...current, ...paths])]);
  };

  const addDocumentLink = () => {
    void (async () => {
      const label = await requestPrompt({
        title: "插入文档链接",
        description: "文档名称将作为链接文字，链接必须是 http(s) 地址。",
        placeholder: "文档名称，例如《2026 战略》",
        defaultValue: "OpenBuddy 文档",
        confirmLabel: "下一步",
      });
      if (!label?.trim()) return;
      const url = await requestPrompt({
        title: "文档链接",
        description: `文档「${label.trim()}」对应的链接。`,
        placeholder: "https://example.com/doc",
        defaultValue: "https://",
        confirmLabel: "插入",
        validate: (value) => /^https:\/\//.test(value.trim()) ? null : "链接必须以 http:// 或 https:// 开头",
      });
      if (!url) return;
      setBody((current) => `${current}${current && !current.endsWith("\n") ? "\n" : ""}[${label.trim()}](${url.trim()})`);
    })();
  };

  const applyTemplate = (template: EmailQuickTemplate) => {
    if (template.subject) setSubject(template.subject);
    setBody((current) => `${template.body}${current.trim() ? `\n\n${current}` : ""}${signature.trim() && !current.trim().endsWith(signature.trim()) ? `\n\n${signature}` : ""}`);
  };

  const saveTemplate = () => {
    void (async () => {
      if (!body.trim()) { setError("正文为空，无法保存为模板"); return; }
      const name = await requestPrompt({
        title: "保存邮件模板",
        description: "保存后可在「插入快捷模板」中重复使用。",
        placeholder: "模板名称",
        defaultValue: subject.trim() || "新邮件模板",
        confirmLabel: "保存",
      });
      if (!name?.trim()) return;
      const next = [...templates.filter((item) => item.name !== name.trim()), { id: `template-${Date.now().toString(36)}`, name: name.trim(), subject: subject.trim(), body }];
      localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(next));
      setTemplates(next);
      setError(null);
    })();
  };

  const editSignature = () => {
    void (async () => {
      const next = await requestPrompt({
        title: "编辑默认签名",
        description: "留空表示删除签名。",
        multiline: true,
        placeholder: "签名内容",
        defaultValue: signature,
        confirmLabel: signature.trim() ? "保存" : "清空",
      });
      if (next === null) return;
      localStorage.setItem(SIGNATURE_STORAGE_KEY, next);
      setSignature(next);
    })();
  };

  const send = async () => {
    let current = draft;
    if (!current) current = await save();
    if (!current) return;
    const recipients = current.to.map((item) => item.address).join(", ");
    const ok = await requestConfirm({
      title: "确认发送邮件?",
      description: `将发送给 ${recipients}。邮件将先进入 5 秒撤回窗口,期间可点击「撤回发送」取消。`,
      tone: "info",
      confirmLabel: "发送",
    });
    if (!ok) return;
    setBusy(true); setError(null);
    try { const token = await emailPrepareSend(current.id); const pending = await emailQueueSend(current.id, token, 5_000); setPendingSend(pending); setUndoSeconds(Math.max(1, Math.ceil((Date.parse(pending.sendAt) - Date.now()) / 1_000))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "发送失败"); }
    finally { setBusy(false); }
  };

  const cancelPending = async () => {
    if (!pendingSend) return;
    setBusy(true); setError(null);
    try { await emailCancelPendingSend(pendingSend.id); setPendingSend(null); setUndoSeconds(0); setError("已撤回发送，草稿仍保留"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "撤回发送失败"); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (!pendingSend) return undefined;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((Date.parse(pendingSend.sendAt) - Date.now()) / 1_000));
      setUndoSeconds(remaining);
      if (remaining === 0) { window.clearInterval(timer); setPendingSend(null); onClose(); }
    }, 250);
    return () => window.clearInterval(timer);
  }, [onClose, pendingSend]);

  const schedule = async () => {
    const current = draft ?? await save();
    if (!current) return;
    let raw = scheduleAt;
    if (!raw.trim()) {
      const picked = await requestPrompt({
        title: "设置计划发送时间",
        description: "支持 RFC3339 / ISO 8601 时间，例如 2026-09-01T09:00:00+08:00",
        placeholder: "2026-09-01T09:00:00+08:00",
        defaultValue: new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 19) + "+08:00",
        confirmLabel: "使用此时间",
        validate: (value) => {
          const parsed = new Date(value.trim());
          if (!Number.isFinite(parsed.getTime())) return "无法解析该时间，请使用 RFC3339 格式";
          if (parsed.getTime() <= Date.now()) return "时间必须是未来";
          return null;
        },
      });
      if (!picked?.trim()) return;
      raw = picked.trim();
    }
    const scheduledAt = new Date(raw);
    if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) { setError("计划发送时间必须是未来的有效时间"); return; }
    const recipients = current.to.map((item) => item.address).join(", ");
    const ok = await requestConfirm({
      title: "确认计划发送?",
      description: `将于 ${scheduledAt.toLocaleString()} 发送给 ${recipients}。`,
      tone: "info",
      confirmLabel: "排程发送",
    });
    if (!ok) return;
    setBusy(true); setError(null);
    try { const token = await emailPrepareScheduleSend(current.id, scheduledAt.toISOString()); await emailScheduleSend(current.id, scheduledAt.toISOString(), token); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "计划发送失败"); }
    finally { setBusy(false); }
  };

  const senderInitials = useMemo(() => avatarInitial(selectedAccount.name ?? selectedAccount.address), [selectedAccount]);
  const linkCount = documentLinks(body).length;
  const recipientCount = uniqueAddresses(addresses(to, contacts)).length;
  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0;
  const isDraft = Boolean(draft || editingDraftId);

  return (
    <ModalShell
      open
      tone="info"
      size="xl"
      variant="wide"
      ariaLabel="撰写邮件"
      role="dialog"
      className="email-composer-modal"
      busy={busy}
      onClose={() => { if (!pendingSend) onClose(); }}
    >
      <ModalHead
        icon={<MailEnvelopeIcon />}
        eyebrow={isDraft ? "邮件草稿 · DRAFT" : "邮件 · EMAIL"}
        title={isDraft ? subject.trim() || "未命名草稿" : "撰写邮件"}
        badge={
          <span className="email-composer__count-pill" aria-label="收件人数量">
            {recipientCount} 位收件人
          </span>
        }
        meta={
          availableAccounts.length > 1 ? (
            <label className="email-composer__account-switch">
              <span className="email-composer__avatar" aria-hidden="true">{senderInitials}</span>
              <select
                aria-label="发件账户"
                value={selectedAccount.id}
                onChange={(event) => { setAccountId(event.target.value); setDraft(null); setEditingDraftId(undefined); }}
              >
                <option value="" disabled>选择发件账户</option>
                {availableAccounts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name ? `${item.name} · ` : ""}{item.address}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="email-composer__account-display" aria-label="发件账户">
              <span className="email-composer__avatar" aria-hidden="true">{senderInitials}</span>
              <span className="email-composer__account-meta">
                <strong>{selectedAccount.name ?? selectedAccount.address}</strong>
                {selectedAccount.name ? <small>{selectedAccount.address}</small> : null}
              </span>
            </span>
          )
        }
        onClose={() => { if (!pendingSend) onClose(); }}
      />

      <ModalBody padded={false} className="email-composer__body">
        {error && (
          <div className="email-composer__alert email-composer__alert--error" role="alert">
            <span className="email-composer__alert-dot" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {pendingSend && (
          <div className="email-composer__alert email-composer__alert--pending" role="status">
            <ClockIcon />
            <span>
              <strong>邮件将在 {undoSeconds} 秒后发送</strong>
              <small>收件人尚未收到，可以在此期间撤回。</small>
            </span>
            <button type="button" className="email-composer__alert-action" onClick={() => void cancelPending()} disabled={busy}>
              <UndoIcon />
              撤回发送
            </button>
          </div>
        )}

        <div className="email-composer__fields">
          <datalist id="openbuddy-email-contacts">
            {contacts.map((contact) => (
              <option key={contact.address} value={contact.address} label={contact.name ? `${contact.name} · ${contact.address}` : contact.address} />
            ))}
          </datalist>

          <div className="email-composer__field email-composer__field--primary">
            <span className="email-composer__field-label" aria-hidden="true">收件人</span>
            <input
              className="email-composer__field-input"
              aria-label="收件人"
              list="openbuddy-email-contacts"
              placeholder="收件人邮箱、姓名或 姓名 <邮箱>，多个用逗号分隔"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
            <div className="email-composer__field-toggles">
              {!showCc && (
                <button type="button" className="email-composer__chip" onClick={() => setShowCc(true)}>抄送</button>
              )}
              {!showBcc && (
                <button type="button" className="email-composer__chip" onClick={() => setShowBcc(true)}>密送</button>
              )}
            </div>
          </div>

          {showCc && (
            <div className="email-composer__field">
              <span className="email-composer__field-label" aria-hidden="true">抄送</span>
              <input
                className="email-composer__field-input"
                aria-label="抄送"
                list="openbuddy-email-contacts"
                placeholder="抄送地址（可选）"
                value={cc}
                onChange={(event) => setCc(event.target.value)}
              />
              <button type="button" className="email-composer__field-close" aria-label="隐藏抄送" onClick={() => { setShowCc(false); setCc(""); }}>×</button>
            </div>
          )}

          {showBcc && (
            <div className="email-composer__field">
              <span className="email-composer__field-label" aria-hidden="true">密送</span>
              <input
                className="email-composer__field-input"
                aria-label="密送"
                list="openbuddy-email-contacts"
                placeholder="密送地址（可选）"
                value={bcc}
                onChange={(event) => setBcc(event.target.value)}
              />
              <button type="button" className="email-composer__field-close" aria-label="隐藏密送" onClick={() => { setShowBcc(false); setBcc(""); }}>×</button>
            </div>
          )}

          <div className="email-composer__field">
            <span className="email-composer__field-label" aria-hidden="true">主题</span>
            <input
              className="email-composer__field-input"
              aria-label="主题"
              placeholder="一句话说清邮件目的"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>
        </div>

        <div className="email-composer__editor">
          <div className="email-composer__toolbar" role="toolbar" aria-label="正文工具">
            <button
              type="button"
              className={`email-composer__tool ${preview ? "is-active" : ""}`}
              onClick={() => setPreview((current) => !current)}
              disabled={busy}
              aria-pressed={preview}
            >
              {preview ? <><PencilIcon /> 编辑正文</> : <><EyeIcon /> 预览正文</>}
            </button>
            <span className="email-composer__tool-divider" aria-hidden="true" />
            <select
              aria-label="快捷模板"
              className="email-composer__tool-select"
              defaultValue=""
              onChange={(event) => {
                const template = templates.find((item) => item.id === event.target.value);
                if (template) applyTemplate(template);
                event.currentTarget.value = "";
              }}
            >
              <option value="">插入快捷模板</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>{template.name}</option>
              ))}
            </select>
            <button type="button" className="email-composer__tool" onClick={saveTemplate} disabled={busy || !body.trim()}>
              <SaveIcon /> 保存为模板
            </button>
            <button type="button" className="email-composer__tool" onClick={editSignature} disabled={busy}>
              <PencilIcon /> {signature.trim() ? "编辑签名" : "设置签名"}
            </button>
            {signature.trim() && (
              <span className="email-composer__tool-status">已设置签名</span>
            )}
          </div>

          <div className="email-composer__editor-surface">
            {preview ? (
              <div className="email-composer__preview" aria-label="正文预览">
                {body.trim() ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                    {body}
                  </ReactMarkdown>
                ) : (
                  <p className="email-composer__empty">正文为空，开始撰写吧。</p>
                )}
              </div>
            ) : (
              <textarea
                className="email-composer__textarea"
                aria-label="正文"
                placeholder="撰写正文… 支持 Markdown 与 @提及 收件人；可用 [文档名](链接) 插入文档链接。"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={12}
              />
            )}
          </div>

          <div className="email-composer__meta-row" aria-live="polite">
            <span className="email-composer__meta">{wordCount} 字</span>
            <span className="email-composer__meta">{attachments.length} 个附件</span>
            {linkCount > 0 && (
              <span className="email-composer__meta email-composer__meta--accent">
                <LinkIcon /> 已识别 {linkCount} 个文档链接；邮件不会自动修改文档权限，请确认收件人可访问。
              </span>
            )}
            {contacts.length > 0 && (
              <span className="email-composer__meta email-composer__meta--muted">
                联系人建议来自已读取邮件，仅使用姓名、地址和最近联系信息，不保存邮件正文
              </span>
            )}
          </div>
        </div>

        {attachments.length > 0 && (
          <div className="email-composer__attachments" aria-label="附件">
            {attachments.map((path) => (
              <span key={path} className="email-composer__attachment">
                <PaperclipIcon />
                <span className="email-composer__attachment-name">{path.split(/[\\/]/).pop()}</span>
                <button
                  type="button"
                  className="email-composer__attachment-remove"
                  aria-label={`移除附件 ${path.split(/[\\/]/).pop()}`}
                  onClick={() => setAttachments((current) => current.filter((item) => item !== path))}
                >
                  <TrashIcon />
                </button>
              </span>
            ))}
          </div>
        )}

        {showSchedule && (
          <div className="email-composer__schedule">
            <ClockIcon />
            <span className="email-composer__schedule-label">计划发送时间</span>
            <input
              className="email-composer__schedule-input"
              aria-label="计划发送时间"
              type="datetime-local"
              value={scheduleAt}
              onChange={(event) => setScheduleAt(event.target.value)}
            />
            <button
              type="button"
              className="email-composer__schedule-clear"
              onClick={() => { setShowSchedule(false); setScheduleAt(""); }}
              aria-label="取消计划发送"
            >取消</button>
          </div>
        )}
      </ModalBody>

      <ModalFooter
        hint={
          <span className="email-composer__footer-hint">
            <kbd>⌘</kbd>+<kbd>Enter</kbd> 发送 · <kbd>Esc</kbd> 关闭
          </span>
        }
      >
        <button
          type="button"
          className="email-composer__btn email-composer__btn--ghost"
          onClick={addDocumentLink}
          disabled={busy || Boolean(pendingSend)}
        >
          <LinkIcon /> 插入文档链接
        </button>
        <button
          type="button"
          className="email-composer__btn email-composer__btn--ghost"
          onClick={() => void addAttachments()}
          disabled={busy || Boolean(pendingSend) || !selectedAccount.capabilities.attachments}
        >
          <PaperclipIcon /> 添加附件
        </button>
        <button
          type="button"
          className="email-composer__btn email-composer__btn--secondary"
          onClick={() => setShowSchedule((current) => !current)}
          disabled={busy || Boolean(pendingSend)}
          aria-pressed={showSchedule}
        >
          <ClockIcon /> 计划发送
        </button>
        <button
          type="button"
          className="email-composer__btn email-composer__btn--secondary"
          onClick={() => void save()}
          disabled={busy || Boolean(pendingSend)}
        >
          <SaveIcon /> {busy ? "处理中…" : "保存草稿"}
        </button>
        <button
          type="button"
          className="email-composer__btn email-composer__btn--primary"
          onClick={() => void (showSchedule ? schedule() : send())}
          disabled={busy || Boolean(pendingSend)}
        >
          <SendIcon /> {showSchedule ? "排程发送" : "发送"}
        </button>
      </ModalFooter>

      {pendingConfirm && (
        <ConfirmDialog
          open
          title={pendingConfirm.title}
          description={pendingConfirm.description}
          tone={pendingConfirm.tone}
          confirmLabel={pendingConfirm.confirmLabel}
          busy={busy}
          onConfirm={() => closeConfirm(true)}
          onCancel={() => closeConfirm(false)}
        />
      )}
      {pendingPrompt && (
        <PromptDialog
          open
          title={pendingPrompt.title}
          description={pendingPrompt.description}
          tone={pendingPrompt.tone}
          multiline={pendingPrompt.multiline}
          placeholder={pendingPrompt.placeholder}
          defaultValue={pendingPrompt.defaultValue}
          hint={pendingPrompt.hint}
          validate={pendingPrompt.validate}
          confirmLabel={pendingPrompt.confirmLabel}
          cancelLabel={pendingPrompt.cancelLabel}
          busy={busy}
          onConfirm={(value) => closePrompt(value)}
          onCancel={() => closePrompt(null)}
        />
      )}
    </ModalShell>
  );
}
