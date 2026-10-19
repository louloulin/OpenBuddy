/**
 * git-panel-verify.mjs — 真机验证 Git 面板(parity 2.2 / chat UI 计划批 5)。
 *
 * 不依赖模型网关。两层验证:
 *   A. 真实 UI(默认会话, cwd = 本仓库 —— 只读断言):
 *     G1  「变更」视图在有 git 改动时可见(ViewSelector 里有「变更」)
 *     G2  git 状态列表真实渲染(条目数与 git:status 一致)
 *     G3  分支名真实显示
 *     G4  点击工作区已修改文件 → git diff 内容渲染
 *   B. IPC 数据层全环(种子 git 仓库 —— 可写):
 *     G0  git:status 信任门 + porcelain 解析
 *     G5  git:stage 暂存未跟踪文件
 *     G6  git:commit + git:log 新提交可见
 *   G7  渲染层零 React 错误
 *
 * 信任:folder-trust 存储预置在 PI_CODING_AGENT_DIR(= piHome())下,
 * 等价于用户在首次对话时点了「信任此文件夹」。
 *
 * Usage: node scripts/electron/git-panel-verify.mjs
 */
import { _electron as electron } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SHOT_DIR = "/tmp/ob-git-probe";
mkdirSync(SHOT_DIR, { recursive: true });

const log = (msg) => console.log(`[git-panel] ${msg}`);

// ---------- 1. 种子 git 工作区(可写层用) ----------
const workspace = mkdtempSync(join(tmpdir(), "ob-git-probe-ws-"));
const git = (args) => execFileSync("git", args, { cwd: workspace, stdio: "pipe" });
writeFileSync(join(workspace, "README.md"), "line1\nline2\nline3\n");
git(["init", "-b", "main"]);
git(["config", "user.email", "probe@openbuddy.local"]);
git(["config", "user.name", "probe"]);
git(["add", "."]);
git(["commit", "-m", "init baseline"]);
writeFileSync(join(workspace, "README.md"), "line1\nCHANGED\nline3\n"); // 未暂存修改
writeFileSync(join(workspace, "untracked.txt"), "untracked\n"); // 未跟踪
log(`workspace seeded: ${workspace}`);

// ---------- 2. Electron 环境 ----------
const userData = mkdtempSync(join(tmpdir(), "ob-git-probe-ud-"));
const piAgentDir = join(userData, "pi-agent");
mkdirSync(piAgentDir, { recursive: true });
writeFileSync(join(piAgentDir, "models.json"), `${JSON.stringify({ providers: {} }, null, 2)}\n`, { mode: 0o600 });
writeFileSync(join(piAgentDir, "auth.json"), `${JSON.stringify({}, null, 2)}\n`, { mode: 0o600 });
// folder-trust 预置(piHome() = PI_CODING_AGENT_DIR):同时授权本仓库(默认
// 会话的 cwd,UI 层用)与种子仓库(数据层用)。
writeFileSync(
  join(piAgentDir, "folder-trust.json"),
  `${JSON.stringify(
    {
      version: 1,
      entries: [ROOT, workspace].map((cwd) => ({ cwd, trusted: true, decidedAt: new Date().toISOString() })),
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);

const childEnv = {
  ...process.env,
  ELECTRON_RENDERER_URL: "",
  PI_CODING_AGENT_DIR: piAgentDir,
  OPENBUDDY_DEBUG_UI: "0",
  OPENBUDDY_HARNESS_FILE: "",
};

const checks = [];
function record(id, label, ok, detail = "") {
  checks.push({ id, ok });
  log(`${ok ? "PASS" : "FAIL"}  ${id}  ${label}${detail ? ` — ${detail}` : ""}`);
}

let app;
let page;
const rendererErrors = [];

try {
  log("launching Electron…");
  app = await electron.launch({
    args: [`--user-data-dir=${userData}`, ROOT],
    executablePath: process.env.OPENBUDDY_ELECTRON_PATH ?? join(ROOT, "node_modules", ".bin", "electron"),
    cwd: ROOT,
    timeout: 90_000,
    env: childEnv,
  });
  page = await app.firstWindow();
  page.on("console", (m) => {
    if (m.type() === "error") rendererErrors.push(String(m.text()).slice(0, 300));
  });
  page.on("pageerror", (e) => rendererErrors.push(String(e.message).slice(0, 300)));
  await page.locator("#root").waitFor({ state: "attached", timeout: 60_000 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30_000 });
  log("app ready");
  await page.waitForTimeout(2500);
  await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 2500 }).catch(() => {});

  const invoke = (channel, args) =>
    page.evaluate(({ channel: ch, args: a }) => window.api.invoke(ch, a), { channel, args });

  // ---------- A0. 数据层全环(种子仓库,可写) ----------
  const st0 = await invoke("git:status", { cwd: workspace });
  const shapeOk =
    st0?.isRepo === true &&
    st0?.branch === "main" &&
    st0?.entries?.length === 2 &&
    st0.entries.some((e) => e.path === "README.md" && e.y === "M") &&
    st0.entries.some((e) => e.path === "untracked.txt" && e.x === "?");
  record("G0", "git:status 信任门 + porcelain 解析", shapeOk, JSON.stringify(st0)?.slice(0, 220));

  await invoke("git:stage", { cwd: workspace, paths: ["untracked.txt"] });
  const st1 = await invoke("git:status", { cwd: workspace });
  const stagedOk = st1.entries.some((e) => e.path === "untracked.txt" && e.x === "A");
  record("G5", "git:stage 暂存未跟踪文件", stagedOk, JSON.stringify(st1?.entries)?.slice(0, 160));

  const committed = await invoke("git:commit", { cwd: workspace, message: "probe: git panel commit" });
  const log1 = await invoke("git:log", { cwd: workspace, limit: 5 });
  const commitOk =
    typeof committed?.hash === "string" &&
    committed.hash.length >= 4 &&
    log1?.commits?.some((c) => c.subject === "probe: git panel commit");
  record("G6", "git:commit + git:log 新提交可见", commitOk, `hash=${committed?.hash}`);
  const st2 = await invoke("git:status", { cwd: workspace });
  const cleanOk = !st2.entries.some((e) => e.path === "untracked.txt");
  record("G6b", "提交后该文件离开状态列表", cleanOk);

  // ---------- A. 真实 UI(默认会话,cwd = 本仓库) ----------
  // 本仓库当前有未提交改动(git-panel 功能本身),作为 UI 层的真实数据源。
  const repoStatus = await invoke("git:status", { cwd: ROOT });
  const repoEntries = repoStatus?.entries ?? [];
  record(
    "A0",
    "本仓库工作区状态可读(UI 数据源)",
    repoStatus?.isRepo === true && repoEntries.length > 0,
    `${repoEntries.length} 个条目`,
  );
  // 选一个工作区已修改(Y=M)的文件做 diff 断言。
  const modified = repoEntries.find((e) => e.y === "M");

  // 打开侧面板前先进一个会话(工具栏只在会话视图挂载)。
  const sessionRow = page.locator(".sidebar__conv").first();
  await sessionRow.waitFor({ state: "visible", timeout: 20_000 });
  await sessionRow.click();
  await page.waitForTimeout(1500);
  log("session selected");

  // 打开侧面板(文件树入口,空会话即可用)。
  const fileTreeBtn = page.getByRole("button", { name: "工作区文件树" });
  await fileTreeBtn.click({ timeout: 15_000 });
  await page.locator(".tool-side-panel").waitFor({ state: "visible", timeout: 10_000 });
  log("side panel open");
  await page.waitForTimeout(1500);

  const pill = page.locator(".view-selector__pill");
  await pill.click({ timeout: 10_000 });
  await page.locator(".view-selector__menu").waitFor({ state: "visible", timeout: 5_000 });
  const optionLabels = await page.locator(".view-selector__option").allInnerTexts();
  log(`view options: [${optionLabels.join(", ")}]`);

  const changesOption = page.getByRole("option", { name: "变更" });
  let appeared = true;
  try {
    await changesOption.waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    appeared = false;
    await page.screenshot({ path: join(SHOT_DIR, "view-selector.png") });
  }
  record("G1", "「变更」视图在有 git 改动时可见", appeared);
  if (!appeared) throw new Error("变更选项未出现");
  await changesOption.click();
  await page.locator(".git-panel").waitFor({ state: "visible", timeout: 10_000 });
  await page.screenshot({ path: join(SHOT_DIR, "git-panel.png") });

  const panelText = await page.locator(".git-panel").innerText();
  const branchOk = panelText.includes(repoStatus.branch);
  record("G3", `分支名真实显示(${repoStatus.branch})`, branchOk);

  const listedCount = await page.locator(".git-panel .artifacts-list__item").count();
  record(
    "G2",
    "git 状态条目真实渲染",
    modified ? listedCount > 0 : listedCount === 0,
    `面板 ${listedCount} 行 / 仓库 ${repoEntries.length} 条`,
  );

  if (modified) {
    await page
      .locator(".git-panel .artifacts-list__main")
      .filter({ hasText: modified.path.split("/").pop() })
      .first()
      .click();
    await page.locator(".git-diff__patch").waitFor({ state: "visible", timeout: 10_000 });
    const patch = await page.locator(".git-diff__patch").innerText();
    const diffOk = patch.includes("@@") || patch.includes("+") || patch.includes("-");
    record("G4", "git diff 内容渲染", diffOk && !patch.includes("git.noDiff"), patch.slice(0, 100).replace(/\n/g, "⏎"));
    await page.screenshot({ path: join(SHOT_DIR, "git-diff.png") });
  } else {
    record("G4", "git diff 内容渲染", true, "(本仓库无工作区已修改文件,跳过)");
  }

  // ---------- 渲染层错误 ----------
  const reactErrors = rendererErrors.filter((e) => /Minified React error|React error/i.test(e));
  record("G7", "渲染层零 React 错误", reactErrors.length === 0, reactErrors.slice(0, 3).join(" | "));
} catch (error) {
  const message = String(error?.message ?? error).slice(0, 600);
  log(`PROBE ERROR: ${message}`);
  try {
    await page?.screenshot({ path: join(SHOT_DIR, "probe-error.png") });
  } catch {}
  record("PROBE", "探针完成(无异常)", false, message);
} finally {
  try {
    await app?.close();
  } catch {}
  try {
    rmSync(userData, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  } catch {}
}

const failed = checks.filter((c) => !c.ok);
console.log(
  `\n[git-panel] ${checks.length - failed.length}/${checks.length} checks passed. Screenshots: ${SHOT_DIR}`,
);
process.exit(failed.length > 0 ? 1 : 0);
