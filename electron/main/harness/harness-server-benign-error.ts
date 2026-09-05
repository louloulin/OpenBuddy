/**
 * harness-server-benign-error.ts — error classifier shared by harness-server
 * send() / sendSse() paths.
 *
 * Extracted from harness-server.ts so the classifier can be unit-tested in
 * isolation. The mirror-test in harness-server.test.ts pins the behaviour so
 * downstream send() implementations can rely on:
 *   - "EPIPE" / "ERR_STREAM_WRITE_AFTER_END" → benign
 *   - "WebSocket is not open" / "socket hang up" / "write after end" → benign
 *   - everything else → escalates to console.error
 *
 * Why this exists:
 *   The previous inline implementation lived next to the websocket send
 *   calls; an uncaughtException thrown by ws when the peer closed mid-send
 *   would crash the entire Electron main process. Centralising the
 *   classifier makes the contract testable without spinning up a real
 *   harness server.
 */
export function isBenignSocketClose(error: unknown): boolean {
  if (!error) return false;
  const code = (error as { code?: string }).code;
  if (code === "EPIPE" || code === "ERR_STREAM_WRITE_AFTER_END") return true;
  const message = String((error as { message?: string }).message ?? "");
  return /EPIPE|socket hang up|write after end|WebSocket is not open/i.test(message);
}
