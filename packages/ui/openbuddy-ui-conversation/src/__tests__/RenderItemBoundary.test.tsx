/**
 * RenderItemBoundary.test — plan1030 批 4a。
 *
 * 锁定三条不变量：
 *   1. 正常子树原样渲染（boundary 对健康消息零影响）；
 *   2. 子树抛错时只塌出兜底行（msg-render-error），不冒泡炸掉整棵树；
 *   3. 刻意不做自动重试 —— 兜底行里没有重试按钮（lumos issue #1400：
 *      坏记录重试还是坏，每次启动都会重崩）。
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { RenderItemBoundary } from "../RenderItemBoundary";

function Boom(): never {
  throw new Error("bad record");
}

describe("RenderItemBoundary", () => {
  it("健康子树原样渲染", () => {
    const { container } = render(
      <RenderItemBoundary itemId="m1">
        <div className="healthy">hello</div>
      </RenderItemBoundary>,
    );
    expect(container.querySelector(".healthy")?.textContent).toBe("hello");
    expect(container.querySelector(".msg-render-error")).toBeNull();
  });

  it("子树抛错只塌一行，同树其余内容不受影响", () => {
    const { container } = render(
      <div>
        <RenderItemBoundary itemId="m-bad">
          <Boom />
        </RenderItemBoundary>
        <div className="sibling">still here</div>
      </div>,
    );
    const fallback = container.querySelector(".msg-render-error");
    expect(fallback).not.toBeNull();
    expect(fallback?.getAttribute("data-msg-render-error")).toBe("m-bad");
    // 兜底不吞掉兄弟节点
    expect(container.querySelector(".sibling")?.textContent).toBe("still here");
    // 兜底行里没有重试按钮（刻意不自动重试）
    expect(fallback?.querySelector("button")).toBeNull();
  });
});
