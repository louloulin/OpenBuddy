import { useState } from "react";
import { MarketPills, type MarketTab } from "./MarketHeader";
import { ExpertsTab } from "./experts/ExpertsTab";
import { SkillsTab } from "./skills/SkillsTab";
import { ConnectorsTab } from "./connectors/ConnectorsTab";

export type { MarketTab };
/** A management view the app supplies for a tab whose catalog the host does not serve. */
export type MarketManagement = "skills" | "mcp" | "extensions";

/** Which catalog views the host serves (FeatureRegistry `requires`, pii W0.2/W0.3). */
export interface MarketAvailability {
  /** 专家中心 catalog (experts_load). */
  experts: boolean;
  /** 我的专家 (agents_list). */
  mine: boolean;
  /** 技能 catalog (skills_catalog_load). */
  skillsCatalog: boolean;
  /** 连接器 catalog (connectors_load). */
  connectorsCatalog: boolean;
}
export { BoundExpertBadge } from "./experts/BoundExpertBadge";
export { usePendingExpertStore, type PendingExpert } from "./state/pending-expert-store";

interface Props {
  /** Navigate to the home page (after summoning an expert). */
  onGoHome?: () => void;
  onToast?: (message: string) => void;
  /** Omitted: every catalog (the pre-registry behaviour). */
  available?: MarketAvailability;
  /**
   * Installed skills, MCP configuration and extensions (the former 技能与 MCP page, U7.6):
   * shown in the 技能 / 连接器 tabs while their catalog is not served, and as the 扩展 tab.
   */
  renderManagement?: (kind: MarketManagement, pills: React.ReactNode) => React.ReactNode;
  /** Tab to open first (e.g. 连接器 from the composer's 管理连接器). */
  initialTab?: MarketTab;
}

/** The tabs this panel can show: a tab needs its catalog or a management view. */
export function marketTabs(available: MarketAvailability, management: boolean): MarketTab[] {
  const tabs: MarketTab[] = [];
  if (available.experts || available.mine) tabs.push("experts");
  if (available.skillsCatalog || management) tabs.push("skills");
  if (available.connectorsCatalog || management) tabs.push("connectors");
  if (management) tabs.push("extensions");
  return tabs;
}

const ALL: MarketAvailability = { experts: true, mine: true, skillsCatalog: true, connectorsCatalog: true };

/** 专家·技能·连接器 — WorkBuddy-style unified market page.
 *  The pill group is rendered once here and passed into each tab's topbar
 *  left slot, mirroring WorkBuddy's `headerLeft` pattern. */
export function ExpertsPanel({ onGoHome, onToast, available = ALL, renderManagement, initialTab }: Props) {
  const tabs = marketTabs(available, !!renderManagement);
  const [chosen, setTab] = useState<MarketTab | undefined>(initialTab);
  const tab = chosen && tabs.includes(chosen) ? chosen : tabs[0];

  const pills = <MarketPills active={tab} onChange={setTab} tabs={tabs} />;

  return (
    <div className="um-market">
      {tab === "experts" && (
        <ExpertsTab pills={pills} onGoHome={onGoHome} onToast={onToast} views={{ center: available.experts, my: available.mine }} />
      )}
      {tab === "skills" && (available.skillsCatalog ? <SkillsTab pills={pills} onToast={onToast} /> : renderManagement?.("skills", pills))}
      {tab === "connectors" && (available.connectorsCatalog ? <ConnectorsTab pills={pills} onToast={onToast} /> : renderManagement?.("mcp", pills))}
      {tab === "extensions" && renderManagement?.("extensions", pills)}
    </div>
  );
}
