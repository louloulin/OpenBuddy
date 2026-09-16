/**
 * 安装预检 —— 「装了这个会发生什么」必须在点安装之前说清楚。
 *
 * 为什么需要它:R32–R35 把 pi 扩展市场做成了多源索引 + 安装/升级/回滚/卸载,
 * 但**点安装是零信息的**:面板只是把 `marketplaceAction({type:"install"})` 发出去。
 * 于是三件用户真正需要知道的事全都不可见:
 *
 *   1. 这个包**带 hooks** —— 安装后 pi 会以你的身份执行其中的脚本;
 *   2. 这个包会**接管 OpenBuddy 的某个能力**(pi 优先装载 / passthrough,
 *      例如替换掉内置的 mcp 客户端)—— 面板只在**装完之后**才显示那个 π 徽标;
 *   3. 来源是远程目录且**没固定版本**(`remoteRef` 为空),装到的是"当时的
 *      latest",而本地目录源的内容随时可能被改。
 *
 * 预检是纯函数(输入是市场条目 + 兼容适配器目录,没有 IO),所以:
 *   - 面板、CLI、插件注册的替换实现都能用同一套判断;
 *   - 单测可以直接钉死每一条风险/阻断,不需要起 Electron。
 *
 * 注意它**不做网络探测**:远程源的 manifest 要下载下来才知道,那等于把安装
 * 的一半先做了。所以这里只声称目录里已经有的信息,并在远程源上明确提示
 * "内容以源上当时的版本为准";宁可少说,不要编。
 */
import {
  findPiPackageCatalogEntry,
  type MarketplacePluginEntry,
  type MarketplaceScanResult,
  type PiPackageCatalogEntry,
} from "@openbuddy/shared-types";

export type PreflightLevel = "info" | "warning" | "danger";

export interface PreflightItem {
  /** 稳定 id(测试与 e2e 断言用,文案可以改)。 */
  id: string;
  level: PreflightLevel;
  /** 一句话结论。 */
  label: string;
  /** 展开说明:为什么重要、会发生什么。 */
  detail: string;
}

export type PreflightAction = "install" | "upgrade" | "reinstall";

export interface InstallPreflight {
  pluginName: string;
  /** 目标版本(市场条目声明的)。 */
  version: string | null;
  /** 已安装版本(装了才有)。 */
  installedVersion: string | null;
  action: PreflightAction;
  sourceName: string;
  sourceKind: "local" | "remote" | "unknown";
  sourceLocation: string;
  /** 中性信息:确认框里正常展示的部分。 */
  facts: PreflightItem[];
  /** 风险:需要用户明确知晓。 */
  risks: PreflightItem[];
  /** 硬阻断:存在时不允许安装(点了也没用,不如当场说清)。 */
  blockers: PreflightItem[];
  /** 安装后会接管的 OpenBuddy 能力(pi 兼容适配器命中时)。 */
  takeover: { capability: string; capabilityLabel: string; owner: string } | null;
  /** 是否需要用户点确认。纯新增 + 无风险 + 不接管能力 → 不打扰。 */
  requiresConfirmation: boolean;
}

function sourceKindOf(source: MarketplaceScanResult): "local" | "remote" | "unknown" {
  if (source.sourceKindValue === "local" || source.sourceKindValue === "remote") {
    return source.sourceKindValue;
  }
  // 没有显式声明时按地址形状兜底:http(s)/git 视为远程,其余视为本机路径。
  const url = source.sourceUrlOrPath ?? "";
  if (/^(https?|git|ssh):\/\//i.test(url) || /^git@/.test(url)) return "remote";
  return url ? "local" : "unknown";
}

/**
 * 判断这次点击是全新安装、升级还是重装。
 *
 * `installStatus` 只有 installed / available 两种取值(见
 * `electron/main/agent/pi-resources/marketplace.ts`),再结合版本号细分:
 * 装了且版本不同 → 升级;装了且版本相同(或没声明版本)→ 重装(同样会覆盖磁盘上的目录)。
 */
export function resolvePreflightAction(plugin: MarketplacePluginEntry): PreflightAction {
  const installed = plugin.installStatus === "installed";
  if (!installed) return "install";
  if (plugin.installedVersion && plugin.version && plugin.installedVersion !== plugin.version) return "upgrade";
  return "reinstall";
}

export function buildInstallPreflight(
  source: MarketplaceScanResult,
  plugin: MarketplacePluginEntry,
  options?: { catalogEntry?: PiPackageCatalogEntry | null },
): InstallPreflight {
  const sourceKind = sourceKindOf(source);
  const action = resolvePreflightAction(plugin);
  const facts: PreflightItem[] = [];
  const risks: PreflightItem[] = [];
  const blockers: PreflightItem[] = [];

  // ── 硬阻断:目录条目本身不完整,发出去只会拿到一个失败 ──
  if (!source.sourceUrlOrPath) {
    blockers.push({
      id: "missing-source",
      level: "danger",
      label: "市场源没有地址",
      detail: "该条目所在的源缺少 sourceUrlOrPath,安装请求会被主进程拒绝。请先修复这个源的配置。",
    });
  }
  if (!plugin.relativePath) {
    blockers.push({
      id: "missing-relative-path",
      level: "danger",
      label: "条目缺少包路径",
      detail: "没有 relativePath 就无法定位要安装的包(目录源里它是一个子目录,远程源里它是一个包路径)。",
    });
  }

  facts.push({
    id: "source",
    level: "info",
    label: `来源:${source.sourceName}${source.builtIn ? "(内置)" : ""}`,
    detail:
      sourceKind === "remote"
        ? `远程目录 ${source.sourceUrlOrPath}`
        : `本机目录 ${source.sourceUrlOrPath}`,
  });
  if (plugin.version) {
    facts.push({
      id: "version",
      level: "info",
      label: `目标版本 v${plugin.version}`,
      detail: plugin.installedVersion
        ? `当前已安装 v${plugin.installedVersion}`
        : "这是一个还没装过的包",
    });
  }

  const payload: string[] = [];
  if (plugin.skillCount > 0) payload.push(`${plugin.skillCount} 个技能`);
  if (plugin.hasAgents) payload.push("助理定义");
  if (plugin.hasMcp) payload.push("MCP 服务器");
  if (plugin.hasHooks) payload.push("hooks");
  facts.push({
    id: "payload",
    level: "info",
    label: payload.length > 0 ? `包含:${payload.join(" / ")}` : "未声明额外内容",
    detail: "内容来自市场索引;安装会把这些文件放到 pi 的 plugins 目录下。",
  });

  // ── 风险 ──
  if (plugin.hasHooks) {
    risks.push({
      id: "hooks-exec",
      level: "danger",
      label: "含 hooks:安装后会执行其中的脚本",
      detail:
        "hooks 由 pi 以你的身份运行,OpenBuddy 不会把它放进沙箱。请只安装你信任来源的包;装完可以在「插件·市场 → 已安装」里随时卸载。",
    });
  }
  if (plugin.hasMcp) {
    risks.push({
      id: "mcp-external",
      level: "warning",
      label: "含 MCP 服务器:会让模型连接外部服务",
      detail: "MCP 服务器代表模型可以调用本机/远端工具。装完后建议在「连接器」里逐条确认它能做什么。",
    });
  }
  if (action !== "install") {
    risks.push({
      id: "overwrite-existing",
      level: "warning",
      label: action === "upgrade" ? "升级会覆盖当前已安装版本" : "重装会覆盖当前已安装的目录",
      detail: "覆盖前无法自动回滚到旧版本,除非你保留了原来的包内容。",
    });
  }
  if (sourceKind === "remote" && !plugin.remoteRef) {
    risks.push({
      id: "remote-unpinned",
      level: "warning",
      label: "远程源未固定版本",
      detail: `装到的是源上当时的版本(${plugin.remoteUrl || source.sourceUrlOrPath})。要可复现请让源声明 remoteRef(tag / commit)。`,
    });
  }
  if (sourceKind === "local") {
    risks.push({
      id: "local-untracked",
      level: "warning",
      label: "本机目录源:内容以该目录为准",
      detail: "安装读的是你磁盘上的目录,之后那个目录被改动/删除都不会有提示。",
    });
  }

  const catalog = options?.catalogEntry ?? findPiPackageCatalogEntry(plugin.name);
  const takeover = catalog && catalog.passthrough
    ? { capability: catalog.capability, capabilityLabel: catalog.capabilityLabel, owner: catalog.owner }
    : null;
  if (takeover) {
    risks.push({
      id: "capability-takeover",
      level: "warning",
      label: `会接管「${takeover.capabilityLabel}」能力`,
      detail: `安装后 OpenBuddy 优先使用原生 pi 实现(capability: ${takeover.capability},owner: ${takeover.owner}),内置实现退回备用。卸载即可恢复。`,
    });
  }

  return {
    pluginName: plugin.name,
    version: plugin.version ?? null,
    installedVersion: plugin.installedVersion ?? null,
    action,
    sourceName: source.sourceName,
    sourceKind,
    sourceLocation: source.sourceUrlOrPath ?? "",
    facts,
    risks,
    blockers,
    takeover,
    // 纯新增(install)+ 无风险 + 不接管能力 → 不弹框,别为了仪式感打断人。
    requiresConfirmation: risks.length > 0 || action !== "install",
  };
}
