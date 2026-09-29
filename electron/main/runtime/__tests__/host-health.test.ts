import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  __setHostHealthClock,
  hostCoreHealth,
  recordHostExit,
  resetHostCoreHealth,
} from "../host-health";

const CRASH = { code: 1, signal: null, intentional: false } as const;

describe("host-health", () => {
  let clock = 1_000_000;
  beforeEach(() => {
    clock = 1_000_000;
    __setHostHealthClock(() => clock);
    resetHostCoreHealth();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    __setHostHealthClock(() => Date.now());
    vi.restoreAllMocks();
  });

  it("starts ok with no crashes", () => {
    expect(hostCoreHealth()).toEqual({ mode: "ok", crashes: 0 });
  });

  it("counts crashes but stays ok below the threshold", () => {
    recordHostExit(CRASH);
    recordHostExit(CRASH);
    recordHostExit(CRASH);
    expect(hostCoreHealth().mode).toBe("ok");
    expect(hostCoreHealth().crashes).toBe(3);
  });

  it("marks degraded once crashes exceed the limit in the window", () => {
    for (let i = 0; i < 4; i += 1) recordHostExit(CRASH);
    const health = hostCoreHealth();
    expect(health.mode).toBe("degraded");
    expect(health.crashes).toBe(4);
    expect(health.lastReason).toContain("exit code=1");
  });

  it("ignores intentional exits (app quit / dispose)", () => {
    recordHostExit({ code: 0, signal: null, intentional: true });
    recordHostExit({ code: 0, signal: null, intentional: true });
    expect(hostCoreHealth()).toEqual({ mode: "ok", crashes: 0 });
  });

  it("records the signal when the host was killed", () => {
    recordHostExit({ code: null, signal: "SIGKILL", intentional: false });
    expect(hostCoreHealth().lastReason).toBe("exit code=null signal=SIGKILL");
  });

  it("drops crashes that aged out of the 60s window", () => {
    for (let i = 0; i < 4; i += 1) recordHostExit(CRASH);
    expect(hostCoreHealth().mode).toBe("degraded");

    // 窗口整体滑出后，计数应归零 —— 早先的崩溃不该永久把 UI 钉在降级态。
    clock += 61_000;
    recordHostExit(CRASH);
    const health = hostCoreHealth();
    expect(health.crashes).toBe(1);
    // degraded 是单向的：统计回落不等于内核已自愈，重启能力要等 host 侧重连落地。
    expect(health.mode).toBe("degraded");
  });

  it("reset clears degraded state", () => {
    for (let i = 0; i < 4; i += 1) recordHostExit(CRASH);
    resetHostCoreHealth();
    expect(hostCoreHealth()).toEqual({ mode: "ok", crashes: 0 });
  });
});
