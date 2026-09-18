/**
 * 工作区面板(ToolSidePanel)的宽度/布局求解 —— 纯函数,可单测。
 *
 * 背景(实机测量,1280 / 1100 / 940 三个窗口宽度下都一样):
 *   面板默认 380px、左导航列默认 200px、中间 sash 5px
 *   → 主内容列只剩 175px,markdown 编辑器被压成十几个字符宽,完全不可用。
 *   `details` 助理导轨(35×72,fixed + z60)还压在面板右缘上。
 *
 * 求解策略(自适应,不是"让路"):
 *   1. 面板宽度按视口收敛:min(期望, 视口×0.6),永不小于 MIN_WIDTH;
 *   2. 导航列宽度也按面板收敛:min(期望, 面板宽 − 主列最小宽 − sash),不小于 MIN;
 *   3. 若收敛后主列仍 < MAIN_MIN_WIDTH,判定 `narrow` —— 组件切「主从」布局:
 *      未选中 → 整列列表;选中 → 整列内容 + 返回按钮。等价于把两栏
 *      在窄容器里折成单栏,而不是把两栏都压扁。
 *
 * 用户显式动作优先:`pinned`(钉住左列)强制两栏;用户点过「收起导航」时
 * 折叠态只在两栏模式下生效(单栏模式下导航列本身就是页面)。
 */

/** 面板默认宽度(px)。 */
export const PANEL_DEFAULT_WIDTH = 380;
/** 面板宽度下限:再窄就没有可用内容区了。 */
export const PANEL_MIN_WIDTH = 280;
/** 面板最多占视口比例。 */
export const PANEL_MAX_VIEWPORT_RATIO = 0.6;
/** 聊天列(输入框/转录区)必须留住的最小宽度。 */
export const CHAT_MIN_WIDTH = 320;
/** 导航列默认宽度。 */
export const NAV_DEFAULT_WIDTH = 200;
export const NAV_MIN_WIDTH = 140;
export const NAV_MAX_WIDTH = 360;
/** 折叠态导航列宽度(与 work-panel.css 的 `.tool-side-panel__nav--collapsed` 对齐)。 */
export const NAV_COLLAPSED_WIDTH = 36;
/** 导航列与主列之间的拖拽条宽度(与 .tool-side-panel__sash 对齐)。 */
export const NAV_SASH_WIDTH = 5;
/** 主内容列(预览/编辑器)可用的最小宽度;低于它就走单栏。 */
export const MAIN_MIN_WIDTH = 260;

export type PanelLayoutMode = "split" | "nav" | "main";

export interface PanelLayoutInput {
  /** 用户期望的面板宽度(localStorage / 拖拽结果)。 */
  desiredWidth: number;
  /** 用户期望的导航列宽度。 */
  desiredNavWidth: number;
  /** 视口宽度(浏览器 window.innerWidth)。 */
  viewportWidth: number;
  /**
   * 面板所在容器的可用宽度(面板 + 聊天列)。给了就再收一道:
   * 面板最多 `containerWidth − CHAT_MIN_WIDTH`,保证聊天列不被挤没。
   * 窄窗口里"窗口 60%"仍然可能把转录区挤到几十像素宽,这一道才是真保险。
   */
  containerWidth?: number;
  /** 用户点过「收起导航」。 */
  userCollapsed?: boolean;
  /** 钉住左列:强制两栏,不自动折成单栏。 */
  pinned?: boolean;
}

export interface PanelLayout {
  /** 实际生效的面板宽度。 */
  width: number;
  /** 两栏模式下的导航列宽度。 */
  navWidth: number;
  /** 两栏模式下的主列可用宽度。 */
  mainWidth: number;
  /** 面板装不下两栏 → 走主从单栏。 */
  narrow: boolean;
  /** 用户显式折叠导航列(仅在两栏模式有意义)。 */
  navCollapsed: boolean;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * 面板宽度上限:视口 60% 与「容器 − 聊天列最小宽」取小,且不小于下限
 * (极窄窗口下保住最小可用宽度 —— 宁可让聊天列难受,也不能让面板空转)。
 * `containerWidth` 缺省(还没测到)时只看视口比例。
 */
export function maxPanelWidth(viewportWidth: number, containerWidth?: number): number {
  const vw = finite(viewportWidth, 1280);
  const caps = [vw * PANEL_MAX_VIEWPORT_RATIO];
  const container = Number.isFinite(containerWidth) ? (containerWidth as number) : 0;
  if (container > 0) caps.push(container - CHAT_MIN_WIDTH);
  return Math.max(PANEL_MIN_WIDTH, Math.min(...caps));
}

export function clampPanelWidth(
  desiredWidth: number,
  viewportWidth: number,
  containerWidth?: number,
): number {
  const desired = finite(desiredWidth, PANEL_DEFAULT_WIDTH);
  return Math.min(
    Math.max(desired, PANEL_MIN_WIDTH),
    maxPanelWidth(viewportWidth, containerWidth),
  );
}

export function clampNavWidth(desiredNavWidth: number, panelWidth: number): number {
  const desired = finite(desiredNavWidth, NAV_DEFAULT_WIDTH);
  const room = panelWidth - NAV_SASH_WIDTH - MAIN_MIN_WIDTH;
  const upper = Math.max(NAV_MIN_WIDTH, Math.min(NAV_MAX_WIDTH, room));
  return Math.min(Math.max(desired, NAV_MIN_WIDTH), upper);
}

export function resolvePanelLayout(input: PanelLayoutInput): PanelLayout {
  const width = clampPanelWidth(
    input.desiredWidth,
    input.viewportWidth,
    input.containerWidth,
  );
  const navWidth = clampNavWidth(input.desiredNavWidth, width);
  const mainWidth = width - navWidth - NAV_SASH_WIDTH;
  const pinned = Boolean(input.pinned);
  const narrow = !pinned && mainWidth < MAIN_MIN_WIDTH;
  return {
    width,
    navWidth,
    mainWidth,
    narrow,
    navCollapsed: !pinned && Boolean(input.userCollapsed) && !narrow,
  };
}

/**
 * 由 `narrow` + 「当前视图是不是列表/详情型」+ 「有没有选中」推出三态布局。
 * - 两栏装得下            → "split"
 * - 单栏 + 已选中(未按返回) → "main"
 * - 单栏 + 未选中           → "nav"
 */
export function resolvePanelMode(options: {
  narrow: boolean;
  listDetailView: boolean;
  hasSelection: boolean;
  forceList?: boolean;
}): PanelLayoutMode {
  if (!options.narrow) return "split";
  if (!options.listDetailView) return "main";
  if (options.hasSelection && !options.forceList) return "main";
  return "nav";
}
