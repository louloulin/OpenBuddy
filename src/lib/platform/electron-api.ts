import { PendingRpcChannel } from "../../../packages/runtime/openbuddy-plugin-host/src/rpc-contract";
import { createRendererLogger, type RendererLogger } from "@openbuddy/logging-renderer";

export type UnlistenFn = () => void;

export interface ElectronEvent<T = unknown> {
  type: string;
  payload: T;
}

export interface ElectronWindowApi {
  apiVersion: 1;
  invoke: (channel: string, args?: unknown) => Promise<unknown>;
  rpc: {
    request: (message: unknown) => Promise<unknown>;
    onMessage: (handler: (message: unknown) => void) => UnlistenFn;
  };
  harness?: {
    address: () => Promise<{ host: string; port: number; baseUrl: string; token?: string } | undefined>;
    loadSessionCursors: () => Promise<Record<string, number>>;
    saveSessionCursors: (cursor: Record<string, number>) => Promise<unknown>;
  };
  clipboard: {
    readText: () => Promise<string>;
    writeText: (text: string) => Promise<void>;
  };
  events: {
    on: (channel: string, handler: (payload: unknown) => void) => UnlistenFn;
  };
  dialog: {
    open: (options?: unknown) => Promise<string | string[] | null>;
    save: (options?: unknown) => Promise<string | null>;
    ask: (options: { message: string; title?: string; okLabel?: string; cancelLabel?: string }) => Promise<boolean>;
    confirm: (options: { message: string }) => Promise<boolean>;
    message: (options: { message: string }) => Promise<void>;
  };
  window: {
    label: () => string;
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    onResized: (handler: () => void | Promise<void>) => Promise<UnlistenFn>;
  };
  webview: {
    label: () => string;
    onDragDropEvent: (handler: (event: { payload: unknown }) => void) => Promise<UnlistenFn>;
  };
  debug: {
    enabled: boolean;
    toggleDevTools: () => Promise<void>;
    reload: () => Promise<void>;
    forceReload: () => Promise<void>;
    info: () => Promise<{ url: string; readyState: string; userAgent: string }>;
  };
}

export function getElectronBridgeStatus(): { available: boolean; reason?: string; apiVersion?: number } {
  const api = (window as Window & { api?: { apiVersion?: unknown } }).api;
  if (!api) return { available: false, reason: "preload-not-loaded" };
  if (api.apiVersion !== 1) return { available: false, reason: "unsupported-version", apiVersion: typeof api.apiVersion === "number" ? api.apiVersion : undefined };
  return { available: true, apiVersion: 1 };
}

export class ElectronBridgeUnavailableError extends Error {
  readonly name = "ElectronBridgeUnavailable";
  readonly reason: string;
  readonly apiVersion?: number;
  constructor(reason: string, apiVersion?: number) {
    super(`Electron bridge is unavailable: ${reason}`);
    this.reason = reason;
    if (apiVersion !== undefined) this.apiVersion = apiVersion;
  }
}

export function isElectronBridgeUnavailable(err: unknown): boolean {
  if (err instanceof ElectronBridgeUnavailableError) return true;
  if (err && typeof err === "object" && (err as { name?: unknown }).name === "ElectronBridgeUnavailable") return true;
  return false;
}

export async function listenSafe<T = unknown>(
  channel: string,
  handler: (event: ElectronEvent<T>) => void,
  onUnavailable?: (err: ElectronBridgeUnavailableError) => void,
): Promise<UnlistenFn | null> {
  try {
    return await listen<T>(channel, handler);
  } catch (err) {
    if (isElectronBridgeUnavailable(err)) {
      onUnavailable?.(err as ElectronBridgeUnavailableError);
      return null;
    }
    throw err;
  }
}

const channelAliases: Record<string, string> = {
  open_url: "shell:open-external",
  open_path: "shellfs:open-path",
  reveal_in_folder: "shellfs:reveal",
  browse_directory: "shellfs:browse-directory",
  list_dir: "shellfs:list-dir",
  path_stat: "shellfs:stat",
  read_text_file: "shellfs:read-text",
  write_text_file: "shellfs:write-text",
  export_text_file: "shellfs:export-text",
};

export function normalizeElectronChannel(channel: string): string {
  return channelAliases[channel] ?? channel;
}

let _bridgeLogger: RendererLogger | null = null;
let _loggedPreloadMissing = false;
let _loggedUnsupportedVersion = false;

export function getBridgeLogger(): RendererLogger {
  if (!_bridgeLogger) {
    const devMode = ((typeof import.meta !== "undefined" && (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) || false);
    _bridgeLogger = createRendererLogger({ devMode, name: "bridge" });
  }
  return _bridgeLogger;
}

function getApi(): ElectronWindowApi {
  const api = (window as Window & { api?: unknown }).api;
  if (!api) {
    if (!_loggedPreloadMissing) {
      _loggedPreloadMissing = true;
      getBridgeLogger().warn("bridge unavailable", { msg: "bridge.unavailable", reason: "preload-not-loaded" });
    }
    throw new ElectronBridgeUnavailableError("preload-not-loaded");
  }
  if (typeof api !== "object" || api === null || (api as { apiVersion?: unknown }).apiVersion !== 1) {
    if (!_loggedUnsupportedVersion) {
      _loggedUnsupportedVersion = true;
      getBridgeLogger().warn("bridge unavailable", { msg: "bridge.unavailable", reason: "unsupported-version" });
    }
    const apiVer = (api as { apiVersion?: unknown }).apiVersion;
    throw new ElectronBridgeUnavailableError("unsupported-version", typeof apiVer === "number" ? apiVer : undefined);
  }
  return api as ElectronWindowApi;
}

export async function invoke<T = unknown>(channel: string, args?: unknown): Promise<T> {
  try {
    return (await getApi().invoke(normalizeElectronChannel(channel), args)) as T;
  } catch (e) {
    // Electron wraps every thrown error as
    //   "Error invoking remote method '<channel>': <inner>"
    // Strip the wrapper before re-throwing so callers' friendlyError()
    // only sees the real inner message and can pattern-match it cleanly.
    if (e instanceof Error && e.name === "ElectronBridgeUnavailable") {
      getBridgeLogger().warn("bridge invoke failed", { msg: "bridge.invoke.failed", channel, error: e.message });
    }
    const raw = e instanceof Error ? e.message : String(e);
    const stripped = raw.replace(/^Error invoking remote method '[^']+':\s*/i, "");
    if (e instanceof Error) {
      // R7.2 — preserve custom properties (e.g. EmailError.code, .retryAfterMs)
      // so callers' pattern matching (provider_unavailable -> dedicated toast /
      // global whitelist / connection-state banner) survives the IPC wrap round-trip.
      // Without this, 'code' was silently dropped and the user faced a half-rendered
      // panel with no recovery action.
      const out = new Error(stripped || raw) as Error & Record<string, unknown>;
      out.name = e.name;
      out.stack = e.stack;
      for (const key of Object.getOwnPropertyNames(e)) {
        if (key === "message" || key === "name" || key === "stack") continue;
        try {
          out[key] = (e as unknown as Record<string, unknown>)[key];
        } catch {
          // Some props are getter-only / non-writable; skip rather than abort.
        }
      }
      throw out;
    }
    throw new Error(stripped || raw);
  }
}

/**
 * R6.8 — IPC 调用带超时。主进程卡死(死锁/无限循环)时,invoke() 永远不会
 * resolve,renderer 端的 await 永远挂起,UI 看起来"卡住了"。这个 wrapper
 * 在超时后 reject 一个明确错误,让上层能进入 catch,弹 toast + 释放锁。
 *
 * 默认 30 秒 —— 一般 IPC 应远小于这个值;agent 启动/大文件读取可能更久,
 * 调超时上限 5 分钟。
 */
const DEFAULT_IPC_TIMEOUT_MS = 30_000;
const MAX_IPC_TIMEOUT_MS = 300_000;

export class IpcTimeoutError extends Error {
  constructor(public readonly channel: string, public readonly timeoutMs: number) {
    super(`IPC 调用超时(${timeoutMs}ms): ${channel}`);
    this.name = "IpcTimeoutError";
  }
}

export async function invokeWithTimeout<T = unknown>(
  channel: string,
  args?: unknown,
  timeoutMs: number = DEFAULT_IPC_TIMEOUT_MS,
): Promise<T> {
  const capped = Math.min(Math.max(timeoutMs, 1000), MAX_IPC_TIMEOUT_MS);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new IpcTimeoutError(channel, capped)), capped);
  });
  try {
    return await Promise.race([invoke<T>(channel, args), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function rpcRequest<T = unknown>(message: unknown): Promise<T> {
  return (await getApi().rpc.request(message)) as T;
}

let rendererRpcChannel: PendingRpcChannel | undefined;
let rendererRpcBridgeUnlisten: UnlistenFn | undefined;
const rendererRpcInteractionWaiters = new Map<string, { resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }>();

function getRendererRpcChannel(): PendingRpcChannel {
	if (rendererRpcChannel) return rendererRpcChannel;
	rendererRpcChannel = new PendingRpcChannel(async (message) => { await getApi().rpc.request(message); });
	registerDefaultRendererRpcHandlers(rendererRpcChannel);
  rendererRpcBridgeUnlisten = getApi().rpc.onMessage((message) => {
    void rendererRpcChannel?.receive(message);
  });
  return rendererRpcChannel;
}

export function ensureRendererRpcChannel(): void {
	getRendererRpcChannel();
}

function registerDefaultRendererRpcHandlers(channel: PendingRpcChannel): void {
	channel.on("session.event", () => ({ accepted: true as const }));
	channel.on("plugin.event", () => ({ accepted: true as const }));
	channel.on("session.permission", (payload) => waitForRendererRpcInteraction(payload));
	channel.on("session.question", (payload) => waitForRendererRpcInteraction(payload));
}

function waitForRendererRpcInteraction(payload: unknown): Promise<unknown> {
	const requestId = payload && typeof payload === "object" && typeof (payload as { requestId?: unknown }).requestId === "string"
		? (payload as { requestId: string }).requestId : undefined;
	if (!requestId) return Promise.resolve({ cancelled: true });
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			rendererRpcInteractionWaiters.delete(requestId);
			resolve({ cancelled: true });
		}, 30_000);
		timer.unref?.();
		rendererRpcInteractionWaiters.set(requestId, { resolve, timer });
	});
}

export function resolveRendererRpcInteraction(requestId: string, value: unknown): boolean {
	const waiter = rendererRpcInteractionWaiters.get(requestId);
	if (!waiter) return false;
	rendererRpcInteractionWaiters.delete(requestId);
	clearTimeout(waiter.timer);
	waiter.resolve(value);
	return true;
}

export function registerRendererRpcHandler(method: string, handler: (payload: unknown) => unknown | Promise<unknown>): UnlistenFn {
	return getRendererRpcChannel().on(method, handler);
}

export function rendererRpcChannelRequest(method: string, payload: unknown, signal?: AbortSignal) {
  return getRendererRpcChannel().request(method, payload, signal);
}

export function listenRpc(handler: (message: unknown) => void): UnlistenFn {
  const unlisten = getApi().rpc.onMessage(handler);
  getRendererRpcChannel();
  return () => {
    unlisten();
    void rendererRpcBridgeUnlisten;
  };
}

export async function listen<T = unknown>(
  channel: string,
  handler: (event: ElectronEvent<T>) => void,
): Promise<UnlistenFn> {
  return getApi().events.on(channel, (payload) => handler({ type: channel, payload: payload as T }));
}

export async function open(options: Record<string, unknown> = {}): Promise<string | string[] | null> {
  return getApi().dialog.open(options);
}

export async function save(options: Record<string, unknown> = {}): Promise<string | null> {
  return getApi().dialog.save(options);
}

export async function ask(
  message: string,
  options?: { title?: string; okLabel?: string; cancelLabel?: string },
): Promise<boolean> {
  return getApi().dialog.ask({ message, ...options });
}

export async function confirm(message: string): Promise<boolean> {
  return getApi().dialog.confirm({ message });
}

export async function message(messageText: string): Promise<void> {
  await getApi().dialog.message({ message: messageText });
}

export function getCurrentWindow(): ElectronWindowApi["window"] {
  return getApi().window;
}

export function getCurrentWebview(): ElectronWindowApi["webview"] {
  return getApi().webview;
}

export function convertFileSrc(filePath: string): string {
  return filePath;
}
