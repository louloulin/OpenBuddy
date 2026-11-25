import { appConfirm } from "../../../shared/ui/AppDialog";
import { useCallback, useEffect, useState } from "react";
import { FileJson, Folder, History, RotateCcw, Trash2, Upload } from "lucide-react";
import { agentImportJsonl, openFileDialog } from "@openbuddy/client/agent-client";
import { readTextFile } from "@openbuddy/client/api/files";
import { saveTextAs } from "@openbuddy/client/api/native";
import { dataExport, dataRestore, dataSnapshots, dataSnapshotRestore, type DataBundle, type DataSnapshot } from "@openbuddy/client/api/data";
import { useLocale } from "../../../shared/i18n";
import { SectionShell } from "./shared";
import { ImportConversationsCard } from "./ImportConversationsCard";

// ---------- 数据管理 ----------

const formatAt = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("zh-CN", { hour12: false });
};

export function DataSettingsPanel() {
  const { t } = useLocale();
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState<"export" | "restore" | "snapshot" | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<DataSnapshot[]>([]);

  const loadSnapshots = useCallback(async () => {
    try {
      setSnapshots((await dataSnapshots()).snapshots);
    } catch {
      setSnapshots([]);
    }
  }, []);

  useEffect(() => {
    void loadSnapshots();
  }, [loadSnapshots]);

  const handleClearSessions = async () => {
    if (
      !(await appConfirm({
        title: "清理本地会话缓存？",
        message: "这只影响侧栏列表的显示，应用数据目录 pi/sessions/ 中的历史不会被删除。",
        confirmLabel: "清理",
        danger: true,
      }))
    ) {
      return;
    }
    localStorage.removeItem("openbuddy-state.json");
    setStatus("已清理本地缓存，下次刷新会重新加载会话列表。");
  };

  /** 会话 JSONL 导入 (pii W6.5): the file is copied onto a new id, the original is untouched. */
  const handleImport = async () => {
    const path = await openFileDialog({
      title: "导入会话 JSONL",
      filters: [{ name: "会话文件", extensions: ["jsonl"] }],
    });
    if (!path) return;
    setImporting(true);
    setStatus(null);
    try {
      const id = await agentImportJsonl(path);
      setStatus(`已导入为新会话 ${id.slice(0, 8)}…，可在侧栏「任务」里打开。`);
    } catch (e) {
      setStatus(`导入失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setImporting(false);
    }
  };

  /** 全量导出 (A2): every versioned data file in one JSON bundle; keys are never included. */
  const handleExport = async () => {
    setBusy("export");
    setStatus(null);
    try {
      const { bundle } = await dataExport();
      const day = new Date().toISOString().slice(0, 10);
      const target = await saveTextAs(`openbuddy-data-${day}.json`, JSON.stringify(bundle, null, 2));
      if (!target) {
        setStatus("已取消导出。");
        return;
      }
      setStatus(`已导出 ${Object.keys(bundle.files).length} 个数据文件；密钥（credentials.enc.json）不在导出包内，恢复后需重新输入。`);
    } catch (e) {
      setStatus(`导出失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(null);
    }
  };

  /** 全量恢复 (A2): validate → snapshot current state → write files → ask for restart. */
  const handleRestore = async () => {
    const path = await openFileDialog({
      title: "选择 OpenBuddy 数据包",
      filters: [{ name: "数据包", extensions: ["json"] }],
    });
    if (!path) return;
    setBusy("restore");
    setStatus(null);
    try {
      const text = await readTextFile(path, 25 * 1024 * 1024);
      const bundle = JSON.parse(text) as DataBundle;
      if (!(await appConfirm({
        title: "恢复全部数据？",
        message: "当前配置会先自动快照，再被数据包覆盖。恢复后需要重启应用才会生效。",
        confirmLabel: "恢复",
        danger: true,
      }))) {
        setStatus("已取消恢复。");
        return;
      }
      const result = await dataRestore(bundle);
      setStatus(`已恢复 ${result.restored.length} 个文件${result.skipped.length ? `，跳过 ${result.skipped.length} 个` : ""}；重启应用后生效。`);
      await loadSnapshots();
    } catch (e) {
      setStatus(`恢复失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(null);
    }
  };

  const handleSnapshotRestore = async (snapshot: DataSnapshot) => {
    if (!(await appConfirm({
      title: "回滚到该快照？",
      message: `${formatAt(snapshot.at)} 的快照会在覆盖前再保存一份当前状态。回滚后需要重启应用。`,
      confirmLabel: "回滚",
      danger: true,
    }))) {
      return;
    }
    setBusy("snapshot");
    setStatus(null);
    try {
      const result = await dataSnapshotRestore(snapshot.id);
      setStatus(`已从快照恢复 ${result.restored.length} 个文件；重启应用后生效。`);
      await loadSnapshots();
    } catch (e) {
      setStatus(`回滚失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(null);
    }
  };

  const busyLabel = busy === "export" ? t("data.exporting") : busy === "restore" ? t("data.restoring") : t("data.rollingBack");

  return (
    <SectionShell title={t("data.title")} desc={t("data.desc")}>
      <div className="data-card">
        <div className="data-card__row">
          <div className="data-card__label">
            <Folder size={16} />
            <span>{t("data.dir")}</span>
          </div>
          <code className="data-card__value">应用数据目录/pi</code>
        </div>
        <div className="data-card__row">
          <div className="data-card__label">
            <FileJson size={16} />
            <span>{t("data.files")}</span>
          </div>
          <span className="data-card__hint">{t("data.filesHint")}</span>
        </div>
        <div className="data-card__actions">
          <button type="button" className="sec-btn sec-btn--ink" onClick={() => void handleExport()} disabled={busy !== null}>
            <FileJson size={14} /> {busy === "export" ? busyLabel : t("data.export")}
          </button>
          <button type="button" className="sec-btn" onClick={() => void handleRestore()} disabled={busy !== null}>
            <Upload size={14} /> {busy === "restore" ? busyLabel : t("data.restore")}
          </button>
          <button type="button" className="sec-btn sec-btn--ink" onClick={() => void handleImport()} disabled={importing || busy !== null}>
            <Upload size={14} /> {importing ? t("data.importing") : t("data.import")}
          </button>
          <button type="button" className="sec-btn" onClick={() => void handleClearSessions()} disabled={busy !== null}>
            <Trash2 size={14} /> {t("data.clear")}
          </button>
        </div>
        {status && <p className="data-card__status" role="status">{status}</p>}
        <p className="sec-footnote">{t("data.secretNote")}</p>
      </div>

      <div className="data-card">
        <div className="data-card__row">
          <div className="data-card__label">
            <History size={16} />
            <span>{t("data.snapshots")}</span>
          </div>
          <span className="data-card__hint">{t("data.snapshotsHint")}</span>
        </div>
        {snapshots.length === 0 ? (
          <p className="data-card__hint">{t("data.noSnapshots")}</p>
        ) : (
          snapshots.map((snapshot) => (
            <div className="data-card__row" key={snapshot.id}>
              <div className="data-card__label">
                <span>{snapshot.label === "startup" ? t("data.snapshotStartup") : snapshot.label === "pre-restore" ? t("data.snapshotRestore") : snapshot.label}</span>
              </div>
              <span className="data-card__hint">
                {formatAt(snapshot.at)} · {t("data.filesCount", { count: snapshot.files.length })}
              </span>
              <button type="button" className="sec-btn" onClick={() => void handleSnapshotRestore(snapshot)} disabled={busy !== null}>
                <RotateCcw size={14} /> {busy === "snapshot" ? busyLabel : t("data.rollback")}
              </button>
            </div>
          ))
        )}
      </div>

      <ImportConversationsCard onToast={(message) => setStatus(message)} />

      <p className="sec-footnote">{t("data.footnote")}</p>
    </SectionShell>
  );
}
