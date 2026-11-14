import { ExternalLink } from "lucide-react";
import { SectionShell } from "./shared";

// ---------- 帮助与反馈 ----------

export function HelpSettingsPanel() {
  return (
    <SectionShell title="帮助与反馈" desc="常用链接和资源。">
      <ul className="help-list">
        <li>
          <ExternalLink size={14} />
          <a href="#" onClick={(e) => e.preventDefault()}>
            OpenBuddy 文档
          </a>
          <span className="help-list__hint">（即将上线）</span>
        </li>
        <li>
          <ExternalLink size={14} />
          <a
            href="https://github.com/badlogic/pi-mono/"
            target="_blank"
            rel="noreferrer"
          >
            Pi SDK 文档
          </a>
        </li>
        <li>
          <ExternalLink size={14} />
          <span>
            引擎包：<code>@earendil-works/pi-coding-agent</code>
          </span>
        </li>
      </ul>
      <p className="settings-hint">
        遇到问题？请检查：
        <br />
        1. API Key 是否已在「账户管理」或「模型」中配置
        <br />
        2. 「模型」tab 是否配置了至少一个 provider
        <br />
        3. 重启 OpenBuddy 后再试
      </p>
    </SectionShell>
  );
}
