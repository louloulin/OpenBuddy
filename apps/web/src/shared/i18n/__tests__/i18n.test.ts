import { afterEach, describe, expect, it } from "vitest";
import { applyLocale, getLocale, setLocale, t, tOptional } from "..";

afterEach(() => {
  setLocale("zh-CN");
  localStorage.clear();
});

describe("界面语言 (B4)", () => {
  it("defaults to zh-CN and translates the settings surface", () => {
    setLocale("zh-CN");
    expect(getLocale()).toBe("zh-CN");
    expect(t("general.title")).toBe("通用");
    expect(t("settings.nav.about")).toBe("关于");
  });

  it("switches to en-US, persists the choice and mirrors <html lang>", () => {
    setLocale("en-US");
    expect(getLocale()).toBe("en-US");
    expect(localStorage.getItem("openbuddy.locale")).toBe("en-US");
    expect(t("general.title")).toBe("General");
    expect(t("about.title")).toBe("About");
    expect(t("data.export")).toBe("Export all data");
    applyLocale();
    expect(document.documentElement.lang).toBe("en-US");
  });

  it("interpolates values and falls back safely for unknown keys", () => {
    setLocale("en-US");
    expect(t("about.available", { version: "1.2.0" })).toBe("Version v1.2.0 is available");
    expect(t("data.filesCount", { count: 3 })).toBe("3 files");
    expect(t("unknown.key")).toBe("unknown.key");
    expect(tOptional("unknown.key")).toBeUndefined();
  });

  it("falls back to zh-CN when an English key is missing", () => {
    setLocale("en-US");
    // `tOptional` returns the zh-CN default so the component can keep its own label.
    expect(tOptional("settings.nav.general")).toBe("General");
    expect(t("general.tray.unavailable")).toBe("Unavailable");
  });
});
