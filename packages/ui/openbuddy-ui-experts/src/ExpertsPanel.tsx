import type { ComponentType, ReactNode } from "react";
import { useEffect, useState } from "react";
import { MarketPills, type MarketTab } from "./MarketHeader";
import {
  MARKET_TAB_EVENT,
  clearRequestedMarketTab,
  consumeRequestedMarketTab,
  isMarketTab,
  readRequestedMarketTab,
} from "@/lib/navigation/market-tab";
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
  /** 宿主直接内嵌本面板时的起始 tab。缺省顺序:深链意图 → 本 prop → "experts"。 */
  initialTab?: MarketTab;
  /** R42 — WorkBuddy v5.4.7 左侧「任务」栏点击会话时调用,通常指向 shell
   *  的 handleSelectSession(切换活跃会话 + 加载历史)。不传则 TasksPanel
   *  退化为只读,点击时只发 toast。 */
  onSelectSession?: (sessionId: string, cwd?: string) => void;
}

/** 专家·技能·连接器 — WorkBuddy-style unified market page.
 *  The pill group is rendered once here and passed into each tab's topbar
 *  left slot, mirroring WorkBuddy's `headerLeft` pattern. The "插件·市场"
 *  tab is the Pi plugin marketplace (with the official pi.dev catalog as a
 *  built-in remote source) so all resource browsing lives under this entry. */
export function ExpertsPanel({ onGoHome, onToast, sessionId, initialTab, onSelectSession }: Props) {
  // R40 — tab 不再写死 "experts"。侧栏「腾讯文档 / 乐享知识库」的深链意图
  // (localStorage + 事件,见 @/lib/navigation/market-tab)优先于宿主传入的
  // initialTab,于是"提示说打开了连接器目录"和"实际落在哪"第一次真的对齐。
  const [tab, setTab] = useState<MarketTab>(
    () => consumeRequestedMarketTab() ?? initialTab ?? "experts",
  );

  // 面板已在屏幕上时(用户就停在「专家·技能·连接器」页再点侧栏入口),
  // 不会重新挂载,所以深链必须还有一个即时通道。
  useEffect(() => {
    const onRequest = (event: Event) => {
      const requested = (event as CustomEvent<unknown>).detail;
      const next = isMarketTab(requested) ? requested : readRequestedMarketTab();
      clearRequestedMarketTab();
      if (next) setTab(next);
    };
    window.addEventListener(MARKET_TAB_EVENT, onRequest);
    return () => window.removeEventListener(MARKET_TAB_EVENT, onRequest);
  }, []);

  const pills = <MarketPills active={tab} onChange={setTab} />;

  return (
    <div className="um-market">
      {tab === "experts" && (
        <ExpertsTabContent pills={pills} onGoHome={onGoHome} onToast={onToast} onSelectSession={onSelectSession} />
      )}
      {tab === "skills" && <SkillsTab pills={pills} onToast={onToast} />}
      {tab === "connectors" && <ConnectorsTab pills={pills} onToast={onToast} />}
      {tab === "plugins" && (
        <PluginsTabContent pills={pills} sessionId={sessionId} onToast={onToast} />
      )}
    </div>
  );
}

/** 专家网格走内核 `placeholder.experts` 槽位(与下面的 `modules.marketplace`
 *  同一模式):本包在 `client.tsx` 里把 `ExpertsTab` 注册为默认实现,第三方
 *  插件可以注册更高优先级实现整体替换;槽位为空时回退到本地组件 ——
 *  两条路径渲染的是同一个组件,因此卸载插件后视觉零变化。
 *
 *  为什么需要这层包装:此前 `placeholder.experts` 注册了却**没有任何消费者**
 *  (审计里是 dead 槽),插件替换专家的能力等于不存在。 */
function ExpertsTabContent({
  pills,
  onGoHome,
  onToast,
  onSelectSession,
}: {
  pills: ReactNode;
  onGoHome?: () => void;
  onToast?: (message: string) => void;
  onSelectSession?: (sessionId: string, cwd?: string) => void;
}) {
  const slotImpls = useSlotComponents("placeholder.experts");
  const SlotImpl = slotImpls[0] as
    | ComponentType<{
        pills: ReactNode;
        onGoHome?: () => void;
        onToast?: (message: string) => void;
      }>
    | undefined;
  const Impl = SlotImpl ?? ExpertsTab;
  return <Impl pills={pills} onGoHome={onGoHome} onToast={onToast} onSelectSession={onSelectSession} />;
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
