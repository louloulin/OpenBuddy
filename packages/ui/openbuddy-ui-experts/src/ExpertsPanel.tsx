import type { ComponentType, ReactNode } from "react";
import { useState } from "react";
import { MarketPills, type MarketTab } from "./MarketHeader";
import { ExpertsTab } from "./experts/ExpertsTab";
import { SkillsTab } from "./skills/SkillsTab";
import { ConnectorsTab } from "./connectors/ConnectorsTab";
import { MarketplacePanel } from "@openbuddy/ui-mcp";
import { useSlotComponents } from "@openbuddy/ui-runtime/client";

interface Props {
  /** Navigate to the home page (after summoning an expert). */
  onGoHome?: () => void;
  onToast?: (message: string) => void;
  /** Required by MarketplacePanel for install / uninstall / update. Browse
   *  works without it; the panel falls back to a toast asking the user to
   *  open a session first. */
  sessionId?: string;
}

/** 专家·技能·连接器 — WorkBuddy-style unified market page.
 *  The pill group is rendered once here and passed into each tab's topbar
 *  left slot, mirroring WorkBuddy's `headerLeft` pattern. The "插件·市场"
 *  tab is the Pi plugin marketplace (with the official pi.dev catalog as a
 *  built-in remote source) so all resource browsing lives under this entry. */
export function ExpertsPanel({ onGoHome, onToast, sessionId }: Props) {
  const [tab, setTab] = useState<MarketTab>("experts");

  const pills = <MarketPills active={tab} onChange={setTab} />;

  return (
    <div className="um-market">
      {tab === "experts" && (
        <ExpertsTab pills={pills} onGoHome={onGoHome} onToast={onToast} />
      )}
      {tab === "skills" && <SkillsTab pills={pills} onToast={onToast} />}
      {tab === "connectors" && <ConnectorsTab pills={pills} onToast={onToast} />}
      {tab === "plugins" && (
        <PluginsTabContent pills={pills} sessionId={sessionId} onToast={onToast} />
      )}
    </div>
  );
}

/** Thin wrapper around <MarketplacePanel /> so the unified market page can
 *  keep its tabs header (the `pills` row) consistent across resources.
 *
 *  R-PhaseB.5: 「插件·市场」面板走内核 `modules.marketplace` 槽位:
 *  - 第三方插件可以注册更高优先级实现来整体替换内置 MarketplacePanel;
 *  - 内置实现(`@openbuddy/ui-mcp` MarketplacePanel)作为回退底座,这样
 *    插件卸载后视图自然恢复到稳定契约。
 *  - 同一时刻只有一个实现生效(slot="single"),避免双层重复渲染。 */
function PluginsTabContent({
  pills,
  sessionId,
  onToast,
}: {
  pills: ReactNode;
  sessionId?: string;
  onToast?: (message: string) => void;
}) {
  const slotImpls = useSlotComponents("modules.marketplace");
  const SlotImpl = slotImpls[0] as
    | ComponentType<{ sessionId?: string; onToast?: (m: string) => void }>
    | undefined;

  return (
    <div className="um-tab um-tab--plugins">
      <header className="um-topbar">
        <div className="um-topbar-left">{pills}</div>
      </header>
      <div className="um-tab-body">
        {SlotImpl ? (
          <SlotImpl sessionId={sessionId} onToast={onToast} />
        ) : (
          // 内置 MarketplacePanel 自己负责 reload-on-mount,正符合切回此 tab
          // 重新拉一次市场列表的预期。
          <MarketplacePanel sessionId={sessionId} onToast={onToast} />
        )}
      </div>
    </div>
  );
}
