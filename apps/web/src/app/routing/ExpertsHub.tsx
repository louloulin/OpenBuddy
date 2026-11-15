import { useState } from "react";
import { ExpertsPanel, type MarketTab } from "../../features/experts";
import { AgentResourcesPanel } from "../../features/agent-resources/AgentResourcesPanel";
import { useCapabilitySnapshot } from "../state/capabilities-store";
import { isAvailable } from "./registry";
import { capabilityFeature, type CapabilityFeatureId } from "./capability-features";

let pendingTab: MarketTab | undefined;
/** Open the hub at a tab next time it mounts (the composer's 管理连接器 → 连接器). */
export function openHubAt(tab: MarketTab) {
  pendingTab = tab;
}

/**
 * 专家·技能·连接器 (pii W0.2/W0.3, U7.6). Catalog tabs follow the FeatureRegistry: a catalog
 * the host does not serve is not shown. The former 技能与 MCP page supplies the management
 * views: installed skills (技能), MCP configuration and OAuth (连接器) and trusted extensions (扩展).
 */
export function ExpertsHub({ cwd, sessionId, onGoHome, onToast }: { cwd?: string; sessionId?: string; onGoHome?: () => void; onToast?: (message: string) => void }) {
  const caps = useCapabilitySnapshot();
  const on = (id: CapabilityFeatureId) => isAvailable(capabilityFeature(id), caps);
  const [initialTab] = useState(() => { const tab = pendingTab; pendingTab = undefined; return tab; });
  return (
    <ExpertsPanel
      onGoHome={onGoHome}
      onToast={onToast}
      initialTab={initialTab}
      available={{ experts: on("experts-catalog"), mine: on("experts-mine"), skillsCatalog: on("skills-catalog"), connectorsCatalog: on("connectors-catalog") }}
      renderManagement={(kind, pills) => <AgentResourcesPanel key={kind} cwd={cwd} sessionId={sessionId} onToast={onToast} section={kind} header={pills} />}
    />
  );
}
