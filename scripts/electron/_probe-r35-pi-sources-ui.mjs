/**
 * R35 真机探针:Pi 扩展的**源管理**(增删改 / 探活 / 保存即时生效)走真实用户路径。
 *
 * 为什么值得留:在 R35 之前 `sources.json` 只能手写,而且**写完必须重启** ——
 * 源清单在 `createPiMarketBridge()` 构造时定死。这两件事是同一个门槛:配置一个
 * 内网镜像源 = 读文档 + 找数据目录 + 编辑 JSON + 重启。对一个把扩展市场当成
 * 核心差异化的产品,这是最不该有的门槛。
 *
 * 这条探针证明的是"门槛真的没了":
 *   1. 面板里点「源管理」→ 读到的是 `<dataDir>/pi-extensions/sources.json`;
 *   2. 「测试」按钮真的打到 URL 上(不保存、不落盘);
 *   3. 加源 → 保存 → 磁盘上真的出现了 sources.json;
 *   4. 不重启,点「刷新索引」就按新源拉到条目;
 *   5. 再加一个**冲突 id + 独有 id** 的源,权重大的赢、独有 id 照常收录;
 *   6. 改权重(不重启)→ 赢家翻转 —— 这是"改完立刻生效"最直接的证据;
 *   7. 删源 → 保存 → 刷新 → 它的条目消失;
 *   8. 页内 reload 之后配置仍在(持久化);
 *   9. 坏输入就地报错且保存按钮点不动(不会写出半坏的配置)。
 *
 * 截图默认不写盘(探针会重排像素);需要视觉资产时:
 *   OPENBUDDY_PROBE_SHOTS=1 node scripts/electron/_probe-r35-pi-sources-ui.mjs
 */
import { _electron as electron } from "playwright";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SHOTS_ENABLED = process.env.OPENBUDDY_PROBE_SHOTS === "1";
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const manifest = (id) =>
  JSON.stringify({
    schema: "openbuddy.plugin.v1",
    id,
    version: "1.0.0",
    surface: "pi",
    provides: [{ type: "tool", name: `${id}-hello`, description: "演示工具" }],
  });

function extension(id, publisher) {
  return {
    id,
    name: `${id} 演示扩展`,
    publisher,
    description: `${id} 来自索引`,
    version: "1.0.0",
    versions: ["1.0.0"],
    kinds: ["extension"],
    capabilities: [{ id: `tools.${id}`, risk: "low" }],
    files: { "openbuddy.plugin.json": manifest(id), "README.md": `# ${id}\n` },
  };
}

const primaryEntries = [
  extension("demo.primary", "primary-publisher"),
  extension("demo.shared", "primary-publisher"),
];
const mirrorEntries = [
  // 同 id:权重低的一方不该赢。
  extension("demo.shared", "mirror-publisher"),
  // 低权重源独有:照常收录(镜像补齐)。
  extension("demo.mirror-only", "mirror-publisher"),
];

const server = createServer((req, res) => {
  const body = req.url?.includes("mirror") ? mirrorEntries : primaryEntries;
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ version: 1, extensions: body }));
});
await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
const port = server.address().port;
const primaryUrl = `http://127.0.0.1:${port}/primary.json`;
const mirrorUrl = `http://127.0.0.1:${port}/mirror.json`;

const userData = mkdtempSync(join(tmpdir(), "ob-r35-sources-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r35-agent-"));
const sourcesFile = join(userData, "pi-extensions", "sources.json");
// macOS 上 /var 是 /private/var 的符号链接,main 侧 resolve 过路径 —— 探针这边
// 也要过 realpath 才能比得上(`pi-extensions/` 目录此时可能还不存在,所以
// realpath 的是数据目录,而不是文件本身)。
const expectedSourcesPath = join(realpathSync(userData), "pi-extensions", "sources.json");

const report = { steps: [], ok: false, pageErrors: [] };
const step = (name, ok, detail) => report.steps.push({ step: name, ok: Boolean(ok), detail });

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

/** 进「市场 → 插件」;R32 探针走过的同一条路。 */
async function openMarket(page) {
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
  await page.waitForTimeout(4000);
}

const rowTexts = (page) =>
  page.$$eval("[data-testid='pi-ext-source-row']", (rows) =>
    rows.map((row) => (row.textContent ?? "").replace(/\s+/g, " ").trim()),
  );

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
  await openMarket(page);

  // ── 1. 初始:没有源 → 本地优先空态 + 源管理入口 ──
  const initial = await page.evaluate(() => ({
    section: Boolean(document.querySelector("[data-testid='pi-extensions-section']")),
    empty: Boolean(document.querySelector("[data-testid='pi-ext-empty']")),
    toggle: Boolean(document.querySelector("[data-testid='pi-ext-sources-toggle']")),
    editor: Boolean(document.querySelector("[data-testid='pi-ext-sources-editor']")),
  }));
  step("Pi 扩展区块渲染出来,且源管理默认收起", initial.section && initial.toggle && !initial.editor, JSON.stringify(initial));
  step("没有源时给的是本地优先空态(不是一个空列表)", initial.empty, JSON.stringify(initial));

  // ── 2. 打开源管理:路径 = <dataDir>/pi-extensions/sources.json ──
  await page.click("[data-testid='pi-ext-sources-toggle']");
  await page.waitForTimeout(1500);
  const opened = await page.evaluate(() => ({
    editor: Boolean(document.querySelector("[data-testid='pi-ext-sources-editor']")),
    path: document.querySelector("[data-testid='pi-ext-sources-path']")?.textContent ?? null,
    rows: document.querySelectorAll("[data-testid='pi-ext-source-row']").length,
  }));
  report.opened = opened;
  step(
    "点「源管理」展开编辑器并显示配置文件路径",
    opened.editor && opened.path === expectedSourcesPath,
    JSON.stringify(opened),
  );
  step("还没有保存过 → 一行都没有", opened.rows === 0, `rows=${opened.rows}`);

  // ── 3. 添加主源 + 「测试」探活(不保存、不落盘) ──
  await page.click("[data-testid='pi-ext-source-add']");
  await page.waitForTimeout(300);
  const urlInput = page.locator("[data-testid='pi-ext-source-url']").first();
  await urlInput.fill(primaryUrl);
  await page.locator("[data-testid='pi-ext-source-label']").first().fill("主源");
  await page.locator("[data-testid='pi-ext-source-weight']").first().fill("10");
  await page.waitForTimeout(200);
  await page.click("[data-testid='pi-ext-source-probe']");
  await page.waitForTimeout(2500);
  const probed = await page.evaluate(() => ({
    result: document.querySelector("[data-testid='pi-ext-source-probe-result']")?.textContent ?? null,
    fileExists: null,
  }));
  probed.fileExists = existsSync(sourcesFile);
  report.probed = probed;
  step("「测试」真的打到了 URL(报出条数与样例条目)", Boolean(probed.result?.includes("可达:2 条")), String(probed.result));
  step("测试不会落盘(sources.json 还不存在)", !probed.fileExists, `fileExists=${probed.fileExists}`);

  // ── 4. 保存并生效 ──
  await page.click("[data-testid='pi-ext-sources-save']");
  await page.waitForTimeout(2500);
  const saved = {
    onDisk: existsSync(sourcesFile) ? JSON.parse(readFileSync(sourcesFile, "utf8")) : null,
    buttonLabel: await page.textContent("[data-testid='pi-ext-sources-save']"),
  };
  report.saved = saved;
  step(
    "点「保存并生效」把源真的写进 sources.json",
    saved.onDisk?.sources?.length === 1 && saved.onDisk.sources[0].url === primaryUrl,
    JSON.stringify(saved.onDisk).slice(0, 300),
  );
  step("保存后按钮回到「已保存」(不再可点)", (saved.buttonLabel ?? "").includes("已保存"), String(saved.buttonLabel));

  // ── 5. 不重启 → 点刷新索引 → 真的按新源拉到条目 ──
  await page.click("[data-testid='pi-ext-refresh']");
  await page.waitForTimeout(6000);
  const afterRefresh = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("[data-testid='marketplace-card']"));
    return {
      cards: cards.length,
      ids: cards.map((card) => (card.textContent ?? "").slice(0, 24)),
      chips: Array.from(document.querySelectorAll(".pi-ext__source-chip")).map((chip) =>
        (chip.textContent ?? "").replace(/\s+/g, " ").trim(),
      ),
    };
  });
  report.afterRefresh = afterRefresh;
  step(
    "保存后**不重启**,刷新就按新源拉到条目",
    afterRefresh.cards >= 2 && afterRefresh.ids.some((id) => id.includes("demo.primary")),
    JSON.stringify(afterRefresh).slice(0, 400),
  );
  step(
    "顶部来源 chip 带上权威状态(已拉取 + 条数)",
    afterRefresh.chips.some((chip) => chip.includes("主源") && chip.includes("已拉取")),
    JSON.stringify(afterRefresh.chips),
  );

  // ── 6. 再加一个低权重镜像源:冲突 id 输、独有 id 收录 ──
  await page.click("[data-testid='pi-ext-source-add']");
  await page.waitForTimeout(300);
  await page.locator("[data-testid='pi-ext-source-url']").nth(1).fill(mirrorUrl);
  await page.locator("[data-testid='pi-ext-source-label']").nth(1).fill("镜像");
  await page.locator("[data-testid='pi-ext-source-weight']").nth(1).fill("0");
  await page.click("[data-testid='pi-ext-sources-save']");
  await page.waitForTimeout(2000);
  await page.click("[data-testid='pi-ext-refresh']");
  await page.waitForTimeout(6000);
  const twoSources = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("[data-testid='marketplace-card']"));
    const find = (id) => cards.find((card) => (card.textContent ?? "").includes(id));
    return {
      shared: (find("demo.shared")?.textContent ?? "").replace(/\s+/g, " ").slice(0, 120),
      mirrorOnly: Boolean(find("demo.mirror-only")),
      count: cards.length,
    };
  });
  report.twoSources = twoSources;
  const idsOnDisk = JSON.parse(readFileSync(sourcesFile, "utf8")).sources.map((item) => item.id);
  step(
    "同一个 host 上的两个源拿到不同的派生 id(否则第二个会被去重静默丢掉)",
    idsOnDisk.length === 2 && new Set(idsOnDisk).size === 2,
    JSON.stringify(idsOnDisk),
  );
  step(
    "同 id 只有权重大的源赢(字段不从镜像合并)",
    twoSources.shared.includes("primary-publisher") && !twoSources.shared.includes("mirror-publisher"),
    JSON.stringify(twoSources),
  );
  step("低权重源独有的扩展照常收录", twoSources.mirrorOnly, JSON.stringify(twoSources));

  // ── 7. 改权重(不重启)→ 赢家翻转 ──
  await page.locator("[data-testid='pi-ext-source-weight']").nth(1).fill("20");
  await page.click("[data-testid='pi-ext-sources-save']");
  await page.waitForTimeout(2000);
  await page.click("[data-testid='pi-ext-refresh']");
  await page.waitForTimeout(6000);
  const flipped = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("[data-testid='marketplace-card']"));
    const shared = cards.find((card) => (card.textContent ?? "").includes("demo.shared"));
    return (shared?.textContent ?? "").replace(/\s+/g, " ").slice(0, 120);
  });
  report.flipped = flipped;
  step(
    "把镜像权重调到 20(不重启)→ 赢家翻转成镜像",
    flipped.includes("mirror-publisher") && !flipped.includes("primary-publisher"),
    flipped,
  );

  // ── 8. 删源 → 保存 → 刷新 → 它的条目消失 ──
  await page.locator("[data-testid='pi-ext-source-remove']").first().click();
  await page.waitForTimeout(300);
  const removedRows = await rowTexts(page);
  await page.click("[data-testid='pi-ext-sources-save']");
  await page.waitForTimeout(2000);
  await page.click("[data-testid='pi-ext-refresh']");
  await page.waitForTimeout(6000);
  const afterRemove = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("[data-testid='marketplace-card']"));
    return {
      count: cards.length,
      hasPrimaryOnly: cards.some((card) => (card.textContent ?? "").includes("demo.primary")),
      hasMirrorOnly: cards.some((card) => (card.textContent ?? "").includes("demo.mirror-only")),
    };
  });
  const onDiskAfterRemove = JSON.parse(readFileSync(sourcesFile, "utf8"));
  report.afterRemove = { removedRows, afterRemove, onDiskAfterRemove };
  step(
    "删掉主源后 sources.json 里只剩一个源",
    onDiskAfterRemove.sources.length === 1 && onDiskAfterRemove.sources[0].url === mirrorUrl,
    JSON.stringify(onDiskAfterRemove).slice(0, 240),
  );
  step(
    "刷新后主源独有的条目消失,镜像的条目还在",
    !afterRemove.hasPrimaryOnly && afterRemove.hasMirrorOnly,
    JSON.stringify(afterRemove),
  );

  // ── 9. 坏输入就地报错,且保存按钮点不动 ──
  await page.locator("[data-testid='pi-ext-source-weight']").first().fill("abc");
  await page.waitForTimeout(400);
  const invalid = await page.evaluate(() => {
    const save = document.querySelector("[data-testid='pi-ext-sources-save']");
    return {
      rowError: document.querySelector("[data-testid='pi-ext-source-row-error']")?.textContent ?? null,
      saveDisabled: save instanceof HTMLButtonElement ? save.disabled : null,
      invalidRows: document.querySelectorAll("[data-testid='pi-ext-source-row'][data-invalid='true']").length,
    };
  });
  report.invalid = invalid;
  step(
    "坏权重就地报行号 + 标红该行",
    invalid.rowError === "权重必须是数字" && invalid.invalidRows === 1,
    JSON.stringify(invalid),
  );
  step("有未修正的错误时保存按钮点不动", invalid.saveDisabled === true, JSON.stringify(invalid));

  // 改回去,确认还能正常工作(错误是行的属性,不是整表的)
  await page.locator("[data-testid='pi-ext-source-weight']").first().fill("0");
  await page.waitForTimeout(400);
  const recovered = await page.evaluate(() => ({
    rowError: document.querySelector("[data-testid='pi-ext-source-row-error']")?.textContent ?? null,
    invalidRows: document.querySelectorAll("[data-testid='pi-ext-source-row'][data-invalid='true']").length,
  }));
  step("改回合法值后错误消失(错误是逐行的)", recovered.rowError === null && recovered.invalidRows === 0, JSON.stringify(recovered));

  // ── 10. 页内 reload:配置仍在(持久化 + 重新读盘) ──
  await page.reload();
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40000 });
  await page.waitForTimeout(3500);
  await page
    .click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 2000 })
    .catch(() => {});
  await openMarket(page);
  await page.click("[data-testid='pi-ext-sources-toggle']");
  await page.waitForTimeout(2000);
  // 注意读的是 input 的 **value**,不是 textContent —— 输入框里的字不进文本节点,
  // 用 textContent 断言会永远看不见 url/label,只能看到状态 chip。
  const afterReload = await page.evaluate(() => ({
    rows: Array.from(document.querySelectorAll("[data-testid='pi-ext-source-row']")).map((row) => ({
      url: row.querySelector("[data-testid='pi-ext-source-url']")?.value ?? null,
      label: row.querySelector("[data-testid='pi-ext-source-label']")?.value ?? null,
      weight: row.querySelector("[data-testid='pi-ext-source-weight']")?.value ?? null,
    })),
    path: document.querySelector("[data-testid='pi-ext-sources-path']")?.textContent ?? null,
  }));
  report.afterReload = afterReload;
  step(
    "reload 之后源配置还在(从 sources.json 读回来的)",
    afterReload.rows.length === 1 &&
      afterReload.rows[0].url === mirrorUrl &&
      afterReload.rows[0].label === "镜像" &&
      afterReload.rows[0].weight === "20",
    JSON.stringify(afterReload).slice(0, 300),
  );

  if (SHOTS_ENABLED) {
    await page.screenshot({ path: "tests/screenshots/r35-pi-sources-ui.png" });
  }

  report.ok = report.steps.every((item) => item.ok) && report.pageErrors.length === 0;
} catch (error) {
  report.error = String(error?.stack ?? error);
} finally {
  await app.close().catch(() => {});
  server.close();
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
