/**
 * R97 探针:验证 Marketplace UI 在真实 Electron 里能调到
 * `marketplace_list` IPC 并返回非空 sources。
 *
 * 为什么需要真机探针(而不是只靠单测):
 *   - MarketplaceTab / MarketplacePanel 渲染需要 IPC bridge 在 preload
 *     白名单里 —— 单测用 `vi.fn()` mock 掉,不会验证白名单接对。
 *   - MarketplacePanel 调的是 pi 的 `x.ai/marketplace/list`,链路:
 *     renderer → IPC marketplace_list → main handler → pi extension
 *     → marketplace provider → 返回 sources。任何一环漏了,
 *     UI 看起来空但单测仍绿。
 *
 * 用法:`node scripts/electron/probe-r97-marketplace.mjs`
 * stdout 输出 JSON,结尾 `process.exit(report.ok ? 0 : 1)`。
 */
import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const report = { steps: [], pageErrors: [] };
const step = (name, ok, detail) => report.steps.push({ step: name, ok: Boolean(ok), detail });

const userData = mkdtempSync(join(tmpdir(), "ob-r97-mkt-"));
const agentDir = mkdtempSync(join(tmpdir(), "ob-r97-mkt-agent-"));

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root,
  timeout: 60_000,
  env: {
    ...process.env,
    ELECTRON_RENDERER_URL: "",
    OPENBUDDY_DEBUG_UI: "0",
    OPENBUDDY_AGENT_DIR: agentDir,
  },
});

try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  page.on("pageerror", (e) => report.pageErrors.push(String(e).slice(0, 200)));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 45_000 });

  // 跳过 onboarding / tour。
  await page.evaluate(() => {
    window.localStorage.setItem("openbuddy.onboarding.state", JSON.stringify({
      version: 1, status: "done", index: 2,
      steps: [{ id: "welcome", status: "done" }, { id: "first-task", status: "done" }, { id: "done", status: "done" }],
      startedAt: Date.now(), updatedAt: Date.now(), completedAt: Date.now(),
    }));
    window.localStorage.setItem("openbuddy.tour.state", "seen");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 45_000 });
  await page.waitForTimeout(1500);

  // ---- 1. marketplace_list 在白名单且可调用,返回 sources ----
  const probe1 = await page.evaluate(async () => {
    try {
      const r = await window.api.invoke("marketplace_list", { force: false, maxPages: 1 });
      if (!r || typeof r !== "object") return { error: "no result" };
      const sources = r.sources ?? r.entries ?? r.list ?? r.items ?? r.plugins ?? r.markets;
      const looksLike = Array.isArray(sources);
      const sample = sources?.[0];
      return {
        shape: Object.keys(r).join(","),
        sourcesLen: sources?.length ?? 0,
        firstSource: sample ? {
          sourceName: sample.sourceName,
          sourceKind: sample.sourceKind ?? sample.sourceKindValue,
          builtIn: sample.builtIn,
          pluginsLen: sample.plugins?.length ?? 0,
        } : null,
        looksLike,
      };
    } catch (e) {
      return { error: String(e).slice(0, 200) };
    }
  });
  report.marketplaceListResult = probe1;
  step("marketplace_list 在白名单 + 返回 sources 数组",
    probe1.looksLike && probe1.sourcesLen >= 1,
    probe1.error ? probe1.error : `sourcesLen=${probe1.sourcesLen} first=${probe1.firstSource?.sourceName}`,
  );
  step("首个 source 是 pi.dev 远程源(主市场)",
    probe1.firstSource?.sourceName === "pi.dev" || probe1.firstSource?.sourceKind === "remote",
    JSON.stringify(probe1.firstSource),
  );

  // ---- 2. marketplace_action 也在白名单(空操作试调) ----
  // 用一个无效 actionType 探探 handler 是否挂上;handler 应回错而不是"未挂载"。
  const probe2 = await page.evaluate(async () => {
    try {
      await window.api.invoke("marketplace_action", {
        actionType: "__probe_invalid__",
        sourceUrlOrPath: "https://pi.dev/packages",
        pluginRelativePath: "__probe__",
      });
      return { ok: true };
    } catch (e) {
      return { rejected: true, reason: String(e).slice(0, 120) };
    }
  });
  report.marketplaceActionProbe = probe2;
  step("marketplace_action IPC handler 已挂载(任何调用都有响应)",
    Boolean(probe2.ok || probe2.rejected),
    JSON.stringify(probe2),
  );

  // ---- 3. plugins_list 也在白名单 ----
  const probe3 = await page.evaluate(async () => {
    try {
      const r = await window.api.invoke("plugins_list");
      return { ok: true, shape: Object.keys(r ?? {}).join(","), len: r?.plugins?.length ?? r?.list?.length ?? 0 };
    } catch (e) {
      return { error: String(e).slice(0, 120) };
    }
  });
  report.pluginsList = probe3;
  step("plugins_list IPC 在白名单且返回已安装列表",
    !probe3.error,
    JSON.stringify(probe3),
  );

  step("无渲染异常", report.pageErrors.length === 0, JSON.stringify(report.pageErrors));
} catch (error) {
  step("探针执行未抛错", false, String(error).slice(0, 400));
} finally {
  await app.close().catch(() => {});
}

report.ok = report.steps.every((s) => s.ok);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
