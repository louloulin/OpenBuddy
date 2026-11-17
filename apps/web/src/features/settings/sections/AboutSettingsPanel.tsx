import { ExternalLink, Github } from "lucide-react";
import { APP_VERSION } from "@/app/app-version";
import { SectionShell } from "./shared";

/**
 * 关于 (20261116-pii W6.3)：版本、引擎与文档入口。真正需要“检查更新”时再做，
 * 这里不伪造网络请求。
 */
const ENGINE_PACKAGE = "@earendil-works/pi-coding-agent";

export function AboutSettingsPanel() {
  return (
    <SectionShell title="关于" desc="版本信息与文档入口。">
      <div className="about-card">
        <div className="about-card__brand">
          <div className="about-card__logo">OB</div>
          <div>
            <div className="about-card__name">OpenBuddy</div>
            <div className="about-card__version">v{APP_VERSION} · Pi 版 WorkBuddy</div>
          </div>
        </div>
        <dl className="about-card__facts">
          <div>
            <dt>引擎</dt>
            <dd>
              <code>{ENGINE_PACKAGE}</code>
            </dd>
          </div>
          <div>
            <dt>许可</dt>
            <dd>本地优先，数据不出设备（诊断报告需你手动保存 / 分享）</dd>
          </div>
          <div>
            <dt>文档</dt>
            <dd>
              <a href="https://github.com/badlogic/pi-mono/" target="_blank" rel="noreferrer">
                <ExternalLink size={12} /> Pi SDK
              </a>
            </dd>
          </div>
          <div>
            <dt>反馈</dt>
            <dd>
              设置 · 帮助与反馈 →「生成诊断报告」<Github size={12} />
            </dd>
          </div>
        </dl>
      </div>
    </SectionShell>
  );
}
