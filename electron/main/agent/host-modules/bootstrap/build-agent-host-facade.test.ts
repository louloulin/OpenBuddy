/**
 * build-agent-host-facade.test.ts — P1.4 回归:stub 兜底真的生效。
 *
 * 此前 `stub(name)` 定义了却从未被调用,缺键时调用得到的是
 * `TypeError: x is not a function`;现在 Proxy 兜底为可读错误。
 */
import { describe, expect, it } from "vitest";

import { buildAgentHostFacade } from "./build-agent-host-facade";

describe("buildAgentHostFacade", () => {
  it("缺实现时调用得到可读错误,而不是 TypeError", () => {
    const facade = buildAgentHostFacade({} as never);
    expect(() => (facade as unknown as { getCwd: () => string }).getCwd()).toThrow(
      /agentHost\.getCwd is not implemented/,
    );
  });

  it("已提供的实现原样透传,且 Object.keys 语义不变", () => {
    const getCwd = () => "/tmp/workspace";
    const facade = buildAgentHostFacade({ getCwd } as never);
    expect(facade.getCwd()).toBe("/tmp/workspace");
    expect(Object.keys(facade)).toEqual(["getCwd"]);
    expect("getCwd" in facade).toBe(true);
    // 探测类属性不能被 stub,否则 facade 变 thenable(await 会炸)。
    expect((facade as unknown as { then?: unknown }).then).toBeUndefined();
  });
});
