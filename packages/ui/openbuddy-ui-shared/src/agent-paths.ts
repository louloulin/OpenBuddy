/**
 * agent-paths — OpenBuddy 自有数据目录的**唯一真源**(renderer 侧)。
 *
 * 为什么需要这个文件
 * ------------------
 * OpenBuddy 刻意不复用 pi-coding-agent 的 `~/.pi/agent`。两者已经分叉 ——
 * session 元数据结构不同、marketplace 内容不同、权限模型不同;共用目录只会
 * 让双方互相写坏对方的文件,pi 的 session 还会漏进 OpenBuddy 的侧栏。真实布局
 * 由 `packages/runtime/openbuddy-storage/src/paths.ts` 的 `agentHome()` 决定,
 * 默认 `~/.openbuddy/agent`。
 *
 * 但 renderer 侧的文案与注释里有 40+ 处仍写着 `~/.pi/agents` /
 * `~/.pi/mcp.json` / `~/.pi/config.toml`:26 个 ui-* 包各自抄一份,且从来没跟
 * 实现对齐过。用户照着文案去翻目录只会扑空 —— 尤其 `config.toml` 在
 * `electron/main` 里**已经完全不再被读取**(权限模式改走 `permission:mode-set`
 * IPC + SQLite settings),照它去找等于去找一个不存在的机制。
 *
 * 取值策略:运行期优先,常量兜底
 * ------------------------------
 *   - `resolveAgentHome()` 先问 main 进程要一个**权威**路径:复用既有的
 *     `mcp:config-path` channel(它已经返回 `<agentHome>/mcp.json`),取其
 *     dirname 就是真实的 agentHome。这一步不做猜测,拿到什么就是什么。
 *   - 拿不到时(纯浏览器单测、IPC 未挂载、调用失败)回落到 `FALLBACK_*`
 *     常量。常量按 `agentHome()` 的同一套环境变量优先级推导,默认
 *     `~/.openbuddy/agent` —— 与默认安装一致,不会指到 `~/.pi`。
 *
 * renderer 里 `process` 是被 shim 过的(vite 只补了 versions/platform),
 * `process.env` 不可靠,所以常量只作为最后兜底,不参与正常路径。
 */

/** 用户可见的兜底根目录(仅在 IPC 不可用时使用)。 */
export const FALLBACK_AGENT_HOME = "~/.openbuddy/agent";

/** main 进程 `agent:paths` 的返回形状(`electron/main/ipc/agent-paths.ts`)。 */
export interface AgentPathsSnapshot {
  home: string;
  homeDisplay: string;
  agents: string;
  experts: string;
  mcpConfig: string;
  models: string;
  auth: string;
  sessions: string;
  extensions: string;
  plugins: string;
  fromEnv: boolean;
}

function joinDisplay(base: string, ...segments: string[]): string {
  return [base.replace(/\/+$/, ""), ...segments].join("/");
}

let cachedSnapshot: AgentPathsSnapshot | null = null;
let inflight: Promise<AgentPathsSnapshot | null> | null = null;

/**
 * 清掉进程级缓存。仅供测试使用 —— 生产代码里 agentHome 在一次进程生命周期
 * 内不会变,缓存是有意为之。
 */
export function resetAgentPathsCacheForTests(): void {
  cachedSnapshot = null;
  inflight = null;
}

function isSnapshot(value: unknown): value is AgentPathsSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.home === "string" && candidate.home.length > 0
    && typeof candidate.agents === "string"
    && typeof candidate.mcpConfig === "string";
}

function bridgeInvoke(): ((channel: string, args?: unknown) => Promise<unknown>) | null {
  const bridge = (globalThis as { api?: { invoke?: (channel: string, args?: unknown) => Promise<unknown> } }).api;
  return typeof bridge?.invoke === "function" ? bridge.invoke.bind(bridge) : null;
}

/**
 * 取 main 进程算好的**全量**路径快照。
 *
 * 首选 `agent:paths`;老版本 preload 没有这个 channel 时,退回 `mcp:config-path`
 * (它自远古就有,返回 `<agentHome>/mcp.json`),由 dirname 推出 agentHome —— 两
 * 条路都不猜布局,拿不到就返回 null 让调用方用兜底常量。
 */
export async function resolveAgentPathsSnapshot(): Promise<AgentPathsSnapshot | null> {
  if (cachedSnapshot) return cachedSnapshot;
  if (inflight) return inflight;
  inflight = (async () => {
    const invoke = bridgeInvoke();
    if (!invoke) return null;
    try {
      const direct = await invoke("agent:paths");
      if (isSnapshot(direct)) {
        cachedSnapshot = direct;
        return cachedSnapshot;
      }
    } catch {
      // channel 不存在(旧 preload)或 handler 出错 —— 走下面的兼容路径。
    }
    try {
      const configPath = await invoke("mcp:config-path");
      if (typeof configPath !== "string" || !configPath) return null;
      // `<agentHome>/mcp.json` → dirname。不做前缀假设,避免布局变化后猜错。
      const cut = configPath.lastIndexOf("/");
      if (cut <= 0) return null;
      const home = configPath.slice(0, cut);
      cachedSnapshot = {
        home,
        homeDisplay: home,
        agents: `${home}/agents`,
        experts: `${home}/experts`,
        mcpConfig: `${home}/mcp.json`,
        models: `${home}/models.json`,
        auth: `${home}/auth.json`,
        sessions: `${home}/sessions`,
        extensions: `${home}/node_modules`,
        plugins: `${home}/plugins`,
        fromEnv: false,
      };
      return cachedSnapshot;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * 解析真实 agentHome(绝对值,不带 `~`)。
 *
 * 失败或桥不可用时返回 null —— 调用方应回落到 `FALLBACK_AGENT_HOME`。结果会被
 * 缓存:agentHome 在一次进程生命周期内不会变,而 UI 文案可能在几十个组件里各
 * 问一次。
 */
export async function resolveAgentHomeAbsolute(): Promise<string | null> {
  return (await resolveAgentPathsSnapshot())?.home ?? null;
}

/** 解析 agentHome 的**展示**形式(优先真实路径,失败回落 `~/.openbuddy/agent`)。 */
export async function resolveAgentHomeDisplay(): Promise<string> {
  const snapshot = await resolveAgentPathsSnapshot();
  return snapshot ? snapshot.homeDisplay : FALLBACK_AGENT_HOME;
}

/**
 * React 之外的同步取用口:已知 agentHome 时给出展示前缀。
 *
 * 组件应优先用 `useAgentPaths()`(异步解析 + 订阅),这里只服务于
 * 「已经在 async 流程里、只想拼一行文案」的场景。
 */
export function agentPathDisplayFrom(agentHomeDisplay: string, ...segments: string[]): string {
  return joinDisplay(agentHomeDisplay, ...segments);
}

/** 常用子路径(基于任意 agentHome 展示前缀派生)。 */
export function agentsDisplayFrom(home: string): string { return agentPathDisplayFrom(home, "agents"); }
export function expertsDisplayFrom(home: string): string { return agentPathDisplayFrom(home, "experts"); }
export function mcpConfigDisplayFrom(home: string): string { return agentPathDisplayFrom(home, "mcp.json"); }
export function modelsDisplayFrom(home: string): string { return agentPathDisplayFrom(home, "models.json"); }
export function authDisplayFrom(home: string): string { return agentPathDisplayFrom(home, "auth.json"); }
export function sessionsDisplayFrom(home: string): string { return agentPathDisplayFrom(home, "sessions"); }
/** pi 扩展的按用户安装根(`pi-extension-discovery.ts` 扫的就是这里)。 */
export function extensionInstallDisplayFrom(home: string): string { return agentPathDisplayFrom(home, "node_modules"); }
/** 市场安装的插件注册根(`pi-resources/marketplace.ts`)。 */
export function pluginsDisplayFrom(home: string): string { return agentPathDisplayFrom(home, "plugins"); }

/**
 * 默认(未解析时)展示常量 —— 与真实默认安装一致。
 * 只在「不需要 await」的注释 / 静态文案里用;面向用户的 JSX 应先尝试
 * `useAgentPaths()`。
 */
export const AGENTS_DISPLAY_FALLBACK = joinDisplay(FALLBACK_AGENT_HOME, "agents");
export const EXPERTS_DISPLAY_FALLBACK = joinDisplay(FALLBACK_AGENT_HOME, "experts");
export const MCP_CONFIG_DISPLAY_FALLBACK = joinDisplay(FALLBACK_AGENT_HOME, "mcp.json");
export const MODELS_DISPLAY_FALLBACK = joinDisplay(FALLBACK_AGENT_HOME, "models.json");
export const AUTH_DISPLAY_FALLBACK = joinDisplay(FALLBACK_AGENT_HOME, "auth.json");
export const SESSIONS_DISPLAY_FALLBACK = joinDisplay(FALLBACK_AGENT_HOME, "sessions");
export const EXTENSIONS_DISPLAY_FALLBACK = joinDisplay(FALLBACK_AGENT_HOME, "node_modules");
export const PLUGINS_DISPLAY_FALLBACK = joinDisplay(FALLBACK_AGENT_HOME, "plugins");
