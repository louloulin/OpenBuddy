import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { internalReload } from "@openbuddy/client/agent-client";
import { SectionShell } from "./shared";

// ---------- 系统设置 ----------

export function GeneralSettingsPanel() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const handleReload = async (kind: "mcp_all" | "skills" | "models") => {
    setBusy(true);
    try {
      await internalReload(kind);
      setMsg(`已触发 ${kind} 热重载`);
    } catch (e) {
      setMsg(`失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionShell
      title="系统设置"
      desc="热重载 agent 的配置视图。修改 config.toml 后无需重启整个应用。"
    >
      <div className="settings-actions">
        <button className="settings-btn" onClick={() => handleReload("mcp_all")} disabled={busy}>
          <RefreshCw size={14} /> 重载 MCP
        </button>
        <button className="settings-btn" onClick={() => handleReload("skills")} disabled={busy}>
          <RefreshCw size={14} /> 重载技能
        </button>
        <button className="settings-btn" onClick={() => handleReload("models")} disabled={busy}>
          <RefreshCw size={14} /> 重载模型
        </button>
      </div>
      {msg && <p className="settings-msg">{msg}</p>}
    </SectionShell>
  );
}
