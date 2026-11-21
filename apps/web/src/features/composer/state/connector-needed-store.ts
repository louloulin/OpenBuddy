import { create } from "zustand";

/** An MCP server the running turn could not use because it is not authorized (pii W2.5). */
export interface ConnectorNeeded {
  server: string;
  tool?: string;
  reason?: string;
}

interface ConnectorNeededState {
  /** sessionId → the server waiting for a sign-in. */
  pending: Record<string, ConnectorNeeded>;
  raise: (sessionId: string, need: ConnectorNeeded) => void;
  dismiss: (sessionId: string) => void;
}

/**
 * 即时连接卡 (pii W2.5): the engine reports `agent://connector-needed` when an MCP tool failed for
 * lack of authorization; the composer shows 需要连接 X [连接] until the user signs in or dismisses.
 */
export const useConnectorNeededStore = create<ConnectorNeededState>((set) => ({
  pending: {},
  raise: (sessionId, need) => set((state) => ({ pending: { ...state.pending, [sessionId]: need } })),
  dismiss: (sessionId) => set((state) => {
    const { [sessionId]: _gone, ...rest } = state.pending;
    return { pending: rest };
  }),
}));
