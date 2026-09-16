/**
 * src/features/app/FeedbackGate.tsx
 *
 * R23 — 「发送反馈」的宿主接线(内核槽位 `onboarding.feedback`)。
 *
 * 落点选在**本地审计日志**(`audit:record` → `${userData}/audit.jsonl`),而不是
 * 任何一个远端端点。理由:
 *   - OpenBuddy 是本地优先的:用户的吐槽里常常带路径、仓库名、报错片段,
 *     不该因为"顺手提个意见"就离开这台机器;
 *   - 审计面板(Settings → 数据管理 → 本地审计追踪)天然就是"这台机器上发生过
 *     什么"的观察窗口,用户能自己看到这条记录、也能一键清空。
 *
 * 组件本身不决定"什么时候弹" —— 触发时机属于宿主策略(当前是左下角账户菜单
 * 里的「发送反馈」,随时可点)。
 */
import { lazy, useCallback, useMemo, useState, type ComponentType } from "react";

import { auditRecord } from "@/lib/audit/audit-client";
import { APP_VERSION } from "@/lib/platform/app-version";

import { useSlotComponent } from "./slot-bridge";

const FeedbackPopup = lazy(() =>
  import("@openbuddy/ui-onboarding").then((m) => ({ default: m.FeedbackPopup })),
);

export interface FeedbackGateProps {
  open: boolean;
  onClose(): void;
  /** 提交结果回执(成功 / 失败都走 toast,不占用反馈卡自身的错误位)。 */
  onToast?(message: string): void;
}

interface FeedbackPayload {
  sentiment: "up" | "down";
  comment: string;
}

export function FeedbackGate({ open, onClose, onToast }: FeedbackGateProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (payload: FeedbackPayload) => {
      setBusy(true);
      setError(null);
      try {
        const result = await auditRecord({
          event: "user-feedback",
          outcome: "info",
          subject: payload.sentiment === "up" ? "thumbs-up" : "thumbs-down",
          detail: {
            comment: payload.comment,
            appVersion: APP_VERSION,
          },
        });
        if (result && result.ok === false) {
          setError(result.error || "写入本地审计日志失败");
          return;
        }
        onToast?.("反馈已记录到本地审计日志(仅存本机)");
        onClose();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [onClose, onToast],
  );

  // hook 必须在早退之前 —— 否则 feedback 槽被插件接管 / 卸载时 hook 数量会变。
  const Fallback = useMemo(
    () => FeedbackPopup as unknown as ComponentType<Record<string, unknown>>,
    [],
  );
  const Popup = useSlotComponent<ComponentType<Record<string, unknown>>>(
    "onboarding.feedback",
    Fallback,
  );

  if (!open) return null;

  return (
    <div className="feedback-gate" data-testid="feedback-gate">
      <Popup
        onSubmit={submit}
        onDismiss={onClose}
        busy={busy}
        error={error ?? undefined}
      />
    </div>
  );
}
