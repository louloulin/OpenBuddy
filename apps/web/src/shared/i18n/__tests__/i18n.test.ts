import { afterEach, describe, expect, it } from "vitest";
import { applyLocale, getLocale, setLocale, t, tOptional } from "..";
import { coreZh, coreEn } from "../dicts/core";
import { generalZh, generalEn } from "../dicts/general";
import { aboutZh, aboutEn } from "../dicts/about";
import { dataZh, dataEn } from "../dicts/data";
import { modelsZh, modelsEn } from "../dicts/models";
import { agentZh, agentEn } from "../dicts/agent";
import { securityZh, securityEn } from "../dicts/security";
import { mailZh, mailEn } from "../dicts/mail";
import { assistantZh, assistantEn } from "../dicts/assistant";
import { mobileZh, mobileEn } from "../dicts/mobile";
import { miscZh, miscEn } from "../dicts/misc";

const DOMAINS: Array<[string, Record<string, string>, Record<string, string>]> = [
  ["core", coreZh, coreEn],
  ["general", generalZh, generalEn],
  ["about", aboutZh, aboutEn],
  ["data", dataZh, dataEn],
  ["models", modelsZh, modelsEn],
  ["agent", agentZh, agentEn],
  ["security", securityZh, securityEn],
  ["mail", mailZh, mailEn],
  ["assistant", assistantZh, assistantEn],
  ["mobile", mobileZh, mobileEn],
  ["misc", miscZh, miscEn],
];

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

  it("每个域的 zh / en 键集合一致（业务面板国际化的硬约束）", () => {
    for (const [name, zh, en] of DOMAINS) {
      const zhKeys = Object.keys(zh).sort();
      const enKeys = Object.keys(en).sort();
      expect(enKeys, `${name} 域缺少英文`).toEqual(zhKeys);
    }
  });

  it("键在所有域之间全局唯一", () => {
    const seen = new Map<string, string>();
    for (const [name, zh] of DOMAINS) {
      for (const key of Object.keys(zh)) {
        expect(seen.has(key), `键 ${key} 在 ${seen.get(key)} 与 ${name} 重复`).toBe(false);
        seen.set(key, name);
      }
    }
  });
});
