import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SOURCE, isStandardApp, validateAppEntry } from "./standard";
import { builtinApp } from "./builtin";
import type { AppEntry } from "./manifest";

const piApp = (overrides: Partial<AppEntry> = {}): AppEntry => ({
  id: "upup",
  name: "upup",
  kind: "app",
  source: "pi",
  packageSource: DEFAULT_APP_SOURCE,
  tagline: "证券智能投研助手",
  ...overrides,
});

describe("标准应用结构 (2026-11-27)", () => {
  it("官方默认安装源是 gitcode 的 upup 仓库", () => {
    expect(DEFAULT_APP_SOURCE).toBe("https://gitcode.com/lumosaigroup/upup.git");
  });

  it("内置应用与标准 Pi 应用都通过校验", () => {
    expect(validateAppEntry(builtinApp())).toEqual([]);
    expect(isStandardApp(builtinApp())).toBe(true);
    const upup = piApp({ category: "finance", sceneList: [{ id: "s", name: "场景", prompt: "做点事" }], toolPolicy: { deny: ["place_trade_order"] } });
    expect(validateAppEntry(upup)).toEqual([]);
  });

  it("kind=app 缺一句话定位、外部应用缺安装源都算违规", () => {
    expect(validateAppEntry(piApp({ tagline: undefined })).map((v) => v.field)).toContain("tagline");
    expect(validateAppEntry(piApp({ packageSource: undefined })).map((v) => v.field)).toContain("packageSource");
  });

  it("内置应用不得带安装路径", () => {
    const bad = builtinApp();
    bad.packageSource = "/tmp/x";
    expect(validateAppEntry(bad).map((v) => v.field)).toContain("source");
  });

  it("icon 必须是包内相对路径；场景三要素齐全", () => {
    expect(validateAppEntry(piApp({ icon: "/abs/icon.png" })).map((v) => v.field)).toContain("icon");
    expect(validateAppEntry(piApp({ icon: "../escape.png" })).map((v) => v.field)).toContain("icon");
    expect(validateAppEntry(piApp({ icon: "assets/icon.png" }))).toEqual([]);
    const badScene = piApp({ sceneList: [{ id: "", name: "", prompt: "" }] });
    expect(validateAppEntry(badScene).map((v) => v.field)).toContain("sceneList");
  });

  it("toolPolicy 里的工具名不能为空", () => {
    expect(validateAppEntry(piApp({ toolPolicy: { deny: ["  "] } })).map((v) => v.field)).toContain("toolPolicy.deny");
  });
});
