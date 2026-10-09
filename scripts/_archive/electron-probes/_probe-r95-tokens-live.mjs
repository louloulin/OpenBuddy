/**
 * R95 探针:在**真实渲染进程**里证明语义令牌能解析出颜色。
 *
 * 为什么静态审计不够
 * ------------------
 * `scripts/ui-token-audit.mjs` 只能看到"定义存在"与"使用存在"。它无法知道:
 *
 *   - 定义与使用是否在**同一棵被加载的样式树**里(`tokens.css` 经
 *     `globals.css` 加载,而 `src/styles/global.css` **从未被加载** ——
 *     历史上正是这个差别让 `--wb-brand` 空了一整轮,513 处引用全部走 fallback)
 *   - 主题切换后 inline 变量与样式表变量谁赢
 *   - 浏览器是否真的把这几个 token 解析成了颜色
 *
 * 所以这里用一个真实 Electron 窗口,在**浅色与深色两套主题下**分别读
 * `getComputedStyle` 的解析结果,并断言:
 *   1. 关键文本令牌解析出的颜色**非空**,且**在两种主题下不同**(证明它跟着
 *      主题走,而不是被某个 `!important` 钉死)
 *   2. 用一个探针元素实测 `color: var(--wb-text-secondary)` 的**计算值** ——
 *      这是"声明是否被丢弃"的唯一直接证据
 *
 * 用法:`node scripts/electron/_probe-r95-tokens-live.mjs`
 */
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const report = { steps: [], pageErrors: [] };
const step = (name, ok, detail) => report.steps.push({ step: name, ok: Boolean(ok), detail });

const userData = mkdtempSync(join(tmpdir(), "ob-r95-tok-"));
const agentDir = mkdtempSync(join(tmpdir(), "ob-r95-tok-agent-"));
mkdirSync(join(agentDir, "agents"), { recursive: true });

/**
 * 在页面里读令牌 + 用一个游离元素实测 `var()` 解析。
 *
 * 游离元素用 `position:absolute; visibility:hidden` 挂到 body 上 —— 它继承
 * `:root` 的变量,但不影响布局,也不会被任何业务选择器命中。
 */
/**
 * 每个令牌配一个**它能合法赋值的 CSS 属性**。
 *
 * 为什么不能统一用 `color` 试:把 `var(--wb-radius)`(值是 `6px`)赋给
 * `color`,浏览器无论如何都会判定该声明无效 —— 计算值回落到继承色。
 * 那样得到的"解析失败"是探针自己的错,与令牌是否定义无关。按令牌真实用途
 * 挑属性,才能让「解析成功 / 失败」这个信号有意义。
 */
const TOKEN_PROBES = [
  { token: "--wb-text-primary", prop: "color" },
  { token: "--wb-text-secondary", prop: "color" },
  { token: "--wb-text-disabled", prop: "color" },
  { token: "--wb-text-low", prop: "color" },
  { token: "--wb-bg-primary", prop: "backgroundColor" },
  { token: "--wb-bg-surface", prop: "backgroundColor" },
  { token: "--wb-status-success-soft", prop: "backgroundColor" },
  { token: "--wb-radius", prop: "borderRadius" },
];

const PROBE_FN = `(probes) => {
  const cs = getComputedStyle(document.documentElement);
  const read = Object.fromEntries(probes.map((p) => [p.token, cs.getPropertyValue(p.token).trim()]));

  // 游离元素:继承 :root 的变量,但不参与布局,也不会被业务选择器命中。
  //
  // all:initial 先把继承链切断,否则某个属性"解析失败回落"与"解析成功但恰好
  // 等于继承值"无法区分。注意 all 不重置自定义属性,所以 :root 上的令牌仍然
  // 会被这个元素继承 —— 这正是我们要测的。
  // cssText 里 all 必须放最前:它会重置后面声明过的 position/visibility。
  const probe = document.createElement("div");
  probe.style.cssText = "all:initial;position:absolute;visibility:hidden;pointer-events:none;top:-9999px";
  document.body.appendChild(probe);

  // 主信号:用「自定义属性替换」直接问浏览器"这个令牌有没有值"。
  //   --ob-probe-result: var(<token>, <SENTINEL>)
  // 令牌存在 -> getPropertyValue 返回替换后的值;
  // 令牌不存在(或它自己被解析成 guaranteed-invalid)-> 返回 SENTINEL 或空串。
  //
  // 这比"把 var(--token) 赋给某个属性再看计算值变没变"精确:
  //   - 不需要为每个令牌挑一个合法属性(--wb-radius 赋给 color 必然无效)
  //   - 令牌恰好解析成该属性的 initial 值时不会误报失败
  const SENTINEL = "__ob_token_missing__";
  const resolved = {};
  for (const { token, prop } of probes) {
    probe.style.setProperty("--ob-probe-result", "var(" + token + ", " + SENTINEL + ")");
    const substituted = getComputedStyle(probe).getPropertyValue("--ob-probe-result").trim();

    // 辅助信号:按令牌真实用途赋值,记录计算值是否偏离 all:initial 基线。
    probe.style[prop] = "";
    const before = getComputedStyle(probe)[prop];
    probe.style[prop] = "var(" + token + ")";
    const after = getComputedStyle(probe)[prop];

    resolved[token] = {
      prop,
      substituted,
      // 令牌真的解析出了值(不是兜底 sentinel,也不是空)。
      resolved: substituted !== "" && substituted !== SENTINEL,
      before,
      after,
      propDiffers: after !== before,
      inline: probe.style[prop],
    };
  }
  probe.remove();
  return {
    dataTheme: document.documentElement.getAttribute("data-theme"),
    dataThemeName: document.documentElement.getAttribute("data-theme-name"),
    read,
    resolved,
  };
}`;

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root,
  timeout: 60000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0", OPENBUDDY_AGENT_DIR: agentDir },
});

try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  page.on("pageerror", (e) => report.pageErrors.push(String(e).slice(0, 200)));
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
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForTimeout(3000);

  // ---- 浅色 ----
  await page.evaluate(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", "light");
    root.setAttribute("data-theme-name", "white");
  });
  await page.waitForTimeout(600);
  report.light = await page.evaluate(`(${PROBE_FN})(${JSON.stringify(TOKEN_PROBES)})`);

  // ---- 深色 ----
  await page.evaluate(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", "dark");
    root.setAttribute("data-theme-name", "black");
  });
  await page.waitForTimeout(600);
  report.dark = await page.evaluate(`(${PROBE_FN})(${JSON.stringify(TOKEN_PROBES)})`);

  // ---- 断言:每个令牌在两套主题下都真的解析出了值 ----
  // 这里区分三种失败,因为它们的修法完全不同:
  //   missing     —— :root 上读不到该自定义属性(压根没定义 / 样式表没加载)
  //   unresolved  —— 定义了但替换后仍是空或 sentinel(值是 guaranteed-invalid,
  //                  常见于 var() 链断在某个未定义的上游 token)
  //   notThemeable—— 两套主题下解析出**同一个值**(被 !important 或非主题块钉死)
  const missing = [];
  const unresolved = [];
  for (const { token } of TOKEN_PROBES) {
    const lightRaw = report.light.read[token];
    const darkRaw = report.dark.read[token];
    if (!lightRaw || !darkRaw) missing.push(token);
    if (!report.light.resolved[token].resolved || !report.dark.resolved[token].resolved) unresolved.push(token);
  }
  step("全部关键令牌在浅色/深色下都有定义", missing.length === 0, `missing=${JSON.stringify(missing)}`);
  step(
    "全部关键令牌的 var() 都能被解析并生效(声明未被丢弃)",
    unresolved.length === 0,
    `unresolved=${JSON.stringify(unresolved)}\n` +
      JSON.stringify({ light: report.light.resolved, dark: report.dark.resolved }, null, 2),
  );

  // ---- 断言:主题真的换了画布与文字色 ----
  // 上面两条只能证明解析出了值。这两条证明值跟着主题走 —— 如果某个
  // 令牌被硬编码在某处(或在 dark 块里重复定义成同值),解析照样成功但主题
  // 切换不会有视觉变化。
  step(
    "浅色/深色下 --wb-bg-primary 不同",
    report.light.read["--wb-bg-primary"] !== report.dark.read["--wb-bg-primary"],
    `${report.light.read["--wb-bg-primary"]} vs ${report.dark.read["--wb-bg-primary"]}`,
  );
  step(
    "浅色/深色下 --wb-text-secondary 不同",
    report.light.read["--wb-text-secondary"] !== report.dark.read["--wb-text-secondary"],
    `${report.light.read["--wb-text-secondary"]} vs ${report.dark.read["--wb-text-secondary"]}`,
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
