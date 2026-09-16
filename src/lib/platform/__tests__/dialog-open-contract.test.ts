/**
 * 原生选择框返回值契约 —— `openPaths()` / `openOne()` 的归一化 + 全仓守卫。
 *
 * 为什么值得单独立一条 spec:
 *   `dialog:open` 的 main 侧实现是 `return result.filePaths`,也就是**永远**返回
 *   数组;但 renderer 侧类型从前写的是 `string | string[] | null`。于是仓库里长出
 *   了两种写法,其中"看起来更安全"的那种:
 *
 *     const selected = await openDialog({ multiple: false });
 *     if (!selected || Array.isArray(selected)) return;   // ← 永远 return
 *
 *   在「打开文件夹(切工作区)」「添加本地知识源」「选云存储目录」「导入技能文件」
 *   「安装 profile package」「切专家/连接器/技能数据目录」这些流程里,它意味着
 *   **点下去什么都不发生,也没有任何报错**。单看调用点完全合理,只有把
 *   main 的返回值读一遍才会发现。
 *
 * 所以这里做两件事:
 *   1. 把归一化的行为钉死(数组透传 / 单值包装 / 取消 → 空 / 空串过滤);
 *   2. 全仓守卫:任何文件都不许再 `import { open as ... }`(语义含糊的旧入口),
 *      也不许绕过包装直接调 `window.api.dialog.open`。
 */
// @vitest-environment jsdom
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type Bridge = {
  apiVersion: 1;
  invoke: (c: string, a?: unknown) => Promise<unknown>;
  rpc: { request: (m: unknown) => Promise<unknown>; onMessage: (h: (m: unknown) => void) => () => void };
  events: { on: (c: string, h: (p: unknown) => void) => () => void };
  dialog: { open: (o?: unknown) => Promise<unknown>; save: (o?: unknown) => Promise<string | null> };
  window: {
    label: () => string;
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    onResized: (h: () => void | Promise<void>) => Promise<() => void>;
  };
  webview: { label: () => string; onDragDropEvent: (h: (e: { payload: unknown }) => void) => Promise<() => void> };
  debug: { enabled: boolean };
  clipboard: { readText: () => Promise<string>; writeText: (t: string) => Promise<void> };
};

let dialogResult: unknown = null;

const BASE: Bridge = {
  apiVersion: 1,
  invoke: async () => undefined,
  rpc: { request: async () => undefined, onMessage: () => () => void 0 },
  events: { on: () => () => void 0 },
  dialog: {
    open: async () => dialogResult,
    save: async () => null,
  },
  window: {
    label: () => "main",
    minimize: async () => void 0,
    toggleMaximize: async () => void 0,
    close: async () => void 0,
    isMaximized: async () => false,
    onResized: async () => () => void 0,
  },
  webview: { label: () => "", onDragDropEvent: async () => () => void 0 },
  debug: { enabled: false },
  clipboard: { readText: async () => "", writeText: async () => void 0 },
};

let savedWindow: unknown;
beforeEach(() => {
  savedWindow = (globalThis as unknown as { window?: unknown }).window;
  (globalThis as unknown as { window: { api: unknown } }).window = { api: BASE };
});
afterEach(() => {
  (globalThis as unknown as { window?: unknown }).window = savedWindow;
});

describe("openPaths()/openOne():返回值只有一种形状", () => {
  it("main 返回数组(真实形状)→ 原样透传", async () => {
    dialogResult = ["/a", "/b"];
    const { openPaths, openOne } = await import("../electron-api");
    await expect(openPaths()).resolves.toEqual(["/a", "/b"]);
    await expect(openOne()).resolves.toBe("/a");
  });

  it("main 返回单个字符串(老 preload)→ 包装成数组", async () => {
    dialogResult = "/only";
    const { openPaths } = await import("../electron-api");
    await expect(openPaths()).resolves.toEqual(["/only"]);
  });

  it("取消(null / undefined)→ 空数组与 null,而不是让调用点猜", async () => {
    const { openPaths, openOne } = await import("../electron-api");
    dialogResult = null;
    await expect(openPaths()).resolves.toEqual([]);
    await expect(openOne()).resolves.toBeNull();
    dialogResult = undefined;
    await expect(openPaths()).resolves.toEqual([]);
  });

  it("过滤空串/非字符串,不让 '选中了空路径' 混进调用点", async () => {
    dialogResult = ["", "/ok", 42, null];
    const { openPaths, openOne } = await import("../electron-api");
    await expect(openPaths()).resolves.toEqual(["/ok"]);
    await expect(openOne()).resolves.toBe("/ok");
  });

  it("桥不可用时抛 ElectronBridgeUnavailable(而不是静默返回空)", async () => {
    (globalThis as unknown as { window: unknown }).window = {};
    const { openPaths } = await import("../electron-api");
    await expect(openPaths()).rejects.toThrow();
  });
});

// ─── 全仓守卫:旧入口不许再被 import,也不许绕过包装直连 bridge ───────────────

const ROOTS = ["src", "packages/ui"];
const SKIP_DIRS = new Set(["node_modules", "__tests__", "dist", "out", ".turbo"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const sourceFiles = ROOTS.flatMap((root) => walk(root));

describe("对话框入口的全仓守卫", () => {
  it("扫描面不为空(守卫本身有意义)", () => {
    expect(sourceFiles.length).toBeGreaterThan(200);
  });

  it("没有任何文件还在 import 语义含糊的 `open as ...` 旧入口", () => {
    const offenders = sourceFiles.filter((file) =>
      /import\s*\{[^}]*\bopen\s+as\s+\w+[^}]*\}\s*from\s*"@\/lib\/platform\/electron-api"/.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("没有调用点绕过包装直连 `window.api.dialog.open`(唯一实现处除外)", () => {
    const offenders = sourceFiles.filter(
      (file) =>
        !file.endsWith(join("src", "lib", "platform", "electron-api.ts")) &&
        /\.dialog\.open\s*\(/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("旧入口在 electron-api 里仍保留(deprecated,不破坏第三方插件)", async () => {
    const source = readFileSync(join("src", "lib", "platform", "electron-api.ts"), "utf8");
    expect(source).toMatch(/@deprecated/);
  });
});
