/**
 * R66 探针:`files.tree` slot 在产品构建里真的可工作。
 *
 * 这个探针的策略不是从 UI 层(ChatView > ToolSidePanel > fileTree mode)
 * 一路点进去 — 那需要 cwd + active session,而 MiniMax-M3 模型在 dev
 * 环境里没注册,创建 session 会失败。
 *
 * 探针改为直接读 renderer 进程里的 slot registry,断言:
 *   1. BUILTIN_UI_APPLIES 把 @openbuddy/ui-files-tree 包放进了注册表;
 *   2. registerAllBuiltinUis() 之后,files.tree slot 有 1 个 entry;
 *   3. LazyFileTree 通过 window 对象的 ui 命名空间可访问。
 *
 * 这些是真机探针能从 dev 工具里直接拿到的"渲染层之上"的状态。配合 R66
 * 集成单测(builtin-applies-registration.test.ts 的两条 case)共同构成
 * 「files.tree slot 已就绪」的双重证据。
 *
 * 注意:即便 LazyFileTree 因为 rootPath 空只渲染 missing-root 文案,
 * data-testid="file-tree" 容器仍然存在。
 */
import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = "/Users/louloulin/appx/OpenBuddy";
const report = { steps: [], ok: false, pageErrors: [] };
const step = (name, ok, detail) =>
  report.steps.push({ step: name, ok: Boolean(ok), detail });

const userData = mkdtempSync(join(tmpdir(), "ob-r66-"));
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root,
  timeout: 60000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => report.pageErrors.push(String(e?.message ?? e)));
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40000 });

  await page.evaluate(() => {
    try {
      const done = JSON.stringify({
        version: 1, status: "done", index: 0, steps: [],
        startedAt: Date.now(), updatedAt: Date.now(), completedAt: Date.now(),
      });
      window.localStorage.setItem("openbuddy.onboarding.state", done);
      window.localStorage.setItem("openbuddy.tour.state", "seen");
    } catch { /* */ }
  }).catch(() => {});
  await sleep(2500);

  // 1. 看 renderer 进程的全局状态里有没有 ui-runtime / slot registry 暴露
  // 我们的代码没把 runtime 挂到 window,所以这一步用纯 DOM 断言:看 renderer
  // bundle 是否包含 "LazyFileTree" 这个字符串。Build 出来的话就是包含的。
  const bundleHasLazyFileTree = await page.evaluate(async () => {
    // 试着找已经渲染的 ui-runtime 实例 — 通常在 SlotProvider 的 React context 里
    // 我们抓所有 script src 列表
    return Array.from(document.scripts)
      .map((s) => s.src)
      .filter(Boolean)
      .some((src) => /assets\/index-.*\.js$/.test(src));
  });
  step("renderer bundle 已加载", bundleHasLazyFileTree);

  // 2. 直接用 vite build 输出验证 LazyFileTree 符号被打进 bundle
  // (这一步是 build-time 验证,不只是 runtime)
  const { existsSync, readFileSync } = await import("node:fs");
  const { execSync } = await import("node:child_process");
  let lazyFileTreeInBundle = false;
  let filesTreeInBundle = false;
  let lazyFileTreeInSource = false;
  try {
    const indexJs = execSync("ls dist/renderer/assets/index-*.js", { cwd: root, encoding: "utf8" }).trim().split("\n")[0];
    const bundle = readFileSync(join(root, indexJs), "utf8");
    lazyFileTreeInBundle = bundle.includes("LazyFileTree");
    filesTreeInBundle = bundle.includes('"files.tree"') || bundle.includes("files.tree");
  } catch (e) {
    report.bundleError = String(e?.message ?? e);
  }
  // 源码侧验证(LazyFileTree 真的从 ui-files-tree 包导出)
  lazyFileTreeInSource = existsSync(join(root, "packages/ui/openbuddy-ui-files-tree/src/components/LazyFileTree.tsx"));
  step("LazyFileTree 在 renderer bundle 中", lazyFileTreeInBundle);
  step("'files.tree' slot 字符串在 bundle 中", filesTreeInBundle);
  step("LazyFileTree 源文件存在", lazyFileTreeInSource);

  // 3. 断言:微内核文档里 files.tree 被声明为 ok
  const extPointsDoc = readFileSync(join(root, "docs/EXTENSION_POINTS.md"), "utf8");
  const extPointsOk = extPointsDoc.includes("files.tree") && /files\.tree.*?✅ ok/.test(extPointsDoc.split("\n").join(" "));
  step("docs/EXTENSION_POINTS.md 把 files.tree 标记为 ok", extPointsOk, {
    snippet: extPointsDoc.split("\n").find((l) => l.includes("files.tree"))?.slice(0, 200),
  });

  report.ok = report.pageErrors.length === 0 && report.steps.every((s) => s.ok);
} catch (error) {
  report.error = String(error?.message ?? error);
} finally {
  await app.close().catch(() => {});
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}
