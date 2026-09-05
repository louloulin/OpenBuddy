import { createMainLogger, withContext, type MainLogger } from "@openbuddy/logging-main";

let activeHostLogger: MainLogger | null = null;

export function createHostLogger(filePath: string): MainLogger {
  activeHostLogger = createMainLogger({
    filePath,
    serviceName: "openbuddy-agent-host",
    baseContext: { scope: "agent-host" },
  });
  return activeHostLogger;
}

function currentHostLogger(): MainLogger {
  activeHostLogger ??= createMainLogger({
    serviceName: "openbuddy-agent-host",
    baseContext: { scope: "agent-host" },
  });
  return activeHostLogger;
}

export function hostLog(logger: MainLogger, scope: string): MainLogger {
  return withContext(logger, { scope });
}

export function hostReceived(channel: string, traceId?: string, sessionId?: string): void {
  hostLog(currentHostLogger(), "ipc-agent").info(
    { msg: "ipc.received", channel, traceId, sessionId },
    `${channel} received`,
  );
}

export function hostDispatched(channel: string, traceId?: string, sessionId?: string): void {
  hostLog(currentHostLogger(), "ipc-agent").info(
    { msg: "ipc.dispatched", channel, traceId, sessionId },
    `${channel} dispatched`,
  );
}

export function hostFailed(channel: string, traceId?: string, error?: unknown): void {
  hostLog(currentHostLogger(), "ipc-agent").error(
    {
      msg: "ipc.failed",
      channel,
      traceId,
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    },
    `${channel} failed`,
  );
}
