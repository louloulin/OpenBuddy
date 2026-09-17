/**
 * IPC surface — agent 数据目录的**权威路径快照**。
 *
 * 为什么单开一个 channel,而不是让 renderer 自己拼:
 *   OpenBuddy 刻意不复用 pi 的 `~/.pi/agent`(`@openbuddy/storage` 的
 *   `agentHome()` 拥有布局决定权),且用户可以改 `OPENBUDDY_AGENT_DIR` /
 *   `PI_CODING_AGENT_DIR`。renderer 里 `process.env` 被 vite shim 过,读不到
 *   真实值;此前 26 个 ui-* 包各自硬编码 `~/.pi/...` 就翻过这个车。
 *
 * 所以路径只由 main 算一次,renderer 问一次拿全量。`useAgentPaths()` 消费本
 * channel;新增子路径时**只改这里**,不要在 UI 里再拼字符串。
 *
 * 为什么不是 `dsh:rpc` 方法:纯只读、无会话依赖,同 `host:data-dir` 的模式
 * 直接挂 ipcMain,不需要为一个设置项去动 RPC schema。
 */
import { ipcMain } from "electron";
import { homedir } from "node:os";

import { agentHome, isPiAgentDirPinnedByUs } from "@openbuddy/storage";

export interface AgentPathsSnapshot {
  /** agentHome 绝对值。 */
  home: string;
  /** 折叠 `$HOME` 前缀后的展示形式(便于用户直接对照 Finder)。 */
  homeDisplay: string;
  agents: string;
  experts: string;
  mcpConfig: string;
  models: string;
  auth: string;
  sessions: string;
  /** pi 扩展的按用户安装根(实际落盘处)。 */
  extensions: string;
  /** 市场安装的插件注册根。 */
  plugins: string;
  /** 是否来自显式环境变量覆盖(UI 可以据此提示"你改过目录")。 */
  fromEnv: boolean;
  /**
   * pi SDK 实际会用的 agent 目录(`getAgentDir()` 的返回值)。
   *
   * 与 `home` 分开返回,是为了让"我们钉进去的值"可被**运行时观测** ——
   * 否则只能靠读源码或读 main 日志来判断,而这条链路上的分叉(数据被写进
   * `~/.pi/agent`)曾经真实发生过且没人发现。
   */
  piAgentDir: string;
  /** `PI_CODING_AGENT_DIR` 是不是我们替用户补的默认值。 */
  piAgentDirPinnedByUs: boolean;
}

function toDisplay(value: string, home: string): string {
  if (home && value.startsWith(home)) return `~${value.slice(home.length)}`;
  return value;
}

export function describeAgentPaths(): AgentPathsSnapshot {
  const home = agentHome();
  const userHome = homedir();
  const join = (...segments: string[]) => [home.replace(/\/+$/, ""), ...segments].join("/");
  // `pinPiAgentDirEnv()` 在 main 入口把 `PI_CODING_AGENT_DIR` 补成了 agentHome,
  // 所以到这里 `PI_CODING_AGENT_DIR` 基本上**永远非空**。不减掉"我们补的",
  // `fromEnv` 会恒为 true,界面就会一直提示"你改过数据目录" —— 而用户没改。
  const fromEnv = Boolean(process.env.OPENBUDDY_AGENT_DIR)
    || (Boolean(process.env.PI_CODING_AGENT_DIR) && !isPiAgentDirPinnedByUs());
  return {
    home,
    homeDisplay: toDisplay(home, userHome),
    agents: join("agents"),
    experts: join("experts"),
    mcpConfig: join("mcp.json"),
    models: join("models.json"),
    auth: join("auth.json"),
    sessions: join("sessions"),
    // pi 扩展按用户安装的实际落盘处 —— 与 `pi-extension-discovery.ts` 的
    // `nodeModulesRoots()` 保持一致(它扫的就是 `<agentHome>/node_modules`)。
    extensions: join("node_modules"),
    // 市场安装的插件注册根(见 pi-resources/marketplace.ts 的 agentRoot()/plugins)。
    plugins: join("plugins"),
    fromEnv,
    piAgentDir: process.env.PI_CODING_AGENT_DIR ?? "",
    piAgentDirPinnedByUs: isPiAgentDirPinnedByUs(),
  };
}

export function registerAgentPathsIpc(): void {
  ipcMain.handle("agent:paths", () => describeAgentPaths());
}
