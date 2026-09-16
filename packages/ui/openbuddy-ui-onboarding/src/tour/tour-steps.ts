/**
 * @openbuddy/ui-onboarding/tour-steps — 漫游(spotlight tour)的纯逻辑层
 *
 * 拆成"纯函数 + 声明式步骤"的原因:漫游的难点全在测量与定位 ——
 * 元素可能在、可能不在、可能在视口外。把这部分写成不碰 React 的纯函数,
 * 就能在 jsdom(没有真实布局)里把边界行为全部测掉,组件只剩渲染。
 *
 * 定位规则:
 *   - `target` 以 `.` / `#` / `[` 开头 → 当 CSS 选择器用;
 *   - 否则 → `[data-tour="<target>"]`(宿主只要在节点上标 `data-tour` 即可)。
 */

/** 漫游的持久化 key。 */
export const TOUR_STORAGE_KEY = "openbuddy.tour.state";

export type TourPlacement = "top" | "bottom" | "left" | "right" | "center";

export interface TourStep {
  id: string;
  title: string;
  body?: string;
  /** `data-tour` 值或 CSS 选择器;缺省 → 居中卡片。 */
  target?: string;
  placement?: TourPlacement;
  /** 高亮框相对目标的外扩(px),默认 6。 */
  padding?: number;
  /** 目标缺失时的策略:skip(默认)跳到下一步,wait 原地等待。 */
  whenMissing?: "skip" | "wait";
}

export interface TourRect {
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface TourSize {
  width: number;
  height: number;
}

export interface TourStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function storageOrDefault(storage?: TourStorageLike | null): TourStorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 是否应该自动弹出漫游(默认:没看过就弹)。storage 不可用时返回 false。 */
export function shouldAutoOpenTour(storage?: TourStorageLike | null): boolean {
  const target = storageOrDefault(storage);
  if (!target) return false;
  try {
    return target.getItem(TOUR_STORAGE_KEY) !== "seen";
  } catch {
    return false;
  }
}

/** 标记"看过了"(用户点完成或手动关闭都会写)。 */
export function markTourSeen(storage?: TourStorageLike | null): void {
  const target = storageOrDefault(storage);
  if (!target) return;
  try {
    target.setItem(TOUR_STORAGE_KEY, "seen");
  } catch {
    /* ignore */
  }
}

/** 重置漫游状态(设置里的"重新观看引导")。 */
export function resetTour(storage?: TourStorageLike | null): void {
  const target = storageOrDefault(storage);
  if (!target || typeof target.removeItem !== "function") return;
  try {
    target.removeItem(TOUR_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function isTourTargetSelector(target?: string): boolean {
  if (!target) return false;
  const head = target[0];
  return head === "." || head === "#" || head === "[";
}

/** 解析目标节点;找不到返回 null(不抛异常 —— 选择器可能本身非法)。 */
export function resolveTourTarget(
  target?: string,
  doc: Document | null = typeof document === "undefined" ? null : document,
): HTMLElement | null {
  if (!target || !doc) return null;
  const selector = isTourTargetSelector(target)
    ? target
    : `[data-tour="${target.replace(/"/g, '\\"')}"]`;
  try {
    const found = doc.querySelector(selector);
    return (found as HTMLElement | null) ?? null;
  } catch {
    return null;
  }
}

/** 把 DOMRect / 任意 rect-like 归一化成可比较的纯对象。 */
export function toTourRect(rect: {
  top: number;
  left: number;
  width: number;
  height: number;
}): TourRect {
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
  };
}

export function inflateTourRect(rect: TourRect, padding: number): TourRect {
  const pad = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  return {
    top: rect.top - pad,
    left: rect.left - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
    right: rect.right + pad,
    bottom: rect.bottom + pad,
  };
}

export interface TourProbe {
  found: boolean;
  /** 目标在视口内的相对坐标(rect 原样返回,不做滚动偏移猜测)。 */
  rect: TourRect | null;
}

/**
 * 探测一步的目标。jsdom / 未布局环境里 `getBoundingClientRect` 全为 0,
 * 那是"目标存在但没有尺寸",仍然是 found —— 组件据此渲染零尺寸高亮而不是跳步。
 */
export function probeTourStep(
  step: TourStep,
  doc: Document | null = typeof document === "undefined" ? null : document,
): TourProbe {
  if (!step.target) return { found: true, rect: null };
  const element = resolveTourTarget(step.target, doc);
  if (!element || typeof element.getBoundingClientRect !== "function") {
    return { found: false, rect: null };
  }
  const rect = toTourRect(element.getBoundingClientRect());
  return { found: true, rect: inflateTourRect(rect, step.padding ?? 6) };
}

const OPPOSITE: Record<TourPlacement, TourPlacement> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
  center: "center",
};

const MARGIN = 12;
const GAP = 14;

function clampNumber(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(value, max));
}

function placeFor(
  placement: TourPlacement,
  rect: TourRect,
  card: TourSize,
): { top: number; left: number } {
  switch (placement) {
    case "top":
      return {
        top: rect.top - card.height - GAP,
        left: rect.left + rect.width / 2 - card.width / 2,
      };
    case "bottom":
      return { top: rect.bottom + GAP, left: rect.left + rect.width / 2 - card.width / 2 };
    case "left":
      return {
        top: rect.top + rect.height / 2 - card.height / 2,
        left: rect.left - card.width - GAP,
      };
    case "right":
      return { top: rect.top + rect.height / 2 - card.height / 2, left: rect.right + GAP };
    case "center":
    default:
      return {
        top: rect.top + rect.height / 2 - card.height / 2,
        left: rect.left + rect.width / 2 - card.width / 2,
      };
  }
}

function fits(pos: { top: number; left: number }, card: TourSize, viewport: TourSize): boolean {
  return (
    pos.top >= MARGIN &&
    pos.left >= MARGIN &&
    pos.top + card.height <= viewport.height - MARGIN &&
    pos.left + card.width <= viewport.width - MARGIN
  );
}

/**
 * 计算卡片位置:先按声明的 placement,再试对侧,再试其余三侧,最后居中。
 * 返回的坐标已夹紧在视口内,因此调用方不需要再做二次兜底。
 */
export function computeCardPosition(
  rect: TourRect | null,
  placement: TourPlacement | undefined,
  card: TourSize,
  viewport: TourSize,
): { top: number; left: number; placement: TourPlacement } {
  const safeViewport: TourSize = {
    width: Math.max(card.width + MARGIN * 2, viewport.width || 0),
    height: Math.max(card.height + MARGIN * 2, viewport.height || 0),
  };
  const clamp = (pos: { top: number; left: number }) => ({
    top: clampNumber(pos.top, MARGIN, safeViewport.height - card.height - MARGIN),
    left: clampNumber(pos.left, MARGIN, safeViewport.width - card.width - MARGIN),
  });

  if (!rect) {
    const centered = {
      top: (safeViewport.height - card.height) / 2,
      left: (safeViewport.width - card.width) / 2,
    };
    return { ...clamp(centered), placement: "center" };
  }

  const primary: TourPlacement = placement ?? "bottom";
  const candidates: TourPlacement[] = [
    primary,
    OPPOSITE[primary],
    "bottom",
    "top",
    "right",
    "left",
  ];
  for (const candidate of candidates) {
    const pos = placeFor(candidate, rect, card);
    if (fits(pos, card, safeViewport)) return { ...pos, placement: candidate };
  }
  return { ...clamp(placeFor(primary, rect, card)), placement: primary };
}

/** 从 `from` 起找下一个"目标存在"的步骤;找不到返回 -1。 */
export function findAvailableTourIndex(
  steps: TourStep[],
  from: number,
  doc: Document | null = typeof document === "undefined" ? null : document,
): number {
  for (let i = Math.max(0, from); i < steps.length; i += 1) {
    const probe = probeTourStep(steps[i], doc);
    if (probe.found) return i;
  }
  return -1;
}

/**
 * OpenBuddy 的内置漫游步骤 —— 全部指向宿主已有的 `data-tour` 锚点。
 * 缺失的锚点会被自动跳过,因此这份默认值对"没接这些锚点"的宿主也是安全的。
 */
export const DEFAULT_TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "欢迎来到 OpenBuddy",
    body: "一个本地优先的 AI 工作台:会话、文件、技能都在你自己的机器上。",
    placement: "center",
  },
  {
    id: "sidebar",
    title: "左侧是会话与工作区",
    body: "在这里切换对话、工作区、技能与邮件;宽度可以拖拽,状态会记住。",
    target: "sidebar",
    placement: "right",
  },
  {
    id: "composer",
    title: "底部输入框是任务入口",
    body: "输入任务后回车即可;输入 / 唤起命令与技能,输入 @ 引用文件。",
    target: "composer",
    placement: "top",
  },
  {
    id: "workbench",
    title: "右侧工作台承接产物",
    body: "生成的文档、表格、代码会以 artifact 形式出现在这里,可多标签切换。",
    target: "workbench",
    placement: "left",
  },
  {
    id: "settings",
    title: "一切可配置",
    body: "主题、模型、数据目录、插件市场都在设置里。随时可从这里重新观看引导。",
    target: "settings-entry",
    placement: "bottom",
  },
];
