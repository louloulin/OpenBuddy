import { randomUUID } from "node:crypto";
import type { BashRunOptions, BashRunResult } from "@openbuddy/protocol/bash";
import { USER_BASH_REQUEST_PREFIX } from "@openbuddy/protocol/bash";
import { protocolError } from "@openbuddy/protocol/errors";
import type { EngineContext } from "../engine-context.js";

/**
 * `!command` from the composer (20261116-pii W1.2, Pi S2). Pi runs it (`AgentSession.executeBash`)
 * and records a `bashExecution` message: `!cmd` reaches the model with the next prompt, `!!cmd`
 * (`excludeFromContext`) never does. As in Pi's RPC mode, extensions may take over through
 * `user_bash` first. The output streams to the renderer as `bash_execution_*` events.
 */

/** Output is forwarded at most this often, and at most this much per update (the end event carries the final tail). */
const OUTPUT_INTERVAL_MS = 50;
const OUTPUT_TAIL = 64 * 1024;
const tail = (text: string) => (text.length > OUTPUT_TAIL ? text.slice(-OUTPUT_TAIL) : text);

export async function runBash(engine: EngineContext, id: string, command: string, opts: BashRunOptions = {}): Promise<BashRunResult> {
  const slot = engine.slot(id);
  const session = slot.session;
  const idle = () => {
    if (slot.busy || session.isStreaming) throw protocolError("session_busy", "会话忙碌：回复完成后再运行命令");
    if (session.isBashRunning || slot.userBash) throw protocolError("bash_running", "上一条命令还在运行");
  };
  idle();
  const runId = randomUUID();
  // Permission rules apply to typed commands too; deleting ones need the strong confirmation.
  const decision = await engine.permissions.userCommand(id, `${USER_BASH_REQUEST_PREFIX}${runId}`, command, { strong: opts.risk === "medium" || opts.risk === "high" });
  if (!decision.allow) throw protocolError("permission_denied", decision.rule ? "命令被安全规则拒绝（设置 · 安全中心）" : "已取消执行这条命令");
  if (engine.slots.get(id) !== slot) throw protocolError("session_not_loaded", "会话已关闭");
  idle();
  const excludeFromContext = opts.excludeFromContext === true;
  engine.emitEvent(slot, { type: "bash_execution_start", id: runId, command, excludeFromContext });
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!pending) return;
    const delta = tail(pending);
    pending = "";
    engine.emitEvent(slot, { type: "bash_execution_update", id: runId, delta });
  };
  const onChunk = (chunk: string) => {
    pending = tail(pending + chunk);
    timer ??= setTimeout(flush, OUTPUT_INTERVAL_MS);
  };
  const end = (result: { exitCode?: number; cancelled: boolean; truncated: boolean; output: string; fullOutputPath?: string }) => {
    flush();
    engine.emitEvent(slot, { type: "bash_execution_end", id: runId, command, exitCode: result.exitCode, cancelled: result.cancelled, truncated: result.truncated, output: tail(result.output), excludeFromContext, ...(result.fullOutputPath ? { fullOutputPath: result.fullOutputPath } : {}) });
  };
  // Until it ends the slot is not evicted and reloads wait (session-pool.ts).
  slot.userBash = true;
  slot.lastActive = Date.now();
  session.extensionRunner.setUIContext(engine.ui.context(id), "rpc");
  try {
    const hook = await session.extensionRunner.emitUserBash({ type: "user_bash", command, excludeFromContext, cwd: session.sessionManager.getCwd() });
    let result;
    if (hook?.result) {
      result = hook.result;
      session.recordBashResult(command, result, { excludeFromContext });
    } else {
      result = await session.executeBash(command, onChunk, { excludeFromContext, id: runId, ...(hook?.operations ? { operations: hook.operations } : {}) });
    }
    end(result);
    engine.invalidateList();
    return { id: runId, exitCode: result.exitCode, cancelled: result.cancelled, truncated: result.truncated, output: tail(result.output), excludeFromContext, ...(result.fullOutputPath ? { fullOutputPath: result.fullOutputPath } : {}) };
  } catch (error) {
    end({ cancelled: false, truncated: false, output: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    slot.userBash = false;
    slot.lastActive = Date.now();
    // A reload requested while the command ran (e.g. a built-in switched off) applies now.
    if (slot.stale && !slot.busy && engine.slots.get(id) === slot) void engine.rebuild(slot).catch(() => {});
  }
}

/** Stop the running `!command` (its result is still recorded, marked cancelled). */
export function abortBash(engine: EngineContext, id: string) {
  engine.slot(id).session.abortBash();
}
