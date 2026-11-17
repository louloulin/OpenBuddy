/**
 * 通用偏好 (20261116-pii W6.3)：字号与信息密度。
 *
 * 只在渲染层生效：写 localStorage，并把 `data-font-size` / `data-density` 挂到
 * `<html>` 上，由 polish.css 控制字号与行高。主题走 ThemeProvider（同一个面板里切换）。
 */

export type FontSize = "small" | "normal" | "large";
export type Density = "comfortable" | "compact";

// 与「个性化」的数值字号（openbuddy.fontSize）分开：这里是三档预设，走整壳缩放。
const FONT_KEY = "openbuddy.fontSizePreset";
const DENSITY_KEY = "openbuddy.density";

export function loadFontSize(): FontSize {
  try {
    const value = localStorage.getItem(FONT_KEY);
    return value === "small" || value === "large" ? value : "normal";
  } catch {
    return "normal";
  }
}

export function loadDensity(): Density {
  try {
    return localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "comfortable";
  } catch {
    return "comfortable";
  }
}

function apply() {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.fontSize = loadFontSize();
  document.documentElement.dataset.density = loadDensity();
}

export function setFontSize(size: FontSize) {
  try {
    localStorage.setItem(FONT_KEY, size);
  } catch {
    /* storage may be unavailable */
  }
  apply();
}

export function setDensity(density: Density) {
  try {
    localStorage.setItem(DENSITY_KEY, density);
  } catch {
    /* storage may be unavailable */
  }
  apply();
}

/** Apply the saved preferences before the first paint (main.tsx). */
export function applyUiPreferences() {
  apply();
}
