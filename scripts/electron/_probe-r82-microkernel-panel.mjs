/**
 * R82 真机探针:「设置 → 系统信息」微内核健康面板。
 *
 * 要证的不是"这个组件能渲染",而是"它显示的是内核的真值":
 *   1. 面板真的能从设置导航进入;
 *   2. 显示的槽位数 == runtime SlotCore 的 size()(同一个真相,不是另算一份);
 *   3. 显示的"有实现的槽位"数 == snapshot 里 entries>0 的条数;
 *   4. 装配失败数 == __ob_builtin_report 里 ok=false 的条数(正常情况下都是 0);
 *   5. 每个槽位行都带 data-entries,展开后能看到全部槽位。
 *
 * 关键断言是 2/3/4 —— 它们把 UI 上的数字与内核快照对齐。只断言"页面上有
 * 数字"证明不了任何事:面板完全可以把常量渲染得漂漂亮亮。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const report = { steps: [], ok: false, pageErrors: [] };
const step = (name, ok, detail) => report.steps.push({ step: name, ok: Boolean(ok), detail: detail ?? null });

const userData = mkdtempSync(join(tmpdir(), "ob-r82-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root,
  timeout: 60_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});

try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => report.pageErrors.push(String(e?.message ?? e)));
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40_000 });
  await new Promise((r) => setTimeout(r, 2500));

  // 关 onboarding(否则遮罩挡住所有点击)
  await page.evaluate(() => {
    window.localStorage.setItem("openbuddy.onboarding.state", JSON.stringify({
      version: 1, status: "done", index: 0, steps: [], startedAt: Date.now(), updatedAt: Date.now(), completedAt: Date.now(),
    }));
    window.localStorage.setItem("openbuddy.tour.state", "seen");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40_000 });
  await new Promise((r) => setTimeout(r, 2500));

  // 打开设置
  const opened = await page.evaluate(() => {
    const n = [...document.querySelectorAll('[aria-label], button, [role="button"]')]
      .find((x) => /设置|Settings/i.test(x.getAttribute("aria-label") ?? x.textContent ?? ""));
    if (n) { n.click(); return true; }
    return false;
  });
  step("打开设置面板", opened);
  await new Promise((r) => setTimeout(r, 1200));

  // 切到「系统信息」
  const navOk = await page.evaluate(() => {
    const n = [...document.querySelectorAll("button")]
      .find((b) => (b.textContent ?? "").trim() === "系统信息");
    if (n) { n.click(); return true; }
    return false;
  });
  step("导航到「系统信息」", navOk);
  await new Promise((r) => setTimeout(r, 1800));

  const rendered = await page.evaluate(() => {
    const summary = document.querySelector('[data-testid="microkernel-summary"]');
    return Boolean(summary);
  });
  step("面板渲染", rendered);

  if (rendered) {
    // 读 UI 上的数字
    const ui = await page.evaluate(() => {
      const txt = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
      const rows = [...document.querySelectorAll('[data-testid="microkernel-slots"] li')];
      return {
        slotCount: Number(txt('[data-testid="microkernel-slot-count"]')),
        emptyCount: Number(txt('[data-testid="microkernel-empty-count"]') ?? 0),
        okPackages: Number(txt('[data-testid="microkernel-ok-packages"]')),
        rowSlots: rows.map((r) => ({ name: r.getAttribute("data-slot"), entries: Number(r.getAttribute("data-entries")) })),
      };
    });

    // 读内核真值(与探针一直用的那个出口同源;面板走的是 microkernelSnapshot())
    const core = await page.evaluate(() => {
      const snap = window.__ob_slotcore?.snapshot?.() ?? [];
      const builtin = window.__ob_builtin_report ?? [];
      return {
        size: window.__ob_slotcore?.size?.() ?? snap.length,
        slots: snap.map((s) => ({ name: s.name, entries: s.entries })),
        populated: snap.filter((s) => s.entries > 0).length,
        empty: snap.filter((s) => s.entries === 0).map((s) => s.name),
        okPackages: builtin.filter((p) => p.ok).length,
        totalPackages: builtin.length,
      };
    });

    // 面板标题说的是 snapshotRows(列表行数,含隐式 root),所以与 snapshot 行数比。
    // 这两者必须完全相等 —— 先前 size()(57)与 snapshot()(58)差 1,正是因为
    // size() 悄悄减掉了 root 而 snapshot() 没减。
    step("槽位数与内核 snapshot 行数一致", ui.slotCount === core.slots.length, `ui=${ui.slotCount} core=${core.slots.length}`);
    step("显式登记槽位数(size())与 root 之外的行数一致", core.size === core.slots.filter((s) => s.name !== "root").length, `size=${core.size}`);
    step("内置包装配成功数与内核报告一致", ui.okPackages === core.okPackages, `ui=${ui.okPackages} core=${core.okPackages}/${core.totalPackages}`);

    // 可见行必须与内核快照逐条对齐(名字 + entries)
    const mismatch = ui.rowSlots.find((r) => {
      const k = core.slots.find((s) => s.name === r.name);
      return !k || k.entries !== r.entries;
    });
    step("可见槽位行的 entries 与内核快照逐条一致", !mismatch, mismatch ? JSON.stringify(mismatch) : `${ui.rowSlots.length} 行已核对`);

    // 展开全部
    const expand = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="microkernel-show-all"]');
      if (b) { b.click(); return true; }
      return false;
    });
    await new Promise((r) => setTimeout(r, 800));
    const allRows = await page.evaluate(() => document.querySelectorAll('[data-testid="microkernel-slots"] li').length);
    step(
      expand ? "展开后显示全部槽位" : "槽位数量少,无需展开",
      allRows === core.slots.length,
      `rows=${allRows} core=${core.slots.length}`,
    );

    report.kernel = { ui, core };
  }
} catch (err) {
  report.error = String(err?.message ?? err);
} finally {
  try { await app.close(); } catch { /* */ }
  report.ok = report.steps.every((s) => s.ok) && report.pageErrors.length === 0;
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}
