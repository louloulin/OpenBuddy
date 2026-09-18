/**
 * patch paths.ts — add userAgentsHome()
 */
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The single source of truth for OpenBuddy's agent data root.
 *
 * Every module that needs to locate agent-scoped files (sessions, mcp.json,
 * auth.json, models.json, settings.json, plugin + marketplace caches, the
 * SQLite catalogs, harness token/cache, span-tree exports, ...) MUST resolve
 * its base through `agentHome()` / `agentPath()` rather than rebuilding the
 * `PI_CODING_AGENT_DIR ?? PI_HOME ?: ~/<dir>/agent` expression locally.
 *
 * History: that expression was copied into 20+ modules across `electron/main`
 * and `packages/*`, so a single layout change meant a repo-wide grep-and-patch
 * and any missed copy silently diverged (e.g. a workspace wrote its catalog to
 * one root while the reader resolved another). Centralizing it here makes the
 * layout a one-file decision again.
 *
 * Layout: OpenBuddy owns `~/.openbuddy/agent`. It deliberately does not reuse
 * pi-coding-agent's `~/.pi/agent`, because the two products have diverged —
 * different session metadata schema, marketplace contents, and permission
 * model — and sharing the directory meant each wrote into the other's files
 * and pi-specific sessions leaked into OpenBuddy's sidebar.
 *
 * Overrides, in priority order:
 *   1. `OPENBUDDY_AGENT_DIR`  — explicit OpenBuddy root (the documented knob)
 *   2. `PI_CODING_AGENT_DIR`  — kept so existing pi-oriented setups keep working
 *   3. `PI_HOME`              — base prefix; `.openbuddy/agent` is appended
 *   4. `homedir()`            — same as (3) without PI_HOME
 */
export function agentHome(): string {
  return (
    process.env.OPENBUDDY_AGENT_DIR ??
    process.env.PI_CODING_AGENT_DIR ??
    join(process.env.PI_HOME ?? homedir(), ".openbuddy", "agent")
  );
}

/** Join `segments` onto `agentHome()`. */
export function agentPath(...segments: string[]): string {
  return join(agentHome(), ...segments);
}

/**
 * Resolve the **flat** user-agents directory.
 *
 * Why flat (and not `<agentHome>/agents`)
 * ---------------------------------------
 * Two products share the same root prefix but different layouts:
 *
 *   - `@earendil-works/pi-coding-agent` keeps its `agents/` directory under
 *     `<piHome>/agents`, so when `PI_CODING_AGENT_DIR` points at `agentHome()`
 *     the SDK's native `path.join(getAgentDir(), "agents")` lands at
 *     `<agentHome>/agents` — i.e. `~/.openbuddy/agent/agents`.
 *   - OpenBuddy's own agent definitions are authored and discovered by
 *     OpenBuddy, not the SDK, and the user-facing prompt instructs users to
 *     drop markdown into the **flat** `~/.openbuddy/agents/` (per the product
 *     spec) — not the SDK's nested `<agentHome>/agents`.
 *
 * Both must be honoured: `<agentHome>/agents` because that is what
 * pi-subagents scans natively (via `getAgentDir() + "/agents"`); and
 * `~/.openbuddy/agents` because that is the directory the user is told to
 * author into. The flat path is the **canonical** user target for OpenBuddy
 * (linkExpertAgents writes there, saveAgent writes there); the nested path is
 * the legacy discovery shim and is preserved so existing agents stay visible.
 *
 * Resolution precedence (matches `agentHome()`):
 *   1. `OPENBUDDY_USER_AGENTS_DIR` — explicit override (documented knob)
 *   2. `<dirname(agentHome())>/agents` — the flat sibling layout
 *
 * Returns the absolute path. Callers should not concat `agents` onto
 * `agentHome()` — that produces the wrong layout under the user-facing flat
 * convention.
 */
export function userAgentsHome(): string {
  return (
    process.env.OPENBUDDY_USER_AGENTS_DIR
    ?? join(agentHome(), "..", "agents")
  );
}

/**
 * 把 OpenBuddy 的 agent 根**钉进** `PI_CODING_AGENT_DIR`。
 *
 * 为什么必须做(不是可选优化)
 * --------------------------
 * `@earendil-works/pi-coding-agent` 的 `getAgentDir()` 只认
 * `process.env[PI_CODING_AGENT_DIR]`,**完全不看**我们传给 `createAgentSession`
 * 的 `agentDir`。实测(直接 import SDK 验证):
 *
 *     delete process.env.PI_CODING_AGENT_DIR
 *     getAgentDir()  ->  /Users/<u>/.pi/agent     // 与 OpenBuddy 的根无关
 *     process.env.PI_CODING_AGENT_DIR = "/x"
 *     getAgentDir()  ->  /x
 *
 * 后果不是"文案不对",而是**真实写入错目录**:任何在 OpenBuddy 进程里调用
 * `getAgentDir()` 的代码路径(SDK 自身、以及 pi-subagents 这类在扩展注册时
 * 就解析目录的第三方扩展)都会去读写 `~/.pi/agent` —— 那是另一个产品的数据
 * 目录。本机上 `~/.pi/agent/agents/Designer.md` 停在 2026-09-04,而 OpenBuddy
 * 的 `~/.openbuddy/agent/` 每天在写,就是这个分叉留下的痕迹。
 *
 * 设计
 * ----
 *   - **只补默认值,不覆盖用户显式设置**。用户(或 CI)已经设了
 *     `PI_CODING_AGENT_DIR` 时保持原样 —— 那是刻意的覆盖。
 *   - 幂等:重复调用无副作用。
 *   - 与 `agentHome()` 同源:钉进去的值就是 `agentHome()` 的返回值,所以
 *     `OPENBUDDY_AGENT_DIR` / `PI_HOME` 等覆盖依然生效。
 *   - 返回是否发生了写入,便于启动日志与测试断言。
 */
let pinnedByUs = false;

export function pinPiAgentDirEnv(): boolean {
  if (process.env.PI_CODING_AGENT_DIR) return false;
  process.env.PI_CODING_AGENT_DIR = agentHome();
  pinnedByUs = true;
  return true;
}

/**
 * `PI_CODING_AGENT_DIR` 是不是**我们**刚补上的(而不是用户本来就设了)。
 *
 * 需要区分,否则 `agent:paths` 的 `fromEnv` 会永远为 true —— 界面会一直提示
 * "你改过数据目录",而用户根本没改。调用方应先 `pinPiAgentDirEnv()`,再用本
 * 函数把"我们补的"从"用户设的"里减掉。
 */
export function isPiAgentDirPinnedByUs(): boolean {
  return pinnedByUs;
}

/** 仅供测试:把内部标志复位。 */
export function resetPiAgentDirPinForTests(): void {
  pinnedByUs = false;
}
