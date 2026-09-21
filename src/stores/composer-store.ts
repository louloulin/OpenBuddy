/**
 * composer-store — Renderer 级共享 Composer 状态。
 *
 * 第 4-5 周(P1-A):让任意面板(包括 EmailAiPanel 采纳 AI 回复建议时)
 * 都能从顶层打开 EmailComposer 模态,且预填 subject / body / threadId。
 *
 * 设计:
 *   - 单一 Zustand store,跨路由、跨面板共享。
 *   - EmailPanel 仍保留自己的本地 composer 状态;只在外部触发时 sync 进 store。
 *   - 默认无操作;`/src/components/ComposerPortal.tsx` 监听并渲染。
 */
import { create } from "zustand";

export interface ComposerInitial {
  subject?: string;
  body?: string;
  threadId?: string;
  draftId?: string;
  to?: string;
  cc?: string;
  bcc?: string;
}

export interface ComposerStoreState {
  open: boolean;
  initial: ComposerInitial | null;
  openComposer: (initial?: ComposerInitial) => void;
  closeComposer: () => void;
}

export const useComposerStore = create<ComposerStoreState>((set) => ({
  open: false,
  initial: null,
  openComposer: (initial) => set({ open: true, initial: initial ?? null }),
  closeComposer: () => set({ open: false, initial: null }),
}));
