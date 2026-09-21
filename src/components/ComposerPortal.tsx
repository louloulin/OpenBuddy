/**
 * ComposerPortal — 全局 Composer 模态挂载点。
 *
 * 第 4-5 周(P1-A):监听 `useComposerStore`,在任意面板调用
 * `openComposer({subject, body, ...})` 时,从顶层渲染预填好的 EmailComposer。
 *
 * 渲染层级:放在 AppShell 顶层,优先级最高。
 * 简化模式:只渲染一个预填 subject/body 的弹窗,即使未连接账户也不会崩。
 */
import { useEffect } from "react";
import { EmailComposer } from "@openbuddy/ui-email";
import { useEmailContacts } from "@/lib/email/use-email-contacts";
import { useComposerStore } from "@/stores/composer-store";

export function ComposerPortal(): JSX.Element | null {
  const open = useComposerStore((state) => state.open);
  const initial = useComposerStore((state) => state.initial);
  const close = useComposerStore((state) => state.closeComposer);

  const contacts = useEmailContacts();

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, close]);

  if (!open) return null;
  if (!initial) return null;

  // 简化:用单例 "self" 占位 account。生产场景里从 EmailAiPanel 选中的账户获取。
  const placeholderAccount = {
    id: initial.draftId ?? "self",
    address: "me@example.com",
    provider: "mcp" as const,
    status: "connected" as const,
    capabilities: {
      read: true,
      write: true,
      attachments: true,
      multipleAccounts: false,
    },
  };

  return (
    <div className="composer-portal" role="dialog" aria-modal="true">
      <EmailComposer
        account={placeholderAccount}
        accounts={[placeholderAccount]}
        contacts={contacts}
        initial={{
          ...(initial.subject !== undefined ? { subject: initial.subject } : {}),
          ...(initial.body !== undefined ? { body: initial.body } : {}),
          ...(initial.threadId !== undefined ? { threadId: initial.threadId } : {}),
          ...(initial.draftId !== undefined ? { draftId: initial.draftId } : {}),
          ...(initial.to !== undefined ? { to: initial.to } : {}),
          ...(initial.cc !== undefined ? { cc: initial.cc } : {}),
          ...(initial.bcc !== undefined ? { bcc: initial.bcc } : {}),
        }}
        onSaved={() => close()}
        onClose={() => close()}
      />
    </div>
  );
}
