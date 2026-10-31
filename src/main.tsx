import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
// The modular theme package owns the shared semantic tokens. Import it before
// the app-level styles so any later OpenBuddy token can refine it deliberately.
import "@openbuddy/ui-theme/styles";
import { initializeThemeSync } from "@openbuddy/ui-theme/client";

// v2 — paint the document with the saved theme synchronously, before
// React mounts, so users never see a white flash on cold start. The
// ThemeInitializer inside <App /> re-applies once the store mounts to
// guarantee consistency with subsequent storage changes.
initializeThemeSync();
import { startRendererPluginEventBridge } from "./lib/runtime/renderer-plugin-runtime";
import { installPluginSdkBridge } from "@openbuddy/ui-runtime/client";
import { setToast } from "./stores/toast-store";
import { useSessionStore } from "./stores/session-store";
import { initTelemetry } from "./lib/email/telemetry-init";
// Phase 2 — modular CSS. globals.css transitively imports tokens / base /
// theme / chrome / per-domain 拆分文件。automation-wb.css 保留兜底兼容。
// R8.4 — 删除了原 app.css 单体（15633 行 / 477KB，从未 import 验证为死
// 代码）；其独有 shell selector 已迁到 src/styles/shell.css，R8.2 toolcall
// 样式已迁到 tool-call.css。
import "./styles/globals.css";

// Phase K.3 — 把 `@openbuddy/plugin-sdk` 的 `defineExtension()` 事件接进微内核。
// 在此之前 SDK 只派发 DOM 事件、没有监听者，第三方插件注册完等于没注册。
// 必须在插件的 setup() 运行前装好，因此放在 React 挂载之前。
installPluginSdkBridge();

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

// Telemetry 初始化 — fire-and-forget,DSN 为空时不阻塞启动。
void initTelemetry();

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

// 流式看门狗统一在 useAgentSession 内(任何 agent 事件续期、工具运行中不触发),
// 这里不再维护第二套阈值不同的看门狗。
