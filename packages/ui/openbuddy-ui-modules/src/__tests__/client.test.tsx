import { describe, expect, it, vi } from "vitest";
import { apply } from "../client";
import type { SlotCoreLike, UiRuntimeContext } from "@openbuddy/ui-slots";

interface Registration {
  name: string;
  kind?: string;
  scope?: string;
  id?: string;
  registrant?: string;
  component: unknown;
}

function fakeContext() {
  const registrations: Registration[] = [];
  const disposed: string[] = [];
  const slots: SlotCoreLike = {
    register(options, component) {
      registrations.push({ ...(options as Omit<Registration, "component">), component });
      return () => {
        disposed.push(options.name);
      };
    },
    inject: () => () => {},
    entries: () => [],
    spec: () => undefined,
  };
  return { ctx: { slots } as unknown as UiRuntimeContext, registrations, disposed };
}

describe("@openbuddy/ui-modules/client", () => {
  it("apply() 默认是 no-op（不再向内核注册 MarketplaceTab/MarketplaceCard）", () => {
    // 设计上 `modules.marketplace` 与 `modules.marketplace.item` 是为第三方
    // 插件预留的扩展槽位;ui-modules 自己只导出参考实现,不向内核注入,避免
    // PluginsTabContent 在没有数据 props 时渲染空白、也避免和 ui-mcp 的
    // MarketplacePanel 形成两份实现并存的歧义。
    const { ctx, registrations } = fakeContext();
    apply(ctx);
    expect(registrations).toEqual([]);
  });

  it("returns a disposer that does nothing (apply() 不产生副作用)", () => {
    const { ctx, disposed } = fakeContext();
    const dispose = apply(ctx);
    expect(typeof dispose).toBe("function");
    dispose();
    expect(disposed).toEqual([]);
  });

  it("does not touch IPC or global state while registering", () => {
    const { ctx } = fakeContext();
    const fetchSpy = vi.spyOn(globalThis, "fetch" as never).mockImplementation(() => {
      throw new Error("no network in registration");
    });
    expect(() => apply(ctx)).not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
