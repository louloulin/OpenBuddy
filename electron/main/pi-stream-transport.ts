import { MessageChannelMain, type BrowserWindow, type MessagePortMain } from "electron";

export interface PiStreamBatch {
  version: 1;
  events: readonly unknown[];
}

export interface PiStreamTransport {
  attach(win: BrowserWindow): boolean;
  /**
   * Queue an update on the port. Returns false when no port is attached — the
   * caller must deliver it over plain IPC instead.
   */
  publish(payload: unknown): boolean;
  flush(): void;
  close(): void;
}

const STREAM_CHANNEL = "openbuddy://pi-stream-port";
const BATCH_WINDOW_MS = 16;
const MAX_BUFFERED_EVENTS = 4096;

/**
 * Main-process side of the high-frequency Pi stream.
 *
 * The normal Electron IPC event remains the compatibility/fallback path. A
 * transferred MessagePort is used only for `pi://update`, which avoids one
 * renderer IPC dispatch per token while preserving the existing event schema.
 *
 * Exactly one path carries each update: the port while it is healthy, IPC
 * otherwise. If a post fails the port is dropped and the undelivered batch is
 * handed to `onUndelivered` (IPC) — previously it was silently discarded and
 * every later delta vanished until reload.
 */
export function createPiStreamTransport(options: { onUndelivered?: (events: readonly unknown[]) => void } = {}): PiStreamTransport {
  let port: MessagePortMain | null = null;
  let buffered: unknown[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const post = (events: readonly unknown[]): void => {
    if (events.length === 0) return;
    if (!port) {
      options.onUndelivered?.(events);
      return;
    }
    const batch: PiStreamBatch = { version: 1, events };
    try {
      port.postMessage(batch);
    } catch {
      port = null;
      options.onUndelivered?.(events);
    }
  };

  const flush = (): void => {
    clearTimer();
    if (buffered.length === 0) return;
    const events = buffered;
    buffered = [];
    post(events);
  };

  return {
    attach(win): boolean {
      if (win.isDestroyed() || win.webContents.isDestroyed()) return false;
      const channel = new MessageChannelMain();
      if (port) {
        try { port.close(); } catch { /* best effort */ }
      }
      port = channel.port1;
      port.once("close", () => {
        if (port !== channel.port1) return;
        port = null;
        // Renderer reloaded / port torn down mid-batch: hand the pending
        // events to IPC instead of dropping them.
        flush();
      });
      try {
        channel.port1.start();
        win.webContents.postMessage(STREAM_CHANNEL, undefined, [channel.port2]);
        return true;
      } catch {
        port = null;
        try { channel.port1.close(); } catch { /* best effort */ }
        return false;
      }
    },
    publish(payload): boolean {
      if (!port) return false;
      buffered.push(payload);
      if (buffered.length >= MAX_BUFFERED_EVENTS) {
        flush();
        return true;
      }
      if (timer === null) timer = setTimeout(flush, BATCH_WINDOW_MS);
      return true;
    },
    flush,
    close(): void {
      clearTimer();
      buffered = [];
      if (port) {
        try { port.close(); } catch { /* best effort */ }
      }
      port = null;
    },
  };
}

export const PI_STREAM_CHANNEL = STREAM_CHANNEL;
export const PI_STREAM_BATCH_WINDOW_MS = BATCH_WINDOW_MS;
