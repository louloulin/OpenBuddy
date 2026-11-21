import { collectTerminalRows, type TerminalRow } from "@openbuddy/chat-core/terminal-rows";
import { useTerminalStore } from "@/app/state/terminal-store";
import { useSessionStore } from "./session-store";

/** Stable empty list: a session with no terminal rows yet must not create a new array. */
const EMPTY_ROWS: readonly TerminalRow[] = [];

/**
 * Mirror background sessions' command output into the app-level terminal cache.
 *
 * The chat feature owns the transcripts; other surfaces (sidebar running tasks,
 * task overview) read the cache instead of reaching into this feature. Installed
 * once at startup by the app shell.
 */
export function installTerminalBridge(): () => void {
  const write = (sessionId: string, rows: ReturnType<typeof collectTerminalRows>) => {
    useTerminalStore.getState().setSession(sessionId, rows);
  };

  const sync = (transcripts: Record<string, { messages: never[] }>) => {
    for (const [sessionId, transcript] of Object.entries(transcripts)) {
      const rows = collectTerminalRows(transcript.messages as never);
      // A session that has never run a command has no entry yet: `bySession` is a plain
      // record, so the lookup misses. Reading `.length` on that miss used to throw and
      // abort the send that triggered the sync (new task → `setSession` → transcripts
      // change → sync), so the model was never called. An empty row list is the
      // correct "nothing to show" value.
      const current = useTerminalStore.getState().bySession[sessionId] ?? EMPTY_ROWS;
      const same = current.length === rows.length && current.every((row, i) => row.id === rows[i].id && row.output === rows[i].output);
      if (!same) write(sessionId, rows);
    }
  };

  const unsubscribe = useSessionStore.subscribe((state, prev) => {
    if (state.transcripts === prev.transcripts) return;
    sync(state.transcripts as never);
  });

  // Catch sessions that already streamed before the bridge was installed.
  sync(useSessionStore.getState().transcripts as never);

  return unsubscribe;
}
