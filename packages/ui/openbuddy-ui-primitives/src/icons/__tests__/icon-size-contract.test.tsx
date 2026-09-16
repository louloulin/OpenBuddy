/**
 * 图标尺寸契约 —— 每一个图标都必须真的听话:`size="sm"` → width/height = 14。
 *
 * 为什么要对**全表**做这件事(而不是只测几个代表):
 *   图标是手写 SVG + `createIcon` 两层。raw 组件的签名一旦写成 `(_props, ref)`,
 *   props 就被丢掉,渲染出的 `<svg>` 没有 width/height —— 在 flex / grid 容器里
 *   会被 CSS 撑满容器。实测后果:`CheckIcon` 在「策略设置 → 策略检查」里
 *   变成 1042×1042 的绿色大三角,而单看代码完全正常。
 *
 *   这类 bug 不会让任何单测变红,只会让 UI 烂掉,所以这里用一条**穷举**断言
 *   把它钉死:凡是从 `@openbuddy/ui-primitives/icons` 导出的组件,都得给出
 *   14 的 width/height(或 img 的 width/height 属性)。
 */
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { ComponentType } from "react";
import * as icons from "../index";

/** 能被 React 渲染的东西:函数组件 **或** forwardRef/memo 对象。 */
function isRenderable(value: unknown): value is ComponentType<never> {
  if (typeof value === "function") return true;
  return typeof value === "object" && value !== null && "$$typeof" in value;
}

/** 图标导出表:排除基底(Icon / createIcon)与类型。 */
const iconEntries = Object.entries(icons).filter(
  ([name, value]) =>
    isRenderable(value) && name !== "Icon" && name !== "createIcon" && /Icon$/.test(name),
) as Array<[string, ComponentType<{ size?: "sm" }>]>;

function paintedSize(Component: ComponentType<{ size?: "sm" }>): string | null {
  const { container, unmount } = render(<Component size="sm" />);
  const node = container.querySelector("svg, img");
  const size = node?.getAttribute("width") ?? null;
  unmount();
  return size;
}

describe("图标尺寸契约(size 必须落到 width/height)", () => {
  it("导出表非空(穷举断言本身有意义)", () => {
    expect(iconEntries.length).toBeGreaterThan(100);
  });

  it("每个图标 size=\"sm\" 都渲染出 width=14", () => {
    const broken = iconEntries
      .filter(([, Component]) => paintedSize(Component) !== "14")
      .map(([name, Component]) => `${name} → ${paintedSize(Component)}`);
    expect(broken).toEqual([]);
  });
});
