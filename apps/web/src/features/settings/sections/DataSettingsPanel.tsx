import { appConfirm } from "../../../shared/ui/AppDialog";
import { useState } from "react";
import { FileJson, Folder, Trash2, Upload } from "lucide-react";
import { agentImportJsonl, openFileDialog } from "@openbuddy/client/agent-client";
import { SectionShell } from "./shared";

// ---------- 数据管理 ----------

export function DataSettingsPanel() {
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

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

  return (
    <SectionShell title="数据管理" desc="本地数据目录、会话导入与会话缓存。">
      <div className="data-card">
        <div className="data-card__row">
          <div className="data-card__label">
            <Folder size={16} />
            <span>agent 数据目录</span>
          </div>
          <code className="data-card__value">应用数据目录/pi</code>
        </div>
        <div className="data-card__row">
          <div className="data-card__label">
            <FileJson size={16} />
            <span>会话文件</span>
          </div>
          <span className="data-card__hint">任意会话的 ⋯ 菜单 →「导出为 JSONL」；导入会复制成新会话。</span>
        </div>
        <div className="data-card__actions">
          <button type="button" className="sec-btn sec-btn--ink" onClick={() => void handleImport()} disabled={importing}>
            <Upload size={14} /> {importing ? "导入中…" : "导入会话 JSONL"}
          </button>
          <button type="button" className="sec-btn" onClick={() => void handleClearSessions()}>
            <Trash2 size={14} /> 清理本地会话缓存
          </button>
        </div>
        {status && <p className="data-card__status">{status}</p>}
        <p className="sec-footnote">
          完全删除历史会话请在侧栏右键单个会话选「删除」；导入的会话使用新 id，不会覆盖已有历史。
        </p>
      </div>
    </SectionShell>
  );
}
