/**
 * R39 真机探针:三条"点下去什么都不发生"的路径,现在都真的发生。
 *
 * 要证的缺陷(代码级可复现):
 *   A. `dialog:open` 的 main 侧**永远**返回数组,而 renderer 类型写着
 *      `string | string[] | null`。于是「打开文件夹(切工作区)」「添加本地
 *      知识源」「选云存储目录」「导入技能文件」「安装 profile package」
 *      「切专家/连接器/技能数据目录」一律写成
 *        `if (!selected || Array.isArray(selected)) return;`
 *      —— 全部**永远提前返回**:点下去没有任何反应,也没有任何报错。
 *   B. 侧栏「更多」里「腾讯文档」「乐享知识库」只 `onToast("当前不可用")`:
 *      既不说要配什么,也走不到能配的地方。
 *   C. Pi 扩展的索引源只能手敲绝对路径 —— 内网 / 离线分发场景里索引就是一个
 *      文件,却没有"选文件"的入口。
 *
 * 这条探针只走用户路径,并用 **main 进程 dialog stub** 代替原生窗口(真机跑
 * 不了文件选择器):stub 返回什么,就等于用户选了什么。
 *
 * 截图默认不写盘;需要视觉资产时 OPENBUDDY_PROBE_SHOTS=1。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SHOTS_ENABLED = process.env.OPENBUDDY_PROBE_SHOTS === "1";
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const userData = mkdtempSync(join(tmpdir(), "ob-r39-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r39-agent-"));
const workspace = mkdtempSync(join(tmpdir(), "ob-r39-ws-"));
// 用户"选中"的目录与索引文件(真实存在 —— 后面要真的落盘 / 真的读)。
const pickedDir = mkdtempSync(join(tmpdir(), "ob-r39-picked-"));
const indexFile = join(pickedDir, "registry.json");
// macOS 的 /var 是指向 /private/var 的符号链接:主进程会把工作空间目录做
// realpath 归一化,所以断言必须比 realpath,否则比的是两个字符串形状。
const pickedReal = realpathSync(pickedDir);
writeFileSync(indexFile, JSON.stringify({ version: 1, extensions: [] }));

const report = { steps: [], ok: false, pageErrors: [] };
const step = (name, ok, detail) =>
  report.steps.push({ step: name, ok: Boolean(ok), detail });

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

/** 让下一次原生选择框"返回"给定的路径 —— 等价于用户手选。 */
const stubDialog = (filePaths) =>
  app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: paths.length === 0, filePaths: paths });
  }, filePaths);

const composerWorkspaceLabel = (page) =>
  page.evaluate(
    () => document.querySelector(".workspace-picker__label")?.textContent?.trim() ?? null,
  );

const clickByText = (page, selector, text) =>
  page.evaluate(
    ([sel, needle]) => {
      const hit = Array.from(document.querySelectorAll(sel)).find((el) =>
        (el.textContent ?? "").includes(needle),
      );
      if (!(hit instanceof HTMLElement)) return false;
      hit.click();
      return true;
    },
    [selector, text],
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

  const created = await page.evaluate(async (cwd) => {
    try {
      return await window.api.invoke("agent:new-session", { cwd });
    } catch (error) {
      return { error: String(error) };
    }
  }, workspace);
  const sessionId =
    created && typeof created === "object" && typeof created.sessionId === "string"
      ? created.sessionId
      : null;
  step("agent:new-session 真的建出会话", Boolean(sessionId), JSON.stringify(created).slice(0, 120));
  if (!sessionId) throw new Error("无法创建会话,后续步骤全部无意义");

  await page.evaluate(
    ([sid, cwd]) => {
      localStorage.setItem("openbuddy.active-session", JSON.stringify({ sessionId: sid, cwd }));
    },
    [sessionId, created.cwd ?? workspace],
  );
  await page.reload();
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, {
    timeout: 40000,
  });
  await page.waitForTimeout(3200);
  await page
    .click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 2000 })
    .catch(() => {});
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(600);

  // ── B1. 侧栏「更多」:两条企业入口有「需连接器」提示 ──
  await page.hover(".sidebar__more-wrap");
  await page.waitForTimeout(400);
  const hints = await page.evaluate(() => ({
    docs: document.querySelector("[data-testid='sidebar-more-hint-tencent_docs']")?.textContent?.trim() ?? null,
    lexiang: document.querySelector("[data-testid='sidebar-more-hint-lexiang_kb']")?.textContent?.trim() ?? null,
  }));
  step(
    "「腾讯文档」「乐享知识库」明确标注「需连接器」(不再是点不动的死入口)",
    hints.docs === "需连接器" && hints.lexiang === "需连接器",
    JSON.stringify(hints),
  );

  // ── B2. 点「腾讯文档」真的导航到连接器目录 ──
  const docsClicked = await clickByText(page, ".sidebar__more-item", "腾讯文档");
  await page.waitForTimeout(2600);
  const landed = await page.evaluate(() => ({
    pills: Boolean(document.querySelector(".um-pills [role='tab']")),
    hasConnectorTab: Array.from(document.querySelectorAll(".um-pills [role='tab']")).some((el) =>
      (el.textContent ?? "").includes("连接器"),
    ),
  }));
  step("点「腾讯文档」可点", docsClicked, JSON.stringify({ docsClicked }));
  step(
    "点「腾讯文档」落到「专家 · 技能 · 连接器」面板(能配的地方),而不是原地弹一句话",
    landed.pills && landed.hasConnectorTab,
    JSON.stringify(landed),
  );

  if (SHOTS_ENABLED) await page.screenshot({ path: "tests/screenshots/r39-connector-landing.png" });

  // ── C. Pi 源管理:导入 registry.json ──
  await clickByText(page, ".um-pills [role='tab']", "插件");
  await page.waitForTimeout(3500);
  await page.click("[data-testid='pi-ext-sources-toggle']");
  await page.waitForTimeout(1500);
  const importVisible = await page.evaluate(() =>
    Boolean(document.querySelector("[data-testid='pi-ext-source-import']")),
  );
  step("源管理里有「导入 registry.json」入口", importVisible, JSON.stringify({ importVisible }));

  await stubDialog([indexFile]);
  await page.click("[data-testid='pi-ext-source-import']");
  await page.waitForTimeout(1200);
  const afterImport = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("[data-testid='pi-ext-source-row']"));
    return {
      count: rows.length,
      lastUrl: (rows.at(-1)?.querySelector("[data-testid='pi-ext-source-url']")?.value ?? null),
      lastLabel: (rows.at(-1)?.querySelector("[data-testid='pi-ext-source-label']")?.value ?? null),
    };
  });
  step(
    "导入后新增一行,地址是选中的文件、名称取自文件名",
    afterImport.lastUrl === indexFile && afterImport.lastLabel === "registry",
    JSON.stringify(afterImport),
  );

  await page.click("[data-testid='pi-ext-sources-save']");
  await page.waitForTimeout(2000);
  const readBack = await page.evaluate(async () => {
    try {
      return await window.api.invoke("agent:pi-market-sources-get");
    } catch (error) {
      return { error: String(error) };
    }
  });
  step(
    "保存后主进程读回里真的多了这个 file 源(不是只改了界面)",
    Array.isArray(readBack?.file) && readBack.file.some((s) => s.url === indexFile),
    JSON.stringify(readBack).slice(0, 260),
  );

  // 再导一次同一个文件 → 查重,不新增行
  await stubDialog([indexFile]);
  await page.click("[data-testid='pi-ext-source-import']");
  await page.waitForTimeout(1200);
  const afterDuplicate = await page.evaluate(
    () => document.querySelectorAll("[data-testid='pi-ext-source-row']").length,
  );
  step(
    "重复导入同一个索引不会悄悄多出一行(查重生效)",
    afterDuplicate === afterImport.count,
    JSON.stringify({ before: afterImport.count, after: afterDuplicate }),
  );

  if (SHOTS_ENABLED) await page.screenshot({ path: "tests/screenshots/r39-pi-import-registry.png" });

  // ── A. 工作区选择器:选文件夹真的切过去(此前永远 return) ──
  // 先回到会话视图 —— 工作区选择器在聊天输入区,前面几步已经导航到别的面板。
  await page.reload();
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, {
    timeout: 40000,
  });
  await page.waitForTimeout(3200);
  await page
    .click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 2000 })
    .catch(() => {});
  await page.waitForTimeout(600);
  // 把 stub 换成"用户选了 pickedDir"。
  await stubDialog([pickedDir]);
  const beforeLabel = await composerWorkspaceLabel(page);
  const opened = await page.evaluate(() => {
    const trigger = document.querySelector(".workspace-picker__trigger");
    if (!(trigger instanceof HTMLElement)) return false;
    trigger.click();
    return true;
  });
  await page.waitForTimeout(600);
  const browseClicked = await page.evaluate(() => {
    const item = document.querySelector(".workspace-picker__item--browse");
    if (!(item instanceof HTMLElement)) return false;
    item.click();
    return true;
  });
  await page.waitForTimeout(3000);
  // 注意:选中目录**不会**改当前会话的 cwd(ACP 的 cwd 是 per-session 的,
  // 切换只影响下一个新会话)。所以可观察的证据不是输入区那行文字,而是
  // **工作空间注册表**里真的多了这个目录 —— `pickFolder` 调的就是
  // `onSelectWorkspace` → `piCreateWorkspace`。改前它在 `if (!selected ||
  // Array.isArray(selected)) return;` 就返回了,注册表不会有任何变化。
  const registry = await page.evaluate(async () => {
    try {
      return await window.api.invoke("workspace:list");
    } catch (error) {
      return { error: String(error) };
    }
  });
  const registryItems = Array.isArray(registry?.items) ? registry.items : [];
  step(
    "聊天输入区的「选择工作空间」能打开",
    opened && browseClicked,
    JSON.stringify({ opened, browseClicked, beforeLabel }),
  );
  step(
    "点「选择文件夹…」后选中的目录真的进了工作空间注册表(此前点了没有任何反应)",
    registryItems.some((item) => typeof item?.cwd === "string" && realpathSync(item.cwd) === pickedReal),
    JSON.stringify({
      picked: pickedDir,
      registered: registryItems.map((item) => item?.cwd),
    }),
  );
  // 再打开一次选择器:列表里应该能看到刚加进来的这个工作空间。
  await page.evaluate(() => {
    const trigger = document.querySelector(".workspace-picker__trigger");
    if (trigger instanceof HTMLElement) trigger.click();
  });
  await page.waitForTimeout(800);
  const listed = await page.evaluate(
    (cwd) =>
      Array.from(document.querySelectorAll(".workspace-picker__item")).some(
        (el) => {
          const title = el.getAttribute("title");
          if (!title) return false;
          try {
            return realpathSync(title) === cwd;
          } catch {
            return title === cwd;
          }
        },
      ),
    pickedReal,
  );
  step("重新打开选择器能看到这个工作空间(不是只改了内存)", listed, JSON.stringify({ listed }));

  if (SHOTS_ENABLED) await page.screenshot({ path: "tests/screenshots/r39-workspace-picked.png" });

  report.ok = report.steps.every((item) => item.ok) && report.pageErrors.length === 0;
} catch (error) {
  report.error = String(error?.stack ?? error);
} finally {
  await app.close().catch(() => {});
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
