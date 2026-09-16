/**
 * extension-points.test.ts — 扩展点登记表的**新鲜度守卫**
 *
 * docs/EXTENSION_POINTS.md 里的 slot 表不再是手写的:它由
 * `scripts/ui-slot-audit.mjs --md` 从代码里算出来。这个单测做三件事:
 *
 * 1. **新鲜度** —— 重新跑一次生成器,与仓库里的文档逐字节比对。有人改了
 *    slot 却忘了更新文档(或手改了表格),这里立刻变红。
 * 2. **硬门槛** —— `dead`(注册了没人消费)与 `no-impl`(有人消费没人注册)
 *    必须为 0。这两类是真 bug,不是文档问题,所以卡在 CI 上。
 * 3. **契约完整性** —— 每个槽位都得有 SlotMap 声明,并且能读出 kind / scope;
 *    注册方必须是被 SlotRuntime 真正装配过的包(否则插件注册了也不会生效)。
 *
 * 为什么不直接读 md 做字符串断言:md 是产物,代码才是事实来源。读 md 的测试
 * 只能证明"文档写了什么",证明不了"产品是什么"。
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../../../..");
const REGISTRY_PATH = resolve(ROOT, "docs/EXTENSION_POINTS.md");
const AUDIT_SCRIPT = resolve(ROOT, "scripts/ui-slot-audit.mjs");
const BUILTIN_APPLIES = resolve(ROOT, "packages/ui/openbuddy-ui-runtime/src/builtin-applies.ts");

const BEGIN = "<!-- BEGIN GENERATED: extension-points -->";
const END = "<!-- END GENERATED: extension-points -->";

/**
 * 不走 `BUILTIN_UI_APPLIES` 通道的包 —— 它们由 SlotRuntime 用另一条路径装配
 * (内核自身 / 主题 / 语言 / 槽位协议),所以不能拿这张表去要求它们。
 */
const SPECIAL_CHANNEL = new Set([
  "@openbuddy-ui-slots",
  "@openbuddy-ui-runtime",
  "@openbuddy-ui-theme",
  "@openbuddy-ui-locale",
]);

interface SlotRow {
  name: string;
  kind: string;
  scope: string;
  status: "ok" | "ext" | "ext-default" | "dead" | "no-impl";
  reason: string;
  declaredBy: string[];
  declaredIn: string[];
  registeredBy: string[];
  consumedBy: string[];
}

const run = (flag: string): string =>
  execFileSync(process.execPath, [AUDIT_SCRIPT, flag], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });

let rows: SlotRow[] = [];
let generated = "";
let registry = "";

interface RendererBus {
  kinds: Array<{ name: string; consumers: string[] }>;
  unusedKinds: string[];
  slots: Array<{ name: string; consumers: string[] }>;
}

let renderer: RendererBus = { kinds: [], unusedKinds: [], slots: [] };

beforeAll(() => {
  rows = JSON.parse(run("--json")) as SlotRow[];
  renderer = JSON.parse(run("--json-renderer")) as RendererBus;
  generated = run("--md").trim();
  registry = readFileSync(REGISTRY_PATH, "utf8");
});

const docBlock = (): string => {
  const start = registry.indexOf(BEGIN);
  const end = registry.indexOf(END);
  return start >= 0 && end > start ? registry.slice(start, end + END.length) : "";
};

describe("EXTENSION_POINTS.md 登记表", () => {
  it("docs/EXTENSION_POINTS.md 存在且带生成区块标记", () => {
    expect(existsSync(REGISTRY_PATH)).toBe(true);
    expect(docBlock()).not.toBe("");
  });

  it("生成区块与 `ui-slot-audit.mjs --md` 输出逐字节一致(新鲜度)", () => {
    expect(docBlock()).toBe(generated);
  });

  it("登记表覆盖审计脚本扫到的每一个槽位", () => {
    const body = docBlock();
    for (const row of rows) {
      expect(body, `槽位 ${row.name} 没出现在登记表里`).toContain(`| \`${row.name}\` |`);
    }
    // 只数 SlotCore 那张表 —— 生成区块里还有渲染端总线的两张表(kind / 字符串槽)。
    const slotCoreSection = body.slice(
      body.indexOf("### SlotCore 槽位总表"),
      body.indexOf("### 渲染端贡献总线"),
    );
    const tableRows = slotCoreSection.match(/^\| `[a-z][^`]*` \|/gm) ?? [];
    expect(tableRows.length).toBe(rows.length);
  });

  it("契约版本号写在文档里", () => {
    expect(registry).toMatch(/version: 1/);
    expect(registry).toContain("openbuddy.plugin.v1");
  });

  it("真实存在的核心扩展点仍在登记表里", () => {
    for (const slot of ["home.scene.tab", "composer.toolbar.action"]) {
      expect(registry, `${slot} 从登记表里消失了`).toContain(`| \`${slot}\` |`);
    }
  });

  it("幽灵槽位不会被重新登记进表体", () => {
    // 这四个名字在代码里从来不存在(R31 从手写登记表里查出来的)。它们只能出现在
    // 文档的「已被移除的幽灵槽位」章节里解释清楚,绝不能再出现在表体 ——
    // 否则插件作者会去注册一个永远不生效的槽,而且没有任何报错。
    const body = docBlock();
    for (const ghost of ["message.toolcall.card", "sidebar.nav.item", "workbench.tab", "settings.page"]) {
      expect(body, `${ghost} 又回到了表体里`).not.toContain(`| \`${ghost}\` |`);
      expect(registry, `${ghost} 应该有"已移除"的说明`).toContain(ghost);
    }
  });
});

describe("渲染端贡献总线(第二条总线)", () => {
  it("renderer-host 声明的 contribution kind 全部有人消费", () => {
    expect(renderer.kinds.length).toBeGreaterThan(0);
    expect(renderer.unusedKinds, `没人消费的 kind:${renderer.unusedKinds.join(", ")}`).toEqual([]);
  });

  it("第二条总线的两张表都进了登记表", () => {
    const body = docBlock();
    expect(body).toContain("### 渲染端贡献总线");
    for (const kind of renderer.kinds) {
      expect(body, `kind ${kind.name} 没进登记表`).toContain(`| \`${kind.name}\` |`);
    }
    for (const slot of renderer.slots) {
      expect(body, `renderer 槽 ${slot.name} 没进登记表`).toContain(`| \`${slot.name}\` |`);
    }
  });
});

describe("槽位健康度硬门槛", () => {
  it("没有 dead 槽位(注册了却没人消费 → 能力对用户不可见)", () => {
    const dead = rows.filter((r) => r.status === "dead").map((r) => r.name);
    expect(dead, `dead 槽位:${dead.join(", ")}`).toEqual([]);
  });

  it("没有 no-impl 槽位(有人消费却没注册 → 插件替换收益为 0)", () => {
    const noImpl = rows.filter((r) => r.status === "no-impl").map((r) => r.name);
    expect(noImpl, `no-impl 槽位:${noImpl.join(", ")}`).toEqual([]);
  });

  it("每个槽位都有 kind 与 scope", () => {
    const gaps = rows.filter((r) => r.kind === "—" || r.scope === "—").map((r) => r.name);
    expect(gaps, `缺 kind/scope:${gaps.join(", ")}`).toEqual([]);
    for (const row of rows) {
      expect(["single", "list", "keyed", "chain"]).toContain(row.kind);
      expect(["root", "session", "session-maybe"]).toContain(row.scope);
    }
  });

  it("每个槽位都在某个 SlotMap 里声明过(声明权 = 契约所有权)", () => {
    const undeclared = rows.filter((r) => r.declaredBy.length === 0).map((r) => r.name);
    expect(undeclared, `未声明槽位:${undeclared.join(", ")}`).toEqual([]);
  });

  it("每个注册方都被 SlotRuntime 真正装配过", () => {
    const applies = readFileSync(BUILTIN_APPLIES, "utf8");
    const orphans = new Set<string>();
    for (const row of rows) {
      for (const pkg of row.registeredBy) {
        if (pkg === "app(src)" || pkg === "host" || SPECIAL_CHANNEL.has(pkg)) continue;
        if (!applies.includes(pkg)) orphans.add(pkg);
      }
    }
    expect([...orphans], `注册方没在 BUILTIN_UI_APPLIES 里:${[...orphans].join(", ")}`).toEqual([]);
  });
});
