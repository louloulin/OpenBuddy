/**
 * agent-paths IPC 单测(R95)。
 *
 * 为什么值得单测:58 个文件里写着 `~/.pi/...`,而真实根目录是
 * `~/.openbuddy/agent`(@openbuddy/storage 的 `agentHome()`)。renderer 侧
 * 的 `useAgentPaths()` 完全信任本 IPC 的输出,所以这里一旦指错,26 个
 * ui-* 包的文案会一起指错 —— 而且错得很隐蔽(路径看起来很像)。
 *
 * 本测试锁:
 *   - `home` 与 `agentHome()` 同源(不是重新推导的表达式)
 *   - `agents` 是扁平 `~/.openbuddy/agents/`,不是嵌套 `<home>/agents`
 *     —— 用户被告知把代理 markdown 写到 `~/.openbuddy/agents/`,也
 *     是 `linkExpertAgents` / `saveAgent` 实际写入的位置。
 *   - 其他子路径都挂在 home 下,且与 main 侧真实落盘位置一致
 *     (`extensions` → `<home>/node_modules`,见 pi-extension-discovery.ts;
 *      `plugins` → `<home>/plugins`,见 pi-resources/marketplace.ts)
 *   - `homeDisplay` 与 `agentsDisplay` 都折叠 `$HOME`
 *   - `fromEnv` 反映两个已知的环境变量(包括 `OPENBUDDY_USER_AGENTS_DIR`)
 *   - **默认值里不含 `~/.pi`**
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

// `agentHome()` 直接读 `process.env`,所以每次用例都从干净的环境开始,
// 用完必须还原 —— 否则会污染同进程里的其他测试文件。
const ENV_KEYS = ["OPENBUDDY_AGENT_DIR", "PI_CODING_AGENT_DIR", "PI_HOME", "OPENBUDDY_USER_AGENTS_DIR"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const { describeAgentPaths } = await import("../agent-paths");

describe("describeAgentPaths", () => {
  it("默认根是 ~/.openbuddy/agent,不是 ~/.pi/agent", () => {
    clearEnv();
    const paths = describeAgentPaths();
    expect(paths.home).toBe(join(homedir(), ".openbuddy", "agent"));
    expect(paths.home).not.toContain(`${join(homedir(), ".pi")}`);
    expect(paths.homeDisplay).toBe("~/.openbuddy/agent");
    expect(paths.fromEnv).toBe(false);
  });

  it("默认 agents 路径是扁平的 ~/.openbuddy/agents,不是 ~/.openbuddy/agent/agents", () => {
    clearEnv();
    const paths = describeAgentPaths();
    expect(paths.agents).toBe(join(homedir(), ".openbuddy", "agents"));
    expect(paths.agentsDisplay).toBe("~/.openbuddy/agents");
    // 关键:agents 必须是 home 的**兄弟**而不是 home 的子目录。
    expect(paths.agents.startsWith(paths.home + "/")).toBe(false);
    expect(paths.agents.startsWith(paths.home)).toBe(true);
    // 默认值下 agents 不应沾 ~/.pi。
    expect(paths.agents).not.toContain(`${join(homedir(), ".pi")}`);
  });

  it("OPENBUDDY_USER_AGENTS_DIR 可以单独覆盖扁平 agents 路径", () => {
    clearEnv();
    process.env.OPENBUDDY_USER_AGENTS_DIR = "/tmp/custom-agents";
    const paths = describeAgentPaths();
    expect(paths.agents).toBe("/tmp/custom-agents");
    expect(paths.home).toBe(join(homedir(), ".openbuddy", "agent"));
    expect(paths.fromEnv).toBe(true);
  });

  it("子路径都与 main 侧真实落盘位置一致(agents 除外,它是平铺兄弟)", () => {
    clearEnv();
    const paths = describeAgentPaths();
    // agents 走 userAgentsHome()(默认 = ~/.openbuddy/agents/),不是 home/agents。
    expect(paths.agents).toBe(join(homedir(), ".openbuddy", "agents"));
    expect(paths.experts).toBe(join(paths.home, "experts"));
    expect(paths.mcpConfig).toBe(join(paths.home, "mcp.json"));
    expect(paths.models).toBe(join(paths.home, "models.json"));
    expect(paths.auth).toBe(join(paths.home, "auth.json"));
    expect(paths.sessions).toBe(join(paths.home, "sessions"));
    // pi-extension-discovery.ts 的 nodeModulesRoots() 扫的就是这里。
    expect(paths.extensions).toBe(join(paths.home, "node_modules"));
    // pi-resources/marketplace.ts 的用户级插件根。
    expect(paths.plugins).toBe(join(paths.home, "plugins"));
  });

  it("OPENBUDDY_AGENT_DIR 覆盖生效,agents 跟随 <dirname(home)>/agents", () => {
    clearEnv();
    process.env.OPENBUDDY_AGENT_DIR = "/tmp/custom-agent";
    const paths = describeAgentPaths();
    expect(paths.home).toBe("/tmp/custom-agent");
    // 默认 agents 走 dirname(home)/agents 的派生。
    expect(paths.agents).toBe("/tmp/agents");
    expect(paths.agentsDisplay).toBe("/tmp/agents");
    expect(paths.fromEnv).toBe(true);
  });

  it("PI_CODING_AGENT_DIR 也计为显式覆盖(pi 迁移路径)", () => {
    clearEnv();
    process.env.PI_CODING_AGENT_DIR = "/tmp/pi-agent";
    const paths = describeAgentPaths();
    expect(paths.home).toBe("/tmp/pi-agent");
    expect(paths.fromEnv).toBe(true);
  });

  it("PI_HOME 只作为前缀,agents 跟 home 同样落在 .openbuddy/ 下", () => {
    clearEnv();
    process.env.PI_HOME = join(homedir(), ".pi");
    const paths = describeAgentPaths();
    expect(paths.home).toBe(join(homedir(), ".pi", ".openbuddy", "agent"));
    // 关键:即使 PI_HOME 指向 ~/.pi,agentHome 也不是 ~/.pi 本身。
    expect(paths.home).not.toBe(join(homedir(), ".pi"));
    // agents 落在 home 的兄弟目录(<PI_HOME>/.openbuddy/agents),即用户
    // 整体数据根(<PI_HOME>/.openbuddy)下的 agents/。仍然不沾 ~/.pi 本身。
    expect(paths.agents).toBe(join(homedir(), ".pi", ".openbuddy", "agents"));
    expect(paths.agentsDisplay).toBe(join(homedir(), ".pi", ".openbuddy", "agents").replace(homedir(), "~"));
    // PI_HOME 不是"显式 agent 根",所以不算 fromEnv 覆盖。
    expect(paths.fromEnv).toBe(false);
  });

  it("homeDisplay 折叠 $HOME 前缀", () => {
    clearEnv();
    process.env.OPENBUDDY_AGENT_DIR = join(homedir(), "custom", "agent");
    expect(describeAgentPaths().homeDisplay).toBe("~/custom/agent");
  });
});
