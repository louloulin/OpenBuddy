/**
 * _probe-tasks-panel.mjs — 任务面板的真实启动验证。
 *
 * 为什么需要它(而不是再写一个单测):
 *   `SessionTasksPanel` 的单测用 `vi.mock` 替换了 pi-client,所以它证明的是
 *   "组件会调用某个函数",而不是"这条链路真的通"。1.3 改动的完整链条是
 *   renderer → preload allowlist → ipcMain → TaskService → TaskCatalog →
 *   `session_tasks` 表,其中**任何**一环写错都会让面板看起来正常但一个字都没落盘
 *   —— 这正是本仓库"假成功"的典型形态。所以这个探针启动真的 Electron:
 *     1. 用真 IPC 建会话,确认 tasks:* 的 CRUD 全部返回真实数据;
 *     2. 点开工具栏的任务按钮、在面板里新增一条,确认它出现在界面上;
 *     3. 直接用 node:sqlite 打开 `<PI_CODING_AGENT_DIR>/openbuddy.sqlite`,
 *        确认那一行**真的**写进了 session_tasks 表(顺带锁住 DB 路径修复:
 *        旧实现写的是 ~/.config/openbuddy/sessions.db,没人读)。
 *
 * 用法:node scripts/electron/_probe-tasks-panel.mjs
 * 退出码:0 全绿;1 有失败(失败项逐条打印)。
 */
import { _electron as electron } from "playwright";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "openbuddy-tasks-probe-"));
const piAgentDir = join(userData, "pi-agent");
mkdirSync(piAgentDir, { recursive: true });
const workspace = join(userData, "workspace");
mkdirSync(workspace, { recursive: true });

const results = [];
function check(label, ok, detail = "") {
  results.push({ label, ok: Boolean(ok), detail });
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

let app;
try {
  console.log(`[probe] launching Electron (userData=${userData})`);
  app = await electron.launch({
    args: [root],
    env: { ...process.env, ELECTRON_RENDERER_URL: "", PI_CODING_AGENT_DIR: piAgentDir, ELECTRON_ENABLE_LOGGING: "1" },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  await win.waitForSelector("textarea", { timeout: 60_000 });
  check("Electron 启动并挂载 renderer", true);

  // 首启会弹出 onboarding 向导(role=dialog/aria-modal),它**拦截指针事件**,
  // 会让后面每一次 sidebar 点击都超时重试到失败。归档探针(_archive/electron-probes)
  // 里一律先关掉它;这里照做。
  await win
    .click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 5_000 })
    .catch(() => { /* 没有向导=已经关过,忽略 */ });

  const invoke = (channel, payload) =>
    win.evaluate(
      ([c, p]) => window.api.invoke(c, p),
      [channel, payload],
    );

  // ---- 1. IPC 链路:真会话 + tasks:* CRUD ----
  const session = await invoke("agent:new-session", { cwd: realpathSync(workspace) });
  const sessionId = session?.sessionId;
  check("agent:new-session 返回 sessionId", Boolean(sessionId), String(sessionId));
  if (!sessionId) throw new Error("no session id; cannot continue");

  const before = await invoke("tasks:list", { sessionId });
  check("tasks:list 初始为空数组(不是 null 空桩)", Array.isArray(before) && before.length === 0, JSON.stringify(before));

  const added = await invoke("tasks:add", { sessionId, title: "PROBE-任务-甲" });
  check("tasks:add 返回真实 id(不是 null)", typeof added?.id === "string" && added.id.length > 0, JSON.stringify(added));

  const listed = await invoke("tasks:list", { sessionId });
  check("tasks:list 读回刚写入的任务", Array.isArray(listed) && listed.length === 1 && listed[0].content === "PROBE-任务-甲", JSON.stringify(listed));

  const updated = await invoke("tasks:update", { sessionId, id: added.id, patch: { status: "completed" } });
  check("tasks:update 改状态成功", updated?.id === added.id, JSON.stringify(updated));
  const afterUpdate = await invoke("tasks:list", { sessionId });
  check("状态确实变成了 completed", afterUpdate?.[0]?.status === "completed", JSON.stringify(afterUpdate));

  // ---- 2. UI 链路:走真实用户路径进入会话,再点开面板 ----
  // 注意:用 IPC 建会话**不会**让界面进入 ChatView(实测 chatview=false)——
  // renderer 只有在用户点侧栏「新建任务」时才切过去。第一版探针在这里假设错了,
  // 报"按钮找不到",其实是探针没进会话。这条注释留着,免得下次又踩。
  // 进入会话的真实路径:侧栏会话列表里的那一行 `.sidebar__conv`。
  // (点「新建任务」只会回到助理工作台首页,不会进 ChatView —— 实测过。)
  await win.waitForSelector(".sidebar__conv", { timeout: 20_000 });
  await win.locator(".sidebar__conv").first().click();
  await win.waitForSelector(".chatview", { timeout: 20_000 });
  const tasksBtn = win.locator('[data-tip^="任务"]').first();
  await tasksBtn.waitFor({ timeout: 15_000 });
  await tasksBtn.click();
  const input = win.locator('input[aria-label="新增一个任务…"]').first();
  await input.waitFor({ timeout: 10_000 });
  check("工具栏任务按钮能打开面板(输入框出现)", true);

  await input.fill("PROBE-面板新增-乙");
  await win.locator(".session-tasks__add-btn").first().click();
  const row = win.locator(".session-tasks__content", { hasText: "PROBE-面板新增-乙" }).first();
  await row.waitFor({ timeout: 10_000 });
  check("面板新增后行出现在界面上", true);

  // 点状态芯片:待处理 → 进行中
  const chip = win.locator(".session-tasks__status").last();
  await chip.click();
  await win.waitForTimeout(300);
  const chipText = await chip.innerText();
  check("点击状态芯片切换到进行中", chipText.includes("进行中"), chipText.trim());

  // ---- 3. 落盘:直接读 SQLite ----
  const dbPath = join(piAgentDir, "openbuddy.sqlite");
  check("数据库落在 piHome/openbuddy.sqlite(不是 ~/.config/…/sessions.db)", existsSync(dbPath), dbPath);
  const db = new DatabaseSync(dbPath);
  const rows = db.prepare("SELECT content, status FROM session_tasks WHERE content LIKE 'PROBE-%' ORDER BY content").all();
  db.close();
  const contents = rows.map((r) => r.content);
  check(
    "两条任务都真的写进了 session_tasks 表",
    contents.includes("PROBE-任务-甲") && contents.includes("PROBE-面板新增-乙"),
    JSON.stringify(rows),
  );
  const inProgress = rows.find((r) => r.content === "PROBE-面板新增-乙")?.status;
  check("面板里的状态切换也落了盘", inProgress === "in_progress", String(inProgress));
} catch (error) {
  check("探针执行未抛异常", false, String(error?.message ?? error));
} finally {
  if (app) await app.close().catch(() => {});
  rmSync(userData, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n[probe] ${results.length - failed.length}/${results.length} 通过`);
for (const f of failed) console.log(`  ✗ ${f.label}${f.detail ? ` — ${f.detail}` : ""}`);
console.log(failed.length === 0 ? "EXIT=0" : "EXIT=1");
process.exit(failed.length === 0 ? 0 : 1);
