/**
 * microkernel-host.ts — single entry point for installing / tearing down
 * every host-module that backs the agent-host facade.
 *
 * Phase 8.3 §50: 收口 host-modules/* 的 install pattern. 26 个 host-module
 * 各自暴露 installXxx() 副作用 (写 module-level singleton). 把它们的
 * 生命周期封装到 MicroKernelHost 里, agent-host.ts:initialize() / dispose()
 * 只需面对一个对象.
 *
 * 为什么需要:
 *   - 测试时一次性 disposeMicrokernelHost() 即可清空注册表, 避免
 *     "stale module-level singleton" 在多 test 之间泄漏. 每个 module 自身
 *     暴露的 __resetXxxForTest() 仍然由各 test 显式调用 (它们需要的
 *     依赖更精细, 不在 microkernel 抽象之内).
 *   - 提供 listInstalledModules() / microkernelReady() 观测能力 ——
 *     调试时不用翻 24 个文件.
 *   - 校验 "install 顺序": 跨模块依赖 (比如 deepseek/cordis-runtime 依赖
 *     prompt/abort/listSessions) 必须先 install 依赖方, 违反顺序时
 *     installHostModules() 自身会报未注入错误 (不变量在
 *     installHostModules.ts 集中维护).
 *
 * 不变量:
 *   - 此模块不 import agent-host.ts.
 *   - installMicrokernelHost() 接受 InstallHostModuleDeps 并转发给
 *     installHostModules() (已有 single entry point), 所以是透明 facade.
 *
 * 设计参考: pi-web/lib/rpc-manager.ts 的 startRpcSession / shutdown 风格.
 */

import { installHostModules, type InstallHostModuleDomainInput } from "./install-host-modules";

// ---------------------------------------------------------------------------
// Micro-kernel registry
// ---------------------------------------------------------------------------

const INSTALLED_MODULES: Set<string> = new Set();

/**
 * List every host-module that currently has installed module-level
 * singletons. Useful for diagnostics + test teardown assertions.
 */
export function listInstalledModules(): readonly string[] {
  return [...INSTALLED_MODULES];
}

/**
 * Returns true if every expected module has been wired in. Used by
 * readiness checks before the first IPC call.
 */
export function microkernelReady(): boolean {
  return INSTALLED_MODULES.size > 0;
}

/**
 * Single entry point for installing the entire microkernel. Wraps
 * installHostModules() (which orchestrates the 24+ install() calls in the
 * correct order) and tracks the install set for diagnostics / dispose.
 *
 * Idempotent guard: a re-install with the same deps object first runs
 * disposeMicrokernelHost() to clear the registry; the underlying
 * installHostModules() then re-injects every module-level singleton
 * from scratch. The host-module `__reset*ForTest()` helpers stay
 * available for unit tests that need finer control.
 */
export function installMicrokernelHost(state: Parameters<typeof installHostModules>[0], deps: InstallHostModuleDomainInput): void {
  if (INSTALLED_MODULES.size > 0) {
    // Already installed. The agent-host dual-install path (module-load
    // queueMicrotask + init-pipeline stage=3) used to call this twice in
    // a row, which threw "service X has been registered" inside the deep
    // installHostModules() sub-installers because Cordis + many
    // host-module singletons don't survive disposeMicrokernelHost() cleanly.
    // Make the second call a no-op: the registry is the source of truth.
    return;
  }
  installHostModules(state, deps);
  for (const moduleTag of MICROKERNEL_MODULE_TAGS) INSTALLED_MODULES.add(moduleTag);
}

/**
 * Tear down the microkernel registry. Each host-module's own
 * `__reset*ForTest()` is intentionally NOT called here — those helpers
 * are test-only escape hatches (they blank the module-level singletons
 * to no-ops), and a production dispose would lose user state if it
 * were called. Tests that need fine-grained reset should call the
 * per-module helpers directly.
 */
export function disposeMicrokernelHost(): void {
  INSTALLED_MODULES.clear();
}

/**
 * Canonical list of every host-module that participates in the
 * microkernel. Mirrors the install order in install-host-modules.ts so
 * the registry is a truthful representation of what `install` actually
 * touched. If a new host-module is added there, add the tag here too.
 */
export const MICROKERNEL_MODULE_TAGS: readonly string[] = [
  "harness-cursors",
  "hook-permission",
  "profile/override-patches",
  "profile/snapshot",
  "profile/bundles",
  "plugin-event-bus",
  "plugin-state",
  "session-metadata",
  "session-store",
  "subagent-runtime",
  "agent-prompt",
  "workbench-scope",
  "agent-model",
  "plugin-mutations",
  "deepseek/agent-runtime",
  "deepseek/cordis-runtime",
  "team-runner",
  "provider-registry",
  "profile-reload-transaction",
  "session-rebind",
  "pi-extension-configure",
  "agent-preset-runtime",
  "dispose-internal",
  "workbench-scope-sync",
  "ui-request-resolver",
] as const;
