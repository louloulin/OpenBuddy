/**
 * builtin-applies 聚合表真实验证。
 *
 * 为什么需要这个测试:
 *   - L1/L2 完成时声称"26 个 ui-* 包接入 SlotTree",实际只验证了 tsconfig 编译
 *     与源码静态扫描,未验证运行时 26 个 apply() 真的被触发。
 *   - 本测试通过就地修改 BUILTIN_UI_APPLIES 里每一项的 apply,确认聚合器入口
 *     registerAllBuiltinUis() 真的调用了全部 N 项 apply。
 *   - 任何后续增删包,如果忘了同步 BUILTIN_UI_APPLIES,本测试 fail。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BUILTIN_UI_APPLIES } from "../builtin-applies";

describe("BUILTIN_UI_APPLIES 聚合完整性", () => {
  it("覆盖所有 ui-* 包(防漏注册)", () => {
    // 当前约定:至少 21 个 ui-* 业务包(去除 ui-slots / ui-theme / ui-locale / ui-hmr / ui-runtime 这5个走特殊通道)
    expect(BUILTIN_UI_APPLIES.length).toBeGreaterThanOrEqual(21);
    const names = BUILTIN_UI_APPLIES.map((e) => e.pkg);
    const expected = [
      "@openbuddy/ui-account",
      "@openbuddy/ui-automation",
      "@openbuddy/ui-billing",
      "@openbuddy/ui-collaboration",
      "@openbuddy/ui-conversation",
      "@openbuddy/ui-dialogs",
      "@openbuddy/ui-email",
      "@openbuddy/ui-experts",
      "@openbuddy/ui-files",
      "@openbuddy/ui-home",
      "@openbuddy/ui-layout",
      "@openbuddy/ui-markdown",
      "@openbuddy/ui-mcp",
      "@openbuddy/ui-modules",
      "@openbuddy/ui-primitives",
      "@openbuddy/ui-settings",
      "@openbuddy/ui-settings-models",
      "@openbuddy/ui-shared",
      "@openbuddy/ui-shell",
      "@openbuddy/ui-sidebar",
      "@openbuddy/ui-workbench",
    ];
    for (const n of expected) {
      expect(names).toContain(n);
    }
  });

  it("每项都有 apply 函数,且签名兼容 UiPlugin.apply", () => {
    for (const entry of BUILTIN_UI_APPLIES) {
      expect(typeof entry.apply).toBe("function");
    }
  });

  it("包名无重复", () => {
    const names = BUILTIN_UI_APPLIES.map((e) => e.pkg);
    expect(new Set(names).size).toBe(names.length);
  });

  it("包名都带 @openbuddy/ui- 前缀(防漏写 ui-)", () => {
    for (const e of BUILTIN_UI_APPLIES) {
      expect(e.pkg.startsWith("@openbuddy/ui-")).toBe(true);
    }
  });
});

describe("registerAllBuiltinUis 行为", () => {
  // 保存原始 apply,以便 afterEach 还原
  const originals: Array<{ entry: (typeof BUILTIN_UI_APPLIES)[number]; apply: unknown }> = [];

  beforeEach(() => {
    for (const e of BUILTIN_UI_APPLIES) {
      originals.push({ entry: e, apply: e.apply });
    }
  });

  afterEach(() => {
    for (const o of originals) o.entry.apply = o.apply as never;
    originals.length = 0;
    vi.restoreAllMocks();
  });

  it("遍历每一项并调用其 apply(ctx)", async () => {
    const spies: Array<ReturnType<typeof vi.fn>> = [];
    for (const e of BUILTIN_UI_APPLIES) {
      const spy = vi.fn(() => () => {});
      spies.push(spy);
      e.apply = spy as never;
    }

    const { registerAllBuiltinUis } = await import("../client");
    const dispose = registerAllBuiltinUis();

    for (const spy of spies) {
      expect(spy).toHaveBeenCalledTimes(1);
    }
    dispose();
  });

  it("apply 抛错时不影响后续包", async () => {
    const allCalls: Array<string> = [];
    // 让第一项抛错
    BUILTIN_UI_APPLIES[0].apply = (() => { throw new Error("synthetic"); }) as never;
    // 其余包记录
    for (let i = 1; i < BUILTIN_UI_APPLIES.length; i++) {
      const idx = i;
      const pkgName = BUILTIN_UI_APPLIES[idx].pkg;
      BUILTIN_UI_APPLIES[idx].apply = (() => { allCalls.push(pkgName); }) as never;
    }

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { registerAllBuiltinUis } = await import("../client");
    registerAllBuiltinUis();

    expect(allCalls.length).toBe(BUILTIN_UI_APPLIES.length - 1);
    errSpy.mockRestore();
  });

  it("dispose() 反向释放所有 disposer", async () => {
    const disposeOrder: string[] = [];
    for (let i = 0; i < BUILTIN_UI_APPLIES.length; i++) {
      const pkg = BUILTIN_UI_APPLIES[i].pkg;
      BUILTIN_UI_APPLIES[i].apply = (() => () => { disposeOrder.push(pkg); }) as never;
    }
    const { registerAllBuiltinUis } = await import("../client");
    const dispose = registerAllBuiltinUis();
    expect(disposeOrder.length).toBe(0); // register 阶段不释放
    dispose();
    expect(disposeOrder.length).toBe(BUILTIN_UI_APPLIES.length);
    // 验证反序
    for (let i = 0; i < BUILTIN_UI_APPLIES.length; i++) {
      expect(disposeOrder[i]).toBe(BUILTIN_UI_APPLIES[BUILTIN_UI_APPLIES.length - 1 - i].pkg);
    }
  });
});
