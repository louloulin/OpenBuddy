/**
 * DevPluginsHint — Phase 5「开发模式加载自 ~/openbuddy-plugins」说明
 *
 * 在 OpenBuddyPluginPanel 中显示，提示开发者本地 dev 插件路径。
 */
import { useState } from "react";

export function DevPluginsHint() {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="dev-plugins-hint" aria-label="开发模式说明">
      <button
        type="button"
        className="dev-plugins-hint__toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span aria-hidden="true">{expanded ? "▾" : "▸"}</span> 开发模式 — 本地 dev 插件目录
      </button>
      {expanded && (
        <div className="dev-plugins-hint__body">
          <p>开发模式自动加载 <code>~/openbuddy-plugins/</code> 下所有含 <code>manifest.json</code> 的目录。</p>
          <p>把你的插件放到该目录即可热加载：</p>
          <pre className="dev-plugins-hint__code">
{`mkdir -p ~/openbuddy-plugins/my-plugin
cd ~/openbuddy-plugins/my-plugin
# 写 manifest.json + index.tsx`}
          </pre>
          <p>重启 OpenBuddy 或点击「刷新」按钮重新扫描插件。</p>
          <p>
            详细教程见 <a href="docs/EXTENSION_GUIDE.md" target="_blank" rel="noopener">docs/EXTENSION_GUIDE.md</a>。
          </p>
        </div>
      )}
    </section>
  );
}
