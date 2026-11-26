import { readUpupPlugins, writeUpupPlugins } from "@openbuddy/services/apps/upup-settings";
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
  const commands: Record<string, Handler> = {
    // 应用列表 (UP-2.2)：从已配置的 Pi 包读 pi.app；没有 manifest 的记为普通扩展包。
    apps_list: (p) => {
      const cwd = typeof p.cwd === "string" && p.cwd ? p.cwd : undefined;
      const entries: AppEntry[] = [];
      for (const pkg of ctx.engine.extensionPackages(cwd) as Array<{ source: string; installedPath?: string }>) {
        if (!pkg.installedPath) continue;
        const entry = readAppEntry(pkg.installedPath, "pi", pkg.source);
        if (entry) entries.push(entry);
      }
      // 应用在前，扩展包在后；同 id 只留一条。
      const seen = new Set<string>();
      return entries
        .sort((a, b) => (a.kind === "extension" ? 1 : 0) - (b.kind === "extension" ? 1 : 0))
        .filter((entry) => (seen.has(`${entry.id}@${entry.installedPath}`) ? false : (seen.add(`${entry.id}@${entry.installedPath}`), true)));
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
    upup_plugins_get: () => readUpupPlugins(agentDir),
    upup_plugins_set: (p) => {
      const read = (key: string): string[] | undefined =>
        Array.isArray(p[key]) ? (p[key] as unknown[]).filter((v): v is string => typeof v === "string") : undefined;
      return writeUpupPlugins(agentDir, { disabled: read("disabled"), enabled: read("enabled") });
    },
  };
  return { id: "apps", commands };
}
