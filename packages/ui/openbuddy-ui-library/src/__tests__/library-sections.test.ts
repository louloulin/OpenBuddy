/**
 * 资料库分区契约 —— 纯函数层。
 *
 * 锁死两件容易悄悄坏掉的事:
 *   1. 内置 4 个分区的 id / 图标 id / 排序是**稳定契约**(深链 `initialSection`
 *      与插件"顶掉某个内置分区"都依赖 id 不变);
 *   2. `readLibrarySectionMeta` 只认 `defineLibrarySection` 的产物 ——
 *      没有元数据的函数组件必须被静默跳过,而不是画出没有名字的导航项。
 */
import { describe, expect, it } from "vitest";
import {
  LIBRARY_SECTION_IDS,
  defineLibrarySection,
  readLibrarySectionMeta,
  type LibrarySectionIconId,
} from "../section-contract";
import { LIBRARY_SECTIONS } from "../sections";

const ICON_IDS: readonly LibrarySectionIconId[] = [
  "files",
  "artifacts",
  "knowledge",
  "cloud",
  "inspiration",
  "generic",
];

describe("内置资料库分区", () => {
  it("恰好 4 个分区,且 id 与 LIBRARY_SECTION_IDS 一致", () => {
    expect(LIBRARY_SECTIONS.map((s) => s.librarySection.id)).toEqual([
      LIBRARY_SECTION_IDS.files,
      LIBRARY_SECTION_IDS.knowledge,
      LIBRARY_SECTION_IDS.cloud,
      LIBRARY_SECTION_IDS.inspiration,
    ]);
  });

  it("每个分区都有 label、合法 icon id 与唯一 order", () => {
    const orders = new Set<number>();
    for (const Section of LIBRARY_SECTIONS) {
      const meta = Section.librarySection;
      expect(meta.label.length).toBeGreaterThan(0);
      expect(ICON_IDS).toContain(meta.icon);
      expect(orders.has(meta.order ?? 0)).toBe(false);
      orders.add(meta.order ?? 0);
    }
  });

  it("order 严格递增 —— 导航列顺序不依赖注册顺序", () => {
    const orders = LIBRARY_SECTIONS.map((s) => s.librarySection.order ?? 0);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it("「灵感」是资料库的一个分区(空壳入口不再是死页面)", () => {
    const inspiration = LIBRARY_SECTIONS.find(
      (s) => s.librarySection.id === LIBRARY_SECTION_IDS.inspiration,
    );
    expect(inspiration?.librarySection.icon).toBe("inspiration");
  });
});

describe("defineLibrarySection / readLibrarySectionMeta", () => {
  it("原样返回组件本身并挂上元数据(槽位里仍然是组件)", () => {
    const Inner = () => null;
    const Section = defineLibrarySection(
      { id: "x", label: "X", icon: "generic", order: 1 },
      Inner,
    );
    expect(Section).toBe(Inner);
    expect(readLibrarySectionMeta(Section)).toEqual({
      id: "x",
      label: "X",
      icon: "generic",
      order: 1,
    });
  });

  it("没有元数据的注册值被跳过", () => {
    expect(readLibrarySectionMeta(() => null)).toBeNull();
    expect(readLibrarySectionMeta(null)).toBeNull();
    expect(readLibrarySectionMeta({ librarySection: { id: "x", label: "X" } })).toBeNull();
  });

  it("元数据缺 id / label 时也跳过(不画无标签导航项)", () => {
    const bad = defineLibrarySection({ id: "", label: "X" }, () => null);
    expect(readLibrarySectionMeta(bad)).toBeNull();
  });
});
