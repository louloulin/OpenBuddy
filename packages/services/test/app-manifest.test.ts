import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAppEntry, readAppScenes } from "../src/apps/manifest";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ob-app-manifest-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const write = (pkg: unknown) => writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));

describe("应用 manifest (UP-2.1)", () => {
  it("读 pi.app：应用卡片字段与工具策略", () => {
    write({
      name: "@upup/upup",
      version: "2026.10.11",
      pi: {
        extensions: ["./packages/pi-app/src/pi-plugin-extension.ts"],
        app: {
          kind: "app",
          tagline: "证券智能投研助手",
          category: "finance",
          icon: "./assets/icon.png",
          scenes: "./scenes.json",
          toolPolicy: { readonly: ["get_astock_price"], deny: ["place_trade_order"] },
        },
      },
    });
    expect(readAppEntry(dir)).toEqual({
      id: "@upup/upup",
      name: "@upup/upup",
      version: "2026.10.11",
      kind: "app",
      source: "pi",
      installedPath: dir,
      tagline: "证券智能投研助手",
      category: "finance",
      icon: "./assets/icon.png",
      scenes: "./scenes.json",
      sceneList: [],
      toolPolicy: { readonly: ["get_astock_price"], deny: ["place_trade_order"] },
    });
  });

  it("没有 pi.app 时降级为普通扩展包", () => {
    write({ name: "pi-memory", version: "1.0.0", pi: { extensions: ["./index.ts"] } });
    expect(readAppEntry(dir)).toMatchObject({ id: "pi-memory", kind: "extension", source: "pi" });
  });

  it("坏 JSON / 缺 package.json 返回 null，不抛错", () => {
    writeFileSync(join(dir, "package.json"), "{not json");
    expect(readAppEntry(dir)).toBeNull();
    rmSync(join(dir, "package.json"));
    expect(readAppEntry(dir)).toBeNull();
  });

  it("字段类型不对时按缺省处理，不污染列表", () => {
    write({ name: "odd", pi: { app: { kind: "weird", tagline: 42, toolPolicy: { deny: [1, "ok"] } } } });
    const entry = readAppEntry(dir);
    expect(entry).toMatchObject({ id: "odd", kind: "app" });
    expect(entry?.tagline).toBeUndefined();
    expect(entry?.toolPolicy).toEqual({ deny: ["ok"] });
  });

  it("缺 name 时用目录名兜底", () => {
    mkdirSync(join(dir, "pkg-x"), { recursive: true });
    writeFileSync(join(dir, "pkg-x", "package.json"), JSON.stringify({ pi: {} }));
    expect(readAppEntry(join(dir, "pkg-x"))?.id).toBe("pkg-x");
  });

  it("解析 scenes.json：坏文件/坏结构返回空数组（UP-4.1）", () => {
    writeFileSync(join(dir, "scenes.json"), JSON.stringify({ scenes: [
      { id: "a", name: "个股深研", group: "投研", prompt: "/invest 600519.SH" },
      { id: "", name: "空 id", prompt: "x" },
      { id: "b", name: "缺 prompt" },
    ] }));
    expect(readAppScenes(dir, "./scenes.json")).toEqual([
      { id: "a", name: "个股深研", group: "投研", prompt: "/invest 600519.SH" },
    ]);

    writeFileSync(join(dir, "scenes.json"), "{broken");
    expect(readAppScenes(dir, "./scenes.json")).toEqual([]);
    expect(readAppScenes(dir, "./missing.json")).toEqual([]);
  });
});
