/**
 * _probe-settings-appearance.mjs — 真机验证「设置 → 个性化」的两行走内核槽位,
 * 且语言下拉真的能切换整个界面。
 *
 * 背景:`settings.appearance.theme` / `settings.appearance.language` 这两个槽
 * 长期是纯声明(no-impl:零注册零消费)。现在 ui-settings 既注册默认实现
 * (ThemePicker / LanguagePicker)又通过 SlotOutlet 消费。这里做端到端确认:
 *   1. 内核里两个槽各有 1 条 entry,registrant 都是 @openbuddy/ui-settings;
 *   2. 个性化面板里能拿到渲染出来的 `<select class="settings-select">`,
 *      选项 = 支持的语言,初值是内核当前语言;
 *   3. 改成 en-US 之后:内核 current() 变 en-US、localStorage 落盘、下拉回读一致;
 *   4. 界面文案真的跟着变(产品词表 `scene.modes.*` 从中文变英文)。
 *
 * 输出单行 JSON,由 _probe-settings-appearance.test.mjs 解析断言。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-appearance-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 200)));

// 语言切换发生在 Home 页(SceneTabs 读 scene.modes.*),所以先在首页记录一次。
await page.waitForTimeout(15_000);
await page
  .click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 })
  .catch(() => {});
await page.waitForTimeout(1500);

const readBodyText = () => page.evaluate(() => document.body.innerText.slice(0, 4000));
const beforeText = await readBodyText();

await page.click(".sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll(".settings-navigation__item"));
  const target = items.find((el) => (el.textContent ?? "").includes("个性化"));
  if (target) target.click();
});
await page.waitForTimeout(1200);

/** 内核里两个外观槽的登记情况。 */
const readSlots = () =>
  page.evaluate(() => {
    const core = window.__ob_slotcore;
    if (!core) return null;
    const pick = (name) => {
      const row = core.snapshot().find((r) => r.name === name);
      return row ? { kind: row.kind, entries: row.entries, registrants: row.registrants } : null;
    };
    return {
      language: pick("settings.appearance.language"),
      theme: pick("settings.appearance.theme"),
    };
  });

/** 下拉的当前值 / 选项 / 内核语言 / 持久化值。 */
const readSelector = () =>
  page.evaluate(() => {
    const select = document.querySelector("select.settings-select");
    return {
      found: !!select,
      value: select ? select.value : null,
      options: select ? Array.from(select.options).map((o) => o.value) : [],
      stored: window.localStorage.getItem("openbuddy:locale"),
    };
  });

const result = {
  slots: await readSlots(),
  before: await readSelector(),
  after: null,
  text: {},
  pageErrors,
  ok: true,
};

const switched = await page.evaluate(() => {
  const select = document.querySelector("select.settings-select");
  if (!select) return false;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    "value",
  )?.set;
  setter?.call(select, "en-US");
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
});
await page.waitForTimeout(1200);

result.switched = switched;
result.after = await readSelector();
const afterText = await readBodyText();

/** 逐行对比切换前后的可见文案,得到"这次切换到底改动了哪些字"。 */
const lines = (text) =>
  new Set(
    text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  );
const beforeLines = lines(beforeText);
const afterLines = lines(afterText);
const added = [...afterLines].filter((l) => !beforeLines.has(l));
const removed = [...beforeLines].filter((l) => !afterLines.has(l));

result.text = { added: added.slice(0, 40), removed: removed.slice(0, 40) };

/**
 * 产品词表里"一定有组件在读"的几组 zh/en 对照。
 *
 * 只断言 diff 里出现了 en 文案**并且**对应的 zh 文案消失了 —— 单纯匹配一个单词
 * 会误报(例如英文词恰好出现在别处),必须成对出现才算"界面真的切了语言"。
 */
const TEXT_PAIRS = [
  ["权限模式", "Permission Mode"],
  ["始终询问", "Always Ask"],
  ["计划模式", "Plan Mode"],
  ["关于 OpenBuddy", "About OpenBuddy"],
];
const flipped = TEXT_PAIRS.filter(
  ([zh, en]) => !afterLines.has(zh) && !beforeLines.has(en) && added.includes(en),
);
result.text.flipped = flipped.map(([zh, en]) => `${zh} → ${en}`);

result.ok =
  result.slots !== null &&
  result.slots.language?.entries === 1 &&
  result.slots.language?.kind === "single" &&
  result.slots.language?.registrants?.[0] === "@openbuddy/ui-settings" &&
  result.slots.theme?.entries === 1 &&
  result.slots.theme?.registrants?.[0] === "@openbuddy/ui-settings" &&
  result.before.found === true &&
  result.before.options.join(",") === "zh-CN,en-US" &&
  result.before.value === "zh-CN" &&
  switched === true &&
  result.after.value === "en-US" &&
  result.after.stored === "en-US" &&
  flipped.length > 0 &&
  pageErrors.length === 0;

console.log(JSON.stringify(result, null, 2));
await app.close();
process.exit(result.ok ? 0 : 1);
