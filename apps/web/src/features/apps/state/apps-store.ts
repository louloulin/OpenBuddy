import { create } from "zustand";
import { appsSetCurrent } from "@openbuddy/client/api/files";

/**
 * 当前应用 (20261126-upup / WorkBuddy 对齐)。
 *
 * WorkBuddy 顶栏有一个「当前应用」药丸，点开是 Buddy 应用面板（最近使用 + 推荐）。
 * 首页标题与场景行都跟随当前应用。状态放这里，侧栏切换器与首页共用。
 */
const CURRENT_APP_KEY = "openbuddy.current-app.v1";
const RECENT_APPS_KEY = "openbuddy.recent-apps.v1";
const DISMISSED_RECS_KEY = "openbuddy.dismissed-app-recs.v1";
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
  /** 推荐卡点过「不用了」的应用 (U5 / UP-6.2)：宿主那边也记了，这里让历史会话里的旧卡片同样收起。 */
  dismissedRecommendations: string[];
  dismissRecommendation: (id: string) => void;
}

export const useAppsStore = create<AppsState>((set, get) => ({
  currentAppId: readString(CURRENT_APP_KEY),
  recentAppIds: readList(RECENT_APPS_KEY),
  setCurrentApp: (id) => {
    write(CURRENT_APP_KEY, id ?? "");
    const recent = [id, ...get().recentAppIds.filter((x) => x !== id)].filter((x): x is string => !!x).slice(0, MAX_RECENT);
    write(RECENT_APPS_KEY, JSON.stringify(recent));
    set({ currentAppId: id, recentAppIds: recent });
    // 宿主侧持久化 (U4)：新会话的 system prompt 要跟随当前应用。
    // 没有宿主桥（单测/浏览器预览）时 invoke 会抛错，异步吞掉，不影响 UI。
    if (id) void Promise.resolve().then(() => appsSetCurrent(id)).catch(() => {});
  },
  dismissedRecommendations: readList(DISMISSED_RECS_KEY),
  dismissRecommendation: (id) => {
    const next = [...new Set([...get().dismissedRecommendations, id])];
    write(DISMISSED_RECS_KEY, JSON.stringify(next));
    set({ dismissedRecommendations: next });
  },
}));
