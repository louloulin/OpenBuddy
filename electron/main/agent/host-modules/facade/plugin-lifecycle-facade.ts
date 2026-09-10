/**
 * host-modules/facade/plugin-lifecycle-facade.ts
 *
 * v6-G M1 — 把 agent-host.ts 中 plugin lifecycle / inventory / extension
 * forwarder 提取到独立 facade.
 *
 * 反向依赖不变: 此模块不 import agent-host.ts.
 */
import type { AgentHostState } from "../_state-shape";
import {
  refreshStoredPluginLayers as refreshStoredPluginLayersImpl,
  listPluginInventory as listPluginInventoryImpl,
  setPluginEnabledInternal as setPluginEnabledInternalImpl,
  reloadPluginInternal as reloadPluginInternalImpl,
  reloadPiExtensionsInternal as reloadPiExtensionsInternalImpl,
  updatePluginConfigInternal as updatePluginConfigInternalImpl,
  resetPluginStateInternal as resetPluginStateInternalImpl,
  setPluginEnabled as setPluginEnabledImpl,
  reloadPlugin as reloadPluginImpl,
  reloadPiExtensions as reloadPiExtensionsImpl,
  reloadPiRuntime as reloadPiRuntimeImpl,
  updatePluginConfig as updatePluginConfigImpl,
  resetPluginState as resetPluginStateImpl,
  enqueuePluginStateTransaction as enqueuePluginStateTransactionImpl,
  installProfileBundle as installProfileBundleImpl,
  removeProfileBundle as removeProfileBundleImpl,
} from "../plugin-mutations";
import { buildPiNativeInventory as buildPiNativeInventoryImpl } from "../plugin-pi-native-inventory";

export function buildPluginLifecycleFacade(state: AgentHostState) {
  return {
    refreshStoredPluginLayers: (updateActiveProfile = false) =>
      refreshStoredPluginLayersImpl(updateActiveProfile),
    listPluginInventory: () => listPluginInventoryImpl(),
    listPiNativeInventory: () =>
      buildPiNativeInventoryImpl({ state, cwd: state.cwd ?? process.cwd() }),
    setPluginEnabledInternal: (id: string, enabled: boolean, transaction?: any) =>
      setPluginEnabledInternalImpl(id, enabled, transaction),
    reloadPluginInternal: (id: string, transaction?: any) =>
      reloadPluginInternalImpl(id, transaction),
    reloadPiExtensionsInternal: (transaction?: any) => reloadPiExtensionsInternalImpl(transaction),
    updatePluginConfigInternal: (id: string, config: unknown, transaction?: any) =>
      updatePluginConfigInternalImpl(id, config, transaction),
    resetPluginStateInternal: (id: string, transaction?: any) =>
      resetPluginStateInternalImpl(id, transaction),
    setPluginEnabled: (id: string, enabled: boolean) => setPluginEnabledImpl(id, enabled),
    reloadPlugin: (id: string) => reloadPluginImpl(id),
    reloadPiExtensions: () => reloadPiExtensionsImpl(),
    reloadPiRuntime: (reason = "internal-reload") => reloadPiRuntimeImpl(reason),
    updatePluginConfig: (id: string, config: unknown) => updatePluginConfigImpl(id, config),
    resetPluginState: (id: string) => resetPluginStateImpl(id),
    enqueuePluginStateTransaction: <T>(
      kind: "plugin-enable" | "plugin-config" | "plugin-reset",
      target: string,
      operation: (transaction: any) => Promise<T>,
    ) => enqueuePluginStateTransactionImpl(kind, target, operation),
    installProfileBundle: (sourcePath: string) => installProfileBundleImpl(sourcePath),
    removeProfileBundle: (name: string) => removeProfileBundleImpl(name),
  };
}
