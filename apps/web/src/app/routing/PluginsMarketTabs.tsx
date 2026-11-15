import { useState } from "react";
import { PuzzlePieceIcon, RepoIcon } from "@openbuddy/ui/icon/icons/index";
import { PluginsPanel } from "../../features/experts/PluginsPanel";
import { MarketplacePanel } from "../../features/experts/MarketplacePanel";

/** 双 tab 容器：插件（已安装）/ 市场（可浏览安装）。Moved out of PlaceholderPage (registry route `插件·市场`). */
export function PluginsMarketTabs({
  sessionId,
  onToast,
}: {
  sessionId?: string;
  onToast?: (msg: string) => void;
}) {
  const [tab, setTab] = useState<"plugins" | "marketplace">("plugins");
  return (
    <div className="plugins-market-wrap">
      <div className="plugins-market-tabs">
        <button
          className={`plugins-market-tab ${tab === "plugins" ? "plugins-market-tab--active" : ""}`}
          onClick={() => setTab("plugins")}
        >
          <PuzzlePieceIcon size="sm" /> 插件
        </button>
        <button
          className={`plugins-market-tab ${tab === "marketplace" ? "plugins-market-tab--active" : ""}`}
          onClick={() => setTab("marketplace")}
        >
          <RepoIcon size="sm" /> 市场
        </button>
      </div>
      {tab === "plugins" ? (
        <PluginsPanel sessionId={sessionId} onToast={onToast} />
      ) : (
        <MarketplacePanel sessionId={sessionId} onToast={onToast} />
      )}
    </div>
  );
}
