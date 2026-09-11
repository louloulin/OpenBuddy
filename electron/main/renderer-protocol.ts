/**
 * renderer-protocol.ts — 生产环境渲染器加载协议 (R39 修复).
 *
 * 问题 (修复前):
 *   `main-window.ts` 生产路径用 `win.loadFile(out/renderer/index.html)`.
 *   electron-vite 产出的 renderer 是 **ESM** (`<script type="module">`),
 *   而 Chromium 禁止从 `file://` 加载 ES module —— 文档 origin 是 opaque,
 *   模块请求被 CORS 拦下,报 `Failed to fetch dynamically imported module`
 *   (控制台表现为若干 `net::ERR_FAILED`). 结果: 打包后的应用启动即白屏,
 *   而 dev 模式 (`ELECTRON_RENDERER_URL` → vite dev server) 正常,
 *   所以这个问题只在生产路径暴露.
 *
 *   `--allow-file-access-from-files` 不能修: 实测仍白屏 —— 该开关放宽的是
 *   XHR/fetch 的 file 访问,不改变 module script 的 origin 判定.
 *
 * 修复:
 *   注册自定义 privileged scheme `openbuddy://`, 用 `protocol.handle`
 *   把 `out/renderer/**` 映射到一个真正的 http-like origin:
 *       openbuddy://renderer/index.html
 *       openbuddy://renderer/assets/<chunk>.js
 *   渲染器因此拿到 `standard + secure` 的 origin,ESM 正常加载,且
 *   `webSecurity` 保持默认开启 (不降级安全策略).
 *
 * 顺序约束 (Electron 要求):
 *   `registerSchemesAsPrivileged` 必须在 app ready **之前** 调用
 *   (index.ts 模块初始化期); `protocol.handle` 必须在 ready **之后**
 *   调用 (createMainWindow 内).
 */
import { protocol } from "electron";
import { readFileSync } from "node:fs";
import { existsSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";

/** Minimal extension → MIME map for the renderer bundle. */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/** Custom scheme serving the production renderer bundle. */
export const RENDERER_SCHEME = "openbuddy";
/** Host segment — keeps the origin `openbuddy://renderer`. */
export const RENDERER_HOST = "renderer";
/** Origin the production window navigates to. */
export const RENDERER_ORIGIN = `${RENDERER_SCHEME}://${RENDERER_HOST}`;
/** Entry document inside the renderer bundle. */
export const RENDERER_ENTRY_URL = `${RENDERER_ORIGIN}/index.html`;

/**
 * Declare the renderer scheme as privileged. MUST run before `app.whenReady()`
 * resolves — Electron ignores late registrations.
 *
 *   - `standard`        → URL parsing gives a real origin (needed for ESM/CORS)
 *   - `secure`          → treated as a trustworthy origin (crypto, service workers)
 *   - `supportFetchAPI` → renderer `fetch()` against bundled assets works
 *   - `stream`          → large chunks (mermaid/katex) stream instead of buffering
 *   - `corsEnabled`     → module scripts may be requested cross-`openbuddy://`
 */
export function registerRendererScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: RENDERER_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ]);
}

/**
 * Serve `rendererDir` over `openbuddy://renderer/**`.
 *
 * Path traversal is rejected (the resolved target must stay inside
 * `rendererDir`); unknown paths fall back to `index.html` so a future
 * client-side route reload does not 404 the whole window.
 */
let installed = false;

export function installRendererProtocol(rendererDir: string): void {
  // `protocol.handle` throws if a scheme is registered twice, and macOS
  // `activate` can rebuild the window after all windows closed — so keep
  // this idempotent.
  if (installed) return;
  installed = true;

  const root = normalize(rendererDir);

  protocol.handle(RENDERER_SCHEME, (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (url.host !== RENDERER_HOST) {
      return new Response("Not found", { status: 404 });
    }

    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const target = normalize(join(root, relative || "index.html"));
    if (target !== root && !target.startsWith(root + sep)) {
      return new Response("Forbidden", { status: 403 });
    }

    const file = existsSync(target) && statSync(target).isFile()
      ? target
      : join(root, "index.html");

    // Read the bytes ourselves rather than `net.fetch(file://...)`: Electron's
    // `net.fetch` does not serve `file:` URLs for a custom handler and answers
    // ERR_UNEXPECTED, which silently blanks the window.
    try {
      const body = readFileSync(file);
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
          "content-length": String(body.byteLength),
        },
      });
    } catch (error) {
      return new Response(`Failed to read ${url.pathname}: ${String(error)}`, { status: 500 });
    }
  });
}
