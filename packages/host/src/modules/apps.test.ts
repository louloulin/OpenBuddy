// @vitest-environment node
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appsModule } from "./apps";
import type { HostContext } from "../module";

/** Minimal context: these commands only touch engine.* + settings.config. */
const context = (
  packages: Array<{ source: string; installedPath?: string }> = [],
  engine: Record<string, unknown> = {},
  config: Record<string, unknown> = {},
) => {
  const state = { extensionsEnabled: false, ...config };
  return {
    options: {},
    settings: {
      dir: "/tmp/agent",
      config: { read: () => state, write: (next: Record<string, unknown>) => Object.assign(state, next) },
    },
    emit: () => {},
    engine: { extensionPackages: () => packages, ...engine },
    update: (fn: (c: Record<string, unknown>) => void) => fn(state),
    servedCommands: () => [],
    state,
  } as unknown as HostContext & { state: Record<string, unknown> };
};

describe("apps_list 的内置通用应用 (2026-11-27)", () => {
  it("没有装任何 Pi 包时也返回 OpenBuddy 自身，且排第一", () => {
    const list = appsModule(context()).commands.apps_list({}) as Array<{ id: string; source: string }>;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "openbuddy", source: "builtin" });
  });

  it("装了 UpUp 时内置应用仍在最前，Pi 应用在后", () => {
    const dir = mkdtempSync(join(tmpdir(), "ob-apps-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "upup", version: "2026.10.11", pi: { app: { kind: "app", tagline: "证券智能投研助手" } } }));
    const list = appsModule(context([{ source: dir, installedPath: dir }])).commands.apps_list({}) as Array<{ id: string }>;
    expect(list.map((entry) => entry.id)).toEqual(["openbuddy", "upup"]);
  });
});

describe("默认安装 UpUp (2026-11-27)", () => {
  it("已安装时幂等跳过，不再调用安装", async () => {
    const calls: string[] = [];
    const app = appsModule(context([{ source: "https://gitcode.com/lumosaigroup/upup.git" }], {
      installExtensionPackage: async (source: string) => { calls.push(source); return []; },
      setExtensionPackageResources: async () => [],
    }));
    const result = (await app.commands.apps_ensure_default({})) as { installed: boolean; packages: unknown[] };
    expect(result.installed).toBe(true);
    expect(result.packages).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("未安装时从官方 Git 源安装并打开资源", async () => {
    const calls: Array<[string, unknown]> = [];
    const app = appsModule(context([], {
      installExtensionPackage: async (source: string) => { calls.push(["install", source]); return [{ source }]; },
      setExtensionPackageResources: async (source: string, config: unknown) => { calls.push(["resources", { source, config }]); return []; },
    }));
    const result = (await app.commands.apps_ensure_default({})) as { installed: boolean; source: string };
    expect(result.installed).toBe(true);
    expect(result.source).toBe("https://gitcode.com/lumosaigroup/upup.git");
    expect(calls[0]).toEqual(["install", "https://gitcode.com/lumosaigroup/upup.git"]);
    expect(calls[1]?.[0]).toBe("resources");
  });

  it("安装失败不抛错，返回可读 error（离线也能用）", async () => {
    const app = appsModule(context([], {
      installExtensionPackage: async () => { throw new Error("network unreachable"); },
      setExtensionPackageResources: async () => [],
    }));
    const result = (await app.commands.apps_ensure_default({})) as { installed: boolean; error?: string };
    expect(result.installed).toBe(false);
    expect(result.error).toContain("network unreachable");
  });
});

describe("默认安装时自举扩展开关 (U1)", () => {
  it("真正安装后打开 extensionsEnabled，并返回 hint", async () => {
    const ctx = context([], {
      installExtensionPackage: async () => [],
      setExtensionPackageResources: async () => [],
    });
    const result = (await appsModule(ctx).commands.apps_ensure_default({})) as {
      installed: boolean;
      extensionsEnabled: boolean;
      hint?: string;
    };
    expect(result.installed).toBe(true);
    expect(result.extensionsEnabled).toBe(true);
    expect(result.hint).toContain("扩展已启用");
    expect(ctx.state.extensionsEnabled).toBe(true);
  });

  it("已安装时不覆盖用户在扩展中心关掉的开关", async () => {
    const ctx = context([{ source: "https://gitcode.com/lumosaigroup/upup.git" }], {}, { extensionsEnabled: false });
    const result = (await appsModule(ctx).commands.apps_ensure_default({})) as { installed: boolean; extensionsEnabled: boolean };
    expect(result.installed).toBe(true);
    expect(result.extensionsEnabled).toBe(false);
    expect(ctx.state.extensionsEnabled).toBe(false);
  });
});

describe("切换当前应用并生成根 prompt (U4)", () => {
  it("选中内置应用时写入 currentAppId 并返回身份 prompt", async () => {
    const ctx = context();
    const result = (await appsModule(ctx).commands.apps_set_current({ appId: "openbuddy" })) as { appId: string; prompt: string };
    expect(result.appId).toBe("openbuddy");
    expect(result.prompt).toContain("当前应用：OpenBuddy");
    expect(ctx.state.currentAppId).toBe("openbuddy");
  });

  it("选中已安装的第三方应用时把 toolPolicy 写进 prompt", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ob-apps-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "upup",
        version: "2026.10.11",
        pi: { app: { kind: "app", tagline: "证券智能投研助手", toolPolicy: { deny: ["place_trade_order"] } } },
      }),
    );
    const ctx = context([{ source: dir, installedPath: dir }]);
    const result = (await appsModule(ctx).commands.apps_set_current({ appId: "upup" })) as { prompt: string };
    expect(result.prompt).toContain("本应用禁用以下工具：place_trade_order");
    expect(ctx.state.currentAppId).toBe("upup");
  });

  it("不存在的应用不写设置并抛错", () => {
    const ctx = context();
    expect(() => appsModule(ctx).commands.apps_set_current({ appId: "nope" })).toThrow("app_not_found");
    expect(ctx.state.currentAppId).toBeUndefined();
  });
});

describe("安装来源记录与回滚 (U6)", () => {
  it("apps_install_state 没有记录时返回空对象", () => {
    const ctx = context();
    expect(appsModule(ctx).commands.apps_install_state({})).toEqual({});
  });

  it("apps_update 记录当前版本；第二次更新保留上一份作为回滚目标", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ob-apps-"));
    const pkgFile = join(dir, "package.json");
    writeFileSync(pkgFile, JSON.stringify({ name: "upup", version: "1.0.0" }));
    const packages = [{ source: dir, installedPath: dir }];
    const ctx = context(packages, { updateExtensionPackages: async () => packages });
    const app = appsModule(ctx);

    const first = (await app.commands.apps_update({ packageSource: dir })) as {
      install: { version?: string } | null;
      canRollback: boolean;
    };
    expect(first.install?.version).toBe("1.0.0");
    expect(first.canRollback).toBe(false);

    writeFileSync(pkgFile, JSON.stringify({ name: "upup", version: "2.0.0" }));
    const second = (await app.commands.apps_update({ packageSource: dir })) as {
      install: { version?: string } | null;
      canRollback: boolean;
    };
    expect(second.install?.version).toBe("2.0.0");
    expect(second.canRollback).toBe(true);

    const history = (ctx.state.appInstalls as Record<string, { current: { version?: string }; previous?: { version?: string } }>)[dir];
    expect(history.current.version).toBe("2.0.0");
    expect(history.previous?.version).toBe("1.0.0");
  });

  it("没有上一份记录时 apps_rollback 抛 rollback_unavailable", async () => {
    const ctx = context();
    await expect(appsModule(ctx).commands.apps_rollback({ packageSource: "https://gitcode.com/lumosaigroup/upup.git" })).rejects.toThrow(
      "rollback_unavailable",
    );
  });

  it("apps_rollback 按记录的 commit 固定源重装，并把 previous 清空", async () => {
    const calls: Array<[string, string]> = [];
    const source = "https://gitcode.com/lumosaigroup/upup.git";
    const ctx = context(
      [],
      {
        removeExtensionPackage: async (value: string) => { calls.push(["remove", value]); return []; },
        installExtensionPackage: async (value: string) => { calls.push(["install", value]); return []; },
        setExtensionPackageResources: async () => [],
      },
      {
        appInstalls: {
          [source]: {
            current: { source, version: "2.0.0", commit: "bbb", at: "2026-11-27T00:00:00.000Z" },
            previous: { source, version: "1.0.0", commit: "aaa", at: "2026-11-26T00:00:00.000Z" },
          },
        },
      },
    );
    const result = (await appsModule(ctx).commands.apps_rollback({ packageSource: source })) as { rolledBackTo: string };
    expect(result.rolledBackTo).toBe(`${source}@aaa`);
    expect(calls).toContainEqual(["install", `${source}@aaa`]);
    const history = (ctx.state.appInstalls as Record<string, { current: { commit?: string }; previous?: unknown }>)[source];
    expect(history.current.commit).toBe("aaa");
    expect(history.previous).toBeUndefined();
  });
});


describe("推荐与上下文治理 (U5 / UP-6.2/6.4)", () => {
  it("apps_recommend_dismiss 去重写入设置", () => {
    const ctx = context();
    const app = appsModule(ctx);
    app.commands.apps_recommend_dismiss({ appId: "upup" });
    const result = app.commands.apps_recommend_dismiss({ appId: "upup" }) as { dismissed: string[] };
    expect(result.dismissed).toEqual(["upup"]);
    expect(ctx.state.dismissedAppRecommendations).toEqual(["upup"]);
  });

  it("apps_hygiene 按安装时间提醒从没用过的应用；停用的应用不提醒", () => {
    const dir = mkdtempSync(join(tmpdir(), "ob-apps-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "upup", pi: { app: { kind: "app" } } }));
    const installs = { [dir]: { current: { source: dir, at: "2026-01-01T00:00:00.000Z" } } };
    const on = context([{ source: dir, installedPath: dir }], {}, { appInstalls: installs });
    on.settings.dir = mkdtempSync(join(tmpdir(), "ob-agent-"));
    const idle = (appsModule(on).commands.apps_hygiene({}) as { idle: Array<{ appId: string; lastUsedAt: string | null }> }).idle;
    expect(idle).toHaveLength(1);
    expect(idle[0]).toMatchObject({ appId: "upup", lastUsedAt: null });

    const off = context([{ source: dir, installedPath: dir, filters: { extensions: false } } as never], {}, { appInstalls: installs });
    off.settings.dir = mkdtempSync(join(tmpdir(), "ob-agent-"));
    expect((appsModule(off).commands.apps_hygiene({}) as { idle: unknown[] }).idle).toEqual([]);
  });

  it("apps_hygiene_keep 之后不再提醒", () => {
    const dir = mkdtempSync(join(tmpdir(), "ob-apps-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "upup", pi: { app: { kind: "app" } } }));
    const ctx = context([{ source: dir, installedPath: dir }], {}, { appInstalls: { [dir]: { current: { source: dir, at: "2026-01-01T00:00:00.000Z" } } } });
    ctx.settings.dir = mkdtempSync(join(tmpdir(), "ob-agent-"));
    const app = appsModule(ctx);
    app.commands.apps_hygiene_keep({ packageSource: dir });
    expect((app.commands.apps_hygiene({}) as { idle: unknown[] }).idle).toEqual([]);
  });
});
