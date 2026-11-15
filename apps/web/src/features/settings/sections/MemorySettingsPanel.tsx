import { appConfirm } from "../../../shared/ui/AppDialog";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { memoryList, memoryRewrite } from "@openbuddy/client/agent-client";
import type { MemoryEntry } from "@openbuddy/protocol/dto";
import { SectionShell } from "./shared";

// ---------- 记忆 (20261116-pii W5.1–W5.3) ----------

export function MemorySettingsPanel() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [entries, setEntries] = useState<MemoryEntry[]>([]);

  const reload = useCallback(async () => {
    try {
      setEntries(await memoryList());
    } catch {
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleRewrite = async () => {
    if (!(await appConfirm({ title: "整理记忆会把全局记忆合并去重到 MEMORY.md，其余文件移除。继续？" }))) return;
    setBusy(true);
    try {
      const result = await memoryRewrite();
      setMsg(`已整理：${result.merged} 个文件合并为 ${result.kept} 条`);
      await reload();
    } catch (e) {
      setMsg(`失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionShell
      title="记忆"
      desc="agent 跨会话记忆的维护。全局记忆存在 应用数据目录/pi/memory/，工作区记忆在受信任任务的 .pi/memory/。"
    >
      <p className="settings-hint">
        agent 通过 <code>ob_remember</code> 记录你确认过的偏好，每次任务开始时自动注入；也可以在「资料库 · 记忆」里查看和编辑。
      </p>
      {entries.length > 0 ? (
        <ul className="settings-list">
          {entries.map((entry) => (
            <li key={`${entry.scope}/${entry.path}`} className="settings-list__item">
              <span className="settings-list__name">{entry.path}</span>
              <span className="settings-list__meta">
                {entry.scope === "global" ? "全局" : "工作区"} · {entry.size} 字节
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="settings-hint">暂无记忆条目。</p>
      )}
      <div className="settings-actions">
        <button className="settings-btn" onClick={handleRewrite} disabled={busy}>
          <RefreshCw size={14} /> 整理记忆
        </button>
      </div>
      {msg && <p className="settings-msg">{msg}</p>}
    </SectionShell>
  );
}
