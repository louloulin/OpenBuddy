import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { readUpupPlugins, writeUpupPlugins } from "@openbuddy/services/apps/upup-settings";
import { BUILTIN_APP_ID, builtinApp } from "@openbuddy/services/apps/builtin";
import { DEFAULT_APP_SOURCE } from "@openbuddy/services/apps/standard";
import { buildAppPrompt } from "@openbuddy/services/apps/prompt";
import {
  afterRollback,
  installKey,
  isGitSource,
  recordInstall,
  recordUpdate,
  rollbackSource,
  type AppInstallHistory,
  type AppInstallRecord,
} from "@openbuddy/services/apps/install-state";
import { describeAppInstallError } from "@openbuddy/protocol/apps";
import { PLATFORM_DENIED_PATTERNS } from "@openbuddy/engine/permissions/permissions";
import { readAppEntry, type AppEntry } from "@openbuddy/services/apps/manifest";
import { text } from "@openbuddy/services/settings/settings";
import type { Handler, HostContext, HostModule } from "../module.js";

/**
 * 应用平台 (20261126-upup)。
 *
 * 目前只落地 UP-1.2/UP-1.3：UpUp 插件的开关文件（`<agentDir>/settings.json#upupPlugins`）。
 * 应用卡/场景/推荐等后续任务（UP-2/4/6）会在这里扩展，不另起模块。
 */
export function appsModule(ctx: HostContext): HostModule {
  const agentDir = ctx.settings.dir;
  /** 全部应用：内置永远第一，其后是 pi.app 的 Pi 包，没有 manifest 的记为扩展包。 */
  const collect = (cwd?: string): AppEntry[] => {
    const entries: AppEntry[] = [builtinApp()];
    for (const pkg of ctx.engine.extensionPackages(cwd) as Array<{ source: string; installedPath?: string }>) {
      if (!pkg.installedPath) continue;
      const entry = readAppEntry(pkg.installedPath, "pi", pkg.source);
      if (entry) entries.push(entry);
    }
    // 内置 → 应用 → 扩展包；同 id@路径 只留一条。
    const rank = (entry: AppEntry) => (entry.id === BUILTIN_APP_ID ? 0 : entry.kind === "extension" ? 2 : 1);
    const seen = new Set<string>();
    return entries
      .sort((a, b) => rank(a) - rank(b))
      .filter((entry) => (seen.has(`${entry.id}@${entry.installedPath ?? entry.source}`) ? false : (seen.add(`${entry.id}@${entry.installedPath ?? entry.source}`), true)));
  };
  const run = promisify(execFile);
  /** 读 Git HEAD；非 Git 目录或缺少 git 时返回 undefined（不阻塞安装/更新）。 */
  const gitCommit = async (dir: string): Promise<string | undefined> => {
    try {
      const { stdout } = await run("git", ["-C", dir, "rev-parse", "HEAD"], { timeout: 5_000 });
      return stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  };
  /** 按安装源找当前包；普通源与固定 `#ref` 视为同一个。 */
  const packageFor = (source: string, cwd?: string) =>
    (ctx.engine.extensionPackages(cwd) as Array<{ source: string; installedPath?: string }>).find(
      (pkg) => installKey(pkg.source) === installKey(source),
    );
  /** 安装/更新后快照 {source, version, commit}，作为下一次升级的回滚目标。 */
  const snapshot = async (source: string, cwd?: string): Promise<AppInstallRecord | undefined> => {
    const pkg = packageFor(source, cwd);
    if (!pkg?.installedPath) return undefined;
    let version: string | undefined;
    try {
      const raw = await readFile(join(pkg.installedPath, "package.json"), "utf8");
      version = (JSON.parse(raw) as { version?: string }).version;
    } catch {
      /* 本地包可能没有 package.json */
    }
    const commit = isGitSource(pkg.source) ? await gitCommit(pkg.installedPath) : undefined;
    return { source: pkg.source, version, commit, at: new Date().toISOString() };
  };
  const historyOf = (source: string) => ctx.settings.config.read().appInstalls?.[installKey(source)];
  const saveHistory = (source: string, history: AppInstallHistory) =>
    ctx.update((config) => {
      config.appInstalls = { ...(config.appInstalls ?? {}), [installKey(source)]: history };
    });
  const commands: Record<string, Handler> = {
    // 应用列表 (UP-2.2)：内置通用应用永远排第一；其后是 pi.app 的 Pi 包，没有 manifest 的记为扩展包。
    apps_list: (p) => collect(typeof p.cwd === "string" && p.cwd ? p.cwd : undefined),
    // 当前应用 (20261127-upup U4)：持久化到设置，会话打开时注入它的身份/边界。
    apps_set_current: (p) => {
      const id = text(p.appId, "appId");
      const entry = collect(typeof p.cwd === "string" && p.cwd ? p.cwd : undefined).find((app) => app.id === id);
      if (!entry) throw new Error("app_not_found");
      const prompt = buildAppPrompt(entry);
      ctx.update((config) => { config.currentAppId = entry.id; });
      return { appId: entry.id, prompt };
    },
    // 应用级开关 (UP-2.3)：整体启停一个 Pi 包的全部资源（扩展/技能/指令）。
    apps_set_enabled: async (p) => {
      const source = text(p.packageSource, "packageSource");
      const enabled = p.enabled === true;
      await ctx.engine.setExtensionPackageResources(source, {
        extensions: enabled,
        skills: enabled,
        prompts: enabled,
        themes: false,
      });
      return { packageSource: source, enabled };
    },
    // 升级 / 卸载 (UP-1.5 / UP-1.6)：卸载时一并清掉 UpUp 子包开关，避免残留配置指回已删的包。
    // U6：升级前保留当前 {source,version,commit}，升级后记录新状态，回滚才有目标。
    apps_update: async (p) => {
      const source = text(p.packageSource, "packageSource");
      // U6：升级前先拍一次快照，第一次更新后就能回滚（previous = 升级前状态）。
      const before = await snapshot(source);
      const packages = await ctx.engine.updateExtensionPackages(source);
      const after = (await snapshot(source)) ?? before;
      const next = recordUpdate(before, after, historyOf(source));
      if (next) saveHistory(source, next);
      return {
        packageSource: source,
        packages,
        install: next?.current ?? null,
        canRollback: !!rollbackSource(next),
      };
    },
    apps_uninstall: async (p) => {
      const source = text(p.packageSource, "packageSource");
      const packages = await ctx.engine.removeExtensionPackage(source);
      const cleared = writeUpupPlugins(agentDir, { disabled: [], enabled: [] });
      ctx.update((config) => {
        const next = { ...(config.appInstalls ?? {}) };
        delete next[installKey(source)];
        config.appInstalls = next;
      });
      return { packageSource: source, packages, upup: cleared };
    },
    // 安装来源与回滚 (U6)：UI 据此显示「回滚到上一版本」。
    apps_install_state: () => ctx.settings.config.read().appInstalls ?? {},
    apps_rollback: async (p) => {
      const source = text(p.packageSource, "packageSource");
      const history = historyOf(source);
      const target = rollbackSource(history);
      if (!history || !target) throw new Error("rollback_unavailable: 没有可用的上一版本记录");
      const current = packageFor(source);
      try {
        // 先移除当前配置（可能是固定了 ref 的源），再按记录的 commit 重装。
        if (current) await ctx.engine.removeExtensionPackage(current.source);
        const packages = await ctx.engine.installExtensionPackage(target);
        await ctx.engine
          .setExtensionPackageResources(target, { extensions: true, skills: true, prompts: true, themes: false })
          .catch(() => undefined);
        const restored = (await snapshot(target)) ?? { ...history.previous!, source: target, at: new Date().toISOString() };
        saveHistory(source, afterRollback(restored));
        return { packageSource: source, rolledBackTo: target, packages };
      } catch (error) {
        // 回滚失败时尽力恢复原来的源，避免应用从列表里消失。
        if (current) await ctx.engine.installExtensionPackage(current.source).catch(() => undefined);
        throw new Error(describeAppInstallError(error));
      }
    },
    // 应用图标 (UP-2.4)：读包内的 icon，返回 data URI；只允许包目录内的图片，≤512KB。
    apps_icon: async (p) => {
      const pkgRoot = text(p.packageSource, "packageSource");
      const icon = text(p.icon, "icon");
      const target = resolve(pkgRoot, icon);
      const rel = relative(resolve(pkgRoot), target);
      if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("invalid_payload: icon");
      const ext = icon.split(".").pop()?.toLowerCase() ?? "";
      const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/png";
      const bytes = await readFile(target).catch(() => null);
      if (!bytes || bytes.length > 512 * 1024) return { dataUri: null };
      return { dataUri: `data:${mime};base64,${bytes.toString("base64")}` };
    },
    // 工具策略 (UP-3.2)：红线永远在前，配置只能加不能减。
    apps_tool_policy_get: () => {
      const config = ctx.settings.config.read();
      return {
        platformDenied: PLATFORM_DENIED_PATTERNS.map((pattern) => pattern.source),
        denied: config.deniedTools ?? [],
        readonly: config.readonlyTools ?? [],
      };
    },
    apps_tool_policy_set: (p) => {
      const list = (key: string): string[] =>
        Array.isArray(p[key]) ? (p[key] as unknown[]).filter((v): v is string => typeof v === "string" && !!v.trim()).map((v) => v.trim()) : [];
      const config = ctx.settings.config.read();
      ctx.settings.config.write({ ...config, deniedTools: list("denied"), readonlyTools: list("readonly") });
      return { platformDenied: PLATFORM_DENIED_PATTERNS.map((pattern) => pattern.source), denied: list("denied"), readonly: list("readonly") };
    },
    // 默认应用 (2026-11-27)：首次启动把 UpUp 从官方 Git 源装上（幂等；已装则直接返回）。
    // 失败不抛错——离线/私有网络时界面仍可用，只是应用页保留「安装 UpUp」入口。
    // U1 (2026-11-27)：真正安装时同时打开全局扩展开关，否则包记录在、会话仍不加载扩展。
    // 已经安装过的不改开关（尊重用户后来在扩展中心做的关闭）。
    apps_ensure_default: async (p) => {
      const source = typeof p.source === "string" && p.source.trim() ? p.source.trim() : DEFAULT_APP_SOURCE;
      const installed = (ctx.engine.extensionPackages() as Array<{ source: string; installedPath?: string }>)
        .some((pkg) => pkg.source === source || /\/upup$/i.test(pkg.installedPath ?? "") || /upup/i.test(pkg.source));
      if (installed) {
        return { installed: true, source, packages: [], extensionsEnabled: ctx.settings.config.read().extensionsEnabled === true };
      }
      try {
        const packages = await ctx.engine.installExtensionPackage(source);
        await ctx.engine.setExtensionPackageResources(source, { extensions: true, skills: true, prompts: true, themes: false });
        ctx.update((config) => { config.extensionsEnabled = true; });
        // U6：记录这次安装的版本/commit（首次安装没有 previous）。
        const state = await snapshot(source);
        if (state) saveHistory(source, recordInstall(historyOf(source), state));
        return { installed: true, source, packages, extensionsEnabled: true, hint: "扩展已启用；为当前空间授权信任后，新建会话即可使用。" };
      } catch (error) {
        return { installed: false, source, packages: [], extensionsEnabled: ctx.settings.config.read().extensionsEnabled === true, error: describeAppInstallError(error) };
      }
    },
    upup_plugins_get: () => readUpupPlugins(agentDir),
    upup_plugins_set: (p) => {
      const read = (key: string): string[] | undefined =>
        Array.isArray(p[key]) ? (p[key] as unknown[]).filter((v): v is string => typeof v === "string") : undefined;
      return writeUpupPlugins(agentDir, { disabled: read("disabled"), enabled: read("enabled") });
    },
  };
  return { id: "apps", commands };
}
