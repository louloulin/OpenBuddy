// vitest 全局 setup:为每个测试注册 jest-dom matchers 与 DOM cleanup。
// testing-library v16 在检测到 vitest afterEach 时会自动 cleanup,
// 但显式导入确保跨版本一致。
import "@testing-library/jest-dom/vitest";
import { beforeAll } from "vitest";

// jsdom 没有 matchMedia。窄屏 / 减少动效的媒体查询在测试里一律“不匹配”。
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

// The app installs its Markdown host (copy, open, files, dialogs) in app/main.tsx; renderer tests
// get the same one. It is imported here, after the test file has registered its vi.mock(...)s,
// so mocked ipc / agent-client / clipboard modules still receive the calls (a static import in
// this file would bind the real modules first).
beforeAll(async () => {
  if (typeof window === "undefined") return;
  const [{ setMarkdownHost }, { webMarkdownHost }] = await Promise.all([
    import("@openbuddy/markdown/host"),
    import("@/shared/markdown-host"),
  ]);
  setMarkdownHost(webMarkdownHost);
});
