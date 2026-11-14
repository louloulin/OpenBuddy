import { create } from "zustand";
import type { ExtensionUiState } from "@openbuddy/client/agent-client";
interface ExtensionView {
  status: Record<string, string>;
  widgets: Record<string, string[]>;
  /** Widgets the extension placed below the composer. */
  below?: Record<string, true>;
  working?: string;
  title?: string;
  editor?: { action: "set" | "paste"; text: string; sequence: number };
}
export const useExtensionUiStore = create<{
  sessions: Record<string, ExtensionView>;
  apply: (event: ExtensionUiState) => void;
  clear: (sessionId: string) => void;
}>(set => ({
  sessions: {},
  apply: event => set(state => {
    if (!event.sessionId) return state;
    const previous = state.sessions[event.sessionId] ?? { status: {}, widgets: {} };
    const next = { ...previous };
    if (event.kind === "status") { next.status = { ...previous.status }; if (event.text) next.status[event.key] = event.text; else delete next.status[event.key]; }
    // setWorkingVisible(true) carries no message: keep the current one (20261115-ui C9).
    if (event.kind === "working") next.working = event.visible === false ? undefined : "message" in event ? event.message || undefined : previous.working;
    if (event.kind === "title") next.title = event.title;
    if (event.kind === "widget") {
      next.widgets = { ...previous.widgets };
      next.below = { ...previous.below };
      if (event.lines?.length) next.widgets[event.key] = event.lines; else delete next.widgets[event.key];
      if (event.lines?.length && event.placement === "belowEditor") next.below[event.key] = true; else delete next.below[event.key];
    }
    if (event.kind === "editor") next.editor = { action: event.action, text: event.text, sequence: (previous.editor?.sequence ?? 0) + 1 };
    return { sessions: { ...state.sessions, [event.sessionId]: next } };
  }),
  clear: sessionId => set(state => { const sessions = { ...state.sessions }; delete sessions[sessionId]; return { sessions }; }),
}));
