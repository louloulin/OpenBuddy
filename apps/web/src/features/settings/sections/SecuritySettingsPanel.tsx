import { useEffect, useState } from "react";
import { Shield } from "lucide-react";
import { permissionList } from "@openbuddy/client/agent-client";
import type { PermissionRule } from "@openbuddy/protocol/dto";
import { SectionShell } from "./shared";

// ---------- 安全中心 ----------

export function SecuritySettingsPanel() {
  const [rules, setRules] = useState<PermissionRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    permissionList()
      .then(setRules)
      .catch(() => setRules([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <SectionShell
      title="安全中心"
      desc="工具执行权限规则。在 Composer 底部的「默认权限」可以编辑。"
    >
      <div className="settings-row">
        <div className="settings-row__label">
          <Shield size={16} />
          <span>已配置规则</span>
        </div>
        <div className="settings-row__control">
          {loading ? "加载中…" : `${rules.length} 条`}
        </div>
      </div>
      {rules.length > 0 && (
        <ul className="rules-list">
          {rules.map((r, i) => (
            <li key={i} className={`rules-list__item rules-list__item--${r.action}`}>
              <span className="rules-list__action">{r.action}</span>
              <span className="rules-list__tool">{r.tool}</span>
              {r.pattern && <span className="rules-list__pattern">{r.pattern}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="settings-hint">
        agent 评估顺序：<code>deny</code> &gt; <code>ask</code> &gt; <code>allow</code>。
        修改需重启 agent 生效。
      </p>
    </SectionShell>
  );
}
