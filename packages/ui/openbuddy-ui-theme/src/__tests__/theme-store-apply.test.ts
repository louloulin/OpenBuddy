/**
 * theme-store / applyThemeAttrs 回归测试。
 *
 * 覆盖三处会直接导致"用户看到错误配色"的缺陷:
 *   1. 只把 `theme.vars`(delta)写进内联样式 → base 里才有的 token
 *      (overlay / shadow / radius / font)会停留在上一套主题的值上。
 *   2. win95 / winxp 的 `--wb-radius-*: 0` 在切走之后仍然生效(圆角永久变方)。
 *   3. `setPreference("light" | "dark")` 在用户已选命名主题时不改配色,
 *      于是设置面板的浅/深按钮和宿主 IDE 的 colorScheme 同步"点了没反应"。
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { BASE_FONT_STACK, THEMES, resolveVars } from "../themes";
import { createThemeStore, getStoredThemeName, type ThemeService } from "../theme-store";

function inlineVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-name");
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("applyThemeAttrs — 落地的是 base + delta 的完整集合", () => {
  let service: ThemeService;

  beforeEach(() => {
    service = createThemeStore();
  });

  it("base 里才有的 token 也会被写成内联值", () => {
    service.setThemeByName("claude");
    // claude 的 vars 不含 overlay / shadow / font,它们只在 LIGHT_BASE /
    // DARK_BASE 里 —— 必须由 applyThemeAttrs 补齐。
    for (const token of [
      "--wb-bg-overlay",
      "--wb-shadow",
      "--wb-shadow-md",
      "--wb-shadow-lg",
      "--wb-radius-md",
      "--wb-font-mono",
      // `--wb-font` / `--wb-font-heading` 不在此列:它们由主题的顶层
      // `font` / `headingFont` 字段决定(见下面的 "主题字体真的落到 DOM" 一组)。
    ]) {
      expect(inlineVar(token), token).toBe(resolveVars("claude")[token]);
    }
  });

  it("切换主题时 delta 之外的 token 跟着一起变(不再残留)", () => {
    service.setThemeByName("openbuddy"); // 浅色
    const lightOverlay = inlineVar("--wb-bg-overlay");
    const lightShadow = inlineVar("--wb-shadow");
    service.setThemeByName("openbuddy-dark"); // 深色
    expect(inlineVar("--wb-bg-overlay")).not.toBe(lightOverlay);
    expect(inlineVar("--wb-shadow")).not.toBe(lightShadow);
    expect(inlineVar("--wb-bg-overlay")).toBe(
      resolveVars("openbuddy-dark")["--wb-bg-overlay"],
    );
  });

  it("19 套主题的正文字体都落成内联值,且不含自引用 var()", () => {
    // 回归点:主题写的是 `'"Space Grotesk", var(--wb-font)'`,若原样写回
    // `--wb-font` 就是循环引用 → font-family 整条失效。
    for (const theme of THEMES) {
      service.setThemeByName(theme.name);
      const body = inlineVar("--wb-font");
      const heading = inlineVar("--wb-font-heading");
      expect(body, theme.name).toBeTruthy();
      expect(body, theme.name).not.toContain("var(--wb-font");
      expect(heading, theme.name).toBeTruthy();
      expect(heading, theme.name).not.toContain("var(--wb-font");
    }
  });

  it("主题字体真的落到 DOM(claude 的 Space Grotesk + Playfair Display)", () => {
    service.setThemeByName("claude");
    expect(inlineVar("--wb-font")).toBe(
      `"Space Grotesk", ${BASE_FONT_STACK}`,
    );
    expect(inlineVar("--wb-font-heading")).toBe('"Playfair Display", Georgia, serif');
  });

  it("没有 font 的主题回落到基础字体栈,heading 与 body 一致", () => {
    const plain = THEMES.find((theme) => !theme.font);
    expect(plain, "至少有一套主题不声明 font").toBeTruthy();
    service.setThemeByName(plain!.name);
    expect(inlineVar("--wb-font")).toBe(BASE_FONT_STACK);
    expect(inlineVar("--wb-font-heading")).toBe(BASE_FONT_STACK);
  });

  it("切主题时字体会跟着换(不会停留在上一套)", () => {
    service.setThemeByName("claude");
    const claudeBody = inlineVar("--wb-font");
    service.setThemeByName("win95");
    expect(inlineVar("--wb-font")).not.toBe(claudeBody);
    expect(inlineVar("--wb-font")).toContain("Pixelated MS Sans Serif");
  });

  it("win95 的方角不会泄漏到后续主题", () => {
    service.setThemeByName("win95");
    expect(inlineVar("--wb-radius-md")).toBe("0");
    expect(inlineVar("--wb-radius-lg")).toBe("0");

    service.setThemeByName("sakura");
    expect(inlineVar("--wb-radius-md")).toBe(
      resolveVars("sakura")["--wb-radius-md"],
    );
    expect(inlineVar("--wb-radius-md")).not.toBe("0");
    expect(inlineVar("--wb-radius-lg")).not.toBe("0");
  });
});

describe("setPreference — v1 契约必须真的改变配色", () => {
  let service: ThemeService;

  beforeEach(() => {
    service = createThemeStore();
  });

  it("已选浅色命名主题时 setPreference('dark') 仍然切到深色", () => {
    service.setThemeByName("sakura");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    service.setPreference("dark");
    expect(service.preference()).toBe("dark");
    expect(service.current()).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(inlineVar("--wb-bg-primary")).toBe(
      resolveVars(service.currentName())["--wb-bg-primary"],
    );
    expect(service.currentName()).not.toBe("sakura");
  });

  it("toggle() 在命名主题下也能真正翻转", () => {
    service.setThemeByName("claude");
    const before = service.current();
    const beforeBg = inlineVar("--wb-bg-primary");
    service.toggle();
    expect(service.current()).not.toBe(before);
    expect(inlineVar("--wb-bg-primary")).not.toBe(beforeBg);
  });

  it("类型本来就一致时保留用户手选的命名主题", () => {
    service.setThemeByName("sakura");
    service.setPreference("light");
    // 宿主 IDE 的 colorScheme 每次 plugin/profile 加载都会同步一次;
    // 若这里改写 name,用户手选的 sakura 会被抹掉。
    expect(service.currentName()).toBe("sakura");
    expect(document.documentElement.getAttribute("data-theme-name")).toBe("sakura");
  });

  it("没有命名主题时 setPreference('dark') 不写 name(环境默认值仍可继续跟随)", () => {
    // 宿主/IDE 的 colorScheme 同步以 `getStoredThemeName()` 作为"用户是否
    // 做过显式选择"的判据。若首启动的环境同步顺手写了一个 name,后续每次
    // 启动都会被判定成"用户已选择"而不再跟随宿主主题。
    expect(service.currentName()).toBe("openbuddy"); // 默认浅色品牌主题
    service.setPreference("dark");
    expect(service.current()).toBe("dark");
    expect(getStoredThemeName()).toBeNull();
    expect(service.mode()).toBe("manual");
  });

  it("setPreference('system') 回到跟随系统模式", () => {
    service.setThemeByName("sakura");
    service.setPreference("system");
    expect(service.mode()).toBe("system");
  });
});

describe("v1 data-theme 兼容桥", () => {
  it("外部翻转 data-theme 会重新解析整份配色", async () => {
    const service = createThemeStore();
    service.setThemeByName("openbuddy");
    const lightBg = inlineVar("--wb-bg-primary");

    // 模拟旧插件 / 宿主桥接直接改属性(不经过 service)。
    document.documentElement.setAttribute("data-theme", "dark");
    await new Promise((r) => setTimeout(r, 0));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme-name")).not.toBe(
      "openbuddy",
    );
    expect(inlineVar("--wb-bg-primary")).not.toBe(lightBg);
    expect(service.current()).toBe("dark");
  });
});
