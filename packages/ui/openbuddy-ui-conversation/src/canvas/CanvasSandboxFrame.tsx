/**
 * CanvasSandboxFrame —— html / react / svg 的运行时承载。
 *
 * 为什么是 iframe + srcdoc 而不是本地 bundle:
 *   1. 画布内容是**模型或用户写的任意代码**,与宿主同进程跑等于把
 *      `window.openbuddy` / IPC preload 暴露给不可信代码;
 *   2. `sandbox` 不给 `allow-same-origin`,iframe 拿到的是**不透明源**,
 *      触碰 `parent.*` 直接抛 SecurityError —— 这是"沙箱不执行 parent.*"
 *      验收项的物理保证,不是靠约定;
 *   3. react 走 CDN importmap,不打进首包(bundle-topology 的 5MB 门禁)。
 *
 * 交互通道只留一条:预览态 iframe 内点击链接 → 宿主 `open_url` 走系统浏览器
 * (与 markdown-host.ts 的 `onLinkClick` 同一套处理,Electron 里 target=_blank
 * 不可靠)。
 */
import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { invoke } from "@/lib/platform/electron-api";
import { useT } from "@openbuddy/ui-locale/client";

export interface CanvasSandboxFrameProps {
  kind: "html" | "react" | "svg";
  content: string;
  /** iframe 不可用时的兜底(真机 Electron 里不会走到)。 */
  fallback?: ReactElement | null;
}

const IFRAME_SANDBOX = "allow-scripts allow-forms allow-modals allow-popups";

/** react 的 CDN importmap —— 首版不本地 bundle,换取首包体积。 */
const REACT_IMPORTMAP = {
  imports: {
    react: "https://esm.sh/react@18.3.1",
    "react-dom/client": "https://esm.sh/react-dom@18.3.1/client",
  },
};

/**
 * 源码以 base64 data 属性传给 iframe。
 * 直接内联进 `<script>` 或属性都不安全:实体在 raw-text 元素里不会被解码,
 * 拼 `<` 也会让标签提前闭合。base64 只含 `A-Za-z0-9+/=`,任何上下文都安全。
 */
function encodeSource(content: string): string {
  const bytes = new TextEncoder().encode(content);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function buildSrcdoc(
  kind: "html" | "react" | "svg",
  content: string,
  reactLoadFailed: string,
): string {
  if (kind === "svg") {
    return `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;background:transparent}
svg{max-width:100%;max-height:100%}</style></head>
<body>${content}</body></html>`;
  }
  if (kind === "html") {
    // 用户 HTML 原样内联(它就是要被解析成 DOM,不能转义)。用户在内容里写
    // `</body>` 会提前闭合外层文档 —— 这是"片段渲染"的固有边界,不是 bug。
    return `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:16px;font:14px/1.6 system-ui,sans-serif}</style></head>
<body>${content}</body></html>`;
  }
  const boot = `
const source = atob(document.body.dataset.canvasSource);
const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
const mount = document.getElementById("root");
const { createRoot } = await import("react-dom/client");
const React = await import("react");
try {
  const mod = await import(url);
  createRoot(mount).render(React.createElement(mod.default));
} catch (e) {
  mount.textContent = ${JSON.stringify(reactLoadFailed)} + String(e);
}`;
  return `<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">${JSON.stringify(REACT_IMPORTMAP)}</script>
<style>html,body{margin:0;height:100%;background:transparent}
#root{height:100%}</style></head>
<body data-canvas-source="${encodeSource(content)}"><div id="root"></div>
<script type="module">${boot}</script>
</body></html>`;
}

export function CanvasSandboxFrame({ kind, content }: CanvasSandboxFrameProps) {
  const previewTitle = useT("conversation.canvas.previewTitle");
  const reactLoadFailed = useT("conversation.canvas.reactLoadFailed");
  const srcdoc = useMemo(
    () => buildSrcdoc(kind, content, reactLoadFailed),
    [kind, content, reactLoadFailed],
  );
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  // 预览里的外链交给系统浏览器 —— 与 markdown 链接同一处理,避免在 iframe 内导航。
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    const onLoad = () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      doc.addEventListener("click", (event) => {
        const anchor = (event.target as HTMLElement | null)?.closest?.("a");
        const href = anchor?.getAttribute("href");
        if (!href) return;
        if (!/^https?:\/\//i.test(href)) return;
        event.preventDefault();
        void invoke("open_url", { url: href });
      });
    };
    frame.addEventListener("load", onLoad);
    return () => frame.removeEventListener("load", onLoad);
  }, [srcdoc]);

  return (
    <iframe
      ref={frameRef}
      className="canvas-panel__frame"
      title={previewTitle}
      data-testid="canvas-sandbox-frame"
      data-canvas-kind={kind}
      // 无 allow-same-origin → 不透明源,iframe 内代码拿不到 parent / IPC。
      sandbox={IFRAME_SANDBOX}
      referrerPolicy="no-referrer"
      srcDoc={srcdoc}
    />
  );
}

export default CanvasSandboxFrame;
