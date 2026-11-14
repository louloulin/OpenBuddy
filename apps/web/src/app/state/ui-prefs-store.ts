import { create } from "zustand";

/** Per-device display preferences (not synced, not part of the engine config). */
export interface UiPrefs {
  /** 简洁模式: fold a finished turn's steps behind "已完成 · 用时 Xs". */
  conciseMode: boolean;
}

const KEY = "openbuddy.ui-prefs";
const DEFAULTS: UiPrefs = { conciseMode: true };

function load(): UiPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<UiPrefs>) : {};
    return { conciseMode: typeof parsed.conciseMode === "boolean" ? parsed.conciseMode : DEFAULTS.conciseMode };
  } catch {
    return { ...DEFAULTS };
  }
}

export const useUiPrefs = create<UiPrefs & { setPrefs: (patch: Partial<UiPrefs>) => void }>((set, get) => ({
  ...load(),
  setPrefs: (patch) => {
    set(patch);
    try {
      localStorage.setItem(KEY, JSON.stringify({ conciseMode: get().conciseMode }));
    } catch {
      /* storage unavailable: keep the in-memory value */
    }
  },
}));
