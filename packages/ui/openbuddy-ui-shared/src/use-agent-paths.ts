import { useEffect, useState } from "react";
import {
  FALLBACK_AGENT_HOME,
  agentsDisplayFrom,
  authDisplayFrom,
  expertsDisplayFrom,
  extensionInstallDisplayFrom,
  mcpConfigDisplayFrom,
  modelsDisplayFrom,
  pluginsDisplayFrom,
  resolveAgentPathsSnapshot,
  sessionsDisplayFrom,
  type AgentPathsSnapshot,
} from "./agent-paths";

/**
 * `useAgentPaths()` — 给 JSX 用的真实数据目录路径。
 *
 * 首帧返回兜底常量(`~/.openbuddy/agent/...`,与默认安装一致),等 main 进程
 * 回话后切成**真实**路径。这样:
 *   - 服务端渲染 / 单测 / 桥未挂载时不会渲染出 `undefined`;
 *   - 用户一旦改过 `OPENBUDDY_AGENT_DIR`,界面文案跟着改,不会再指着
 *     `~/.openbuddy/agent` 这个默认值说事。
 *
 * 为什么不是一个同步常量:renderer 里 `process` 被 vite shim 过,
 * `process.env` 读不到真实值(见 `agent-paths.ts` 的说明)。
 */
export interface AgentPaths {
  /** agentHome 展示前缀,如 `~/.openbuddy/agent`。 */
  home: string;
  agents: string;
  experts: string;
  mcpConfig: string;
  models: string;
  auth: string;
  sessions: string;
  /** pi 扩展的按用户安装根(`<agentHome>/node_modules`)。 */
  extensions: string;
  /** 市场安装的插件注册根(`<agentHome>/plugins`)。 */
  plugins: string;
  /** main 进程是否报告了显式环境变量覆盖(UI 可据此提示"你改过目录")。 */
  fromEnv: boolean;
  /** 是否已解析到真实路径(用于避免首帧闪烁时的布局跳变)。 */
  resolved: boolean;
}

function deriveFallback(home: string, resolved: boolean, fromEnv = false): AgentPaths {
  return {
    home,
    agents: agentsDisplayFrom(home),
    experts: expertsDisplayFrom(home),
    mcpConfig: mcpConfigDisplayFrom(home),
    models: modelsDisplayFrom(home),
    auth: authDisplayFrom(home),
    sessions: sessionsDisplayFrom(home),
    extensions: extensionInstallDisplayFrom(home),
    plugins: pluginsDisplayFrom(home),
    fromEnv,
    resolved,
  };
}

function fromSnapshot(snapshot: AgentPathsSnapshot): AgentPaths {
  const home = snapshot.homeDisplay;
  return {
    home,
    agents: agentsDisplayFrom(home),
    experts: expertsDisplayFrom(home),
    mcpConfig: mcpConfigDisplayFrom(home),
    models: modelsDisplayFrom(home),
    auth: authDisplayFrom(home),
    sessions: sessionsDisplayFrom(home),
    extensions: extensionInstallDisplayFrom(home),
    plugins: pluginsDisplayFrom(home),
    fromEnv: snapshot.fromEnv,
    resolved: true,
  };
}

export function useAgentPaths(): AgentPaths {
  const [paths, setPaths] = useState<AgentPaths>(() => deriveFallback(FALLBACK_AGENT_HOME, false));

  useEffect(() => {
    let alive = true;
    void (async () => {
      const snapshot = await resolveAgentPathsSnapshot();
      if (!alive) return;
      if (!snapshot) return;
      setPaths((previous) => (previous.home === snapshot.home && previous.resolved
        ? previous
        : fromSnapshot(snapshot)));
    })();
    return () => { alive = false; };
  }, []);

  return paths;
}
