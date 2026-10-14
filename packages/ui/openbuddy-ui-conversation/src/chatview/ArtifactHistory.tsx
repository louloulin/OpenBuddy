/**
 * ArtifactHistory —— 产物中心(阶段 5)的文件版本时间线。
 *
 * 数据来自主进程 `artifacts:history`(复用 rewind 快照存储,不是另存一份):
 * 该文件在本会话里被工具改过的每一次都有版本记录,含"那一刻文件不存在"的
 * 删除态。选中某个版本 → 与当前内容做 unified diff 预览;「恢复此版本」
 * 走 `artifacts:restore`,与「回退对话」同一套文件恢复实现。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { invoke } from "@/lib/platform/electron-api";
import { useLocale } from "@openbuddy/ui-locale/client";

export interface ArtifactVersion {
  toolCallId: string;
  promptId: string | null;
  tool: string;
  exists: boolean;
  bytes: number;
  capturedAt: number;
}

export interface ArtifactHistoryProps {
  sessionId?: string;
  /** 选中的文件绝对路径;为空时不渲染。 */
  path?: string;
  onToast?: (msg: string) => void;
  /** 恢复完成后通知外层刷新(文件预览/变更列表)。 */
  onRestored?: (path: string) => void;
}

function formatTime(epoch: number): string {
  const d = new Date(epoch);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ArtifactHistory({ sessionId, path, onToast, onRestored }: ArtifactHistoryProps) {
  const locale = useLocale();
  // 翻译函数通过 ref 取:useLocale() 返回的对象身份在某些 provider 实现里
  // 每次渲染都变,若直接进 useCallback 依赖,load → useEffect 会自激成渲染环。
  const translateRef = useRef(locale.t);
  translateRef.current = locale.t;
  const t = useCallback((key: string, params?: Record<string, unknown>) => translateRef.current(key, params), []);

  const [versions, setVersions] = useState<ArtifactVersion[]>([]);
  const [selectedAt, setSelectedAt] = useState<number | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const load = useCallback(async () => {
    if (!sessionId || !path) {
      setVersions([]);
      return;
    }
    setLoading(true);
    try {
      const result = (await invoke("artifacts:history", { sessionId, path })) as { versions: ArtifactVersion[] };
      setVersions(result.versions ?? []);
      setSelectedAt(null);
      setDiff(null);
    } catch (error) {
      onToast?.(t("artifacts.historyFailed", { error: String(error).replace(/^Error:\s*/, "") }));
    } finally {
      setLoading(false);
    }
  }, [sessionId, path, onToast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const previewDiff = useCallback(
    async (version: ArtifactVersion) => {
      setSelectedAt(version.capturedAt);
      setDiff(null);
      try {
        const result = (await invoke("artifacts:diff", { path, content: null })) as { patch: string };
        setDiff(result.patch);
      } catch {
        setDiff("");
      }
    },
    [path],
  );

  const restore = useCallback(async () => {
    const version = versions.find((item) => item.capturedAt === selectedAt);
    if (!sessionId || !version?.promptId) {
      onToast?.(t("artifacts.restoreNeedsPrompt"));
      return;
    }
    setRestoring(true);
    try {
      const result = (await invoke("artifacts:restore", { sessionId, promptId: version.promptId })) as {
        restored: number;
        skipped: number;
      };
      onToast?.(t("artifacts.restored", { restored: result.restored ?? 0, skipped: result.skipped ?? 0 }));
      onRestored?.(path ?? "");
      await load();
    } catch (error) {
      onToast?.(t("artifacts.restoreFailed", { error: String(error).replace(/^Error:\s*/, "") }));
    } finally {
      setRestoring(false);
    }
  }, [versions, selectedAt, sessionId, path, onToast, onRestored, load, t]);

  if (!path) return null;

  return (
    <section className="artifacts-history" aria-label={t("artifacts.historyAria")}>
      <header className="artifacts-history__head">
        <span className="artifacts-history__title">{t("artifacts.history")}</span>
        <button type="button" className="artifacts-history__refresh" onClick={() => void load()} disabled={loading}>
          {t("artifacts.refresh")}
        </button>
      </header>
      {versions.length === 0 ? (
        <p className="artifacts-history__empty">{t("artifacts.noVersions")}</p>
      ) : (
        <>
          <ol className="artifacts-history__list">
            {versions.map((version) => (
              <li key={`${version.toolCallId}-${version.capturedAt}`}>
                <button
                  type="button"
                  className={
                    "artifacts-history__item" +
                    (version.capturedAt === selectedAt ? " artifacts-history__item--active" : "")
                  }
                  onClick={() => void previewDiff(version)}
                  aria-pressed={version.capturedAt === selectedAt}
                >
                  <span className="artifacts-history__time">{formatTime(version.capturedAt)}</span>
                  <span className="artifacts-history__tool">{version.tool}</span>
                  <span className="artifacts-history__size">
                    {version.exists ? `${version.bytes} B` : t("artifacts.deletedState")}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div className="artifacts-history__actions">
            <button
              type="button"
              className="artifacts-history__restore"
              disabled={!selectedAt || restoring}
              onClick={() => void restore()}
            >
              {restoring ? t("artifacts.restoring") : t("artifacts.restore")}
            </button>
          </div>
          {selectedAt !== null && diff !== null && (
            <pre className="artifacts-history__diff" aria-label={t("artifacts.diffAria")}>
              {diff || t("artifacts.noDiff")}
            </pre>
          )}
        </>
      )}
    </section>
  );
}