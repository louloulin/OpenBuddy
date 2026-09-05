// vitest 全局 setup:为每个测试注册 jest-dom matchers 与 DOM cleanup。
// testing-library v16 在检测到 vitest afterEach 时会自动 cleanup,
// 但显式导入确保跨版本一致。
import "@testing-library/jest-dom/vitest";

// Eagerly hydrate the markdown runtime so sync rendering tests (e.g.
// FilePreview markdown) don't fall back to the <pre> placeholder while the
// lazy chunk is still being fetched.
const { preloadMarkdownRuntime } = await import("@openbuddy/ui-markdown/components");
await preloadMarkdownRuntime();
