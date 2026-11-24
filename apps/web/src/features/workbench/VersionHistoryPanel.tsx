import { useCallback, useEffect, useState } from "react";
import { History, RotateCcw } from "lucide-react";
import {
  checkpointList,
  checkpointRead,
  checkpointRestore,
  type CheckpointRecord,
} from "@openbuddy/client/api/artifacts";

/**
 * 产物/文件版本历史 (G3-2)：把 Pi 的 checkpoint 索引变成可用的时间线。
 *
 * 每个 checkpoint 记录了一次文件改写（before/after 的内容哈希）；面板列出某个路径的
 * 全部版本，可以**查看**某一版内容，也可以**还原**到那一版（`checkpoint_restore`，
 * 走的是引擎里同一套回滚逻辑，与「回退到此消息前」一致）。
 */
export function VersionHistoryPanel({
  sessionId,
  path,
  onToast,
}: {
  sessionId: string;
  /** The file to trace; empty means every path in the session. */
  path?: string;
  onToast?: (message: string) => void;
}) {
  const [records, setRecords] = useState<CheckpointRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<{ hash: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRecords(await checkpointList(sessionId, path));
    } catch {
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [sessionId, path]);

  useEffect(() => {
    void load();
  }, [load]);

  const show = async (hash: string) => {
    try {
      const result = await checkpointRead(sessionId, hash);
      setPreview({ hash, text: result?.binary ? "（二进制内容，无法预览）" : result?.text ?? "" });
    } catch (error) {
      onToast?.(`读取版本失败：${String(error).replace(/^Error:\s*/, "")}`);
    }
  };

  const restore = async (record: CheckpointRecord) => {
    setBusy(true);
    try {
      await checkpointRestore(sessionId, record.path, record.before);
      onToast?.(`已还原 ${record.path}`);
      await load();
    } catch (error) {
      onToast?.(`还原失败：${String(error).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="ver-history__empty">加载版本历史…</div>;
  if (!records.length)
    return <div className="ver-history__empty">这个任务还没有文件改写记录（版本历史来自工具写文件时的快照）。</div>;

  return (
    <div className="ver-history">
      <ul className="ver-history__list">
        {records.map((record) => {
          const stamp = new Date(record.at).toLocaleString();
          const isCurrent = record.after === null;
          return (
            <li className="ver-history__item" key={record.id}>
              <div className="ver-history__meta">
                <span className="ver-history__time">{stamp}</span>
                <span className="ver-history__source">{record.source}</span>
                {!path && <span className="ver-history__path">{record.path}</span>}
              </div>
              <div className="ver-history__actions">
                {record.before && (
                  <button type="button" className="ver-history__btn" onClick={() => void show(record.before!)}>
                    查看改写前
                  </button>
                )}
                {record.after && (
                  <button type="button" className="ver-history__btn" onClick={() => void show(record.after!)}>
                    查看改写后
                  </button>
                )}
                {record.before && (
                  <button
                    type="button"
                    className="ver-history__btn ver-history__btn--restore"
                    disabled={busy || isCurrent}
                    onClick={() => void restore(record)}
                  >
                    <RotateCcw size={12} aria-hidden /> 还原到这一版
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {preview && (
        <pre className="ver-history__preview">
          <span className="ver-history__preview-head">
            <History size={12} aria-hidden /> 版本内容（{preview.hash.slice(0, 12)}）
            <button type="button" className="ver-history__btn" onClick={() => setPreview(null)}>
              关闭
            </button>
          </span>
          {preview.text.slice(0, 4000)}
        </pre>
      )}
    </div>
  );
}
