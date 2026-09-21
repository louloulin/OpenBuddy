/**
 * createSentryReporter — Sentry 上报器工厂单测(P3-收尾 第 2 项)。
 *
 * 覆盖:
 *   - DSN 为空时返回 null(不启用)
 *   - mockSentry 注入时构造真正的 reporter
 *   - captureException 透传到 mock + 不吞 context
 *   - captureMessage 同样
 *   - installSentryReporter 把 reporter 桥接到 base errorReporter
 *     (调用 base 后再调 Sentry)
 *   - Sentry 抛错不影响主流程
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSentryReporter, installSentryReporter, type SentryLike } from "../sentry-reporter";
import { errorReporter, resetErrorReporter } from "../error-reporter";

beforeEach(() => resetErrorReporter());

function makeMockSentry(): SentryLike & { captureException: ReturnType<typeof vi.fn>; captureMessage: ReturnType<typeof vi.fn> } {
  return {
    captureException: vi.fn(),
    captureMessage: vi.fn(),
  };
}

describe("createSentryReporter", () => {
  it("DSN 为空且无 mock 时返回 null", async () => {
    const result = await createSentryReporter({ dsn: "" });
    expect(result).toBeNull();
  });

  it("注入 mockSentry 时构造 reporter", async () => {
    const mock = makeMockSentry();
    const reporter = await createSentryReporter({ dsn: "x", mockSentry: mock });
    expect(reporter).toBeTruthy();
    expect(reporter?.sentry).toBe(mock);
  });

  it("captureException 透传 error + context(以 extra 形式)", async () => {
    const mock = makeMockSentry();
    const reporter = await createSentryReporter({ dsn: "x", mockSentry: mock });
    const err = new Error("boom");
    reporter?.captureException(err, { scope: "ai-inbox" });
    expect(mock.captureException).toHaveBeenCalledWith(err, { extra: { scope: "ai-inbox" } });
  });

  it("captureException 不带 context 时不传 extra", async () => {
    const mock = makeMockSentry();
    const reporter = await createSentryReporter({ dsn: "x", mockSentry: mock });
    reporter?.captureException(new Error("boom"));
    expect(mock.captureException).toHaveBeenCalledWith(expect.any(Error));
    const call = mock.captureException.mock.calls[0];
    expect(call?.[1]).toBeUndefined();
  });

  it("captureMessage 透传", async () => {
    const mock = makeMockSentry();
    const reporter = await createSentryReporter({ dsn: "x", mockSentry: mock });
    reporter?.captureMessage("hello", { scope: "ai-summary" });
    expect(mock.captureMessage).toHaveBeenCalledWith("hello", { extra: { scope: "ai-summary" } });
  });
});

describe("installSentryReporter", () => {
  it("桥接后 captureException 同时调用 base + Sentry", async () => {
    const mock = makeMockSentry();
    const reporter = await createSentryReporter({ dsn: "x", mockSentry: mock });
    if (!reporter) throw new Error("expected reporter");
    const baseCaptureSpy = vi.spyOn(errorReporter, "captureException");
    await installSentryReporter(reporter);
    errorReporter.captureException(new Error("bridge-test"));
    expect(baseCaptureSpy).toHaveBeenCalled();
    expect(mock.captureException).toHaveBeenCalled();
  });

  it("Sentry 抛错不影响 base 缓冲", async () => {
    const failingSentry: SentryLike = {
      captureException: () => {
        throw new Error("sentry down");
      },
      captureMessage: () => undefined,
    };
    const reporter = await createSentryReporter({ dsn: "x", mockSentry: failingSentry });
    if (!reporter) throw new Error("expected reporter");
    await installSentryReporter(reporter);
    // 不应该 throw
    expect(() => errorReporter.captureException(new Error("x"))).not.toThrow();
    // base 缓冲仍记录
    expect(errorReporter.recent()).toHaveLength(1);
  });
});
