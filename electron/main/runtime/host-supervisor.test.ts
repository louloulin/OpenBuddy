/**
 * Tests for electron/main/runtime/host-supervisor.ts.
 *
 * Covers:
 *  - clean start / dispose lifecycle
 *  - restart on unexpected exit (up to MAX_RESTARTS)
 *  - degraded mode after MAX_RESTARTS in window
 *  - intentional exit (code 0) does not trigger restart
 *  - renderer crash event emission
 *  - rolling window: restarts outside the window do not count
 *  - crashpad dump written on crash
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HostSupervisor, HostSupervisorLimits } from "./host-supervisor.js";
import type {
  HostSpawner,
  NodeAgentObserver,
  RendererObserver,
  SupervisorLogger,
} from "./host-supervisor.js";

class FakeChild {
  exitHandlers: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
  killed = false;
  on(event: string, cb: (code: number | null, signal: NodeJS.Signals | null) => void) {
    if (event === "exit") this.exitHandlers.push(cb);
    return this;
  }
  kill() { this.killed = true; }
  emitExit(code: number | null, signal: NodeJS.Signals | null) {
    for (const h of this.exitHandlers) h(code, signal);
  }
}

function makeLogger(): SupervisorLogger & { events: any[] } {
  const events: any[] = [];
  const factory = (level: string) => (target: string, message: string, fields?: Record<string, unknown>) => {
    events.push({ level, target, message, fields });
  };
  return {
    info: factory("info"),
    warn: factory("warn"),
    error: factory("error"),
    events,
  };
}

function setup(nowRef: { t: number }) {
  const children: FakeChild[] = [];
  let shutdowns = 0;
  const host: HostSpawner = {
    spawn() {
      const child = new FakeChild();
      children.push(child);
      return child as unknown as ReturnType<HostSpawner["spawn"]>;
    },
    shutdown: async () => {
      shutdowns++;
    },
  };
  const renderer: RendererObserver = {
    attach(label, recreate) {
      // expose recreate for test
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      (renderer as any).recreate = recreate;
      return () => {};
    },
  };
  const nodeAgent: NodeAgentObserver = {
    on(event, cb) {
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      (nodeAgent as any).cb = cb;
      return () => {};
    },
  };
  const supervisor = new HostSupervisor({
    host,
    renderer,
    nodeAgent,
    logger: makeLogger(),
    now: () => nowRef.t,
  });
  return {
    supervisor,
    children,
    get shutdowns() { return shutdowns; },
    renderer,
    nodeAgent,
  };
}

describe("HostSupervisor", () => {
  let scratch: string;
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "ob-supervisor-"));
  });
  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("starts in running mode and emits host/restarting on unexpected exit", () => {
    const nowRef = { t: 1000 };
    const { supervisor, children } = setup(nowRef);
    supervisor.start();
    expect(supervisor.getMode()).toBe("running");
    expect(children.length).toBe(1);

    const restarting = vi.fn();
    supervisor.on("host/restarting", restarting);
    children[0].emitExit(1, null);
    expect(restarting).toHaveBeenCalled();
    expect(supervisor.getMode()).toBe("running");
    expect(children.length).toBe(2); // re-spawned
  });

  it("does not restart on intentional clean exit (code 0)", () => {
    const nowRef = { t: 1000 };
    const { supervisor, children } = setup(nowRef);
    supervisor.start();
    children[0].emitExit(0, null);
    expect(supervisor.getMode()).toBe("disposed");
    expect(children.length).toBe(1); // no respawn
  });

  it("does not restart on intentional SIGTERM", () => {
    const nowRef = { t: 1000 };
    const { supervisor, children } = setup(nowRef);
    supervisor.start();
    children[0].emitExit(null, "SIGTERM");
    expect(supervisor.getMode()).toBe("disposed");
  });

  it("enters degraded mode after MAX_RESTARTS+1 crashes within the rolling window", () => {
    const nowRef = { t: 1000 };
    const { supervisor, children } = setup(nowRef);
    const degraded = vi.fn();
    supervisor.on("host/degraded", degraded);
    supervisor.start();
    // The supervisor counts each restart attempt; the (MAX_RESTARTS + 1)-th
    // crash within the rolling window trips degraded mode.
    for (let i = 0; i < HostSupervisorLimits.MAX_RESTARTS + 1; i++) {
      const child = children[children.length - 1];
      child.emitExit(1, null);
      nowRef.t += 100; // inside the rolling window
    }
    expect(degraded).toHaveBeenCalled();
    expect(supervisor.getMode()).toBe("degraded");
  });

  it("rolling window: old restarts do not contribute", () => {
    const nowRef = { t: 1000 };
    const { supervisor, children } = setup(nowRef);
    const degraded = vi.fn();
    supervisor.on("host/degraded", degraded);
    supervisor.start();
    // Crash twice inside the window.
    children[0].emitExit(1, null);
    nowRef.t += 100;
    children[1].emitExit(1, null);
    // Advance past the window.
    nowRef.t += HostSupervisorLimits.RESTART_WINDOW_MS + 1000;
    // Now crash again — should restart fresh.
    children[2].emitExit(1, null);
    expect(degraded).not.toHaveBeenCalled();
    expect(supervisor.getMode()).toBe("running");
  });

  it("dispose() tears down listeners and calls shutdown()", async () => {
    const nowRef = { t: 1000 };
    const env = setup(nowRef);
    env.supervisor.start();
    await env.supervisor.dispose();
    expect(env.supervisor.getMode()).toBe("disposed");
    expect(env.shutdowns).toBe(1);
    // Subsequent child exits are ignored.
    env.children[0].emitExit(1, null);
    expect(env.supervisor.getMode()).toBe("disposed");
  });

  it("emits renderer/crashed when the renderer observer triggers", () => {
    const nowRef = { t: 1000 };
    const { supervisor, renderer } = setup(nowRef);
    const crashed = vi.fn();
    supervisor.on("renderer/crashed", crashed);
    supervisor.start();
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    (renderer as any).recreate();
    expect(crashed).toHaveBeenCalled();
  });

  it("writes a crashpad dump when crashpadDir is set", () => {
    const nowRef = { t: 1000 };
    const children: FakeChild[] = [];
    const host: HostSpawner = {
      spawn() {
        const child = new FakeChild();
        children.push(child);
        return child as unknown as ReturnType<HostSpawner["spawn"]>;
      },
    };
    const renderer: RendererObserver = { attach: () => () => {} };
    const supervisor = new HostSupervisor({
      host,
      renderer,
      logger: makeLogger(),
      crashpadDir: scratch,
      now: () => nowRef.t,
    });
    supervisor.start();
    children[0].emitExit(2, null);
    const dumps = readdirSync(scratch).filter((f) => f.startsWith("host-"));
    expect(dumps.length).toBeGreaterThan(0);
    const dump = JSON.parse(readFileSync(join(scratch, dumps[0]), "utf8"));
    expect(dump.schema).toBe("openbuddy.crashpad.v1");
    expect(dump.code).toBe(2);
  });

  it("forceRestart bumps the counter and re-spawns", () => {
    const nowRef = { t: 1000 };
    const { supervisor, children } = setup(nowRef);
    const restarting = vi.fn();
    supervisor.on("host/restarting", restarting);
    supervisor.start();
    void supervisor.forceRestart("settings changed");
    expect(restarting).toHaveBeenCalled();
    expect(children.length).toBe(2);
  });
});
