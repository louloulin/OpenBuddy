import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  UPUP_DEFAULT_DISABLED,
  normalizeUpupKey,
  readUpupPlugins,
  writeUpupPlugins,
} from "../src/apps/upup-settings";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ob-upup-settings-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("UpUp 插件开关 (20261126-upup UP-1.2/1.3)", () => {
  it("默认给出确定要关的子包；文件不存在时也能读", () => {
    const state = readUpupPlugins(dir);
    expect(state.disabled).toEqual([]);
    expect(state.settingsExists).toBe(false);
    expect(state.defaults).toEqual([...UPUP_DEFAULT_DISABLED]);
    expect(state.settingsPath).toBe(join(dir, "settings.json"));
  });

  it("写入时规范化键名，并保留同目录其它键", () => {
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ theme: "upup-dark", upupPlugins: { enabled: ["memory"] } }));
    const state = writeUpupPlugins(dir, { disabled: ["pi-portfolio", "@upup/pi-notify", "builtin:pi-cache"] });
    expect(state.disabled).toEqual(["@upup/pi-portfolio", "@upup/pi-notify", "@upup/pi-cache"]);
    const raw = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")) as Record<string, unknown>;
    expect(raw.theme).toBe("upup-dark");
    expect(raw.upupPlugins).toEqual({ disabled: ["@upup/pi-portfolio", "@upup/pi-notify", "@upup/pi-cache"], enabled: ["@upup/memory"] });
  });

  it("清空 disabled 后不再写这个键，坏 JSON 也不崩", () => {
    writeUpupPlugins(dir, { disabled: ["pi-risk"] });
    const cleared = writeUpupPlugins(dir, { disabled: [] });
    expect(cleared.disabled).toEqual([]);

    writeFileSync(join(dir, "settings.json"), "{not json");
    const state = readUpupPlugins(dir);
    expect(state.disabled).toEqual([]);
    expect(() => writeUpupPlugins(dir, { disabled: ["pi-quant"] })).not.toThrow();
    expect(readUpupPlugins(dir).disabled).toEqual(["@upup/pi-quant"]);
  });

  it("normalizeUpupKey 处理 bare / @upup / builtin 前缀", () => {
    expect(normalizeUpupKey("pi-portfolio")).toBe("@upup/pi-portfolio");
    expect(normalizeUpupKey("@upup/Pi-Risk")).toBe("@upup/pi-risk");
    expect(normalizeUpupKey("builtin:memory")).toBe("@upup/memory");
    expect(normalizeUpupKey("   ")).toBe("");
  });
});
