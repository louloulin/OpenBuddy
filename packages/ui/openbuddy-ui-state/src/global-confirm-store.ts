/**
 * Global confirm store — routes imperative `confirm()` calls to the
 * workbuddy-style `ConfirmDialog`.
 *
 * Previously, calls like `await confirm("确定卸载「…」？")` opened the legacy
 * native `dialog.showMessageBox`. That surface looked out of place in the
 * rest of the openbuddy UI (heavy black frame, system font, generic icon),
 * so all confirmations now route through this store. The host rendered by
 * `GlobalConfirmHost` mounts a single `ConfirmDialog` instance and resolves
 * the caller's promise when the user picks 取消 / 确定.
 *
 * The store deliberately uses a single pending entry (queue length 1):
 * sequential confirmations are the expected UX, and stacking native-style
 * popups over each other is exactly the bug we are fixing.
 */
import { create } from "zustand";

export type ConfirmTone = "info" | "warning" | "danger" | "neutral";

export interface ConfirmRequest {
  /** Stable identity so callers awaiting the same id can be deduped. */
  id: string;
  /** Dialog title. Empty / whitespace titles are coerced to "确认". */
  title: string;
  /** Optional body text below the title. */
  description?: string;
  /** Visual tone — drives icon color + confirm button style. */
  tone?: ConfirmTone;
  /** Override the confirm button label. Defaults to "确定". */
  confirmLabel?: string;
  /** Override the cancel button label. Defaults to "取消". */
  cancelLabel?: string;
  /** Resolve(true) when the user confirms, resolve(false) when cancelled. */
  resolve: (value: boolean) => void;
}

interface ConfirmStoreState {
  pending: ConfirmRequest | null;
  show: (request: Omit<ConfirmRequest, "resolve" | "id"> & { id?: string }) => Promise<boolean>;
  resolve: (id: string, value: boolean) => void;
  dismiss: () => void;
}

const FALLBACK_TITLE = "确认";

let requestCounter = 0;
const mintId = (): string => `confirm-${Date.now().toString(36)}-${(requestCounter += 1).toString(36)}`;

export const useGlobalConfirmStore = create<ConfirmStoreState>((set, get) => ({
  pending: null,
  show: ({ title, description, tone, confirmLabel, cancelLabel, id }) =>
    new Promise<boolean>((resolve) => {
      const requestId = id ?? mintId();
      // If a request is already pending, drain it as a cancellation so we
      // never strand a caller waiting on a dialog that's been replaced.
      const previous = get().pending;
      if (previous && previous.id !== requestId) previous.resolve(false);
      set({
        pending: {
          id: requestId,
          title: title.trim() || FALLBACK_TITLE,
          ...(description === undefined ? {} : { description }),
          ...(tone === undefined ? {} : { tone }),
          ...(confirmLabel === undefined ? {} : { confirmLabel }),
          ...(cancelLabel === undefined ? {} : { cancelLabel }),
          resolve,
        },
      });
    }),
  resolve: (id, value) => {
    const pending = get().pending;
    if (!pending || pending.id !== id) return;
    pending.resolve(value);
    set({ pending: null });
  },
  dismiss: () => {
    const pending = get().pending;
    if (!pending) return;
    pending.resolve(false);
    set({ pending: null });
  },
}));