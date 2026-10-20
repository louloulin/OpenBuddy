/**
 * dsh-bridge-helpers.test.ts — smoke tests for DSH bridge helpers.
 */
import { afterEach, describe, it, expect, vi } from "vitest";

import {
  installDshBridgeHelpers,
  questionAnswer,
  deepSeekCordisSnapshot,
  deepSeekPiBridgeDescription,
  invokeDeepSeekCordis,
  __resetDshBridgeHelpersForTest,
} from "./dsh-bridge-helpers";
import { createDefaultAgentHostState } from "./_default-state";

afterEach(() => {
  __resetDshBridgeHelpersForTest();
});

describe("dsh-bridge-helpers", () => {
  it("questionAnswer passes through string values", () => {
    expect(questionAnswer("hello" as any)).toBe("hello");
  });

  it("questionAnswer returns undefined for null/non-object", () => {
    expect(questionAnswer(null as any)).toBeUndefined();
    expect(questionAnswer(undefined as any)).toBeUndefined();
    expect(questionAnswer(42 as any as any)).toBeUndefined();
  });

  it("questionAnswer picks by questionKey from answers", () => {
    expect(questionAnswer({ answers: { q1: "first", q2: "second" } } as any, "q2")).toBe("second");
  });

  it("questionAnswer falls back to first answer when no key", () => {
    expect(questionAnswer({ answers: { a: "x" } } as any)).toBe("x");
  });

  it("questionAnswer unwraps single-element arrays", () => {
    expect(questionAnswer({ answers: { a: ["only"] } } as any)).toBe("only");
  });

  it("questionAnswer falls back to annotations notes", () => {
    expect(questionAnswer({
      answers: {},
      annotations: { x: { notes: "from annotation" } },
    } as any)).toBe("from annotation");
  });

  it("deepSeekCordisSnapshot throws when not installed", () => {
    expect(() => deepSeekCordisSnapshot()).toThrow(/not installed/);
  });

  it("deepSeekCordisSnapshot returns state snapshot when installed", () => {
    const state = createDefaultAgentHostState();
    const snapshot = { plugins: [], version: "1" } as any;
    state.deepSeekCordisSnapshot = snapshot;
    installDshBridgeHelpers({ state });
    expect(deepSeekCordisSnapshot()).toBe(snapshot);
  });

  it("deepSeekPiBridgeDescription returns protocol + capabilities", () => {
    installDshBridgeHelpers({ state: createDefaultAgentHostState() });
    const desc = deepSeekPiBridgeDescription();
    expect(desc.runtime).toBe("pi");
    expect(desc.protocol).toBeDefined();
    expect(desc.capabilities).toBeDefined();
  });

  it("invokeDeepSeekCordis throws when not installed", async () => {
    await expect(invokeDeepSeekCordis({} as any)).rejects.toThrow(/not installed/);
  });

  it("invokeDeepSeekCordis throws when runtime is null", async () => {
    installDshBridgeHelpers({ state: createDefaultAgentHostState() });
    // 契约文案由 deepseek/bridge 统一提供 (冒烟的 deepSeekCordisInvoke 按此正则判定).
    await expect(invokeDeepSeekCordis({} as any)).rejects.toThrow(/runtime is not active/);
  });

  it("invokeDeepSeekCordis delegates to runtime.invoke", async () => {
    const state = createDefaultAgentHostState();
    const invoke = vi.fn(async () => "result");
    state.deepSeekCordisRuntime = { invoke } as any;
    installDshBridgeHelpers({ state });
    const result = await invokeDeepSeekCordis({ plugin: "x" } as any);
    expect(invoke).toHaveBeenCalledWith({ plugin: "x" });
    expect(result).toBe("result");
  });
});
