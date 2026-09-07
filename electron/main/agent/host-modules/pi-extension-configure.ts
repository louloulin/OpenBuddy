/**
 * host-modules/pi-extension-configure.ts — Pi 扩展 configure + report 域.
 *
 * Phase 8.3 Batch D-13: 提取 agent-host.ts 中的两个 Pi 扩展管理函数
 *   - `configurePiExtensions` (69 行, agent-host.ts:1434-1502)
 *   - `reportPiExtensionErrors` (34 行, agent-host.ts:1503-1536)
 *
 * 这两个函数围绕 "Pi 扩展域" 这一概念:
 *   - configure: 解析 manifest specs, 合并 built-in factories, 写 state.piExtensionStatuses
 *   - report: 加载 Pi ResourceLoader 错误, 把 piExtensionStatuses 状态推到 loaded/failed
 *
 * 反向依赖不变量:
 *   - 此模块不 import agent-host.ts
 *   - 所有外部依赖通过 InstallPiExtensionConfigureDeps 参数注入
 *
 * 设计: 沿用 plugin-mutations.ts 的 install pattern — 模块级单例变量,
 * 初始为 no-op stub, 在 installPiExtensionConfigure() 中被替换.
 */

import { type AgentHostState } from "./_state-shape";
import { discoveredPiPackagePaths } from "../pi-extension-discovery";
import {
  applyPiExtensionOverrides,
  builtinPiExtensionFactories,
  mergePiExtensionStatuses,
  piExtensionsResolvedPayload,
  resolvePiExtensions,
  type PiExtensionResolutionOptions,
  type PiExtensionStatus,
} from "../pi-extensions";
import type { OpenBuddyPiExtensionSpec } from "@openbuddy/plugin-host";
import { createPiHooksExtension, type HookRuntimeConfig, type HookShellRunner } from "../agent-hooks";
import { createPiPlanModeExtension } from "../pi-plan-mode";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { HookPermissionRequest } from "../agent-hooks";

// ---------------------------------------------------------------------------
// Module-level singleton deps (install pattern)
// ---------------------------------------------------------------------------

let state: AgentHostState | null = null;

let emitPluginEventImpl: (type: string, payload: unknown) => void = () => undefined;
let telemetrySinkImpl: () => unknown = () => undefined;
let resolveProfileDirectoryImpl: () => string = () => "";
let requestHookPermissionImpl: (title: string, message: string, request?: HookPermissionRequest) => Promise<unknown> = async () => undefined;
let createRequireImpl: (path: string) => { resolve: (id: string) => string } = () => ({ resolve: (id) => id });
let createPiToolExtensionImpl: () => ExtensionFactory = () => () => undefined;

// ---------------------------------------------------------------------------
// Install API
// ---------------------------------------------------------------------------

export interface InstallPiExtensionConfigureDeps {
  state: AgentHostState;
  emitPluginEvent: (type: string, payload: unknown) => void;
  telemetrySink: () => unknown;
  resolveProfileDirectory: () => string;
  requestHookPermission: (
    title: string,
    message: string,
    request?: HookPermissionRequest,
  ) => Promise<unknown>;
  createRequire: (path: string) => { resolve: (id: string) => string };
  createPiToolExtension: () => ExtensionFactory;
}

/**
 * 一次性 install 所有 pi-extension-configure 依赖.
 *
 * 必须在 `agent-host.ts:initialize()` 早期 (state 已初始化) 调用.
 */
export function installPiExtensionConfigure(deps: InstallPiExtensionConfigureDeps): void {
  state = deps.state;
  emitPluginEventImpl = deps.emitPluginEvent;
  telemetrySinkImpl = deps.telemetrySink;
  resolveProfileDirectoryImpl = deps.resolveProfileDirectory;
  requestHookPermissionImpl = deps.requestHookPermission;
  createRequireImpl = deps.createRequire;
  createPiToolExtensionImpl = deps.createPiToolExtension;
}

/** 测试/调试用: 重置模块级单例回到 stub. 不在生产代码调用. */
export function __resetPiExtensionConfigureForTest(): void {
  state = null;
  emitPluginEventImpl = () => undefined;
  telemetrySinkImpl = () => undefined;
  resolveProfileDirectoryImpl = () => "";
  requestHookPermissionImpl = async () => undefined;
  createRequireImpl = () => ({ resolve: (id) => id });
  createPiToolExtensionImpl = () => () => undefined;
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 配置 Pi 扩展: 解析 manifest specs, 应用 overrides, 合并 built-in factories,
 * 写 state.piExtensionStatuses + state.piExtensionPaths + state.piExtensionFactories,
 * 发出 pi/extensions-resolved 事件.
 */
export function configurePiExtensions(
  manifestSpecs: readonly OpenBuddyPiExtensionSpec[],
): void {
  if (!state) throw new Error("pi-extension-configure: not installed");
  const specs = applyPiExtensionOverrides(manifestSpecs, state.piExtensionOverrides);
  const telemetry = telemetrySinkImpl() as Parameters<typeof resolvePiExtensions>[1] extends infer _ ? never : never;
  const resolutionOptions: PiExtensionResolutionOptions = {
    profileDir: resolveProfileDirectoryImpl(),
    resolveSource: (source) => {
      if (!state!.profilePackageJson) {
        throw new Error("Pi extension profile is not initialized");
      }
      return createRequireImpl(state!.profilePackageJson).resolve(source);
    },
    emit: emitPluginEventImpl,
    resolveService: (owner) => state!.context?.get(owner),
    ...(telemetry ? { telemetrySink: telemetry as any } : {}),
  };
  const resolution = resolvePiExtensions(specs, resolutionOptions);

  state.piExtensionStatuses = [
    ...specs
      .filter((spec) => spec.enabled === false)
      .map((spec) => ({
        id: spec.id,
        name: spec.id,
        kind: "pi" as const,
        state: "disabled" as const,
        ...(spec.source ? { source: spec.source } : {}),
        builtIn: !spec.source,
        managed: true,
      })),
    ...resolution.resolved.map((entry) => ({
      id: entry.id,
      name: entry.id,
      kind: "pi" as const,
      state: "pending" as const,
      source: entry.source,
      builtIn: entry.builtIn,
      managed: true,
      ...(entry.mode ? { mode: entry.mode } : {}),
      ...(entry.adapter ? { adapter: entry.adapter } : {}),
      ...(entry.commands ? { commands: entry.commands } : {}),
    })),
    ...resolution.diagnostics
      .filter((diagnostic) => diagnostic.state === "failed")
      .map((diagnostic) => ({
        id: diagnostic.id,
        name: diagnostic.id,
        kind: "pi" as const,
        state: "failed" as const,
        managed: true,
        ...(diagnostic.error ? { error: diagnostic.error } : {}),
      })),
  ];

  state.piExtensionPaths.splice(
    0,
    state.piExtensionPaths.length,
    ...state.profilePiResourcePaths.extensions,
    ...state.piMarketplaceResourcePaths.extensions,
    ...resolution.paths,
    ...discoveredPiPackagePaths(),
  );

  const toolExtension =
    state.piExtensionFactories.find((extension) => extension.name === "openbuddy-pi-tools") ?? {
      name: "openbuddy-pi-tools",
      factory: createPiToolExtensionImpl(),
      hidden: true as const,
    };

  const planExtension =
    state.piExtensionFactories.find((extension) => extension.name === "openbuddy-pi-plan-mode") ?? {
      name: "openbuddy-pi-plan-mode",
      factory: createPiPlanModeFactoryImpl(),
      hidden: true as const,
    };

  const hooksExtension =
    state.piExtensionFactories.find((extension) => extension.name === "openbuddy-pi-hooks") ?? {
      name: "openbuddy-pi-hooks",
      factory: createPiHooksExtension(
        () => state!.hookConfigs as readonly HookRuntimeConfig[],
        emitPluginEventImpl,
        {
          confirm: (title: string, message: string, request?: HookPermissionRequest) =>
            requestHookPermissionImpl(title, message, request) as Promise<any>,
          resolveShellRunner: () => state!.context?.get("hookShell") as HookShellRunner | undefined,
        },
      ),
      hidden: true as const,
    };

  // R1 — openbuddy-apply-patch: built-in unified-diff + structured shell tools.
  const applyPatchExtension =
    state.piExtensionFactories.find((extension) => extension.name === "openbuddy-apply-patch") ??
    (() => {
      const applyPatchFactory = builtinPiExtensionFactories["openbuddy-apply-patch"];
      if (!applyPatchFactory) return null;
      const t = telemetrySinkImpl();
      return {
        name: "openbuddy-apply-patch",
        factory: applyPatchFactory(
          emitPluginEventImpl,
          { trustedCwd: state!.cwd ?? process.cwd() },
          {
            profileDir: resolveProfileDirectoryImpl(),
            resolveSource: (source) => {
              if (!state!.profilePackageJson) {
                throw new Error("Pi extension profile is not initialized");
              }
              return createRequireImpl(state!.profilePackageJson).resolve(source);
            },
            emit: emitPluginEventImpl,
            resolveService: (owner) => state!.context?.get(owner),
            ...(t ? { telemetrySink: t as any } : {}),
          } satisfies PiExtensionResolutionOptions,
        ),
        hidden: true as const,
      };
    })();

  const builtIns: Array<{ name: string; factory: ExtensionFactory; hidden: true }> = [
    toolExtension,
    planExtension,
    hooksExtension,
  ];
  if (applyPatchExtension) builtIns.push(applyPatchExtension);

  state.piExtensionFactories.splice(
    0,
    state.piExtensionFactories.length,
    ...builtIns,
    ...resolution.factories,
  );

  for (const diagnostic of resolution.diagnostics) {
    emitPluginEventImpl(
      diagnostic.state === "disabled" ? "pi/extension-disabled" : "pi/extension-failed",
      diagnostic,
    );
  }
  emitPluginEventImpl("pi/extensions-resolved", piExtensionsResolvedPayload(resolution));
}

/**
 * 把 Pi ResourceLoader 报告的错误 merge 到 state.piExtensionStatuses,
 * 把所有 enabled 的扩展标记为 loaded 或 failed.
 */
export function reportPiExtensionErrors(): void {
  if (!state) throw new Error("pi-extension-configure: not installed");
  const errors = new Map<string, string>();
  for (const error of state.piResourceLoader?.getExtensions().errors ?? []) {
    errors.set(error.path, error.error);
    emitPluginEventImpl("pi/extension-failed", {
      id: error.path,
      state: "failed",
      path: error.path,
      error: error.error,
    });
  }
  state.piExtensionStatuses = state.piExtensionStatuses.map((status) => {
    if (status.state === "disabled" || status.state === "failed") return status;
    const error = status.source ? errors.get(status.source) : undefined;
    return error
      ? {
          ...status,
          state: "failed" as const,
          health: "failed" as const,
          disabledReason: "load-failed" as const,
          diagnostics: [error],
          error,
        }
      : {
          ...status,
          state: "loaded" as const,
          health: "healthy" as const,
          disabledReason: undefined,
          diagnostics: undefined,
          loadedAt: (status as PiExtensionStatus).loadedAt ?? new Date().toISOString(),
        };
  });
  state.piExtensionStatuses = mergePiExtensionStatuses(
    state.piExtensionStatuses,
    (state.piResourceLoader?.getExtensions().extensions ?? []).map((extension) => ({
      path: extension.path,
      resolvedPath: extension.resolvedPath,
      hidden: extension.hidden,
      sourceInfo: extension.sourceInfo
        ? {
            scope: extension.sourceInfo.scope,
            origin: extension.sourceInfo.origin,
            ...(extension.sourceInfo.baseDir ? { baseDir: extension.sourceInfo.baseDir } : {}),
          }
        : undefined,
    })),
    [...errors.entries()].map(([path, error]) => ({ path, error })),
  );
}

// ---------------------------------------------------------------------------
// 内部 helper
// ---------------------------------------------------------------------------

/**
 * createPiPlanModeFactory 的实现 — 通过 module-level singleton 暴露给 configurePiExtensions.
 */
function createPiPlanModeFactoryImpl(): ExtensionFactory {
  return createPiPlanModeExtension({
    resolveController: () => state!.context?.get("plan") as any,
  });
}
