import { useState } from "react";
import { Download } from "lucide-react";
import { invoke, open as openDialog } from "@openbuddy/client/ipc";
import { agentInit } from "@openbuddy/client/agent-client";
import { friendlyError } from "@openbuddy/chat-core/error-format";

/**
 * 外部会话导入向导 (G4-3)：WorkBuddy / ChatGPT / Claude 导出的会话 → 工作区 Markdown。
 *
 * 只读源文件；每个选中的会话写成一个 `.md`（标题、来源、逐条消息），重复导入同一内容会跳过。
 * 这是**迁移资料**：导入后可以搜索、可以让 Buddy 基于它继续，不是伪造的对话历史。
 */
interface ScanResult {
  format: "chatgpt" | "claude" | "workbuddy" | "unknown";
  conversations: Array<{ id: string; title: string; messageCount: number; updatedAt?: string }>;
}

const FORMAT_LABEL: Record<ScanResult["format"], string> = {
  chatgpt: "ChatGPT 导出",
  claude: "Claude 导出",
  workbuddy: "WorkBuddy / 通用导出",
  unknown: "未知格式",
};

export function ImportConversationsCard({ onToast }: { onToast?: (message: string) => void }) {
  const [path, setPath] = useState("");
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const pick = async () => {
    const chosen = await openDialog({
      multiple: false,
      title: "选择会话导出文件（ChatGPT / Claude / WorkBuddy 的 JSON）",
      filters: [{ name: "会话导出", extensions: ["json", "jsonl"] }],
    }).catch(() => null);
    const file = Array.isArray(chosen) ? chosen[0] : chosen;
    if (file) await scanPath(file);
  };

  const [pathInput, setPathInput] = useState("");

  /** 也支持直接输入路径：某些环境没有原生文件对话框。 */
  const scanPath = async (file: string) => {
    if (!file.trim()) return;
    setBusy(true); setStatus(null); setScan(null);
    try {
      const result = await invoke<ScanResult>("data_import_scan", { path: file });
      setPath(file);
      setScan(result);
      setSelected(new Set(result.conversations.map((item) => item.id)));
    } catch (error) {
      setStatus(`无法读取：${friendlyError(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const apply = async () => {
    if (!path || !scan || selected.size === 0) return;
    setBusy(true); setStatus(null);
    try {
      const init = await agentInit();
      const result = await invoke<{ written: string[]; skipped: string[] }>("data_import_apply", {
        path,
        ids: [...selected],
        outputDir: init.cwd,
      });
      setStatus(
        `已导入 ${result.written.length} 个会话到工作区${result.skipped.length ? `，${result.skipped.length} 个已存在跳过` : ""}。`,
      );
      onToast?.("导入完成");
    } catch (error) {
      setStatus(`导入失败：${friendlyError(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="data-card">
      <div className="data-card__row">
        <div className="data-card__label">
          <Download size={16} />
          <span>导入外部会话</span>
        </div>
        <span className="data-card__hint">
          把 WorkBuddy / ChatGPT / Claude 导出的会话转成工作区 Markdown；只读源文件，重复导入会跳过。
        </span>
      </div>
      <div className="data-card__actions">
        <button type="button" className="sec-btn" onClick={() => void pick()} disabled={busy}>
          <Download size={14} /> {busy && !scan ? "读取中…" : "选择导出文件"}
        </button>
        <input
          type="text"
          className="sec-input"
          aria-label="会话导出文件路径"
          placeholder="或粘贴导出文件路径"
          value={pathInput}
          onChange={(event) => setPathInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void scanPath(pathInput); }}
        />
        <button type="button" className="sec-btn" onClick={() => void scanPath(pathInput)} disabled={busy || !pathInput.trim()}>
          读取
        </button>
        {scan && (
          <button
            type="button"
            className="sec-btn sec-btn--ink"
            onClick={() => void apply()}
            disabled={busy || selected.size === 0}
          >
            {busy ? "导入中…" : `导入 ${selected.size} 个会话`}
          </button>
        )}
      </div>
      {scan && (
        <div className="import-conv">
          <div className="import-conv__head">
            <span className="sec-badge">{FORMAT_LABEL[scan.format]}</span>
            <span className="data-card__hint">共 {scan.conversations.length} 个会话</span>
          </div>
          <ul className="import-conv__list">
            {scan.conversations.map((conversation) => (
              <li className="import-conv__item" key={conversation.id}>
                <label className="import-conv__label">
                  <input
                    type="checkbox"
                    checked={selected.has(conversation.id)}
                    onChange={() => toggle(conversation.id)}
                  />
                  <span className="import-conv__title">{conversation.title}</span>
                </label>
                <span className="data-card__hint">{conversation.messageCount} 条消息</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {status && <p className="data-card__status" role="status">{status}</p>}
    </div>
  );
}
