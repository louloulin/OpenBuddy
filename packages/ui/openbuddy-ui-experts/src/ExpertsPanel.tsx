import type { ReactNode } from "react";
import { useState } from "react";
import { MarketPills, type MarketTab } from "./MarketHeader";
import { ExpertsTab } from "./experts/ExpertsTab";
import { SkillsTab } from "./skills/SkillsTab";
import { ConnectorsTab } from "./connectors/ConnectorsTab";
import { MarketplacePanel } from "@openbuddy/ui-mcp";

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
 *  keep its tabs header (the `pills` row) consistent across resources. We
 *  also persist the last-selected marketplace source so reopening this tab
 *  lands on the same source the user was last browsing. */
function PluginsTabContent({
  pills,
  sessionId,
  onToast,
}: {
  pills: ReactNode;
  sessionId?: string;
  onToast?: (message: string) => void;
}) {
  // MarketplacePanel re-fetches on mount, which is exactly what we want when
  // the user switches into this tab after editing a source elsewhere.
  return (
    <div className="um-tab um-tab--plugins">
      <header className="um-topbar">
        <div className="um-topbar-left">{pills}</div>
      </header>
      <div className="um-tab-body">
        <MarketplacePanel sessionId={sessionId} onToast={onToast} />
      </div>
    </div>
  );
}
