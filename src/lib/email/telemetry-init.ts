/**
 * telemetry-init — 在应用启动时根据环境变量启用 Sentry。
 *
 * 用法(main.tsx 早期):
 *   import { initTelemetry } from "@/lib/email/telemetry-init";
 *   await initTelemetry();
 *
 * 行为:
 *   - 读 OPENBUDDY_SENTRY_DSN 环境变量;空 → 不启用 Sentry,base console reporter 保留。
 *   - 启用 → createSentryReporter() → installSentryReporter() 桥接到 base errorReporter。
 *   - 出错(sentry 不可用 / 网络失败)→ 静默 — 不阻塞应用启动。
 *
 * 设计:
 *   - 不阻塞启动:fire-and-forget,主流程立即继续。
 *   - 默认 opt-out:未设 DSN 就不上报,符合"不主动收集"原则。
 *   - PII 自动由 errorReporter 处理,本文件不重复 scrub。
 */
import {
  createSentryReporter,
  installSentryReporter,
} from "@openbuddy/ui-email/ai";

interface InitTelemetryOptions {
  /** 测试用:覆盖 DSN 来源。 */
  getDsn?: () => string | undefined;
  /** 测试用:覆盖 environment。 */
  getEnvironment?: () => string | undefined;
  /** 测试用:覆盖 release。 */
  getRelease?: () => string | undefined;
  /** 启动完成回调(测试用)。 */
  onComplete?: (state: "enabled" | "disabled" | "failed") => void;
}

export async function initTelemetry(options: InitTelemetryOptions = {}): Promise<void> {
  const getDsn = options.getDsn ?? defaultGetEnv("OPENBUDDY_SENTRY_DSN");
  const getEnvironment = options.getEnvironment ?? defaultGetEnv("NODE_ENV");
  const getRelease = options.getRelease ?? defaultGetEnv("OPENBUDDY_VERSION");
  const dsn = getDsn();
  if (!dsn) {
    options.onComplete?.("disabled");
    return;
  }
  try {
    const reporter = await createSentryReporter({
      dsn,
      environment: getEnvironment() ?? "production",
      release: getRelease() ?? "dev",
    });
    if (!reporter) {
      options.onComplete?.("failed");
      return;
    }
    await installSentryReporter(reporter);
    options.onComplete?.("enabled");
  } catch {
    options.onComplete?.("failed");
  }
}

function defaultGetEnv(name: string): () => string | undefined {
  // Electron renderer 端:import.meta.env 在 vite 编译期注入;运行时 process 在 node 端。
  return () => {
    try {
      const meta = import.meta as ImportMeta & { env?: Record<string, string | undefined> };
      if (meta.env?.[name]) return meta.env[name];
    } catch {
      /* SSR / node without import.meta */
    }
    try {
      if (typeof process !== "undefined" && process.env?.[name]) return process.env[name];
    } catch {
      /* process unavailable */
    }
    return undefined;
  };
}
