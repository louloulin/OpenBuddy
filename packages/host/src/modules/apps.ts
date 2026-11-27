import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { readUpupPlugins, writeUpupPlugins } from "@openbuddy/services/apps/upup-settings";
import { BUILTIN_APP_ID, builtinApp } from "@openbuddy/services/apps/builtin";
import { PLATFORM_DENIED_PATTERNS } from "@openbuddy/engine/permissions/permissions";
import { readAppEntry, type AppEntry } from "@openbuddy/services/apps/manifest";
import { text } from "@openbuddy/services/settings/settings";
import type { Handler, HostContext, HostModule } from "../module.js";

/**
 * 内置应用源目录 (2026-11-27)：打包后的 `resources/upup`（开发态 `vendor/upup`）。
 * 有 package.json 才算可用；没有就返回 exists:false，界面不显示「安装内置应用」。
 */
function bundledAppsDir(ctx: HostContext): string | undefined {
  const dir = ctx.options.bundledAppsDir;
  return dir && existsSync(join(dir, "package.json")) ? dir : undefined;
}

/**
 * 应用平台 (20261126-upup)。
 *
 * 目前只落地 UP-1.2/UP-1.3：UpUp 插件的开关文件（`<agentDir>/settings.json#upupPlugins`）。
 * 应用卡/场景/推荐等后续任务（UP-2/4/6）会在这里扩展，不另起模块。
 */
export function appsModule(ctx: HostContext): HostModule {
  const agentDir = ctx.settings.dir;
  const commands: Record<string, Handler> = {
    // 应用列表 (UP-2.2)：内置通用应用永远排第一；其后是 pi.app 的 Pi 包，没有 manifest 的记为扩展包。
    apps_list: (p) => {
      const cwd = typeof p.cwd === "string" && p.cwd ? p.cwd : undefined;
      const entries: AppEntry[] = [builtinApp()];
      for (const pkg of ctx.engine.extensionPackages(cwd) as Array<{ source: string; installedPath?: string }>) {
        if (!pkg.installedPath) continue;
        const entry = readAppEntry(pkg.installedPath, "pi", pkg.source);
        if (entry) entries.push(entry);
      }
      // 内置 → 应用 → 扩展包；同 id 只留一条。
      const rank = (entry: AppEntry) => (entry.id === BUILTIN_APP_ID ? 0 : entry.kind === "extension" ? 2 : 1);
      const seen = new Set<string>();
      return entries
        .sort((a, b) => rank(a) - rank(b))
        .filter((entry) => (seen.has(`${entry.id}@${entry.installedPath ?? entry.source}`) ? false : (seen.add(`${entry.id}@${entry.installedPath ?? entry.source}`), true)));
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
    apps_update: async (p) => {
      const source = text(p.packageSource, "packageSource");
      const packages = await ctx.engine.updateExtensionPackages(source);
      return { packageSource: source, packages };
    },
    apps_uninstall: async (p) => {
      const source = text(p.packageSource, "packageSource");
      const packages = await ctx.engine.removeExtensionPackage(source);
      const cleared = writeUpupPlugins(agentDir, { disabled: [], enabled: [] });
      return { packageSource: source, packages, upup: cleared };
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
    // 内置应用源 (2026-11-27)：打包时 resources/upup（开发态 vendor/upup）。界面据此显示「安装内置应用」。
    apps_bundled_source: () => {
      const dir = bundledAppsDir(ctx);
      if (!dir) return { source: null, exists: false, installed: false };
      let version: string | undefined;
      let name: string | undefined;
      try {
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string; version?: string };
        name = typeof pkg.name === "string" ? pkg.name : undefined;
        version = typeof pkg.version === "string" ? pkg.version : undefined;
      } catch {
        /* 坏 manifest 当作没有应用元数据，仍可尝试安装。 */
      }
      const installed = (ctx.engine.extensionPackages() as Array<{ installedPath?: string }>)
        .some((pkg) => pkg.installedPath === dir);
      return { source: dir, exists: true, installed, ...(name ? { name } : {}), ...(version ? { version } : {}) };
    },
    // 一键安装内置 UpUp：装进 agentDir 的包记录，并把资源全开，让工具立即可用。
    apps_install_bundled: async () => {
      const dir = bundledAppsDir(ctx);
      if (!dir) throw new Error("没有可用的内置应用资源（打包时未包含 resources/upup）");
      const packages = await ctx.engine.installExtensionPackage(dir);
      await ctx.engine.setExtensionPackageResources(dir, { extensions: true, skills: true, prompts: true, themes: false });
      return { source: dir, packages };
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
