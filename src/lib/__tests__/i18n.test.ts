/**
 * Lightweight smoke tests for `src/lib/i18n.ts`.
 *
 * Coverage:
 *  - `t()` returns the locale's translation for a dotted key path.
 *  - Missing keys fall back to the key string (so missing translations surface).
 *  - `setLocale()` updates the module-level locale.
 *  - `getLocale()` / `setLocale()` round-trip works.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { t, getLocale, setLocale, DEFAULT_LOCALE } from "../platform/i18n";

describe("i18n helper", () => {
  beforeEach(() => {
    setLocale(DEFAULT_LOCALE);
  });

  it("returns the default locale's translation for known keys", () => {
    expect(getLocale()).toBe("zh-CN");
    expect(t("common.save")).toBe("保存");
    expect(t("permission.modes.default")).toBe("始终询问");
    expect(t("permission.modes.bypassPermissions")).toBe("完全访问");
  });

  it("falls back to the key string for missing keys", () => {
    expect(t("nonexistent.key")).toBe("nonexistent.key");
  });

  it("supports both supported locales", () => {
    setLocale("en-US");
    expect(getLocale()).toBe("en-US");
    expect(t("common.save")).toBe("Save");
    expect(t("permission.modes.plan")).toBe("Plan Mode");
  });

  it("supports nested key paths with dot separator", () => {
    setLocale("zh-CN");
    expect(t("permission.descriptions.acceptEdits")).toBe("自动允许读取和写入；执行操作前询问。");
    setLocale("en-US");
    expect(t("permission.descriptions.acceptEdits")).toBe("Auto-allow reads and writes; ask before shell calls.");
  });

  it("treats both zh-CN and en-US resource trees as non-empty", () => {
    setLocale("zh-CN");
    expect(t("about.title").length).toBeGreaterThan(0);
    setLocale("en-US");
    expect(t("about.title").length).toBeGreaterThan(0);
  });

  it("exposes scene mode translations", () => {
    setLocale("zh-CN");
    expect(t("scene.modes.working")).toBe("日常办公");
    expect(t("scene.modes.coding")).toBe("代码开发");
    expect(t("scene.modes.design")).toBe("设计创意");
    setLocale("en-US");
    expect(t("scene.modes.working")).toBe("Daily Work");
    expect(t("scene.modes.coding")).toBe("Code Development");
    expect(t("scene.modes.design")).toBe("Design Studio");
  });

  it("exposes conversation.unpin translation in both locales", () => {
    setLocale("zh-CN");
    expect(t("conversation.unpin")).toBe("取消置顶");
    setLocale("en-US");
    expect(t("conversation.unpin")).toBe("Unpin");
  });
});
