import { create } from "zustand";

/**
 * 当前应用 (20261126-upup / WorkBuddy 对齐)。
 *
 * WorkBuddy 顶栏有一个「当前应用」药丸，点开是 Buddy 应用面板（最近使用 + 推荐）。
 * 首页标题与场景行都跟随当前应用。状态放这里，侧栏切换器与首页共用。
 */
const CURRENT_APP_KEY = "openbuddy.current-app.v1";
const RECENT_APPS_KEY = "openbuddy.recent-apps.v1";
const MAX_RECENT = 6;

function readString(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readList(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* localStorage 不可用时静默降级为内存态。 */
  }
}

interface AppsState {
  currentAppId: string | null;
  recentAppIds: string[];
  setCurrentApp: (id: string | null) => void;
}

export const useAppsStore = create<AppsState>((set, get) => ({
  currentAppId: readString(CURRENT_APP_KEY),
  recentAppIds: readList(RECENT_APPS_KEY),
  setCurrentApp: (id) => {
    write(CURRENT_APP_KEY, id ?? "");
    const recent = [id, ...get().recentAppIds.filter((x) => x !== id)].filter((x): x is string => !!x).slice(0, MAX_RECENT);
    write(RECENT_APPS_KEY, JSON.stringify(recent));
    set({ currentAppId: id, recentAppIds: recent });
  },
}));
