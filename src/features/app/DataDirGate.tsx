/**
 * src/features/app/DataDirGate.tsx
 *
 * R23 — 「数据目录」选择器(内核槽位 `onboarding.data-dir`)。
 *
 * 触发点:设置 → 数据管理 → 「更改数据目录」。**不在首启时弹** —— 主题 / 模型 /
 * 数据目录这些配置属于"随时可改的设置",不是"必须先答的问卷"(首启已经有向导,
 * 再压一层模态只会让用户先学会关弹窗)。
 *
 * 语义上是一次"迁移声明":选中的目录在**下次启动**生效(Electron 的 userData
 * 必须在 app ready 之前定下来)。所以这里的交互刻意分两步 —— 先提交,再问要不要
 * 立刻重启;用户也可以选「稍后重启」,继续当前会话。
 */
import { lazy, useCallback, useEffect, useMemo, useState, type ComponentType } from "react";

import {
  dataDirDescribe,
  dataDirReset,
  dataDirSet,
  relaunchApp,
  type DataDirDescription,
} from "@/lib/platform/data-dir-client";

import { useSlotComponent } from "./slot-bridge";

const DataDirPrompt = lazy(() =>
  import("@openbuddy/ui-onboarding").then((m) => ({ default: m.DataDirPrompt })),
);

export interface DataDirGateProps {
  open: boolean;
  onClose(): void;
  onToast?(message: string): void;
}

export function DataDirGate({ open, onClose, onToast }: DataDirGateProps) {
  const [info, setInfo] = useState<DataDirDescription | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 已提交、等待重启的目录(非空时卡片切换成"重启提示"形态)。 */
  const [pendingPath, setPendingPath] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setPendingPath(null);
    dataDirDescribe()
      .then((described) => {
        if (!cancelled) setInfo(described);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const submit = useCallback(
    async (path: string) => {
      setBusy(true);
      setError(null);
      try {
        const result = await dataDirSet(path);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (!result.requiresRestart) {
          onToast?.("已经是当前数据目录,无需重启");
          onClose();
          return;
        }
        setPendingPath(result.path);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [onClose, onToast],
  );

  const applyNow = useCallback(async () => {
    try {
      await relaunchApp();
    } catch {
      onToast?.("重启失败,请手动退出并重新打开 OpenBuddy");
    }
  }, [onToast]);

  const useDefault = useCallback(async () => {
    setBusy(true);
    try {
      await dataDirReset();
      setPendingPath(info?.defaultPath ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [info?.defaultPath]);

  // hook 必须先于任何早退 —— 槽位可能被插件接管。
  const Fallback = useMemo(
    () => DataDirPrompt as unknown as ComponentType<Record<string, unknown>>,
    [],
  );
  const Prompt = useSlotComponent<ComponentType<Record<string, unknown>>>(
    "onboarding.data-dir",
    Fallback,
  );

  if (!open) return null;

  if (pendingPath) {
    return (
      <div className="data-dir-gate data-dir-gate--modal" data-testid="data-dir-gate">
        <div className="data-dir-gate__card" role="dialog" aria-modal="true" aria-label="数据目录已更新">
          <h2 className="data-dir-gate__title">数据目录已更新</h2>
          <p className="data-dir-gate__body">
            新目录:<code>{pendingPath}</code>
            <br />
            切换目录需要重启应用后生效。当前会话的数据仍留在原目录,不会被删除。
          </p>
          <div className="data-dir-gate__actions">
            <button type="button" className="settings-btn" onClick={onClose} data-testid="data-dir-later">
              稍后重启
            </button>
            <button
              type="button"
              className="settings-btn settings-btn--primary"
              onClick={applyNow}
              data-testid="data-dir-restart"
            >
              立即重启
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="data-dir-gate" data-testid="data-dir-gate">
      <Prompt
        initialPath={info?.path}
        defaultPaths={info ? [info.defaultPath] : undefined}
        onSubmit={submit}
        onCancel={onClose}
        busy={busy || info === null}
        error={error ?? undefined}
        description="会话、工作区文件与产物都保存在这里。切换后需要重启 OpenBuddy 才生效。"
        confirmLabel="使用此目录"
      />
      {info?.isOverridden && (
        <button
          type="button"
          className="data-dir-gate__reset"
          onClick={useDefault}
          data-testid="data-dir-use-default"
        >
          恢复默认目录
        </button>
      )}
    </div>
  );
}
