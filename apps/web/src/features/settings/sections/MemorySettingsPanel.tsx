import { appConfirm } from "../../../shared/ui/AppDialog";
import { useState } from "react";
import { RefreshCw, Database } from "lucide-react";
import { memoryFlush, memoryRewrite } from "@openbuddy/client/agent-client";
import { useCapability } from "@/app/state/capabilities-store";
import { SectionShell } from "./shared";

// ---------- 记忆 ----------

export function MemorySettingsPanel() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // memory_flush is not planned (pii §3.3); the button only shows if a host serves it.
  const canFlush = useCapability("memory_flush");

  const handleRewrite = async () => {
    if (!(await appConfirm({ title: "让 agent 用 LLM 重写所有记忆？" }))) return;
    setBusy(true);
    try {
      await memoryRewrite();
      setMsg("已触发重写，稍后在「更多/资料库」查看");
    } catch (e) {
      setMsg(`失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(false);
    }
  };

  const handleFlush = async () => {
    setBusy(true);
    try {
      await memoryFlush();
      setMsg("已落盘");
    } catch (e) {
      setMsg(`失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionShell
      title="记忆"
      desc="agent 跨会话记忆的维护。记忆文件存在 应用数据目录/pi/memory/。"
    >
      <p className="settings-hint">
        agent 在对话中自动学习并写入 <code>MEMORY.md</code>。
        在侧栏「更多 / 资料库」可以查看和编辑具体内容。
      </p>
      <div className="settings-actions">
        {canFlush && (
          <button className="settings-btn" onClick={handleFlush} disabled={busy}>
            <Database size={14} /> 强制落盘
          </button>
        )}
        <button className="settings-btn" onClick={handleRewrite} disabled={busy}>
          <RefreshCw size={14} /> LLM 重写
        </button>
      </div>
      {msg && <p className="settings-msg">{msg}</p>}
    </SectionShell>
  );
}
