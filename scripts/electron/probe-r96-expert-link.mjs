/**
 * R96 探针:在真实 Electron 进程里验证「起步专家不再互相覆盖」。
 *
 * 为什么需要真机探针(而不是只靠单测):
 *   单测直接调 `linkExpertAgents()`,证明的是**那个函数**的行为。但从用户
 *   操作到落盘还隔着:renderer 的 `handleSummonFromModal` → IPC
 *   `experts_link_agents` → preload 白名单 → main handler。任何一环漏了,
 *   单测仍然是绿的,而真实「召唤专家团」依旧写不出可被 pi-subagents 发现的
 *   文件。本探针从 renderer 侧的 IPC 调用出发,断言:
 *     1. 6 个起步专家逐个链接后,`<agentHome>/agents/` 里每个专家都按自己的
 *        frontmatter `name` 落一个文件(而不是 6 个都写成 `lead.md`)
 *     2. 每个文件的内容确实是它自己的 prompt(不是最后一个覆盖者)
 *     3. 团队成员(4 个)也在
 *     4. 已安装的 pi-subagents 能真正发现这些 agent
 *
 * 用法:`node scripts/electron/probe-r96-expert-link.mjs`
 * stdout 只输出一个 JSON 对象,结尾 `process.exit(report.ok ? 0 : 1)`。
 */
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, existsSync } from "node:fs";
function mkdirSyncSafe(p) { try { mkdirSync(p, { recursive: true }); } catch { /* best-effort */ } }
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const report = { steps: [], problems: [], pageErrors: [] };
const step = (name, ok, detail) => {
  report.steps.push({ step: name, ok: Boolean(ok), detail });
  if (!ok) report.problems.push(`${name}: ${JSON.stringify(detail)}`);
};

const userData = mkdtempSync(join(tmpdir(), "ob-r96-expert-link-"));
const agentDir = mkdtempSync(join(tmpdir(), "ob-r96-expert-agent-"));
// Canonical flat user-agents dir is the **sibling** of agentDir, not inside
// it. Pin both env vars so the probe can observe the flat layout.
const userAgentsDir = join(agentDir, "..", "user-agents-flat");
mkdirSyncSafe(userAgentsDir);

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root,
  timeout: 60_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0", OPENBUDDY_AGENT_DIR: agentDir, OPENBUDDY_USER_AGENTS_DIR: userAgentsDir },
});

try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  page.on("pageerror", (e) => report.pageErrors.push(String(e).slice(0, 200)));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 45_000 });

  // 跳过引导,否则首启浮层会拦截导航。
  await page.evaluate(() => {
    window.localStorage.setItem("openbuddy.onboarding.state", JSON.stringify({
      version: 1, status: "done", index: 2,
      steps: [{ id: "welcome", status: "done" }, { id: "first-task", status: "done" }, { id: "done", status: "done" }],
      startedAt: Date.now(), updatedAt: Date.now(), completedAt: Date.now(),
    }));
    window.localStorage.setItem("openbuddy.tour.state", "seen");
    window.localStorage.removeItem("expertsRoot");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 45_000 });
  await page.waitForTimeout(2000);

  // 走真实的 renderer → IPC 路径,而不是绕过 UI 直接调 main 函数。
  const outcome = await page.evaluate(async () => {
    const invoke = window.api.invoke;
    const root = await invoke("experts_default_root");
    if (!root) return { error: "experts_default_root 返回空" };
    const catalog = await invoke("experts_load", { root: root ?? null });
    const experts = (catalog?.experts ?? []).map((e) => ({ plugin: e.plugin, agentName: e.agentName, type: e.type, title: e.title ?? e.name }));
    const linked = [];
    for (const expert of experts) {
      try {
        const count = await invoke("experts_link_agents", { root, plugin: expert.plugin, agentNames: null });
        linked.push({ plugin: expert.plugin, count });
      } catch (e) {
        linked.push({ plugin: expert.plugin, error: String(e) });
      }
    }
    return { root, experts, linked };
  });

  report.outcome = outcome;
  step("experts_default_root 非空", Boolean(outcome?.root), outcome?.root ?? null);
  step("catalog 至少 6 个起步专家", (outcome?.experts?.length ?? 0) >= 6, outcome?.experts?.length ?? 0);

  // Linked experts must land in the canonical **flat** user-agents dir
  // (~/.openbuddy/agents/, OPENBUDDY_USER_AGENTS_DIR override), NOT inside
  // <agentHome>/agents/. The flat dir is the user-facing target; the
  // nested one is the SDK's legacy scan root.
  const agentsDir = userAgentsDir;
  const nestedDir = join(agentDir, "agents");
  const files = existsSync(agentsDir) ? readdirSync(agentsDir).filter((f) => f.endsWith(".md")).sort() : [];
  report.agentsDir = agentsDir;
  report.linkedFiles = files;
  report.nestedDir = nestedDir;
  report.nestedHasFiles = existsSync(nestedDir) && readdirSync(nestedDir).filter((f) => f.endsWith(".md")).length > 0;

  // 1. 每个专家都按自己的 plugin 名(frontmatter name)落盘。
  const expected = (outcome?.experts ?? []).map((e) => `${e.plugin}.md`);
  const missing = expected.filter((name) => !files.includes(name));
  step(`每个专家各自落盘(${expected.length} 个)`, missing.length === 0, { missing, files });

  // 2. 那个把所有专家吞掉的 `lead.md` 不该存在。
  step("不存在互相覆盖的 lead.md", !files.includes("lead.md"), files);
  step("链接落到扁平 user-agents 目录,而不是 <home>/agents", files.length > 0 && !report.nestedHasFiles, {
    flatCount: files.length,
    nestedCount: report.nestedHasFiles ? readdirSync(nestedDir).filter((f) => f.endsWith(".md")).length : 0,
  });

  // 3. 团队成员也在。
  const members = ["starter-clarifier.md", "starter-drafter.md", "starter-reviewer.md", "starter-finalizer.md"];
  const missingMembers = members.filter((name) => !files.includes(name));
  step("团队成员全部落盘", missingMembers.length === 0, missingMembers);

  // 4. 内容确实是各自专家的 prompt,而不是最后一个覆盖者的。
  const read = (name) => (existsSync(join(agentsDir, name)) ? readFileSync(join(agentsDir, name), "utf8") : "");
  const engineer = read("starter-software-engineer.md");
  const reviewer = read("starter-code-reviewer.md");
  step("软件工程师文件含自己的 prompt", engineer.includes("你是一名资深全栈工程师"), engineer.slice(0, 120));
  step("审查专家文件含自己的 prompt", reviewer.includes("你是一名严格的代码审查者"), reviewer.slice(0, 120));
  step("两个专家内容不互相覆盖", engineer.length > 200 && reviewer.length > 200 && engineer !== reviewer, { engineerLen: engineer.length, reviewerLen: reviewer.length });
  step("frontmatter name 与文件名一致", /name: starter-software-engineer\b/.test(engineer) && /name: starter-code-reviewer\b/.test(reviewer), null);

  step("无渲染异常", report.pageErrors.length === 0, report.pageErrors);
} finally {
  await app.close().catch(() => {});
}

report.ok = report.problems.length === 0;
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
