/**
 * R95 探针:验证「agent 数据目录」从 main 一路到 UI 文案都是
 * `~/.openbuddy/agent`,而不是 `~/.pi`。
 *
 * 为什么需要真机探针(而不是只靠单测):
 *   单测锁住的是 `describeAgentPaths()` 与 `useAgentPaths()` 各自的逻辑。
 *   但它们之间隔着 IPC 白名单(preload 的 `allowedInvokeChannels`)、
 *   `registerAgentPathsIpc()` 的挂载、以及 renderer 的 vite alias —— 任何
 *   一环漏了,单测都还是绿的,而用户在界面上看到的仍是 `~/.pi/...`。
 *   本探针在一个真实 Electron 进程里,用一个**自定义**的
 *   `OPENBUDDY_AGENT_DIR`,断言:
 *     1. `agent:paths` 通道真的存在且返回自定义路径(证明白名单 + handler 接通)
 *     2. UI 渲染出的目录文案跟着自定义路径走(证明 renderer 真在消费它,
 *        而不是回落到兜底常量 —— 这一条是"接线成功"与"看起来对"的分水岭)
 *     3. 设置面板里渲染出的可见文本**不含** `~/.pi`
 *
 * 用法:`node scripts/electron/_probe-r95-agent-paths.mjs`
 * stdout 只输出一个 JSON 对象,结尾 `process.exit(report.ok ? 0 : 1)`。
 */
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const report = { steps: [], pageErrors: [] };
const step = (name, ok, detail) => report.steps.push({ step: name, ok: Boolean(ok), detail });

const userData = mkdtempSync(join(tmpdir(), "ob-r95-paths-"));
// 故意用自定义目录:如果 renderer 回落到了兜底常量 `~/.openbuddy/agent`,
// 断言 2 会红 —— 这样"接线成功"和"恰好猜对默认值"就能被区分开。
const agentDir = mkdtempSync(join(tmpdir(), "ob-r95-agent-"));
mkdirSync(join(agentDir, "agents"), { recursive: true });
mkdirSync(join(agentDir, "experts"), { recursive: true });

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
  await page.waitForLoadState("domcontentloaded");
  page.on("pageerror", (e) => report.pageErrors.push(String(e).slice(0, 200)));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 45000 });

  // 跳过引导 / tour,否则首启浮层会盖住设置面板。
  await page.evaluate(() => {
    window.localStorage.setItem("openbuddy.onboarding.state", JSON.stringify({
      version: 1, status: "done", index: 2,
      steps: [{ id: "welcome", status: "done" }, { id: "first-task", status: "done" }, { id: "done", status: "done" }],
      startedAt: Date.now(), updatedAt: Date.now(), completedAt: Date.now(),
    }));
    window.localStorage.setItem("openbuddy.tour.state", "seen");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 45000 });
  await page.waitForTimeout(2500);

  // ---- 1. IPC 通道本身 ----
  const snapshot = await page.evaluate(async () => {
    try {
      return await window.api.invoke("agent:paths");
    } catch (e) {
      return { error: String(e) };
    }
  });
  report.snapshot = snapshot;

  const isShape = snapshot && typeof snapshot.home === "string" && typeof snapshot.agents === "string";
  step("agent:paths 在白名单且可调用", isShape && !snapshot.error, JSON.stringify(snapshot).slice(0, 300));
  step(
    "agent:paths 反映 OPENBUDDY_AGENT_DIR(而非默认 ~/.openbuddy/agent)",
    isShape && snapshot.home === agentDir,
    `home=${snapshot?.home} expected=${agentDir}`,
  );
  step(
    "agent:paths 的 home 不含 .pi",
    isShape && !/[\\/]\.pi([\\/]|$)/.test(snapshot.home),
    snapshot?.home,
  );
  step(
    "子路径与 main 落盘一致(agents/plugins/node_modules)",
    isShape
      && snapshot.agents === `${agentDir}/agents`
      && snapshot.plugins === `${agentDir}/plugins`
      && snapshot.extensions === `${agentDir}/node_modules`,
    JSON.stringify({ agents: snapshot?.agents, plugins: snapshot?.plugins, extensions: snapshot?.extensions }),
  );
  step("fromEnv=true(显式覆盖被识别)", isShape && snapshot.fromEnv === true, String(snapshot?.fromEnv));

  // ---- 1b. `PI_CODING_AGENT_DIR` 真的被钉进了 main 进程 ----
  // 这一条修的是数据落盘:pi-coding-agent 的 `getAgentDir()` 只读环境变量,
  // 不设就会回落到 `~/.pi/agent`(另一个产品的目录)。探针跑在**没有**设该
  // 变量的环境里,所以这里能看到 main 是否替用户补上了。
  const pin = await page.evaluate(async () => {
    // renderer 读不到 main 的 process.env,所以只能通过 IPC 暴露的路径反推:
    // agent:paths 的 home 就是钉进去的值。真正的 env 断言放在 main 侧单测
    // (packages/runtime/openbuddy-storage/src/__tests__/paths.test.ts),这里
    // 只确认它没有把关卡绕过去 —— 即 agents 子路径确实在自定义根之下。
    try {
      const paths = await window.api.invoke("agent:paths");
      return {
        home: paths?.home ?? null,
        agents: paths?.agents ?? null,
        piAgentDir: paths?.piAgentDir ?? null,
        piAgentDirPinnedByUs: paths?.piAgentDirPinnedByUs ?? null,
      };
    } catch (error) {
      return { error: String(error) };
    }
  });
  report.agentDirPin = pin;
  step(
    "main 的 agent 根不含 .pi(未被 SDK 默认值带偏)",
    typeof pin.home === "string" && !/[\\/]\.pi([\\/]|$)/.test(pin.home),
    JSON.stringify(pin),
  );
  // 这才是"数据写到哪"的直接证据:`PI_CODING_AGENT_DIR` —— 也就是
  // pi-coding-agent `getAgentDir()` 唯一读取的变量 —— 必须等于 agentHome。
  // 只看 `home` 不够:home 是我们自己算的,piAgentDir 是 SDK 会去用的。
  step(
    "PI_CODING_AGENT_DIR 被钉成 agentHome(pi SDK 与 OpenBuddy 同根)",
    pin.piAgentDir === pin.home,
    `piAgentDir=${pin.piAgentDir} home=${pin.home}`,
  );
  step(
    "钉入标记为 true(证明是本进程补的,不是恰好继承了外部环境变量)",
    pin.piAgentDirPinnedByUs === true,
    String(pin.piAgentDirPinnedByUs),
  );

  // ---- 2. 打开设置 → 助理设置,看 UI 文案是否真的用了自定义路径 ----
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);

  const openedSettings = await page.evaluate(async () => {
    // 设置入口在左下角用户菜单里;直接走 store 不可靠,所以点侧栏底部按钮。
    const candidates = [...document.querySelectorAll("button,[role=button]")]
      .filter((b) => /设置|Settings/i.test(
        (b.textContent || "") + (b.getAttribute("title") || "") + (b.getAttribute("aria-label") || ""),
      ));
    if (candidates.length === 0) return false;
    candidates[candidates.length - 1].click();
    return true;
  });
  step("找到并点击设置入口", openedSettings, String(openedSettings));
  await page.waitForTimeout(1500);

  const settingsText = await page.evaluate(() => {
    const modal = document.querySelector(".settings-modal, [data-testid='settings-modal'], .settings-overlay");
    return modal ? (modal.textContent || "") : null;
  });
  report.settingsOpen = settingsText !== null;
  report.settingsHasPiPath = Boolean(settingsText && /~\/\.pi|\/\.pi\//.test(settingsText));
  step("设置面板已打开", settingsText !== null, `open=${settingsText !== null}`);
  step("设置面板可见文本不含 ~/.pi", !report.settingsHasPiPath, `matched=${report.settingsHasPiPath}`);

  // ---- 2b. 进入「助理设置」并断言它渲染的是**自定义**路径 ----
  // 这一步才是「renderer 真的在消费 agent:paths」的证据。只断言「文案里没有
  // ~/.pi」会漏掉一种情况:组件回落到兜底常量 `~/.openbuddy/agent` ——
  // 那看起来也对,但说明 IPC 根本没接上。
  const clickedAssistant = await page.evaluate(() => {
    const item = [...document.querySelectorAll(".settings-navigation__item")]
      .find((el) => /助理|Assistant/i.test(el.textContent || ""));
    if (!item) return false;
    item.click();
    return true;
  });
  step("找到「助理设置」导航项", clickedAssistant, String(clickedAssistant));
  await page.waitForTimeout(1800);

  report.assistantText = await page.evaluate(() => {
    const modal = document.querySelector(".settings-modal");
    return modal ? (modal.textContent || "").replace(/\s+/g, " ") : "";
  });
  // agentHome 展示形式:临时目录不在 $HOME 下,所以不会被折叠成 `~`。
  report.assistantShowsCustomHome = report.assistantText.includes(agentDir);
  report.assistantShowsFallbackHome = report.assistantText.includes("~/.openbuddy/agent");
  step(
    "助理设置渲染的是自定义 agentHome(不是兜底常量)",
    report.assistantShowsCustomHome && !report.assistantShowsFallbackHome,
    JSON.stringify({
      showsCustom: report.assistantShowsCustomHome,
      showsFallback: report.assistantShowsFallbackHome,
      sample: report.assistantText.slice(0, 300),
    }),
  );

  // ---- 3. 全局兜底:整页可见文本里不许出现 ~/.pi ----
  const bodyHasPiPath = await page.evaluate(() => /~\/\.pi[\/\s]/.test(document.body.innerText || ""));
  report.bodyHasPiPath = bodyHasPiPath;
  step("整页可见文本不含 ~/.pi", !bodyHasPiPath, `matched=${bodyHasPiPath}`);

  step("无渲染异常", report.pageErrors.length === 0, JSON.stringify(report.pageErrors));
} catch (error) {
  step("探针执行未抛错", false, String(error).slice(0, 400));
} finally {
  await app.close().catch(() => {});
}

report.ok = report.steps.every((s) => s.ok);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
