/**
 * R32 真机探针:Pi 扩展市场多源索引 + UI 端到端(走真实用户路径)。
 *
 * 为什么这条探针值得留:多源 registry 的单元测试全部注入 `fetchJson`,证明的是
 * 「函数写得对」。这条探针证明的是**产品真的这么跑**:宿主从
 * `<dataDir>/pi-extensions/sources.json` 读源 → 两个真 HTTP 源 + 一个死源 →
 * 权重合并 → UI 顶部来源 chips → 点安装 → lockfile 落盘。
 *
 * 断言覆盖:
 *   1. 「市场」面板顶部真的出现 Pi 扩展区块(而不是只存在于单测里);
 *   2. 权重大的源赢:同一 id 的字段来自 official,不来自 mirror;
 *   3. 低权重源独有的 id 照常收录(镜像能补官方没有的插件);
 *   4. 拉取不到的源在 UI 上被点名(「不可达」),而不是静默消失;
 *   5. 从卡片点安装 → 对话框 → 确认 → lockfile 里真的有这个扩展。
 *
 * 截图默认不写盘(探针会重排像素);需要视觉资产时:
 *   OPENBUDDY_PROBE_SHOTS=1 node scripts/electron/_probe-r32-pi-market-ui.mjs
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SHOTS_ENABLED = process.env.OPENBUDDY_PROBE_SHOTS === "1";
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const manifest = (id, version) =>
  JSON.stringify(
    {
      schema: "openbuddy.plugin.v1",
      id,
      version,
      surface: "pi",
      provides: [{ type: "tool", name: `${id}-hello`, description: "演示工具" }],
    },
    null,
    2,
  );

function extension(id, extra = {}) {
  return {
    id,
    name: `${id} 演示扩展`,
    publisher: "unknown",
    description: `${id} 来自索引`,
    version: "1.1.0",
    versions: ["1.0.0", "1.1.0"],
    kinds: ["extension"],
    capabilities: [{ id: `tools.${id}`, risk: "low" }],
    files: {
      "openbuddy.plugin.json": manifest(id, "1.1.0"),
      "README.md": `# ${id}\n`,
    },
    ...extra,
  };
}

// ── 两个真源 + 一个死源 ──
const officialEntries = [
  extension("demo.alpha", { publisher: "official-publisher" }),
  extension("demo.shared", { publisher: "official-publisher" }),
];
const mirrorEntries = [
  // 同一个 id:权重低的源不该覆盖 official 的字段。
  extension("demo.shared", { publisher: "mirror-publisher" }),
  // 低权重源独有:照常收录。
  extension("demo.mirror-only", { publisher: "mirror-publisher" }),
];

const server = createServer((req, res) => {
  const body = req.url?.includes("mirror") ? mirrorEntries : officialEntries;
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ version: 1, extensions: body }));
});
await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
const port = server.address().port;

const userData = mkdtempSync(join(tmpdir(), "ob-r32-market-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r32-agent-"));
mkdirSync(join(userData, "pi-extensions"), { recursive: true });
writeFileSync(
  join(userData, "pi-extensions", "sources.json"),
  JSON.stringify(
    {
      sources: [
        { id: "official", url: `http://127.0.0.1:${port}/official.json`, label: "官方", weight: 10 },
        { id: "mirror", url: `http://127.0.0.1:${port}/mirror.json`, label: "镜像", weight: 0 },
        // 1 号端口不会有人监听:连接立刻被拒,用来验证「点名不可达的源」。
        { id: "dead", url: "http://127.0.0.1:1/index.json", label: "内网", timeoutMs: 1500 },
      ],
    },
    null,
    2,
  ),
);

const report = { steps: [], ok: false, pageErrors: [] };

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root,
  timeout: 60000,
  env: {
    ...process.env,
    ELECTRON_RENDERER_URL: "",
    OPENBUDDY_DEBUG_UI: "0",
    OPENBUDDY_AGENT_DIR: agentDir,
  },
});

try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => report.pageErrors.push(String(error?.message ?? error)));
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, {
    timeout: 40000,
  });
  await page.waitForTimeout(2500);
  await page
    .click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 2000 })
    .catch(() => {});
  await page.waitForTimeout(400);

  // ── 1. 走用户路径进市场:侧栏 → 专家·技能·连接器 → 插件·市场 ──
  await page.evaluate(() => {
    const hit = Array.from(document.querySelectorAll("button, a")).find((el) =>
      (el.textContent ?? "").includes("专家·技能·连接器"),
    );
    if (hit instanceof HTMLElement) hit.click();
  });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const tab = Array.from(document.querySelectorAll('.um-pills [role="tab"]')).find((el) =>
      (el.textContent ?? "").includes("插件"),
    );
    if (tab instanceof HTMLElement) tab.click();
  });
  await page.waitForTimeout(6000);

  const section = await page.evaluate(() => {
    const host = document.querySelector("[data-testid='pi-extensions-section']");
    if (!host) return { mounted: false };
    const text = (host.textContent ?? "").replace(/\s+/g, " ").trim();
    return {
      mounted: true,
      stat: host.querySelector(".pi-ext__stat")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
      chips: Array.from(host.querySelectorAll(".pi-ext__source-chip")).map((chip) =>
        (chip.textContent ?? "").replace(/\s+/g, " ").trim(),
      ),
      cards: host.querySelectorAll("[data-testid='marketplace-card']").length,
      cardText: Array.from(host.querySelectorAll("[data-testid='marketplace-card']"))
        .map((card) => (card.textContent ?? "").replace(/\s+/g, " ").trim())
        .slice(0, 6),
      empty: Boolean(host.querySelector("[data-testid='pi-ext-empty']")),
    };
  });
  report.section = section;
  report.steps.push({
    step: "市场面板顶部真的渲染了 Pi 扩展区块",
    ok: Boolean(section.mounted),
    detail: JSON.stringify(section).slice(0, 600),
  });
  report.steps.push({
    step: "条目渲染成市场卡片(不是空态)",
    ok: Boolean(section.mounted && section.cards >= 1 && !section.empty),
    detail: `cards=${section.cards}`,
  });

  // ── 2. 权重合并的可见证据 ──
  const merged = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("[data-testid='marketplace-card']"));
    const find = (id) => cards.find((card) => (card.textContent ?? "").includes(id));
    return {
      officialWins:
        (find("demo.shared")?.textContent ?? "").includes("official-publisher") &&
        !(find("demo.shared")?.textContent ?? "").includes("mirror-publisher"),
      mirrorOnlyKept: Boolean(find("demo.mirror-only")),
      ids: cards.map((card) => card.textContent?.slice(0, 24)),
    };
  });
  report.merged = merged;
  report.steps.push({
    step: "同 id 只有权重大的源赢(字段不做合并)",
    ok: merged.officialWins,
    detail: JSON.stringify(merged),
  });
  report.steps.push({
    step: "低权重源独有的扩展照样收录",
    ok: merged.mirrorOnlyKept,
  });

  // ── 3. 刷新:每源状态 + 点名不可达的源 ──
  await page.evaluate(() => {
    document.querySelector("[data-testid='pi-ext-refresh']")?.click();
  });
  await page.waitForTimeout(5000);
  const afterRefresh = await page.evaluate(() => {
    const host = document.querySelector("[data-testid='pi-extensions-section']");
    return {
      chips: Array.from(host?.querySelectorAll(".pi-ext__source-chip") ?? []).map((chip) =>
        (chip.textContent ?? "").replace(/\s+/g, " ").trim(),
      ),
      warning: host?.querySelector(".pi-ext__warning")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
    };
  });
  report.afterRefresh = afterRefresh;
  report.steps.push({
    step: "刷新后顶部来源 chips 带每源权威状态",
    ok:
      afterRefresh.chips.some((chip) => chip.includes("官方") && chip.includes("已拉取")) &&
      afterRefresh.chips.some((chip) => chip.includes("镜像")),
    detail: JSON.stringify(afterRefresh.chips),
  });
  report.steps.push({
    step: "拉不到的源被点名(不可达),而不是静默消失",
    ok:
      afterRefresh.chips.some((chip) => chip.includes("不可达")) ||
      Boolean(afterRefresh.warning?.includes("没有缓存")),
    detail: JSON.stringify(afterRefresh),
  });

  // ── 4. 从卡片走完安装 ──
  const clickedInstall = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("[data-testid='marketplace-card']"));
    const card = cards.find((item) => (item.textContent ?? "").includes("demo.alpha"));
    const button = card?.querySelector("[data-testid='marketplace-card-primary']");
    if (button instanceof HTMLElement) {
      button.click();
      return true;
    }
    return false;
  });
  await page.waitForTimeout(600);
  const dialogOpen = await page.evaluate(() =>
    Boolean(document.querySelector("[data-testid='install-dialog']")),
  );
  await page.evaluate(() => {
    document.querySelector("[data-testid='install-dialog-confirm']")?.click();
  });
  await page.waitForTimeout(4000);

  const installed = await page.evaluate(async () => {
    const lock = await window.api
      .invoke("agent:pi-market-lockfile")
      .catch((error) => ({ error: String(error?.message ?? error) }));
    const host = document.querySelector("[data-testid='pi-extensions-section']");
    return {
      lockKeys: lock?.extensions ? Object.keys(lock.extensions) : null,
      lockError: lock?.error ?? null,
      version: lock?.extensions?.["demo.alpha"]?.version ?? null,
      dialogStillOpen: Boolean(document.querySelector("[data-testid='install-dialog']")),
      stat: host?.querySelector(".pi-ext__stat")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
    };
  });
  report.install = installed;
  report.steps.push({
    step: "点安装 → 对话框 → 确认",
    ok: clickedInstall && dialogOpen,
    detail: JSON.stringify({ clickedInstall, dialogOpen }),
  });
  report.steps.push({
    step: "扩展真的落到 lockfile(版本 + 路径)",
    ok: installed.version === "1.1.0",
    detail: JSON.stringify(installed),
  });
  report.steps.push({
    step: "安装后对话框自动关闭 + 统计行刷新",
    ok: !installed.dialogStillOpen && (installed.stat ?? "").includes("已装 1"),
    detail: String(installed.stat),
  });

  if (SHOTS_ENABLED) {
    await page.screenshot({ path: "tests/screenshots/r32-pi-market-ui.png" });
  }

  report.ok = report.steps.every((step) => step.ok) && report.pageErrors.length === 0;
} catch (error) {
  report.error = String(error?.stack ?? error);
} finally {
  await app.close().catch(() => {});
  server.close();
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
