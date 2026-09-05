/**
 * host-modules/bootstrap/session-event-log.ts — SessionEventLog bootstrap.
 *
 * Phase 8.3 Batch L1 + Architectural Refactor (DI).
 *
 * 设计:
 *   - **零反向依赖**: 不 import agent-host. 通过参数注入 state (DI 模式).
 *   - 单一职责: 让 host 在重启后能看到上次 shutdown 前写入的事件
 *     (harness server 的 since= replay 依赖这个 load).
 *   - 测试友好: 测试时直接构造一个空 state 对象传入, 不需要 vi.mock 整个
 *     agent-host.ts.
 *
 * 依赖方向:
 *   bootstrap/session-event-log.ts  ←  _host-paths.ts + _state-shape.ts
 *       ↑                              ↑
 *   agent-host.ts:initialize()  ←  纯类型 + 工具函数, 无 module-level mutable
 *
 * 反向依赖 (修复前):
 *   bootstrap/session-event-log.ts → agent-host.ts (piHome, state)  ❌
 *
 * 反向依赖 (修复后):
 *   (none)
 */

import { join } from "node:path";

import { SessionEventLog } from "../../../session/session-event-log";
import { type AgentHostState } from "../_state-shape";
import { piHome } from "../_host-paths";

/**
 * Bootstrap SessionEventLog + cwd + sequence counters into `state`.
 *
 * Pure DI: caller passes `state` explicitly. This module never imports
 * `state` from agent-host, so test code can construct a stub and pass it
 * without mocking the whole host module.
 *
 * Callers must have already cleared any prior session (`disposeInternal()`)
 * so the new log replaces, not appends to, the previous buffer.
 *
 * Side effects on `state`:
 *   - state.sessionEventLog   — fresh `SessionEventLog` instance, loaded from disk
 *   - state.cwd               — workspace root for this session
 *   - state.eventSequence     — last persisted event sequence (for new-session appends)
 *   - state.sessionSequences  — fresh Map (per-session watermark bookkeeping)
 *
 * @returns the loaded SessionEventLog so callers can chain `lastSequence()` reads.
 */
export async function bootstrapSessionEventLog(
  state: AgentHostState,
  cwd: string,
): Promise<SessionEventLog> {
  const sessionEventLog = new SessionEventLog({
    databasePath: join(piHome(), "openbuddy-events.jsonl"),
  });
  await sessionEventLog.load();
  state.sessionEventLog = sessionEventLog;
  state.cwd = cwd;
  state.eventSequence = sessionEventLog.lastSequence();
  state.sessionSequences = new Map();
  return sessionEventLog;
}
