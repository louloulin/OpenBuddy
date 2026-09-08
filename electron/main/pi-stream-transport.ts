import { MessageChannelMain, type BrowserWindow, type MessagePortMain } from "electron";

export interface PiStreamBatch {
  version: 1;
  events: readonly unknown[];
}

export interface PiStreamTransport {
  attach(win: BrowserWindow): boolean;
  publish(payload: unknown): void;
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
 */
export function createPiStreamTransport(): PiStreamTransport {
  let port: MessagePortMain | null = null;
  let buffered: unknown[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const post = (events: readonly unknown[]): void => {
    if (!port || events.length === 0) return;
    const batch: PiStreamBatch = { version: 1, events };
    try {
      port.postMessage(batch);
    } catch {
      port = null;
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
        if (port === channel.port1) port = null;
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
    publish(payload): void {
      if (!port) return;
      buffered.push(payload);
      if (buffered.length >= MAX_BUFFERED_EVENTS) {
        flush();
        return;
      }
      if (timer === null) timer = setTimeout(flush, BATCH_WINDOW_MS);
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
