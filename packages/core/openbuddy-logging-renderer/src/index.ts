import { Logger, type ISettingsParam } from "tslog";
import { generateTraceId, isLogLevel, type LogContext, type LogLevel } from "@openbuddy/logging-shared";

export type { LogContext, LogLevel };
const levelValues: Record<LogLevel, number> = { trace: 0, debug: 1, info: 2, warn: 3, error: 4, fatal: 5 };

export interface RendererLogger {
  readonly scope: string;
  readonly context: Readonly<LogContext>;
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  fatal(message: string, context?: LogContext): void;
  child(context: LogContext): RendererLogger;
}

function clean(context: LogContext): LogContext {
  return Object.fromEntries(Object.entries(context).filter(([, value]) => value !== undefined));
}

function create(scope: string, context: LogContext, level: LogLevel, devMode: boolean): RendererLogger {
  const settings: ISettingsParam<LogContext> = { name: scope, type: devMode ? "pretty" : "json", minLevel: levelValues[level], hideLogPositionForProduction: !devMode };
  const logger = new Logger<LogContext>(settings);
  const write = (method: LogLevel, message: string, fields?: LogContext) => {
    const payload = clean({ ...context, ...fields, scope, msg: message });
    const fn = (logger as unknown as Record<string, (arg0: LogContext, arg1?: string) => void>)[method];
    if (fn) fn.call(logger, payload, message);
  };
  return {
    scope,
    context: clean(context),
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
    fatal: (message, fields) => write("fatal", message, fields),
    child: (fields) => create(scope, { ...context, ...fields }, level, devMode),
  };
}

export function createRendererLogger(options: { name?: string; level?: LogLevel; devMode?: boolean; baseContext?: LogContext } = {}): RendererLogger {
  const level = options.level && isLogLevel(options.level) ? options.level : "info";
  const devMode = options.devMode ?? (typeof process !== "undefined" && process.env.NODE_ENV !== "production");
  return create(options.name ?? "openbuddy-renderer", options.baseContext ?? {}, level, devMode);
}

export function withContext(logger: RendererLogger, context: LogContext): RendererLogger { return logger.child(context); }
export function withTrace(logger: RendererLogger, traceId: string): RendererLogger { return logger.child({ traceId }); }
export function generateTrace(): string { return generateTraceId(); }
