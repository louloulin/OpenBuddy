/**
 * createSentryReporter — Sentry 上报器工厂(P3-收尾 第 2 项)。
 *
 * 设计动机:
 *   - Sentry SDK 是可选依赖 — 不强制装,不污染 lockfile。
 *   - createSentryReporter() 接受 mockSentry 用于测试;生产时通过动态 import
 *     真正加载 @sentry/electron / @sentry/react。
 *   - 接口与 base reporter 完全兼容,可直接替换 errorReporter。
 *
 * 用法(main.tsx 或 telemetry-init.ts):
 *
 *   import {
 *     createSentryReporter,
 *     installSentryReporter,
 *   } from "@openbuddy/ui-email/ai/sentry-reporter";
 *
 *   const reporter = await createSentryReporter({
 *     dsn: process.env.OPENBUDDY_SENTRY_DSN ?? "",
 *   });
 *   if (reporter) await installSentryReporter(reporter);
 *
 * 接入 Sentry 的完整步骤:
 *   1) `pnpm add -w @sentry/electron @sentry/react`(可选,本模块不强制)
 *   2) 把 dynamicImport 里的字符串替换成真实的 "@sentry/electron"
 *   3) 设置 OPENBUDDY_SENTRY_DSN 环境变量
 *
 * 设计权衡:
 *   - 不强制安装 Sentry — 用户可选用 console.error / 自建后端 / 第三方。
 *   - 接口稳定 — errorReporter 接口不变,迁移成本 = 设置 1 个环境变量。
 */
import type { ErrorReporter } from "./error-reporter";

export interface SentryLike {
  captureException(error: Error, opts?: { extra?: Record<string, unknown> }): void;
  captureMessage(message: string, opts?: { extra?: Record<string, unknown> }): void;
}

export interface CreateSentryReporterOptions {
  /** Sentry DSN — 空字符串表示"不上报",返回 null。 */
  dsn: string;
  /** 例如 "production" / "staging" / "development"。 */
  environment?: string;
  /** 例如 commit hash 或版本号。 */
  release?: string;
  /** 测试用:注入 mock Sentry 模块,跳过 dynamic import。 */
  mockSentry?: SentryLike;
  /**
   * 生产用:自定义 dynamic import(默认尝试 `@sentry/electron`)。
   * 接受 module name + 返回模块的 loader,避免在编译期硬解析。
   */
  dynamicImport?: (moduleName: string) => Promise<unknown>;
}

export interface SentryReporter extends ErrorReporter {
  readonly sentry: SentryLike | null;
}

/**
 * 工厂 — 返回 Sentry 包装 reporter 或 null。
 * 调用方应根据返回值决定是否 installSentryReporter。
 */
export async function createSentryReporter(
  options: CreateSentryReporterOptions,
): Promise<SentryReporter | null> {
  if (!options.dsn && !options.mockSentry) return null;

  let sentry: SentryLike | null = options.mockSentry ?? null;

  if (!sentry) {
    // 生产路径:dynamic import — 通过函数参数传入,避免 vite 静态分析。
    const loader = options.dynamicImport ?? defaultSentryLoader;
    try {
      // 优先尝试 @sentry/react(renderer 主入口),失败回退 @sentry/electron(主进程)。
      let mod = await loader("@sentry/react");
      if (!mod) mod = await loader("@sentry/electron");
      sentry = mod as SentryLike | null;
    } catch {
      sentry = null;
    }
  }

  if (!sentry) return null;
  return makeReporter(sentry);
}

/** 默认 loader — 用 eval 包裹 import,绕开 vite 静态解析。 */
async function defaultSentryLoader(moduleName: string): Promise<unknown> {
  // 用 Function 构造器包一层,运行时才解析,编译期不分析。
  const dynamicImport = new Function("m", "return import(m);") as (
    m: string,
  ) => Promise<unknown>;
  try {
    return await dynamicImport(moduleName);
  } catch {
    return null;
  }
}

function makeReporter(sentry: SentryLike): SentryReporter {
  return {
    sentry,
    captureException(error, context) {
      if (context) {
        sentry.captureException(error, { extra: context as Record<string, unknown> });
      } else {
        sentry.captureException(error);
      }
    },
    captureMessage(message, context) {
      if (context) {
        sentry.captureMessage(message, { extra: context as Record<string, unknown> });
      } else {
        sentry.captureMessage(message);
      }
    },
    recent: () => [],
    clear: () => undefined,
    subscribe: () => () => undefined,
  };
}

/**
 * 把 Sentry reporter 桥接到全局 errorReporter —
 * 优先用 Sentry,失败回落到 base(buffer + console.error)。
 */
export async function installSentryReporter(reporter: SentryReporter): Promise<void> {
  const base = await import("./error-reporter");
  const originalCapture = base.errorReporter.captureException.bind(base.errorReporter);
  base.errorReporter.captureException = (error, context) => {
    originalCapture(error, context); // 先写 base 缓冲 + console
    try {
      reporter.captureException(error, context);
    } catch {
      // Sentry 抛错不影响主流程
    }
  };
  const originalCaptureMessage = base.errorReporter.captureMessage.bind(base.errorReporter);
  base.errorReporter.captureMessage = (message, context) => {
    originalCaptureMessage(message, context);
    try {
      reporter.captureMessage(message, context);
    } catch {
      /* ignore */
    }
  };
}
