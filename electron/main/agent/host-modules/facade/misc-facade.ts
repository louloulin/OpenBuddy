/**
 * host-modules/facade/misc-facade.ts
 *
 * v6-G M1 (facade 化) — 把 agent-host.ts 中剩余的小型 forwarders 集中到
 * 独立 facade. 它们都是单一函数转发, deps 都是 { state }.
 *
 * 反向依赖不变: 此模块不 import agent-host.ts.
 */
import type { AgentHostState } from "../_state-shape";
import {
  reloadMcp as reloadMcpImpl,
  runMcpAuthorization as runMcpAuthorizationImpl,
  authorizeMcp as authorizeMcpImpl,
  cancelMcpAuthorization as cancelMcpAuthorizationImpl,
  mcpStatus as mcpStatusImpl,
  mcpCapabilityGovernance as mcpCapabilityGovernanceImpl,
} from "../mcp-runtime";
import {
  harnessCursorPath as harnessCursorPathImpl,
  getHarnessCursorStore as getHarnessCursorStoreImpl,
  harnessResumeTokenPath as harnessResumeTokenPathImpl,
  getHarnessResumeToken as getHarnessResumeTokenImpl,
  setHarnessResumeToken as setHarnessResumeTokenImpl,
  readHarnessSessionCursors as readHarnessSessionCursorsImpl,
  writeHarnessSessionCursors as writeHarnessSessionCursorsImpl,
  getHarnessSessionCursors as getHarnessSessionCursorsImpl,
  setHarnessSessionCursors as setHarnessSessionCursorsImpl,
} from "../harness-cursors";

export function buildMiscFacade(state: AgentHostState) {
  return {
    // MCP — all take (state, ...)
    reloadMcp: () => reloadMcpImpl(state),
    runMcpAuthorization: (serverName: string, signal?: AbortSignal) =>
      runMcpAuthorizationImpl(state, serverName, signal),
    authorizeMcp: (serverName: string, signal?: AbortSignal) =>
      authorizeMcpImpl(state, serverName, signal),
    cancelMcpAuthorization: (serverName: string) => cancelMcpAuthorizationImpl(state, serverName),
    mcpStatus: () => mcpStatusImpl(state),
    mcpCapabilityGovernance: () => mcpCapabilityGovernanceImpl(state),
    // Harness cursor / token — module-level singletons, 0-arg
    harnessCursorPath: () => harnessCursorPathImpl(),
    getHarnessCursorStore: () => getHarnessCursorStoreImpl(),
    harnessResumeTokenPath: () => harnessResumeTokenPathImpl(),
    getHarnessResumeToken: () => getHarnessResumeTokenImpl(),
    setHarnessResumeToken: (token: unknown) => setHarnessResumeTokenImpl(token),
    readHarnessSessionCursors: () => readHarnessSessionCursorsImpl(),
    writeHarnessSessionCursors: (cursors: Record<string, unknown>) =>
      writeHarnessSessionCursorsImpl(cursors),
    getHarnessSessionCursors: () => getHarnessSessionCursorsImpl(),
    setHarnessSessionCursors: (cursors: unknown) => setHarnessSessionCursorsImpl(cursors),
  };
}
