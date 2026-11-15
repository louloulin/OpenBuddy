import { create } from "zustand";
import { settingsAgentGet, settingsAgentSet } from "@openbuddy/client/agent-client";

/**
 * Favourite models (20261116-pii W1.6), persisted by the host in pi-settings.json as Pi's
 * `enabledModels`. Keys are provider-qualified model keys (`model:<provider>/<model>`), in the
 * order Ctrl/Cmd+P cycles through them.
 */
export const useFavoriteModels = create<{
  keys: string[];
  loaded: boolean;
  /** Re-read from the host (the settings screen can change the list too). */
  load: () => Promise<void>;
  /** Star / unstar; rolls back and rethrows when the host refuses. */
  toggle: (key: string) => Promise<void>;
}>((set, get) => ({
  keys: [],
  loaded: false,
  load: async () => {
    try {
      set({ keys: (await settingsAgentGet()).favoriteModels, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  toggle: async (key) => {
    const previous = get().keys;
    const next = previous.includes(key) ? previous.filter((k) => k !== key) : [...previous, key];
    set({ keys: next });
    try {
      set({ keys: (await settingsAgentSet({ favoriteModels: next })).favoriteModels });
    } catch (error) {
      set({ keys: previous });
      throw error;
    }
  },
}));

/** The favourite after `current` among the models that still exist (wraps around). */
export function nextFavorite(favorites: readonly string[], available: readonly string[], current?: string): string | undefined {
  const usable = favorites.filter((key) => available.includes(key));
  if (!usable.length) return undefined;
  const index = current ? usable.indexOf(current) : -1;
  const next = usable[(index + 1) % usable.length];
  return next === current ? undefined : next;
}
