/**
 * EmailPlaceholder — 「邮件」路由的懒加载实现。
 *
 * 从 PlaceholderPage 抽出:emailRuntime/dataProvider/runtime 注入层只服务
 * 邮件路由,但原先静态留在 PlaceholderPage 模块作用域,把
 * @openbuddy/ui-email/ai 的整张图(useEmailAiRuntime/hooks/store/runtime)
 * 拖进首屏 entry。抽到独立模块并让 PlaceholderPage 懒挂载后,这些只在
 * 用户真正打开「邮件」页时加载。
 */
import { lazy, useMemo } from "react";
import { useEmailAiRuntime } from "@openbuddy/ui-email/ai";
import { createEmailDataProvider } from "@/lib/email/createEmailDataProvider";
import { createDefaultEmailAiBindings } from "@/lib/email/createDefaultEmailAiBindings";
import { useSlotComponent } from "@/features/app/slot-bridge";
import { useComposerStore } from "@/stores/composer-store";
import type { AgentEntry } from "@openbuddy/shared-types";

const EmailPanel = lazy(() => import("@openbuddy/ui-email").then((m) => ({ default: m.EmailPanel })));

export interface EmailPlaceholderProps {
  sessionId?: string;
  onNavigate?: (label: string) => void;
  onToast?: (message: string) => void;
  onLaunch?: (prompt: string, agent?: AgentEntry) => void;
}

export function EmailPlaceholder({ sessionId, onNavigate, onToast, onLaunch }: EmailPlaceholderProps) {
  // 第 4 周(渐进迁移):把 capability-email 的真实 IPC 绑到 EmailAiPanel,
  // 不依赖 mock bindings。开箱即用的 List/Archive/Snooze/Draft 全部走能力层。
  // R92 fix:dataProvider 让 EmailAiPanel 真的能拉取邮件数据(accounts / threads / counts / triage)。
  //
  // 注意:本组件自身的 hook 全部无条件调用,没有 early return(Rules of Hooks);
  // 相关历史见 PlaceholderPage 内 #310 注释。
  const emailDataProvider = useMemo(() => createEmailDataProvider({
    defaultAccountId: sessionId ?? "self",
  }), [sessionId]);
  const emailBindings = useMemo(() => createDefaultEmailAiBindings({
    accountId: sessionId ?? "self",
  }), [sessionId]);
  const emailRuntime = useEmailAiRuntime({ bindings: emailBindings });
  // P1-A:Composer 预填通过共享 store 触发。EmailAiPanel 内部 onAdopt 调用
  // onOpenComposer({subject, body, threadId}) → 推到 store → 顶层 ComposerPortal 渲染。
  const openComposer = useComposerStore((state) => state.openComposer);
  const handleOpenComposer = useMemo(
    () => (init?: { subject: string; body: string; threadId: string }) => {
      openComposer({
        ...(init?.subject !== undefined ? { subject: init.subject } : {}),
        ...(init?.body !== undefined ? { body: init.body } : {}),
        ...(init?.threadId !== undefined ? { threadId: init.threadId } : {}),
      });
    },
    [openComposer],
  );
  const EmailSlot = useSlotComponent("placeholder.email", EmailPanel);
  const RuntimeInjectedEmailSlot = useMemo(() => {
    type SlotProps = typeof EmailSlot extends React.ComponentType<infer P> ? P : never;
    const Wrapped: React.FC<SlotProps> = (props) => (
      // @ts-expect-error EmailAiPanel accepts runtime/onOpenComposer + dataProvider; legacy panel ignores extra props.
      <EmailSlot {...props} runtime={emailRuntime} dataProvider={emailDataProvider} onOpenComposer={handleOpenComposer as never} />
    );
    Wrapped.displayName = "RuntimeInjectedEmailSlot";
    return Wrapped;
  }, [EmailSlot, emailRuntime, emailDataProvider, handleOpenComposer]);
  return (
    <RuntimeInjectedEmailSlot
      sessionId={sessionId}
      onNavigate={onNavigate}
      onToast={onToast}
      onLaunch={onLaunch ? (prompt) => onLaunch(prompt) : undefined}
    />
  );
}
