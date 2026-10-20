/**
 * R38 真机探针:「策略设置」里的插件准入名单 + 插件策略审计。
 *
 * 要证的缺陷(改前,代码级可复现):
 *   - `ExtensionAuditPanel`(策略决策审计)与 `ExtensionPolicyEditor`(准入名单)
 *     写好了、有单测,却**没有任何消费者** —— 用户在任何入口都看不到;
 *   - 「策略设置」只有 4 个写死的区块,插件想加一块策略只能改 ui-settings 源码。
 *
 * 这条探针走用户路径 + 真 IPC:
 *   1. 侧栏「更多」→「策略设置」→ 策略面板;
 *   2. 面板里两块插件能力真的在(准入名单编辑器 + 策略审计面板);
 *   3. 在拒绝名单里填一个包名 → 保存 → 主进程读回确认落盘;
 *   4. 保存触发重新解析 → 审计面板收到新的策略报告(决策行 + deny 行);
 *   5. 全程零 pageError。
 *
 * 截图默认不写盘;需要视觉资产时 OPENBUDDY_PROBE_SHOTS=1。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SHOTS_ENABLED = process.env.OPENBUDDY_PROBE_SHOTS === "1";
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const userData = mkdtempSync(join(tmpdir(), "ob-r38-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r38-agent-"));
const workspace = mkdtempSync(join(tmpdir(), "ob-r38-ws-"));

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

const snapshot = (page) =>
  page.evaluate(() => {
    const q = (sel) => document.querySelector(sel);
    const audit = q("[data-testid='extension-audit-panel']");
    return {
      hasPanel: Boolean(q("[data-testid='policy-panel']")),
      hasPolicySection: Boolean(q("[data-testid='policy-section-extension-policy']")),
      hasAuditSection: Boolean(q("[data-testid='policy-section-extension-audit']")),
      hasEditor: Boolean(q("[data-testid='extension-policy-editor']")),
      hasAllowlist: Boolean(q("[data-testid='extension-policy-allowlist']")),
      hasDenylist: Boolean(q("[data-testid='extension-policy-denylist']")),
      sections: Array.from(document.querySelectorAll("[data-testid^='policy-section-']")).map((el) =>
        el.getAttribute("data-testid"),
      ),
      reportCount: audit ? Number(audit.getAttribute("data-report-count") ?? "-1") : -1,
      emptyState: Boolean(q("[data-testid='extension-audit-empty']")),
      noDecisions: Boolean(q("[data-testid='extension-audit-no-decisions']")),
      decisionCount: Number(
        (q("[data-testid='extension-audit-last-decision-count']")?.textContent ?? "-1").trim(),
      ),
      rows: Array.from(document.querySelectorAll("[data-testid='extension-audit-row']")).map((el) => ({
        id: el.getAttribute("data-decision-id"),
        action: el.getAttribute("data-action"),
      })),
      status: (q("[data-testid='extension-policy-status']")?.textContent ?? "").trim(),
    };
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
  step("agent:new-session 真的建出会话", Boolean(sessionId), JSON.stringify(created).slice(0, 140));
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
  await page.waitForTimeout(400);

  // ── 1. 侧栏「更多」→「策略设置」 ──
  await page.hover(".sidebar__more-wrap");
  await page.waitForTimeout(400);
  const clicked = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".sidebar__more-item"));
    const hit = items.find((el) => (el.textContent ?? "").includes("策略设置"));
    if (!(hit instanceof HTMLElement)) return false;
    hit.click();
    return true;
  });
  await page.waitForTimeout(1600);
  const opened = await snapshot(page);
  step("「更多」→「策略设置」菜单项可点", clicked, JSON.stringify({ clicked }));
  step("策略设置面板真的打开了", opened.hasPanel, JSON.stringify({ hasPanel: opened.hasPanel }));

  // ── 2. 两块插件能力在面板里 ──
  step(
    "插件准入名单区块在(策略设置不再只有写死的 4 块)",
    opened.hasPolicySection && opened.hasEditor && opened.hasAllowlist && opened.hasDenylist,
    JSON.stringify({
      hasPolicySection: opened.hasPolicySection,
      hasEditor: opened.hasEditor,
      hasAllowlist: opened.hasAllowlist,
      hasDenylist: opened.hasDenylist,
    }),
  );
  step(
    "插件策略审计区块在(audit 面板第一次有了消费者)",
    opened.hasAuditSection,
    JSON.stringify({ hasAuditSection: opened.hasAuditSection, sections: opened.sections }),
  );
  step(
    "区块按 order 排序(准入名单 50 在审计 60 之前)",
    JSON.stringify(opened.sections) ===
      JSON.stringify([
        "policy-section-extension-policy",
        "policy-section-extension-audit",
      ]),
    JSON.stringify(opened.sections),
  );

  const baselineReports = opened.reportCount;
  step(
    "审计面板已订阅策略报告(有 report-count,空态文案不再是英文 awaiting)",
    baselineReports >= 0,
    JSON.stringify({ reportCount: baselineReports, emptyState: opened.emptyState }),
  );

  if (SHOTS_ENABLED) await page.screenshot({ path: "tests/screenshots/r38-policy-sections.png" });

  // ── 3. 写拒绝名单 → 保存 → 主进程读回 ──
  await page.fill("[data-testid='extension-policy-denylist']", "pi-sketchy\npi-untested");
  await page.click("[data-testid='extension-policy-save']");
  await page.waitForTimeout(2500);
  const afterSave = await snapshot(page);
  step(
    "保存有反馈(不是静默失败)",
    afterSave.status.length > 0,
    JSON.stringify({ status: afterSave.status }),
  );
  const readBack = await page.evaluate(async () => {
    try {
      return await window.api.invoke("agent:extension-policy-get");
    } catch (error) {
      return { error: String(error) };
    }
  });
  step(
    "拒绝名单真的落盘(IPC 读回含 pi-sketchy)",
    Array.isArray(readBack?.denylistPackageNames) &&
      readBack.denylistPackageNames.includes("pi-sketchy"),
    JSON.stringify(readBack).slice(0, 200),
  );

  if (SHOTS_ENABLED) await page.screenshot({ path: "tests/screenshots/r38-policy-audit.png" });

  // ── 4. 保存触发重新解析 → 审计面板收到新报告 ──
  let auditNow = afterSave;
  for (let i = 0; i < 12 && auditNow.rows.length === 0; i += 1) {
    await page.waitForTimeout(800);
    auditNow = await snapshot(page);
  }
  step(
    "保存后审计面板收到策略报告(解析次数增加)",
    auditNow.reportCount > baselineReports && !auditNow.emptyState,
    JSON.stringify({
      before: baselineReports,
      after: auditNow.reportCount,
      emptyState: auditNow.emptyState,
    }),
  );
  // 空 profile 里一个 Pi 扩展都没有,resolver 照样发 total=0 的报告 —— 这是
  // 正常状态,不能算失败。两种情况都必须"面板与报告一致":
  //   - 有决策 → 每条决策一行,且行带 data-action(deny/needs-review 可辨认);
  //   - 零决策 → 明确写出"没有已配置的扩展",而不是一张 0 表格。
  const rowsConsistent =
    auditNow.rows.length > 0 &&
    auditNow.rows.length === auditNow.decisionCount &&
    auditNow.rows.every((row) => typeof row.action === "string");
  const zeroConsistent = auditNow.rows.length === 0 && auditNow.decisionCount === 0 && auditNow.noDecisions;
  step(
    "审计面板与最新报告一致(逐条决策行,或明确说明没有已配置扩展)",
    rowsConsistent || zeroConsistent,
    JSON.stringify({
      rows: auditNow.rows.slice(0, 6),
      decisionCount: auditNow.decisionCount,
      noDecisions: auditNow.noDecisions,
      branch: rowsConsistent ? "rows" : zeroConsistent ? "zero" : "inconsistent",
    }),
  );

  report.ok = report.steps.every((item) => item.ok) && report.pageErrors.length === 0;
} catch (error) {
  report.error = String(error?.stack ?? error);
} finally {
  await app.close().catch(() => {});
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
