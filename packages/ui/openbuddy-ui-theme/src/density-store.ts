/**
 * density-store —— 界面密度三档(批B,对齐 Claude `--cds-rem-scale` 的
 * 用户可见效果:一个变量缩放整套 UI)。
 *
 * 实现:持久化档位 → `document.body.style.zoom`。zoom 是标准化属性
 * (css-viewport),body 级 zoom 让全部 UI(含 portal 到 body 的弹层)
 * 等比缩放 —— 等价于把全仓几何 px 逐个 calc 化,零字面量改造面。
 *
 * 自应用:import 即 apply(body 在 index.html 里静态存在,早于 React 挂载),
 * 因此设置面板是否打开过都不影响重启后的持久生效 —— 这修掉了旧「字号」
 * 滑块只在设置面板挂载期间生效的同类缺口(FONT_KEY 只在 SettingsSections
 * 的 effect 里 apply)。
 */

export type DensityName = "compact" | "standard" | "relaxed";

const KEY = "openbuddy.density";

export const DENSITY_SCALE: Record<DensityName, number> = {
  compact: 0.9,
  standard: 1,
  relaxed: 1.1,
};

export const DENSITY_LABELS: Record<DensityName, string> = {
  compact: "紧凑",
  standard: "标准",
  relaxed: "宽松",
};

function isDensityName(value: unknown): value is DensityName {
  return value === "compact" || value === "standard" || value === "relaxed";
}

function load(): DensityName {
  try {
    const raw = window.localStorage.getItem(KEY);
    return isDensityName(raw) ? raw : "standard";
  } catch {
    return "standard";
  }
}

function applyDensity(name: DensityName): void {
  const scale = DENSITY_SCALE[name];
  document.body.style.zoom = scale === 1 ? "" : String(scale);
  document.documentElement.dataset.density = name;
}

let current: DensityName = "standard";

/** 模块加载即读档 + 应用(重启持久)。浏览器环境外是 no-op。 */
export function initDensity(): void {
  if (typeof document === "undefined") return;
  current = load();
  applyDensity(current);
}

export function getDensity(): DensityName {
  return current;
}

export function setDensity(name: DensityName): void {
  if (!isDensityName(name)) return;
  current = name;
  try {
    window.localStorage.setItem(KEY, name);
  } catch {
    // 持久化失败不阻断应用(内存态仍是本会话真值)。
  }
  applyDensity(current);
}

/** reduce-motion 应用内开关(对齐 Claude data-reduce-motion 根属性)。 */
const REDUCE_KEY = "openbuddy.reduceMotion";

function applyReduceMotion(enabled: boolean): void {
  if (enabled) document.documentElement.setAttribute("data-reduce-motion", "true");
  else document.documentElement.removeAttribute("data-reduce-motion");
}

export function getReduceMotion(): boolean {
  try {
    return window.localStorage.getItem(REDUCE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setReduceMotion(enabled: boolean): void {
  try {
    window.localStorage.setItem(REDUCE_KEY, String(enabled));
  } catch {
    // 同上,不阻断。
  }
  applyReduceMotion(enabled);
}

export function initReduceMotion(): void {
  if (typeof document === "undefined") return;
  applyReduceMotion(getReduceMotion());
}

/** 一次性初始化(密度 + reduce-motion)。由主题初始化器调用。 */
export function initDisplayPreferences(): void {
  initDensity();
  initReduceMotion();
}
