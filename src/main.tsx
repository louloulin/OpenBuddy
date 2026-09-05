import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
// The modular theme package owns the shared semantic tokens. Import it before
// the app-level styles so any later OpenBuddy token can refine it deliberately.
import "@openbuddy/ui-theme/styles";
import { startRendererPluginEventBridge } from "./lib/runtime/renderer-plugin-runtime";
import { setToast } from "./stores/toast-store";
import { useSessionStore } from "./stores/session-store";
import { abandonInFlightStream } from "./lib/agent/abandon-stream";
import "./styles/global.css";
import "./styles/app.css";
import "./styles/automation-wb.css";
import "./styles/theme-dark-overrides.css";

// R2.4 — boot Composer-draft persistence (localStorage mirror of
// sessions-store.drafts) so unsent text survives a renderer reload.
import { bootDraftsPersistence } from "./stores/drafts-persistence";
bootDraftsPersistence();

// Wire the renderer-side cordis context to main plugin events before React
// mounts so `useMainPluginStatus`/`useRendererContributions` already see the
// replayed history. The bridge is torn down on HMR via its returned disposer.
// `startRendererPluginEventBridge()` may take a tick to replay history; we
// register the disposer optimistically so HMR cleanup never sees a stray
// listener even if the bridge is still mid-flight.
let stopRendererPluginBridge: (() => void) | null = null;
const viteHot = (import.meta as ImportMeta & { hot?: { dispose: (cb: () => void) => void } }).hot;
if (viteHot) {
  viteHot.dispose(() => {
    stopRendererPluginBridge?.();
    stopRendererPluginBridge = null;
  });
}
void startRendererPluginEventBridge().then((stop) => {
  if (viteHot && stopRendererPluginBridge === null) stopRendererPluginBridge = stop;
}).catch((error) => {
  console.error("[openbuddy] renderer plugin bridge failed", error);
});

// R6.8 — 全局兜底:任何未处理的 promise rejection 都不能让用户面对死锁的 UI。
// 1) console.error 保留(开发调试用);
// 2) ElectronBridgeUnavailable 不弹(那是状态指示);
// 3) 其他情况弹一个稳定的 toast id (用户可以关掉);
// 4) **关键**:如果当前会话还卡在 streaming=true,顺手 setError 让 streamingMessageId
//   归零 —— 否则用户面对的就是"AI 不再说话但 Composer 还锁着"的死锁场景。
let lastUnhandledToastKey = "";
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const name = reason && typeof reason === "object" && "name" in reason ? (reason as { name?: string }).name : undefined;
  if (name === "ElectronBridgeUnavailable") {
    console.warn("[OpenBuddy] unhandled ElectronBridgeUnavailable:", reason);
    return;
  }
  console.error("[OpenBuddy] unhandled rejection:", reason);
  // 同 key 5s 内只弹一次,避免某个反复失败的 promise 把 toast 队列打满。
  const key = `${name ?? "Error"}::${(reason instanceof Error ? reason.message : String(reason)).slice(0, 80)}`;
  const now = Date.now();
  const last = lastUnhandledToastKey;
  if (last.startsWith(key) && now - Number(last.slice(key.length + 1) || "0") < 5000) return;
  lastUnhandledToastKey = `${key}::${now}`;
  const message = reason instanceof Error ? reason.message : String(reason);
  setToast(`内部错误已捕获:${message.slice(0, 160)}`, {
    kind: "error",
    id: "unhandled-rejection",
    ttlMs: 0,
    action: {
      label: "解锁 Composer",
      onClick: () => {
        // 把任何挂起的 streaming 转成错误,触发 streamingMessageId 归零。
        useSessionStore.getState().setError("已手动结束挂起的会话。");
      },
    },
  });
  // 兜底解锁:就算用户没点 toast,也确保 streaming 不卡死。
  const sid = useSessionStore.getState().sessionId;
  if (sid && useSessionStore.getState().streaming) {
    useSessionStore.getState().setError(`未处理异常中断了会话:${message.slice(0, 80)}`);
  }
});

// window.error 也兜一层 —— 渲染期同步 throw 在 React tree 内由 ErrorBoundary 接住,
// 但有些代码路径 (event handler, async callback) 会冒泡到 window.onerror。
let lastWindowErrorKey = "";
window.addEventListener("error", (event) => {
  // React/SyntaxError 等已经被 ErrorBoundary 兜住的就不重复弹;
  // 这里只处理来自事件处理器或异步回调的全局 throw。
  if (!event.error) return;
  console.error("[OpenBuddy] window error:", event.error);
  const message = event.error instanceof Error ? event.error.message : String(event.error);
  const key = message.slice(0, 80);
  const now = Date.now();
  if (lastWindowErrorKey === key && now - Number((window as unknown as { __lastWindowErrorAt?: number }).__lastWindowErrorAt ?? 0) < 5000) return;
  lastWindowErrorKey = key;
  (window as unknown as { __lastWindowErrorAt?: number }).__lastWindowErrorAt = now;
  setToast(`运行时报错:${message.slice(0, 160)}`, { kind: "error", id: "window-error", ttlMs: 8000 });
  const sid = useSessionStore.getState().sessionId;
  if (sid && useSessionStore.getState().streaming) {
    useSessionStore.getState().setError(`同步异常中断了会话:${message.slice(0, 80)}`);
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  // R2.3 — root ErrorBoundary. Catches render-phase throws that would
  // otherwise white-screen the whole renderer (Markdown parsing errors,
  // plugin slot bugs, etc). The fallback is a friendly card with reset
  // + reload buttons. See src/components/ErrorBoundary.tsx.
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

// R6.8 — 流式死锁看门狗。
// 用户场景:AI 在 harness 端卡死(网络断、流式 retry 风暴、tool 调用挂起),但
// `agent-died` 事件没发出来,导致 sessionStore.streaming 永远 true,Composer
// 锁死,用户点了也没反应。这个看门狗记录最近一次 streaming 状态变化的时间,
// 若超过 STREAM_WATCHDOG_MS 还没动,主动 setError 释放 streamingMessageId,
// 让用户至少能发新消息或退出。
const STREAM_WATCHDOG_MS = 60_000;
const STREAM_WATCHDOG_TICK_MS = 10_000;
let lastStreamChange = Date.now();
let lastStreaming = false;
// P2-05: track the watchdog timeout so we can clear it when streaming ends.
// Previously this was a 10s setInterval that fired forever and re-checked
// the watchdog condition on every tick. Now: schedule a single
// setTimeout(WATCHDOG_MS) when streaming flips true, clear it on the
// flip back to false. Zero wakeups while idle.
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
const fireWatchdog = (): void => {
  lastStreamChange = Date.now();
  useSessionStore.getState().setError("AI 引擎长时间无响应,已自动结束当前轮次。可重发或重新加载。");
  setToast("AI 引擎长时间无响应,已自动结束当前轮次。", {
    kind: "warning",
    id: "stream-watchdog",
    ttlMs: 0,
    action: {
      label: "重新加载应用",
      onClick: () => {
        if (typeof window !== "undefined" && window.location) window.location.reload();
      },
    },
  });
  // Force-finalise the in-flight assistant bubble so the loading row goes
  // away (previously the watchdog only set an error and left the orphan
  // bubble spinning forever — see src/lib/agent/abandon-stream.ts).
  const focusedSessionId = useSessionStore.getState().sessionId;
  if (focusedSessionId) {
    abandonInFlightStream({
      sessionId: focusedSessionId,
      reason: "流式 60s 看门狗",
    });
  } else {
    // No focused session — best-effort cleanup of the orphan streaming
    // flag so the next begin-stream call doesn't think we're still busy.
    useSessionStore.getState().setStreaming(false);
  }
};
useSessionStore.subscribe((state) => {
  const now = Date.now();
  const streaming = state.streaming;
  if (streaming !== lastStreaming) {
    lastStreamChange = now;
    lastStreaming = streaming;
    if (streaming) {
      // Schedule the watchdog once. If anything else flips streaming (even
      // mid-timeout), the subscribe re-runs and resets.
      if (watchdogTimer) clearTimeout(watchdogTimer);
      watchdogTimer = setTimeout(fireWatchdog, STREAM_WATCHDOG_MS);
    } else if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
    return;
  }
  // streaming unchanged: if true, refresh the timer on every state change
  // so legitimate deltas reset the watchdog without needing the periodic
  // tick. If false, no-op.
  if (streaming && now - lastStreamChange >= STREAM_WATCHDOG_MS) {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    watchdogTimer = null;
    fireWatchdog();
    return;
  }
  if (streaming) {
    lastStreamChange = now;
    if (watchdogTimer) clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(fireWatchdog, STREAM_WATCHDOG_MS);
  }
});
