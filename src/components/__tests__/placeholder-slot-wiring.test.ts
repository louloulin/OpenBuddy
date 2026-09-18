/**
 * 槽位接线守卫 —— 每个注册出去的 `placeholder.*` / 面板槽位,必须真的有消费方。
 *
 * 背景(R92):`ExpertsTab` 之外的十几个页面在 shell 里是**直接 import 渲染**
 * 的,而对应的 `placeholder.*` 槽位只被 `ui-files` / `ui-email` / `ui-mcp` /
 * `ui-billing` / `ui-collaboration` 注册、从来没人渲染。结果是「插件注册成功了
 * 但界面永远不变」——微内核的替换能力名存实亡。
 *
 * 这条测试用源码扫描把不变式钉死:凡是某个 `client.tsx` 注册了
 * `placeholder.X`,就必须能在 `src/` 里找到 `useSlotComponent("placeholder.X", ...)`。
 * 新增页面时忘记接线会立刻红。
 *
 * 唯一豁免:shell 目前通过 `placeholder.library` 与 `experts.panel` 消费,
 * 而 `overlay.*` / `files.tree` / `editor.*` / `workbench.preview.*` 等由
 * 别的消费者负责(它们已在各自模块的测试里覆盖),所以这里只守 `placeholder.*`。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SKIP = new Set(["node_modules", "out", "dist", ".turbo", ".git", "coverage", "__tests__"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Slots that a `client.tsx` registers, plus where they were registered. */
function registeredPlaceholderSlots(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of walk(join(ROOT, "packages", "ui"))) {
    if (!/\/client\.tsx?$/.test(file)) continue;
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/name:\s*["'`](placeholder\.[a-z0-9.-]+)["'`]/g)) {
      found.set(match[1], file.replace(`${ROOT}/`, ""));
    }
  }
  return found;
}

/** Slots that something actually asks the kernel for. Walks both `src/` and
 *  `packages/ui/**` so a package can self-consume its own registered slot (a
 *  legit pattern: a panel exposes a sub-area that plugins can override). The
 *  walker still excludes `client.tsx` (that's where slots are registered, not
 *  consumed) and `__tests__`. */
function consumedSlots(): Set<string> {
  const consumed = new Set<string>();
  const roots = [join(ROOT, "src"), join(ROOT, "packages", "ui")];
  for (const root of roots) {
    for (const file of walk(root)) {
      if (/\/client\.tsx?$/.test(file)) continue;
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/useSlotComponents?\(\s*["'`]([a-zA-Z0-9._:-]+)["'`]/g)) {
        consumed.add(match[1]);
      }
    }
  }
  return consumed;
}

describe("微内核槽位接线守卫 (R92)", () => {
  it("扫描面不为空(否则说明 walk 或正则坏了)", () => {
    expect(registeredPlaceholderSlots().size).toBeGreaterThanOrEqual(10);
    expect(consumedSlots().size).toBeGreaterThanOrEqual(10);
  });

  it("每个注册出去的 placeholder.* 槽都有消费方", () => {
    const consumed = consumedSlots();
    const orphans = [...registeredPlaceholderSlots().entries()]
      .filter(([slot]) => !consumed.has(slot))
      .map(([slot, file]) => `${slot}  (registered in ${file})`)
      .sort();
    expect(
      orphans,
      `以下槽位注册了但没有任何消费方 —— 插件能注册成功但界面不会变:\n  ${orphans.join("\n  ")}`,
    ).toEqual([]);
  });

  it("已接线的页面走 useSlotComponent,不再裸渲染内置组件", () => {
    // 抽样验明接线方式:这些页面必须是 `<XxxSlot ...>` 而不是 `<XxxPanel ...>`。
    const shell = readFileSync(join(ROOT, "src/components/shared/PlaceholderPage.tsx"), "utf8");
    for (const slotVar of ["EmailSlot", "ProjectsSlot", "MyFilesSlot", "KnowledgeBaseSlot", "CloudStorageSlot", "DiscoverSlot", "NotifyChannelsSlot", "UsageQuotaSlot"]) {
      expect(shell, `${slotVar} 应当被渲染`).toMatch(new RegExp(`<${slotVar}[\\s/>]`));
    }
    // 反向:被替换掉的内置组件不应再出现在 JSX 里(import 保留作为 fallback)。
    for (const bare of ["<EmailPanel ", "<ProjectsPanel ", "<MyFilesPanel ", "<KnowledgeBasePanel ", "<CloudStoragePanel ", "<DiscoverPanel ", "<NotifyChannelsPanel ", "<UsageQuotaPanel "]) {
      expect(shell, `${bare} 应已改走槽位`).not.toContain(bare);
    }
  });
});
