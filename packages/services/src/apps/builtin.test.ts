// @vitest-environment node
import { describe, expect, it } from "vitest";
import { BUILTIN_APP_ID, builtinApp, isBuiltinApp } from "./builtin";

describe("内置通用应用 (2026-11-27)", () => {
  it("id/名称/定位固定，source 为 builtin，且带通用场景", () => {
    const app = builtinApp();
    expect(app.id).toBe(BUILTIN_APP_ID);
    expect(app.id).toBe("openbuddy");
    expect(app.name).toBe("OpenBuddy");
    expect(app.kind).toBe("app");
    expect(app.source).toBe("builtin");
    expect(app.tagline).toBeTruthy();
    expect(app.sceneList?.length).toBeGreaterThanOrEqual(3);
    for (const scene of app.sceneList ?? []) expect(scene.prompt.trim().length).toBeGreaterThan(10);
  });

  it("每次返回新对象（列表可安全修改，不污染常量）", () => {
    const a = builtinApp();
    a.name = "changed";
    expect(builtinApp().name).toBe("OpenBuddy");
    a.sceneList?.pop();
    expect(builtinApp().sceneList?.length).toBeGreaterThanOrEqual(3);
  });

  it("isBuiltinApp 认 source 或 id", () => {
    expect(isBuiltinApp({ source: "builtin" })).toBe(true);
    expect(isBuiltinApp({ id: "openbuddy" })).toBe(true);
    expect(isBuiltinApp({ source: "pi", id: "upup" })).toBe(false);
  });
});
