import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Composer } from "../composer/Composer";
import { useStatusStore } from "@/shared/state/status-store";
import type { ModelOption } from "../models/ModelSelector";
import type { WorkspaceInfo } from "@openbuddy/client/agent-client";
import type { AgentEntry, SessionSummary } from "@openbuddy/protocol/dto";
import { LightbulbIcon, MoreIcon } from "@openbuddy/ui/icon/icons/index";
import { useHorizontalScroll } from "../../shared/hooks/use-horizontal-scroll";
import { useLocale } from "../../shared/i18n";
import { useSessionsStore, HOME_DRAFT_KEY } from "@/features/sessions/state/sessions-store";
import { appsList } from "@openbuddy/client/api/files";
import { useAppsStore } from "@/features/apps";
import { relativeTime } from "@/shared/lib/files/file-utils";
import { usePendingExpertStore } from "@/features/experts/state/pending-expert-store";
import {
  COLLAPSED_VISIBLE_COUNT,
  HOME_MODES,
  getMode,
  type HomeCategory,
  type HomeModeId,
  type HomeTemplate,
} from "../../shared/content/scenes";

/** 首页「最近任务」最多展示的条数。 */
const RECENT_TASKS_LIMIT = 5;

/** 模板 chip 右侧的 ↘ 斜箭头(复刻 WorkBuddy 的 quick-actions-sub 箭头)。 */
function ArrowRightSubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <g transform="translate(0 14) scale(1 -1)">
        <path
          fill="currentColor"
          fillRule="evenodd"
          transform="matrix(1 0 0 1 2.25385 2.09996)"
          d="M8.5963 5.775L8.5963 3.9772Q8.5963 2.6005 8.537 2.1664Q8.5175 2.0232 8.4867 1.9021L0.7425 9.6463L0 8.9038L7.7442 1.1596Q7.6231 1.1288 7.4799 1.1092Q7.0458 1.05 5.6691 1.05L3.8712 1.05L3.8712 0.0001L5.669 0.0001Q7.1171 0 7.6219 0.0689Q8.5026 0.1891 8.9799 0.6664Q9.4572 1.1437 9.5774 2.0244Q9.6463 2.5292 9.6462 3.9773L9.6462 5.775L8.5963 5.775Z"
        />
      </g>
    </svg>
  );
}

/**
 * WorkBuddy 风格首页:双行大标题 + 场景 tab + 能力 chip 行 + Composer。
 *
 * 复刻 WorkBuddy 的三级交互:
 *  1. 顶部场景 tab(日常办公/代码开发/设计创意)切换下方能力 chip 列表;
 *  2. 点击能力 chip → 该分类被选中,能力行隐藏并替换为推荐模板行(↘),
 *     同时在输入框内插入一个不可编辑的黑色"操作类型"标签(× 可删);
 *  3. 点击模板 chip → 把对应 prompt 填入输入框(保留操作类型标签)。
 * 能力行支持横向滚动(左右箭头 + 边缘渐隐 + 拖拽),超出折叠为前 N 个 + "更多"。
 */
export function HomePage({
  onSend,
  streaming,
  apiReady,
  onOpenSettings,
  onPlaceholder,
  modelId,
  models,
  onModelChange,
  cwd,
  workspaces,
  onSelectWorkspace,
  onSelectMode,
  onSelectExpert,
  onNavigateConnectors,
  onNavigate,
  onOpenSession,
  onOpenSearch,
}: {
  onSend: (text: string, attachments?: { path: string }[]) => void | Promise<void>;
  streaming: boolean;
  apiReady: boolean;
  onOpenSettings: () => void;
  onPlaceholder: (label: string) => void;
  modelId?: string;
  models?: ModelOption[];
  onModelChange?: (id: string) => void | Promise<void>;
  cwd?: string;
  workspaces?: WorkspaceInfo[];
  onSelectWorkspace?: (cwd: string) => void;
  onSelectMode?: (modeId: HomeModeId) => void;
  onSelectExpert?: (agent: AgentEntry) => void;
  onNavigateConnectors?: (tab?: "experts" | "connectors") => void;
  /** 顶部导航（最近任务空态的「查看」→ 应用页）。 */
  onNavigate?: (label: string) => void;
  /** Open an existing task from the 最近任务 list. */
  onOpenSession?: (sessionId: string, cwd?: string) => void;
  /** Open the full task search (「查看更多」). */
  onOpenSearch?: () => void;
}) {
  const { t, locale } = useLocale();
  const [modeId, setModeId] = useState<HomeModeId>("working");
  // 侧栏切换器选中的应用；变化时重算标题与场景行。
  const currentAppId = useAppsStore((s) => s.currentAppId);
  // G1-17: the scene decides whether the status chips show; a task started in the design
  // scene keeps them (WorkBuddy carries the design tab into the conversation).
  useEffect(() => { useStatusStore.getState().setScene(modeId); }, [modeId]);
  useEffect(() => {
    let alive = true;
    const load = () => {
      void (async () => {
        let apps: Awaited<ReturnType<typeof appsList>> = [];
        try {
          apps = (await appsList()) ?? [];
        } catch {
          return;
        }
        if (!alive) return;
        const real = (Array.isArray(apps) ? apps : []).filter((app) => app.kind !== "extension");
        // WorkBuddy 首页标题是「当前应用名 · 一句话定位」。优先用切换器选中的应用，
        // 否则退回第一个带 tagline 的真实应用（默认即 upup）。
        const chosen = real.find((app) => app.id === useAppsStore.getState().currentAppId);
        const primary = chosen ?? real.find((app) => app.kind === "app" && app.tagline) ?? real.find((app) => app.tagline);
        // 场景行只显示当前应用的场景；没显式选择时跟随默认应用（内置通用应用）。
        const scoped = chosen ? [chosen] : primary ? [primary] : real;
        const scenes = scoped.flatMap((app) =>
          (app.sceneList ?? []).map((scene) => ({ key: `${app.id}:${scene.id}`, app: app.name, name: scene.name, prompt: scene.prompt })),
        );
        setAppScenes(scenes.slice(0, 8));
        setCurrentApp(primary ? { name: primary.name, tagline: primary.tagline ?? "" } : null);
      })();
    };
    load();
    // 在别处装完应用回到首页时，场景行要能刷新出来。
    window.addEventListener("focus", load);
    return () => { alive = false; window.removeEventListener("focus", load); };
  }, [currentAppId]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  // 输入框内黑色"操作类型"标签。
  const [sceneTag, setSceneTag] = useState<{ label: string; icon: HomeCategory["icon"] } | null>(null);
  // 应用场景 (20261126-upup / WorkBuddy 对齐)：装了带 scenes 的应用时，首页出现它的场景。
  const [appScenes, setAppScenes] = useState<Array<{ key: string; app: string; name: string; prompt: string }>>([]);
  // 当前应用 (WorkBuddy 对齐)：标题显示「应用名 · 一句话定位」，不再固定「你的职场超能力」。
  const [currentApp, setCurrentApp] = useState<{ name: string; tagline: string } | null>(null);
  // 受控填充 Composer 的内容 + nonce(点模板时写入 prompt)。
  const [externalText, setExternalText] = useState("");
  const [externalTextNonce, setExternalTextNonce] = useState(0);
  // WorkBuddy-style first-run guide: only shown before a model is connected.
  // Not persisted — a fresh launch still offers the next step until configured.
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  // 首页草稿(哨兵 key):用户离开首页再回来,未发送的字还在。
  const homeDraft = useSessionsStore((s) => s.drafts[HOME_DRAFT_KEY] ?? "");
  const setDraft = useSessionsStore((s) => s.setDraft);

  // 最近任务 (WorkBuddy 首页的最近列表): 跨"独立任务"与"空间"取最近更新的会话。
  const independent = useSessionsStore((s) => s.independent);
  const workspaceSessions = useSessionsStore((s) => s.workspaceSessions);
  const recentSessions = useMemo(() => {
    const all = [...independent, ...Object.values(workspaceSessions).flat()];
    return all
      .filter((s: SessionSummary) => !s.archived)
      .sort((a: SessionSummary, b: SessionSummary) => Date.parse(b.updatedAt ?? "") - Date.parse(a.updatedAt ?? ""))
      .slice(0, RECENT_TASKS_LIMIT);
  }, [independent, workspaceSessions]);

  // Pending expert (set after "召唤" in the detail modal).
  const pendingExpert = usePendingExpertStore((s) => s.expert);
  const pendingHandledRef = useRef<string | null>(null);

  // When a pending expert arrives with a quickPrompt, pre-fill the composer.
  useEffect(() => {
    if (!pendingExpert) { pendingHandledRef.current = null; return; } // summoning the same expert again re-fills
    // Only auto-fill once per expert (avoid re-filling if user clears it).
    if (pendingHandledRef.current === pendingExpert.expertId) return;
    pendingHandledRef.current = pendingExpert.expertId;
    if (pendingExpert.quickPrompt) {
      fillComposer(pendingExpert.quickPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingExpert]);

  const mode = getMode(modeId);
  const categories = mode.categories;
  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === selectedCategoryId),
    [categories, selectedCategoryId]
  );

  /** 写入 Composer 并聚焦(nonce 递增保证连续点同一模板也生效)。 */
  const fillComposer = (text: string) => {
    setExternalText(text);
    setExternalTextNonce((n) => n + 1);
  };

  // 切换场景 tab:换 chip 列表,并清空选中/标签/输入。
  const handleModeChange = (next: HomeModeId) => {
    setModeId(next);
    setSelectedCategoryId(undefined);
    setExpanded(false);
    setSceneTag(null);
    fillComposer("");
  };

  // 点击能力 chip:选中则插标签 + 显示模板行;再点一次则取消。
  const handleCategoryClick = (cat: HomeCategory) => {
    if (selectedCategoryId === cat.id) {
      // 取消选中:清空标签与输入,回到能力行。
      setSelectedCategoryId(undefined);
      setSceneTag(null);
      fillComposer("");
      return;
    }
    setSelectedCategoryId(cat.id);
    setSceneTag({ label: cat.label, icon: cat.icon });
    fillComposer(""); // 选中分类时清空旧输入,只留标签(匹配 WorkBuddy)
  };

  // 点击模板 chip:把 prompt 填入输入框(保留操作类型标签)。
  const handleTemplateClick = (tpl: HomeTemplate) => {
    fillComposer(tpl.prompt);
  };

  // 输入框标签的 ×:清空标签、选中态与输入。
  const handleClearSceneTag = () => {
    setSceneTag(null);
    setSelectedCategoryId(undefined);
    fillComposer("");
  };

  // 能力行:未选中且未展开时,折叠为前 N 个 + "更多"。
  const shouldCollapse =
    !selectedCategory && !expanded && categories.length > COLLAPSED_VISIBLE_COUNT;
  const visibleCategories = shouldCollapse
    ? categories.slice(0, COLLAPSED_VISIBLE_COUNT)
    : categories;

  const listScroll = useHorizontalScroll([
    categories.length,
    expanded,
    selectedCategoryId,
    modeId,
  ]);
  const subScroll = useHorizontalScroll([
    selectedCategoryId,
    selectedCategory?.templates.length ?? 0,
  ]);

  const sceneCls = (id: HomeModeId) =>
    "home__scene" + (modeId === id ? " home__scene--active" : "");

  return (
    <div className="home">
      <div className="home__inner">
        <header className="home__header">
          {/* WorkBuddy 首页标题跟随当前应用；没有应用时退回品牌 + 场景副标题。 */}
          {!currentApp && <span className="home__brand">OpenBuddy</span>}
          <h1 className="home__title">{currentApp ? `${currentApp.name} · ${currentApp.tagline}` : mode.subtitle}</h1>
        </header>

        {!apiReady && !onboardingDismissed && (
          <section className="home__onboarding" aria-label="快速开始">
            <span className="home__onboarding-icon" aria-hidden="true"><LightbulbIcon size="md" /></span>
            <div className="home__onboarding-body">
              <strong className="home__onboarding-title">先连接模型，再开始第一个任务</strong>
              <p className="home__onboarding-desc">现在写入的内容会保留在输入框里；配置完成后即可直接发送。</p>
            </div>
            <div className="home__onboarding-actions">
              <button type="button" className="home__onboarding-action home__onboarding-action--primary" onClick={onOpenSettings}>配置模型</button>
              <button type="button" className="home__onboarding-action" onClick={() => setOnboardingDismissed(true)}>暂不配置</button>
            </div>
          </section>
        )}

        {appScenes.length > 0 ? (
          <div className="home__scenes" role="tablist" aria-label="应用场景">
            {appScenes.map((scene, index) => (
              <button
                key={scene.key}
                type="button"
                role="tab"
                aria-selected={index === 0}
                aria-label={`应用场景 ${scene.name}`}
                title={scene.prompt}
                className={"home__scene" + (index === 0 ? " home__scene--active" : "")}
                onClick={() => fillComposer(scene.prompt)}
              >
                <span>{scene.name}</span>
                {/* 单一应用时不重复标应用名（标题已经是应用）；多应用来源才用后缀区分。 */}
                {new Set(appScenes.map((s) => s.app)).size > 1 && (
                  <span className="home__scene-app">{scene.app}</span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="home__scenes" role="tablist" aria-label="场景">
            {HOME_MODES.map((m) => (
              <button
                key={m.id}
                role="tab"
                aria-selected={modeId === m.id}
                aria-label={m.label}
                className={sceneCls(m.id)}
                onClick={() => handleModeChange(m.id)}
              >
                <m.icon size={14} />
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        )}

        <section className="home__composer-area">
          {/* 二级:能力 chip 行(选中分类后隐藏,替换为三级模板行) */}
          {!selectedCategory && (
            <div
              className={
                "home__chips" +
                (listScroll.canScrollLeft ? " home__chips--fade-left" : "") +
                (listScroll.canScrollRight ? " home__chips--fade-right" : "")
              }
            >
              {listScroll.canScrollLeft && (
                <button
                  type="button"
                  className="home__chips-arrow home__chips-arrow--left"
                  aria-label="向左滚动"
                  onClick={() => listScroll.scrollByStep("left")}
                >
                  <ChevronLeft size={16} />
                </button>
              )}
              <div ref={listScroll.containerRef} className="home__chips-list" {...listScroll.bind}>
                {visibleCategories.map((cat) => (
                  <button
                    key={cat.id}
                    className="home__chip"
                    aria-label={cat.label}
                    onClick={() => handleCategoryClick(cat)}
                  >
                    <span className="home__chip-icon" aria-hidden="true">
                      <cat.icon size={16} />
                    </span>
                    <span>{cat.label}</span>
                  </button>
                ))}
                {shouldCollapse && (
                  <button
                    className="home__chip home__chip--more"
                    aria-label="更多"
                    onClick={() => setExpanded(true)}
                  >
                    <span className="home__chip-icon" aria-hidden="true">
                      <MoreIcon size="sm" />
                    </span>
                    <span>更多</span>
                  </button>
                )}
              </div>
              {listScroll.canScrollRight && (
                <button
                  type="button"
                  className="home__chips-arrow home__chips-arrow--right"
                  aria-label="向右滚动"
                  onClick={() => listScroll.scrollByStep("right")}
                >
                  <ChevronRight size={16} />
                </button>
              )}
            </div>
          )}

          {/* 三级:推荐模板行(↘),仅在选中某个能力分类后显示 */}
          {selectedCategory && (
            <div
              className={
                "home__chips home__chips--sub" +
                (subScroll.canScrollLeft ? " home__chips--fade-left" : "") +
                (subScroll.canScrollRight ? " home__chips--fade-right" : "")
              }
            >
              {subScroll.canScrollLeft && (
                <button
                  type="button"
                  className="home__chips-arrow home__chips-arrow--left"
                  aria-label="向左滚动"
                  onClick={() => subScroll.scrollByStep("left")}
                >
                  <ChevronLeft size={16} />
                </button>
              )}
              <div ref={subScroll.containerRef} className="home__chips-list" {...subScroll.bind}>
                {selectedCategory.templates.map((tpl, i) => (
                  <button
                    key={i}
                    className="home__template"
                    title={tpl.prompt}
                    aria-label={tpl.title}
                    onClick={() => handleTemplateClick(tpl)}
                  >
                    <span className="home__template-text">{tpl.title}</span>
                    <span className="home__template-arrow" aria-hidden="true">
                      <ArrowRightSubIcon />
                    </span>
                  </button>
                ))}
              </div>
              {subScroll.canScrollRight && (
                <button
                  type="button"
                  className="home__chips-arrow home__chips-arrow--right"
                  aria-label="向右滚动"
                  onClick={() => subScroll.scrollByStep("right")}
                >
                  <ChevronRight size={16} />
                </button>
              )}
            </div>
          )}

          <Composer
            streaming={streaming}
            onSend={onSend}
            onCancel={() => {}}
            apiReady={apiReady}
            onOpenSettings={onOpenSettings}
            onPlaceholder={onPlaceholder}
            sceneTag={sceneTag}
            onClearSceneTag={handleClearSceneTag}
            externalText={externalText}
            externalTextNonce={externalTextNonce}
            modelId={modelId}
            models={models}
            onModelChange={onModelChange}
            cwd={cwd}
            workspaces={workspaces}
            onSelectWorkspace={onSelectWorkspace}
            showMeta
            draft={homeDraft}
            draftKey={HOME_DRAFT_KEY}
            onDraftChange={(t) => setDraft(HOME_DRAFT_KEY, t)}
            onSelectMode={(id) => {
              setModeId(id);
              onSelectMode?.(id);
            }}
            onSelectExpert={onSelectExpert}
            onNavigateConnectors={onNavigateConnectors}
            activeExpertName={pendingExpert?.name}
            activeExpertAvatar={pendingExpert?.avatarLocal}
            onClearExpert={pendingExpert ? () => usePendingExpertStore.getState().clear() : undefined}
          />
        </section>

        <section className="home__recent" aria-label={t("home.recent")}>
          <div className="home__recent-head">
            <h2 className="home__recent-title">{t("home.recent")}</h2>
            {onOpenSearch && recentSessions.length > 0 && (
              <button type="button" className="home__recent-more" onClick={onOpenSearch}>
                {t("home.viewAll")}
              </button>
            )}
          </div>
          {recentSessions.length === 0 ? (
            <div className="home__guide">
              <span className="home__guide-icon" aria-hidden="true"><LightbulbIcon size="md" /></span>
              <div className="home__guide-body">
                <strong className="home__guide-title">应用使用指南</strong>
                <span className="home__guide-desc">了解已安装应用的场景与工具；从「应用」页可以启停应用、进入场景。</span>
              </div>
              <button type="button" className="home__guide-action" onClick={() => onNavigate?.("应用")}>
                查看
              </button>
            </div>
          ) : (
            <ul className="home__recent-list">
              {recentSessions.map((session) => (
                <li key={session.sessionId} className="home__recent-item">
                  <button
                    type="button"
                    className="home__recent-item-btn"
                    onClick={() => onOpenSession?.(session.sessionId, session.cwd)}
                    title={session.title || t("home.untitledTask")}
                  >
                    <span className="home__recent-item-title">
                      {session.title || t("home.untitledTask")}
                    </span>
                    <span className="home__recent-item-meta">
                      {session.updatedAt && (
                        <span className="home__recent-item-time">{relativeTime(session.updatedAt, locale)}</span>
                      )}
                      {session.cwd && (
                        <span className="home__recent-item-space">{session.cwd.split(/[\\/]/).filter(Boolean).pop()}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="home__disclaimer">{t("home.disclaimer")}</p>
      </div>
    </div>
  );
}
