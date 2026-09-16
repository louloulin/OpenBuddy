/**
 * author.test.ts — 第三方插件作者入口 `defineExtension()`。
 *
 * 两个真问题被这条测试锁住:
 *
 *   1. **作者入口没导出** —— `examples/openbuddy-plugin-*` 三个示例、以及文档里
 *      写的都是 `import { defineExtension } from "@openbuddy/plugin-sdk"`,但包根
 *      之前只导出 manifest / serializer。SDK 自称"完整公开"却连入口都 import
 *      不到,starter 模板抄下来直接报错。
 *   2. **label 丢在派发路上** —— `registerCommand(id, label, onExecute)` 只把
 *      `{ id, onExecute }` 发出去,于是内核里的 `plugin.command` entry 没有展示名,
 *      ⌘K 命令面板没法列出这条命令。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { defineExtension } from "../author";

const manifest = {
  name: "test-plugin",
  version: "0.15.0",
  description: "test",
};

type Captured = { type: string; detail: Record<string, unknown> };

describe("defineExtension", () => {
  let captured: Captured[] = [];
  const listener = (event: Event) => {
    captured.push({
      type: event.type,
      detail: (event as CustomEvent<Record<string, unknown>>).detail ?? {},
    });
  };

  beforeEach(() => {
    captured = [];
    for (const type of ["openbuddy:register-slot", "openbuddy:register-command", "openbuddy:unregister-command"]) {
      window.addEventListener(type, listener);
    }
  });

  afterEach(() => {
    for (const type of ["openbuddy:register-slot", "openbuddy:register-command", "openbuddy:unregister-command"]) {
      window.removeEventListener(type, listener);
    }
  });

  it("作者入口可从包根导入(示例插件的 import 路径)", async () => {
    const root = await import("../index");
    expect(typeof root.defineExtension).toBe("function");
  });

  it("清单非法时抛出带原因的错误(不静默吞掉)", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      defineExtension({ manifest: { ...manifest, name: "" }, setup: () => {} }),
    ).toThrow(/invalid manifest/i);
  });

  it("registerCommand 把 label 一起派发出去", () => {
    defineExtension({
      manifest,
      setup: (api) => {
        api.registerCommand("greet", "/greet — 输出问候", () => {});
      },
    });
    const event = captured.find((c) => c.type === "openbuddy:register-command");
    expect(event).toBeTruthy();
    expect(event?.detail.id).toBe("greet");
    expect(event?.detail.label).toBe("/greet — 输出问候");
    expect(typeof event?.detail.onExecute).toBe("function");
  });

  it("dispose() 撤销命令注册(热卸载不留残影)", () => {
    const extension = defineExtension({
      manifest,
      setup: (api) => {
        api.registerCommand("greet", "/greet", () => {});
      },
    });
    extension.dispose();
    expect(captured.some((c) => c.type === "openbuddy:unregister-command" && c.detail.id === "greet")).toBe(true);
  });

  it("registerSlot 仍然按 name/kind/scope/payload 派发", () => {
    defineExtension({
      manifest,
      setup: (api) => {
        api.registerSlot("editor.toolbar", "list", "root", { id: "bold", label: "加粗" });
      },
    });
    const event = captured.find((c) => c.type === "openbuddy:register-slot");
    expect(event?.detail).toMatchObject({
      name: "editor.toolbar",
      kind: "list",
      scope: "root",
      payload: { id: "bold", label: "加粗" },
    });
  });

  it("重复 registerCommand 同 id 仍会派发两次(由内核侧做幂等收敛)", () => {
    const seen = vi.fn();
    defineExtension({
      manifest,
      setup: (api) => {
        api.registerCommand("dup", "/dup", seen);
        api.registerCommand("dup", "/dup", seen);
      },
    });
    const events = captured.filter((c) => c.type === "openbuddy:register-command");
    expect(events).toHaveLength(2);
  });
});
