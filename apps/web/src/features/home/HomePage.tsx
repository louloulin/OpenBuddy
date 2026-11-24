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
import { relativeTime } from "@/shared/lib/files/file-utils";
import { EmptyStateArt } from "./EmptyStateArt";
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
  /** Open an existing task from the 最近任务 list. */
  onOpenSession?: (sessionId: string, cwd?: string) => void;
  /** Open the full task search (「查看更多」). */
  onOpenSearch?: () => void;
}) {
  const { t, locale } = useLocale();
  const [modeId, setModeId] = useState<HomeModeId>("working");
  // G1-17: the scene decides whether the status chips show; a task started in the design
  // scene keeps them (WorkBuddy carries the design tab into the conversation).
  useEffect(() => { useStatusStore.getState().setScene(modeId); }, [modeId]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  // 输入框内黑色"操作类型"标签。
  const [sceneTag, setSceneTag] = useState<{ label: string; icon: HomeCategory["icon"] } | null>(null);
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
          <span className="home__brand">OpenBuddy</span>
          <h1 className="home__title">{mode.subtitle}</h1>
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
            <div className="home__recent-empty">
              <EmptyStateArt />
              <p className="home__recent-empty-title">{t("home.recentEmptyTitle")}</p>
              <p className="home__recent-empty-desc">{t("home.recentEmptyDesc")}</p>
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
