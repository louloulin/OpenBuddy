import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Composer } from "@openbuddy/ui-conversation";

import type { ModelOption } from "@openbuddy/ui-workbench";
import type { WorkspaceInfo } from "@/lib/agent/pi-client";
import type { AgentEntry } from "@openbuddy/shared-types";
import { MoreIcon, SparklesIcon, CloseIcon } from "@openbuddy/ui-primitives/icons";
import { useHorizontalScroll } from "@openbuddy/ui-shared";
import { useSessionsStore, HOME_DRAFT_KEY } from "@/stores/sessions-store";
import { useRendererSlot } from "@/lib/runtime/renderer-plugin-runtime";
import { RendererSlotView } from "@openbuddy/ui-workbench";
import { usePendingExpertStore } from "@/stores/pending-expert-store";
import {
  HOME_MODES,
  getMode,
  type HomeCategory,
  type HomeModeId,
  type HomeTemplate,
} from "@openbuddy/ui-shared";

/** 未展开时,能力 chip 行最多显示几个(超出折叠为"更多")。与 home-scenes 保持一致(7 = WorkBuddy 日常办公场景下的完整 chip 数)。 */
const COLLAPSED_VISIBLE_COUNT = 7;

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

/** 最佳实践案例"换一批"按钮上的刷新图标。 */
function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 0 1 15.5-6.36L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.36L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

/**
 * 「最佳实践案例」数据 —— 对齐 WorkBuddy 首页底部 4 张案例卡片。
 * 视觉上每张卡片有渐变背景 + 中英文双行标题 + 角落装饰 glyph;
 * 点击会直接把对应 prompt 写入输入框(不切换场景)。
 */
const BEST_PRACTICES: ReadonlyArray<{
  titleZh: string;
  titleEn?: string;
  glyph: string;
  gradient: string;
  prompt: string;
}> = [
  {
    titleZh: "全能生活工作台",
    titleEn: "All-in-one workspace",
    glyph: "📅",
    gradient: "linear-gradient(135deg, #d6e9ff 0%, #b8d4ff 100%)",
    prompt:
      "请帮我搭建一个全能生活工作台:整合日历、待办、笔记与项目进度,生成一份今日概览,包含优先事项与时间块建议。",
  },
  {
    titleZh: "投资者交流会金句手绘",
    titleEn: "Investor meeting quotes",
    glyph: "✍️",
    gradient: "linear-gradient(135deg, #ffe5d6 0%, #ffd1b8 100%)",
    prompt:
      "请根据我的会议录音或笔记,提炼出 5 条金句,每条配上简短解释,并给出适合分享的标题与配图建议。",
  },
  {
    titleZh: "个人投资组合再平衡仪表盘",
    titleEn: "Portfolio rebalance",
    glyph: "📊",
    gradient: "linear-gradient(135deg, #e3f5e1 0%, #c8e8c3 100%)",
    prompt:
      "请根据我的投资组合当前权重与目标权重,生成一份再平衡方案,包括每类资产的买卖数量、预期手续费与税务影响。",
  },
  {
    titleZh: "新产品上市 GTM 发布计划",
    titleEn: "New product launch plan",
    glyph: "🚀",
    gradient: "linear-gradient(135deg, #f0e1ff 0%, #dcc4ff 100%)",
    prompt:
      "请帮我做一份新产品上市的 GTM(Go-to-Market)发布计划:目标人群、关键卖点、发布节奏、渠道与衡量指标。",
  },
];

/**
 * WorkBuddy 风格首页:双行大标题 + 场景 tab + 能力 chip 行 + Composer +
 * 活动 banner + 最佳实践案例。
 *
 * 复刻 WorkBuddy 的三级交互:
 *  1. 顶部场景 tab(日常办公/代码开发/设计创意)切换下方能力 chip 列表;
 *  2. 点击能力 chip → 该分类被选中,能力行隐藏并替换为推荐模板行(↘),
 *     同时在输入框内插入一个不可编辑的黑色"操作类型"标签(× 可删);
 *  3. 点击模板 chip → 把对应 prompt 填入输入框(保留操作类型标签)。
 * 能力行支持横向滚动(左右箭头 + 边缘渐隐 + 拖拽),超出折叠为前 N 个 + "更多"。
 *
 * 全面对齐 WorkBuddy 的额外结构:
 *   - 顶部右侧"做任务赢积分好礼"chip(链接活动入口)
 *   - 右上方活动 banner(可关闭)
 *   - Composer 下方"最佳实践案例"卡片网格(4 张)
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
  onOpenActivity,
}: {
  onSend: (text: string) => void;
  streaming: boolean;
  apiReady: boolean;
  onOpenSettings: () => void;
  onPlaceholder: (label: string) => void;
  modelId?: string;
  models?: ModelOption[];
  onModelChange?: (id: string) => void;
  cwd?: string;
  workspaces?: WorkspaceInfo[];
  onSelectWorkspace?: (cwd: string) => void;
  onSelectMode?: (modeId: HomeModeId) => void;
  onSelectExpert?: (agent: AgentEntry) => void;
  onNavigateConnectors?: () => void;
  /** 打开"活动中心"入口(右上"做任务赢积分好礼"chip / banner)。 */
  onOpenActivity?: () => void;
}) {
  const [modeId, setModeId] = useState<HomeModeId>("working");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  // 输入框内黑色"操作类型"标签。
  const [sceneTag, setSceneTag] = useState<{ label: string; icon: HomeCategory["icon"] } | null>(null);
  // 受控填充 Composer 的内容 + nonce(点模板时写入 prompt)。
  const [externalText, setExternalText] = useState("");
  const [externalTextNonce, setExternalTextNonce] = useState(0);
  // 活动 banner 关闭状态(本次会话内不再次弹)。
  const [bannerDismissed, setBannerDismissed] = useState(false);
  // 最佳实践案例 banner 关闭状态。
  const [practicesBannerDismissed, setPracticesBannerDismissed] = useState(false);
  // 最佳实践案例刷新 nonce(下方的"换一批")。
  const [practicesNonce, setPracticesNonce] = useState(0);
  // 首页草稿(哨兵 key):用户离开首页再回来,未发送的字还在。
  const homeDraft = useSessionsStore((s) => s.drafts[HOME_DRAFT_KEY] ?? "");
  const setDraft = useSessionsStore((s) => s.setDraft);
  const workspaceHeroSlots = useRendererSlot("conversation.hero.workspace");
  const brandHeroSlots = useRendererSlot("conversation.hero.brand.mark");

  // Pending expert (set after "召唤" in the detail modal).
  const pendingExpert = usePendingExpertStore((s) => s.expert);
  const pendingHandledRef = useRef<string | null>(null);

  // When a pending expert arrives with a quickPrompt, pre-fill the composer.
  useEffect(() => {
    if (!pendingExpert) return;
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

  const handleModeChange = (next: HomeModeId) => {
    setModeId(next);
    setSelectedCategoryId(undefined);
    setExpanded(false);
    setSceneTag(null);
  };

  const handleCategoryClick = (cat: HomeCategory) => {
    if (selectedCategoryId === cat.id) {
      setSelectedCategoryId(undefined);
      setSceneTag(null);
      return;
    }
    setSelectedCategoryId(cat.id);
    setSceneTag({ label: cat.label, icon: cat.icon });
  };

  // 点击模板 chip:把 prompt 填入输入框(保留操作类型标签)。
  const handleTemplateClick = (tpl: HomeTemplate) => {
    fillComposer(tpl.prompt);
  };

  const handleClearSceneTag = () => {
    setSceneTag(null);
    setSelectedCategoryId(undefined);
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
  const sceneTabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleSceneTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    const lastIndex = HOME_MODES.length - 1;
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % HOME_MODES.length;
    else if (event.key === "ArrowLeft") nextIndex = index === 0 ? lastIndex : index - 1;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = lastIndex;
    else return;

    event.preventDefault();
    const nextTab = sceneTabRefs.current[nextIndex];
    nextTab?.focus();
    nextTab?.click();
  };

  /** 最佳实践案例 —— 对齐 WorkBuddy 的"不知道做什么，试试最佳实践案例"。 */
  const bestPractices = useMemo(() => BEST_PRACTICES, []);

  return (
    <div className="home">
      <div className="home__inner">
        {/* 顶部右上:做任务赢积分好礼 chip(对齐 WorkBuddy) */}
        <div className="home__topbar">
          <div className="home__topbar-spacer" aria-hidden="true" />
          <button
            type="button"
            className="home__points-chip"
            aria-label="做任务赢积分好礼"
            onClick={() => onOpenActivity?.()}
          >
            <span className="home__points-chip-icon" aria-hidden="true">
              <SparklesIcon size={14} />
            </span>
            <span>做任务赢积分好礼</span>
            <ChevronRight size={14} />
          </button>
        </div>

        {/* 活动 banner(对齐 WorkBuddy 的"活动"卡片,可关闭) */}
        {!bannerDismissed && (
          <div className="home__activity-banner" role="region" aria-label="活动">
            <div className="home__activity-banner-icon" aria-hidden="true">
              <SparklesIcon size={16} />
            </div>
            <div className="home__activity-banner-text">
              <strong>活动</strong>
              <p>做任务赢积分好礼，认证用户尊享积分兑换 🎁</p>
            </div>
            <button
              type="button"
              className="home__activity-banner-cta"
              onClick={() => onOpenActivity?.()}
            >
              领 1000 积分
            </button>
            <button
              type="button"
              className="home__activity-banner-close"
              aria-label="关闭活动"
              onClick={() => setBannerDismissed(true)}
            >
              ×
            </button>
          </div>
        )}

        <header className="home__header">
          {brandHeroSlots.map((entry) => (
            <RendererSlotView key={String(entry.options.id ?? entry.options.name)} entry={entry} className="home__brand-plugin" />
          ))}
          <h1 className="home__title">OpenBuddy</h1>
          <p className="home__subtitle">{mode.subtitle}</p>
        </header>
        {workspaceHeroSlots.map((entry) => (
          <RendererSlotView key={String(entry.options.id ?? entry.options.name)} entry={entry} className="home__workspace-plugin" />
        ))}

        <div className="home__scenes" role="tablist" aria-label="场景">
          {HOME_MODES.map((m, index) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={modeId === m.id}
              aria-controls="home-mode-panel"
              aria-label={m.label}
              tabIndex={modeId === m.id ? 0 : -1}
              className={sceneCls(m.id)}
              ref={(element) => {
                sceneTabRefs.current[index] = element;
              }}
              onClick={() => handleModeChange(m.id)}
              onKeyDown={(event) => handleSceneTabKeyDown(event, index)}
            >
              <m.icon size={14} />
              <span>{m.label}</span>
            </button>
          ))}
        </div>

        <section
          id="home-mode-panel"
          role="tabpanel"
          aria-label={mode.label}
          tabIndex={-1}
          className="home__composer-area"
        >
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
          />
        </section>
        {/* 最佳实践案例 —— 对齐 WorkBuddy 的"不知道做什么，试试最佳实践案例" */}
        <section className="home__practices" aria-label="最佳实践案例">
          <header className="home__practices-header">
            <h2 className="home__practices-title">不知道做什么，试试最佳实践案例</h2>
            <div className="home__practices-actions">
              <button
                type="button"
                className="home__practices-refresh"
                aria-label="换一批"
                onClick={() => setPracticesNonce((n) => n + 1)}
              >
                <RefreshIcon />
                <span>换一批</span>
              </button>
              <span className="home__practices-divider" aria-hidden="true">|</span>
              <button
                type="button"
                className="home__practices-dismiss"
                aria-label="收起"
                onClick={() => setPracticesBannerDismissed(true)}
              >
                <CloseIcon />
              </button>
            </div>
          </header>
          {!practicesBannerDismissed && (
            <div className="home__practices-grid" key={practicesNonce}>
              {bestPractices.map((p) => (
                <button
                  key={p.titleZh}
                  type="button"
                  className="home__practice-card"
                  aria-label={p.titleZh}
                  style={{ background: p.gradient }}
                  onClick={() => fillComposer(p.prompt)}
                >
                  <span className="home__practice-card-title">
                    <span>{p.titleZh}</span>
                    {p.titleEn && <small>{p.titleEn}</small>}
                  </span>
                  <span className="home__practice-card-glyph" aria-hidden="true">
                    {p.glyph}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
