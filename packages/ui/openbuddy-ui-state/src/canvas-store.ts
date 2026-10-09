/**
 * Canvas 面板状态 —— 哪张画布开着、切到哪个 tab、面板多宽。
 *
 * 放渲染层而不是 SQLite:这里的 `CanvasTab` 是**UI 会话态**(同一会话里
 * 打开的几张画布),与 `openbuddy-storage` 的 `canvas_documents` 持久化
 * 文档是两回事 —— 后者管内容与修订历史,这里只管"此刻屏幕上开着什么"。
 *
 * 与 ToolSidePanel **互斥**:同一时刻只开一个右侧工作区。切会话时清空
 * (会话内状态不该跨会话残留,与 ToolSidePanel 的既有行为一致)。
 */
import { create } from "zustand";

/** 画布承载类型,与 `CanvasKind` 对齐;渲染侧自带一份避免 ui 包依赖 storage。 */
export type CanvasTabKind = "markdown" | "html" | "react" | "svg" | "code" | "image" | "pdf";

export interface CanvasTab {
  /** 会话内稳定的 tab 标识(= 画布 id)。 */
  canvasId: string;
  kind: CanvasTabKind;
  title: string;
  /** 承载内容:文本类直接给源码,图片/pdf 给工作区路径。 */
  content?: string;
  /** 图片/pdf 等二进制承载的来源路径。 */
  sourcePath?: string;
  /** 打开来源,用于"回到原消息"与埋点;不影响渲染。 */
  documentRef?: string;
}

export const CANVAS_DEFAULT_WIDTH = 620;
export const CANVAS_MIN_WIDTH = 360;
/** 画布最多占容器比例 —— 聊天列必须还剩得下转录区与输入框。 */
export const CANVAS_MAX_VIEWPORT_RATIO = 0.72;
export const CANVAS_WIDTH_KEY = "canvas-panel-width";

interface CanvasState {
  tabs: CanvasTab[];
  activeCanvasId: string | null;
  open: boolean;
  /** 用户期望宽度(px);实际生效宽度由 clampCanvasWidth 求解。 */
  width: number;
  /** 打开或聚焦一张画布(已存在则只切 tab,不重复插入)。 */
  openTab(tab: CanvasTab): void;
  /** 切到指定 tab;不在 tabs 里则忽略(避免面板空指向)。 */
  setActive(canvasId: string): void;
  /** 就地更新某张画布的内容(编辑器输入 / 沙箱回写)。 */
  updateContent(canvasId: string, content: string): void;
  renameTab(canvasId: string, title: string): void;
  closeTab(canvasId: string): void;
  close(): void;
  setWidth(width: number): void;
  /** 切换会话:丢弃整个面板。 */
  reset(): void;
}

function readStoredWidth(): number {
  if (typeof window === "undefined") return CANVAS_DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(CANVAS_WIDTH_KEY);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : CANVAS_DEFAULT_WIDTH;
  } catch {
    return CANVAS_DEFAULT_WIDTH;
  }
}

/**
 * 面板宽度上限:容器比例与「容器 − 聊天列最小宽」取小。
 * 窄窗口里纯按比例仍会把转录区挤没,所以再留一道绝对下限。
 */
export function clampCanvasWidth(
  desiredWidth: number,
  containerWidth: number,
): number {
  const base = Number.isFinite(desiredWidth) && desiredWidth > 0 ? desiredWidth : CANVAS_DEFAULT_WIDTH;
  const container = Number.isFinite(containerWidth) && containerWidth > 0 ? containerWidth : 0;
  const caps = [CANVAS_MAX_VIEWPORT_RATIO * (container || 1280)];
  if (container > 0) caps.push(container - 320);
  const max = Math.max(CANVAS_MIN_WIDTH, Math.min(...caps));
  return Math.min(Math.max(base, CANVAS_MIN_WIDTH), max);
}

export const useCanvasStore = create<CanvasState>((set) => ({
  tabs: [],
  activeCanvasId: null,
  open: false,
  width: readStoredWidth(),

  openTab: (tab) =>
    set((state) => {
      const exists = state.tabs.some((t) => t.canvasId === tab.canvasId);
      const tabs = exists
        ? state.tabs.map((t) => (t.canvasId === tab.canvasId ? { ...t, ...tab } : t))
        : [...state.tabs, tab];
      return { tabs, activeCanvasId: tab.canvasId, open: true };
    }),

  setActive: (canvasId) =>
    set((state) =>
      state.tabs.some((t) => t.canvasId === canvasId)
        ? { activeCanvasId: canvasId, open: true }
        : state,
    ),

  updateContent: (canvasId, content) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.canvasId === canvasId ? { ...t, content } : t)),
    })),

  renameTab: (canvasId, title) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.canvasId === canvasId ? { ...t, title } : t)),
    })),

  // 关掉当前 tab 时落到相邻的一个,而不是把面板留着指向一个已不存在的 id。
  closeTab: (canvasId) =>
    set((state) => {
      const index = state.tabs.findIndex((t) => t.canvasId === canvasId);
      if (index < 0) return state;
      const tabs = state.tabs.filter((t) => t.canvasId !== canvasId);
      if (tabs.length === 0) return { tabs, activeCanvasId: null, open: false };
      const nextActive =
        state.activeCanvasId === canvasId
          ? (tabs[Math.min(index, tabs.length - 1)]?.canvasId ?? null)
          : state.activeCanvasId;
      return { tabs, activeCanvasId: nextActive };
    }),

  close: () => set({ open: false }),

  setWidth: (width) => {
    try {
      window.localStorage.setItem(CANVAS_WIDTH_KEY, String(width));
    } catch {
      /* 隐私模式 / 配额满:宽度只留在内存里 */
    }
    set({ width });
  },

  reset: () => set({ tabs: [], activeCanvasId: null, open: false }),
}));
