import { appConfirm } from "../../../shared/ui/AppDialog";
import { useEffect, useState } from "react";
import { Folder, Trash2 } from "lucide-react";
import { SectionShell } from "./shared";

// ---------- 数据管理 ----------

export function DataSettingsPanel() {
  const [agentHome, setAgentHome] = useState("");

  useEffect(() => {
    // 从环境推断 agent home 路径（前端无直接 API，给提示用）
    setAgentHome("应用数据目录/pi");
  }, []);

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
    alert("已清理。下次刷新会重新加载会话列表。");
  };

  return (
    <SectionShell title="数据管理" desc="本地缓存和 agent 数据目录。">
      <div className="settings-row">
        <div className="settings-row__label">
          <Folder size={16} />
          <span>agent 数据目录</span>
        </div>
        <div className="settings-row__control">
          <code>{agentHome}</code>
        </div>
      </div>
      <div className="settings-actions">
        <button
          className="settings-btn settings-btn--danger"
          onClick={handleClearSessions}
        >
          <Trash2 size={14} /> 清理本地会话缓存
        </button>
      </div>
      <p className="settings-hint">
        完全删除历史会话请在侧栏右键单个会话选「删除」。
      </p>
    </SectionShell>
  );
}
