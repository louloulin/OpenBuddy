/**
 * 槽位三态审计的守卫(R95)。
 *
 * 为什么把它放进 CI:
 *   `scripts/ui-slot-coverage.mjs` 的价值在于**回归可见**。槽位是"微内核 +
 *   插件"的接口面,而它的三种状态(声明 / 注册 / 消费)分散在不同文件,
 *   没有编译器能同时看到。一旦有人在 `SlotMap` 里加 key 却忘了注册,或在
 *   组件里 `useSlotComponent("x.y")` 却忘了声明,只有静态扫描能发现。
 *
 * 本测试断言的是**单调不回退**,而不是具体数字:
 *   - 类型漏洞必须为 0(用了却没声明 = 类型系统失效,永远是 bug)
 *   - 三态齐备的槽位数不得低于当前基线(防止重构顺手删掉接线)
 *   - 注册率 / 消费率不得低于基线
 *
 * 数字**只许上调**。要下调必须在 PR 里显式改这个基线文件,并在描述里说明
 * 为什么减少接线是合理的。
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const report = JSON.parse(
  execFileSync("node", [join(repoRoot, "scripts", "ui-slot-coverage.mjs"), "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }),
);

/**
 * 基线 —— R95 实测值。只许上调。
 *
 * 注意 `consumedPct` 从 70 变成 85 不是"接线变多了",而是**审计本身修了一个
 * 假阴性**:消费点写作 `useSlotComponent<ComponentType<Record<string, unknown>>>("x.y", …)`,
 * 泛型里有两层 `>`,旧正则要求 `(` 紧跟函数名,于是**所有带泛型的消费点都被
 * 漏掉**(onboarding.* 全系列),审计把"真有人消费"误报成"注册了也不会渲染"。
 * 这类假阴性最危险的地方是它会直接误导改造优先级 —— 看起来没人用的槽位,
 * 其实已经在渲染。
 */
const BASELINE = {
  declared: 64,
  wired: 45,
  registeredPct: 77,
  consumedPct: 85,
};

describe("槽位三态审计", () => {
  it("没有类型漏洞:注册/消费的槽位都声明过", () => {
    expect(
      report.typeHoles,
      `这些槽位被注册或消费但不在 SlotMap 里 —— 类型系统看不见它们:\n${report.typeHoles.join("\n")}`,
    ).toEqual([]);
  });

  it("三态齐备的槽位数不低于基线", () => {
    expect(report.totals.wired).toBeGreaterThanOrEqual(BASELINE.wired);
  });

  it("声明总数不低于基线(槽位契约没有缩水)", () => {
    expect(report.totals.declared).toBeGreaterThanOrEqual(BASELINE.declared);
  });

  it("注册率与消费率不低于基线", () => {
    expect(report.coverage.registeredPct).toBeGreaterThanOrEqual(BASELINE.registeredPct);
    expect(report.coverage.consumedPct).toBeGreaterThanOrEqual(BASELINE.consumedPct);
  });

  it("带泛型实参的消费点必须被算作消费(修过的假阴性,不许回退)", () => {
    // `useSlotComponent<ComponentType<Record<string, unknown>>>("onboarding.data-dir", …)`
    // 曾经因为泛型里有两层 `>` 而漏判。这几个槽位是那次修复的直接证据。
    const genericsWitnesses = ["onboarding.data-dir", "onboarding.feedback", "onboarding.whats-new", "onboarding.wizard"];
    const stillMissed = genericsWitnesses.filter(
      (key) => report.wired.includes(key) === false && report.declaredNotConsumed.includes(key),
    );
    expect(
      stillMissed,
      `这些槽位有带泛型的消费点,却被判成"没人消费" —— 泛型解析回退了:\n${stillMissed.join("\n")}`,
    ).toEqual([]);
  });

  it("声明了但没人注册的清单是显式已知的(新增必须在这里出现)", () => {
    // 这些槽位是**有意的插件扩展点**:内置实现走组件兜底,插件可以覆盖。
    // 把它们列出来是为了让"新增一个没人注册的声明"变成一次有意识的决定。
    const KNOWN_UNREGISTERED = new Set([
      "composer.toolbar.action",
      "conversation.body",
      "conversation.composer",
      "conversation.message.markdown",
      "conversation.toolside",
      "editor.mention-sources",
      "editor.slash-commands",
      "editor.toolbar",
      "experts.panel",
      "home.page",
      "home.practice-cases",
      "home.scene-tabs",
      "home.scene.tab",
      "modules.marketplace",
      "modules.marketplace.item",
    ]);
    const unexpected = report.declaredOnly.filter((key) => !KNOWN_UNREGISTERED.has(key));
    expect(unexpected, `新增了未注册的槽位声明,请确认是有意的扩展点:\n${unexpected.join("\n")}`).toEqual([]);
  });
});
