/**
 * _probe-plugin-command.mjs — ⌘K 命令面板 × 插件命令 的真实 Electron 端到端探针。
 *
 * 断言的是「插件注册的命令用户真的能用」,而不是从内核快照反推:
 *   1. 派发 Plugin SDK 的 `openbuddy:register-command` 事件
 *   2. ⌘K 打开搜索面板 → 命令分组出现,label 是插件给的那一份
 *   3. 输入 `/greet Alice` → 只剩匹配的命令
 *   4. 回车 → 插件回调拿到 args,面板关闭
 *
 * 输出单个 JSON 对象到 stdout,由 _probe-plugin-command.test.mjs 消费。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-cmdk-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron"),
  cwd: ROOT,
  timeout: 40_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "1" },
});

const pageErrors = [];
const page = await app.firstWindow({ timeout: 60_000 });
page.on("pageerror", (err) => pageErrors.push(String(err.message)));
await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30_000 });
await page.waitForTimeout(4000);
await page.setViewportSize({ width: 1440, height: 900 });

const report = { };

// 1) 模拟一个第三方插件用 Plugin SDK 注册命令(走真实的 DOM 事件路径)
report.registered = await page.evaluate(() => {
  window.__ob_cmd_calls = [];
  for (const id of ["greet", "tidy-workspace"]) {
    window.dispatchEvent(
      new CustomEvent("openbuddy:register-command", {
        detail: {
          id,
          label: id === "greet" ? "/greet — 输出问候" : "整理工作区",
          onExecute: (ctx) => window.__ob_cmd_calls.push({ id, args: ctx?.args ?? null }),
        },
      }),
    );
  }
  const snap = window.__ob_slotcore?.snapshot?.() ?? [];
  const entry = snap.find((s) => s.name === "plugin.command");
  return { slotEntries: entry?.entries ?? 0, registrants: entry?.registrants ?? [] };
});

// 2) ⌘K 打开面板
await page.keyboard.press("Meta+k");
await page.waitForTimeout(600);
const readPanel = () =>
  page.evaluate(() => {
    const modal = document.querySelector(".conversation-search-modal");
    const counts = Array.from(document.querySelectorAll(".conversation-search-modal__count")).map((el) =>
      (el.textContent || "").trim(),
    );
    const items = Array.from(document.querySelectorAll(".conversation-search-modal__item-title")).map((el) =>
      (el.textContent || "").trim(),
    );
    const input = document.querySelector(".conversation-search-modal__input");
    return {
      open: Boolean(modal),
      placeholder: input?.getAttribute("placeholder") ?? null,
      counts,
      items,
    };
  });

report.opened = await readPanel();

// 3) `/greet Alice` → 只剩匹配命令
await page.keyboard.type("/greet Alice");
await page.waitForTimeout(400);
report.filtered = await readPanel();

// 4) 回车执行
await page.keyboard.press("Enter");
await page.waitForTimeout(500);
report.afterEnter = await page.evaluate(() => ({
  calls: window.__ob_cmd_calls ?? [],
  panelOpen: Boolean(document.querySelector(".conversation-search-modal")),
}));

// 5) Composer 的 `/` 菜单:插件命令也要出现在里面,并在发送路径上执行
await page.evaluate(() => {
  document.querySelector(".conversation-search-modal__close")?.click();
});
await page.waitForTimeout(500);
report.composer = await page.evaluate(() => {
  const textarea = document.querySelector(".wb-composer__input, textarea");
  return { hasComposer: Boolean(textarea) };
});
if (report.composer.hasComposer) {
  await page.evaluate(() => {
    const textarea = document.querySelector(".wb-composer__input, textarea");
    textarea.focus();
  });
  await page.keyboard.type("/gre");
  await page.waitForTimeout(600);
  report.composerPicker = await page.evaluate(() => {
    const menu = document.querySelector(".slash-commands");
    return {
      open: Boolean(menu),
      names: Array.from(document.querySelectorAll(".slash-commands__name")).map((el) =>
        (el.textContent || "").trim(),
      ),
    };
  });
  await page.keyboard.type("et ComposerArgs");
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  report.composerSend = await page.evaluate(() => ({
    calls: window.__ob_cmd_calls ?? [],
    inputValue: document.querySelector(".wb-composer__input, textarea")?.value ?? null,
  }));
}

report.pageErrors = pageErrors;
console.log(JSON.stringify(report));
await app.close();
